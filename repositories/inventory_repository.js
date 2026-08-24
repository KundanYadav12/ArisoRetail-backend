const pool = require('../config/db');

class InventoryRepository {
  /**
   * Fetch inventory stock report for a restaurant
   */
  static async getStockReport(restaurantId, { categoryId, search, status }) {
    let query = `
      SELECT 
        mi.id,
        mi.name,
        mi.sku,
        mi.price,
        COALESCE(c.name, 'Uncategorized') as category_name,
        mi.category_id,
        COALESCE(mi.unit, 'pcs') as unit,
        COALESCE(mi.current_stock, 100.00) as current_stock,
        COALESCE(mi.low_stock_threshold, 10.00) as low_stock_threshold,
        COALESCE(mi.track_inventory, 1) as track_inventory,
        mi.updated_at,
        CASE
          WHEN COALESCE(mi.current_stock, 0) <= 0 THEN 'out_of_stock'
          WHEN COALESCE(mi.current_stock, 0) <= COALESCE(mi.low_stock_threshold, 10) THEN 'low_stock'
          ELSE 'in_stock'
        END as stock_status
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      WHERE mi.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (categoryId && categoryId !== 'all') {
      query += ' AND mi.category_id = ?';
      params.push(categoryId);
    }

    if (search && search.trim()) {
      query += ' AND (mi.name LIKE ? OR mi.sku LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (status === 'out_of_stock') {
      query += ' AND COALESCE(mi.current_stock, 0) <= 0';
    } else if (status === 'low_stock') {
      query += ' AND COALESCE(mi.current_stock, 0) > 0 AND COALESCE(mi.current_stock, 0) <= COALESCE(mi.low_stock_threshold, 10)';
    } else if (status === 'in_stock') {
      query += ' AND COALESCE(mi.current_stock, 0) > COALESCE(mi.low_stock_threshold, 10)';
    }

    query += ' ORDER BY stock_status ASC, mi.name ASC';

    const [rows] = await pool.execute(query, params);

    // Compute summary metrics across all tracked items for dashboard alert counters
    const [summaryRows] = await pool.execute(`
      SELECT 
        COUNT(id) as total_items,
        SUM(CASE WHEN COALESCE(current_stock, 0) > COALESCE(low_stock_threshold, 10) THEN 1 ELSE 0 END) as in_stock_count,
        SUM(CASE WHEN COALESCE(current_stock, 0) > 0 AND COALESCE(current_stock, 0) <= COALESCE(low_stock_threshold, 10) THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN COALESCE(current_stock, 0) <= 0 THEN 1 ELSE 0 END) as out_of_stock_count
      FROM menu_items
      WHERE restaurant_id = ?
    `, [restaurantId]);

    return {
      items: rows,
      summary: summaryRows[0] || { total_items: 0, in_stock_count: 0, low_stock_count: 0, out_of_stock_count: 0 }
    };
  }

  /**
   * Adjust stock for a menu item and record audit trail log
   */
  static async adjustStock(restaurantId, { menuItemId, userId, userName, adjustmentType, quantity, unit, lowStockThreshold, reason }) {
    const qtyNum = parseFloat(quantity) || 0;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Fetch current stock
      const [itemRows] = await connection.execute(
        'SELECT current_stock, low_stock_threshold, unit FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [menuItemId, restaurantId]
      );

      if (itemRows.length === 0) {
        throw new Error('Menu item not found.');
      }

      const prevStock = parseFloat(itemRows[0].current_stock || 0);
      let newStock = prevStock;

      if (adjustmentType === 'add') {
        newStock = prevStock + qtyNum;
      } else if (adjustmentType === 'reduce') {
        newStock = Math.max(0, prevStock - qtyNum);
      } else if (adjustmentType === 'set') {
        newStock = Math.max(0, qtyNum);
      }

      const updatedUnit = unit || itemRows[0].unit || 'pcs';
      const updatedThreshold = lowStockThreshold !== undefined && lowStockThreshold !== '' ? parseFloat(lowStockThreshold) : parseFloat(itemRows[0].low_stock_threshold || 10);

      // Update menu_items
      await connection.execute(
        'UPDATE menu_items SET current_stock = ?, unit = ?, low_stock_threshold = ? WHERE id = ? AND restaurant_id = ?',
        [newStock, updatedUnit, updatedThreshold, menuItemId, restaurantId]
      );

      // Insert stock_logs record
      await connection.execute(
        `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [restaurantId, menuItemId, userId || null, userName || 'System', adjustmentType, qtyNum, prevStock, newStock, reason || 'Manual Stock Adjustment']
      );

      await connection.commit();
      return { prevStock, newStock, current_stock: newStock, unit: updatedUnit, low_stock_threshold: updatedThreshold };

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
