const pool = require('../config/db');

class InventoryRepository {
  /**
   * Fetch inventory stock report for a restaurant
   */
  static async getStockReport(restaurantId, { categoryId, search, status } = {}) {
    let query = `
      SELECT 
        mi.id,
        mi.name,
        mi.sku,
        mi.price,
        COALESCE(c.name, 'Uncategorized') as category_name,
        mi.category_id,
        COALESCE(mi.unit, 'pcs') as unit,
        COALESCE(mi.is_weight_based, 0) as is_weight_based,
        COALESCE(ws.total_current_stock, mi.current_stock, 0.000) as current_stock,
        COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0.000) as reserved_stock,
        GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0.000) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0.000)) as available_stock,
        COALESCE(mi.low_stock_threshold, 10.000) as low_stock_threshold,
        COALESCE(mi.track_inventory, 1) as track_inventory,
        mi.barcode_image_url,
        mi.updated_at,
        CASE
          WHEN GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) <= 0 THEN 'out_of_stock'
          WHEN GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) <= COALESCE(mi.low_stock_threshold, 10) THEN 'low_stock'
          ELSE 'in_stock'
        END as stock_status
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      LEFT JOIN (
        SELECT menu_item_id, 
               SUM(COALESCE(current_stock, 0)) as total_current_stock, 
               SUM(COALESCE(reserved_stock, 0)) as total_reserved_stock
        FROM warehouse_stocks
        WHERE restaurant_id = ?
        GROUP BY menu_item_id
      ) ws ON mi.id = ws.menu_item_id
      WHERE mi.restaurant_id = ?
    `;

    const params = [restaurantId, restaurantId];

    if (categoryId && categoryId !== 'all') {
      query += ' AND mi.category_id = ?';
      params.push(categoryId);
    }

    if (search && search.trim()) {
      query += ' AND (mi.name LIKE ? OR mi.sku LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status === 'out_of_stock') {
      query += ' AND GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) <= 0';
    } else if (status === 'low_stock') {
      query += ' AND GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) > 0 AND GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) <= COALESCE(mi.low_stock_threshold, 10)';
    } else if (status === 'in_stock') {
      query += ' AND GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) > COALESCE(mi.low_stock_threshold, 10)';
    }

    query += ' ORDER BY stock_status ASC, mi.name ASC';

    const [rows] = await pool.execute(query, params);

    // Compute summary metrics across all tracked items for dashboard alert counters
    const [summaryRows] = await pool.execute(`
      SELECT 
        COUNT(mi.id) as total_items,
        SUM(CASE WHEN GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) > COALESCE(mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as in_stock_count,
        SUM(CASE WHEN GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) > 0 AND GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) <= COALESCE(mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN GREATEST(0, COALESCE(ws.total_current_stock, mi.current_stock, 0) - COALESCE(ws.total_reserved_stock, mi.reserved_stock, 0)) <= 0 THEN 1 ELSE 0 END) as out_of_stock_count
      FROM menu_items mi
      LEFT JOIN (
        SELECT menu_item_id, 
               SUM(COALESCE(current_stock, 0)) as total_current_stock, 
               SUM(COALESCE(reserved_stock, 0)) as total_reserved_stock
        FROM warehouse_stocks
        WHERE restaurant_id = ?
        GROUP BY menu_item_id
      ) ws ON mi.id = ws.menu_item_id
      WHERE mi.restaurant_id = ?
    `, [restaurantId, restaurantId]);

    return {
      items: rows,
      summary: summaryRows[0] || { total_items: 0, in_stock_count: 0, low_stock_count: 0, out_of_stock_count: 0 }
    };
  }

  /**
   * Adjust stock for a menu item targeting a specific warehouse, syncing aggregates and recording audit trail
   */
  static async adjustStock(restaurantId, { menuItemId, warehouseId, userId, userName, adjustmentType, quantity, unit, lowStockThreshold, reason }) {
    const qtyNum = parseFloat(quantity) || 0;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Resolve target warehouse
      let targetWhId = warehouseId;
      if (!targetWhId) {
        const [activeWhs] = await connection.execute(
          'SELECT id, name FROM warehouses WHERE restaurant_id = ? AND status = "active" ORDER BY is_default DESC, id ASC',
          [restaurantId]
        );
        if (activeWhs.length === 1) {
          targetWhId = activeWhs[0].id;
        } else if (activeWhs.length === 0) {
          throw new Error('No active warehouse found for this business.');
        } else {
          throw new Error('Please select a specific warehouse/outlet for this stock adjustment.');
        }
      }

      // Verify warehouse exists and belongs to restaurant
      const [whRows] = await connection.execute(
        'SELECT id, name FROM warehouses WHERE id = ? AND restaurant_id = ?',
        [targetWhId, restaurantId]
      );
      if (whRows.length === 0) {
        throw new Error('Selected warehouse not found.');
      }
      const warehouseName = whRows[0].name;

      // 2. Fetch & lock menu item
      const [itemRows] = await connection.execute(
        'SELECT id, name, current_stock, low_stock_threshold, unit FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [menuItemId, restaurantId]
      );
      if (itemRows.length === 0) {
        throw new Error('Menu item not found.');
      }

      const item = itemRows[0];
      const updatedUnit = unit || item.unit || 'pcs';
      const updatedThreshold = lowStockThreshold !== undefined && lowStockThreshold !== '' ? parseFloat(lowStockThreshold) : parseFloat(item.low_stock_threshold || 10);

      // 3. Fetch & lock warehouse_stocks record
      let [whStockRows] = await connection.execute(
        'SELECT current_stock, reserved_stock, min_stock FROM warehouse_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ? FOR UPDATE',
        [restaurantId, targetWhId, menuItemId]
      );

      let prevStock = 0;
      if (whStockRows.length === 0) {
        await connection.execute(
          `INSERT INTO warehouse_stocks (restaurant_id, warehouse_id, menu_item_id, current_stock, reserved_stock, min_stock, reorder_level)
           VALUES (?, ?, ?, 0.000, 0.000, ?, 5.000)
           ON DUPLICATE KEY UPDATE current_stock = current_stock`,
          [restaurantId, targetWhId, menuItemId, updatedThreshold]
        );
        prevStock = 0;
      } else {
        prevStock = parseFloat(whStockRows[0].current_stock || 0);
      }

      let newStock = prevStock;
      let qtyDiff = 0;

      if (adjustmentType === 'add') {
        newStock = prevStock + qtyNum;
        qtyDiff = qtyNum;
      } else if (adjustmentType === 'reduce') {
        newStock = Math.max(0, prevStock - qtyNum);
        qtyDiff = -(prevStock - newStock);
      } else if (adjustmentType === 'set') {
        newStock = Math.max(0, qtyNum);
        qtyDiff = newStock - prevStock;
      }

      // 4. Update warehouse_stocks
      await connection.execute(
        'UPDATE warehouse_stocks SET current_stock = ?, min_stock = ?, updated_at = NOW() WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
        [newStock, updatedThreshold, restaurantId, targetWhId, menuItemId]
      );

      // 4b. Sync product_rack_stocks if rack exists
      const [racks] = await connection.execute(
        'SELECT id, rack_code FROM warehouse_racks WHERE warehouse_id = ? AND restaurant_id = ? ORDER BY id ASC LIMIT 1',
        [targetWhId, restaurantId]
      );
      if (racks.length > 0) {
        const defaultRackId = racks[0].id;
        const [prs] = await connection.execute(
          'SELECT current_stock FROM product_rack_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ? FOR UPDATE',
          [restaurantId, targetWhId, defaultRackId, menuItemId]
        );
        const prevRackStock = prs.length > 0 ? parseFloat(prs[0].current_stock || 0) : 0;
        const newRackStock = Math.max(0, prevRackStock + qtyDiff);
        await connection.execute(
          `INSERT INTO product_rack_stocks (restaurant_id, warehouse_id, rack_id, menu_item_id, current_stock)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE current_stock = VALUES(current_stock), updated_at = NOW()`,
          [restaurantId, targetWhId, defaultRackId, menuItemId, newRackStock]
        );
      }

      // 5. Keep menu_items.current_stock & reserved_stock synchronized (live sum across all warehouses)
      const [aggRows] = await connection.execute(
        `SELECT COALESCE(SUM(current_stock), 0) as total_stock, COALESCE(SUM(reserved_stock), 0) as total_reserved
         FROM warehouse_stocks
         WHERE restaurant_id = ? AND menu_item_id = ?`,
        [restaurantId, menuItemId]
      );
      const totalAggStock = parseFloat(aggRows[0]?.total_stock || 0);
      const totalAggReserved = parseFloat(aggRows[0]?.total_reserved || 0);

      await connection.execute(
        `UPDATE menu_items 
         SET current_stock = ?, reserved_stock = ?, unit = ?, low_stock_threshold = ?, updated_at = NOW()
         WHERE id = ? AND restaurant_id = ?`,
        [totalAggStock, totalAggReserved, updatedUnit, updatedThreshold, menuItemId, restaurantId]
      );

      // 6. Record immutable stock_transactions ledger entry
      const txType = qtyDiff >= 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      await connection.execute(
        `INSERT INTO stock_transactions (
          restaurant_id, warehouse_id, menu_item_id, transaction_type,
          quantity, previous_stock, new_stock, unit_cost, total_cost,
          reference_type, reference_number, user_id, user_name, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, 0.00, 'MANUAL_ADJUSTMENT', ?, ?, ?, ?, NOW())`,
        [
          restaurantId, targetWhId, menuItemId, txType,
          Math.abs(qtyDiff), prevStock, newStock,
          `ADJ-${Date.now()}`,
          userId || null, userName || 'System',
          reason ? `${reason} (Target: ${warehouseName})` : `Manual Stock Adjustment (${warehouseName})`
        ]
      );

      // 7. Insert legacy stock_logs for audit trail
      await connection.execute(
        `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          restaurantId, menuItemId, userId || null, userName || 'System',
          adjustmentType, qtyNum, prevStock, newStock,
          reason ? `${reason} [${warehouseName}]` : `Manual adjustment in ${warehouseName}`
        ]
      );

      await connection.commit();
      return {
        warehouseId: targetWhId,
        warehouseName,
        prevStock,
        newStock,
        current_stock: totalAggStock,
        warehouse_stock: newStock,
        unit: updatedUnit,
        low_stock_threshold: updatedThreshold
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Fetch audit logs for stock adjustments
   */
  static async getStockLogs(restaurantId, menuItemId = null, limit = 50) {
    let query = `
      SELECT 
        sl.id,
        sl.menu_item_id,
        mi.name as item_name,
        mi.sku,
        sl.user_name,
        sl.adjustment_type,
        sl.quantity,
        sl.previous_stock,
        sl.new_stock,
        sl.reason,
        sl.created_at
      FROM stock_logs sl
      JOIN menu_items mi ON sl.menu_item_id = mi.id
      WHERE sl.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (menuItemId) {
      query += ' AND sl.menu_item_id = ?';
      params.push(menuItemId);
    }

    query += ` ORDER BY sl.created_at DESC LIMIT ${parseInt(limit) || 50}`;

    const [rows] = await pool.execute(query, params);
    return rows;
  }
}

module.exports = InventoryRepository;
