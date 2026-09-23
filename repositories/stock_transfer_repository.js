const pool = require('../config/db');
const StockMovementService = require('../services/stock_movement_service');
const { getISTDateString } = require('../utils/date_utils');

class StockTransferRepository {
  /**
   * Fetch all stock transfers for a tenant
   */
  static async getAll(restaurantId, filters = {}) {
    const { status, warehouse_id, date_from, date_to, search } = filters;

    let query = `
      SELECT 
        st.*,
        w_src.name as source_warehouse_name,
        w_src.code as source_warehouse_code,
        w_dest.name as destination_warehouse_name,
        w_dest.code as destination_warehouse_code,
        sr.request_number,
        COUNT(sti.id) as total_items,
        COALESCE(SUM(sti.sent_qty), 0) as total_sent_qty,
        COALESCE(SUM(sti.received_qty), 0) as total_received_qty,
        COALESCE(SUM(sti.damaged_qty), 0) as total_damaged_qty
      FROM stock_transfers st
      LEFT JOIN warehouses w_src ON st.source_warehouse_id = w_src.id
      LEFT JOIN warehouses w_dest ON st.destination_warehouse_id = w_dest.id
      LEFT JOIN stock_requests sr ON st.stock_request_id = sr.id
      LEFT JOIN stock_transfer_items sti ON st.id = sti.stock_transfer_id
      WHERE st.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND st.status = ?';
      params.push(status);
    }

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND (st.source_warehouse_id = ? OR st.destination_warehouse_id = ?)';
      params.push(warehouse_id, warehouse_id);
    }

    if (date_from) {
      query += ' AND st.transfer_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      query += ' AND st.transfer_date <= ?';
      params.push(date_to);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (st.transfer_number LIKE ? OR st.created_by_name LIKE ? OR sr.request_number LIKE ?)';
      params.push(s, s, s);
    }

    query += ' GROUP BY st.id ORDER BY st.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get stock transfer by ID with line items
   */
  static async getById(id, restaurantId) {
    const [headerRows] = await pool.execute(`
      SELECT 
        st.*,
        w_src.name as source_warehouse_name,
        w_src.code as source_warehouse_code,
        w_dest.name as destination_warehouse_name,
        w_dest.code as destination_warehouse_code,
        sr.request_number
      FROM stock_transfers st
      LEFT JOIN warehouses w_src ON st.source_warehouse_id = w_src.id
      LEFT JOIN warehouses w_dest ON st.destination_warehouse_id = w_dest.id
      LEFT JOIN stock_requests sr ON st.stock_request_id = sr.id
      WHERE st.id = ? AND st.restaurant_id = ?
    `, [id, restaurantId]);

    if (headerRows.length === 0) return null;

    const transfer = headerRows[0];

    const [items] = await pool.execute(`
      SELECT 
        sti.*,
        mi.sku,
        mi.item_code,
        mi.price
      FROM stock_transfer_items sti
      JOIN menu_items mi ON sti.menu_item_id = mi.id
      WHERE sti.stock_transfer_id = ?
      ORDER BY sti.id ASC
    `, [id]);

    transfer.items = items;
    return transfer;
  }

  /**
   * Create and optionally dispatch a stock transfer
   */
  static async create(restaurantId, userId, userName, data) {
    const {
      stock_request_id = null,
      transfer_date,
      source_warehouse_id,
      destination_warehouse_id,
      status = 'in_transit', // default to direct dispatch if not specified
      notes,
      items
    } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Stock transfer must contain at least one item.');
    }

    if (parseInt(source_warehouse_id) === parseInt(destination_warehouse_id)) {
      throw new Error('Source and destination warehouse cannot be the same.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Generate sequence number ST-YYYYMMDD-XXXX
      const effectiveDate = transfer_date || getISTDateString();
      const today = effectiveDate.replace(/-/g, '');
      const prefix = `ST-${today}-`;

      const [seqRows] = await connection.execute(
        'SELECT transfer_number FROM stock_transfers WHERE restaurant_id = ? AND transfer_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].transfer_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const transferNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      const initialStatus = status === 'draft' ? 'draft' : 'in_transit';

      const [result] = await connection.execute(`
        INSERT INTO stock_transfers (
          restaurant_id, transfer_number, stock_request_id,
          transfer_date, source_warehouse_id, destination_warehouse_id,
          created_by_user_id, created_by_name, status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, transferNumber, stock_request_id || null,
        effectiveDate,
        source_warehouse_id, destination_warehouse_id,
        userId, userName || 'Staff',
        initialStatus, notes || null
      ]);

      const transferId = result.insertId;

      for (const item of items) {
        const menuItemId = item.menu_item_id || item.id;
        const sentQty = parseFloat(item.sent_qty || item.quantity || item.approved_qty) || 0;
        const unitCost = parseFloat(item.unit_cost || item.cost_price || item.price || 0);

        const sourceRackId = item.source_rack_id || null;
        const destinationRackId = item.destination_rack_id || null;

        await connection.execute(`
          INSERT INTO stock_transfer_items (
            stock_transfer_id, menu_item_id, item_name, unit,
            sent_qty, received_qty, damaged_qty, unit_cost, notes,
            source_rack_id, destination_rack_id
          ) VALUES (?, ?, ?, ?, ?, 0.000, 0.000, ?, ?, ?, ?)
        `, [
          transferId, menuItemId, item.item_name || item.name,
          item.unit || 'pcs', sentQty, unitCost, item.notes || null,
          sourceRackId, destinationRackId
        ]);

        // If in_transit: Deduct from source warehouse (and source rack)
        if (initialStatus === 'in_transit') {
          await StockMovementService.recordMovement(connection, {
            restaurantId,
            warehouseId: source_warehouse_id,
            rackId: sourceRackId,
            destRackId: destinationRackId,
            menuItemId,
            type: 'TRANSFER_OUT',
            quantity: -sentQty,
            unitCost,
            referenceType: 'stock_transfer',
            referenceId: transferId,
            referenceNumber: transferNumber,
            userId,
            userName,
            notes: `Transfer Out to warehouse #${destination_warehouse_id} (${transferNumber})`
          });
        }
      }

      // If linked to a stock request, update its status
      if (stock_request_id) {
        await connection.execute(
          'UPDATE stock_requests SET status = "transferred", updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
          [stock_request_id, restaurantId]
        );
      }

      await connection.commit();
      return this.getById(transferId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Receive stock at destination warehouse
   */
  static async receive(id, restaurantId, userId, userName, receiveData) {
    const { items, receiving_notes } = receiveData;

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [trRows] = await connection.execute(
        'SELECT * FROM stock_transfers WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [id, restaurantId]
      );

      if (trRows.length === 0) throw new Error('Stock transfer not found.');

      const transfer = trRows[0];

      if (transfer.status !== 'in_transit' && transfer.status !== 'partially_received') {
        throw new Error(`Cannot receive transfer in "${transfer.status}" status.`);
      }

      let allFull = true;

      for (const it of items) {
        const receivedQty = parseFloat(it.received_qty) || 0;
        const damagedQty = parseFloat(it.damaged_qty) || 0;
        const sentQty = parseFloat(it.sent_qty) || 0;

        if (receivedQty < sentQty) allFull = false;

        const destRackId = it.destination_rack_id || null;

        await connection.execute(`
          UPDATE stock_transfer_items SET
            received_qty = ?,
            damaged_qty = ?,
            destination_rack_id = COALESCE(?, destination_rack_id),
            notes = COALESCE(?, notes)
          WHERE id = ? AND stock_transfer_id = ?
        `, [receivedQty, damagedQty, destRackId, it.notes || null, it.id, id]);

        // Credit received qty to destination warehouse (and destination rack)
        if (receivedQty > 0) {
          await StockMovementService.recordMovement(connection, {
            restaurantId,
            warehouseId: transfer.destination_warehouse_id,
            rackId: destRackId,
            menuItemId: it.menu_item_id,
            type: 'TRANSFER_IN',
            quantity: receivedQty,
            unitCost: it.unit_cost || 0,
            referenceType: 'stock_transfer',
            referenceId: id,
            referenceNumber: transfer.transfer_number,
            userId,
            userName,
            notes: `Transfer In from warehouse #${transfer.source_warehouse_id} (${transfer.transfer_number})`
          });
        }

        // Record damaged/rejected quantity as damage in ledger for audit transparency
        if (damagedQty > 0) {
          await StockMovementService.recordMovement(connection, {
            restaurantId,
            warehouseId: transfer.destination_warehouse_id,
            menuItemId: it.menu_item_id,
            type: 'DAMAGE',
            quantity: 0, // Not adding to stock, but logged in ledger with damage count
            unitCost: it.unit_cost || 0,
            referenceType: 'stock_transfer',
            referenceId: id,
            referenceNumber: transfer.transfer_number,
            userId,
            userName,
            notes: `Damaged/Rejected during transit: ${damagedQty} units`
          });
        }
      }

      const finalStatus = allFull ? 'received' : 'partially_received';

      await connection.execute(`
        UPDATE stock_transfers SET
          status = ?,
          received_by_user_id = ?,
          received_by_name = ?,
          received_at = NOW(),
          receiving_notes = COALESCE(?, receiving_notes),
          updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [finalStatus, userId, userName, receiving_notes || null, id, restaurantId]);

      // If linked to request, update request status
      if (transfer.stock_request_id) {
        await connection.execute(
          'UPDATE stock_requests SET status = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
          [finalStatus === 'received' ? 'received' : 'partially_received', transfer.stock_request_id, restaurantId]
        );
      }

      await connection.commit();
      return this.getById(id, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = StockTransferRepository;
