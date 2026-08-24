const pool = require('../config/db');

class MenuRepository {
  static async getAll(restaurantId, filters = {}) {
    const { category_id, search, is_available, is_veg, limit, offset } = filters;
    let query = 'SELECT m.*, c.name as category_name FROM menu_items m LEFT JOIN categories c ON m.category_id = c.id WHERE m.restaurant_id = ?';
    const params = [restaurantId];

    if (category_id) {
      query += ' AND m.category_id = ?';
      params.push(category_id);
    }

    if (is_available !== undefined) {
      query += ' AND m.is_available = ?';
      params.push(is_available === 'true' || is_available === true ? 1 : 0);
    }

    if (is_veg !== undefined) {
      query += ' AND m.is_veg = ?';
      params.push(parseInt(is_veg));
    }

    if (search) {
      query += ' AND (m.name LIKE ? OR m.sku LIKE ? OR m.barcode LIKE ? OR m.description LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY m.category_id ASC, m.name ASC';

    if (limit) {
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset || 0));
    }

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      'SELECT m.*, c.name as category_name FROM menu_items m JOIN categories c ON m.category_id = c.id WHERE m.id = ? AND m.restaurant_id = ?',
      [id, restaurantId]
    );
    return rows[0];
  }

  static async create(restaurantId, item) {
    const {
      category_id, name, sku, barcode, description, price, purchase_price,
      is_weight_based, base_unit, min_sale_qty, max_sale_qty, sub_category,
      gst_rate, prep_time_minutes, is_veg, spicy_level, is_available, image_url,
      seq, kitchen_category, printer_id, unit, current_stock, low_stock_threshold, track_inventory
    } = item;

    const [result] = await pool.execute(
      `INSERT INTO menu_items (
        restaurant_id, category_id, name, sku, barcode, description, price, purchase_price,
        is_weight_based, base_unit, min_sale_qty, max_sale_qty, sub_category, gst_rate,
        prep_time_minutes, is_veg, spicy_level, is_available, image_url, seq, kitchen_category,
        printer_id, unit, current_stock, low_stock_threshold, track_inventory
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        restaurantId,
        category_id,
        name || '',
        sku || null,
        barcode || null,
        description || null,
        price !== undefined ? price : 0,
        purchase_price !== undefined ? purchase_price : 0.00,
        is_weight_based ? 1 : 0,
        base_unit || unit || 'pcs',
        min_sale_qty !== undefined ? min_sale_qty : 0.001,
        max_sale_qty !== undefined ? max_sale_qty : 1000.000,
        sub_category || null,
        gst_rate !== undefined ? gst_rate : 5.00,
        prep_time_minutes !== undefined ? prep_time_minutes : 10,
        is_veg !== undefined ? is_veg : 1,
        spicy_level !== undefined ? spicy_level : 0,
        is_available !== undefined ? is_available : 1,
        image_url || null,
        seq !== undefined ? seq : 0,
        kitchen_category || 'Main Kitchen',
        printer_id || null,
        base_unit || unit || 'pcs',
        current_stock !== undefined ? current_stock : 100.00,
        low_stock_threshold !== undefined ? low_stock_threshold : 10.00,
        track_inventory !== undefined ? track_inventory : 1
      ]
    );
    return result.insertId;
  }

  static async update(id, restaurantId, item) {
    const {
      category_id, name, sku, barcode, description, price, purchase_price,
      is_weight_based, base_unit, min_sale_qty, max_sale_qty, sub_category,
      gst_rate, prep_time_minutes, is_veg, spicy_level, is_available, image_url,
      seq, kitchen_category, printer_id, unit, current_stock, low_stock_threshold, track_inventory
    } = item;

    const [result] = await pool.execute(
      `UPDATE menu_items SET
        category_id = ?, name = ?, sku = ?, barcode = ?, description = ?, price = ?,
        purchase_price = ?, is_weight_based = ?, base_unit = ?, min_sale_qty = ?,
        max_sale_qty = ?, sub_category = ?, gst_rate = ?, prep_time_minutes = ?,
        is_veg = ?, spicy_level = ?, is_available = ?, image_url = ?, seq = ?,
        kitchen_category = ?, printer_id = ?, unit = COALESCE(?, unit),
        current_stock = COALESCE(?, current_stock), low_stock_threshold = COALESCE(?, low_stock_threshold),
        track_inventory = COALESCE(?, track_inventory)
      WHERE id = ? AND restaurant_id = ?`,
      [
        category_id,
        name || '',
        sku || null,
        barcode || null,
        description || null,
        price !== undefined ? price : 0,
        purchase_price !== undefined ? purchase_price : 0.00,
        is_weight_based ? 1 : 0,
        base_unit || unit || 'pcs',
        min_sale_qty !== undefined ? min_sale_qty : 0.001,
        max_sale_qty !== undefined ? max_sale_qty : 1000.000,
        sub_category || null,
        gst_rate !== undefined ? gst_rate : 5.00,
        prep_time_minutes !== undefined ? prep_time_minutes : 10,
        is_veg !== undefined ? is_veg : 1,
        spicy_level !== undefined ? spicy_level : 0,
        is_available !== undefined ? is_available : 1,
        image_url || null,
        seq !== undefined ? seq : 0,
        kitchen_category || 'Main Kitchen',
        printer_id || null,
        base_unit || unit || null,
        current_stock !== undefined ? current_stock : null,
        low_stock_threshold !== undefined ? low_stock_threshold : null,
        track_inventory !== undefined ? track_inventory : null,
        id,
        restaurantId
      ]
    );
    return result.affectedRows > 0;
  }

  static async delete(id, restaurantId) {
    try {
      await pool.execute(
        'UPDATE order_items SET menu_item_id = NULL WHERE menu_item_id = ?',
        [id]
      );
    } catch (err) {
      console.warn('[Unlink order_items Alert]', err.message);
    }

    try {
      await pool.execute(
        'UPDATE inventory_audit_logs SET menu_item_id = NULL WHERE menu_item_id = ?',
        [id]
      );
    } catch (e) {}

    const [result] = await pool.execute(
      'DELETE FROM menu_items WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async updateSequence(restaurantId, sequenceArray) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const item of sequenceArray) {
        await connection.execute(
          'UPDATE menu_items SET seq = ? WHERE id = ? AND restaurant_id = ?',
          [item.seq, item.id, restaurantId]
        );
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Transactional Bulk Delete of Menu Items for a specific Tenant
   */
  static async bulkDelete(ids, restaurantId) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const cleanIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
    if (cleanIds.length === 0) return 0;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const placeholders = cleanIds.map(() => '?').join(',');

      // 1. Unlink historical order_items to preserve order receipts
      try {
        await connection.query(
          `UPDATE order_items SET menu_item_id = NULL WHERE menu_item_id IN (${placeholders})`,
          cleanIds
        );
      } catch (e) {
        console.warn('[Unlink order_items bulk warning]', e.message);
      }

      // 2. Unlink inventory audit logs
      try {
        await connection.query(
          `UPDATE inventory_audit_logs SET menu_item_id = NULL WHERE menu_item_id IN (${placeholders})`,
          cleanIds
        );
      } catch (e) {}

      // 3. Delete menu_items belonging ONLY to this restaurant tenant
      const [result] = await connection.query(
        `DELETE FROM menu_items WHERE id IN (${placeholders}) AND restaurant_id = ?`,
        [...cleanIds, restaurantId]
      );

      await connection.commit();
      return result.affectedRows;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Bulk Update Availability Status for Menu Items
   */
  static async bulkUpdateStatus(ids, restaurantId, isAvailable) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const cleanIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0);
    if (cleanIds.length === 0) return 0;

    const placeholders = cleanIds.map(() => '?').join(',');
    const [result] = await pool.query(
      `UPDATE menu_items SET is_available = ? WHERE id IN (${placeholders}) AND restaurant_id = ?`,
      [isAvailable ? 1 : 0, ...cleanIds, restaurantId]
    );
    return result.affectedRows;
  }
}

module.exports = MenuRepository;
