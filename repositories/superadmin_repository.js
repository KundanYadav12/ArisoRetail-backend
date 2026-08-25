const pool = require('../config/db');

class SuperAdminRepository {
  static async getAllRestaurants() {
    const [rows] = await pool.execute(
      'SELECT r.*, ' +
      'd.name as distributor_name, ' +
      'l.license_code, ' +
      'l.activated_at as subscription_start_date, ' +
      'l.current_year_pricing, ' +
      'l.next_year_pricing, ' +
      '(SELECT COUNT(*) FROM users u WHERE u.restaurant_id = r.id) as userCount, ' +
      '(SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id) as orderCount, ' +
      '(SELECT COALESCE(SUM(total_amount), 0) FROM orders o WHERE o.restaurant_id = r.id AND o.order_status != "cancelled") as totalRevenue ' +
      'FROM restaurants r ' +
      'LEFT JOIN licenses l ON l.restaurant_id = r.id ' +
      'LEFT JOIN distributors d ON l.distributor_id = d.id ' +
      'ORDER BY r.id DESC'
    );
    return rows;
  }

  static async getRestaurantById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM restaurants WHERE id = ?',
      [id]
    );
    return rows[0];
  }

  static async getAllSubscriptionPlans() {
    const [rows] = await pool.execute(
      'SELECT * FROM subscription_plans ORDER BY id ASC'
    );
    return rows;
  }

  static async createRestaurant(restaurant) {
    const {
      name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile,
      gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit,
      subscription_status, duration_months
    } = restaurant;

    const months = parseInt(duration_months || 12);
    
    const [result] = await pool.execute(
      'INSERT INTO restaurants (name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile, gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit, subscription_status, subscription_start_at, subscription_expires_at, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? MONTH), NOW())',
      [
        name, domain || null, logo_url || null, address || null, phone || null,
        email || owner_email || null, owner_name || null, owner_email || null, owner_mobile || null,
        gst_number || null, subscription_plan_id || 1, max_user_limit || 5, max_manager_limit || 2,
        max_cashier_limit || 3, subscription_status || 'trial', months
      ]
    );
    return result.insertId;
  }

  static async updateRestaurant(id, restaurant) {
    const {
      name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile,
      gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit,
      subscription_status, subscription_expires_at
    } = restaurant;

    const [result] = await pool.execute(
      'UPDATE restaurants SET name = ?, domain = ?, logo_url = ?, address = ?, phone = ?, email = ?, owner_name = ?, owner_email = ?, owner_mobile = ?, gst_number = ?, subscription_plan_id = ?, max_user_limit = ?, max_manager_limit = ?, max_cashier_limit = ?, subscription_status = ?, subscription_expires_at = ?, updated_at = NOW() WHERE id = ?',
      [
        name, domain || null, logo_url || null, address || null, phone || null,
        email || null, owner_name || null, owner_email || null, owner_mobile || null,
        gst_number || null, subscription_plan_id || 1, max_user_limit || 5, max_manager_limit || 2,
        max_cashier_limit || 3, subscription_status || 'trial', subscription_expires_at || null, id
      ]
    );
    return result.affectedRows > 0;
  }

  static async renewSubscription(id, durationMonths, customExpiryDate = null) {
    let query;
    let params;

    if (customExpiryDate) {
      query = 'UPDATE restaurants SET subscription_expires_at = ?, subscription_status = "active", updated_at = NOW() WHERE id = ?';
      params = [customExpiryDate, id];
    } else {
      const months = parseInt(durationMonths || 12);
      query = 'UPDATE restaurants SET subscription_expires_at = IF(subscription_expires_at > NOW(), DATE_ADD(subscription_expires_at, INTERVAL ? MONTH), DATE_ADD(NOW(), INTERVAL ? MONTH)), subscription_status = "active", updated_at = NOW() WHERE id = ?';
      params = [months, months, id];
    }

    const [result] = await pool.execute(query, params);
    return result.affectedRows > 0;
  }

  static async setSubscriptionStatus(id, status) {
    const [result] = await pool.execute(
      'UPDATE restaurants SET subscription_status = ?, updated_at = NOW() WHERE id = ?',
      [status, id]
    );
    return result.affectedRows > 0;
  }

  static async getPlatformStats() {
    const [tenantCounts] = await pool.execute(
      'SELECT subscription_status, COUNT(*) as count FROM restaurants GROUP BY subscription_status'
    );

    const [platformAgg] = await pool.execute(
      'SELECT COUNT(id) as totalRestaurants, ' +
      '(SELECT COUNT(*) FROM orders WHERE order_status != "cancelled") as totalOrders, ' +
      '(SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE order_status != "cancelled") as totalRevenue, ' +
      '(SELECT COUNT(*) FROM users) as totalUsers ' +
      'FROM restaurants'
    );

    const statusSummary = { active: 0, expired: 0, trial: 0, suspended: 0 };
    tenantCounts.forEach(row => {
      if (statusSummary[row.subscription_status] !== undefined) {
        statusSummary[row.subscription_status] = row.count;
      }
    });

    return {
      totalRestaurants: platformAgg[0]?.totalRestaurants || 0,
      totalOrders: platformAgg[0]?.totalOrders || 0,
      totalRevenue: parseFloat(platformAgg[0]?.totalRevenue || 0),
      totalUsers: platformAgg[0]?.totalUsers || 0,
      subscriptions: statusSummary
    };
  }

  static async getGlobalAuditLogs(limit = 100, offset = 0) {
    const parsedLimit = Math.max(1, parseInt(limit) || 100);
    const parsedOffset = Math.max(0, parseInt(offset) || 0);
    const [rows] = await pool.query(
      `SELECT a.*, 
              r.name as current_restaurant_name, 
              r.logo_url as current_restaurant_logo,
              u.username as user_username, 
              u.name as fallback_user_name, 
              u.role as fallback_user_role 
       FROM audit_logs a 
       LEFT JOIN restaurants r ON a.restaurant_id = r.id 
       LEFT JOIN users u ON a.user_id = u.id 
       ORDER BY a.id DESC LIMIT ${parsedLimit} OFFSET ${parsedOffset}`
    );
    return rows;
  }

  static async deleteRestaurant(id) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Clean up dependent tenant records
      await connection.execute('DELETE FROM print_queue WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM receipt_settings WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM printers WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM orders WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM cashier_shifts WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM users WHERE restaurant_id = ?', [id]);
      
      const [result] = await connection.execute('DELETE FROM restaurants WHERE id = ?', [id]);

      await connection.commit();
      return result.affectedRows > 0;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async addAuditLog(restaurantId, userId, action, description, ipAddress, extraDetails = {}) {
    try {
      const { user_name, user_role, prev_name, new_name, prev_logo, new_logo, metadata } = extraDetails;
      
      let finalUserName = user_name || null;
      let finalUserRole = user_role || null;

      if (userId && (!finalUserName || !finalUserRole)) {
        try {
          const [uRows] = await pool.query('SELECT name, role FROM users WHERE id = ?', [userId]);
          if (uRows.length > 0) {
            finalUserName = finalUserName || uRows[0].name;
            finalUserRole = finalUserRole || uRows[0].role;
          }
        } catch (e) {}
      }

      await pool.execute(
        'INSERT INTO audit_logs (restaurant_id, user_id, action, description, ip_address, user_name, user_role, prev_name, new_name, prev_logo, new_logo, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          restaurantId || null,
          userId || null,
          action || 'ACTION',
          description || null,
          ipAddress || null,
          finalUserName,
          finalUserRole,
          prev_name || null,
          new_name || null,
          prev_logo || null,
          new_logo || null,
          metadata ? JSON.stringify(metadata) : null
        ]
      );
    } catch (err) {
      console.warn('[Audit Log Warning]', err.message);
    }
  }
}

module.exports = SuperAdminRepository;
