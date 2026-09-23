const pool = require('../config/db');
const { getISTDateString } = require('../utils/date_utils');

class StockRequestRepository {
  /**
   * Fetch all stock requests for a tenant
   */
  static async getAll(restaurantId, filters = {}) {
    const { status, warehouse_id, date_from, date_to, search } = filters;

    let query = `
      SELECT 
        sr.*,
        w_req.name as requesting_warehouse_name,
        w_req.code as requesting_warehouse_code,
        w_src.name as source_warehouse_name,
        w_src.code as source_warehouse_code,
        COUNT(sri.id) as total_items,
        COALESCE(SUM(sri.requested_qty), 0) as total_requested_qty,
        COALESCE(SUM(sri.approved_qty), 0) as total_approved_qty
      FROM stock_requests sr
      LEFT JOIN warehouses w_req ON sr.requesting_warehouse_id = w_req.id
      LEFT JOIN warehouses w_src ON sr.source_warehouse_id = w_src.id
      LEFT JOIN stock_request_items sri ON sr.id = sri.stock_request_id
      WHERE sr.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND sr.status = ?';
      params.push(status);
    }

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND (sr.requesting_warehouse_id = ? OR sr.source_warehouse_id = ?)';
      params.push(warehouse_id, warehouse_id);
    }

    if (date_from) {
      query += ' AND sr.request_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      query += ' AND sr.request_date <= ?';
      params.push(date_to);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (sr.request_number LIKE ? OR sr.requested_by_name LIKE ? OR sr.notes LIKE ?)';
      params.push(s, s, s);
    }

    query += ' GROUP BY sr.id ORDER BY sr.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get single stock request by ID with line items
   */
  static async getById(id, restaurantId) {
    const [headerRows] = await pool.execute(`
      SELECT 
        sr.*,
        w_req.name as requesting_warehouse_name,
        w_req.code as requesting_warehouse_code,
        w_src.name as source_warehouse_name,
        w_src.code as source_warehouse_code
      FROM stock_requests sr
      LEFT JOIN warehouses w_req ON sr.requesting_warehouse_id = w_req.id
      LEFT JOIN warehouses w_src ON sr.source_warehouse_id = w_src.id
      WHERE sr.id = ? AND sr.restaurant_id = ?
    `, [id, restaurantId]);

    if (headerRows.length === 0) return null;

    const request = headerRows[0];

    // Fetch line items with live available stock from source warehouse
    const [items] = await pool.execute(`
      SELECT 
        sri.*,
        mi.sku,
        mi.item_code,
        mi.price,
        COALESCE(ws.current_stock, 0.000) as live_source_stock,
        GREATEST(0, COALESCE(ws.current_stock, 0.000) - COALESCE(ws.reserved_stock, 0.000)) as live_source_available
      FROM stock_request_items sri
      JOIN menu_items mi ON sri.menu_item_id = mi.id
      LEFT JOIN warehouse_stocks ws ON sri.menu_item_id = ws.menu_item_id 
           AND ws.warehouse_id = ? AND ws.restaurant_id = ?
      WHERE sri.stock_request_id = ?
      ORDER BY sri.id ASC
    `, [request.source_warehouse_id, restaurantId, id]);

    request.items = items;
    return request;
  }

  /**
   * Create a new stock request
   * CRITICAL: Creating a request NEVER deducts physical inventory.
   */
  static async create(restaurantId, userId, userName, data) {
    const {
      request_date,
      requesting_warehouse_id,
      source_warehouse_id,
      notes,
      items,
      is_draft = false
    } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Stock request must contain at least one item.');
    }

    if (parseInt(requesting_warehouse_id) === parseInt(source_warehouse_id)) {
      throw new Error('Requesting warehouse and source warehouse cannot be the same.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Generate sequence number SR-YYYYMMDD-XXXX
      const effectiveDate = request_date || getISTDateString();
      const today = effectiveDate.replace(/-/g, '');
      const prefix = `SR-${today}-`;

      const [seqRows] = await connection.execute(
        'SELECT request_number FROM stock_requests WHERE restaurant_id = ? AND request_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].request_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const requestNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      const status = is_draft ? 'draft' : 'pending';

      const [result] = await connection.execute(`
        INSERT INTO stock_requests (
          restaurant_id, request_number, request_date,
          requesting_warehouse_id, source_warehouse_id,
          requested_by_user_id, requested_by_name,
          status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, requestNumber, effectiveDate,
        requesting_warehouse_id, source_warehouse_id,
        userId, userName || 'Staff',
        status, notes || null
      ]);

      const requestId = result.insertId;

      // Insert line items with snapshot of available stock
      for (const item of items) {
        const menuItemId = item.menu_item_id || item.id;
        const reqQty = parseFloat(item.requested_qty || item.quantity) || 0;

        // Fetch current available stock at source
        const [stockRows] = await connection.execute(
          'SELECT current_stock, reserved_stock FROM warehouse_stocks WHERE warehouse_id = ? AND menu_item_id = ? AND restaurant_id = ?',
          [source_warehouse_id, menuItemId, restaurantId]
        );

        const cur = stockRows.length > 0 ? parseFloat(stockRows[0].current_stock || 0) : 0;
        const res = stockRows.length > 0 ? parseFloat(stockRows[0].reserved_stock || 0) : 0;
        const avail = Math.max(0, cur - res);

        await connection.execute(`
          INSERT INTO stock_request_items (
            stock_request_id, menu_item_id, item_name, unit,
            requested_qty, available_qty, approved_qty, notes
          ) VALUES (?, ?, ?, ?, ?, ?, 0.000, ?)
        `, [
          requestId, menuItemId, item.name || item.item_name,
          item.unit || 'pcs', reqQty, avail, item.notes || null
        ]);
      }

      await connection.commit();
      return this.getById(requestId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Review and approve/partially approve stock request
   */
  static async approve(id, restaurantId, userId, userName, approvalData) {
    const { items, approval_notes } = approvalData;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [reqRows] = await connection.execute(
        'SELECT * FROM stock_requests WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [id, restaurantId]
      );

      if (reqRows.length === 0) throw new Error('Stock request not found.');

      const req = reqRows[0];
      if (req.status !== 'pending' && req.status !== 'draft') {
        throw new Error(`Cannot approve request in "${req.status}" state.`);
      }

      let allFull = true;
      let totalApproved = 0;

      if (items && Array.isArray(items)) {
        for (const it of items) {
          const approvedQty = parseFloat(it.approved_qty) || 0;
          const reqQty = parseFloat(it.requested_qty) || 0;
          const rejectedQty = Math.max(0, reqQty - approvedQty);

          if (approvedQty < reqQty) allFull = false;
          totalApproved += approvedQty;

          await connection.execute(`
            UPDATE stock_request_items 
            SET approved_qty = ?, rejected_qty = ?, notes = COALESCE(?, notes)
            WHERE id = ? AND stock_request_id = ?
          `, [approvedQty, rejectedQty, it.notes || null, it.id, id]);
        }
      }

      const finalStatus = totalApproved === 0 ? 'rejected' : (allFull ? 'approved' : 'partially_approved');

      await connection.execute(`
        UPDATE stock_requests SET
          status = ?,
          approved_by_user_id = ?,
          approved_by_name = ?,
          approved_at = NOW(),
          approval_notes = COALESCE(?, approval_notes),
          updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [finalStatus, userId, userName, approval_notes || null, id, restaurantId]);

      await connection.commit();
      return this.getById(id, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Reject a stock request
   */
  static async reject(id, restaurantId, userId, userName, reason) {
    const [result] = await pool.execute(`
      UPDATE stock_requests SET
        status = 'rejected',
        approved_by_user_id = ?,
        approved_by_name = ?,
        approved_at = NOW(),
        approval_notes = ?,
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ? AND status IN ('pending', 'draft')
    `, [userId, userName, reason || 'Rejected by approver', id, restaurantId]);

    if (result.affectedRows === 0) {
      throw new Error('Stock request not found or not in pending state.');
    }

    return this.getById(id, restaurantId);
  }
}

module.exports = StockRequestRepository;
