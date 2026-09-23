const pool = require('../config/db');
const StockMovementService = require('../services/stock_movement_service');
const { getISTDateString } = require('../utils/date_utils');

class StockAdjustmentRepository {
  /**
   * Fetch all stock adjustments
   */
  static async getAll(restaurantId, filters = {}) {
    const { warehouse_id, date_from, date_to, search } = filters;

    let query = `
      SELECT 
        sa.*,
        w.name as warehouse_name,
        w.code as warehouse_code,
        COUNT(sai.id) as total_items
      FROM stock_adjustments sa
      LEFT JOIN warehouses w ON sa.warehouse_id = w.id
      LEFT JOIN stock_adjustment_items sai ON sa.id = sai.stock_adjustment_id
      WHERE sa.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND sa.warehouse_id = ?';
      params.push(warehouse_id);
    }

    if (date_from) {
      query += ' AND sa.adjustment_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      query += ' AND sa.adjustment_date <= ?';
      params.push(date_to);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (sa.adjustment_number LIKE ? OR sa.reason LIKE ? OR sa.created_by_name LIKE ?)';
      params.push(s, s, s);
    }

    query += ' GROUP BY sa.id ORDER BY sa.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get stock adjustment by ID with items
   */
  static async getById(id, restaurantId) {
    const [headerRows] = await pool.execute(`
      SELECT 
        sa.*,
        w.name as warehouse_name,
        w.code as warehouse_code
      FROM stock_adjustments sa
      LEFT JOIN warehouses w ON sa.warehouse_id = w.id
      WHERE sa.id = ? AND sa.restaurant_id = ?
    `, [id, restaurantId]);

    if (headerRows.length === 0) return null;

    const adj = headerRows[0];

    const [items] = await pool.execute(`
      SELECT 
        sai.*,
        mi.sku,
        mi.item_code
      FROM stock_adjustment_items sai
      JOIN menu_items mi ON sai.menu_item_id = mi.id
      WHERE sai.stock_adjustment_id = ?
      ORDER BY sai.id ASC
    `, [id]);

    adj.items = items;
    return adj;
  }

  /**
   * Create Stock Adjustment
   * ATOMICALLY updates inventory in warehouse and records movements in ledger.
   */
  static async create(restaurantId, userId, userName, data) {
    const {
      warehouse_id,
      adjustment_date,
      reason = 'Physical Stock Correction',
      notes,
      items
    } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Stock adjustment must contain at least one item.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const effectiveDate = adjustment_date || getISTDateString();
      const today = effectiveDate.replace(/-/g, '');
      const prefix = `ADJ-${today}-`;

      const [seqRows] = await connection.execute(
        'SELECT adjustment_number FROM stock_adjustments WHERE restaurant_id = ? AND adjustment_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].adjustment_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const adjustmentNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      const [result] = await connection.execute(`
        INSERT INTO stock_adjustments (
          restaurant_id, adjustment_number, warehouse_id,
          adjustment_date, reason, created_by_user_id,
          created_by_name, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, adjustmentNumber, warehouse_id,
        effectiveDate,
        reason, userId, userName || 'Staff', notes || null
      ]);

      const adjId = result.insertId;

      for (const it of items) {
        const menuItemId = it.menu_item_id || it.id;
        const adjType = it.adjustment_type || 'set'; // 'add', 'reduce', 'set'
        const qty = parseFloat(it.quantity) || 0;
        const unitCost = parseFloat(it.unit_cost || it.price || 0);

        const rackId = it.rack_id || null;

        // Fetch current stock from rack if rack_id specified, otherwise from warehouse
        let prevStock = 0;
        if (rackId) {
          const [prsRows] = await connection.execute(
            'SELECT current_stock FROM product_rack_stocks WHERE warehouse_id = ? AND rack_id = ? AND menu_item_id = ? AND restaurant_id = ? FOR UPDATE',
            [warehouse_id, rackId, menuItemId, restaurantId]
          );
          prevStock = prsRows.length > 0 ? parseFloat(prsRows[0].current_stock || 0) : 0;
        } else {
          const [wsRows] = await connection.execute(
            'SELECT current_stock FROM warehouse_stocks WHERE warehouse_id = ? AND menu_item_id = ? AND restaurant_id = ? FOR UPDATE',
            [warehouse_id, menuItemId, restaurantId]
          );
          prevStock = wsRows.length > 0 ? parseFloat(wsRows[0].current_stock || 0) : 0;
        }

        let diff = 0;
        let newStock = prevStock;

        if (adjType === 'add') {
          diff = qty;
          newStock = prevStock + qty;
        } else if (adjType === 'reduce') {
          diff = -qty;
          newStock = Math.max(0, prevStock - qty);
        } else if (adjType === 'set') {
          newStock = Math.max(0, qty);
          diff = newStock - prevStock;
        }

        let itemName = it.item_name || it.name || null;
        if (!itemName) {
          const [mRows] = await connection.execute('SELECT name FROM menu_items WHERE id = ?', [menuItemId]);
          itemName = mRows[0]?.name || `Item #${menuItemId}`;
        }

        await connection.execute(`
          INSERT INTO stock_adjustment_items (
            stock_adjustment_id, menu_item_id, item_name, unit,
            adjustment_type, quantity, previous_stock, new_stock, unit_cost, rack_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          adjId, menuItemId, itemName,
          it.unit || 'pcs', adjType, qty, prevStock, newStock, unitCost, rackId
        ]);

        if (diff !== 0) {
          let ledgerTxType = diff > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
          const rLower = (reason || '').toLowerCase();
          if (rLower.includes('damage')) ledgerTxType = 'DAMAGE';
          else if (rLower.includes('expir')) ledgerTxType = 'EXPIRED';

          await StockMovementService.recordMovement(connection, {
            restaurantId,
            warehouseId: warehouse_id,
            rackId,
            menuItemId,
            type: ledgerTxType,
            quantity: diff,
            unitCost,
            referenceType: 'stock_adjustment',
            referenceId: adjId,
            referenceNumber: adjustmentNumber,
            userId,
            userName,
            notes: `${reason} (${adjustmentNumber})`
          });
        }
      }

      await connection.commit();
      return this.getById(adjId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = StockAdjustmentRepository;
