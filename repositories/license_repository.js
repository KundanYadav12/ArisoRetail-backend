const pool = require('../config/db');

class LicenseRepository {
  // Distributors CRUD
  static async getAllDistributors() {
    const [rows] = await pool.execute(
      `SELECT d.*,
              (SELECT COUNT(*) FROM licenses l WHERE l.distributor_id = d.id) as totalLicenses,
              (SELECT COUNT(*) FROM licenses l WHERE l.distributor_id = d.id AND l.status = 'activated') as usedLicenses,
              (SELECT COUNT(*) FROM licenses l WHERE l.distributor_id = d.id AND l.status = 'available') as availableLicenses
       FROM distributors d
       ORDER BY d.id DESC`
    );
    return rows;
  }

  static async createDistributor(name) {
    const [result] = await pool.execute(
      'INSERT INTO distributors (name) VALUES (?)',
      [name]
    );
    return result.insertId;
  }

  static async updateDistributor(id, name) {
    const [result] = await pool.execute(
      'UPDATE distributors SET name = ?, updated_at = NOW() WHERE id = ?',
      [name, id]
    );
    return result.affectedRows > 0;
  }

  static async deleteDistributor(id) {
    const [result] = await pool.execute(
      'DELETE FROM distributors WHERE id = ?',
      [id]
    );
    return result.affectedRows > 0;
  }

  // Licenses Query & CRUD
  static async getAllLicenses(distributorId = null) {
    let sql = `
      SELECT l.*,
             d.name as distributor_name,
             r.name as store_name,
             r.subscription_expires_at,
             r.owner_name,
             r.owner_email,
             r.owner_mobile,
             r.created_at as subscription_start_date
      FROM licenses l
      JOIN distributors d ON l.distributor_id = d.id
      LEFT JOIN restaurants r ON l.restaurant_id = r.id
    `;
    const params = [];
    if (distributorId) {
      sql += ' WHERE l.distributor_id = ?';
      params.push(parseInt(distributorId));
    }
    sql += ' ORDER BY l.id DESC';

    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  static async getDistributorById(id) {
    const [rows] = await pool.execute('SELECT * FROM distributors WHERE id = ?', [id]);
    return rows[0] || null;
  }

  static async updateLicensePricing(id, currentYearPricing, nextYearPricing) {
    const [result] = await pool.execute(
      'UPDATE licenses SET current_year_pricing = ?, next_year_pricing = ?, updated_at = NOW() WHERE id = ? AND status = "available"',
      [currentYearPricing, nextYearPricing, id]
    );
    return result.affectedRows > 0;
  }

  static async generateLicenses(distributorId, quantity, currentYearPricing, nextYearPricing) {
    const count = parseInt(quantity) || 1;
    const distributor = parseInt(distributorId);
    const priceCurrent = parseFloat(currentYearPricing || 0);
    const priceNext = parseFloat(nextYearPricing || 0);

    const generatedCodes = [];
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      for (let i = 0; i < count; i++) {
        let isUnique = false;
        let licenseCode = '';

        while (!isUnique) {
          licenseCode = '';
          for (let j = 0; j < 12; j++) {
            licenseCode += Math.floor(Math.random() * 10).toString();
          }

          // Check DB uniqueness
          const [dup] = await connection.execute(
            'SELECT id FROM licenses WHERE license_code = ? LIMIT 1',
            [licenseCode]
          );
          if (dup.length === 0) {
            isUnique = true;
          }
        }

        await connection.execute(
          'INSERT INTO licenses (license_code, distributor_id, current_year_pricing, next_year_pricing, status) VALUES (?, ?, ?, ?, "available")',
          [licenseCode, distributor, priceCurrent, priceNext]
        );
        generatedCodes.push(licenseCode);
      }

      await connection.commit();
      return generatedCodes;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async findAvailableLicense(licenseCode) {
    const [rows] = await pool.execute(
      'SELECT * FROM licenses WHERE license_code = ? AND status = "available" LIMIT 1',
      [licenseCode]
    );
    return rows[0] || null;
  }

  // Atomic public license activation + store setup + user admin creation
  static async registerStoreWithLicense({ licenseCode, storeName, ownerName, email, phone, passwordHash }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Lock and retrieve license for update to ensure strict concurrency safety (atomic)
      const [lRows] = await connection.execute(
        'SELECT * FROM licenses WHERE license_code = ? AND status = "available" FOR UPDATE',
        [licenseCode]
      );

      if (lRows.length === 0) {
        throw new Error('License key is invalid, expired, or already in use.');
      }

      const license = lRows[0];

      // 2. Insert Restaurant Record
      const subscriptionYears = parseInt(license.subscription_period_years || 1);
      const [restResult] = await connection.execute(
        'INSERT INTO restaurants (name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile, gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit, subscription_status, subscription_expires_at, created_at) ' +
        'VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, 1, 5, 2, 3, "active", DATE_ADD(NOW(), INTERVAL ? YEAR), NOW())',
        [
          storeName, phone || null, email, ownerName, email, phone || null, subscriptionYears
        ]
      );
      const newRestaurantId = restResult.insertId;

      // 3. Mark License as Activated
      await connection.execute(
        'UPDATE licenses SET status = "activated", activated_at = NOW(), restaurant_id = ? WHERE id = ?',
        [newRestaurantId, license.id]
      );

      // 4. Log Subscription History (Charge history)
      const currentYear = new Date().getFullYear();
      await connection.execute(
        'INSERT INTO subscription_history (restaurant_id, license_id, amount_charged, start_date, expiry_date, year) ' +
        'VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? YEAR), ?)',
        [
          newRestaurantId, license.id, license.current_year_pricing, subscriptionYears, currentYear
        ]
      );

      // 5. Create Owner/Admin User Account
      const username = email.toLowerCase().trim();
      const [userResult] = await connection.execute(
        'INSERT INTO users (restaurant_id, name, username, email, password_hash, role, is_active, must_change_password, is_verified, verified_at) ' +
        'VALUES (?, ?, ?, ?, ?, "admin", 1, 0, 1, NOW())',
        [
          newRestaurantId, ownerName, username, email, passwordHash
        ]
      );

      await connection.commit();
      return {
        restaurantId: newRestaurantId,
        userId: userResult.insertId,
        storeName,
        email
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = LicenseRepository;
