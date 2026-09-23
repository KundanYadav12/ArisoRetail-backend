const pool = require('../config/db');

class StockReconciliationService {
  /**
   * Validate Stock Tally consistency:
   * 1. Total Menu Item Stock == SUM(Warehouse Stocks)
   * 2. Warehouse Stock == SUM(Product Rack Stocks)
   */
  static async validateStockTally(restaurantId, warehouseId = null) {
    // 1. Warehouse vs Menu Items Stock check
    let whQuery = `
      SELECT 
        mi.id AS menu_item_id,
        mi.name AS product_name,
        mi.sku,
        mi.barcode,
        mi.item_code,
        mi.current_stock AS menu_item_stock,
        COALESCE(SUM(ws.current_stock), 0) AS total_warehouse_stock,
        (mi.current_stock - COALESCE(SUM(ws.current_stock), 0)) AS variance
      FROM menu_items mi
      LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND ws.restaurant_id = mi.restaurant_id
      WHERE mi.restaurant_id = ?
      GROUP BY mi.id, mi.name, mi.sku, mi.barcode, mi.item_code, mi.current_stock
    `;
    const [whRows] = await pool.execute(whQuery, [restaurantId]);

    const globalDiscrepancies = whRows
      .filter(r => Math.abs(parseFloat(r.variance || 0)) > 0.001)
      .map(r => ({
        menu_item_id: r.menu_item_id,
        product_name: r.product_name,
        sku: r.sku,
        barcode: r.barcode,
        system_total_stock: parseFloat(r.menu_item_stock || 0),
        warehouse_sum_stock: parseFloat(r.total_warehouse_stock || 0),
        discrepancy: parseFloat(r.variance || 0)
      }));

    // 2. Warehouse vs Rack Stocks check
    let rackQuery = `
      SELECT 
        ws.warehouse_id,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        ws.menu_item_id,
        mi.name AS product_name,
        mi.sku,
        mi.barcode,
        ws.current_stock AS warehouse_stock,
        COALESCE(SUM(prs.current_stock), 0) AS total_rack_stock,
        (ws.current_stock - COALESCE(SUM(prs.current_stock), 0)) AS variance
      FROM warehouse_stocks ws
      JOIN warehouses w ON ws.warehouse_id = w.id
      JOIN menu_items mi ON ws.menu_item_id = mi.id
      LEFT JOIN product_rack_stocks prs ON (
        prs.restaurant_id = ws.restaurant_id 
        AND prs.warehouse_id = ws.warehouse_id 
        AND prs.menu_item_id = ws.menu_item_id
      )
      WHERE ws.restaurant_id = ?
    `;
    const rackParams = [restaurantId];

    if (warehouseId && warehouseId !== 'all') {
      rackQuery += ' AND ws.warehouse_id = ?';
      rackParams.push(warehouseId);
    }

    rackQuery += ' GROUP BY ws.warehouse_id, w.name, w.code, ws.menu_item_id, mi.name, mi.sku, mi.barcode, ws.current_stock';

    const [rackRows] = await pool.execute(rackQuery, rackParams);

    const rackDiscrepancies = rackRows
      .filter(r => Math.abs(parseFloat(r.variance || 0)) > 0.001)
      .map(r => ({
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse_name,
        warehouse_code: r.warehouse_code,
        menu_item_id: r.menu_item_id,
        product_name: r.product_name,
        sku: r.sku,
        barcode: r.barcode,
        warehouse_stock: parseFloat(r.warehouse_stock || 0),
        rack_sum_stock: parseFloat(r.total_rack_stock || 0),
        discrepancy: parseFloat(r.variance || 0)
      }));

    const totalItemsChecked = whRows.length;
    const totalWarehouseLocationsChecked = rackRows.length;
    const isTallyValid = globalDiscrepancies.length === 0 && rackDiscrepancies.length === 0;

    return {
      status: isTallyValid ? 'PERFECT_TALLY' : 'DISCREPANCIES_FOUND',
      is_valid: isTallyValid,
      total_items_checked: totalItemsChecked,
      total_warehouse_records_checked: totalWarehouseLocationsChecked,
      global_discrepancies_count: globalDiscrepancies.length,
      rack_discrepancies_count: rackDiscrepancies.length,
      global_discrepancies: globalDiscrepancies,
      rack_discrepancies: rackDiscrepancies,
      checked_at: new Date().toISOString()
    };
  }

  /**
   * Get complete audit trail / timeline of stock movements for a specific product
   * Includes exact rack locations, reference numbers, users, and before/after balances.
   */
  static async getProductMovementTimeline(restaurantId, menuItemId, filters = {}) {
    const { warehouse_id, date_from, date_to, limit = 100 } = filters;

    let query = `
      SELECT 
        st.*,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        mi.name AS product_name,
        mi.sku,
        mi.barcode,
        mi.unit,
        src_r.rack_code AS source_rack_code,
        src_r.rack_name AS source_rack_name,
        dest_r.rack_code AS dest_rack_code_resolved,
        dest_r.rack_name AS dest_rack_name_resolved
      FROM stock_transactions st
      JOIN menu_items mi ON st.menu_item_id = mi.id
      LEFT JOIN warehouses w ON st.warehouse_id = w.id
      LEFT JOIN warehouse_racks src_r ON st.rack_id = src_r.id
      LEFT JOIN warehouse_racks dest_r ON st.dest_rack_id = dest_r.id
      WHERE st.restaurant_id = ? AND st.menu_item_id = ?
    `;
    const params = [restaurantId, menuItemId];

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND st.warehouse_id = ?';
      params.push(warehouse_id);
    }
    if (date_from) {
      query += ' AND st.created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND st.created_at <= ?';
      params.push(date_to);
    }

    const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 100));
    query += ` ORDER BY st.created_at DESC, st.id DESC LIMIT ${safeLimit}`;

    const [rows] = await pool.execute(query, params);

    // Current location distribution
    const [locations] = await pool.execute(`
      SELECT 
        prs.warehouse_id,
        w.name AS warehouse_name,
        prs.rack_id,
        r.rack_code,
        r.rack_name,
        prs.current_stock
      FROM product_rack_stocks prs
      JOIN warehouses w ON prs.warehouse_id = w.id
      JOIN warehouse_racks r ON prs.rack_id = r.id
      WHERE prs.restaurant_id = ? AND prs.menu_item_id = ? AND prs.current_stock > 0
      ORDER BY w.name ASC, r.rack_code ASC
    `, [restaurantId, menuItemId]);

    // Product info
    const [prodRows] = await pool.execute(
      'SELECT id, name, sku, barcode, item_code, current_stock, unit, cost_price, price FROM menu_items WHERE id = ? AND restaurant_id = ?',
      [menuItemId, restaurantId]
    );

    return {
      product: prodRows[0] || null,
      current_locations: locations,
      transactions: rows
    };
  }
}

module.exports = StockReconciliationService;
