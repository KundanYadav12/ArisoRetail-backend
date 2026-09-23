const pool = require('../config/db');
const StockMovementService = require('../services/stock_movement_service');

class WarehouseRackRepository {
  /**
   * Fetch all racks for a restaurant tenant, optionally filtered by warehouse
   */
  static async getAll(restaurantId, warehouseId = null, status = 'all') {
    let query = `
      SELECT 
        wr.*,
        w.name as warehouse_name,
        w.code as warehouse_code,
        COUNT(DISTINCT prs.menu_item_id) as total_products_count,
        COALESCE(SUM(prs.current_stock), 0) as total_units_stored
      FROM warehouse_racks wr
      JOIN warehouses w ON wr.warehouse_id = w.id
      LEFT JOIN product_rack_stocks prs ON wr.id = prs.rack_id AND prs.restaurant_id = wr.restaurant_id AND prs.current_stock > 0
      WHERE wr.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (warehouseId && warehouseId !== 'all') {
      query += ' AND wr.warehouse_id = ?';
      params.push(warehouseId);
    }

    if (status && status !== 'all') {
      query += ' AND wr.status = ?';
      params.push(status);
    }

    query += ' GROUP BY wr.id ORDER BY w.name ASC, wr.rack_code ASC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get single rack by ID
   */
  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(`
      SELECT wr.*, w.name as warehouse_name, w.code as warehouse_code
      FROM warehouse_racks wr
      JOIN warehouses w ON wr.warehouse_id = w.id
      WHERE wr.id = ? AND wr.restaurant_id = ?
    `, [id, restaurantId]);

    return rows[0] || null;
  }

  /**
   * Create a new rack within a warehouse
   */
  static async create(restaurantId, data) {
    const {
      warehouse_id,
      rack_code,
      rack_name,
      zone = null,
      shelf = null,
      bin = null,
      status = 'active',
      notes = null
    } = data;

    if (!warehouse_id || !rack_code || !rack_name) {
      throw new Error('Warehouse, Rack Code, and Rack Name are required.');
    }

    const cleanCode = String(rack_code).trim().toUpperCase();
    const cleanName = String(rack_name).trim();

    // Check duplicate code within the same warehouse
    const [existing] = await pool.execute(
      'SELECT id FROM warehouse_racks WHERE restaurant_id = ? AND warehouse_id = ? AND rack_code = ?',
      [restaurantId, warehouse_id, cleanCode]
    );

    if (existing.length > 0) {
      throw new Error(`Rack code "${cleanCode}" already exists in this warehouse.`);
    }

    const [result] = await pool.execute(`
      INSERT INTO warehouse_racks (
        restaurant_id, warehouse_id, rack_code, rack_name, zone, shelf, bin, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      restaurantId, warehouse_id, cleanCode, cleanName,
      zone || null, shelf || null, bin || null, status || 'active', notes || null
    ]);

    return this.getById(result.insertId, restaurantId);
  }

  /**
   * Update rack details
   */
  static async update(id, restaurantId, data) {
    const {
      rack_code,
      rack_name,
      zone,
      shelf,
      bin,
      status,
      notes
    } = data;

    const existing = await this.getById(id, restaurantId);
    if (!existing) throw new Error('Rack not found.');

    const cleanCode = rack_code ? String(rack_code).trim().toUpperCase() : existing.rack_code;
    const cleanName = rack_name ? String(rack_name).trim() : existing.rack_name;

    // Check duplicate code within warehouse if code changed
    if (cleanCode !== existing.rack_code) {
      const [dup] = await pool.execute(
        'SELECT id FROM warehouse_racks WHERE restaurant_id = ? AND warehouse_id = ? AND rack_code = ? AND id != ?',
        [restaurantId, existing.warehouse_id, cleanCode, id]
      );
      if (dup.length > 0) {
        throw new Error(`Rack code "${cleanCode}" already exists in this warehouse.`);
      }
    }

    await pool.execute(`
      UPDATE warehouse_racks
      SET rack_code = ?, rack_name = ?, zone = ?, shelf = ?, bin = ?, status = ?, notes = ?, updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [
      cleanCode, cleanName,
      zone !== undefined ? zone : existing.zone,
      shelf !== undefined ? shelf : existing.shelf,
      bin !== undefined ? bin : existing.bin,
      status !== undefined ? status : existing.status,
      notes !== undefined ? notes : existing.notes,
      id, restaurantId
    ]);

    return this.getById(id, restaurantId);
  }

  /**
   * Delete rack (verifies that rack currently holds zero inventory)
   */
  static async delete(id, restaurantId) {
    const [stocks] = await pool.execute(
      'SELECT COALESCE(SUM(current_stock), 0) as total_stock FROM product_rack_stocks WHERE rack_id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );

    const totalStock = parseFloat(stocks[0]?.total_stock || 0);
    if (totalStock > 0) {
      throw new Error(`Cannot delete rack. It currently holds ${totalStock} units of product inventory. Please transfer the stock first.`);
    }

    await pool.execute(
      'DELETE FROM warehouse_racks WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );

    return true;
  }

  /**
   * Rack -> Products Search: List all products located in a specific rack
   */
  static async getProductsByRack(rackId, restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        prs.id as rack_stock_id,
        prs.menu_item_id,
        prs.current_stock,
        prs.updated_at,
        mi.name as product_name,
        mi.sku,
        mi.barcode,
        mi.unit,
        mi.price,
        mi.cost_price,
        c.name as category_name
      FROM product_rack_stocks prs
      JOIN menu_items mi ON prs.menu_item_id = mi.id
      LEFT JOIN categories c ON mi.category_id = c.id
      WHERE prs.rack_id = ? AND prs.restaurant_id = ? AND prs.current_stock > 0
      ORDER BY mi.name ASC
    `, [rackId, restaurantId]);

    return rows;
  }

  /**
   * Product -> Locations Search: Where is this product physically located?
   * Returns breakdown across warehouses and racks with quantities.
   */
  static async getRacksByProduct(menuItemId, restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        prs.id as rack_stock_id,
        prs.warehouse_id,
        w.name as warehouse_name,
        w.code as warehouse_code,
        prs.rack_id,
        wr.rack_code,
        wr.rack_name,
        wr.zone,
        wr.shelf,
        wr.bin,
        prs.current_stock as rack_stock,
        ws.current_stock as total_warehouse_stock,
        mi.name as product_name,
        mi.sku,
        mi.barcode,
        mi.unit
      FROM product_rack_stocks prs
      JOIN warehouses w ON prs.warehouse_id = w.id
      JOIN warehouse_racks wr ON prs.rack_id = wr.id
      JOIN menu_items mi ON prs.menu_item_id = mi.id
      LEFT JOIN warehouse_stocks ws ON ws.warehouse_id = prs.warehouse_id AND ws.menu_item_id = prs.menu_item_id
      WHERE prs.menu_item_id = ? AND prs.restaurant_id = ?
      ORDER BY w.name ASC, wr.rack_code ASC
    `, [menuItemId, restaurantId]);

    return rows;
  }

  /**
   * Internal Rack to Rack Stock Transfer
   */
  static async moveRackStock(restaurantId, userId, userName, data) {
    const {
      warehouse_id,
      menu_item_id,
      source_rack_id,
      destination_rack_id,
      quantity,
      notes
    } = data;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const result = await StockMovementService.moveRackStock(connection, {
        restaurantId,
        warehouseId: warehouse_id,
        menuItemId: menu_item_id,
        sourceRackId: source_rack_id,
        destinationRackId: destination_rack_id,
        quantity,
        userId,
        userName,
        notes
      });

      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = WarehouseRackRepository;
