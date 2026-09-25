const pool = require('../config/db');
const CustomerRepository = require('./customer_repository');
const CustomerLedgerRepository = require('./customer_ledger_repository');
const CustomerReceivableRepository = require('./customer_receivable_repository');
const StockMovementService = require('../services/stock_movement_service');
const { GstService } = require('../services/gst_service');
const FinancialAccountService = require('../services/financial_account_service');

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
          order_status,
          discount_type,
          discount_value,
          customer_id,
          customer_name,
          customer_phone,
          customer_address,
          store_name,
          salesman_id,
          salesman_name,
          idempotency_key,
          tax_type,
          delivery_date,
          billing_address,
          shipping_address,
          place_of_supply,
          price_list,
          reference_number,
          additional_charges,
          is_sales_order
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
              id: dupRows[0].id,
              unique_order_number: dupRows[0].unique_order_number,
              isDuplicate: true
            };
          }
        }

        let safeSubtotal = isNaN(parseFloat(subtotal)) ? 0.00 : parseFloat(subtotal);
        let safeTaxAmount = isNaN(parseFloat(tax_amount)) ? 0.00 : parseFloat(tax_amount);
        let safeDiscountAmount = isNaN(parseFloat(discount_amount)) ? 0.00 : parseFloat(discount_amount);
        let safeTotalAmount = isNaN(parseFloat(total_amount)) ? 0.00 : parseFloat(total_amount);
        const orderStatus = order_status || status || 'completed';
        const safeCashierShiftId = cashier_shift_id === undefined ? null : cashier_shift_id;

        // 1. Fetch GST Profile & Settings
        const [settingsRows] = await connection.execute(
          'SELECT gst_mode, gst_number, state, state_code, gst_registration_type FROM receipt_settings WHERE restaurant_id = ?',
          [restaurantId]
        );
        const storeSettings = settingsRows[0] || {};
        const gstMode = storeSettings.gst_mode || 'excluded';
        const storeStateCode = storeSettings.state_code || '27';
        const isComposition = storeSettings.gst_registration_type === 'composition';

        // 2. Concurrency-Safe Daily Order Number Generation (EST-, SO-, or ORD-)
        const isEstimateFlag = (orderData.is_estimate === 1 || orderData.is_estimate === true || orderData.is_estimate === '1') ? 1 : 0;
        const isSalesOrderFlag = (is_sales_order === 1 || is_sales_order === true || is_sales_order === '1' || orderData.is_sales_order) ? 1 : 0;
        const parentOrderId = orderData.parent_order_id || null;
        const invoicedAmount = parseFloat(orderData.invoiced_amount || 0);

        let docPrefixCode = 'ORD';
        if (isEstimateFlag === 1) {
          docPrefixCode = 'EST';
        } else if (isSalesOrderFlag === 1) {
          docPrefixCode = 'SO';
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}${month}${day}`;
        const datePrefix = `${docPrefixCode}-${dateStr}-`;

        // Concurrency-Safe Atomic Sequence Generator
        const getNextSequence = async () => {
          await connection.execute(
            'INSERT IGNORE INTO order_sequences (restaurant_id, order_date, last_seq) VALUES (?, ?, 0)',
            [restaurantId, dateStr]
          );

          const [seqRows] = await connection.execute(
            'SELECT last_seq FROM order_sequences WHERE restaurant_id = ? AND order_date = ? FOR UPDATE',
            [restaurantId, dateStr]
          );

          let currentSeq = parseInt(seqRows[0]?.last_seq || 0, 10);

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

          let nextSeq = currentSeq + 1;
          if (attempts > 1) {
            nextSeq = Math.max(nextSeq, currentSeq + (attempts - 1));
          }

          await connection.execute(
            'UPDATE order_sequences SET last_seq = ? WHERE restaurant_id = ? AND order_date = ?',
            [nextSeq, restaurantId, dateStr]
          );

          return nextSeq;
        };

        const seq = await getNextSequence();
        const seqStr = String(seq).padStart(4, '0');
        const uniqueOrderNumber = `${datePrefix}${seqStr}`;

        // Auto-resolve or auto-create customer/store record
        let resolvedCustomerId = customer_id || null;
        let resolvedCustomerName = customer_name || (store_name ? store_name : null);
        let resolvedCustomerPhone = customer_phone || null;
        let customerGstin = orderData.customer_gstin || null;
        let customerStateCode = orderData.customer_state_code || null;

        if (customer_id || customer_name || customer_phone || store_name) {
          try {
            const cust = await CustomerRepository.findOrCreate(restaurantId, {
              customer_id,
              customer_name: customer_name || store_name,
              customer_phone,
              customer_address,
              store_name
            }, connection);
            if (cust) {
              resolvedCustomerId = cust.id;
              resolvedCustomerName = cust.name || resolvedCustomerName;
              resolvedCustomerPhone = cust.phone || resolvedCustomerPhone;
              customerGstin = cust.gst_number || customerGstin;
              customerStateCode = cust.state_code || customerStateCode;
            }
          } catch (custErr) {
            console.warn('[Order Customer Auto-Create Warning]:', custErr.message);
          }
        }

        // Place of Supply Determination
        const posRes = GstService.resolvePlaceOfSupply({
          storeStateCode,
          storeState: storeSettings.state || 'Maharashtra',
          customerGstin,
          customerStateCode,
          customerState: place_of_supply,
          manualTaxType: tax_type
        });
        const effectiveTaxType = posRes.taxType;
        const effectivePlaceOfSupply = place_of_supply || posRes.placeOfSupply;

        // Enrich items with HSN and exemption from menu_items if needed
        for (const item of items) {
          const mId = item.menu_item_id || item.product_id || item.id || null;
          if (mId && !item.hsn_code) {
            try {
              const [mRows] = await connection.execute('SELECT hsn_code, is_tax_exempt, gst_rate FROM menu_items WHERE id = ?', [mId]);
              if (mRows.length > 0) {
                item.hsn_code = item.hsn_code || mRows[0].hsn_code || null;
                if (item.is_tax_exempt === undefined) item.is_tax_exempt = mRows[0].is_tax_exempt;
                if (item.gst_rate === undefined && mRows[0].gst_rate !== undefined) item.gst_rate = mRows[0].gst_rate;
              }
            } catch (err) {
              // Ignore lookup error
            }
          }
        }

        // Central Authoritative Document Tax Calculation
        const additionalChargesList = Array.isArray(additional_charges) ? additional_charges : [];
        const additionalChargesTotal = additionalChargesList.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);

        const docTax = GstService.calculateDocumentTax({
          items,
          orderDiscountType: discount_type || 'amount',
          orderDiscountValue: discount_value || 0,
          gstMode,
          taxType: effectiveTaxType,
          additionalCharges: additionalChargesTotal,
          isComposition,
          storeStateCode,
          customerGstin
        });

        safeSubtotal = docTax.subtotal;
        safeTaxAmount = docTax.totalTax;
        safeDiscountAmount = docTax.discountAmount;
        safeTotalAmount = docTax.grandTotal;
        const safeCgstAmount = docTax.cgstAmount;
        const safeSgstAmount = docTax.sgstAmount;
        const safeIgstAmount = docTax.igstAmount;
        const safeRoundOff = docTax.roundOff;
        const taxInvoiceType = docTax.taxInvoiceType;

        let orderWarehouseId = orderData.warehouse_id || null;
        if (!orderWarehouseId) {
          const [defWh] = await connection.execute(
            'SELECT id FROM warehouses WHERE restaurant_id = ? AND is_default = 1 LIMIT 1',
            [restaurantId]
          );
          orderWarehouseId = defWh.length > 0 ? defWh[0].id : null;
        }

        // Credit / Udhar & Payment Split calculations
        const splits = FinancialAccountService.normalizePaymentSplits(payment_mode, payment_details, safeTotalAmount);
        let immediatePaid = 0;
        let creditSplitAmount = 0;
        for (const sp of splits) {
          const m = (sp.mode || '').toLowerCase();
          if (m === 'credit' || m === 'due' || m === 'udhar') {
            creditSplitAmount += sp.amount;
          } else {
            immediatePaid += sp.amount;
          }
        }

        const isCreditOrDue = (payment_mode === 'credit' || payment_mode === 'due' || payment_mode === 'udhar' || creditSplitAmount > 0);

        let safePaidAmount = safeTotalAmount;
        if (orderData.paid_amount !== undefined && orderData.paid_amount !== null) {
          safePaidAmount = Math.max(0, Math.min(safeTotalAmount, parseFloat(orderData.paid_amount) || 0));
        } else if (isCreditOrDue) {
          safePaidAmount = Math.max(0, Math.min(safeTotalAmount, immediatePaid));
        }

        const safeAdvanceAmount = parseFloat(orderData.advance_amount || 0);

        // Validation for Credit / Udhar: customer is required!
        if ((isCreditOrDue || safePaidAmount < safeTotalAmount) && isEstimateFlag !== 1) {
          if (!resolvedCustomerId) {
            throw new Error('Please select a customer for Credit/Udhar sale.');
          }

          // Check if customer allows credit and check credit limit
          const [cCheckRows] = await connection.execute(
            'SELECT id, name, allow_credit, credit_limit, current_balance, credit_days FROM customers WHERE id = ? AND restaurant_id = ? FOR UPDATE',
            [resolvedCustomerId, restaurantId]
          );
          if (cCheckRows.length > 0) {
            const cInfo = cCheckRows[0];
            if (cInfo.allow_credit === 0) {
              throw new Error(`Customer "${cInfo.name}" is not permitted for credit sales.`);
            }

            const uncollectedDue = Math.max(0, safeTotalAmount - safePaidAmount);
            const currentBal = parseFloat(cInfo.current_balance || 0);
            const credLimit = parseFloat(cInfo.credit_limit || 0);

            if (credLimit > 0 && (currentBal + uncollectedDue) > credLimit && !orderData.allow_credit_override) {
              const availableCredit = Math.max(0, credLimit - currentBal);
              throw new Error(`Credit limit exceeded! Customer Credit Limit: ₹${credLimit.toFixed(2)}, Current Outstanding: ₹${currentBal.toFixed(2)}, Available Credit: ₹${availableCredit.toFixed(2)}, Required: ₹${uncollectedDue.toFixed(2)}.`);
            }
          }
        }

        let calculatedPaymentStatus = 'completed';
        if (isEstimateFlag === 1 || isSalesOrderFlag === 1) {
          calculatedPaymentStatus = orderStatus || 'pending';
        } else {
          if (safePaidAmount >= safeTotalAmount && safeTotalAmount > 0) {
            calculatedPaymentStatus = 'paid';
          } else if (safePaidAmount > 0 && safePaidAmount < safeTotalAmount) {
            calculatedPaymentStatus = 'partially_paid';
          } else if (safeTotalAmount > 0) {
            calculatedPaymentStatus = 'unpaid';
          } else {
            calculatedPaymentStatus = 'paid';
          }
        }

        let orderDueDate = orderData.due_date ? String(orderData.due_date).slice(0, 10) : null;
        if (!orderDueDate && resolvedCustomerId && (isCreditOrDue || safePaidAmount < safeTotalAmount)) {
          try {
            const [cDaysRow] = await connection.execute(
              'SELECT credit_days FROM customers WHERE id = ?',
              [resolvedCustomerId]
            );
            if (cDaysRow.length > 0) {
              const cDays = parseInt(cDaysRow[0].credit_days || 0);
              if (cDays > 0) {
                const d = new Date();
                d.setDate(d.getDate() + cDays);
                orderDueDate = d.toISOString().slice(0, 10);
              }
            }
          } catch (err) {}
        }

        // 3. Insert Order (including complete GST breakdown, payment status, and receivables fields)
        const [orderResult] = await connection.execute(
          'INSERT INTO orders (order_number, unique_order_number, idempotency_key, restaurant_id, cashier_id, cashier_name, subtotal, tax_amount, discount_amount, total_amount, paid_amount, due_date, advance_amount, payment_mode, payment_details, order_status, payment_status, cashier_shift_id, table_number_or_takeaway, notes, kitchen_status, discount_type, discount_value, customer_name, customer_phone, customer_id, salesman_id, salesman_name, tax_type, delivery_date, billing_address, shipping_address, place_of_supply, price_list, reference_number, additional_charges, is_sales_order, warehouse_id, parent_order_id, is_estimate, invoiced_amount, cgst_amount, sgst_amount, igst_amount, round_off, tax_invoice_type) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pending", ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            uniqueOrderNumber, uniqueOrderNumber, idempotency_key || null, restaurantId, cashier_id || null, cashier_name || null, safeSubtotal, safeTaxAmount,
            safeDiscountAmount, safeTotalAmount, safePaidAmount, orderDueDate, safeAdvanceAmount, payment_mode || 'pending', payment_details ? JSON.stringify(payment_details) : null,
            orderStatus || 'pending', calculatedPaymentStatus, safeCashierShiftId || null, table_number_or_takeaway || 'Takeaway', notes || null,
            discount_type || 'amount', parseFloat(discount_value || 0), resolvedCustomerName || null, resolvedCustomerPhone || null,
            resolvedCustomerId || null, salesman_id || null, salesman_name || null, effectiveTaxType,
            delivery_date || null, billing_address || customer_address || null, shipping_address || null,
            effectivePlaceOfSupply, price_list || 'standard', reference_number || null,
            additional_charges ? JSON.stringify(additional_charges) : null, isSalesOrderFlag,
            orderWarehouseId || null, parentOrderId || null, isEstimateFlag, invoicedAmount || 0,
            safeCgstAmount, safeSgstAmount, safeIgstAmount, safeRoundOff, taxInvoiceType
          ]
        );
        const orderId = orderResult.insertId;

        // 4. Insert Order Items (with line-level tax snapshot)
        for (const item of docTax.items) {
          let menuItemId = item.menu_item_id || item.product_id || item.id || null;
          if (menuItemId) {
            const [checkItem] = await connection.execute('SELECT id FROM menu_items WHERE id = ?', [menuItemId]);
            if (checkItem.length === 0) {
              menuItemId = null;
            }
          }

          const itemQuantity = isNaN(parseInt(item.quantity)) ? 1 : parseInt(item.quantity);
          const itemWeight = item.item_weight !== undefined && item.item_weight !== null ? parseFloat(item.item_weight) : null;
          const weightUnit = item.weight_unit || item.unit || null;
          const baseUnitPrice = item.base_unit_price !== undefined && item.base_unit_price !== null ? parseFloat(item.base_unit_price) : null;
          const barcode = item.barcode || null;

          await connection.execute(
            'INSERT INTO order_items (order_id, menu_item_id, item_name, name, unit_price, price, gst_rate, tax_amount, discount_amount, quantity, item_weight, weight_unit, base_unit_price, barcode, notes, delivered_qty, invoiced_qty, hsn_code, taxable_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              orderId, menuItemId || null, item.name || item.item_name || 'Item', item.name || item.item_name || 'Item',
              item.unitPrice, item.unitPrice, item.gstRate,
              item.totalTax, item.discountAmount, itemQuantity,
              itemWeight !== undefined ? itemWeight : null, weightUnit || null, baseUnitPrice !== undefined ? baseUnitPrice : null, barcode || null, item.notes || null,
              item.hsnCode || null, item.taxableAmount, item.cgstRate, item.cgstAmount, item.sgstRate, item.sgstAmount, item.igstRate, item.igstAmount
            ]
          );

          // Dynamic Inventory Stock Handling (KG & PCS, Pending vs Completed)
          if (menuItemId) {
            try {
              const [curStockRows] = await connection.execute(
                'SELECT name, unit, current_stock, reserved_stock, is_weight_based, track_inventory FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
                [menuItemId, restaurantId]
              );
              if (curStockRows.length > 0) {
                const itemData = curStockRows[0];
                const prevStock = parseFloat(itemData.current_stock || 0);
                const prevReserved = parseFloat(itemData.reserved_stock || 0);
                const isWeightBased = itemData.is_weight_based === 1 || itemWeight !== null;
                const soldQty = isWeightBased ? (itemWeight !== null ? parseFloat(itemWeight) : itemQuantity) : itemQuantity;
                const availableStock = Math.max(0, prevStock - prevReserved);

                if (orderStatus === 'pending') {
                  if (isEstimateFlag === 1) {
                    // Estimates are quotations only - ZERO stock reservation!
                  } else {
                    // Sales Order: Validate available stock to prevent overselling
                    if (itemData.track_inventory !== 0 && soldQty > availableStock) {
                      throw new Error(`Insufficient stock for "${itemData.name}". Requested: ${soldQty} ${itemData.unit || 'pcs'}, but only ${availableStock} ${itemData.unit || 'pcs'} is available (${prevStock} current, ${prevReserved} reserved in pending orders).`);
                    }
                    // Dynamic Stock: For pending sales orders, increment reserved_stock without touching physical current_stock
                    const newReserved = prevReserved + soldQty;
                    await connection.execute(
                      'UPDATE menu_items SET reserved_stock = ? WHERE id = ? AND restaurant_id = ?',
                      [newReserved, menuItemId, restaurantId]
                    );
                    if (orderWarehouseId) {
                      await connection.execute(
                        'UPDATE warehouse_stocks SET reserved_stock = reserved_stock + ? WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
                        [soldQty, restaurantId, orderWarehouseId, menuItemId]
                      ).catch(() => {});
                    }
                  }
                } else {
                  // Standard Completed Order: Deduct directly from physical current_stock
                  const newStock = Math.max(0, prevStock - soldQty);
                  await connection.execute(
                    'UPDATE menu_items SET current_stock = ? WHERE id = ? AND restaurant_id = ?',
                    [newStock, menuItemId, restaurantId]
                  );
                  await connection.execute(
                    `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason)
                     VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
                    [restaurantId, menuItemId, cashier_name || 'POS Cashier', soldQty, prevStock, newStock, `Order #${uniqueOrderNumber}`]
                  ).catch(sErr => console.warn('[Stock Log Warning]:', sErr.message));

                  // Multi-warehouse Stock Ledger & Warehouse Stock update
                  if (orderWarehouseId) {
                    await StockMovementService.recordMovement(connection, {
                      restaurantId,
                      warehouseId: orderWarehouseId,
                      menuItemId,
                      type: 'SALE',
                      quantity: -soldQty,
                      unitCost: item.unitPrice || parseFloat(item.price || 0),
                      referenceType: 'order',
                      referenceId: orderId,
                      referenceNumber: uniqueOrderNumber,
                      userId: cashier_id,
                      userName: cashier_name || 'POS Cashier',
                      notes: `Sale Order #${uniqueOrderNumber}`
                    }).catch(txErr => console.warn('[Stock Transaction Warning]:', txErr.message));
                  }
                }
              }
            } catch (invErr) {
              console.warn('[Inventory Stock Update Warning]:', invErr.message);
              throw invErr;
            }
          }
        }

        // 5. Cashier Shift update (Invoices / completed retail sales only - NOT Estimates or Sales Orders)
        // CRITICAL: Credit / Udhar amounts are NEVER added to cashier shift physical collections!
        if (safeCashierShiftId && orderStatus === 'completed' && isEstimateFlag !== 1 && isSalesOrderFlag !== 1) {
          try {
            let cashAdd = 0, upiAdd = 0, cardAdd = 0, walletAdd = 0, otherAdd = 0;
            for (const sp of splits) {
              const m = (sp.mode || '').toLowerCase();
              if (m === 'credit' || m === 'due' || m === 'udhar') {
                continue; // Unpaid receivable, not collected into shift cash drawer
              }
              if (m === 'cash') cashAdd += sp.amount;
              else if (['upi', 'gpay', 'phonepe', 'paytm'].includes(m)) upiAdd += sp.amount;
              else if (['card', 'debit'].includes(m)) cardAdd += sp.amount;
              else if (m === 'wallet') walletAdd += sp.amount;
              else otherAdd += sp.amount;
            }
            const totalCollectedShift = cashAdd + upiAdd + cardAdd + walletAdd + otherAdd;

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
              [cashAdd, upiAdd, cardAdd, walletAdd, otherAdd, totalCollectedShift, safeCashierShiftId, restaurantId]
            );
          } catch (shiftErr) {
            console.warn('[Cashier Shift Update Warning]:', shiftErr.message);
          }
        }

        // 6. Bank & Financial Accounts Integration (Completed Tax Invoices only - NOT Estimates or Sales Orders)
        if (orderStatus === 'completed' && isEstimateFlag !== 1 && isSalesOrderFlag !== 1) {
          try {
            const outstandingAmount = Math.max(0, safeTotalAmount - safePaidAmount);

            // Customer credit handling if credit/due OR partial payment with outstanding
            if (resolvedCustomerId && (isCreditOrDue || outstandingAmount > 0)) {
              // 1. Record Invoice in customer ledger (Debit total amount)
              await CustomerLedgerRepository.recordEntry(restaurantId, {
                customerId: resolvedCustomerId,
                type: 'INVOICE',
                amount: safeTotalAmount,
                referenceType: 'order',
                referenceId: orderId,
                referenceNumber: uniqueOrderNumber,
                paymentMode: payment_mode,
                userId: cashier_id,
                userName: cashier_name || 'POS Cashier',
                notes: `Invoice #${uniqueOrderNumber} on credit`
              }, connection);

              // 2. If immediate partial payment was collected at POS checkout, record it against customer
              if (safePaidAmount > 0) {
                const primaryPaidMode = splits.find(s => s.mode !== 'credit' && s.mode !== 'due' && s.mode !== 'udhar')?.mode || 'cash';

                await CustomerLedgerRepository.recordEntry(restaurantId, {
                  customerId: resolvedCustomerId,
                  type: 'PAYMENT',
                  amount: safePaidAmount,
                  referenceType: 'order',
                  referenceId: orderId,
                  referenceNumber: uniqueOrderNumber,
                  paymentMode: primaryPaidMode,
                  userId: cashier_id,
                  userName: cashier_name || 'POS Cashier',
                  notes: `POS Immediate Payment for Invoice #${uniqueOrderNumber}`
                }, connection);

                // Record in customer_payments & allocations for audit & receipt traceability
                try {
                  const recNum = await CustomerReceivableRepository.getNextReceiptNumber(connection, restaurantId);
                  const [pmtRes] = await connection.execute(
                    `INSERT INTO customer_payments (
                      restaurant_id, payment_number, customer_id, order_id, payment_date,
                      amount, allocated_amount, advance_amount, payment_mode,
                      reference_number, notes, created_by_user_id, created_by_name
                    ) VALUES (?, ?, ?, ?, CURDATE(), ?, ?, 0, ?, ?, ?, ?, ?)`,
                    [
                      restaurantId, recNum, resolvedCustomerId, orderId,
                      safePaidAmount, safePaidAmount, primaryPaidMode,
                      uniqueOrderNumber, `POS Checkout Payment for Invoice #${uniqueOrderNumber}`,
                      (!isNaN(parseInt(cashier_id)) ? parseInt(cashier_id) : null),
                      cashier_name || 'POS Cashier'
                    ]
                  );
                  const paymentId = pmtRes.insertId;

                  await connection.execute(
                    `INSERT INTO customer_payment_allocations (restaurant_id, payment_id, order_id, allocated_amount)
                     VALUES (?, ?, ?, ?)`,
                    [restaurantId, paymentId, orderId, safePaidAmount]
                  );
                } catch (pmtErr) {
                  console.warn('[Customer Payment Record Notice]:', pmtErr.message);
                }
              }
            }

            // Route cash / digital payments into mapped financial accounts (FinancialAccountService already skips credit/due)
            await FinancialAccountService.recordSaleTransaction(connection, {
              restaurantId,
              orderId,
              orderNumber: uniqueOrderNumber,
              paymentMode: payment_mode,
              paymentDetails: payment_details,
              totalAmount: safeTotalAmount,
              customerName: resolvedCustomerName,
              customerId: resolvedCustomerId,
              userId: cashier_id,
              userName: cashier_name || 'POS Cashier'
            });
          } catch (finErr) {
            console.warn('[Financial Account Integration Warning]:', finErr.message);
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
          items: itemRows,
          id: orderId,
          unique_order_number: uniqueOrderNumber
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
    const { cashier_id, salesman_id, customer_id, order_status, is_sales_order, is_estimate, warehouse_id, date_from, date_to, search, limit, offset } = filters;
    let query = 'SELECT * FROM orders WHERE restaurant_id = ?';
    const params = [restaurantId];

    if (cashier_id) {
      query += ' AND cashier_id = ?';
      params.push(cashier_id);
    }
    if (salesman_id && salesman_id !== 'all') {
      query += ' AND (salesman_id = ? OR cashier_id = ?)';
      params.push(salesman_id, salesman_id);
    }
    if (customer_id && customer_id !== 'all') {
      query += ' AND customer_id = ?';
      params.push(customer_id);
    }
    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND warehouse_id = ?';
      params.push(warehouse_id);
    }
    if (order_status && order_status !== 'all') {
      query += ' AND order_status = ?';
      params.push(order_status);
    }
    if (is_sales_order !== undefined && is_sales_order !== null && is_sales_order !== '') {
      query += ' AND is_sales_order = ?';
      params.push(is_sales_order === 'true' || is_sales_order === true || is_sales_order === 1 || is_sales_order === '1' ? 1 : 0);
    }
    if (is_estimate !== undefined && is_estimate !== null && is_estimate !== '') {
      query += ' AND is_estimate = ?';
      params.push(is_estimate === 'true' || is_estimate === true || is_estimate === 1 || is_estimate === '1' ? 1 : 0);
    }
    if (date_from) {
      query += ' AND created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND created_at <= ?';
      params.push(date_to);
    }
    if (search && search.trim()) {
      query += ' AND (unique_order_number LIKE ? OR customer_name LIKE ? OR store_name LIKE ? OR customer_phone LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    query += ' ORDER BY id DESC';

    if (limit) {
      query += ' LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset || 0));
    }

    const [rows] = await pool.execute(query, params);

    if (rows.length > 0 && (filters.include_items || order_status === 'pending')) {
      const orderIds = rows.map(r => r.id);
      const placeholders = orderIds.map(() => '?').join(',');
      const [items] = await pool.query(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders})`,
        orderIds
      );
      const itemsByOrderId = {};
      for (const it of items) {
        if (!itemsByOrderId[it.order_id]) itemsByOrderId[it.order_id] = [];
        itemsByOrderId[it.order_id].push(it);
      }
      for (const r of rows) {
        r.items = itemsByOrderId[r.id] || [];
      }
    }

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
        'UPDATE orders SET order_status = ?, status = ?, payment_mode = ?, payment_details = ?, cashier_shift_id = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
        [status, status === 'completed' ? 'completed' : (status === 'cancelled' ? 'cancelled' : 'active'), activePaymentMode, paymentDetails ? JSON.stringify(paymentDetails) : null, activeShiftId, id, restaurantId]
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

      // If transitioning from pending -> completed: deduct physical stock & clear reservation
      if (status === 'completed' && prevStatus === 'pending') {
        let whId = order.warehouse_id;
        if (!whId) {
          const [defWh] = await connection.execute('SELECT id FROM warehouses WHERE restaurant_id = ? AND is_default = 1 LIMIT 1', [restaurantId]);
          whId = defWh.length > 0 ? defWh[0].id : null;
        }

        const [items] = await connection.execute(
          'SELECT menu_item_id, quantity, item_weight, price FROM order_items WHERE order_id = ?',
          [id]
        );
        for (const item of items) {
          if (item.menu_item_id) {
            const [curStockRows] = await connection.execute(
              'SELECT current_stock, reserved_stock, is_weight_based FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
              [item.menu_item_id, restaurantId]
            );
            if (curStockRows.length > 0) {
              const prevStock = parseFloat(curStockRows[0].current_stock || 0);
              const prevReserved = parseFloat(curStockRows[0].reserved_stock || 0);
              const isWeightBased = curStockRows[0].is_weight_based === 1 || item.item_weight !== null;
              const deductQty = isWeightBased ? (item.item_weight !== null ? parseFloat(item.item_weight) : item.quantity) : item.quantity;
              const newStock = Math.max(0, prevStock - deductQty);
              const newReserved = Math.max(0, prevReserved - deductQty);

              await connection.execute(
                'UPDATE menu_items SET current_stock = ?, reserved_stock = ? WHERE id = ? AND restaurant_id = ?',
                [newStock, newReserved, item.menu_item_id, restaurantId]
              );

              await connection.execute(
                `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason)
                 VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
                [restaurantId, item.menu_item_id, cashier_name || 'System (Order Confirmed)', deductQty, prevStock, newStock, `Order #${order.unique_order_number || id} Confirmed`]
              ).catch(sErr => console.warn('[Stock Log Warning]:', sErr.message));

              if (whId) {
                await StockMovementService.recordMovement(connection, {
                  restaurantId,
                  warehouseId: whId,
                  menuItemId: item.menu_item_id,
                  type: 'SALE',
                  quantity: -deductQty,
                  unitCost: parseFloat(item.price || 0),
                  referenceType: 'order',
                  referenceId: id,
                  referenceNumber: order.unique_order_number || String(id),
                  userId: null,
                  userName: cashier_name || 'System (Order Confirmed)',
                  notes: `Order #${order.unique_order_number || id} Confirmed`
                }).catch(sErr => console.warn('[Stock Movement Warning]:', sErr.message));
              }
            }
          }
        }
      }

      // If transitioning from completed -> cancelled: restore physical stock & record SALES_RETURN
      if (status === 'cancelled' && prevStatus === 'completed') {
        let whId = order.warehouse_id;
        if (!whId) {
          const [defWh] = await connection.execute('SELECT id FROM warehouses WHERE restaurant_id = ? AND is_default = 1 LIMIT 1', [restaurantId]);
          whId = defWh.length > 0 ? defWh[0].id : null;
        }

        const [items] = await connection.execute(
          'SELECT menu_item_id, quantity, item_weight, price FROM order_items WHERE order_id = ?',
          [id]
        );
        for (const item of items) {
          if (item.menu_item_id) {
            const isWeightBased = item.item_weight !== null;
            const returnQty = isWeightBased ? (item.item_weight !== null ? parseFloat(item.item_weight) : item.quantity) : item.quantity;

            if (whId) {
              await StockMovementService.recordMovement(connection, {
                restaurantId,
                warehouseId: whId,
                menuItemId: item.menu_item_id,
                type: 'SALES_RETURN',
                quantity: returnQty,
                unitCost: parseFloat(item.price || 0),
                referenceType: 'order',
                referenceId: id,
                referenceNumber: order.unique_order_number || String(id),
                userId: null,
                userName: cashier_name || 'System (Order Cancelled)',
                notes: `Order #${order.unique_order_number || id} Cancelled - Stock Restored`
              }).catch(sErr => console.warn('[Stock Movement Warning]:', sErr.message));
            } else {
              await connection.execute(
                'UPDATE menu_items SET current_stock = current_stock + ? WHERE id = ? AND restaurant_id = ?',
                [returnQty, item.menu_item_id, restaurantId]
              );
            }
          }
        }
      }

      // If transitioning from pending -> cancelled: release reserved stock
      if (status === 'cancelled' && prevStatus === 'pending') {
        const [items] = await connection.execute(
          'SELECT menu_item_id, quantity, item_weight FROM order_items WHERE order_id = ?',
          [id]
        );
        for (const item of items) {
          if (item.menu_item_id) {
            const [curStockRows] = await connection.execute(
              'SELECT reserved_stock, is_weight_based FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
              [item.menu_item_id, restaurantId]
            );
            if (curStockRows.length > 0) {
              const prevReserved = parseFloat(curStockRows[0].reserved_stock || 0);
              const isWeightBased = curStockRows[0].is_weight_based === 1 || item.item_weight !== null;
              const releaseQty = isWeightBased ? (item.item_weight !== null ? parseFloat(item.item_weight) : item.quantity) : item.quantity;
              const newReserved = Math.max(0, prevReserved - releaseQty);

              await connection.execute(
                'UPDATE menu_items SET reserved_stock = ? WHERE id = ? AND restaurant_id = ?',
                [newReserved, item.menu_item_id, restaurantId]
              );
            }
          }
        }
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
    let dataQuery = `SELECT id, unique_order_number, subtotal, tax_amount, discount_amount, total_amount, payment_mode, order_status, cashier_name, created_at FROM orders${whereClause} ORDER BY id DESC`;
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
  static async confirmOrder(orderId, restaurantId, cashierId, cashierName, paymentMode = null, paymentDetails = null, shiftId = null) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [orders] = await connection.execute(
        'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [orderId, restaurantId]
      );

      if (orders.length === 0) {
        await connection.rollback();
        return { success: false, error: 'Order not found.' };
      }

      const order = orders[0];
      if (order.order_status !== 'pending') {
        await connection.rollback();
        return { success: false, error: `Order is already in "${order.order_status}" status.` };
      }

      // Fetch items for this order
      const [items] = await connection.execute(
        'SELECT * FROM order_items WHERE order_id = ?',
        [orderId]
      );

      // Deduct physical current_stock and release reserved_stock for each tracked item
      for (const item of items) {
        if (item.menu_item_id) {
          const [curStockRows] = await connection.execute(
            'SELECT current_stock, reserved_stock, is_weight_based FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
            [item.menu_item_id, restaurantId]
          );
          if (curStockRows.length > 0) {
            const prevStock = parseFloat(curStockRows[0].current_stock || 0);
            const prevReserved = parseFloat(curStockRows[0].reserved_stock || 0);
            const isWeightBased = curStockRows[0].is_weight_based === 1 || item.item_weight !== null;
            const deductQty = isWeightBased ? (item.item_weight !== null ? parseFloat(item.item_weight) : item.quantity) : item.quantity;
            const newStock = Math.max(0, prevStock - deductQty);
            const newReserved = Math.max(0, prevReserved - deductQty);

            await connection.execute(
              'UPDATE menu_items SET current_stock = ?, reserved_stock = ? WHERE id = ? AND restaurant_id = ?',
              [newStock, newReserved, item.menu_item_id, restaurantId]
            );

            await connection.execute(
              `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason)
               VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
              [restaurantId, item.menu_item_id, cashierName || 'POS Staff', deductQty, prevStock, newStock, `Confirmed Order #${order.unique_order_number}`]
            ).catch(sErr => console.warn('[Stock Log Warning]:', sErr.message));

            // Multi-warehouse Stock Movement
            if (order.warehouse_id) {
              await StockMovementService.recordMovement(connection, {
                restaurantId,
                warehouseId: order.warehouse_id,
                menuItemId: item.menu_item_id,
                type: 'SALE',
                quantity: -deductQty,
                unitCost: item.price || item.unit_price || 0,
                referenceType: 'order',
                referenceId: orderId,
                referenceNumber: order.unique_order_number,
                userId: cashierId,
                userName: cashierName || 'POS Staff',
                notes: `Confirmed Order #${order.unique_order_number}`
              }).catch(txErr => console.warn('[Stock Movement Warning]:', txErr.message));
            }
          }
        }
      }

      const activePaymentMode = paymentMode || order.payment_mode || 'cash';
      const activeShiftId = shiftId || order.cashier_shift_id;
      const totalAmount = parseFloat(order.total_amount || 0);

      // Update order status to completed
      await connection.execute(
        'UPDATE orders SET order_status = "completed", status = "completed", payment_mode = ?, payment_details = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
        [activePaymentMode, paymentDetails ? JSON.stringify(paymentDetails) : (order.payment_details ? JSON.stringify(order.payment_details) : null), orderId, restaurantId]
      );

      // Update shift if applicable
      if (activeShiftId) {
        try {
          const cashAdd = activePaymentMode === 'cash' ? totalAmount : 0;
          const upiAdd = ['upi', 'gpay', 'phonepe', 'paytm'].includes(activePaymentMode) ? totalAmount : 0;
          const cardAdd = ['card', 'credit', 'debit'].includes(activePaymentMode) ? totalAmount : 0;
          const walletAdd = activePaymentMode === 'wallet' ? totalAmount : 0;
          const otherAdd = (!['cash', 'upi', 'gpay', 'phonepe', 'paytm', 'card', 'credit', 'debit', 'wallet'].includes(activePaymentMode)) ? totalAmount : 0;

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
            [cashAdd, upiAdd, cardAdd, walletAdd, otherAdd, totalAmount, activeShiftId, restaurantId]
          );
        } catch (shiftErr) {
          console.warn('[Shift Update Warning]:', shiftErr.message);
        }
      }

      // Financial Accounts & Customer Ledger Integration for confirmed order
      try {
        if (order.customer_id && (activePaymentMode === 'credit' || activePaymentMode === 'due')) {
          await CustomerLedgerRepository.recordEntry(restaurantId, {
            customerId: order.customer_id,
            type: 'INVOICE',
            amount: totalAmount,
            referenceType: 'order',
            referenceId: orderId,
            referenceNumber: order.unique_order_number,
            paymentMode: activePaymentMode,
            userId: cashierId,
            userName: cashierName || 'POS Staff',
            notes: `Confirmed Order #${order.unique_order_number} on credit`
          }, connection);
        } else if (activePaymentMode !== 'credit' && activePaymentMode !== 'due') {
          await FinancialAccountService.recordSaleTransaction(connection, {
            restaurantId,
            orderId,
            orderNumber: order.unique_order_number,
            paymentMode: activePaymentMode,
            paymentDetails: paymentDetails || (order.payment_details ? JSON.parse(order.payment_details) : null),
            totalAmount,
            customerName: order.customer_name,
            customerId: order.customer_id,
            userId: cashierId,
            userName: cashierName || 'POS Staff'
          });
        }
      } catch (finErr) {
        console.warn('[Confirm Order Finance Warning]:', finErr.message);
      }

      await connection.commit();

      return {
        success: true,
        orderId: order.id,
        orderNumber: order.unique_order_number
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Update a pending sales order (reconcile reserved stock, items, details)
   */
  static async updateSalesOrder(id, restaurantId, orderData, items) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Check that order exists, belongs to restaurant, and is pending
      const [orderRows] = await connection.execute(
        'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [id, restaurantId]
      );
      if (orderRows.length === 0) {
        throw new Error('Order not found.');
      }
      const existingOrder = orderRows[0];
      if (existingOrder.order_status !== 'pending') {
        throw new Error('Only pending sales orders can be modified.');
      }

      // 1. If items are provided, reconcile reserved stock
      if (items && Array.isArray(items)) {
        // Fetch existing items to release their reserved stock
        const [oldItems] = await connection.execute(
          'SELECT menu_item_id, quantity, item_weight FROM order_items WHERE order_id = ?',
          [id]
        );
        for (const oldIt of oldItems) {
          if (oldIt.menu_item_id) {
            const oldQty = oldIt.item_weight !== null ? parseFloat(oldIt.item_weight) : parseInt(oldIt.quantity);
            await connection.execute(
              'UPDATE menu_items SET reserved_stock = GREATEST(0, reserved_stock - ?) WHERE id = ? AND restaurant_id = ?',
              [oldQty, oldIt.menu_item_id, restaurantId]
            );
          }
        }

        // Delete old items
        await connection.execute('DELETE FROM order_items WHERE order_id = ?', [id]);

        // Insert new items and reserve stock
        for (const item of items) {
          const itemPrice = isNaN(parseFloat(item.price)) ? 0.00 : parseFloat(item.price);
          const itemGstRate = isNaN(parseFloat(item.gst_rate)) ? 0.00 : parseFloat(item.gst_rate);
          const itemQuantity = isNaN(parseInt(item.quantity)) ? 1 : parseInt(item.quantity);
          const itemWeight = item.item_weight !== undefined && item.item_weight !== null ? parseFloat(item.item_weight) : null;
          const weightUnit = item.weight_unit || item.unit || null;
          const baseUnitPrice = item.base_unit_price !== undefined && item.base_unit_price !== null ? parseFloat(item.base_unit_price) : null;
          const barcode = item.barcode || null;

          const soldQty = itemWeight !== null ? parseFloat(itemWeight) : itemQuantity;
          const itemBaseTotal = itemPrice * soldQty;
          const itemDiscount = isNaN(parseFloat(item.discount_amount)) ? 0.00 : parseFloat(item.discount_amount);
          const totalTaxable = itemBaseTotal - itemDiscount;
          const itemTax = parseFloat((totalTaxable * (itemGstRate / 100)).toFixed(2));

          let menuItemId = item.menu_item_id || item.product_id || item.id || null;
          if (menuItemId) {
            const [checkItem] = await connection.execute('SELECT id FROM menu_items WHERE id = ?', [menuItemId]);
            if (checkItem.length === 0) menuItemId = null;
          }

          await connection.execute(
            'INSERT INTO order_items (order_id, menu_item_id, item_name, name, unit_price, price, gst_rate, tax_amount, discount_amount, quantity, item_weight, weight_unit, base_unit_price, barcode, notes) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              id, menuItemId, item.name, item.name, itemPrice, itemPrice, itemGstRate,
              itemTax, item.discount_amount || 0.00, itemQuantity,
              itemWeight, weightUnit, baseUnitPrice, barcode, item.notes || null
            ]
          );

          if (menuItemId) {
            await connection.execute(
              'UPDATE menu_items SET reserved_stock = reserved_stock + ? WHERE id = ? AND restaurant_id = ?',
              [soldQty, menuItemId, restaurantId]
            );
          }
        }
      }

      // 2. Update orders row
      const {
        subtotal,
        tax_amount,
        discount_amount,
        total_amount,
        customer_id,
        customer_name,
        customer_phone,
        notes,
        delivery_date,
        billing_address,
        shipping_address,
        place_of_supply,
        price_list,
        reference_number,
        additional_charges
      } = orderData;

      const safeSubtotal = subtotal !== undefined ? parseFloat(subtotal) : parseFloat(existingOrder.subtotal);
      const safeTaxAmount = tax_amount !== undefined ? parseFloat(tax_amount) : parseFloat(existingOrder.tax_amount);
      const safeDiscountAmount = discount_amount !== undefined ? parseFloat(discount_amount) : parseFloat(existingOrder.discount_amount);
      const safeTotalAmount = total_amount !== undefined ? parseFloat(total_amount) : parseFloat(existingOrder.total_amount);

      await connection.execute(
        `UPDATE orders SET 
          subtotal = ?,
          tax_amount = ?,
          discount_amount = ?,
          total_amount = ?,
          customer_id = COALESCE(?, customer_id),
          customer_name = COALESCE(?, customer_name),
          customer_phone = COALESCE(?, customer_phone),
          notes = ?,
          delivery_date = ?,
          billing_address = ?,
          shipping_address = ?,
          place_of_supply = ?,
          price_list = ?,
          reference_number = ?,
          additional_charges = ?,
          updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?`,
        [
          safeSubtotal,
          safeTaxAmount,
          safeDiscountAmount,
          safeTotalAmount,
          customer_id || null,
          customer_name || null,
          customer_phone || null,
          notes !== undefined ? notes : existingOrder.notes,
          delivery_date || null,
          billing_address || null,
          shipping_address || null,
          place_of_supply || null,
          price_list || 'standard',
          reference_number || null,
          additional_charges ? JSON.stringify(additional_charges) : null,
          id,
          restaurantId
        ]
      );

      await connection.commit();

      const [updatedOrder] = await connection.execute('SELECT * FROM orders WHERE id = ?', [id]);
      const [updatedItems] = await connection.execute('SELECT * FROM order_items WHERE order_id = ?', [id]);

      return {
        order: updatedOrder[0],
        items: updatedItems
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Convert a Sales Order to an Invoice (supports partial and full invoicing)
   * Deducts physical stock exactly once and releases reserved stock.
   */
  static async convertToInvoice(salesOrderId, restaurantId, invoiceData = {}, itemsToInvoice = [], userId = null, userName = 'Staff', shiftId = null) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Lock and fetch Sales Order
      const [orderRows] = await connection.execute(
        'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [salesOrderId, restaurantId]
      );

      if (orderRows.length === 0) {
        throw new Error('Sales Order not found or unauthorized.');
      }

      const salesOrder = orderRows[0];
      if (salesOrder.order_status === 'cancelled') {
        throw new Error('Cannot convert a cancelled Sales Order to an invoice.');
      }

      // 2. Lock all line items of the Sales Order
      const [orderItems] = await connection.execute(
        'SELECT * FROM order_items WHERE order_id = ? FOR UPDATE',
        [salesOrderId]
      );

      const itemsMap = new Map();
      orderItems.forEach(oi => itemsMap.set(oi.id, oi));

      // 3. Determine items to invoice (if itemsToInvoice empty, default to all remaining uninvoiced items)
      const requestedList = (itemsToInvoice && itemsToInvoice.length > 0)
        ? itemsToInvoice
        : ((invoiceData.invoicing_items && invoiceData.invoicing_items.length > 0)
          ? invoiceData.invoicing_items
          : ((invoiceData.items && invoiceData.items.length > 0)
            ? invoiceData.items
            : orderItems.map(oi => {
                const ordQty = oi.item_weight !== null ? parseFloat(oi.item_weight) : parseFloat(oi.quantity);
                const invQty = parseFloat(oi.invoiced_qty || 0);
                return {
                  order_item_id: oi.id,
                  invoicing_qty: Math.max(0, ordQty - invQty)
                };
              })));

      let subtotal = 0;
      let totalTax = 0;
      let totalDiscount = 0;
      const invoiceItemsList = [];

      for (const reqItem of requestedList) {
        const orderItemId = reqItem.order_item_id || reqItem.id;
        const invoiceQty = parseFloat(reqItem.invoicing_qty || reqItem.quantity || 0);

        if (invoiceQty <= 0) continue; // Skip zero quantities

        const oi = itemsMap.get(orderItemId);
        if (!oi) {
          throw new Error(`Order item #${orderItemId} does not belong to this Sales Order.`);
        }

        const orderedQty = oi.item_weight !== null ? parseFloat(oi.item_weight) : parseFloat(oi.quantity);
        const alreadyInvoiced = parseFloat(oi.invoiced_qty || 0);
        const pendingToInvoice = Math.max(0, orderedQty - alreadyInvoiced);

        if (invoiceQty > pendingToInvoice + 0.001) {
          throw new Error(`Cannot invoice ${invoiceQty} ${oi.weight_unit || 'PCS'} of "${oi.name}". Remaining uninvoiced quantity is only ${pendingToInvoice}.`);
        }

        const unitPrice = parseFloat(oi.price || oi.unit_price || 0);
        const gstRate = parseFloat(oi.gst_rate || 0);
        const lineBaseTotal = unitPrice * invoiceQty;
        // Pro-rate discount if any
        const origDisc = parseFloat(oi.discount_amount || 0);
        const lineDisc = orderedQty > 0 ? parseFloat(((origDisc / orderedQty) * invoiceQty).toFixed(2)) : 0;
        
        const taxType = salesOrder.tax_type || 'intra';
        const lineCalc = GstService.calculateLineItemTax({
          price: unitPrice,
          quantity: invoiceQty,
          discountAmount: lineDisc,
          gstRate,
          gstMode: 'excluded',
          taxType,
          hsnCode: oi.hsn_code || null
        });

        subtotal += lineBaseTotal;
        totalDiscount += lineDisc;
        totalTax += lineCalc.totalTax;

        invoiceItemsList.push({
          parentOrderItemId: oi.id,
          menuItemId: oi.menu_item_id,
          name: oi.name,
          unitPrice,
          gstRate,
          lineTax: lineCalc.totalTax,
          lineDisc,
          taxableAmount: lineCalc.taxableAmount,
          cgstRate: lineCalc.cgstRate,
          cgstAmount: lineCalc.cgstAmount,
          sgstRate: lineCalc.sgstRate,
          sgstAmount: lineCalc.sgstAmount,
          igstRate: lineCalc.igstRate,
          igstAmount: lineCalc.igstAmount,
          hsnCode: lineCalc.hsnCode,
          quantity: oi.item_weight !== null ? 1 : Math.round(invoiceQty),
          itemWeight: oi.item_weight !== null ? invoiceQty : null,
          weightUnit: oi.weight_unit || 'PCS',
          baseUnitPrice: oi.base_unit_price,
          barcode: oi.barcode,
          notes: reqItem.notes || oi.notes,
          invoiceQty
        });
      }

      if (invoiceItemsList.length === 0) {
        throw new Error('No items remaining or selected for invoicing.');
      }

      // Add prorated or selected additional charges if specified
      let additionalChargesTotal = 0;
      let invoiceAdditionalCharges = [];
      if (invoiceData.additional_charges && Array.isArray(invoiceData.additional_charges)) {
        invoiceAdditionalCharges = invoiceData.additional_charges;
        additionalChargesTotal = invoiceAdditionalCharges.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
      }

      const rawGrandTotal = parseFloat((subtotal - totalDiscount + totalTax + additionalChargesTotal).toFixed(2));
      const grandTotal = Math.round(rawGrandTotal);
      const roundOff = parseFloat((grandTotal - rawGrandTotal).toFixed(2));

      let invCgst = 0;
      let invSgst = 0;
      let invIgst = 0;
      invoiceItemsList.forEach(it => {
        invCgst += it.cgstAmount;
        invSgst += it.sgstAmount;
        invIgst += it.igstAmount;
      });
      invCgst = parseFloat(invCgst.toFixed(2));
      invSgst = parseFloat(invSgst.toFixed(2));
      invIgst = parseFloat(invIgst.toFixed(2));

      // 4. Generate Invoice Number (INV-YYYYMMDD-xxxx)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const dateStr = `${year}${month}${day}`;
      const prefix = `INV-${dateStr}-`;

      const [maxInv] = await connection.execute(
        'SELECT unique_order_number FROM orders WHERE restaurant_id = ? AND unique_order_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let nextSeq = 1;
      if (maxInv.length > 0) {
        const parts = maxInv[0].unique_order_number.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
      }
      const uniqueInvoiceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

      const activePaymentMode = invoiceData.payment_mode || 'cash';
      const safeShiftId = shiftId || salesOrder.cashier_shift_id || null;
      const deliveryChallanId = invoiceData.delivery_challan_id || null;

      const safeCashierId = !isNaN(parseInt(userId)) ? parseInt(userId) : (!isNaN(parseInt(salesOrder.cashier_id)) ? parseInt(salesOrder.cashier_id) : null);
      const safeCashierName = userName || (typeof userId === 'string' && isNaN(parseInt(userId)) ? userId : (salesOrder.cashier_name || 'Staff'));

      const isCreditOrDueSO = (activePaymentMode === 'credit' || activePaymentMode === 'due' || activePaymentMode === 'udhar');
      const soAdvance = parseFloat(salesOrder.advance_amount || 0);
      const advanceApplied = Math.min(grandTotal, soAdvance);
      
      let invPaidAmount = grandTotal;
      if (invoiceData.paid_amount !== undefined && invoiceData.paid_amount !== null) {
        invPaidAmount = Math.max(0, Math.min(grandTotal, parseFloat(invoiceData.paid_amount) || 0));
      } else if (isCreditOrDueSO) {
        invPaidAmount = advanceApplied; // only advance is considered paid
      }

      let invPaymentStatus = 'completed';
      if (invPaidAmount >= grandTotal && grandTotal > 0) {
        invPaymentStatus = 'paid';
      } else if (invPaidAmount > 0) {
        invPaymentStatus = 'partially_paid';
      } else if (grandTotal > 0) {
        invPaymentStatus = 'unpaid';
      } else {
        invPaymentStatus = 'paid';
      }

      let invDueDate = invoiceData.due_date ? String(invoiceData.due_date).slice(0, 10) : null;
      if (!invDueDate && salesOrder.customer_id && invPaidAmount < grandTotal) {
        try {
          const [cRow] = await connection.execute('SELECT credit_days FROM customers WHERE id = ?', [salesOrder.customer_id]);
          if (cRow.length > 0 && cRow[0].credit_days > 0) {
            const d = new Date();
            d.setDate(d.getDate() + parseInt(cRow[0].credit_days));
            invDueDate = d.toISOString().slice(0, 10);
          }
        } catch (e) {}
      }

      // 5. Insert child Invoice into `orders` (including GST breakdown, delivery_challan_id, and receivables)
      const [invResult] = await connection.execute(
        `INSERT INTO orders (
          order_number, unique_order_number, restaurant_id, cashier_id, cashier_name,
          subtotal, tax_amount, discount_amount, total_amount, paid_amount, due_date, advance_amount, payment_status,
          payment_mode, payment_details,
          order_status, status, cashier_shift_id, table_number_or_takeaway, notes,
          discount_type, discount_value, customer_name, customer_phone, customer_id,
          salesman_id, salesman_name, tax_type, delivery_date, billing_address, shipping_address,
          place_of_supply, price_list, reference_number, additional_charges,
          is_sales_order, warehouse_id, parent_order_id, delivery_challan_id, is_estimate, invoiced_amount,
          cgst_amount, sgst_amount, igst_amount, round_off, tax_invoice_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', 'completed', ?, ?, ?, 'amount', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'TAX_INVOICE')`,
        [
          uniqueInvoiceNumber, uniqueInvoiceNumber, restaurantId, safeCashierId, safeCashierName,
          subtotal, totalTax, totalDiscount, grandTotal, invPaidAmount, invDueDate, advanceApplied, invPaymentStatus,
          activePaymentMode, invoiceData.payment_details ? JSON.stringify(invoiceData.payment_details) : null,
          safeShiftId, salesOrder.table_number_or_takeaway || 'Takeaway', invoiceData.notes || `Invoice for Sales Order #${salesOrder.unique_order_number}`,
          totalDiscount, salesOrder.customer_name, salesOrder.customer_phone, salesOrder.customer_id,
          salesOrder.salesman_id, salesOrder.salesman_name, salesOrder.tax_type || 'intra',
          salesOrder.delivery_date, salesOrder.billing_address, salesOrder.shipping_address,
          salesOrder.place_of_supply, salesOrder.price_list, salesOrder.unique_order_number,
          invoiceAdditionalCharges.length > 0 ? JSON.stringify(invoiceAdditionalCharges) : null,
          salesOrder.warehouse_id, salesOrderId, deliveryChallanId,
          invCgst, invSgst, invIgst, roundOff
        ]
      );

      const invoiceId = invResult.insertId;

      // 6. Insert invoice items & update parent order_items invoiced_qty & deduct physical inventory stock
      for (const it of invoiceItemsList) {
        // Insert into child order_items with line tax snapshot
        await connection.execute(
          `INSERT INTO order_items (
            order_id, menu_item_id, item_name, name, unit_price, price, gst_rate,
            tax_amount, discount_amount, quantity, item_weight, weight_unit, base_unit_price, barcode, notes,
            delivered_qty, invoiced_qty, hsn_code, taxable_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId, it.menuItemId, it.name, it.name, it.unitPrice, it.unitPrice, it.gstRate,
            it.lineTax, it.lineDisc, it.quantity, it.itemWeight, it.weightUnit, it.baseUnitPrice, it.barcode, it.notes,
            it.invoiceQty, it.invoiceQty,
            it.hsnCode || null, it.taxableAmount || 0, it.cgstRate || 0, it.cgstAmount || 0, it.sgstRate || 0, it.sgstAmount || 0, it.igstRate || 0, it.igstAmount || 0
          ]
        );

        // Update parent order_items invoiced_qty
        await connection.execute(
          'UPDATE order_items SET invoiced_qty = invoiced_qty + ? WHERE id = ?',
          [it.invoiceQty, it.parentOrderItemId]
        );

        // Physical stock deduction and reserved stock release (EXACTLY ONCE!)
        if (it.menuItemId) {
          if (salesOrder.warehouse_id) {
            // 1. Release reserved stock from warehouse_stocks
            await connection.execute(
              'UPDATE warehouse_stocks SET reserved_stock = GREATEST(0, reserved_stock - ?) WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
              [it.invoiceQty, restaurantId, salesOrder.warehouse_id, it.menuItemId]
            ).catch(() => {});

            // 2. Atomic stock deduction, sync to menu_items, and ledger entry via StockMovementService
            await StockMovementService.recordMovement(connection, {
              restaurantId,
              warehouseId: salesOrder.warehouse_id,
              menuItemId: it.menuItemId,
              type: 'SALE',
              quantity: -it.invoiceQty,
              unitCost: it.unitPrice,
              referenceType: 'order',
              referenceId: invoiceId,
              referenceNumber: uniqueInvoiceNumber,
              userId: safeCashierId,
              userName: safeCashierName,
              notes: `Invoice #${uniqueInvoiceNumber} for SO #${salesOrder.unique_order_number}`
            }).catch(txErr => console.warn('[Stock Movement Warning]:', txErr.message));
          } else {
            // Fallback for setups without warehouse tracking
            const [curStockRows] = await connection.execute(
              'SELECT current_stock, reserved_stock FROM menu_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
              [it.menuItemId, restaurantId]
            );

            if (curStockRows.length > 0) {
              const prevStock = parseFloat(curStockRows[0].current_stock || 0);
              const prevReserved = parseFloat(curStockRows[0].reserved_stock || 0);
              const newStock = Math.max(0, prevStock - it.invoiceQty);
              const newReserved = Math.max(0, prevReserved - it.invoiceQty);

              await connection.execute(
                'UPDATE menu_items SET current_stock = ?, reserved_stock = ? WHERE id = ? AND restaurant_id = ?',
                [newStock, newReserved, it.menuItemId, restaurantId]
              );

              await connection.execute(
                `INSERT INTO stock_logs (restaurant_id, menu_item_id, user_name, adjustment_type, quantity, previous_stock, new_stock, reason)
                 VALUES (?, ?, ?, 'sale', ?, ?, ?, ?)`,
                [restaurantId, it.menuItemId, safeCashierName, it.invoiceQty, prevStock, newStock, `Invoice #${uniqueInvoiceNumber} (SO #${salesOrder.unique_order_number})`]
              ).catch(sErr => console.warn('[Stock Log Warning]:', sErr.message));
            }
          }
        }
      }

      // 7. Update parent Sales Order status and invoiced_amount
      const [updatedParentItems] = await connection.execute(
        'SELECT quantity, item_weight, invoiced_qty FROM order_items WHERE order_id = ?',
        [salesOrderId]
      );

      let allInvoiced = true;
      for (const r of updatedParentItems) {
        const totalReq = r.item_weight !== null ? parseFloat(r.item_weight) : parseFloat(r.quantity);
        const inv = parseFloat(r.invoiced_qty || 0);
        if (inv < totalReq - 0.001) {
          allInvoiced = false;
        }
      }

      const newParentStatus = allInvoiced ? 'fulfilled' : 'partially_fulfilled';
      await connection.execute(
        'UPDATE orders SET invoiced_amount = invoiced_amount + ?, order_status = ?, updated_at = NOW() WHERE id = ?',
        [grandTotal, newParentStatus, salesOrderId]
      );

      // 8. Handle Customer Ledger
      if (salesOrder.customer_id) {
        if (activePaymentMode === 'credit' || activePaymentMode === 'due') {
          await CustomerLedgerRepository.recordEntry(restaurantId, {
            customerId: salesOrder.customer_id,
            type: 'INVOICE',
            amount: grandTotal,
            referenceType: 'invoice',
            referenceId: invoiceId,
            referenceNumber: uniqueInvoiceNumber,
            paymentMode: activePaymentMode,
            userId: safeCashierId,
            userName: safeCashierName,
            notes: `Invoice #${uniqueInvoiceNumber} on credit (Sales Order #${salesOrder.unique_order_number})`
          }, connection);
        } else {
          await CustomerLedgerRepository.recordEntry(restaurantId, {
            customerId: salesOrder.customer_id,
            type: 'INVOICE',
            amount: grandTotal,
            referenceType: 'invoice',
            referenceId: invoiceId,
            referenceNumber: uniqueInvoiceNumber,
            paymentMode: activePaymentMode,
            userId: safeCashierId,
            userName: safeCashierName,
            notes: `Invoice #${uniqueInvoiceNumber} (Sales Order #${salesOrder.unique_order_number})`
          }, connection);

          await CustomerLedgerRepository.recordEntry(restaurantId, {
            customerId: salesOrder.customer_id,
            type: 'PAYMENT',
            amount: grandTotal,
            referenceType: 'payment_receipt',
            referenceId: invoiceId,
            referenceNumber: uniqueInvoiceNumber,
            paymentMode: activePaymentMode,
            userId: safeCashierId,
            userName: safeCashierName,
            notes: `Paid in full via ${activePaymentMode}`
          }, connection);
        }
      }

      // 9. Update cashier shift if active (CRITICAL: exclude credit / udhar from drawer collections)
      if (safeShiftId) {
        try {
          const immediateNonCredit = isCreditOrDueSO ? 0 : Math.max(0, grandTotal - advanceApplied);
          const cashAdd = (activePaymentMode === 'cash' && !isCreditOrDueSO) ? immediateNonCredit : 0;
          const upiAdd = (['upi', 'gpay', 'phonepe', 'paytm'].includes(activePaymentMode) && !isCreditOrDueSO) ? immediateNonCredit : 0;
          const cardAdd = (['card', 'debit'].includes(activePaymentMode) && !isCreditOrDueSO) ? immediateNonCredit : 0;
          const walletAdd = (activePaymentMode === 'wallet' && !isCreditOrDueSO) ? immediateNonCredit : 0;
          const otherAdd = (!['cash', 'upi', 'gpay', 'phonepe', 'paytm', 'card', 'debit', 'wallet', 'credit', 'due', 'udhar'].includes(activePaymentMode)) ? immediateNonCredit : 0;
          const totalCollectedShift = cashAdd + upiAdd + cardAdd + walletAdd + otherAdd;

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
            [cashAdd, upiAdd, cardAdd, walletAdd, otherAdd, totalCollectedShift, safeShiftId, restaurantId]
          );
        } catch (shiftErr) {
          console.warn('[Shift Update Notice]:', shiftErr.message);
        }
      }

      // 10. Financial Accounts & Customer Ledger Integration
      if (salesOrder.customer_id && (isCreditOrDueSO || invPaidAmount < grandTotal)) {
        try {
          // Record Invoice in customer ledger (Debit grandTotal)
          await CustomerLedgerRepository.recordEntry(restaurantId, {
            customerId: salesOrder.customer_id,
            type: 'INVOICE',
            amount: grandTotal,
            referenceType: 'order',
            referenceId: invoiceId,
            referenceNumber: uniqueInvoiceNumber,
            paymentMode: activePaymentMode,
            userId: safeCashierId,
            userName: safeCashierName || 'Staff',
            notes: `Invoice #${uniqueInvoiceNumber} for Sales Order #${salesOrder.unique_order_number}`
          }, connection);

          // If advance was adjusted or partial amount paid, record PAYMENT entry in ledger
          if (invPaidAmount > 0) {
            await CustomerLedgerRepository.recordEntry(restaurantId, {
              customerId: salesOrder.customer_id,
              type: 'PAYMENT',
              amount: invPaidAmount,
              referenceType: 'order',
              referenceId: invoiceId,
              referenceNumber: uniqueInvoiceNumber,
              paymentMode: 'advance_adjustment',
              userId: safeCashierId,
              userName: safeCashierName || 'Staff',
              notes: `Advance/Payment applied to Invoice #${uniqueInvoiceNumber}`
            }, connection);
          }
        } catch (ledgErr) {
          console.warn('[Customer Ledger SO Invoice Notice]:', ledgErr.message);
        }
      }

      if (activePaymentMode !== 'credit' && activePaymentMode !== 'due' && activePaymentMode !== 'udhar') {
        try {
          const immediateNonCredit = Math.max(0, grandTotal - advanceApplied);
          if (immediateNonCredit > 0) {
            await FinancialAccountService.recordSaleTransaction(connection, {
              restaurantId,
              orderId: invoiceId,
              orderNumber: uniqueInvoiceNumber,
              paymentMode: activePaymentMode,
              paymentDetails: null,
              totalAmount: immediateNonCredit,
              customerName: salesOrder.customer_name,
              customerId: salesOrder.customer_id,
              userId: safeCashierId,
              userName: safeCashierName || 'Staff'
            });
          }
        } catch (finErr) {
          console.warn('[Financial Account Sales Order Invoice Warning]:', finErr.message);
        }
      }

      await connection.commit();

      return {
        success: true,
        invoiceId,
        invoiceNumber: uniqueInvoiceNumber,
        grandTotal,
        invoicedAmount: grandTotal,
        parentOrderStatus: newParentStatus,
        salesOrderId,
        deliveryChallanId
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Convert an Estimate into a Sales Order (reserves stock)
   */
  static async convertEstimateToSalesOrder(estimateId, restaurantId, userId = null, userName = 'Staff') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [estRows] = await connection.execute(
        'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? AND is_estimate = 1 FOR UPDATE',
        [estimateId, restaurantId]
      );

      if (estRows.length === 0) {
        throw new Error('Estimate not found or unauthorized.');
      }

      const estimate = estRows[0];
      if (estimate.order_status === 'converted') {
        throw new Error('This estimate has already been converted to a Sales Order.');
      }

      const [items] = await connection.execute(
        'SELECT * FROM order_items WHERE order_id = ? FOR UPDATE',
        [estimateId]
      );

      // 1. Generate unique SO number
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const dateStr = `${year}${month}${day}`;
      const prefix = `SO-${dateStr}-`;

      const [maxSO] = await connection.execute(
        'SELECT unique_order_number FROM orders WHERE restaurant_id = ? AND unique_order_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let nextSeq = 1;
      if (maxSO.length > 0) {
        const parts = maxSO[0].unique_order_number.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
      }
      const uniqueSONumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

      // 2. Insert Sales Order (with is_sales_order = 1, parent_order_id = estimateId, order_status = 'pending')
      const [soResult] = await connection.execute(
        `INSERT INTO orders (
          order_number, unique_order_number, restaurant_id, cashier_id, cashier_name,
          subtotal, tax_amount, discount_amount, total_amount, payment_mode, payment_details,
          order_status, status, cashier_shift_id, table_number_or_takeaway, notes,
          discount_type, discount_value, customer_name, customer_phone, customer_id,
          salesman_id, salesman_name, tax_type, delivery_date, billing_address, shipping_address,
          place_of_supply, price_list, reference_number, additional_charges,
          is_sales_order, warehouse_id, parent_order_id, is_estimate, invoiced_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 'pending', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, 0)`,
        [
          uniqueSONumber, uniqueSONumber, restaurantId, userId || estimate.cashier_id, userName || estimate.cashier_name,
          estimate.subtotal, estimate.tax_amount, estimate.discount_amount, estimate.total_amount,
          estimate.cashier_shift_id, estimate.table_number_or_takeaway, estimate.notes,
          estimate.discount_type, estimate.discount_value, estimate.customer_name, estimate.customer_phone, estimate.customer_id,
          estimate.salesman_id, estimate.salesman_name, estimate.tax_type, estimate.delivery_date,
          estimate.billing_address, estimate.shipping_address, estimate.place_of_supply, estimate.price_list,
          estimate.unique_order_number, estimate.additional_charges ? JSON.stringify(estimate.additional_charges) : null,
          estimate.warehouse_id, estimateId
        ]
      );

      const soId = soResult.insertId;

      // 3. Insert items and reserve stock for each item
      for (const it of items) {
        await connection.execute(
          `INSERT INTO order_items (
            order_id, menu_item_id, item_name, name, unit_price, price, gst_rate,
            tax_amount, discount_amount, quantity, item_weight, weight_unit, base_unit_price, barcode, notes,
            delivered_qty, invoiced_qty
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
          [
            soId, it.menu_item_id, it.item_name, it.name, it.unit_price, it.price, it.gst_rate,
            it.tax_amount, it.discount_amount, it.quantity, it.item_weight, it.weight_unit, it.base_unit_price, it.barcode, it.notes
          ]
        );

        // Reserve stock now that it is a confirmed Sales Order
        if (it.menu_item_id) {
          const reqQty = it.item_weight !== null ? parseFloat(it.item_weight) : parseFloat(it.quantity);
          await connection.execute(
            'UPDATE menu_items SET reserved_stock = reserved_stock + ? WHERE id = ? AND restaurant_id = ?',
            [reqQty, it.menu_item_id, restaurantId]
          );
          if (estimate.warehouse_id) {
            await connection.execute(
              'UPDATE warehouse_stocks SET reserved_stock = reserved_stock + ? WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ?',
              [reqQty, restaurantId, estimate.warehouse_id, it.menu_item_id]
            ).catch(() => {});
          }
        }
      }

      // 4. Mark estimate as converted
      await connection.execute(
        'UPDATE orders SET order_status = "converted", updated_at = NOW() WHERE id = ?',
        [estimateId]
      );

      await connection.commit();

      return {
        success: true,
        salesOrderId: soId,
        salesOrderNumber: uniqueSONumber,
        estimateId
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Get connected document timeline for an order
   * (Estimate -> Sales Order -> Delivery Challans -> Invoices)
   */
  static async getOrderTimeline(orderId, restaurantId) {
    const [orderRows] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND restaurant_id = ?',
      [orderId, restaurantId]
    );
    if (orderRows.length === 0) return null;
    const currentOrder = orderRows[0];

    let estimate = null;
    let salesOrder = null;
    let soId = currentOrder.id;

    if (currentOrder.is_estimate === 1) {
      estimate = currentOrder;
      const [soRows] = await pool.execute(
        'SELECT * FROM orders WHERE parent_order_id = ? AND is_sales_order = 1 AND restaurant_id = ? LIMIT 1',
        [currentOrder.id, restaurantId]
      );
      if (soRows.length > 0) {
        salesOrder = soRows[0];
        soId = salesOrder.id;
      }
    } else if (currentOrder.is_sales_order === 1) {
      salesOrder = currentOrder;
      if (salesOrder.parent_order_id) {
        const [estRows] = await pool.execute(
          'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? LIMIT 1',
          [salesOrder.parent_order_id, restaurantId]
        );
        if (estRows.length > 0) estimate = estRows[0];
      }
    } else if (currentOrder.parent_order_id) {
      const [soRows] = await pool.execute(
        'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? LIMIT 1',
        [currentOrder.parent_order_id, restaurantId]
      );
      if (soRows.length > 0) {
        salesOrder = soRows[0];
        soId = salesOrder.id;
        if (salesOrder.parent_order_id) {
          const [estRows] = await pool.execute(
            'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? LIMIT 1',
            [salesOrder.parent_order_id, restaurantId]
          );
          if (estRows.length > 0) estimate = estRows[0];
        }
      }
    }

    let challans = [];
    let invoices = [];

    if (soId) {
      const [dcRows] = await pool.execute(
        `SELECT dc.*, 
                (SELECT COUNT(*) FROM delivery_challan_items dci WHERE dci.delivery_challan_id = dc.id) AS total_items,
                (SELECT COALESCE(SUM(delivered_qty), 0) FROM delivery_challan_items dci WHERE dci.delivery_challan_id = dc.id) AS total_delivered_qty
         FROM delivery_challans dc
         WHERE dc.sales_order_id = ? AND dc.restaurant_id = ?
         ORDER BY dc.id ASC`,
        [soId, restaurantId]
      );
      challans = dcRows;

      const [invRows] = await pool.execute(
        `SELECT id, unique_order_number, total_amount, payment_mode, order_status, created_at
         FROM orders
         WHERE parent_order_id = ? AND is_sales_order = 0 AND restaurant_id = ?
         ORDER BY id ASC`,
        [soId, restaurantId]
      );
      invoices = invRows;
    }

    return {
      currentOrder,
      estimate,
      salesOrder,
      challans,
      deliveryChallans: challans,
      invoices
    };
  }
}

module.exports = OrderRepository;
