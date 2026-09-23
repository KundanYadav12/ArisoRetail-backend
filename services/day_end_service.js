const DayEndRepository = require('../repositories/day_end_repository');
const ReceiptRepository = require('../repositories/receipt_repository');
const pool = require('../config/db');
const { getISTDateString, getISTDateTimeString } = require('../utils/date_utils');

class DayEndService {
  /**
   * Get or initialize today's active business day
   */
  static async getActiveOrTodayBusinessDay(restaurantId, autoCreate = false, user = null) {
    let bDay = await DayEndRepository.getActiveBusinessDay(restaurantId);
    if (!bDay && autoCreate) {
      const today = getISTDateString();
      bDay = await DayEndRepository.openBusinessDay(restaurantId, {
        businessDate: today,
        openingFloat: 0.00,
        userId: user?.id || null,
        userName: user?.name || user?.username || 'Staff',
        notes: 'Automatically initialized business day'
      });
    }
    return bDay;
  }

  /**
   * Fetch live reconciliation summary with pre-close diagnostics
   */
  static async getReconciliationSummary(restaurantId, targetDate = null, user = null) {
    let bDay = null;
    const today = getISTDateString();

    if (targetDate) {
      bDay = await DayEndRepository.getBusinessDayByDate(restaurantId, targetDate);

      // If no business day exists for targetDate:
      // If it is today, or if orders exist on that date, auto-open/initialize it
      if (!bDay && targetDate === today) {
        try {
          bDay = await DayEndRepository.openBusinessDay(restaurantId, {
            businessDate: targetDate,
            openingFloat: 0.00,
            userId: user?.id || null,
            userName: user?.name || user?.username || 'Staff',
            notes: 'Automatically initialized business day'
          });
        } catch (e) {
          bDay = await DayEndRepository.getBusinessDayByDate(restaurantId, targetDate);
        }
      }
    } else {
      bDay = await this.getActiveOrTodayBusinessDay(restaurantId, true, user);
    }

    if (!bDay) {
      return {
        business_day: null,
        is_open: false,
        status: 'NOT_OPENED',
        message: 'No business day found for the specified date.',
        sales_summary: {
          gross_sales: 0,
          total_discount: 0,
          taxable_amount: 0,
          total_tax: 0,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          round_off: 0,
          net_sales: 0,
          paid_bills: 0,
          credit_bills: 0,
          credit_amount: 0,
          cancelled_bills: 0,
          cancelled_amount: 0,
          pending_bills: 0,
          pending_amount: 0,
          total_bills: 0
        },
        cash_reconciliation: {
          opening_float: 0,
          cash_sales: 0,
          cash_expenses: 0,
          cash_customer_payments: 0,
          cash_supplier_payments: 0,
          other_cash_in: 0,
          cash_withdrawals: 0,
          cash_transfers_in: 0,
          cash_transfers_out: 0,
          refunds_from_cash: 0,
          expected_cash: 0
        },
        payment_modes: [],
        existing_day_end: null,
        latest_cash_count: null,
        warnings: []
      };
    }

    const summary = await DayEndRepository.calculateReconciliationSummary(restaurantId, bDay);

    // Check latest recorded cash count for this business day
    const latestCashCount = await DayEndRepository.getLatestCashCount(restaurantId, bDay.id);

    // Fetch existing draft or closed day end record
    const [dayEndRows] = await pool.execute(
      'SELECT id, status, z_report_number, actual_cash, cash_variance, cash_variance_reason, closing_notes FROM day_ends WHERE restaurant_id = ? AND business_day_id = ? LIMIT 1',
      [restaurantId, bDay.id]
    );
    const existingDayEnd = dayEndRows[0] || null;

    // Check for open cashier shifts for this restaurant
    const [openShifts] = await pool.execute(
      'SELECT id, cashier_id, starting_cash, login_time FROM cashier_shifts WHERE restaurant_id = ? AND status = "open"',
      [restaurantId]
    );

    // Pre-closing diagnostic warnings
    const warnings = [];
    if (summary.sales_summary.pending_bills > 0) {
      warnings.push({
        code: 'PENDING_BILLS',
        message: `There are ${summary.sales_summary.pending_bills} pending/unsettled orders amounting to ₹${summary.sales_summary.pending_amount.toFixed(2)}. Complete or cancel them before final Day Close.`
      });
    }
    if (openShifts.length > 0) {
      warnings.push({
        code: 'OPEN_SHIFTS',
        message: `There are ${openShifts.length} open cashier shift(s). Shifts will be automatically closed upon final Day Close.`
      });
    }

    return {
      ...summary,
      existing_day_end: existingDayEnd,
      latest_cash_count: latestCashCount,
      open_shifts_count: openShifts.length,
      warnings
    };
  }

  /**
   * Generate Live X Report (Snapshot of current business day without closing)
   */
  static async generateXReport(restaurantId, targetDate = null) {
    let bDay = null;
    if (targetDate) {
      bDay = await DayEndRepository.getBusinessDayByDate(restaurantId, targetDate);
    } else {
      bDay = await DayEndRepository.getActiveBusinessDay(restaurantId);
    }

    if (!bDay) {
      const today = getISTDateString();
      bDay = await DayEndRepository.getBusinessDayByDate(restaurantId, today);
    }

    if (!bDay) {
      throw new Error('No business day record found to generate X Report.');
    }

    const summary = await DayEndRepository.calculateReconciliationSummary(restaurantId, bDay);

    // Store profile & receipt settings
    const receiptSettings = await ReceiptRepository.getByRestaurantId(restaurantId);
    const [restRows] = await pool.execute(
      'SELECT name, address, phone, gst_number FROM restaurants WHERE id = ? LIMIT 1',
      [restaurantId]
    );
    const store = restRows[0] || {};

    return {
      report_type: 'X_REPORT',
      generated_at: getISTDateTimeString(),
      store: {
        name: store.name || 'Ariso Retail Store',
        legal_name: receiptSettings?.legal_name || store.name,
        address: receiptSettings?.address || store.address,
        phone: receiptSettings?.phone || store.phone,
        gst_number: receiptSettings?.gst_number || store.gst_number
      },
      business_day: summary.business_day,
      sales_summary: summary.sales_summary,
      payment_modes: summary.payment_modes,
      cash_reconciliation: summary.cash_reconciliation,
      expense_summary: summary.expense_summary,
      digital_reconciliation: summary.digital_reconciliation
    };
  }

  /**
   * Fetch Final Z Report (Official closing state)
   */
  static async getZReport(restaurantId, dayEndId) {
    const dayEnd = await DayEndRepository.getDayEndById(restaurantId, dayEndId);
    if (!dayEnd) {
      throw new Error('Day End record not found.');
    }

    const bDay = await DayEndRepository.getBusinessDayById(restaurantId, dayEnd.business_day_id);

    const receiptSettings = await ReceiptRepository.getByRestaurantId(restaurantId);
    const [restRows] = await pool.execute(
      'SELECT name, address, phone, gst_number FROM restaurants WHERE id = ? LIMIT 1',
      [restaurantId]
    );
    const store = restRows[0] || {};

    return {
      report_type: 'Z_REPORT',
      z_report_number: dayEnd.z_report_number,
      closed_at: dayEnd.closed_at,
      closed_by: dayEnd.closed_by_name,
      approved_by: dayEnd.approved_by_name || dayEnd.closed_by_name,
      approved_at: dayEnd.approved_at || dayEnd.closed_at,
      store: {
        name: store.name || 'Ariso Retail Store',
        legal_name: receiptSettings?.legal_name || store.name,
        address: receiptSettings?.address || store.address,
        phone: receiptSettings?.phone || store.phone,
        gst_number: receiptSettings?.gst_number || store.gst_number
      },
      business_day: {
        id: bDay?.id,
        business_date: dayEnd.business_date,
        status: bDay?.status,
        opening_time: bDay?.opening_time,
        closing_time: bDay?.closing_time,
        opening_cash_float: dayEnd.opening_float
      },
      sales_summary: {
        gross_sales: parseFloat(dayEnd.gross_sales || 0),
        total_discount: parseFloat(dayEnd.total_discount || 0),
        taxable_amount: parseFloat(dayEnd.taxable_amount || 0),
        total_tax: parseFloat(dayEnd.total_tax || 0),
        cgst_amount: parseFloat(dayEnd.cgst_amount || 0),
        sgst_amount: parseFloat(dayEnd.sgst_amount || 0),
        igst_amount: parseFloat(dayEnd.igst_amount || 0),
        round_off: parseFloat(dayEnd.round_off || 0),
        net_sales: parseFloat(dayEnd.net_sales || 0),
        total_bills: dayEnd.total_bills,
        paid_bills: dayEnd.paid_bills,
        credit_bills: dayEnd.credit_bills,
        credit_amount: parseFloat(dayEnd.credit_amount || 0),
        cancelled_bills: dayEnd.cancelled_bills,
        cancelled_amount: parseFloat(dayEnd.cancelled_amount || 0),
        returned_bills: dayEnd.returned_bills,
        returned_amount: parseFloat(dayEnd.returned_amount || 0),
        refunded_amount: parseFloat(dayEnd.refunded_amount || 0)
      },
      cash_reconciliation: {
        opening_float: parseFloat(dayEnd.opening_float || 0),
        cash_sales: parseFloat(dayEnd.cash_sales || 0),
        other_cash_in: parseFloat(dayEnd.other_cash_in || 0),
        cash_expenses: parseFloat(dayEnd.cash_expenses || 0),
        cash_withdrawals: parseFloat(dayEnd.cash_withdrawals || 0),
        cash_transfers_in: parseFloat(dayEnd.cash_transfers_in || 0),
        cash_transfers_out: parseFloat(dayEnd.cash_transfers_out || 0),
        refunds_from_cash: parseFloat(dayEnd.refunds_from_cash || 0),
        expected_cash: parseFloat(dayEnd.expected_cash || 0),
        actual_cash: parseFloat(dayEnd.actual_cash || 0),
        cash_variance: parseFloat(dayEnd.cash_variance || 0),
        cash_variance_reason: dayEnd.cash_variance_reason
      },
      expense_summary: {
        total_expenses: parseFloat(dayEnd.total_expenses || 0),
        cash_expenses: parseFloat(dayEnd.cash_expenses_total || 0),
        bank_expenses: parseFloat(dayEnd.bank_expenses_total || 0)
      },
      digital_reconciliation: {
        expected_bank_digital: parseFloat(dayEnd.expected_bank_digital || 0),
        actual_bank_digital: parseFloat(dayEnd.actual_bank_digital || 0),
        digital_variance: parseFloat(dayEnd.digital_variance || 0)
      },
      payment_reconciliations: dayEnd.payment_reconciliations || [],
      cash_count: dayEnd.cash_count || null
    };
  }

  /**
   * Execute Final Day Close with business validation
   */
  static async executeDayClose(restaurantId, closeData, user) {
    const {
      business_day_id,
      actual_cash,
      cash_variance_reason,
      allow_pending_bills = false
    } = closeData;

    const bDay = await DayEndRepository.getBusinessDayById(restaurantId, business_day_id);
    if (!bDay) throw new Error('Business Day record not found.');

    if (bDay.status === 'CLOSED') {
      // Idempotency: return existing closed day end record
      const [existing] = await pool.execute(
        'SELECT id FROM day_ends WHERE restaurant_id = ? AND business_day_id = ? LIMIT 1',
        [restaurantId, business_day_id]
      );
      if (existing.length > 0) {
        return this.getZReport(restaurantId, existing[0].id);
      }
      throw new Error('Business day is already closed.');
    }

    // Pre-close validation: Pending bills
    if (!allow_pending_bills) {
      const summary = await DayEndRepository.calculateReconciliationSummary(restaurantId, bDay);
      if (summary.sales_summary.pending_bills > 0) {
        throw new Error(`Cannot close day with ${summary.sales_summary.pending_bills} pending order(s). Please settle or cancel pending orders first.`);
      }
    }

    // Variance Reason validation
    const summary = await DayEndRepository.calculateReconciliationSummary(restaurantId, bDay);
    const expectedCash = summary.cash_reconciliation.expected_cash;
    const actualCashVal = parseFloat(actual_cash !== undefined ? actual_cash : expectedCash);
    const variance = parseFloat((actualCashVal - expectedCash).toFixed(2));

    if (variance !== 0 && (!cash_variance_reason || !cash_variance_reason.trim())) {
      throw new Error(`A variance of ₹${variance.toFixed(2)} was detected. A variance reason is mandatory before closing the day.`);
    }

    return DayEndRepository.closeBusinessDay(restaurantId, {
      ...closeData,
      actual_cash: actualCashVal,
      userId: user.id,
      userName: user.name || user.username || 'Staff',
      userRole: user.role || 'manager'
    });
  }

  /**
   * Authorized Reopen of Closed Day
   */
  static async reopenClosedDay(restaurantId, businessDayId, reason, user) {
    const userRole = (user.role || '').toLowerCase();
    if (!['super_admin', 'admin', 'manager'].includes(userRole)) {
      throw new Error('Unauthorized: Only an Admin or Manager can reopen a closed business day for correction.');
    }

    return DayEndRepository.reopenBusinessDay(restaurantId, businessDayId, {
      userId: user.id,
      userName: user.name || user.username || 'Manager',
      userRole: user.role,
      reason
    });
  }
}

module.exports = DayEndService;
