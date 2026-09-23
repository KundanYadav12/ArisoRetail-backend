const pool = require('../config/db');
const StockMovementService = require('../services/stock_movement_service');
const CustomerLedgerRepository = require('./customer_ledger_repository');
const { GstService } = require('../services/gst_service');
const { getISTDateString, getISTDatePrefix } = require('../utils/date_utils');

class CreditNoteRepository {
  /**
   * Concurrency-safe daily sequence generator for Credit Notes (CN-YYYYMMDD-0001)
   */
  static async getNextCreditNoteNumber(connection, restaurantId) {
    const dateStr = getISTDatePrefix();
    const prefix = `CN-${dateStr}-`;

    const [rows] = await connection.execute(
      'SELECT credit_note_number FROM credit_notes WHERE restaurant_id = ? AND credit_note_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextNum = 1;
    if (rows.length > 0) {
      const parts = rows[0].credit_note_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) nextNum = lastSeq + 1;
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Create a Sales Return & Credit Note with atomic stock and ledger adjustments
   */
  static async create(restaurantId, creditNoteData, items, userId, userName) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const {
        order_id,
        reason = 'sales_return',
        notes = null,
        credit_note_date = getISTDateString()
      } = creditNoteData;

      // 1. Lock original Order
      const [orderRows] = await connection.execute(
        'SELECT * FROM orders WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [order_id, restaurantId]
      );

      if (orderRows.length === 0) {
        throw new Error('Original sales order/invoice not found.');
      }

      let order = orderRows[0];
      // If a pure Sales Order was provided, resolve to the child invoice
      if (order.is_sales_order === 1) {
        const [childInvoices] = await connection.execute(
          'SELECT * FROM orders WHERE parent_order_id = ? AND is_sales_order = 0 AND restaurant_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
          [order.id, restaurantId]
        );
        if (childInvoices.length > 0) {
          order = childInvoices[0];
        }
      }

      const customerId = order.customer_id || null;
      const warehouseId = order.warehouse_id || null;
      const taxType = order.tax_type || 'intra';

      // 2. Generate unique Credit Note Number
      const creditNoteNumber = await this.getNextCreditNoteNumber(connection, restaurantId);

      // 3. Calculate Line Items & Slabs using central GstService
      let totalTaxable = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalTax = 0;
      let grandTotal = 0;

      const processedItems = [];

      for (const it of items) {
        const qty = parseFloat(it.quantity || 1);
        const unitPrice = parseFloat(it.unit_price || it.price || 0);
        const disc = parseFloat(it.discount_amount || 0);
        const gstRate = parseFloat(it.gst_rate !== undefined ? it.gst_rate : 5);

        const lineCalc = GstService.calculateLineItemTax({
          price: unitPrice,
          quantity: qty,
          discountAmount: disc,
          gstRate,
          gstMode: 'excluded',
          taxType,
          hsnCode: it.hsn_code || null
        });

        processedItems.push({
          order_item_id: it.order_item_id || null,
          menu_item_id: it.menu_item_id || null,
          item_name: it.item_name || it.name || 'Item',
          quantity: qty,
          unit_price: unitPrice,
          taxable_amount: lineCalc.taxableAmount,
          gst_rate: gstRate,
          cgst_rate: lineCalc.cgstRate,
          cgst_amount: lineCalc.cgstAmount,
          sgst_rate: lineCalc.sgstRate,
          sgst_amount: lineCalc.sgstAmount,
          igst_rate: lineCalc.igstRate,
          igst_amount: lineCalc.igstAmount,
          total_amount: lineCalc.lineTotal,
          notes: it.notes || null
        });

        totalTaxable += lineCalc.taxableAmount;
        totalCgst += lineCalc.cgstAmount;
        totalSgst += lineCalc.sgstAmount;
        totalIgst += lineCalc.igstAmount;
        totalTax += lineCalc.totalTax;
        grandTotal += lineCalc.lineTotal;
      }

      totalTaxable = GstService.round2(totalTaxable);
      totalCgst = GstService.round2(totalCgst);
      totalSgst = GstService.round2(totalSgst);
      totalIgst = GstService.round2(totalIgst);
      totalTax = GstService.round2(totalTax);
      grandTotal = GstService.round2(grandTotal);

      // 4. Insert Credit Note Header
      const [cnResult] = await connection.execute(
        `INSERT INTO credit_notes (
          restaurant_id, credit_note_number, order_id, customer_id,
          credit_note_date, reason, subtotal, cgst_amount, sgst_amount,
          igst_amount, total_tax, total_amount, status, notes,
          created_by_user_id, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [
          restaurantId,
          creditNoteNumber,
          order_id,
          customerId,
          credit_note_date,
          reason,
          totalTaxable,
          totalCgst,
          totalSgst,
          totalIgst,
          totalTax,
          grandTotal,
          notes,
          userId || null,
          userName || 'Staff'
        ]
      );

      const creditNoteId = cnResult.insertId;

      // 5. Insert Credit Note Items & restore inventory stock
      for (const pit of processedItems) {
        await connection.execute(
          `INSERT INTO credit_note_items (
            credit_note_id, order_item_id, menu_item_id, item_name,
            quantity, unit_price, taxable_amount, gst_rate,
            cgst_rate, cgst_amount, sgst_rate, sgst_amount,
            igst_rate, igst_amount, total_amount, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            creditNoteId,
            pit.order_item_id,
            pit.menu_item_id,
            pit.item_name,
            pit.quantity,
            pit.unit_price,
            pit.taxable_amount,
            pit.gst_rate,
            pit.cgst_rate,
            pit.cgst_amount,
            pit.sgst_rate,
            pit.sgst_amount,
            pit.igst_rate,
            pit.igst_amount,
            pit.total_amount,
            pit.notes
          ]
        );

        // Physical inventory stock reversal via StockMovementService (SALES_RETURN)
        if (pit.menu_item_id && warehouseId) {
          try {
            await StockMovementService.recordMovement(connection, {
              restaurantId,
              menuItemId: pit.menu_item_id,
              warehouseId,
              type: 'SALES_RETURN',
              quantity: pit.quantity,
              referenceType: 'CREDIT_NOTE',
              referenceId: creditNoteId,
              referenceNumber: creditNoteNumber,
              notes: `Stock restored from Credit Note #${creditNoteNumber}`,
              userId,
              userName
            });
          } catch (stockErr) {
            console.warn('[CreditNote Stock Movement Warning]:', stockErr.message);
          }
        }
      }

      // 6. Adjust Customer Ledger if customer is linked
      if (customerId) {
        try {
          await CustomerLedgerRepository.recordEntry(
            restaurantId,
            {
              customerId,
              type: 'RETURN',
              amount: grandTotal,
              referenceType: 'CREDIT_NOTE',
              referenceId: creditNoteId,
              referenceNumber: creditNoteNumber,
              paymentMode: 'CREDIT_NOTE',
              userId,
              userName,
              notes: `Credit Note #${creditNoteNumber} for Invoice #${order.unique_order_number}`
            },
            connection
          );
        } catch (ledgerErr) {
          console.warn('[CreditNote Customer Ledger Warning]:', ledgerErr.message);
        }
      }

      // 7. Record Refund Outflow if cash/bank refund was given
      if (creditNoteData.refund_amount && parseFloat(creditNoteData.refund_amount) > 0) {
        try {
          const FinancialAccountService = require('../services/financial_account_service');
          await FinancialAccountService.recordRefund(connection, {
            restaurantId,
            orderId: order_id,
            orderNumber: order.unique_order_number,
            amount: parseFloat(creditNoteData.refund_amount),
            paymentMode: creditNoteData.refund_mode || 'cash',
            accountId: creditNoteData.refund_account_id || null,
            userId,
            userName,
            notes: `Refund against Credit Note #${creditNoteNumber}`
          });
        } catch (refErr) {
          console.warn('[CreditNote Refund Outflow Warning]:', refErr.message);
        }
      }

      await connection.commit();

      return {
        id: creditNoteId,
        credit_note_number: creditNoteNumber,
        order_id,
        customer_id: customerId,
        subtotal: totalTaxable,
        cgst_amount: totalCgst,
        sgst_amount: totalSgst,
        igst_amount: totalIgst,
        total_tax: totalTax,
        total_amount: grandTotal,
        items: processedItems
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Fetch all Credit Notes for a tenant
   */
  static async getAll(restaurantId, filters = {}) {
    const { date_from, date_to, search, customer_id } = filters;
    let query = `
      SELECT cn.*, o.unique_order_number as invoice_number, c.name as customer_name, c.gst_number as customer_gstin
      FROM credit_notes cn
      LEFT JOIN orders o ON cn.order_id = o.id
      LEFT JOIN customers c ON cn.customer_id = c.id
      WHERE cn.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (date_from) {
      query += ' AND cn.credit_note_date >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND cn.credit_note_date <= ?';
      params.push(date_to);
    }
    if (customer_id) {
      query += ' AND cn.customer_id = ?';
      params.push(customer_id);
    }
    if (search) {
      query += ' AND (cn.credit_note_number LIKE ? OR o.unique_order_number LIKE ? OR c.name LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    query += ' ORDER BY cn.id DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Fetch single Credit Note with items
   */
  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      `SELECT cn.*, o.unique_order_number as invoice_number, c.name as customer_name, c.gst_number as customer_gstin
       FROM credit_notes cn
       LEFT JOIN orders o ON cn.order_id = o.id
       LEFT JOIN customers c ON cn.customer_id = c.id
       WHERE cn.id = ? AND cn.restaurant_id = ?`,
      [id, restaurantId]
    );

    if (rows.length === 0) return null;
    const creditNote = rows[0];

    const [items] = await pool.execute(
      'SELECT * FROM credit_note_items WHERE credit_note_id = ?',
      [id]
    );

    creditNote.items = items;
    return creditNote;
  }
}

module.exports = CreditNoteRepository;
