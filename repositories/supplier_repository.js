const pool = require('../config/db');

class SupplierRepository {
  /**
   * Fetch all suppliers for a restaurant tenant
   */
  static async getAll(restaurantId, filters = {}) {
    const { search, status } = filters;

    let query = `
      SELECT 
        s.*,
        COUNT(DISTINCT pb.id) as total_bills,
        COALESCE(SUM(pb.total_amount), 0) as total_purchase_amount
      FROM suppliers s
      LEFT JOIN purchase_bills pb ON s.id = pb.supplier_id AND pb.restaurant_id = s.restaurant_id
      WHERE s.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND s.status = ?';
      params.push(status);
    }

    if (search && search.trim()) {
      query += ' AND (s.name LIKE ? OR s.company_name LIKE ? OR s.mobile LIKE ? OR s.gst_number LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    query += ' GROUP BY s.id ORDER BY s.name ASC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get supplier by ID
   */
  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM suppliers WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Create a new supplier
   */
  static async create(restaurantId, data) {
    const {
      name,
      company_name,
      mobile,
      email,
      address,
      city,
      state,
      pincode,
      gst_number,
      pan_number,
      opening_balance = 0.00,
      payment_terms = 'Net 30',
      status = 'active',
      notes
    } = data;

    const opBal = parseFloat(opening_balance) || 0.00;

    const [result] = await pool.execute(`
      INSERT INTO suppliers (
        restaurant_id, name, company_name, mobile, email, address,
        city, state, pincode, gst_number, pan_number, opening_balance,
        current_balance, payment_terms, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      restaurantId, name.trim(), company_name ? company_name.trim() : null,
      mobile.trim(), email ? email.trim() : null, address || null,
      city || null, state || null, pincode || null,
      gst_number ? gst_number.trim() : null, pan_number ? pan_number.trim() : null,
      opBal, opBal, payment_terms || 'Net 30', status || 'active', notes || null
    ]);

    return { id: result.insertId, ...data, opening_balance: opBal, current_balance: opBal };
  }

  /**
   * Update supplier
   */
  static async update(id, restaurantId, data) {
    const {
      name,
      company_name,
      mobile,
      email,
      address,
      city,
      state,
      pincode,
      gst_number,
      pan_number,
      payment_terms,
      status,
      notes
    } = data;

    await pool.execute(`
      UPDATE suppliers SET
        name = COALESCE(?, name),
        company_name = COALESCE(?, company_name),
        mobile = COALESCE(?, mobile),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        pincode = COALESCE(?, pincode),
        gst_number = COALESCE(?, gst_number),
        pan_number = COALESCE(?, pan_number),
        payment_terms = COALESCE(?, payment_terms),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes),
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [
      name ? name.trim() : null, company_name, mobile ? mobile.trim() : null, email,
      address, city, state, pincode, gst_number, pan_number,
      payment_terms, status, notes, id, restaurantId
    ]);

    return this.getById(id, restaurantId);
  }

  /**
   * Delete supplier (soft-delete if has purchase bills)
   */
  static async delete(id, restaurantId) {
    const [billRows] = await pool.execute(
      'SELECT id FROM purchase_bills WHERE supplier_id = ? AND restaurant_id = ? LIMIT 1',
      [id, restaurantId]
    );

    if (billRows.length > 0) {
      await pool.execute(
        'UPDATE suppliers SET status = "inactive", updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
        [id, restaurantId]
      );
      return { softDeleted: true, message: 'Supplier has existing purchase records, marked as inactive.' };
    }

    await pool.execute(
      'DELETE FROM suppliers WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return { success: true };
  }

  /**
   * Fetch supplier purchase history & bills
   */
  static async getBills(supplierId, restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        pb.*,
        w.name as warehouse_name
      FROM purchase_bills pb
      LEFT JOIN warehouses w ON pb.warehouse_id = w.id
      WHERE pb.supplier_id = ? AND pb.restaurant_id = ?
      ORDER BY pb.bill_date DESC
    `, [supplierId, restaurantId]);
    return rows;
  }
}

module.exports = SupplierRepository;
