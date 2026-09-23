const pool = require('../config/db');

/**
 * Enterprise Stock Movement Kernel
 * Handles atomic inventory updates, concurrency locking (FOR UPDATE),
 * multi-warehouse synchronization, and immutable stock ledger auditing.
 */
class StockMovementService {
  /**
   * Execute an atomic stock movement inside an existing database transaction
   * 
   * @param {Object} connection - Active MySQL connection with an open transaction
   * @param {Object} params - Movement parameters
   * @param {number} params.restaurantId - Tenant isolation ID
   * @param {number} params.warehouseId - Specific warehouse ID
   * @param {number} params.menuItemId - Target product/item ID
   * @param {string} params.type - Transaction type (OPENING_STOCK, PURCHASE, PURCHASE_RETURN, TRANSFER_OUT, TRANSFER_IN, SALE, SALES_RETURN, ADJUSTMENT_IN, ADJUSTMENT_OUT, DAMAGE, EXPIRED, STOCK_CORRECTION)
   * @param {number} params.quantity - Quantity (positive for increase, negative for deduction)
   * @param {number} [params.unitCost] - Optional unit cost
   * @param {string} [params.referenceType] - e.g. 'order', 'stock_transfer', 'purchase_bill', 'stock_adjustment'
   * @param {number} [params.referenceId] - Associated entity ID
   * @param {string} [params.referenceNumber] - Associated document number (e.g. 'ORD-001', 'ST-0001')
   * @param {number} [params.userId] - Action performer user ID
   * @param {string} [params.userName] - Action performer user name
   * @param {string} [params.notes] - Notes or reason
   * @param {boolean} [params.allowNegativeStock] - Whether to allow negative stock (default false)
   */
  static async recordMovement(connection, {
    restaurantId,
    warehouseId,
    menuItemId,
    type,
    quantity,
    unitCost = 0.00,
    referenceType = null,
    referenceId = null,
    referenceNumber = null,
    userId = null,
    userName = 'System',
    notes = null,
    allowNegativeStock = false,
    rackId = null,
    rackCode = null,
    destRackId = null,
    destRackCode = null
  }) {
    const qtyChange = parseFloat(quantity) || 0;
    if (qtyChange === 0) {
      return { previousStock: 0, newStock: 0, quantity: 0 };
    }

    // 1. Fetch & lock warehouse_stocks record
    let [whStockRows] = await connection.execute(
      `SELECT current_stock, reserved_stock, min_stock 
       FROM warehouse_stocks 
       WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ? 
       FOR UPDATE`,
      [restaurantId, warehouseId, menuItemId]
    );

    let prevStock = 0;
    let reservedStock = 0;

    if (whStockRows.length === 0) {
      // If no warehouse stock record exists yet, initialize it
      await connection.execute(
        `INSERT INTO warehouse_stocks (restaurant_id, warehouse_id, menu_item_id, current_stock, reserved_stock)
         VALUES (?, ?, ?, 0.000, 0.000)
         ON DUPLICATE KEY UPDATE current_stock = current_stock`,
        [restaurantId, warehouseId, menuItemId]
      );
      prevStock = 0;
    } else {
      prevStock = parseFloat(whStockRows[0].current_stock || 0);
      reservedStock = parseFloat(whStockRows[0].reserved_stock || 0);
    }

    const calculatedNewStock = prevStock + qtyChange;
    const newStock = allowNegativeStock ? calculatedNewStock : Math.max(0, calculatedNewStock);

    // If deducting and negative stock not allowed, verify availability
    if (qtyChange < 0 && !allowNegativeStock && Math.abs(qtyChange) > prevStock) {
      const [itemMeta] = await connection.execute(
        'SELECT name, unit FROM menu_items WHERE id = ?',
        [menuItemId]
      );
      const itemName = itemMeta.length > 0 ? itemMeta[0].name : `Item #${menuItemId}`;
      const itemUnit = itemMeta.length > 0 ? itemMeta[0].unit || 'pcs' : 'pcs';
      throw new Error(`Insufficient stock in warehouse for "${itemName}". Available: ${prevStock} ${itemUnit}, required: ${Math.abs(qtyChange)} ${itemUnit}.`);
    }

    // 2. Update warehouse_stocks
    await connection.execute(
      `UPDATE warehouse_stocks 
       SET current_stock = ?, updated_at = NOW() 
       WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?`,
      [newStock, restaurantId, warehouseId, menuItemId]
    );

    // 2b. Location / Rack tracking: update product_rack_stocks
    let effectiveRackId = rackId || null;
    let effectiveRackCode = rackCode || null;

    if (!effectiveRackId) {
      // Find default rack for this warehouse if available
      const [defaultRacks] = await connection.execute(
        'SELECT id, rack_code FROM warehouse_racks WHERE warehouse_id = ? AND restaurant_id = ? ORDER BY id ASC LIMIT 1',
        [warehouseId, restaurantId]
      );
      if (defaultRacks.length > 0) {
        effectiveRackId = defaultRacks[0].id;
        effectiveRackCode = defaultRacks[0].rack_code;
      }
    } else if (!effectiveRackCode) {
      const [rRows] = await connection.execute(
        'SELECT rack_code FROM warehouse_racks WHERE id = ?',
        [effectiveRackId]
      );
      if (rRows.length > 0) effectiveRackCode = rRows[0].rack_code;
    }

    if (effectiveRackId) {
      const [rackStockRows] = await connection.execute(
        `SELECT current_stock FROM product_rack_stocks 
         WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ? 
         FOR UPDATE`,
        [restaurantId, warehouseId, effectiveRackId, menuItemId]
      );

      const prevRackStock = rackStockRows.length > 0 ? parseFloat(rackStockRows[0].current_stock || 0) : 0;
      const newRackStock = allowNegativeStock ? (prevRackStock + qtyChange) : Math.max(0, prevRackStock + qtyChange);

      await connection.execute(
        `INSERT INTO product_rack_stocks (restaurant_id, warehouse_id, rack_id, menu_item_id, current_stock)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE current_stock = VALUES(current_stock), updated_at = NOW()`,
        [restaurantId, warehouseId, effectiveRackId, menuItemId, newRackStock]
      );
    }

    // 3. Keep menu_items.current_stock synchronized (aggregate across all warehouses for this restaurant)
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
       SET current_stock = ?, reserved_stock = ? 
       WHERE id = ? AND restaurant_id = ?`,
      [totalAggStock, totalAggReserved, menuItemId, restaurantId]
    );

    // 4. Record entry in immutable stock_transactions ledger
    const totalCost = Math.abs(qtyChange) * (parseFloat(unitCost) || 0.00);

    const [txResult] = await connection.execute(
      `INSERT INTO stock_transactions (
        restaurant_id, warehouse_id, rack_id, rack_code, dest_rack_id, dest_rack_code, menu_item_id, transaction_type,
        quantity, previous_stock, new_stock, unit_cost, total_cost,
        reference_type, reference_id, reference_number,
        user_id, user_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        restaurantId, warehouseId, effectiveRackId, effectiveRackCode, destRackId, destRackCode, menuItemId, type,
        qtyChange, prevStock, newStock, unitCost || 0.00, totalCost,
        referenceType, referenceId, referenceNumber,
        userId, userName, notes
      ]
    );

    // 5. Also insert legacy stock_logs for complete backward compatibility with existing report/dialog
    try {
      await connection.execute(
        `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          restaurantId, menuItemId, userId, userName,
          qtyChange > 0 ? 'add' : 'reduce', Math.abs(qtyChange),
          prevStock, newStock, notes || `${type} (Ref: ${referenceNumber || 'N/A'}${effectiveRackCode ? ` Rack: ${effectiveRackCode}` : ''})`
        ]
      );
    } catch (logErr) {
      console.warn('[Legacy Stock Log Warning]:', logErr.message);
    }

    return {
      transactionId: txResult.insertId,
      previousStock: prevStock,
      newStock: newStock,
      quantityChange: qtyChange,
      totalAggregatedStock: totalAggStock,
      rackId: effectiveRackId,
      rackCode: effectiveRackCode
    };
  }

  /**
   * Internal Rack to Rack movement within the same warehouse.
   * Total warehouse stock remains unchanged; only location distribution changes.
   */
  static async moveRackStock(connection, {
    restaurantId,
    warehouseId,
    menuItemId,
    sourceRackId,
    destinationRackId,
    quantity,
    userId = null,
    userName = 'System',
    notes = null
  }) {
    const moveQty = parseFloat(quantity) || 0;
    if (moveQty <= 0) {
      throw new Error('Transfer quantity must be greater than zero.');
    }
    if (parseInt(sourceRackId) === parseInt(destinationRackId)) {
      throw new Error('Source and destination rack cannot be the same.');
    }

    // 1. Lock and check source rack stock
    const [srcRows] = await connection.execute(
      `SELECT current_stock FROM product_rack_stocks 
       WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ? 
       FOR UPDATE`,
      [restaurantId, warehouseId, sourceRackId, menuItemId]
    );

    const srcStock = srcRows.length > 0 ? parseFloat(srcRows[0].current_stock || 0) : 0;
    if (srcStock < moveQty) {
      const [itemMeta] = await connection.execute('SELECT name, unit FROM menu_items WHERE id = ?', [menuItemId]);
      const name = itemMeta[0]?.name || `Item #${menuItemId}`;
      const unit = itemMeta[0]?.unit || 'pcs';
      throw new Error(`Insufficient stock in source rack for "${name}". Available: ${srcStock} ${unit}, required: ${moveQty} ${unit}.`);
    }

    // 2. Fetch rack codes
    const [srcRackInfo] = await connection.execute('SELECT rack_code FROM warehouse_racks WHERE id = ?', [sourceRackId]);
    const [destRackInfo] = await connection.execute('SELECT rack_code FROM warehouse_racks WHERE id = ?', [destinationRackId]);
    const srcCode = srcRackInfo[0]?.rack_code || `RACK-${sourceRackId}`;
    const destCode = destRackInfo[0]?.rack_code || `RACK-${destinationRackId}`;

    // 3. Deduct from source rack
    const newSrcStock = srcStock - moveQty;
    await connection.execute(
      `UPDATE product_rack_stocks 
       SET current_stock = ?, updated_at = NOW() 
       WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ?`,
      [newSrcStock, restaurantId, warehouseId, sourceRackId, menuItemId]
    );

    // 4. Add to destination rack
    const [destRows] = await connection.execute(
      `SELECT current_stock FROM product_rack_stocks 
       WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ? 
       FOR UPDATE`,
      [restaurantId, warehouseId, destinationRackId, menuItemId]
    );
    const destStock = destRows.length > 0 ? parseFloat(destRows[0].current_stock || 0) : 0;
    const newDestStock = destStock + moveQty;

    await connection.execute(
      `INSERT INTO product_rack_stocks (restaurant_id, warehouse_id, rack_id, menu_item_id, current_stock)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE current_stock = VALUES(current_stock), updated_at = NOW()`,
      [restaurantId, warehouseId, destinationRackId, menuItemId, newDestStock]
    );

    // 5. Get current warehouse stock for ledger record
    const [whStockRows] = await connection.execute(
      `SELECT current_stock FROM warehouse_stocks 
       WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?`,
      [restaurantId, warehouseId, menuItemId]
    );
    const currentWhStock = whStockRows.length > 0 ? parseFloat(whStockRows[0].current_stock || 0) : 0;

    // 6. Record in immutable stock_transactions ledger
    const [txResult] = await connection.execute(
      `INSERT INTO stock_transactions (
        restaurant_id, warehouse_id, rack_id, rack_code, dest_rack_id, dest_rack_code, menu_item_id, transaction_type,
        quantity, previous_stock, new_stock, unit_cost, total_cost,
        reference_type, reference_number,
        user_id, user_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'STOCK_CORRECTION', 0.000, ?, ?, 0.00, 0.00, 'rack_transfer', ?, ?, ?, ?, NOW())`,
      [
        restaurantId, warehouseId, sourceRackId, srcCode, destinationRackId, destCode, menuItemId,
        currentWhStock, currentWhStock,
        `RACK-MOVE-${srcCode}-TO-${destCode}`,
        userId, userName, notes || `Internal Rack Transfer: ${moveQty} moved from ${srcCode} to ${destCode}`
      ]
    );

    return {
      success: true,
      transactionId: txResult.insertId,
      sourceRack: { id: sourceRackId, code: srcCode, previousStock: srcStock, newStock: newSrcStock },
      destinationRack: { id: destinationRackId, code: destCode, previousStock: destStock, newStock: newDestStock },
      movedQuantity: moveQty
    };
  }

  /**
   * Get live available stock for an item in a warehouse
   */
  static async getAvailableStock(connOrPool, restaurantId, warehouseId, menuItemId) {
    const [rows] = await connOrPool.execute(
      `SELECT current_stock, reserved_stock, 
              GREATEST(0, current_stock - reserved_stock) as available_stock
       FROM warehouse_stocks
       WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?`,
      [restaurantId, warehouseId, menuItemId]
    );

    if (rows.length === 0) {
      return { currentStock: 0, reservedStock: 0, availableStock: 0 };
    }

    return {
      currentStock: parseFloat(rows[0].current_stock || 0),
      reservedStock: parseFloat(rows[0].reserved_stock || 0),
      availableStock: parseFloat(rows[0].available_stock || 0)
    };
  }
}

module.exports = StockMovementService;
