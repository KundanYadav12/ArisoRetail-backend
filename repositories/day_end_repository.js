const pool = require('../config/db');
const { getISTDateString, getISTDatePrefix, formatLocalDate } = require('../utils/date_utils');

class DayEndRepository {
  /**
   * Concurrency-safe daily sequence generator for Z-Reports (Z-YYYYMMDD-0001)
   */
  static async getNextZReportNumber(connection, restaurantId) {
    const dateStr = getISTDatePrefix();
    const prefix = `Z-${dateStr}-`;

    const [rows] = await connection.execute(
      'SELECT z_report_number FROM day_ends WHERE restaurant_id = ? AND z_report_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextNum = 1;
    if (rows.length > 0 && rows[0].z_report_number) {
      const parts = rows[0].z_report_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) nextNum = lastSeq + 1;
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Fetch currently active business day for a restaurant
   */
  static async getActiveBusinessDay(restaurantId, connection = null) {
    const db = connection || pool;
    const [rows] = await db.execute(
      `SELECT * FROM business_days 
       WHERE restaurant_id = ? AND status IN ('OPEN', 'CLOSING', 'REOPENED_FOR_CORRECTION') 
       ORDER BY business_date DESC, id DESC LIMIT 1`,
      [restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Fetch business day by specific ID
   */
  static async getBusinessDayById(restaurantId, businessDayId, connection = null) {
    const db = connection || pool;
    const [rows] = await db.execute(
      'SELECT * FROM business_days WHERE restaurant_id = ? AND id = ? LIMIT 1',
      [restaurantId, businessDayId]
    );
    return rows[0] || null;
  }

  /**
   * Fetch business day by specific Date
   */
  static async getBusinessDayByDate(restaurantId, dateStr, connection = null) {
    const db = connection || pool;
    const [rows] = await db.execute(
      'SELECT * FROM business_days WHERE restaurant_id = ? AND business_date = ? LIMIT 1',
      [restaurantId, dateStr]
    );
    return rows[0] || null;
  }

  /**
   * Open a new business day with opening cash float
   */
  static async openBusinessDay(restaurantId, {
    businessDate,
    openingFloat = 0.00,
    userId = null,
    userName = 'Staff',
    notes = null
  }, connection = null) {
    const db = connection || pool;
    const targetDate = businessDate || getISTDateString();
    const floatVal = parseFloat(openingFloat || 0);

    // 1. Check if business day already exists for this date
    const [existing] = await db.execute(
      'SELECT id, status, business_date FROM business_days WHERE restaurant_id = ? AND business_date = ? LIMIT 1',
      [restaurantId, targetDate]
    );

    if (existing.length > 0) {
      const bDay = existing[0];
      if (bDay.status === 'CLOSED') {
        throw new Error(`Business day for date ${targetDate} is already CLOSED. Please select another date or reopen for correction.`);
      }
      // Update opening cash float if requested
      await db.execute(
        'UPDATE business_days SET opening_cash_float = ?, notes = COALESCE(?, notes) WHERE id = ?',
        [floatVal, notes, bDay.id]
      );
      return this.getBusinessDayById(restaurantId, bDay.id, connection);
    }

    // 2. Insert new business day record
    const [result] = await db.execute(
      `INSERT INTO business_days (
        restaurant_id, business_date, opening_time, opening_cash_float, status,
        opened_by_user_id, opened_by_name, notes
      ) VALUES (?, ?, NOW(), ?, 'OPEN', ?, ?, ?)`,
      [restaurantId, targetDate, floatVal, userId, userName, notes]
    );

    return this.getBusinessDayById(restaurantId, result.insertId, connection);
  }

  /**
   * Parse multi-payment splits from order row
   */
  static parseOrderPaymentSplits(order) {
    const splits = [];
    const mainMode = (order.payment_mode || 'cash').toLowerCase().trim();
    const orderTotal = parseFloat(order.total_amount || 0);

    let parsedDetails = null;
    if (order.payment_details) {
      if (typeof order.payment_details === 'string') {
        try {
          parsedDetails = JSON.parse(order.payment_details);
        } catch (e) {
          parsedDetails = null;
        }
      } else if (typeof order.payment_details === 'object') {
        parsedDetails = order.payment_details;
      }
    }

    if (Array.isArray(parsedDetails) && parsedDetails.length > 0) {
      for (const p of parsedDetails) {
        const amt = parseFloat(p.amount || 0);
        if (amt > 0) {
          splits.push({
            mode: (p.mode || p.payment_mode || mainMode).toLowerCase().trim(),
            amount: amt
          });
        }
      }
    } else if (parsedDetails && typeof parsedDetails === 'object') {
      for (const [key, val] of Object.entries(parsedDetails)) {
        const amt = parseFloat(val || 0);
        if (amt > 0 && key !== 'notes' && key !== 'reference') {
          splits.push({ mode: key.toLowerCase().trim(), amount: amt });
        }
      }
    }

    if (splits.length === 0) {
      splits.push({
        mode: mainMode,
        amount: orderTotal
      });
    }

    return splits;
  }

  /**
   * Live calculation of sales, payments, expenses, and cash reconciliation
   * for a given business day WITHOUT altering database records.
   */
  static async calculateReconciliationSummary(restaurantId, businessDay, connection = null) {
    const db = connection || pool;
    const dateStr = formatLocalDate(businessDay.business_date);

    const openingFloat = parseFloat(businessDay.opening_cash_float || 0);

    // Time boundaries: either full business date or opening_time to closing_time/now
    const datePattern = `${dateStr}%`;

    // 1. Fetch all orders for this business day
    const [orders] = await db.execute(
      `SELECT id, unique_order_number, total_amount, subtotal, tax_amount, discount_amount,
              cgst_amount, sgst_amount, igst_amount, round_off, payment_mode, payment_details,
              order_status, is_estimate, is_sales_order, created_at
       FROM orders
       WHERE restaurant_id = ? AND (DATE(created_at) = ? OR created_at LIKE ?)`,
      [restaurantId, dateStr, datePattern]
    );

    let grossSales = 0;
    let totalDiscount = 0;
    let taxableAmount = 0;
    let totalTax = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    let roundOff = 0;
    let netSales = 0;

    let totalBills = 0;
    let paidBills = 0;
    let creditBills = 0;
    let creditAmount = 0;
    let cancelledBills = 0;
    let cancelledAmount = 0;
    let pendingBills = 0;
    let pendingAmount = 0;

    // Collections by Payment Mode accumulator map
    const paymentModeMap = new Map();

    for (const ord of orders) {
      // Estimates are quotations only - ignore in final retail sales reconciliation
      if (ord.is_estimate === 1 || ord.is_estimate === true) continue;

      // Pure Sales Orders are commitments only - ignore in retail sales reconciliation to prevent double counting with realized child invoices
      if (ord.is_sales_order === 1 || ord.is_sales_order === true) continue;

      const st = (ord.order_status || 'completed').toLowerCase();
      const tot = parseFloat(ord.total_amount || 0);
      const sub = parseFloat(ord.subtotal || 0);
      const disc = parseFloat(ord.discount_amount || 0);
      const tax = parseFloat(ord.tax_amount || 0);
      const cgst = parseFloat(ord.cgst_amount || 0);
      const sgst = parseFloat(ord.sgst_amount || 0);
      const igst = parseFloat(ord.igst_amount || 0);
      const roff = parseFloat(ord.round_off || 0);

      if (st === 'cancelled') {
        cancelledBills++;
        cancelledAmount += tot;
        continue;
      }

      if (st === 'pending') {
        pendingBills++;
        pendingAmount += tot;
        continue;
      }

      // Valid completed / active invoice
      totalBills++;
      grossSales += (sub + disc);
      totalDiscount += disc;
      taxableAmount += sub;
      totalTax += tax;
      cgstAmount += cgst;
      sgstAmount += sgst;
      igstAmount += igst;
      roundOff += roff;
      netSales += tot;

      // Check payment mode & split payments
      const splits = this.parseOrderPaymentSplits(ord);
      for (const sp of splits) {
        const modeKey = sp.mode.toLowerCase().trim();
        const amt = sp.amount;

        if (modeKey === 'credit' || modeKey === 'due') {
          creditBills++;
          creditAmount += amt;
        } else {
          paidBills++;
        }

        const prev = paymentModeMap.get(modeKey) || { mode: modeKey, expected: 0, count: 0 };
        prev.expected += amt;
        prev.count += 1;
        paymentModeMap.set(modeKey, prev);
      }
    }

    grossSales = parseFloat(grossSales.toFixed(2));
    totalDiscount = parseFloat(totalDiscount.toFixed(2));
    taxableAmount = parseFloat(taxableAmount.toFixed(2));
    totalTax = parseFloat(totalTax.toFixed(2));
    cgstAmount = parseFloat(cgstAmount.toFixed(2));
    sgstAmount = parseFloat(sgstAmount.toFixed(2));
    igstAmount = parseFloat(igstAmount.toFixed(2));
    roundOff = parseFloat(roundOff.toFixed(2));
    netSales = parseFloat(netSales.toFixed(2));
    creditAmount = parseFloat(creditAmount.toFixed(2));
    cancelledAmount = parseFloat(cancelledAmount.toFixed(2));
    pendingAmount = parseFloat(pendingAmount.toFixed(2));

    // Cash sales from payment splits
    const cashSales = parseFloat((paymentModeMap.get('cash')?.expected || 0).toFixed(2));

    // 2. Fetch Expenses for this business day
    const [expenseRows] = await db.execute(
      `SELECT id, amount, total_amount, payment_mode, category, status
       FROM expenses 
       WHERE restaurant_id = ? AND (DATE(expense_date) = ? OR expense_date LIKE ?) AND status != 'CANCELLED'`,
      [restaurantId, dateStr, datePattern]
    );

    let totalExpenses = 0;
    let cashExpenses = 0;
    let bankExpenses = 0;

    for (const exp of expenseRows) {
      const expAmt = parseFloat(exp.total_amount || exp.amount || 0);
      const mode = (exp.payment_mode || 'cash').toLowerCase().trim();
      totalExpenses += expAmt;
      if (mode === 'cash') {
        cashExpenses += expAmt;
      } else {
        bankExpenses += expAmt;
      }
    }
    totalExpenses = parseFloat(totalExpenses.toFixed(2));
    cashExpenses = parseFloat(cashExpenses.toFixed(2));
    bankExpenses = parseFloat(bankExpenses.toFixed(2));

    // 3. Cash Movements (Float in / Cash Payouts out)
    const [movementRows] = await db.execute(
      `SELECT movement_type, amount FROM cash_movements 
       WHERE restaurant_id = ? AND (DATE(created_at) = ? OR created_at LIKE ?)`,
      [restaurantId, dateStr, datePattern]
    );

    let otherCashIn = 0;
    let cashWithdrawals = 0;
    for (const m of movementRows) {
      const amt = parseFloat(m.amount || 0);
      if (m.movement_type === 'in') {
        otherCashIn += amt;
      } else if (m.movement_type === 'out') {
        cashWithdrawals += amt;
      }
    }
    otherCashIn = parseFloat(otherCashIn.toFixed(2));
    cashWithdrawals = parseFloat(cashWithdrawals.toFixed(2));

    // 4. Inter-Account Transfers (Contra Transfers affecting cash account)
    let cashTransfersIn = 0;
    let cashTransfersOut = 0;

    try {
      const [cashAcc] = await db.execute(
        "SELECT id FROM financial_accounts WHERE restaurant_id = ? AND account_type = 'cash' LIMIT 1",
        [restaurantId]
      );
      if (cashAcc.length > 0) {
        const cashAccId = cashAcc[0].id;
        const [transfers] = await db.execute(
          `SELECT from_account_id, to_account_id, amount 
           FROM account_transfers 
           WHERE restaurant_id = ? AND (DATE(transfer_date) = ? OR transfer_date LIKE ?)`,
          [restaurantId, dateStr, datePattern]
        );
        for (const t of transfers) {
          const amt = parseFloat(t.amount || 0);
          if (t.to_account_id === cashAccId) {
            cashTransfersIn += amt; // Money transferred into cash drawer
          }
          if (t.from_account_id === cashAccId) {
            cashTransfersOut += amt; // Money withdrawn from cash drawer to bank
          }
        }
      }
    } catch (tErr) {}

    cashTransfersIn = parseFloat(cashTransfersIn.toFixed(2));
    cashTransfersOut = parseFloat(cashTransfersOut.toFixed(2));

    // 5. Sales Returns & Refunds paid from cash
    let returnedBills = 0;
    let returnedAmount = 0;
    let refundsFromCash = 0;

    try {
      const [creditNotes] = await db.execute(
        `SELECT id, total_amount, status, created_at 
         FROM credit_notes 
         WHERE restaurant_id = ? AND (DATE(credit_note_date) = ? OR credit_note_date LIKE ?) AND status != 'cancelled'`,
        [restaurantId, dateStr, datePattern]
      );
      for (const cn of creditNotes) {
        returnedBills++;
        returnedAmount += parseFloat(cn.total_amount || 0);
      }

      // Check cash refunds in financial_transactions
      const [refundRows] = await db.execute(
        `SELECT amount_out FROM financial_transactions 
         WHERE restaurant_id = ? AND transaction_type = 'REFUND' 
           AND LOWER(payment_mode) = 'cash' AND (DATE(created_at) = ? OR created_at LIKE ?)`,
        [restaurantId, dateStr, datePattern]
      );
      for (const r of refundRows) {
        refundsFromCash += parseFloat(r.amount_out || 0);
      }
    } catch (cnErr) {}

    returnedAmount = parseFloat(returnedAmount.toFixed(2));
    refundsFromCash = parseFloat(refundsFromCash.toFixed(2));

    // 5b. Cash Supplier Payments Out
    let cashSupplierPayments = 0;
    try {
      const [suppPayRows] = await db.execute(
        `SELECT amount FROM supplier_payments 
         WHERE restaurant_id = ? AND LOWER(payment_mode) = 'cash' 
           AND (DATE(payment_date) = ? OR payment_date LIKE ? OR DATE(created_at) = ? OR created_at LIKE ?)`,
        [restaurantId, dateStr, datePattern, dateStr, datePattern]
      );
      for (const sp of suppPayRows) {
        cashSupplierPayments += parseFloat(sp.amount || 0);
      }
    } catch (spErr) {}
    cashSupplierPayments = parseFloat(cashSupplierPayments.toFixed(2));

    // 5c. Cash Customer Payments In (Outstanding debt collections in cash)
    let cashCustomerPayments = 0;
    try {
      const [custPayRows] = await db.execute(
        `SELECT amount FROM customer_ledger 
         WHERE restaurant_id = ? AND transaction_type = 'PAYMENT' AND LOWER(payment_mode) = 'cash' 
           AND (DATE(created_at) = ? OR created_at LIKE ?)`,
        [restaurantId, dateStr, datePattern]
      );
      for (const cp of custPayRows) {
        cashCustomerPayments += parseFloat(cp.amount || 0);
      }
    } catch (cpErr) {}
    cashCustomerPayments = parseFloat(cashCustomerPayments.toFixed(2));

    // 6. Expected Cash Formula:
    // Expected Cash = Opening Float + Cash Sales + Cash Customer Payments + Other Cash In + Cash Transfers In - Cash Expenses - Cash Withdrawals - Cash Transfers Out - Refunds From Cash - Cash Supplier Payments
    const expectedCash = parseFloat((
      openingFloat +
      cashSales +
      cashCustomerPayments +
      otherCashIn +
      cashTransfersIn -
      cashExpenses -
      cashWithdrawals -
      cashTransfersOut -
      refundsFromCash -
      cashSupplierPayments
    ).toFixed(2));

    // 7. Configured Payment Mappings for Digital modes
    const [configuredMappings] = await db.execute(
      `SELECT pam.payment_mode, pam.account_id, fa.account_name, fa.bank_name, fa.account_type
       FROM payment_account_mappings pam
       LEFT JOIN financial_accounts fa ON pam.account_id = fa.id
       WHERE pam.restaurant_id = ? AND pam.is_active = 1`,
      [restaurantId]
    );

    const mappingByMode = new Map();
    for (const m of configuredMappings) {
      mappingByMode.set(m.payment_mode.toLowerCase(), m);
    }

    // Combine all standard & dynamically collected payment modes
    const standardModes = ['cash', 'upi', 'card', 'credit', 'online', 'wallet'];
    const allModeKeys = new Set([...standardModes, ...paymentModeMap.keys()]);

    const paymentModesSummary = [];
    let expectedBankDigital = 0;

    for (const modeKey of allModeKeys) {
      const mapItem = paymentModeMap.get(modeKey);
      const expAmt = parseFloat((mapItem?.expected || 0).toFixed(2));
      const count = mapItem?.count || 0;
      const accInfo = mappingByMode.get(modeKey) || null;

      if (modeKey !== 'cash' && modeKey !== 'credit' && modeKey !== 'due') {
        expectedBankDigital += expAmt;
      }

      // Query payment reconciliation settlement status for digital mode
      let settledAmt = 0;
      if (modeKey !== 'cash' && modeKey !== 'credit' && modeKey !== 'due' && expAmt > 0) {
        try {
          const [settledRows] = await db.execute(`
            SELECT COALESCE(SUM(si.settled_amount), 0) AS total_settled
            FROM settlement_items si
            JOIN orders o ON si.order_id = o.id
            WHERE si.restaurant_id = ? AND LOWER(o.payment_mode) = ?
              AND (DATE(o.created_at) = ? OR o.created_at LIKE ?)
          `, [restaurantId, modeKey, dateStr, datePattern]);
          settledAmt = parseFloat(settledRows[0]?.total_settled || 0);
        } catch (sErr) {}
      }

      paymentModesSummary.push({
        mode: modeKey,
        payment_mode: modeKey,
        expected_amount: expAmt,
        transaction_count: count,
        settled_amount: settledAmt,
        unsettled_amount: Math.max(0, parseFloat((expAmt - settledAmt).toFixed(2))),
        mapped_account: accInfo ? {
          account_id: accInfo.account_id,
          account_name: accInfo.account_name,
          bank_name: accInfo.bank_name,
          account_type: accInfo.account_type
        } : null
      });
    }

    expectedBankDigital = parseFloat(expectedBankDigital.toFixed(2));

    return {
      business_day: {
        id: businessDay.id,
        business_date: dateStr,
        status: businessDay.status,
        opening_time: businessDay.opening_time,
        closing_time: businessDay.closing_time,
        opening_cash_float: openingFloat,
        opened_by_user_id: businessDay.opened_by_user_id,
        opened_by_name: businessDay.opened_by_name,
        approval_status: businessDay.approval_status
      },
      sales_summary: {
        gross_sales: grossSales,
        total_discount: totalDiscount,
        taxable_amount: taxableAmount,
        total_tax: totalTax,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        round_off: roundOff,
        net_sales: netSales,
        total_bills: totalBills,
        paid_bills: paidBills,
        credit_bills: creditBills,
        credit_amount: creditAmount,
        cancelled_bills: cancelledBills,
        cancelled_amount: cancelledAmount,
        returned_bills: returnedBills,
        returned_amount: returnedAmount,
        refunded_amount: refundsFromCash,
        pending_bills: pendingBills,
        pending_amount: pendingAmount
      },
      cash_reconciliation: {
        opening_float: openingFloat,
        cash_sales: cashSales,
        cash_customer_payments: cashCustomerPayments,
        other_cash_in: otherCashIn,
        cash_expenses: cashExpenses,
        cash_withdrawals: cashWithdrawals,
        cash_transfers_in: cashTransfersIn,
        cash_transfers_out: cashTransfersOut,
        refunds_from_cash: refundsFromCash,
        cash_supplier_payments: cashSupplierPayments,
        expected_cash: expectedCash
      },
      expense_summary: {
        total_expenses: totalExpenses,
        cash_expenses: cashExpenses,
        bank_expenses: bankExpenses
      },
      digital_reconciliation: {
        expected_bank_digital: expectedBankDigital
      },
      payment_modes: paymentModesSummary
    };
  }

  /**
   * Save or update draft day end reconciliation
   */
  static async saveDraft(restaurantId, businessDayId, draftData, connection = null) {
    const db = connection || pool;
    const {
      actual_cash = 0.00,
      cash_variance = 0.00,
      cash_variance_reason = null,
      payment_reconciliations = [],
      closing_notes = null,
      userId = null,
      userName = 'Staff'
    } = draftData;

    const bDay = await this.getBusinessDayById(restaurantId, businessDayId, db);
    if (!bDay) throw new Error('Business Day record not found.');

    const summary = await this.calculateReconciliationSummary(restaurantId, bDay, db);
    const dateStr = String(summary.business_day.business_date).slice(0, 10);

    const safeActualCash = parseFloat(actual_cash || 0);
    const safeExpectedCash = summary.cash_reconciliation.expected_cash;
    const safeCashVariance = parseFloat((safeActualCash - safeExpectedCash).toFixed(2));

    let expectedDigital = summary.digital_reconciliation.expected_bank_digital;
    let actualDigital = 0;

    for (const pr of payment_reconciliations) {
      if (pr.payment_mode !== 'cash' && pr.payment_mode !== 'credit' && pr.payment_mode !== 'due') {
        actualDigital += parseFloat(pr.actual_amount || 0);
      }
    }
    actualDigital = parseFloat(actualDigital.toFixed(2));
    const digitalVariance = parseFloat((actualDigital - expectedDigital).toFixed(2));

    // Check existing day_ends record
    const [existing] = await db.execute(
      'SELECT id FROM day_ends WHERE restaurant_id = ? AND business_day_id = ? LIMIT 1',
      [restaurantId, businessDayId]
    );

    let dayEndId;
    if (existing.length > 0) {
      dayEndId = existing[0].id;
      await db.execute(
        `UPDATE day_ends SET 
          gross_sales = ?, total_discount = ?, taxable_amount = ?, total_tax = ?,
          cgst_amount = ?, sgst_amount = ?, igst_amount = ?, round_off = ?, net_sales = ?,
          total_bills = ?, paid_bills = ?, credit_bills = ?, credit_amount = ?,
          cancelled_bills = ?, cancelled_amount = ?, returned_bills = ?, returned_amount = ?, refunded_amount = ?,
          opening_float = ?, cash_sales = ?, other_cash_in = ?, cash_expenses = ?,
          cash_withdrawals = ?, cash_transfers_in = ?, cash_transfers_out = ?, refunds_from_cash = ?,
          expected_cash = ?, actual_cash = ?, cash_variance = ?, cash_variance_reason = ?,
          expected_bank_digital = ?, actual_bank_digital = ?, digital_variance = ?,
          total_expenses = ?, cash_expenses_total = ?, bank_expenses_total = ?,
          closing_notes = ?, closed_by_user_id = ?, closed_by_name = ?
         WHERE id = ?`,
        [
          summary.sales_summary.gross_sales, summary.sales_summary.total_discount, summary.sales_summary.taxable_amount, summary.sales_summary.total_tax,
          summary.sales_summary.cgst_amount, summary.sales_summary.sgst_amount, summary.sales_summary.igst_amount, summary.sales_summary.round_off, summary.sales_summary.net_sales,
          summary.sales_summary.total_bills, summary.sales_summary.paid_bills, summary.sales_summary.credit_bills, summary.sales_summary.credit_amount,
          summary.sales_summary.cancelled_bills, summary.sales_summary.cancelled_amount, summary.sales_summary.returned_bills, summary.sales_summary.returned_amount, summary.sales_summary.refunded_amount,
          summary.cash_reconciliation.opening_float, summary.cash_reconciliation.cash_sales, summary.cash_reconciliation.other_cash_in, summary.cash_reconciliation.cash_expenses,
          summary.cash_reconciliation.cash_withdrawals, summary.cash_reconciliation.cash_transfers_in, summary.cash_reconciliation.cash_transfers_out, summary.cash_reconciliation.refunds_from_cash,
          safeExpectedCash, safeActualCash, safeCashVariance, cash_variance_reason || null,
          expectedDigital, actualDigital, digitalVariance,
          summary.expense_summary.total_expenses, summary.expense_summary.cash_expenses, summary.expense_summary.bank_expenses,
          closing_notes || null, userId, userName,
          dayEndId
        ]
      );
    } else {
      const [insertRes] = await db.execute(
        `INSERT INTO day_ends (
          restaurant_id, business_day_id, business_date, status,
          gross_sales, total_discount, taxable_amount, total_tax,
          cgst_amount, sgst_amount, igst_amount, round_off, net_sales,
          total_bills, paid_bills, credit_bills, credit_amount,
          cancelled_bills, cancelled_amount, returned_bills, returned_amount, refunded_amount,
          opening_float, cash_sales, other_cash_in, cash_expenses,
          cash_withdrawals, cash_transfers_in, cash_transfers_out, refunds_from_cash,
          expected_cash, actual_cash, cash_variance, cash_variance_reason,
          expected_bank_digital, actual_bank_digital, digital_variance,
          total_expenses, cash_expenses_total, bank_expenses_total,
          closing_notes, closed_by_user_id, closed_by_name
        ) VALUES (
          ?, ?, ?, 'DRAFT',
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?
        )`,
        [
          restaurantId, businessDayId, dateStr,
          summary.sales_summary.gross_sales, summary.sales_summary.total_discount, summary.sales_summary.taxable_amount, summary.sales_summary.total_tax,
          summary.sales_summary.cgst_amount, summary.sales_summary.sgst_amount, summary.sales_summary.igst_amount, summary.sales_summary.round_off, summary.sales_summary.net_sales,
          summary.sales_summary.total_bills, summary.sales_summary.paid_bills, summary.sales_summary.credit_bills, summary.sales_summary.credit_amount,
          summary.sales_summary.cancelled_bills, summary.sales_summary.cancelled_amount, summary.sales_summary.returned_bills, summary.sales_summary.returned_amount, summary.sales_summary.refunded_amount,
          summary.cash_reconciliation.opening_float, summary.cash_reconciliation.cash_sales, summary.cash_reconciliation.other_cash_in, summary.cash_reconciliation.cash_expenses,
          summary.cash_reconciliation.cash_withdrawals, summary.cash_reconciliation.cash_transfers_in, summary.cash_reconciliation.cash_transfers_out, summary.cash_reconciliation.refunds_from_cash,
          safeExpectedCash, safeActualCash, safeCashVariance, cash_variance_reason || null,
          expectedDigital, actualDigital, digitalVariance,
          summary.expense_summary.total_expenses, summary.expense_summary.cash_expenses, summary.expense_summary.bank_expenses,
          closing_notes || null, userId, userName
        ]
      );
      dayEndId = insertRes.insertId;
    }

    // Update payment reconciliation items
    await db.execute('DELETE FROM day_end_payment_reconciliations WHERE day_end_id = ?', [dayEndId]);

    for (const pr of payment_reconciliations) {
      const mode = (pr.payment_mode || 'cash').toLowerCase().trim();
      const exp = parseFloat(pr.expected_amount || 0);
      const act = parseFloat(pr.actual_amount || 0);
      const vari = parseFloat((act - exp).toFixed(2));

      await db.execute(
        `INSERT INTO day_end_payment_reconciliations (
          day_end_id, restaurant_id, payment_mode, account_id, account_name,
          expected_amount, actual_amount, variance, variance_reason,
          reference_number, settlement_status, settlement_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dayEndId, restaurantId, mode, pr.account_id || null, pr.account_name || null,
          exp, act, vari, pr.variance_reason || null,
          pr.reference_number || null, pr.settlement_status || 'SETTLED', pr.settlement_date || null, pr.notes || null
        ]
      );
    }

    return this.getDayEndById(restaurantId, dayEndId, db);
  }

  /**
   * Final atomic Day Close
   */
  static async closeBusinessDay(restaurantId, closeData) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const {
        business_day_id,
        actual_cash = 0.00,
        cash_variance_reason = null,
        payment_reconciliations = [],
        cash_count = null,
        closing_notes = null,
        userId = null,
        userName = 'Manager',
        userRole = 'manager',
        requires_approval = false
      } = closeData;

      // 1. Lock Business Day FOR UPDATE
      const [bDayRows] = await connection.execute(
        'SELECT * FROM business_days WHERE restaurant_id = ? AND id = ? FOR UPDATE',
        [restaurantId, business_day_id]
      );

      if (bDayRows.length === 0) {
        throw new Error('Business Day record not found.');
      }

      const bDay = bDayRows[0];

      // Idempotency: If already CLOSED, return existing closed record safely without double processing
      if (bDay.status === 'CLOSED') {
        const [existingDe] = await connection.execute(
          'SELECT id FROM day_ends WHERE restaurant_id = ? AND business_day_id = ? LIMIT 1',
          [restaurantId, business_day_id]
        );
        await connection.commit();
        if (existingDe.length > 0) {
          return this.getDayEndById(restaurantId, existingDe[0].id);
        }
        return { message: 'Business day already closed.', business_day_id };
      }

      // 2. Save draft / reconciliation data
      const savedDe = await this.saveDraft(restaurantId, business_day_id, {
        actual_cash,
        cash_variance_reason,
        payment_reconciliations,
        closing_notes,
        userId,
        userName
      }, connection);

      const dayEndId = savedDe.id;

      // 3. Record denomination cash count if provided
      if (cash_count && typeof cash_count === 'object') {
        await this.recordCashCount(restaurantId, {
          business_day_id,
          day_end_id: dayEndId,
          user_id: userId,
          user_name: userName,
          count_type: 'DAY_END',
          ...cash_count,
          total_physical_cash: actual_cash,
          notes: closing_notes
        }, connection);
      }

      // 4. Generate unique Z-Report number (Z-YYYYMMDD-0001)
      const zReportNumber = await this.getNextZReportNumber(connection, restaurantId);

      // 5. Check if approval is required
      const isApprovedRole = ['admin', 'super_admin', 'manager'].includes(userRole.toLowerCase());
      const finalApprovalStatus = isApprovedRole ? 'APPROVED' : (requires_approval ? 'PENDING' : 'APPROVED');
      const finalApprovedBy = isApprovedRole ? userId : null;
      const finalApprovedByName = isApprovedRole ? userName : null;

      // 6. Update day_ends status to CLOSED
      await connection.execute(
        `UPDATE day_ends SET 
          z_report_number = ?, status = 'CLOSED',
          closed_at = NOW(), closed_by_user_id = ?, closed_by_name = ?,
          requires_approval = ?,
          approved_by_user_id = ?, approved_by_name = ?,
          approved_at = ${isApprovedRole ? 'NOW()' : 'NULL'}
         WHERE id = ?`,
        [
          zReportNumber, userId, userName,
          requires_approval ? 1 : 0,
          finalApprovedBy, finalApprovedByName,
          dayEndId
        ]
      );

      // 7. Update business_days status to CLOSED
      await connection.execute(
        `UPDATE business_days SET 
          status = 'CLOSED', closing_time = NOW(),
          closed_at = NOW(), closed_by_user_id = ?, closed_by_name = ?,
          approval_status = ?,
          approved_by_user_id = ?, approved_by_name = ?,
          approved_at = ${isApprovedRole ? 'NOW()' : 'NULL'},
          notes = COALESCE(?, notes)
         WHERE id = ?`,
        [
          userId, userName, finalApprovalStatus,
          finalApprovedBy, finalApprovedByName,
          closing_notes, business_day_id
        ]
      );

      // 8. Close any remaining open cashier shifts for this business day
      await connection.execute(
        `UPDATE cashier_shifts SET 
          status = 'closed', logout_time = NOW(),
          closed_by_user_id = ?
         WHERE restaurant_id = ? AND (business_day_id = ? OR (business_day_id IS NULL AND login_time >= ?)) AND status = 'open'`,
        [userId, restaurantId, business_day_id, bDay.opening_time]
      );

      // 9. Audit Log
      try {
        await connection.execute(
          `INSERT INTO audit_logs (
            restaurant_id, user_id, action, description, user_name, user_role, metadata
          ) VALUES (?, ?, 'DAY_CLOSED', ?, ?, ?, ?)`,
          [
            restaurantId, userId,
            `Business day ${bDay.business_date} closed successfully with Z-Report #${zReportNumber}.`,
            userName, userRole,
            JSON.stringify({
              business_day_id,
              z_report_number: zReportNumber,
              actual_cash,
              cash_variance: savedDe.cash_variance,
              cash_variance_reason
            })
          ]
        );
      } catch (aErr) {}

      await connection.commit();

      return this.getDayEndById(restaurantId, dayEndId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Authorized Reopen of Closed Business Day for Correction
   */
  static async reopenBusinessDay(restaurantId, businessDayId, {
    userId,
    userName = 'Manager',
    userRole = 'manager',
    reason
  }) {
    if (!reason || !reason.trim()) {
      throw new Error('A mandatory reason is required to reopen a closed business day.');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [bDayRows] = await connection.execute(
        'SELECT * FROM business_days WHERE restaurant_id = ? AND id = ? FOR UPDATE',
        [restaurantId, businessDayId]
      );

      if (bDayRows.length === 0) throw new Error('Business day record not found.');
      const bDay = bDayRows[0];

      if (bDay.status !== 'CLOSED') {
        throw new Error(`Business day is currently in status "${bDay.status}", not CLOSED.`);
      }

      await connection.execute(
        `UPDATE business_days SET 
          status = 'REOPENED_FOR_CORRECTION',
          reopened_by_user_id = ?, reopened_by_name = ?, reopened_at = NOW(),
          reopen_reason = ?
         WHERE id = ?`,
        [userId, userName, reason.trim(), businessDayId]
      );

      await connection.execute(
        "UPDATE day_ends SET status = 'DRAFT' WHERE restaurant_id = ? AND business_day_id = ?",
        [restaurantId, businessDayId]
      );

      // Audit Log
      try {
        await connection.execute(
          `INSERT INTO audit_logs (
            restaurant_id, user_id, action, description, user_name, user_role, metadata
          ) VALUES (?, ?, 'DAY_REOPENED', ?, ?, ?, ?)`,
          [
            restaurantId, userId,
            `Business day ${bDay.business_date} reopened for correction. Reason: ${reason.trim()}`,
            userName, userRole,
            JSON.stringify({ business_day_id: businessDayId, reason: reason.trim() })
          ]
        );
      } catch (aErr) {}

      await connection.commit();

      return this.getBusinessDayById(restaurantId, businessDayId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Record denomination-level cash counting entry
   */
  static async recordCashCount(restaurantId, countData, connection = null) {
    const db = connection || pool;
    const {
      business_day_id = null,
      day_end_id = null,
      shift_id = null,
      user_id,
      user_name = 'Staff',
      count_type = 'DAY_END',
      c2000 = 0,
      c500 = 0,
      c200 = 0,
      c100 = 0,
      c50 = 0,
      c20 = 0,
      c10 = 0,
      c5 = 0,
      c2 = 0,
      c1 = 0,
      coins_total = 0.00,
      notes = null
    } = countData;

    const calcTotal = (
      (c2000 * 2000) +
      (c500 * 500) +
      (c200 * 200) +
      (c100 * 100) +
      (c50 * 50) +
      (c20 * 20) +
      (c10 * 10) +
      (c5 * 5) +
      (c2 * 2) +
      (c1 * 1) +
      parseFloat(coins_total || 0)
    );

    const safeTotal = countData.total_physical_cash !== undefined && parseFloat(countData.total_physical_cash) > 0
      ? parseFloat(countData.total_physical_cash)
      : parseFloat(calcTotal.toFixed(2));

    const [result] = await db.execute(
      `INSERT INTO cash_counts (
        restaurant_id, business_day_id, day_end_id, shift_id,
        user_id, user_name, count_type,
        c2000, c500, c200, c100, c50, c20, c10, c5, c2, c1, coins_total,
        total_physical_cash, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        restaurantId, business_day_id, day_end_id, shift_id,
        user_id, user_name, count_type,
        c2000, c500, c200, c100, c50, c20, c10, c5, c2, c1, parseFloat(coins_total || 0),
        safeTotal, notes
      ]
    );

    return {
      id: result.insertId,
      total_physical_cash: safeTotal,
      c2000, c500, c200, c100, c50, c20, c10, c5, c2, c1, coins_total: parseFloat(coins_total || 0)
    };
  }

  /**
   * Get latest cash count for a business day or shift
   */
  static async getLatestCashCount(restaurantId, businessDayId, shiftId = null, connection = null) {
    const db = connection || pool;
    let query = 'SELECT * FROM cash_counts WHERE restaurant_id = ? AND business_day_id = ?';
    const params = [restaurantId, businessDayId];
    if (shiftId) {
      query += ' AND shift_id = ?';
      params.push(shiftId);
    }
    query += ' ORDER BY id DESC LIMIT 1';

    const [rows] = await db.execute(query, params);
    return rows[0] || null;
  }

  /**
   * Fetch Day End by ID with payment reconciliations and cash count
   */
  static async getDayEndById(restaurantId, dayEndId, connection = null) {
    const db = connection || pool;
    const [rows] = await db.execute(
      'SELECT * FROM day_ends WHERE restaurant_id = ? AND id = ? LIMIT 1',
      [restaurantId, dayEndId]
    );

    if (rows.length === 0) return null;
    const dayEnd = rows[0];

    const [reconciliations] = await db.execute(
      'SELECT * FROM day_end_payment_reconciliations WHERE day_end_id = ? ORDER BY id ASC',
      [dayEndId]
    );

    const [cashCountRows] = await db.execute(
      'SELECT * FROM cash_counts WHERE day_end_id = ? ORDER BY id DESC LIMIT 1',
      [dayEndId]
    );

    return {
      ...dayEnd,
      payment_reconciliations: reconciliations,
      cash_count: cashCountRows[0] || null
    };
  }

  /**
   * Fetch Day End history with filters
   */
  static async getDayEndHistory(restaurantId, {
    limit = 30,
    offset = 0,
    dateFrom = null,
    dateTo = null,
    status = null
  }) {
    let where = 'WHERE de.restaurant_id = ?';
    const params = [restaurantId];

    if (dateFrom) {
      where += ' AND de.business_date >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND de.business_date <= ?';
      params.push(dateTo);
    }
    if (status) {
      where += ' AND de.status = ?';
      params.push(status);
    }

    const [countRows] = await pool.execute(
      `SELECT COUNT(id) as total FROM day_ends de ${where}`,
      params
    );

    const query = `
      SELECT de.*, bd.opening_time, bd.closing_time, bd.status as business_day_status
      FROM day_ends de
      LEFT JOIN business_days bd ON de.business_day_id = bd.id
      ${where}
      ORDER BY de.business_date DESC, de.id DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.execute(query, [...params, parseInt(limit, 10), parseInt(offset, 10)]);

    return {
      records: rows,
      total: countRows[0]?.total || 0,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    };
  }
}

module.exports = DayEndRepository;
