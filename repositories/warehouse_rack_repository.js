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

  /**
   * Assign or update product stock on a specific rack
   */
  static async assignRackStock(restaurantId, userId, userName, data) {
    const {
      menu_item_id,
      warehouse_id,
      rack_id,
      quantity,
      notes
    } = data;

    if (!menu_item_id || !warehouse_id || !rack_id) {
      throw new Error('Product, warehouse, and rack are required.');
    }

    const targetQty = parseFloat(quantity);
    if (isNaN(targetQty) || targetQty < 0) {
      throw new Error('Quantity must be a valid positive number.');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Lock and check menu item
      const [itemRows] = await connection.execute(
        'SELECT id, name, sku, current_stock, unit FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [menu_item_id, restaurantId]
      );
      if (itemRows.length === 0) {
        throw new Error('Menu item not found.');
      }
      const item = itemRows[0];
      const totalSystemStock = parseFloat(item.current_stock || 0);
      const unit = item.unit || 'pcs';

      // 2. Check warehouse
      const [whRows] = await connection.execute(
        'SELECT id, name, code FROM warehouses WHERE id = ? AND restaurant_id = ?',
        [warehouse_id, restaurantId]
      );
      if (whRows.length === 0) {
        throw new Error('Warehouse not found.');
      }
      const warehouseName = whRows[0].name;

      // 3. Check warehouse stock for this item
      const [whStockRows] = await connection.execute(
        'SELECT current_stock FROM warehouse_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
        [restaurantId, warehouse_id, menu_item_id]
      );
      const whStock = whStockRows.length > 0 ? parseFloat(whStockRows[0].current_stock || 0) : 0;

      // 4. Lock and check rack
      const [rackRows] = await connection.execute(
        'SELECT id, rack_code, rack_name FROM warehouse_racks WHERE id = ? AND warehouse_id = ? AND restaurant_id = ?',
        [rack_id, warehouse_id, restaurantId]
      );
      if (rackRows.length === 0) {
        throw new Error('Rack not found in the selected warehouse.');
      }
      const rack = rackRows[0];

      // 5. Lock and check current stock in this rack
      const [currentRackRows] = await connection.execute(
        'SELECT current_stock FROM product_rack_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ? FOR UPDATE',
        [restaurantId, warehouse_id, rack_id, menu_item_id]
      );
      const prevRackStock = currentRackRows.length > 0 ? parseFloat(currentRackRows[0].current_stock || 0) : 0;

      // 6. Check total assigned across all other racks for this product
      const [otherRacksRows] = await connection.execute(
        'SELECT COALESCE(SUM(current_stock), 0) AS other_total FROM product_rack_stocks WHERE restaurant_id = ? AND menu_item_id = ? AND NOT (warehouse_id = ? AND rack_id = ?)',
        [restaurantId, menu_item_id, warehouse_id, rack_id]
      );
      const otherRacksTotal = parseFloat(otherRacksRows[0]?.other_total || 0);
      const newTotalAcrossRacks = otherRacksTotal + targetQty;

      // VALIDATION: Total assigned across racks cannot exceed Total System Stock
      if (newTotalAcrossRacks > totalSystemStock) {
        const maxAssignable = Math.max(0, totalSystemStock - otherRacksTotal);
        throw new Error(`Total assigned stock across racks (${newTotalAcrossRacks} ${unit}) cannot exceed Total System Stock (${totalSystemStock} ${unit}). Maximum assignable for this rack is ${maxAssignable} ${unit}.`);
      }

      // Ensure warehouse_stocks records exist and are synchronized with rack assignment
      if (whStockRows.length === 0) {
        await connection.execute(`
          INSERT INTO warehouse_stocks (restaurant_id, warehouse_id, menu_item_id, current_stock, reserved_stock, min_stock, reorder_level)
          VALUES (?, ?, ?, ?, 0.000, 0.000, 5.000)
          ON DUPLICATE KEY UPDATE current_stock = GREATEST(current_stock, VALUES(current_stock))
        `, [restaurantId, warehouse_id, menu_item_id, targetQty]);
      } else if (targetQty > whStock) {
        await connection.execute(`
          UPDATE warehouse_stocks
          SET current_stock = ?
          WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?
        `, [targetQty, restaurantId, warehouse_id, menu_item_id]);
      }

      const diff = targetQty - prevRackStock;

      // 7. Update or delete product_rack_stocks
      if (targetQty > 0) {
        await connection.execute(`
          INSERT INTO product_rack_stocks (restaurant_id, warehouse_id, rack_id, menu_item_id, current_stock)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE current_stock = VALUES(current_stock), updated_at = NOW()
        `, [restaurantId, warehouse_id, rack_id, menu_item_id, targetQty]);
      } else {
        await connection.execute(`
          DELETE FROM product_rack_stocks
          WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ?
        `, [restaurantId, warehouse_id, rack_id, menu_item_id]);
      }

      // 8. Record in stock_transactions ledger if there is a difference
      if (Math.abs(diff) > 0.0001) {
        let noteText = '';
        if (prevRackStock === 0) {
          noteText = `Assigned ${targetQty} ${unit} to Rack ${rack.rack_code} — Manual Assignment`;
        } else if (targetQty === 0) {
          noteText = `Removed ${prevRackStock} ${unit} from Rack ${rack.rack_code} — Manual Assignment`;
        } else {
          noteText = `Updated Rack ${rack.rack_code} stock: ${prevRackStock} → ${targetQty} ${unit} — Manual Assignment`;
        }
        if (notes && notes.trim()) {
          noteText += ` (${notes.trim()})`;
        }

        await connection.execute(`
          INSERT INTO stock_transactions (
            restaurant_id, warehouse_id, rack_id, rack_code, dest_rack_id, dest_rack_code, menu_item_id, transaction_type,
            quantity, previous_stock, new_stock, unit_cost, total_cost,
            reference_type, reference_number,
            user_id, user_name, notes, created_at
          ) VALUES (?, ?, ?, ?, NULL, NULL, ?, 'STOCK_CORRECTION', ?, ?, ?, 0.00, 0.00, 'rack_assignment', ?, ?, ?, ?, NOW())
        `, [
          restaurantId, warehouse_id, rack_id, rack.rack_code, menu_item_id,
          diff, prevRackStock, targetQty,
          `RACK-ASSIGN-${rack.rack_code}`,
          userId || null, userName || 'System',
          noteText
        ]);
      }

      await connection.commit();
      return {
        success: true,
        menu_item_id,
        warehouse_id,
        warehouse_name: warehouseName,
        rack_id,
        rack_code: rack.rack_code,
        rack_name: rack.rack_name,
        previous_stock: prevRackStock,
        current_stock: targetQty,
        total_rack_stock: newTotalAcrossRacks,
        total_system_stock: totalSystemStock
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Remove rack assignment (set rack stock to 0)
   */
  static async removeRackStock(restaurantId, userId, userName, data) {
    const { menu_item_id, warehouse_id, rack_id, notes } = data;
    return this.assignRackStock(restaurantId, userId, userName, {
      menu_item_id,
      warehouse_id,
      rack_id,
      quantity: 0,
      notes: notes || 'Manual removal of rack assignment'
    });
  }
}

module.exports = WarehouseRackRepository;
