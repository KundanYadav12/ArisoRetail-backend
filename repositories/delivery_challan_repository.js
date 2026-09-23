const pool = require('../config/db');
const { getISTDateString, getISTDatePrefix } = require('../utils/date_utils');

class DeliveryChallanRepository {
  /**
   * Concurrency-safe daily sequence generator for Delivery Challans (DC-YYYYMMDD-0001)
   */
  static async getNextChallanNumber(connection, restaurantId) {
    const dateStr = getISTDatePrefix();
    const prefix = `DC-${dateStr}-`;

    const [rows] = await connection.execute(
      'SELECT challan_number FROM delivery_challans WHERE restaurant_id = ? AND challan_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextNum = 1;
    if (rows.length > 0) {
      const parts = rows[0].challan_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        nextNum = lastSeq + 1;
      }
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Create a Delivery Challan from a Sales Order (supports partial delivery)
   */
  static async create(restaurantId, challanData, items, userId, userName) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const {
        sales_order_id,
        warehouse_id,
        party_id,
        party_name,
        party_phone,
        delivery_address,
        challan_date,
        vehicle_number,
        driver_name,
        driver_phone,
        notes
      } = challanData;

      // 1. Lock and verify Sales Order exists and belongs to this tenant
      const [orderRows] = await connection.execute(
        'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [sales_order_id, restaurantId]
      );

      if (orderRows.length === 0) {
        throw new Error('Sales Order not found or unauthorized.');
      }

      const salesOrder = orderRows[0];
      if (salesOrder.order_status === 'cancelled') {
        throw new Error('Cannot create delivery challan for a cancelled order.');
      }

      // 2. Generate unique Challan Number
      const challanNumber = await this.getNextChallanNumber(connection, restaurantId);

      // 3. Insert Delivery Challan
      const [challanResult] = await connection.execute(
        `INSERT INTO delivery_challans (
          restaurant_id, challan_number, sales_order_id, warehouse_id, party_id,
          party_name, party_phone, delivery_address, challan_date, vehicle_number,
          driver_name, driver_phone, status, notes, created_by_user_id, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dispatched', ?, ?, ?)`,
        [
          restaurantId,
          challanNumber,
          sales_order_id,
          warehouse_id || salesOrder.warehouse_id || null,
          party_id || salesOrder.customer_id || null,
          party_name || salesOrder.customer_name || 'Customer',
          party_phone || salesOrder.customer_phone || null,
          delivery_address || salesOrder.shipping_address || salesOrder.billing_address || null,
          challan_date || getISTDateString(),
          vehicle_number || null,
          driver_name || null,
          driver_phone || null,
          notes || null,
          (!isNaN(parseInt(userId)) ? parseInt(userId) : null),
          userName || (typeof userId === 'string' && isNaN(parseInt(userId)) ? userId : 'Staff')
        ]
      );

      const challanId = challanResult.insertId;

      // 4. Process line items with strict partial delivery quantity validation
      const lineItems = items || challanData.items || [];
      for (const item of lineItems) {
        const orderItemId = item.order_item_id;
        const deliveryQty = parseFloat(item.delivered_qty || item.quantity || 0);

        if (deliveryQty <= 0) continue; // Skip zero deliveries

        const [oiRows] = await connection.execute(
          'SELECT * FROM order_items WHERE id = ? AND order_id = ? FOR UPDATE',
          [orderItemId, sales_order_id]
        );

        if (oiRows.length === 0) {
          throw new Error(`Order item #${orderItemId} does not belong to this Sales Order.`);
        }

        const oi = oiRows[0];
        const orderedQty = oi.item_weight !== null ? parseFloat(oi.item_weight) : parseFloat(oi.quantity);
        const alreadyDelivered = parseFloat(oi.delivered_qty || 0);
        const pendingToDeliver = Math.max(0, orderedQty - alreadyDelivered);

        if (deliveryQty > pendingToDeliver + 0.001) {
          throw new Error(`Cannot deliver ${deliveryQty} ${oi.weight_unit || 'PCS'} of "${oi.name}". Remaining pending delivery is only ${pendingToDeliver}.`);
        }

        // Insert challan item
        await connection.execute(
          `INSERT INTO delivery_challan_items (
            delivery_challan_id, order_item_id, menu_item_id, item_name, unit, ordered_qty, delivered_qty, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            challanId,
            orderItemId,
            oi.menu_item_id,
            oi.name,
            oi.weight_unit || 'PCS',
            orderedQty,
            deliveryQty,
            item.notes || null
          ]
        );

        // Update delivered_qty on order_items
        const newDeliveredQty = alreadyDelivered + deliveryQty;
        await connection.execute(
          'UPDATE order_items SET delivered_qty = ? WHERE id = ?',
          [newDeliveredQty, orderItemId]
        );
      }

      // 5. Evaluate overall fulfillment status of the Sales Order
      const [allOiRows] = await connection.execute(
        'SELECT quantity, item_weight, delivered_qty, invoiced_qty FROM order_items WHERE order_id = ?',
        [sales_order_id]
      );

      let allFulfilled = true;
      let anyDelivered = false;

      for (const row of allOiRows) {
        const totalReq = row.item_weight !== null ? parseFloat(row.item_weight) : parseFloat(row.quantity);
        const deliv = parseFloat(row.delivered_qty || 0);
        if (deliv > 0) anyDelivered = true;
        if (deliv < totalReq - 0.001) {
          allFulfilled = false;
        }
      }

      // Determine updated order_status without overwriting invoiced status inappropriately
      let newOrderStatus = salesOrder.order_status;
      if (allFulfilled) {
        newOrderStatus = salesOrder.order_status === 'invoiced' ? 'invoiced' : 'fulfilled';
      } else if (anyDelivered) {
        newOrderStatus = salesOrder.order_status === 'invoiced' ? 'invoiced' : 'partially_fulfilled';
      }

      await connection.execute(
        'UPDATE orders SET order_status = ?, updated_at = NOW() WHERE id = ?',
        [newOrderStatus, sales_order_id]
      );

      await connection.commit();

      return {
        success: true,
        challanId,
        challanNumber,
        salesOrderId: sales_order_id,
        orderStatus: newOrderStatus
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Get single Delivery Challan by ID with items
   */
  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      `SELECT dc.*, o.unique_order_number AS sales_order_number, o.reference_number AS so_ref_number,
              w.name AS warehouse_name
       FROM delivery_challans dc
       LEFT JOIN orders o ON dc.sales_order_id = o.id
       LEFT JOIN warehouses w ON dc.warehouse_id = w.id
       WHERE dc.id = ? AND dc.restaurant_id = ?`,
      [id, restaurantId]
    );

    if (rows.length === 0) return null;
    const challan = rows[0];

    const [items] = await pool.execute(
      `SELECT dci.*, oi.price, oi.tax_amount, oi.discount_amount
       FROM delivery_challan_items dci
       LEFT JOIN order_items oi ON dci.order_item_id = oi.id
       WHERE dci.delivery_challan_id = ?`,
      [id]
    );

    challan.items = items;
    return challan;
  }

  /**
   * Get all Delivery Challans for a specific Sales Order
   */
  static async getBySalesOrderId(salesOrderId, restaurantId) {
    const [rows] = await pool.execute(
      `SELECT dc.*, 
              (SELECT COUNT(*) FROM delivery_challan_items dci WHERE dci.delivery_challan_id = dc.id) AS total_items,
              (SELECT COALESCE(SUM(delivered_qty), 0) FROM delivery_challan_items dci WHERE dci.delivery_challan_id = dc.id) AS total_delivered_qty
       FROM delivery_challans dc
       WHERE dc.sales_order_id = ? AND dc.restaurant_id = ?
       ORDER BY dc.id DESC`,
      [salesOrderId, restaurantId]
    );

    return rows;
  }

  /**
   * List all Delivery Challans for a restaurant (paginated & filtered)
   */
  static async getAll(restaurantId, filters = {}) {
    const { search, status, warehouse_id, date_from, date_to, limit = 50, offset = 0 } = filters;
    let query = `
      SELECT dc.*, o.unique_order_number AS sales_order_number, w.name AS warehouse_name,
             (SELECT COUNT(*) FROM delivery_challan_items dci WHERE dci.delivery_challan_id = dc.id) AS total_items,
             (SELECT COALESCE(SUM(delivered_qty), 0) FROM delivery_challan_items dci WHERE dci.delivery_challan_id = dc.id) AS total_delivered_qty
      FROM delivery_challans dc
      LEFT JOIN orders o ON dc.sales_order_id = o.id
      LEFT JOIN warehouses w ON dc.warehouse_id = w.id
      WHERE dc.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND dc.status = ?';
      params.push(status);
    }
    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND dc.warehouse_id = ?';
      params.push(warehouse_id);
    }
    if (date_from) {
      query += ' AND dc.challan_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND dc.challan_date <= ?';
      params.push(date_to);
    }
    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (dc.challan_number LIKE ? OR dc.party_name LIKE ? OR dc.party_phone LIKE ? OR dc.vehicle_number LIKE ? OR o.unique_order_number LIKE ?)';
      params.push(s, s, s, s, s);
    }

    query += ' ORDER BY dc.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Cancel a Delivery Challan and reverse delivered quantities on order items
   */
  static async cancel(id, restaurantId, userId, userName, reason = '') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.execute(
        'SELECT * FROM delivery_challans WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [id, restaurantId]
      );

      if (rows.length === 0) {
        throw new Error('Delivery Challan not found.');
      }

      const challan = rows[0];
      if (challan.status === 'cancelled') {
        throw new Error('Challan is already cancelled.');
      }

      // 1. Fetch items to reverse delivered_qty
      const [items] = await connection.execute(
        'SELECT * FROM delivery_challan_items WHERE delivery_challan_id = ?',
        [id]
      );

      for (const item of items) {
        await connection.execute(
          'UPDATE order_items SET delivered_qty = GREATEST(0, delivered_qty - ?) WHERE id = ?',
          [parseFloat(item.delivered_qty), item.order_item_id]
        );
      }

      // 2. Mark challan cancelled
      await connection.execute(
        'UPDATE delivery_challans SET status = "cancelled", notes = CONCAT(COALESCE(notes, ""), " [Cancelled: ", ?, "]"), updated_at = NOW() WHERE id = ?',
        [reason || 'User cancelled', id]
      );

      // 3. Recalculate Sales Order status
      const [oiRows] = await connection.execute(
        'SELECT quantity, item_weight, delivered_qty FROM order_items WHERE order_id = ?',
        [challan.sales_order_id]
      );

      let anyDelivered = false;
      let allDelivered = oiRows.length > 0;
      for (const r of oiRows) {
        const totalReq = r.item_weight !== null ? parseFloat(r.item_weight) : parseFloat(r.quantity);
        const deliv = parseFloat(r.delivered_qty || 0);
        if (deliv > 0) anyDelivered = true;
        if (deliv < totalReq - 0.001) allDelivered = false;
      }

      const newStatus = allDelivered ? 'fulfilled' : (anyDelivered ? 'partially_fulfilled' : 'pending');
      await connection.execute(
        'UPDATE orders SET order_status = ? WHERE id = ?',
        [newStatus, challan.sales_order_id]
      );

      await connection.commit();
      return { success: true, message: 'Delivery Challan cancelled and delivered quantities reverted.' };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = DeliveryChallanRepository;
