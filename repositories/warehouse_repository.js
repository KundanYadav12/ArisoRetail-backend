const pool = require('../config/db');

class WarehouseRepository {
  /**
   * Fetch all warehouses for a restaurant tenant
   */
  static async getAll(restaurantId, status = 'all') {
    let query = `
      SELECT 
        w.id,
        w.name,
        w.code,
        w.address,
        w.city,
        w.state,
        w.pincode,
        w.contact_person,
        w.contact_number,
        w.email,
        w.is_default,
        w.status,
        w.created_at,
        w.updated_at,
        COUNT(DISTINCT ws.menu_item_id) as total_items_stocked,
        COALESCE(SUM(ws.current_stock), 0) as total_units_in_stock,
        COALESCE(SUM(ws.current_stock * mi.price), 0) as total_stock_valuation
      FROM warehouses w
      LEFT JOIN warehouse_stocks ws ON w.id = ws.warehouse_id AND ws.restaurant_id = w.restaurant_id
      LEFT JOIN menu_items mi ON ws.menu_item_id = mi.id
      WHERE w.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND w.status = ?';
      params.push(status);
    }

    query += ' GROUP BY w.id ORDER BY w.is_default DESC, w.name ASC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get warehouse by ID
   */
  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM warehouses WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Get default primary warehouse for a restaurant
   */
  static async getDefault(restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM warehouses WHERE restaurant_id = ? AND is_default = 1 LIMIT 1',
      [restaurantId]
    );

    if (rows.length > 0) return rows[0];

    // Fallback: Return first active warehouse
    const [fallbackRows] = await pool.execute(
      'SELECT * FROM warehouses WHERE restaurant_id = ? ORDER BY id ASC LIMIT 1',
      [restaurantId]
    );
    return fallbackRows[0] || null;
  }

  /**
   * Create a new warehouse
   */
  static async create(restaurantId, data) {
    const {
      name,
      code,
      address,
      city,
      state,
      pincode,
      contact_person,
      contact_number,
      email,
      is_default = 0,
      status = 'active'
    } = data;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // If set as default, unset other defaults
      if (is_default) {
        await connection.execute(
          'UPDATE warehouses SET is_default = 0 WHERE restaurant_id = ?',
          [restaurantId]
        );
      }

      const [result] = await connection.execute(`
        INSERT INTO warehouses (
          restaurant_id, name, code, address, city, state, pincode,
          contact_person, contact_number, email, is_default, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        restaurantId, name.trim(), (code || name.substring(0, 4).toUpperCase()).trim(),
        address || null, city || null, state || null, pincode || null,
        contact_person || null, contact_number || null, email || null,
        is_default ? 1 : 0, status || 'active'
      ]);

      const warehouseId = result.insertId;

      // Seed all existing menu_items into warehouse_stocks with 0 stock
      await connection.execute(`
        INSERT INTO warehouse_stocks (restaurant_id, warehouse_id, menu_item_id, current_stock, reserved_stock, min_stock, reorder_level)
        SELECT ?, ?, id, 0.000, 0.000, COALESCE(low_stock_threshold, 10.000), COALESCE(low_stock_threshold, 10.000)
        FROM menu_items
        WHERE restaurant_id = ?
        ON DUPLICATE KEY UPDATE updated_at = NOW()
      `, [restaurantId, warehouseId, restaurantId]);

      await connection.commit();
      return { id: warehouseId, ...data };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Update an existing warehouse
   */
  static async update(id, restaurantId, data) {
    const {
      name,
      code,
      address,
      city,
      state,
      pincode,
      contact_person,
      contact_number,
      email,
      is_default,
      status
    } = data;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      if (is_default) {
        await connection.execute(
          'UPDATE warehouses SET is_default = 0 WHERE restaurant_id = ?',
          [restaurantId]
        );
      }

      await connection.execute(`
        UPDATE warehouses SET
          name = COALESCE(?, name),
          code = COALESCE(?, code),
          address = COALESCE(?, address),
          city = COALESCE(?, city),
          state = COALESCE(?, state),
          pincode = COALESCE(?, pincode),
          contact_person = COALESCE(?, contact_person),
          contact_number = COALESCE(?, contact_number),
          email = COALESCE(?, email),
          is_default = COALESCE(?, is_default),
          status = COALESCE(?, status),
          updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [
        name !== undefined ? name.trim() : null,
        code !== undefined ? code.trim() : null,
        address, city, state, pincode,
        contact_person, contact_number, email,
        is_default !== undefined ? (is_default ? 1 : 0) : null,
        status, id, restaurantId
      ]);

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
   * Get warehouse-specific stock listing with category and search filters
   */
  static async getWarehouseStock(warehouseId, restaurantId, filters = {}) {
    const { categoryId, search, status } = filters;

    let query = `
      SELECT 
        mi.id as menu_item_id,
        mi.name,
        mi.sku,
        mi.item_code,
        mi.brand,
        mi.price,
        mi.mrp,
        mi.cost_price,
        COALESCE(c.name, 'Uncategorized') as category_name,
        mi.category_id,
        COALESCE(mi.unit, 'pcs') as unit,
        COALESCE(mi.is_weight_based, 0) as is_weight_based,
        COALESCE(ws.current_stock, 0.000) as current_stock,
        COALESCE(ws.reserved_stock, 0.000) as reserved_stock,
        GREATEST(0, COALESCE(ws.current_stock, 0.000) - COALESCE(ws.reserved_stock, 0.000)) as available_stock,
        COALESCE(ws.min_stock, mi.low_stock_threshold, 10.000) as min_stock,
        COALESCE(ws.reorder_level, 10.000) as reorder_level,
        ws.batch_number,
        ws.expiry_date,
        ws.updated_at,
        CASE
          WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= 0 THEN 'out_of_stock'
          WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= COALESCE(ws.min_stock, mi.low_stock_threshold, 10) THEN 'low_stock'
          ELSE 'in_stock'
        END as stock_status
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND ws.warehouse_id = ? AND ws.restaurant_id = mi.restaurant_id
      WHERE mi.restaurant_id = ?
    `;

    const params = [warehouseId, restaurantId];

    if (categoryId && categoryId !== 'all') {
      query += ' AND mi.category_id = ?';
      params.push(categoryId);
    }

    if (search && search.trim()) {
      query += ' AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ? OR mi.brand LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    if (status === 'out_of_stock') {
      query += ' AND GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= 0';
    } else if (status === 'low_stock') {
      query += ' AND GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) > 0 AND GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= COALESCE(ws.min_stock, mi.low_stock_threshold, 10)';
    } else if (status === 'in_stock') {
      query += ' AND GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) > COALESCE(ws.min_stock, mi.low_stock_threshold, 10)';
    }

    query += ' ORDER BY stock_status ASC, mi.name ASC';

    const [rows] = await pool.execute(query, params);

    // Summary counters
    const [summaryRows] = await pool.execute(`
      SELECT 
        COUNT(mi.id) as total_items,
        SUM(CASE WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) > COALESCE(ws.min_stock, mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as in_stock_count,
        SUM(CASE WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) > 0 AND GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= COALESCE(ws.min_stock, mi.low_stock_threshold, 10) THEN 1 ELSE 0 END) as low_stock_count,
        SUM(CASE WHEN GREATEST(0, COALESCE(ws.current_stock, 0) - COALESCE(ws.reserved_stock, 0)) <= 0 THEN 1 ELSE 0 END) as out_of_stock_count,
        COALESCE(SUM(ws.current_stock * mi.price), 0) as total_valuation
      FROM menu_items mi
      LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND ws.warehouse_id = ? AND ws.restaurant_id = mi.restaurant_id
      WHERE mi.restaurant_id = ?
    `, [warehouseId, restaurantId]);

    return {
      items: rows,
      summary: summaryRows[0] || { total_items: 0, in_stock_count: 0, low_stock_count: 0, out_of_stock_count: 0, total_valuation: 0 }
    };
  }
}

module.exports = WarehouseRepository;
