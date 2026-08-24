const pool = require('../config/db');

class OrderRepository {
  static async getByIdempotencyKey(restaurantId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const [rows] = await pool.execute(
      'SELECT id, unique_order_number, total_amount, order_status FROM orders WHERE restaurant_id = ? AND idempotency_key = ? LIMIT 1',
      [restaurantId, idempotencyKey]
    );
    return rows[0] || null;
  }

  /**
   * Complete transactional order creation
   */
  static async create(restaurantId, orderData, items) {
    let attempts = 0;
    const MAX_RETRIES = 10;

    while (attempts < MAX_RETRIES) {
      attempts++;
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const {
          cashier_id,
          cashier_name,
          subtotal,
          tax_amount,
          discount_amount,
          total_amount,
          payment_mode,
          payment_details,
          cashier_shift_id,
          table_number_or_takeaway,
          notes,
          status,
          discount_type,
          discount_value,
          customer_name,
          customer_phone,
          idempotency_key
        } = orderData;

        // Check idempotency inside transaction for strict race-condition safety
        if (idempotency_key) {
          const [dupRows] = await connection.execute(
            'SELECT id, unique_order_number FROM orders WHERE restaurant_id = ? AND idempotency_key = ? LIMIT 1',
            [restaurantId, idempotency_key]
          );
          if (dupRows.length > 0) {
            await connection.rollback();
            connection.release();
            return {
              order: {
                id: dupRows[0].id,
                unique_order_number: dupRows[0].unique_order_number
              },
              isDuplicate: true
            };
          }
        }

        const safeSubtotal = isNaN(parseFloat(subtotal)) ? 0.00 : parseFloat(subtotal);
        const safeTaxAmount = isNaN(parseFloat(tax_amount)) ? 0.00 : parseFloat(tax_amount);
        const safeDiscountAmount = isNaN(parseFloat(discount_amount)) ? 0.00 : parseFloat(discount_amount);
        const safeTotalAmount = isNaN(parseFloat(total_amount)) ? 0.00 : parseFloat(total_amount);
        const orderStatus = status || 'completed';
        const safeCashierShiftId = cashier_shift_id === undefined ? null : cashier_shift_id;

        // 1. Fetch GST Settings
        const [settingsRows] = await connection.execute(
          'SELECT gst_mode FROM receipt_settings WHERE restaurant_id = ?',
          [restaurantId]
        );
        const gstMode = settingsRows[0]?.gst_mode || 'excluded';

        // 2. Concurrency-Safe Daily Order Number Generation (Format: ORD-YYYYMMDD-0001)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}${month}${day}`;
        const datePrefix = `ORD-${dateStr}-`;

        // Concurrency-Safe Atomic Sequence Generator
        const getNextSequence = async () => {
          // 1. Ensure a row exists in order_sequences for (restaurantId, dateStr)
          await connection.execute(
            'INSERT IGNORE INTO order_sequences (restaurant_id, order_date, last_seq) VALUES (?, ?, 0)',
            [restaurantId, dateStr]
          );

          // 2. Lock and fetch current last_seq for this date & restaurant
          const [seqRows] = await connection.execute(
            'SELECT last_seq FROM order_sequences WHERE restaurant_id = ? AND order_date = ? FOR UPDATE',
            [restaurantId, dateStr]
          );

          let currentSeq = parseInt(seqRows[0]?.last_seq || 0, 10);

          // 3. If currentSeq is 0, check max existing order sequence number for today from orders table
          if (currentSeq === 0) {
            const [maxOrd] = await connection.execute(
              'SELECT unique_order_number FROM orders WHERE restaurant_id = ? AND unique_order_number LIKE ? ORDER BY id DESC',
              [restaurantId, `${datePrefix}%`]
            );
            for (const row of maxOrd) {
              const parts = (row.unique_order_number || '').split('-');
              const num = parseInt(parts[parts.length - 1], 10);
              if (!isNaN(num) && num > currentSeq) {
                currentSeq = num;
              }
            }
          }

          // 4. Calculate next sequence number (bump by attempt offset on retries to guarantee progress)
          let nextSeq = currentSeq + 1;
          if (attempts > 1) {
            nextSeq = Math.max(nextSeq, currentSeq + (attempts - 1));
          }

          // 5. Save updated last_seq
          await connection.execute(
            'UPDATE order_sequences SET last_seq = ? WHERE restaurant_id = ? AND order_date = ?',
            [nextSeq, restaurantId, dateStr]
          );

          return nextSeq;
        };

        const seq = await getNextSequence();
        const seqStr = String(seq).padStart(4, '0');
        const uniqueOrderNumber = `${datePrefix}${seqStr}`;

        // 3. Insert Order
        const [orderResult] = await connection.execute(
          'INSERT INTO orders (order_number, unique_order_number, idempotency_key, restaurant_id, cashier_id, cashier_name, subtotal, tax_amount, discount_amount, total_amount, payment_mode, payment_details, order_status, cashier_shift_id, table_number_or_takeaway, notes, kitchen_status, discount_type, discount_value, customer_name, customer_phone) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pending", ?, ?, ?, ?)',
          [
            uniqueOrderNumber, uniqueOrderNumber, idempotency_key || null, restaurantId, cashier_id, cashier_name, safeSubtotal, safeTaxAmount,
            safeDiscountAmount, safeTotalAmount, payment_mode, payment_details ? JSON.stringify(payment_details) : null,
            orderStatus, safeCashierShiftId, table_number_or_takeaway || 'Takeaway', notes || null,
            discount_type || 'amount', parseFloat(discount_value || 0), customer_name || null, customer_phone || null
          ]
        );
        const orderId = orderResult.insertId;

        // 4. Insert Order Items (Respect GST Mode)
        for (const item of items) {
          const itemPrice = isNaN(parseFloat(item.price)) ? 0.00 : parseFloat(item.price);
          const itemGstRate = isNaN(parseFloat(item.gst_rate)) ? 0.00 : parseFloat(item.gst_rate);
          const itemQuantity = isNaN(parseInt(item.quantity)) ? 1 : parseInt(item.quantity);
          const itemWeight = item.item_weight !== undefined && item.item_weight !== null ? parseFloat(item.item_weight) : null;
          const weightUnit = item.weight_unit || item.unit || null;
          const baseUnitPrice = item.base_unit_price !== undefined && item.base_unit_price !== null ? parseFloat(item.base_unit_price) : null;
          const barcode = item.barcode || null;

          let unitPrice, itemTax;
          if (gstMode === 'included') {
            unitPrice = parseFloat((itemPrice / (1 + (itemGstRate / 100))).toFixed(4));
            itemTax = parseFloat(((itemPrice * itemQuantity) - (unitPrice * itemQuantity)).toFixed(2));
          } else {
            unitPrice = itemPrice;
            itemTax = parseFloat(((unitPrice * itemQuantity) * (itemGstRate / 100)).toFixed(2));
          }

          let menuItemId = item.menu_item_id || item.product_id || item.id || null;
          if (menuItemId) {
            const [checkItem] = await connection.execute('SELECT id FROM menu_items WHERE id = ?', [menuItemId]);
            if (checkItem.length === 0) {
              menuItemId = null;
            }
          }

          await connection.execute(
            'INSERT INTO order_items (order_id, menu_item_id, item_name, name, unit_price, price, gst_rate, tax_amount, discount_amount, quantity, item_weight, weight_unit, base_unit_price, barcode, notes) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              orderId, menuItemId, item.name, item.name, unitPrice, unitPrice, itemGstRate,
              itemTax, item.discount_amount || 0.00, itemQuantity,
              itemWeight, weightUnit, baseUnitPrice, barcode, item.notes || null
            ]
          );

          // Auto-deduct inventory stock for tracked menu items (Weight stock vs Piece stock)
          if (menuItemId) {
            try {
              const [curStockRows] = await connection.execute(
                'SELECT current_stock, is_weight_based FROM menu_items WHERE id = ? AND restaurant_id = ?',
                [menuItemId, restaurantId]
              );
              if (curStockRows.length > 0) {
                const prevStock = parseFloat(curStockRows[0].current_stock || 0);
                const isWeightBased = curStockRows[0].is_weight_based === 1 || itemWeight !== null;
                const deductQty = isWeightBased ? (itemWeight || itemQuantity) : itemQuantity;
                const newStock = Math.max(0, prevStock - deductQty);

                await connection.execute(
                  'UPDATE menu_items SET current_stock = ? WHERE id = ? AND restaurant_id = ?',
                  [newStock, menuItemId, restaurantId]
                );
                await connection.execute(
                  `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason)
                   VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
                  [restaurantId, menuItemId, cashier_name || 'POS Cashier', deductQty, prevStock, newStock, `Order #${uniqueOrderNumber}`]
                ).catch(sErr => console.warn('[Stock Log Warning]:', sErr.message));
              }
            } catch (invErr) {
              console.warn('[Inventory Stock Update Warning]:', invErr.message);
            }
          }
        }

        // 5. Update Cashier Shift sales (Only if completed)
        if (orderStatus === 'completed' && safeCashierShiftId) {
          try {
            const cashAdd = payment_mode === 'cash' ? safeTotalAmount : 0;
            const upiAdd = ['upi', 'gpay', 'phonepe', 'paytm'].includes(payment_mode) ? safeTotalAmount : 0;
            const cardAdd = ['card', 'credit', 'debit'].includes(payment_mode) ? safeTotalAmount : 0;
            const walletAdd = payment_mode === 'wallet' ? safeTotalAmount : 0;
            const otherAdd = (!['cash', 'upi', 'gpay', 'phonepe', 'paytm', 'card', 'credit', 'debit', 'wallet'].includes(payment_mode)) ? safeTotalAmount : 0;

            await connection.execute(
              'UPDATE cashier_shifts SET ' +
              'total_bills = total_bills + 1, ' +
              'cash_collected = cash_collected + ?, ' +
              'upi_collected = upi_collected + ?, ' +
              'card_collected = card_collected + ?, ' +
              'wallet_collected = wallet_collected + ?, ' +
              'other_collected = other_collected + ?, ' +
              'total_collected = total_collected + ? ' +
              'WHERE id = ? AND restaurant_id = ?',
              [cashAdd, upiAdd, cardAdd, walletAdd, otherAdd, safeTotalAmount, safeCashierShiftId, restaurantId]
            );
          } catch (shiftErr) {
            console.warn('[Cashier Shift Update Warning]:', shiftErr.message);
          }
        }

        // Commit transaction
        await connection.commit();

        // Retrieve full details of the created order
        const [orderRows] = await connection.execute(
          'SELECT * FROM orders WHERE id = ?',
          [orderId]
        );
        
        const [itemRows] = await connection.execute(
          'SELECT * FROM order_items WHERE order_id = ?',
          [orderId]
        );

        return {
          order: orderRows[0],
          items: itemRows
        };
      } catch (err) {
        await connection.rollback();
        const isRetryable = (err.code === 'ER_DUP_ENTRY' || err.errno === 1062 || err.code === 'ER_LOCK_DEADLOCK' || err.errno === 1213);
        if (isRetryable && attempts < MAX_RETRIES) {
          const backoffDelay = Math.floor(Math.random() * 60 + attempts * 50);
          console.warn(`[Order Repository Retry] Retryable error (${err.code || err.errno}) on attempt ${attempts}/${MAX_RETRIES}. Backing off ${backoffDelay}ms...`);
          await new Promise(r => setTimeout(r, backoffDelay));
          continue;
        }
        throw err;
      } finally {
        connection.release();
      }
    }
  }

  static async getById(id, restaurantId) {
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    if (orders.length === 0) return null;
    
    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [id]
    );

    return {
      order: orders[0],
      items
    };
  }

  static async getOrderItems(orderId) {
    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [orderId]
    );
    return items;
  }

  static async getByOrderNumber(orderNumber, restaurantId) {
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE unique_order_number = ? AND restaurant_id = ?',
      [orderNumber, restaurantId]
    );
    if (orders.length === 0) return null;

    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [orders[0].id]
    );

    return {
      order: orders[0],
      items
    };
  }

  static async getAll(restaurantId, filters = {}) {
    const { cashier_id, order_status, date_from, date_to, limit, offset } = filters;
    let query = 'SELECT * FROM orders WHERE restaurant_id = ?';
    const params = [restaurantId];

    if (cashier_id) {
      query += ' AND cashier_id = ?';
      params.push(cashier_id);
    }
    if (order_status) {
      query += ' AND order_status = ?';
      params.push(order_status);
    }
    if (date_from) {
      query += ' AND created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND created_at <= ?';
      params.push(date_to);
    }

    query += ' ORDER BY id DESC';

    if (limit) {
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset || 0));
    }

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  static async updateOrderStatus(id, restaurantId, status, paymentMode = null, paymentDetails = null, shiftId = null) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Fetch order details first
      const [orders] = await connection.execute(
        'SELECT total_amount, cashier_shift_id, payment_mode, order_status FROM orders WHERE id = ? AND restaurant_id = ?',
        [id, restaurantId]
      );

      if (orders.length === 0) {
        await connection.commit();
        return false;
      }

      const order = orders[0];
      const prevStatus = order.order_status;
      const activePaymentMode = paymentMode || order.payment_mode || 'cash';
      const activeShiftId = shiftId || order.cashier_shift_id;

      const [result] = await connection.execute(
        'UPDATE orders SET order_status = ?, payment_mode = ?, payment_details = ?, cashier_shift_id = ?, completed_at = ? WHERE id = ? AND restaurant_id = ?',
        [status, activePaymentMode, paymentDetails ? JSON.stringify(paymentDetails) : null, activeShiftId, status === 'completed' ? new Date() : null, id, restaurantId]
      );

      if (status === 'completed' && prevStatus !== 'completed' && activeShiftId) {
        const total_amount = parseFloat(order.total_amount);
        const cashAdd = activePaymentMode === 'cash' ? total_amount : 0;
        const upiAdd = ['upi', 'gpay', 'phonepe', 'paytm'].includes(activePaymentMode) ? total_amount : 0;
        const cardAdd = ['card', 'credit', 'debit'].includes(activePaymentMode) ? total_amount : 0;
        const walletAdd = activePaymentMode === 'wallet' ? total_amount : 0;
        const otherAdd = (!['cash', 'upi', 'gpay', 'phonepe', 'paytm', 'card', 'credit', 'debit', 'wallet'].includes(activePaymentMode)) ? total_amount : 0;

        await connection.execute(
          'UPDATE cashier_shifts SET ' +
          'total_bills = total_bills + 1, ' +
          'cash_collected = cash_collected + ?, ' +
          'upi_collected = upi_collected + ?, ' +
          'card_collected = card_collected + ?, ' +
          'wallet_collected = wallet_collected + ?, ' +
          'other_collected = other_collected + ?, ' +
          'total_collected = total_collected + ? ' +
          'WHERE id = ? AND restaurant_id = ?',
          [cashAdd, upiAdd, cardAdd, walletAdd, otherAdd, total_amount, activeShiftId, restaurantId]
        );
      }

      await connection.commit();
      return result.affectedRows > 0;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async getHistory(restaurantId, filters = {}) {
    const { 
      cashier_id, 
      order_status, 
      payment_mode,
      date_from, 
      date_to, 
      search, 
      limit = 20, 
      offset = 0,
      page
    } = filters;

    let whereClause = ' WHERE restaurant_id = ?';
    const params = [restaurantId];

    if (cashier_id) {
      whereClause += ' AND cashier_id = ?';
      params.push(cashier_id);
    }
    if (order_status) {
      whereClause += ' AND order_status = ?';
      params.push(order_status);
    }
    if (payment_mode) {
      whereClause += ' AND payment_mode = ?';
      params.push(payment_mode);
    }
    if (date_from) {
      whereClause += ' AND created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      whereClause += ' AND created_at <= ?';
      params.push(date_to);
    }

    if (search && search.trim() !== '') {
      const s = `%${search.trim()}%`;
      whereClause += ' AND (unique_order_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR notes LIKE ? OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.name LIKE ?))';
      params.push(s, s, s, s, s);
    }

    // 1. Get Total Count for Pagination
    const countQuery = `SELECT COUNT(DISTINCT orders.id) AS total_records FROM orders${whereClause}`;
    const [countRows] = await pool.query(countQuery, params);
    const totalRecords = countRows[0]?.total_records || 0;

    // 2. Get Paginated Data Rows
    let dataQuery = `SELECT orders.* FROM orders${whereClause} ORDER BY orders.id DESC`;
    const dataParams = [...params];

    const safeLimit = Math.max(1, parseInt(limit) || 20);
    const safeOffset = Math.max(0, parseInt(offset) || 0);
    const currentPage = page ? parseInt(page) : Math.floor(safeOffset / safeLimit) + 1;

    dataQuery += ' LIMIT ? OFFSET ?';
    dataParams.push(safeLimit, safeOffset);

    const [rows] = await pool.query(dataQuery, dataParams);
    const totalPages = Math.ceil(totalRecords / safeLimit) || 1;

    return {
      orders: rows,
      pagination: {
        page: currentPage,
        limit: safeLimit,
        totalRecords: totalRecords,
        totalPages: totalPages
      }
    };
  }

  static async updateKitchenStatus(id, restaurantId, status) {
    const [result] = await pool.execute(
      'UPDATE orders SET kitchen_status = ? WHERE id = ? AND restaurant_id = ?',
      [status, id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async incrementReprintCount(id, restaurantId) {
    const [result] = await pool.execute(
      'UPDATE orders SET printed_count = printed_count + 1 WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async getShiftSummary(restaurantId, shiftId) {
    const [rows] = await pool.execute(
      'SELECT * FROM cashier_shifts WHERE id = ? AND restaurant_id = ?',
      [shiftId, restaurantId]
    );
    return rows[0] || null;
  }
}

module.exports = OrderRepository;
