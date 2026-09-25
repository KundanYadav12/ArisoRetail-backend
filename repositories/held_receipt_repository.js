const pool = require('../config/db');
const { getISTDatePrefix } = require('../utils/date_utils');

class HeldReceiptRepository {
  /**
   * Save a new held / parked receipt
   */
  static async createHeldReceipt(restaurantId, userId, userName, data) {
    const {
      warehouse_id = null,
      customer_id = null,
      customer_name = 'Walk-in Customer',
      customer_phone = null,
      customer_address = null,
      customer_gst = null,
      cart_data = [],
      subtotal = 0,
      discount_type = 'percentage',
      discount_value = '0',
      discount_amount = 0,
      tax_type = 'intra',
      tax_amount = 0,
      total_amount = 0,
      payment_mode = 'cash',
      notes = null
    } = data;

    if (!Array.isArray(cart_data) || cart_data.length === 0) {
      throw new Error('Cannot hold an empty cart.');
    }

    // Generate daily sequential hold number: HOLD-YYYYMMDD-001
    const today = getISTDatePrefix();
    const prefix = `HOLD-${today}-`;
    const [lastRows] = await pool.execute(
      'SELECT hold_number FROM held_receipts WHERE restaurant_id = ? AND hold_number LIKE ? ORDER BY id DESC LIMIT 1',
      [restaurantId, `${prefix}%`]
    );

    let seq = 1;
    if (lastRows.length > 0) {
      const parts = lastRows[0].hold_number.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    const holdNumber = `${prefix}${String(seq).padStart(3, '0')}`;

    const itemCount = cart_data.reduce((sum, item) => sum + (parseFloat(item.quantity) || 1), 0);
    const cartJson = JSON.stringify(cart_data);

    const [result] = await pool.execute(`
      INSERT INTO held_receipts (
        restaurant_id, hold_number, warehouse_id, user_id, cashier_name,
        customer_id, customer_name, customer_phone, customer_address, customer_gst,
        cart_data, item_count, subtotal, discount_type, discount_value, discount_amount,
        tax_type, tax_amount, total_amount, payment_mode, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', NOW())
    `, [
      restaurantId, holdNumber, warehouse_id, userId, userName,
      customer_id, customer_name, customer_phone, customer_address, customer_gst,
      cartJson, Math.round(itemCount), parseFloat(subtotal) || 0,
      discount_type, String(discount_value), parseFloat(discount_amount) || 0,
      tax_type, parseFloat(tax_amount) || 0, parseFloat(total_amount) || 0,
      payment_mode, notes
    ]);

    return this.getHeldReceiptById(result.insertId, restaurantId);
  }

  /**
   * Get all active held receipts (status = 'held' or 'resumed')
   */
  static async getHeldReceipts(restaurantId, filters = {}) {
    const { search = '', status = 'held', warehouse_id = null } = filters;

    let query = `
      SELECT 
        id, restaurant_id, hold_number, warehouse_id, user_id, cashier_name,
        customer_id, customer_name, customer_phone, customer_address, customer_gst,
        cart_data, item_count, subtotal, discount_type, discount_value, discount_amount,
        tax_type, tax_amount, total_amount, payment_mode, notes, status,
        resumed_at, resumed_by_name, created_at, updated_at
      FROM held_receipts
      WHERE restaurant_id = ?
    `;
    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    } else {
      // By default show held & resumed
      query += ' AND status IN (\'held\', \'resumed\')';
    }

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND (warehouse_id = ? OR warehouse_id IS NULL)';
      params.push(warehouse_id);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query += ' AND (hold_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR notes LIKE ?)';
      params.push(term, term, term, term);
    }

    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.execute(query, params);

    // Safely parse cart_data JSON if string
    return rows.map(r => ({
      ...r,
      cart_data: typeof r.cart_data === 'string' ? JSON.parse(r.cart_data) : r.cart_data
    }));
  }

  /**
   * Retrieve a single held receipt by ID
   */
  static async getHeldReceiptById(id, restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM held_receipts WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      ...row,
      cart_data: typeof row.cart_data === 'string' ? JSON.parse(row.cart_data) : row.cart_data
    };
  }

  /**
   * Update an existing held receipt (e.g. Hold Again with modifications)
   */
  static async updateHeldReceipt(id, restaurantId, userId, userName, data) {
    const existing = await this.getHeldReceiptById(id, restaurantId);
    if (!existing) {
      throw new Error(`Held receipt #${id} not found.`);
    }

    const {
      warehouse_id = existing.warehouse_id,
      customer_id = existing.customer_id,
      customer_name = existing.customer_name,
      customer_phone = existing.customer_phone,
      customer_address = existing.customer_address,
      customer_gst = existing.customer_gst,
      cart_data = existing.cart_data,
      subtotal = existing.subtotal,
      discount_type = existing.discount_type,
      discount_value = existing.discount_value,
      discount_amount = existing.discount_amount,
      tax_type = existing.tax_type,
      tax_amount = existing.tax_amount,
      total_amount = existing.total_amount,
      payment_mode = existing.payment_mode,
      notes = existing.notes
    } = data;

    const itemCount = Array.isArray(cart_data)
      ? cart_data.reduce((sum, item) => sum + (parseFloat(item.quantity) || 1), 0)
      : existing.item_count;

    const cartJson = JSON.stringify(cart_data);

    await pool.execute(`
      UPDATE held_receipts SET
        warehouse_id = ?,
        user_id = ?,
        cashier_name = ?,
        customer_id = ?,
        customer_name = ?,
        customer_phone = ?,
        customer_address = ?,
        customer_gst = ?,
        cart_data = ?,
        item_count = ?,
        subtotal = ?,
        discount_type = ?,
        discount_value = ?,
        discount_amount = ?,
        tax_type = ?,
        tax_amount = ?,
        total_amount = ?,
        payment_mode = ?,
        notes = ?,
        status = 'held',
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [
      warehouse_id, userId, userName,
      customer_id, customer_name, customer_phone, customer_address, customer_gst,
      cartJson, Math.round(itemCount), parseFloat(subtotal) || 0,
      discount_type, String(discount_value), parseFloat(discount_amount) || 0,
      tax_type, parseFloat(tax_amount) || 0, parseFloat(total_amount) || 0,
      payment_mode, notes,
      id, restaurantId
    ]);

    return this.getHeldReceiptById(id, restaurantId);
  }

  /**
   * Mark held receipt as resumed
   */
  static async resumeHeldReceipt(id, restaurantId, userId, userName) {
    const receipt = await this.getHeldReceiptById(id, restaurantId);
    if (!receipt) {
      throw new Error(`Held receipt #${id} not found.`);
    }

    await pool.execute(`
      UPDATE held_receipts SET
        status = 'resumed',
        resumed_at = NOW(),
        resumed_by_user_id = ?,
        resumed_by_name = ?
      WHERE id = ? AND restaurant_id = ?
    `, [userId, userName, id, restaurantId]);

    return this.getHeldReceiptById(id, restaurantId);
  }

  /**
   * Mark held receipt as completed when sale finishes
   */
  static async completeHeldReceipt(id, restaurantId, completedOrderId = null) {
    await pool.execute(`
      UPDATE held_receipts SET
        status = 'completed',
        completed_order_id = ?,
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [completedOrderId, id, restaurantId]);

    return { success: true, message: 'Held receipt completed.' };
  }

  /**
   * Cancel / Discard a held receipt
   */
  static async cancelHeldReceipt(id, restaurantId, userId, reason = 'Discarded by cashier') {
    const receipt = await this.getHeldReceiptById(id, restaurantId);
    if (!receipt) {
      throw new Error(`Held receipt #${id} not found.`);
    }

    await pool.execute(`
      UPDATE held_receipts SET
        status = 'cancelled',
        cancelled_at = NOW(),
        cancelled_by_user_id = ?,
        cancelled_reason = ?
      WHERE id = ? AND restaurant_id = ?
    `, [userId, reason, id, restaurantId]);

    return { success: true, message: 'Held receipt cancelled successfully.' };
  }
}

module.exports = HeldReceiptRepository;
