const pool = require('../config/db');
const { formatLocalDate } = require('../utils/date_utils');

class MenuRepository {
  static async getAll(restaurantId, filters = {}) {
    const { category_id, search, is_available, is_veg, limit, offset } = filters;
    let query = 'SELECT m.*, c.name as category_name, m.barcode_image_url FROM menu_items m LEFT JOIN categories c ON m.category_id = c.id WHERE m.restaurant_id = ?';
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
      query += ' AND (m.name LIKE ? OR m.sku LIKE ? OR m.barcode LIKE ? OR m.description LIKE ? OR m.item_code LIKE ? OR m.brand LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
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
      gst_rate, prep_time_minutes, is_veg, spicy_level, is_available, image_url, barcode_image_url,
      seq, kitchen_category, printer_id, unit, current_stock, low_stock_threshold, track_inventory,
      goods_or_service, item_code, hsn_code, purchase_unit, sales_unit, brand, item_group, tags,
      mrp, igst_rate, discount_type, discount_value, is_trackable, opening_stock, cost_price,
      stock_start_date, at_par_stock, min_stock, linked_sales_account, linked_purchase_account,
      open_qty_popup, open_price_popup, not_for_sale
    } = item;

    const initialStock = current_stock !== undefined ? current_stock : (opening_stock !== undefined ? opening_stock : 100.00);

    const [result] = await pool.execute(
      `INSERT INTO menu_items (
        restaurant_id, category_id, name, sku, barcode, description, price, purchase_price,
        is_weight_based, base_unit, min_sale_qty, max_sale_qty, sub_category, gst_rate,
        prep_time_minutes, is_veg, spicy_level, is_available, image_url, barcode_image_url, seq, kitchen_category,
        printer_id, unit, current_stock, low_stock_threshold, track_inventory,
        goods_or_service, item_code, hsn_code, purchase_unit, sales_unit, brand, item_group, tags,
        mrp, igst_rate, discount_type, discount_value, is_trackable, opening_stock, cost_price,
        stock_start_date, at_par_stock, min_stock, linked_sales_account, linked_purchase_account,
        open_qty_popup, open_price_popup, not_for_sale
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )`,
      [
        restaurantId,
        category_id,
        name || '',
        sku || null,
        barcode || null,
        description || null,
        price !== undefined ? price : 0,
        purchase_price !== undefined ? purchase_price : 0.00,
        is_weight_based === 1 ? 1 : 0,
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
        barcode_image_url || null,
        seq !== undefined ? seq : 0,
        kitchen_category || 'Main Kitchen',
        printer_id || null,
        base_unit || unit || 'pcs',
        initialStock,
        low_stock_threshold !== undefined ? low_stock_threshold : 10.00,
        track_inventory !== undefined ? track_inventory : (is_trackable !== undefined ? is_trackable : 1),
        goods_or_service || 'Goods',
        item_code || null,
        hsn_code || null,
        purchase_unit || 'pcs',
        sales_unit || 'pcs',
        brand || null,
        item_group || null,
        tags ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : null,
        mrp !== undefined ? mrp : 0.00,
        igst_rate !== undefined ? igst_rate : (gst_rate !== undefined ? gst_rate : 5.00),
        discount_type || 'percentage',
        discount_value !== undefined ? discount_value : 0.00,
        is_trackable !== undefined ? is_trackable : 1,
        opening_stock !== undefined ? opening_stock : 0.000,
        cost_price !== undefined ? cost_price : 0.00,
        stock_start_date || null,
        at_par_stock !== undefined ? at_par_stock : 0.000,
        min_stock !== undefined ? min_stock : (low_stock_threshold !== undefined ? low_stock_threshold : 0.000),
        linked_sales_account || 'Sales',
        linked_purchase_account || 'Purchase',
        open_qty_popup ? 1 : 0,
        open_price_popup ? 1 : 0,
        not_for_sale ? 1 : 0
      ]
    );
    return result.insertId;
  }

  static async update(id, restaurantId, item) {
    const {
      category_id, name, sku, barcode, description, price, purchase_price,
      is_weight_based, base_unit, min_sale_qty, max_sale_qty, sub_category,
      gst_rate, prep_time_minutes, is_veg, spicy_level, is_available, image_url, barcode_image_url,
      seq, kitchen_category, printer_id, unit, current_stock, low_stock_threshold, track_inventory,
      goods_or_service, item_code, hsn_code, purchase_unit, sales_unit, brand, item_group, tags,
      mrp, igst_rate, discount_type, discount_value, is_trackable, opening_stock, cost_price,
      stock_start_date, at_par_stock, min_stock, linked_sales_account, linked_purchase_account,
      open_qty_popup, open_price_popup, not_for_sale
    } = item;

    const [result] = await pool.execute(
      `UPDATE menu_items SET
        category_id = ?, name = ?, sku = ?, barcode = ?, description = ?, price = ?,
        purchase_price = ?, is_weight_based = ?, base_unit = ?, min_sale_qty = ?,
        max_sale_qty = ?, sub_category = ?, gst_rate = ?, prep_time_minutes = ?,
        is_veg = ?, spicy_level = ?, is_available = ?, image_url = ?, barcode_image_url = COALESCE(?, barcode_image_url), seq = ?,
        kitchen_category = ?, printer_id = ?, unit = COALESCE(?, unit),
        current_stock = COALESCE(?, current_stock), low_stock_threshold = COALESCE(?, low_stock_threshold),
        track_inventory = COALESCE(?, track_inventory),
        goods_or_service = COALESCE(?, goods_or_service),
        item_code = COALESCE(?, item_code),
        hsn_code = COALESCE(?, hsn_code),
        purchase_unit = COALESCE(?, purchase_unit),
        sales_unit = COALESCE(?, sales_unit),
        brand = COALESCE(?, brand),
        item_group = COALESCE(?, item_group),
        tags = COALESCE(?, tags),
        mrp = COALESCE(?, mrp),
        igst_rate = COALESCE(?, igst_rate),
        discount_type = COALESCE(?, discount_type),
        discount_value = COALESCE(?, discount_value),
        is_trackable = COALESCE(?, is_trackable),
        opening_stock = COALESCE(?, opening_stock),
        cost_price = COALESCE(?, cost_price),
        stock_start_date = COALESCE(?, stock_start_date),
        at_par_stock = COALESCE(?, at_par_stock),
        min_stock = COALESCE(?, min_stock),
        linked_sales_account = COALESCE(?, linked_sales_account),
        linked_purchase_account = COALESCE(?, linked_purchase_account),
        open_qty_popup = COALESCE(?, open_qty_popup),
        open_price_popup = COALESCE(?, open_price_popup),
        not_for_sale = COALESCE(?, not_for_sale)
      WHERE id = ? AND restaurant_id = ?`,
      [
        category_id,
        name || '',
        sku || null,
        barcode || null,
        description || null,
        price !== undefined ? price : 0,
        purchase_price !== undefined ? purchase_price : 0.00,
        is_weight_based === 1 ? 1 : 0,
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
        barcode_image_url || null,
        seq !== undefined ? seq : 0,
        kitchen_category || 'Main Kitchen',
        printer_id || null,
        base_unit || unit || null,
        current_stock !== undefined ? current_stock : null,
        low_stock_threshold !== undefined ? low_stock_threshold : null,
        track_inventory !== undefined ? track_inventory : null,
        goods_or_service !== undefined ? goods_or_service : null,
        item_code !== undefined ? item_code : null,
        hsn_code !== undefined ? hsn_code : null,
        purchase_unit !== undefined ? purchase_unit : null,
        sales_unit !== undefined ? sales_unit : null,
        brand !== undefined ? brand : null,
        item_group !== undefined ? item_group : null,
        tags !== undefined ? (typeof tags === 'string' ? tags : JSON.stringify(tags)) : null,
        mrp !== undefined ? mrp : null,
        igst_rate !== undefined ? igst_rate : null,
        discount_type !== undefined ? discount_type : null,
        discount_value !== undefined ? discount_value : null,
        is_trackable !== undefined ? is_trackable : null,
        opening_stock !== undefined ? opening_stock : null,
        cost_price !== undefined ? cost_price : null,
        stock_start_date !== undefined ? (stock_start_date ? formatLocalDate(stock_start_date) : null) : null,
        at_par_stock !== undefined ? at_par_stock : null,
        min_stock !== undefined ? min_stock : null,
        linked_sales_account !== undefined ? linked_sales_account : null,
        linked_purchase_account !== undefined ? linked_purchase_account : null,
        open_qty_popup !== undefined ? (open_qty_popup ? 1 : 0) : null,
        open_price_popup !== undefined ? (open_price_popup ? 1 : 0) : null,
        not_for_sale !== undefined ? (not_for_sale ? 1 : 0) : null,
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
