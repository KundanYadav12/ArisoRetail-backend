const pool = require('../config/db');

class StockLedgerRepository {
  /**
   * Fetch paginated and filtered stock ledger transactions
   */
  static async getLedger(restaurantId, filters = {}) {
    const {
      warehouse_id,
      menu_item_id,
      transaction_type,
      date_from,
      date_to,
      search,
      limit = 50,
      offset = 0
    } = filters;

    let query = `
      SELECT 
        st.id,
        st.restaurant_id,
        st.warehouse_id,
        w.name as warehouse_name,
        w.code as warehouse_code,
        st.menu_item_id,
        mi.name as item_name,
        mi.sku,
        mi.item_code,
        COALESCE(mi.unit, 'pcs') as unit,
        st.transaction_type,
        st.quantity,
        st.previous_stock,
        st.new_stock,
        st.unit_cost,
        st.total_cost,
        st.reference_type,
        st.reference_id,
        st.reference_number,
        st.user_id,
        st.user_name,
        st.notes,
        st.created_at
      FROM stock_transactions st
      LEFT JOIN warehouses w ON st.warehouse_id = w.id
      LEFT JOIN menu_items mi ON st.menu_item_id = mi.id
      WHERE st.restaurant_id = ?
    `;

    let countQuery = 'SELECT COUNT(st.id) as total FROM stock_transactions st LEFT JOIN menu_items mi ON st.menu_item_id = mi.id WHERE st.restaurant_id = ?';
    const params = [restaurantId];
    const countParams = [restaurantId];

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND st.warehouse_id = ?';
      countQuery += ' AND st.warehouse_id = ?';
      params.push(warehouse_id);
      countParams.push(warehouse_id);
    }

    if (menu_item_id) {
      query += ' AND st.menu_item_id = ?';
      countQuery += ' AND st.menu_item_id = ?';
      params.push(menu_item_id);
      countParams.push(menu_item_id);
    }

    if (transaction_type && transaction_type !== 'all') {
      query += ' AND st.transaction_type = ?';
      countQuery += ' AND st.transaction_type = ?';
      params.push(transaction_type);
      countParams.push(transaction_type);
    }

    if (date_from) {
      query += ' AND DATE(st.created_at) >= ?';
      countQuery += ' AND DATE(st.created_at) >= ?';
      params.push(date_from);
      countParams.push(date_from);
    }

    if (date_to) {
      query += ' AND DATE(st.created_at) <= ?';
      countQuery += ' AND DATE(st.created_at) <= ?';
      params.push(date_to);
      countParams.push(date_to);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (mi.name LIKE ? OR mi.sku LIKE ? OR st.reference_number LIKE ? OR st.user_name LIKE ?)';
      countQuery += ' AND (mi.name LIKE ? OR mi.sku LIKE ? OR st.reference_number LIKE ? OR st.user_name LIKE ?)';
      params.push(s, s, s, s);
      countParams.push(s, s, s, s);
    }

    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    query += ` ORDER BY st.created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await pool.execute(query, params);
    const [countRows] = await pool.execute(countQuery, countParams);

    return {
      transactions: rows,
      total: countRows[0]?.total || 0,
      limit: safeLimit,
      offset: safeOffset
    };
  }

  /**
   * Fetch comprehensive Inventory Dashboard Metrics
   */
  static async getDashboardMetrics(restaurantId, warehouseId = null) {
    const isFiltered = warehouseId && warehouseId !== 'all';

    // 1. Total Products
    const [prodRows] = await pool.execute(
      'SELECT COUNT(id) as total_products FROM menu_items WHERE restaurant_id = ?',
      [restaurantId]
    );

    // 2. Total Warehouses
    const [whRows] = await pool.execute(
      'SELECT COUNT(id) as total_warehouses FROM warehouses WHERE restaurant_id = ? AND status = "active"',
      [restaurantId]
    );

    // 3. Stock Valuation & Inventory Counts
    let stockSql;
    let stockParams;

    if (isFiltered) {
      stockSql = `
        SELECT 
          COALESCE(SUM(ws.current_stock * mi.price), 0) as total_valuation,
          COALESCE(SUM(ws.current_stock), 0) as total_stock_units,
          SUM(CASE WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) > COALESCE(ws.min_stock, mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as in_stock_count,
          SUM(CASE WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) > 0 AND GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= COALESCE(ws.min_stock, mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as low_stock_count,
          SUM(CASE WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= 0 THEN 1 ELSE 0 END) as out_of_stock_count
        FROM menu_items mi
        LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND ws.warehouse_id = ? AND ws.restaurant_id = mi.restaurant_id
        WHERE mi.restaurant_id = ?
      `;
      stockParams = [warehouseId, restaurantId];
    } else {
      stockSql = `
        SELECT 
          COALESCE(SUM(mi.current_stock * mi.price), 0) as total_valuation,
          COALESCE(SUM(mi.current_stock), 0) as total_stock_units,
          SUM(CASE WHEN GREATEST(0, COALESCE(mi.current_stock, 0) - COALESCE(mi.reserved_stock, 0)) > COALESCE(mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as in_stock_count,
          SUM(CASE WHEN GREATEST(0, COALESCE(mi.current_stock, 0) - COALESCE(mi.reserved_stock, 0)) > 0 AND GREATEST(0, COALESCE(mi.current_stock, 0) - COALESCE(mi.reserved_stock, 0)) <= COALESCE(mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as low_stock_count,
          SUM(CASE WHEN GREATEST(0, COALESCE(mi.current_stock, 0) - COALESCE(mi.reserved_stock, 0)) <= 0 THEN 1 ELSE 0 END) as out_of_stock_count
        FROM menu_items mi
        WHERE mi.restaurant_id = ?
      `;
      stockParams = [restaurantId];
    }

    const [stockRows] = await pool.execute(stockSql, stockParams);

    // 4. Pending Stock Requests
    let reqSql = 'SELECT COUNT(id) as count FROM stock_requests WHERE restaurant_id = ? AND status IN ("pending", "processing")';
    const reqParams = [restaurantId];
    if (isFiltered) {
      reqSql += ' AND (requesting_warehouse_id = ? OR source_warehouse_id = ?)';
      reqParams.push(warehouseId, warehouseId);
    }
    const [reqRows] = await pool.execute(reqSql, reqParams);

    // 5. In-Transit Transfers
    let transSql = 'SELECT COUNT(id) as count FROM stock_transfers WHERE restaurant_id = ? AND status IN ("in_transit", "partially_received")';
    const transParams = [restaurantId];
    if (isFiltered) {
      transSql += ' AND (destination_warehouse_id = ? OR source_warehouse_id = ?)';
      transParams.push(warehouseId, warehouseId);
    }
    const [transRows] = await pool.execute(transSql, transParams);

    // 6. Pending Purchase Orders
    let poSql = 'SELECT COUNT(id) as count FROM purchase_orders WHERE restaurant_id = ? AND status IN ("pending", "approved")';
    const poParams = [restaurantId];
    if (isFiltered) {
      poSql += ' AND warehouse_id = ?';
      poParams.push(warehouseId);
    }
    const [poRows] = await pool.execute(poSql, poParams);

    // 7. Recent 5 movements
    const [recentRows] = await pool.execute(`
      SELECT 
        st.id,
        st.transaction_type,
        st.quantity,
        st.new_stock,
        st.reference_number,
        st.created_at,
        mi.name as item_name,
        w.name as warehouse_name
      FROM stock_transactions st
      JOIN menu_items mi ON st.menu_item_id = mi.id
      JOIN warehouses w ON st.warehouse_id = w.id
      WHERE st.restaurant_id = ?
      ORDER BY st.created_at DESC
      LIMIT 6
    `, [restaurantId]);

    return {
      total_products: prodRows[0]?.total_products || 0,
      total_warehouses: whRows[0]?.total_warehouses || 0,
      total_valuation: parseFloat(stockRows[0]?.total_valuation || 0),
      total_stock_units: parseFloat(stockRows[0]?.total_stock_units || 0),
      in_stock_count: parseInt(stockRows[0]?.in_stock_count || 0),
      low_stock_count: parseInt(stockRows[0]?.low_stock_count || 0),
      out_of_stock_count: parseInt(stockRows[0]?.out_of_stock_count || 0),
      pending_stock_requests: parseInt(reqRows[0]?.count || 0),
      in_transit_transfers: parseInt(transRows[0]?.count || 0),
      pending_purchase_orders: parseInt(poRows[0]?.count || 0),
      recent_movements: recentRows
    };
  }
}

module.exports = StockLedgerRepository;
