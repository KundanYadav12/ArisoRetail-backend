const pool = require('../config/db');
const { getISTDateString, getISTDatePrefix } = require('../utils/date_utils');
const CustomerLedgerRepository = require('./customer_ledger_repository');
const FinancialAccountService = require('../services/financial_account_service');

class CustomerReceivableRepository {
  /**
   * Concurrency-safe daily sequence generator for Customer Receipts (REC-YYYYMMDD-0001)
   */
  static async getNextReceiptNumber(connection, restaurantId) {
    const dateStr = getISTDatePrefix();
    const prefix = `REC-${dateStr}-`;

    const [rows] = await connection.execute(
      'SELECT payment_number FROM customer_payments WHERE restaurant_id = ? AND payment_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextNum = 1;
    if (rows.length > 0 && rows[0].payment_number) {
      const parts = rows[0].payment_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) nextNum = lastSeq + 1;
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Get Customer Receivables Summary, KPIs, and Customer List
   */
  static async getReceivablesSummary(restaurantId, filters = {}) {
    const { search = '', status = 'all' } = filters;
    const queryParams = [restaurantId];
    let searchCondition = '';

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      searchCondition = ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.store_name LIKE ? OR c.gst_number LIKE ?)';
      queryParams.push(s, s, s, s);
    }

    // 1. Fetch aggregated customer receivables
    const sql = `
      SELECT 
        c.id,
        c.restaurant_id,
        c.name,
        c.store_name,
        c.phone,
        c.email,
        c.address,
        c.gst_number,
        COALESCE(c.credit_limit, 0.00) AS credit_limit,
        COALESCE(c.credit_days, 30) AS credit_days,
        COALESCE(c.allow_credit, 1) AS allow_credit,
        COALESCE(c.opening_balance, 0.00) AS opening_balance,
        COALESCE(c.current_balance, 0.00) AS current_balance,
        COALESCE(c.advance_balance, 0.00) AS advance_balance,

        -- Invoice Level Aggregations
        COUNT(DISTINCT o.id) AS total_invoices,
        COALESCE(SUM(o.total_amount), 0.00) AS total_invoiced_amount,
        COALESCE(SUM(o.paid_amount), 0.00) AS total_invoice_paid_amount,
        COALESCE(SUM(CASE WHEN (o.total_amount - o.paid_amount) > 0.005 THEN (o.total_amount - o.paid_amount) ELSE 0 END), 0.00) AS invoice_outstanding_amount,

        -- Overdue & Due Date Tracking
        COALESCE(SUM(CASE 
          WHEN (o.total_amount - o.paid_amount) > 0.005 AND o.due_date IS NOT NULL AND o.due_date < CURDATE() 
          THEN (o.total_amount - o.paid_amount) 
          ELSE 0 
        END), 0.00) AS overdue_amount,

        COALESCE(SUM(CASE 
          WHEN (o.total_amount - o.paid_amount) > 0.005 AND o.due_date = CURDATE() 
          THEN (o.total_amount - o.paid_amount) 
          ELSE 0 
        END), 0.00) AS due_today_amount,

        MAX(o.created_at) AS last_invoice_date
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id 
        AND o.restaurant_id = c.restaurant_id 
        AND o.is_sales_order = 0 
        AND o.order_status = 'completed'
      WHERE c.restaurant_id = ? ${searchCondition}
      GROUP BY c.id
      ORDER BY c.current_balance DESC, c.name ASC
    `;

    const [rows] = await pool.execute(sql, queryParams);

    // Format & calculate status & KPIs
    let totalReceivables = 0;
    let totalOverdue = 0;
    let totalDueToday = 0;
    let totalAdvance = 0;
    let totalCustomersWithDue = 0;

    const formattedCustomers = rows.map(r => {
      const curBal = parseFloat(r.current_balance || 0);
      const invDue = parseFloat(r.invoice_outstanding_amount || 0);
      // Effective total outstanding is current_balance
      const effectiveOutstanding = Math.max(0, curBal);
      const overdue = parseFloat(r.overdue_amount || 0);
      const dueToday = parseFloat(r.due_today_amount || 0);
      const advBal = parseFloat(r.advance_balance || 0);
      const limit = parseFloat(r.credit_limit || 0);
      const availCredit = limit > 0 ? Math.max(0, limit - effectiveOutstanding) : null;

      if (effectiveOutstanding > 0) {
        totalReceivables += effectiveOutstanding;
        totalCustomersWithDue++;
      }
      totalOverdue += overdue;
      totalDueToday += dueToday;
      totalAdvance += advBal;

      let paymentStatus = 'paid';
      if (effectiveOutstanding > 0 && overdue > 0) {
        paymentStatus = 'overdue';
      } else if (effectiveOutstanding > 0 && effectiveOutstanding < parseFloat(r.total_invoiced_amount || 0)) {
        paymentStatus = 'partially_paid';
      } else if (effectiveOutstanding > 0) {
        paymentStatus = 'unpaid';
      }

      return {
        id: r.id,
        restaurant_id: r.restaurant_id,
        name: r.name,
        store_name: r.store_name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        gst_number: r.gst_number,
        credit_limit: limit,
        credit_days: r.credit_days,
        allow_credit: Boolean(r.allow_credit),
        opening_balance: parseFloat(r.opening_balance || 0),
        current_balance: curBal,
        advance_balance: advBal,
        total_outstanding: effectiveOutstanding,
        available_credit: availCredit,
        overdue_amount: overdue,
        due_today_amount: dueToday,
        total_invoices: parseInt(r.total_invoices || 0),
        total_invoiced_amount: parseFloat(r.total_invoiced_amount || 0),
        last_invoice_date: r.last_invoice_date,
        status: paymentStatus
      };
    });

    let filteredList = formattedCustomers;
    if (status === 'overdue') {
      filteredList = formattedCustomers.filter(c => c.overdue_amount > 0);
    } else if (status === 'due') {
      filteredList = formattedCustomers.filter(c => c.total_outstanding > 0);
    } else if (status === 'settled') {
      filteredList = formattedCustomers.filter(c => c.total_outstanding <= 0);
    }

    return {
      kpis: {
        total_receivables: parseFloat(totalReceivables.toFixed(2)),
        total_overdue: parseFloat(totalOverdue.toFixed(2)),
        total_due_today: parseFloat(totalDueToday.toFixed(2)),
        total_advance: parseFloat(totalAdvance.toFixed(2)),
        customers_with_due: totalCustomersWithDue,
        total_customers: formattedCustomers.length
      },
      summary: {
        total_receivables: parseFloat(totalReceivables.toFixed(2)),
        total_overdue: parseFloat(totalOverdue.toFixed(2)),
        total_due_today: parseFloat(totalDueToday.toFixed(2)),
        total_advance_balances: parseFloat(totalAdvance.toFixed(2)),
        total_debtors: totalCustomersWithDue,
        customers_with_due: totalCustomersWithDue,
        total_customers: formattedCustomers.length
      },
      customers: filteredList
    };
  }

  /**
   * Get all unpaid / partially paid invoices for a specific customer
   */
  static async getCustomerUnpaidInvoices(restaurantId, customerId) {
    const [rows] = await pool.execute(`
      SELECT 
        o.id,
        o.order_number,
        o.unique_order_number,
        o.total_amount,
        COALESCE(o.paid_amount, 0.00) AS paid_amount,
        (o.total_amount - COALESCE(o.paid_amount, 0.00)) AS outstanding_amount,
        o.due_date,
        o.created_at,
        o.payment_mode,
        o.payment_status,
        DATEDIFF(CURDATE(), DATE(o.created_at)) AS days_outstanding,
        CASE 
          WHEN o.due_date IS NOT NULL AND o.due_date < CURDATE() THEN 1 
          ELSE 0 
        END AS is_overdue
      FROM orders o
      WHERE o.restaurant_id = ?
        AND o.customer_id = ?
        AND o.is_sales_order = 0
        AND o.order_status = 'completed'
        AND (o.total_amount - COALESCE(o.paid_amount, 0.00)) > 0.005
      ORDER BY 
        CASE WHEN o.due_date IS NOT NULL THEN o.due_date ELSE DATE(o.created_at) END ASC,
        o.id ASC
    `, [restaurantId, customerId]);

    return rows.map(r => ({
      id: r.id,
      order_number: r.unique_order_number || r.order_number,
      total_amount: parseFloat(r.total_amount || 0),
      paid_amount: parseFloat(r.paid_amount || 0),
      outstanding_amount: parseFloat(r.outstanding_amount || 0),
      remaining_due: parseFloat(r.outstanding_amount || 0),
      due_date: r.due_date,
      created_at: r.created_at,
      payment_mode: r.payment_mode,
      payment_status: r.payment_status,
      days_outstanding: parseInt(r.days_outstanding || 0),
      is_overdue: Boolean(r.is_overdue)
    }));
  }

  /**
   * Record Customer Payment with optional multi-invoice allocation
   */
  static async recordCustomerPayment(restaurantId, paymentData, userId, userName) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const resolvedCustomerId = paymentData.customerId || paymentData.customer_id;
      const paymentAmt = parseFloat(paymentData.amount || 0);
      const effectivePaymentMode = paymentData.paymentMode || paymentData.payment_mode || 'cash';
      const effectivePaymentDate = paymentData.paymentDate || paymentData.payment_date || getISTDateString();
      const effectiveAccountId = paymentData.accountId || paymentData.account_id || null;
      const effectiveReferenceNumber = paymentData.referenceNumber || paymentData.reference_number || null;
      const effectiveNotes = paymentData.notes || null;
      const rawAllocations = paymentData.allocations || [];

      if (!resolvedCustomerId) {
        throw new Error('Customer ID is required.');
      }

      if (isNaN(paymentAmt) || paymentAmt <= 0) {
        throw new Error('Valid payment amount greater than 0 is required.');
      }

      // 1. Lock customer row
      const [custRows] = await connection.execute(
        'SELECT id, name, current_balance, advance_balance FROM customers WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [resolvedCustomerId, restaurantId]
      );
      if (custRows.length === 0) {
        throw new Error(`Customer #${resolvedCustomerId} not found.`);
      }
      const customer = custRows[0];

      // 2. Generate Receipt Number (REC-YYYYMMDD-0001)
      const receiptNumber = await this.getNextReceiptNumber(connection, restaurantId);

      // 3. Process Invoice Allocations
      let totalAllocated = 0;
      const allocationRecords = [];

      if (Array.isArray(rawAllocations) && rawAllocations.length > 0) {
        // Manual specific invoice allocation
        for (const alloc of rawAllocations) {
          const allocOrderId = alloc.orderId || alloc.order_id;
          const allocAmt = parseFloat(alloc.amount || alloc.allocated_amount || 0);
          if (allocAmt <= 0 || !allocOrderId) continue;

          // Lock invoice
          const [invRows] = await connection.execute(
            'SELECT id, unique_order_number, total_amount, paid_amount, payment_status FROM orders WHERE id = ? AND customer_id = ? AND restaurant_id = ? FOR UPDATE',
            [allocOrderId, resolvedCustomerId, restaurantId]
          );

          if (invRows.length === 0) {
            throw new Error(`Invoice #${allocOrderId} not found for this customer.`);
          }

          const inv = invRows[0];
          const invTotal = parseFloat(inv.total_amount || 0);
          const invPaid = parseFloat(inv.paid_amount || 0);
          const invUnpaid = parseFloat((invTotal - invPaid).toFixed(2));

          if (allocAmt > invUnpaid + 0.01) {
            throw new Error(`Allocation ₹${allocAmt} exceeds remaining unpaid balance ₹${invUnpaid} on Invoice #${inv.unique_order_number}.`);
          }

          const newPaid = parseFloat((invPaid + allocAmt).toFixed(2));
          const newStatus = newPaid >= (invTotal - 0.01) ? 'paid' : 'partially_paid';

          await connection.execute(
            'UPDATE orders SET paid_amount = ?, payment_status = ?, updated_at = NOW() WHERE id = ?',
            [newPaid, newStatus, inv.id]
          );

          totalAllocated = parseFloat((totalAllocated + allocAmt).toFixed(2));
          allocationRecords.push({
            orderId: inv.id,
            amount: allocAmt,
            orderNumber: inv.unique_order_number
          });
        }

        if (totalAllocated > paymentAmt + 0.01) {
          throw new Error(`Total allocated amount (₹${totalAllocated}) cannot exceed payment amount (₹${paymentAmt}).`);
        }
      } else {
        // Automatic FIFO Allocation to unpaid invoices
        const [unpaidInvoices] = await connection.execute(`
          SELECT id, unique_order_number, total_amount, paid_amount 
          FROM orders 
          WHERE restaurant_id = ? AND customer_id = ? AND is_sales_order = 0 AND order_status = 'completed' AND (total_amount - paid_amount) > 0.005
          ORDER BY CASE WHEN due_date IS NOT NULL THEN due_date ELSE DATE(created_at) END ASC, id ASC
          FOR UPDATE
        `, [restaurantId, resolvedCustomerId]);

        let remainingToAllocate = paymentAmt;
        for (const inv of unpaidInvoices) {
          if (remainingToAllocate <= 0.005) break;

          const invTotal = parseFloat(inv.total_amount || 0);
          const invPaid = parseFloat(inv.paid_amount || 0);
          const invUnpaid = parseFloat((invTotal - invPaid).toFixed(2));
          const applyAmt = Math.min(remainingToAllocate, invUnpaid);

          if (applyAmt > 0) {
            const newPaid = parseFloat((invPaid + applyAmt).toFixed(2));
            const newStatus = newPaid >= (invTotal - 0.01) ? 'paid' : 'partially_paid';

            await connection.execute(
              'UPDATE orders SET paid_amount = ?, payment_status = ?, updated_at = NOW() WHERE id = ?',
              [newPaid, newStatus, inv.id]
            );

            totalAllocated = parseFloat((totalAllocated + applyAmt).toFixed(2));
            remainingToAllocate = parseFloat((remainingToAllocate - applyAmt).toFixed(2));

            allocationRecords.push({
              orderId: inv.id,
              amount: applyAmt,
              orderNumber: inv.unique_order_number
            });
          }
        }
      }

      // Any excess beyond allocated amount goes into customer advance_balance
      const excessAdvance = parseFloat(Math.max(0, paymentAmt - totalAllocated).toFixed(2));

      // 4. Insert into customer_payments
      const [payResult] = await connection.execute(`
        INSERT INTO customer_payments (
          restaurant_id, payment_number, customer_id, order_id, payment_date,
          amount, allocated_amount, advance_amount, payment_mode, account_id,
          reference_number, notes, created_by_user_id, created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId,
        receiptNumber,
        resolvedCustomerId,
        allocationRecords.length === 1 ? allocationRecords[0].orderId : null,
        effectivePaymentDate,
        paymentAmt,
        totalAllocated,
        excessAdvance,
        effectivePaymentMode,
        effectiveAccountId || null,
        effectiveReferenceNumber || null,
        effectiveNotes || null,
        userId || null,
        userName || 'Cashier'
      ]);

      const paymentId = payResult.insertId;

      // 5. Insert allocations breakdown
      for (const al of allocationRecords) {
        await connection.execute(`
          INSERT INTO customer_payment_allocations (
            restaurant_id, payment_id, order_id, allocated_amount, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId,
          paymentId,
          al.orderId,
          al.amount,
          `Applied to Invoice #${al.orderNumber}`
        ]);
      }

      // 6. Update customer balances
      // If advance excess exists, increment customer's advance_balance
      if (excessAdvance > 0) {
        await connection.execute(
          'UPDATE customers SET advance_balance = advance_balance + ? WHERE id = ?',
          [excessAdvance, resolvedCustomerId]
        );
      }

      // 7. Update Customer Ledger atomically
      const ledgerEntry = await CustomerLedgerRepository.recordEntry(restaurantId, {
        customerId: resolvedCustomerId,
        type: 'PAYMENT',
        amount: paymentAmt,
        referenceType: 'payment_receipt',
        referenceId: paymentId,
        referenceNumber: receiptNumber,
        paymentMode: effectivePaymentMode,
        userId,
        userName: userName || 'Cashier',
        notes: effectiveNotes || `Customer payment receipt #${receiptNumber}${allocationRecords.length > 0 ? ` (Allocated to ${allocationRecords.length} invoice${allocationRecords.length > 1 ? 's' : ''})` : ''}`
      }, connection);

      // 8. Financial Account Integration: Route cash / bank / UPI collection
      try {
        await FinancialAccountService.recordCustomerPaymentReceipt(connection, {
          restaurantId,
          customerId: resolvedCustomerId,
          customerName: customer.name,
          amount: paymentAmt,
          paymentMode: effectivePaymentMode,
          accountId: effectiveAccountId,
          referenceNumber: receiptNumber,
          notes: effectiveNotes || `Receipt #${receiptNumber} via ${effectivePaymentMode}`,
          userId,
          userName: userName || 'Cashier'
        });
      } catch (finErr) {
        console.warn('[Financial Account Customer Receipt Warning]:', finErr.message);
      }

      await connection.commit();

      return {
        success: true,
        paymentId,
        receiptNumber,
        customerId: resolvedCustomerId,
        amount: paymentAmt,
        allocatedAmount: totalAllocated,
        advanceAmount: excessAdvance,
        allocations: allocationRecords,
        previousBalance: ledgerEntry.prevBalance,
        newBalance: ledgerEntry.newBalance
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Customer Ageing Report (0-30, 31-60, 61-90, 91-120, 120+ days)
   */
  static async getAgeingReport(restaurantId, filters = {}) {
    const { search = '' } = filters;
    const queryParams = [restaurantId];
    let searchCondition = '';

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      searchCondition = ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.store_name LIKE ?)';
      queryParams.push(s, s, s);
    }

    const sql = `
      SELECT 
        c.id AS customer_id,
        c.name AS customer_name,
        c.store_name,
        c.phone,
        COALESCE(c.credit_limit, 0.00) AS credit_limit,
        COALESCE(c.current_balance, 0.00) AS total_outstanding,

        -- 0 - 30 Days Bucket
        COALESCE(SUM(CASE 
          WHEN (o.total_amount - o.paid_amount) > 0.005 
               AND DATEDIFF(CURDATE(), DATE(o.created_at)) BETWEEN 0 AND 30
          THEN (o.total_amount - o.paid_amount) 
          ELSE 0 
        END), 0.00) AS bucket_0_30,

        -- 31 - 60 Days Bucket
        COALESCE(SUM(CASE 
          WHEN (o.total_amount - o.paid_amount) > 0.005 
               AND DATEDIFF(CURDATE(), DATE(o.created_at)) BETWEEN 31 AND 60
          THEN (o.total_amount - o.paid_amount) 
          ELSE 0 
        END), 0.00) AS bucket_31_60,

        -- 61 - 90 Days Bucket
        COALESCE(SUM(CASE 
          WHEN (o.total_amount - o.paid_amount) > 0.005 
               AND DATEDIFF(CURDATE(), DATE(o.created_at)) BETWEEN 61 AND 90
          THEN (o.total_amount - o.paid_amount) 
          ELSE 0 
        END), 0.00) AS bucket_61_90,

        -- 91 - 120 Days Bucket
        COALESCE(SUM(CASE 
          WHEN (o.total_amount - o.paid_amount) > 0.005 
               AND DATEDIFF(CURDATE(), DATE(o.created_at)) BETWEEN 91 AND 120
          THEN (o.total_amount - o.paid_amount) 
          ELSE 0 
        END), 0.00) AS bucket_91_120,

        -- 120+ Days Bucket
        COALESCE(SUM(CASE 
          WHEN (o.total_amount - o.paid_amount) > 0.005 
               AND DATEDIFF(CURDATE(), DATE(o.created_at)) > 120
          THEN (o.total_amount - o.paid_amount) 
          ELSE 0 
        END), 0.00) AS bucket_120_plus
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id 
        AND o.restaurant_id = c.restaurant_id 
        AND o.is_sales_order = 0 
        AND o.order_status = 'completed'
      WHERE c.restaurant_id = ? ${searchCondition}
      GROUP BY c.id
      HAVING total_outstanding > 0.005 OR (bucket_0_30 + bucket_31_60 + bucket_61_90 + bucket_91_120 + bucket_120_plus) > 0.005
      ORDER BY total_outstanding DESC, c.name ASC
    `;

    const [rows] = await pool.execute(sql, queryParams);

    let sum030 = 0, sum3160 = 0, sum6190 = 0, sum91120 = 0, sum120plus = 0, grandTotalOutstanding = 0;

    const formatted = rows.map(r => {
      const b030 = parseFloat(r.bucket_0_30 || 0);
      const b3160 = parseFloat(r.bucket_31_60 || 0);
      const b6190 = parseFloat(r.bucket_61_90 || 0);
      const b91120 = parseFloat(r.bucket_91_120 || 0);
      const b120 = parseFloat(r.bucket_120_plus || 0);
      const tot = parseFloat(r.total_outstanding || (b030 + b3160 + b6190 + b91120 + b120));

      sum030 += b030;
      sum3160 += b3160;
      sum6190 += b6190;
      sum91120 += b91120;
      sum120plus += b120;
      grandTotalOutstanding += tot;

      return {
        customer_id: r.customer_id,
        customer_name: r.store_name ? `${r.store_name} (${r.customer_name})` : r.customer_name,
        phone: r.phone,
        credit_limit: parseFloat(r.credit_limit || 0),
        total_outstanding: tot,
        bucket_0_30: b030,
        bucket_31_60: b3160,
        bucket_61_90: b6190,
        bucket_91_120: b91120,
        bucket_120_plus: b120
      };
    });

    return {
      totals: {
        bucket_0_30: parseFloat(sum030.toFixed(2)),
        bucket_31_60: parseFloat(sum3160.toFixed(2)),
        bucket_61_90: parseFloat(sum6190.toFixed(2)),
        bucket_91_120: parseFloat(sum91120.toFixed(2)),
        bucket_120_plus: parseFloat(sum120plus.toFixed(2)),
        total_outstanding: parseFloat(grandTotalOutstanding.toFixed(2))
      },
      rows: formatted
    };
  }

  /**
   * Customer Statement with Opening Balance, Invoices, Payments, Credit Notes, and Running Balance
   */
  static async getCustomerStatement(restaurantId, customerId, startDate = null, endDate = null) {
    const [custRows] = await pool.execute(
      'SELECT id, name, store_name, phone, email, address, gst_number, credit_limit, opening_balance, current_balance FROM customers WHERE id = ? AND restaurant_id = ?',
      [customerId, restaurantId]
    );

    if (custRows.length === 0) {
      throw new Error('Customer not found.');
    }
    const customer = custRows[0];

    let start = startDate || '2000-01-01';
    let end = endDate ? `${endDate} 23:59:59` : '2099-12-31 23:59:59';

    // 1. Calculate opening balance up to start date
    const [prevRows] = await pool.execute(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type IN ('INVOICE', 'OPENING_BALANCE') THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN transaction_type IN ('PAYMENT', 'RETURN') THEN amount ELSE 0 END), 0) AS initial_balance
      FROM customer_ledger
      WHERE restaurant_id = ? AND customer_id = ? AND created_at < ?
    `, [restaurantId, customerId, start]);

    let runningBalance = parseFloat(prevRows[0].initial_balance || customer.opening_balance || 0);
    const openingBalance = runningBalance;

    // 2. Fetch ledger entries in range
    const [entries] = await pool.execute(`
      SELECT * FROM customer_ledger
      WHERE restaurant_id = ? AND customer_id = ? AND created_at BETWEEN ? AND ?
      ORDER BY created_at ASC, id ASC
    `, [restaurantId, customerId, start, end]);

    const statementLines = entries.map(e => {
      const amt = parseFloat(e.amount || 0);
      let debit = 0;
      let credit = 0;

      if (e.transaction_type === 'INVOICE' || e.transaction_type === 'OPENING_BALANCE') {
        debit = amt;
        runningBalance = parseFloat((runningBalance + debit).toFixed(2));
      } else if (e.transaction_type === 'PAYMENT' || e.transaction_type === 'RETURN') {
        credit = amt;
        runningBalance = parseFloat((runningBalance - credit).toFixed(2));
      }

      return {
        id: e.id,
        date: e.created_at,
        type: e.transaction_type,
        reference_type: e.reference_type,
        reference_number: e.reference_number,
        payment_mode: e.payment_mode,
        debit,
        credit,
        balance: runningBalance,
        notes: e.notes
      };
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        store_name: customer.store_name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        gst_number: customer.gst_number,
        credit_limit: parseFloat(customer.credit_limit || 0),
        current_balance: parseFloat(customer.current_balance || 0)
      },
      startDate: start,
      endDate: end,
      openingBalance,
      closingBalance: runningBalance,
      statement: statementLines
    };
  }
}

module.exports = CustomerReceivableRepository;
