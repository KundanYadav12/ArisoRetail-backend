const pool = require('../config/db');
const StockAdjustmentRepository = require('./stock_adjustment_repository');
const { getISTDatePrefix } = require('../utils/date_utils');

class StockCountingRepository {
  // ===========================================================================
  // DEVICES
  // ===========================================================================

  static async getDevices(restaurantId, warehouseId = null) {
    let query = `
      SELECT 
        d.*,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        u.name AS assigned_user_name,
        (SELECT COUNT(*) FROM stock_counting_assignments a 
         WHERE a.device_id = d.id AND a.status IN ('assigned', 'in_progress')) AS active_assignments_count
      FROM stock_counting_devices d
      LEFT JOIN warehouses w ON d.warehouse_id = w.id
      LEFT JOIN users u ON d.assigned_user_id = u.id
      WHERE d.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (warehouseId && warehouseId !== 'all') {
      query += ' AND d.warehouse_id = ?';
      params.push(warehouseId);
    }

    query += ' ORDER BY d.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  static async getDeviceById(id, restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        d.*,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        u.name AS assigned_user_name
      FROM stock_counting_devices d
      LEFT JOIN warehouses w ON d.warehouse_id = w.id
      LEFT JOIN users u ON d.assigned_user_id = u.id
      WHERE d.id = ? AND d.restaurant_id = ?
    `, [id, restaurantId]);

    return rows[0] || null;
  }

  static async createDevice(restaurantId, data) {
    const { device_code, device_name, warehouse_id, assigned_user_id = null, notes = null } = data;

    if (!device_code || !device_name || !warehouse_id) {
      throw new Error('device_code, device_name, and warehouse_id are required.');
    }

    const [dup] = await pool.execute(
      'SELECT id FROM stock_counting_devices WHERE restaurant_id = ? AND device_code = ?',
      [restaurantId, device_code.trim()]
    );
    if (dup.length > 0) {
      throw new Error(`Device code "${device_code}" already exists.`);
    }

    const [res] = await pool.execute(`
      INSERT INTO stock_counting_devices (
        restaurant_id, warehouse_id, device_code, device_name,
        assigned_user_id, status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, NOW())
    `, [restaurantId, warehouse_id, device_code.trim(), device_name.trim(), assigned_user_id || null, notes]);

    return this.getDeviceById(res.insertId, restaurantId);
  }

  static async updateDevice(id, restaurantId, data) {
    const { device_name, warehouse_id, assigned_user_id, status, notes } = data;

    await pool.execute(`
      UPDATE stock_counting_devices SET
        device_name = COALESCE(?, device_name),
        warehouse_id = COALESCE(?, warehouse_id),
        assigned_user_id = ?,
        status = COALESCE(?, status),
        notes = ?,
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [
      device_name || null,
      warehouse_id || null,
      assigned_user_id !== undefined ? assigned_user_id : null,
      status || null,
      notes !== undefined ? notes : null,
      id,
      restaurantId
    ]);

    return this.getDeviceById(id, restaurantId);
  }

  static async deleteDevice(id, restaurantId) {
    // Check if assignments exist
    const [assigns] = await pool.execute(
      'SELECT id FROM stock_counting_assignments WHERE device_id = ? AND restaurant_id = ? LIMIT 1',
      [id, restaurantId]
    );
    if (assigns.length > 0) {
      throw new Error('Cannot delete device with existing assignments. Reassign or remove them first.');
    }

    await pool.execute('DELETE FROM stock_counting_devices WHERE id = ? AND restaurant_id = ?', [id, restaurantId]);
    return { success: true, message: 'Device deleted successfully.' };
  }

  // ===========================================================================
  // PRODUCT ASSIGNMENTS (STRICT PRODUCT RESTRICTION)
  // ===========================================================================

  static async getAssignments(restaurantId, filters = {}) {
    const { device_id, warehouse_id, status } = filters;

    let query = `
      SELECT 
        a.*,
        d.device_code,
        d.device_name,
        mi.name AS product_name,
        mi.sku,
        mi.barcode,
        mi.item_code,
        w.name AS warehouse_name,
        r.rack_code,
        r.rack_name,
        COALESCE(prs.current_stock, ws.current_stock, 0) AS system_stock
      FROM stock_counting_assignments a
      JOIN stock_counting_devices d ON a.device_id = d.id
      JOIN menu_items mi ON a.menu_item_id = mi.id
      JOIN warehouses w ON a.warehouse_id = w.id
      LEFT JOIN warehouse_racks r ON a.rack_id = r.id
      LEFT JOIN product_rack_stocks prs ON (prs.warehouse_id = a.warehouse_id AND prs.rack_id = a.rack_id AND prs.menu_item_id = a.menu_item_id)
      LEFT JOIN warehouse_stocks ws ON (ws.warehouse_id = a.warehouse_id AND ws.menu_item_id = a.menu_item_id)
      WHERE a.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (device_id) {
      query += ' AND a.device_id = ?';
      params.push(device_id);
    }
    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND a.warehouse_id = ?';
      params.push(warehouse_id);
    }
    if (status && status !== 'all') {
      query += ' AND a.status = ?';
      params.push(status);
    }

    query += ' ORDER BY a.assigned_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  static async assignProductsToDevice(restaurantId, userId, userName, data) {
    const { device_id, warehouse_id, rack_id = null, product_ids } = data;

    if (!device_id || !warehouse_id || !Array.isArray(product_ids) || product_ids.length === 0) {
      throw new Error('device_id, warehouse_id, and an array of product_ids are required.');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let assignedCount = 0;
      for (const prodId of product_ids) {
        // Upsert assignment or activate if previously cancelled
        const [existing] = await connection.execute(
          'SELECT id FROM stock_counting_assignments WHERE restaurant_id = ? AND device_id = ? AND menu_item_id = ?',
          [restaurantId, device_id, prodId]
        );

        if (existing.length > 0) {
          await connection.execute(`
            UPDATE stock_counting_assignments SET
              warehouse_id = ?,
              rack_id = ?,
              status = 'assigned',
              assigned_by_user_id = ?,
              assigned_by_name = ?,
              assigned_at = NOW()
            WHERE id = ?
          `, [warehouse_id, rack_id || null, userId, userName || 'Manager', existing[0].id]);
        } else {
          await connection.execute(`
            INSERT INTO stock_counting_assignments (
              restaurant_id, device_id, menu_item_id, warehouse_id, rack_id,
              assigned_by_user_id, assigned_by_name, status, assigned_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'assigned', NOW())
          `, [restaurantId, device_id, prodId, warehouse_id, rack_id || null, userId, userName || 'Manager']);
        }
        assignedCount++;
      }

      await connection.commit();
      return { success: true, count: assignedCount };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async removeAssignment(id, restaurantId) {
    await pool.execute('DELETE FROM stock_counting_assignments WHERE id = ? AND restaurant_id = ?', [id, restaurantId]);
    return { success: true, message: 'Assignment removed.' };
  }

  // ===========================================================================
  // BARCODE SCAN RESTRICTION & VALIDATION
  // ===========================================================================

  /**
   * Validates scanned barcode against assigned products for this device.
   * If not assigned, rejects scan and prevents modification of inventory.
   */
  static async validateBarcodeScan(restaurantId, scanData) {
    const { device_code = null, barcode, warehouse_id = null, rack_id = null } = scanData;

    if (!barcode || !String(barcode).trim()) {
      return {
        success: false,
        code: 'MISSING_PARAMS',
        message: 'Barcode is required.'
      };
    }

    const trimmedBarcode = String(barcode).trim();
    const trimmedCode = device_code ? String(device_code).trim() : null;

    // Case 1: Standalone / Camera scan without a registered device
    if (!trimmedCode) {
      let targetWarehouseId = warehouse_id;
      if (!targetWarehouseId) {
        const [whRows] = await pool.execute(
          'SELECT id FROM warehouses WHERE restaurant_id = ? AND is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1',
          [restaurantId]
        );
        if (whRows.length > 0) {
          targetWarehouseId = whRows[0].id;
        }
      }

      // Lookup product by barcode (or SKU/item_code)
      const [itemRows] = await pool.execute(`
        SELECT id, name, sku, barcode, item_code, unit, price, cost_price, current_stock
        FROM menu_items
        WHERE restaurant_id = ? AND (barcode = ? OR sku = ? OR item_code = ?)
        LIMIT 1
      `, [restaurantId, trimmedBarcode, trimmedBarcode, trimmedBarcode]);

      if (itemRows.length === 0) {
        return {
          success: false,
          code: 'NO_DATA',
          message: `No item found for barcode "${trimmedBarcode}"`
        };
      }

      const product = itemRows[0];
      let systemStock = 0;
      let rackCode = null;
      let rackName = null;

      if (rack_id) {
        const [prs] = await pool.execute(
          'SELECT current_stock FROM product_rack_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ?',
          [restaurantId, targetWarehouseId, rack_id, product.id]
        );
        if (prs.length > 0) systemStock = parseFloat(prs[0].current_stock || 0);

        const [rRows] = await pool.execute('SELECT rack_code, rack_name FROM warehouse_racks WHERE id = ?', [rack_id]);
        if (rRows.length > 0) {
          rackCode = rRows[0].rack_code;
          rackName = rRows[0].rack_name;
        }
      } else if (targetWarehouseId) {
        const [ws] = await pool.execute(
          'SELECT current_stock FROM warehouse_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
          [restaurantId, targetWarehouseId, product.id]
        );
        if (ws.length > 0) systemStock = parseFloat(ws[0].current_stock || 0);
      }

      return {
        success: true,
        code: 'PRODUCT_VERIFIED',
        device: null,
        assignment_id: null,
        product: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          item_code: product.item_code,
          unit: product.unit || 'pcs',
          cost_price: parseFloat(product.cost_price || 0)
        },
        warehouse_id: targetWarehouseId,
        rack_id: rack_id || null,
        rack_code: rackCode,
        rack_name: rackName,
        system_stock: systemStock
      };
    }

    // Case 2: Registered Hardware Scanner / Device terminal
    // 1. Verify device exists and is active
    const [devRows] = await pool.execute(
      'SELECT id, warehouse_id, status FROM stock_counting_devices WHERE restaurant_id = ? AND device_code = ?',
      [restaurantId, trimmedCode]
    );

    if (devRows.length === 0) {
      return {
        success: false,
        code: 'DEVICE_NOT_FOUND',
        message: `Device with code "${trimmedCode}" not found.`
      };
    }

    const device = devRows[0];
    if (device.status !== 'active') {
      return {
        success: false,
        code: 'DEVICE_INACTIVE',
        message: `Device is currently "${device.status}". Cannot perform count.`
      };
    }

    const targetWarehouseId = warehouse_id || device.warehouse_id;

    // Update last_active_at
    await pool.execute('UPDATE stock_counting_devices SET last_active_at = NOW() WHERE id = ?', [device.id]);

    // 2. Lookup product by barcode (or SKU/item_code)
    const [itemRows] = await pool.execute(`
      SELECT id, name, sku, barcode, item_code, unit, price, cost_price, current_stock
      FROM menu_items
      WHERE restaurant_id = ? AND (barcode = ? OR sku = ? OR item_code = ?)
      LIMIT 1
    `, [restaurantId, trimmedBarcode, trimmedBarcode, trimmedBarcode]);

    if (itemRows.length === 0) {
      return {
        success: false,
        code: 'NO_DATA',
        message: 'No Data / Product Not Found'
      };
    }

    const product = itemRows[0];

    // 3. Strict Device-Product assignment check
    const [assignRows] = await pool.execute(`
      SELECT id, rack_id, status
      FROM stock_counting_assignments
      WHERE restaurant_id = ? AND device_id = ? AND menu_item_id = ?
        AND status IN ('assigned', 'in_progress')
      LIMIT 1
    `, [restaurantId, device.id, product.id]);

    if (assignRows.length === 0) {
      return {
        success: false,
        code: 'PRODUCT_NOT_ASSIGNED',
        message: 'No Data / Product Not Assigned to this Device'
      };
    }

    const assignment = assignRows[0];
    const targetRackId = rack_id || assignment.rack_id;

    // 4. Fetch exact location system stock
    let systemStock = 0;
    let rackName = null;
    let rackCode = null;

    if (targetRackId) {
      const [prs] = await pool.execute(
        'SELECT current_stock FROM product_rack_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ?',
        [restaurantId, targetWarehouseId, targetRackId, product.id]
      );
      if (prs.length > 0) {
        systemStock = parseFloat(prs[0].current_stock || 0);
      }
      const [rRows] = await pool.execute('SELECT rack_code, rack_name FROM warehouse_racks WHERE id = ?', [targetRackId]);
      if (rRows.length > 0) {
        rackCode = rRows[0].rack_code;
        rackName = rRows[0].rack_name;
      }
    } else {
      const [ws] = await pool.execute(
        'SELECT current_stock FROM warehouse_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
        [restaurantId, targetWarehouseId, product.id]
      );
      if (ws.length > 0) {
        systemStock = parseFloat(ws[0].current_stock || 0);
      }
    }

    return {
      success: true,
      code: 'PRODUCT_ASSIGNED',
      device: {
        id: device.id,
        device_code: trimmedCode
      },
      assignment_id: assignment.id,
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        item_code: product.item_code,
        unit: product.unit || 'pcs',
        cost_price: parseFloat(product.cost_price || 0)
      },
      warehouse_id: targetWarehouseId,
      rack_id: targetRackId,
      rack_code: rackCode,
      rack_name: rackName,
      system_stock: systemStock
    };
  }

  // ===========================================================================
  // STOCK COUNT SESSIONS
  // ===========================================================================

  static async getSessions(restaurantId, filters = {}) {
    const { warehouse_id, rack_id, status, date_from, date_to, search } = filters;

    let query = `
      SELECT 
        s.*,
        mi.name AS product_name,
        mi.sku,
        mi.barcode,
        mi.unit,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        r.rack_code,
        r.rack_name,
        d.device_code,
        d.device_name,
        sa.adjustment_number
      FROM stock_count_sessions s
      JOIN menu_items mi ON s.menu_item_id = mi.id
      JOIN warehouses w ON s.warehouse_id = w.id
      LEFT JOIN warehouse_racks r ON s.rack_id = r.id
      LEFT JOIN stock_counting_devices d ON s.device_id = d.id
      LEFT JOIN stock_adjustments sa ON s.stock_adjustment_id = sa.id
      WHERE s.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND s.warehouse_id = ?';
      params.push(warehouse_id);
    }
    if (rack_id) {
      query += ' AND s.rack_id = ?';
      params.push(rack_id);
    }
    if (status && status !== 'all') {
      query += ' AND s.status = ?';
      params.push(status);
    }
    if (date_from) {
      query += ' AND s.created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND s.created_at <= ?';
      params.push(date_to);
    }
    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (s.session_number LIKE ? OR mi.name LIKE ? OR mi.sku LIKE ? OR s.counted_by_name LIKE ?)';
      params.push(s, s, s, s);
    }

    query += ' ORDER BY s.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  static async getSessionById(id, restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        s.*,
        mi.name AS product_name,
        mi.sku,
        mi.barcode,
        mi.unit,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        r.rack_code,
        r.rack_name,
        d.device_code,
        d.device_name,
        sa.adjustment_number
      FROM stock_count_sessions s
      JOIN menu_items mi ON s.menu_item_id = mi.id
      JOIN warehouses w ON s.warehouse_id = w.id
      LEFT JOIN warehouse_racks r ON s.rack_id = r.id
      LEFT JOIN stock_counting_devices d ON s.device_id = d.id
      LEFT JOIN stock_adjustments sa ON s.stock_adjustment_id = sa.id
      WHERE s.id = ? AND s.restaurant_id = ?
    `, [id, restaurantId]);

    return rows[0] || null;
  }

  /**
   * Submit physical stock count.
   * DOES NOT alter inventory directly. Sets status to 'submitted' for manager review.
   */
  static async submitCountSession(restaurantId, userId, userName, data) {
    const {
      warehouse_id,
      rack_id = null,
      device_id = null,
      menu_item_id,
      counted_stock,
      notes = null
    } = data;

    if (!warehouse_id || !menu_item_id || counted_stock === undefined) {
      throw new Error('warehouse_id, menu_item_id, and counted_stock are required.');
    }

    const countedQty = parseFloat(counted_stock);
    if (isNaN(countedQty) || countedQty < 0) {
      throw new Error('counted_stock must be a non-negative number.');
    }

    // Fetch current system stock
    let systemStock = 0;
    if (rack_id) {
      const [prs] = await pool.execute(
        'SELECT current_stock FROM product_rack_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND rack_id = ? AND menu_item_id = ?',
        [restaurantId, warehouse_id, rack_id, menu_item_id]
      );
      if (prs.length > 0) {
        systemStock = parseFloat(prs[0].current_stock || 0);
      }
    } else {
      const [ws] = await pool.execute(
        'SELECT current_stock FROM warehouse_stocks WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
        [restaurantId, warehouse_id, menu_item_id]
      );
      if (ws.length > 0) {
        systemStock = parseFloat(ws[0].current_stock || 0);
      }
    }

    const variance = countedQty - systemStock;

    // Generate SCS number
    const today = getISTDatePrefix();
    const prefix = `SCS-${today}-`;
    const [seq] = await pool.execute(
      'SELECT session_number FROM stock_count_sessions WHERE restaurant_id = ? AND session_number LIKE ? ORDER BY id DESC LIMIT 1',
      [restaurantId, `${prefix}%`]
    );
    let seqNum = 1;
    if (seq.length > 0) {
      const last = parseInt(seq[0].session_number.split('-')[2], 10);
      if (!isNaN(last)) seqNum = last + 1;
    }
    const sessionNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

    const [res] = await pool.execute(`
      INSERT INTO stock_count_sessions (
        restaurant_id, session_number, warehouse_id, rack_id, device_id,
        menu_item_id, system_stock, counted_stock, variance,
        status, counted_by_user_id, counted_by_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, NOW())
    `, [
      restaurantId, sessionNumber, warehouse_id, rack_id || null, device_id || null,
      menu_item_id, systemStock, countedQty, variance,
      userId, userName || 'Staff', notes || null
    ]);

    // If device_id provided, mark assignment in_progress
    if (device_id) {
      await pool.execute(`
        UPDATE stock_counting_assignments
        SET status = 'in_progress'
        WHERE restaurant_id = ? AND device_id = ? AND menu_item_id = ?
      `, [restaurantId, device_id, menu_item_id]);
    }

    return this.getSessionById(res.insertId, restaurantId);
  }

  /**
   * Approve a stock count session.
   * If variance !== 0, generates a formal Stock Adjustment and creates ledger records.
   */
  static async approveSession(id, restaurantId, userId, userName, reviewNotes = null) {
    const session = await this.getSessionById(id, restaurantId);
    if (!session) throw new Error('Stock count session not found.');
    if (session.status !== 'submitted') {
      throw new Error(`Cannot approve session in "${session.status}" status.`);
    }

    const variance = parseFloat(session.variance || 0);
    let stockAdjustmentId = null;

    if (variance !== 0) {
      // Create formal stock adjustment atomically
      const adj = await StockAdjustmentRepository.create(
        restaurantId,
        userId,
        userName,
        {
          warehouse_id: session.warehouse_id,
          reason: `Stock Count Verification (${session.session_number})`,
          notes: reviewNotes || `Variance of ${variance > 0 ? '+' : ''}${variance} approved from physical count.`,
          items: [
            {
              menu_item_id: session.menu_item_id,
              adjustment_type: 'set',
              quantity: parseFloat(session.counted_stock),
              rack_id: session.rack_id || null
            }
          ]
        }
      );
      stockAdjustmentId = adj.id;
    }

    const newStatus = variance !== 0 ? 'adjusted' : 'approved';

    await pool.execute(`
      UPDATE stock_count_sessions SET
        status = ?,
        approved_by_user_id = ?,
        approved_by_name = ?,
        stock_adjustment_id = ?,
        notes = CONCAT(COALESCE(notes, ''), ?),
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [
      newStatus,
      userId,
      userName || 'Manager',
      stockAdjustmentId,
      reviewNotes ? ` | Review: ${reviewNotes}` : '',
      id,
      restaurantId
    ]);

    // Update assignment to completed if exists
    if (session.device_id) {
      await pool.execute(`
        UPDATE stock_counting_assignments
        SET status = 'completed', completed_at = NOW()
        WHERE restaurant_id = ? AND device_id = ? AND menu_item_id = ?
      `, [restaurantId, session.device_id, session.menu_item_id]);
    }

    return this.getSessionById(id, restaurantId);
  }

  /**
   * Reject a stock count session without adjusting stock.
   */
  static async rejectSession(id, restaurantId, userId, userName, reason) {
    const session = await this.getSessionById(id, restaurantId);
    if (!session) throw new Error('Stock count session not found.');
    if (session.status !== 'submitted') {
      throw new Error(`Cannot reject session in "${session.status}" status.`);
    }

    await pool.execute(`
      UPDATE stock_count_sessions SET
        status = 'rejected',
        approved_by_user_id = ?,
        approved_by_name = ?,
        notes = CONCAT(COALESCE(notes, ''), ?),
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [
      userId,
      userName || 'Manager',
      reason ? ` | Rejected: ${reason}` : ' | Rejected by manager',
      id,
      restaurantId
    ]);

    return this.getSessionById(id, restaurantId);
  }
}

module.exports = StockCountingRepository;
