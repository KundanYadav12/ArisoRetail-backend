const pool = require('../config/db');
const FinancialAccountRepository = require('./financial_account_repository');
const { getISTDateString, getISTDatePrefix } = require('../utils/date_utils');

class PaymentReconciliationRepository {
  /**
   * Sequence generator for Settlements: SETTLE-YYYYMMDD-0001
   */
  static async getNextSettlementNumber(restaurantId, connection = null) {
    const executor = connection || pool;
    const dateStr = getISTDatePrefix();
    const prefix = `SETTLE-${dateStr}-`;

    const [rows] = await executor.execute(
      'SELECT settlement_number FROM payment_settlements WHERE restaurant_id = ? AND settlement_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextSeq = 1;
    if (rows.length > 0) {
      const parts = rows[0].settlement_number.split('-');
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last)) nextSeq = last + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Sequence generator for Adjustments: ADJ-YYYYMMDD-0001
   */
  static async getNextAdjustmentNumber(restaurantId, connection = null) {
    const executor = connection || pool;
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `ADJ-${dateStr}-`;

    const [rows] = await executor.execute(
      'SELECT adjustment_number FROM reconciliation_adjustments WHERE restaurant_id = ? AND adjustment_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextSeq = 1;
    if (rows.length > 0) {
      const parts = rows[0].adjustment_number.split('-');
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last)) nextSeq = last + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Summary Metrics across all electronic payments and settlements
   */
  static async getSummaryMetrics(restaurantId, filters = {}) {
    const { dateFrom, dateTo, paymentMode, accountId } = filters;

    // 1. Expected Electronic Collections from Sales & Customer Payments (Financial Transactions)
    let ftWhere = `
      WHERE ft.restaurant_id = ?
        AND ft.transaction_type IN ('SALE_RECEIPT', 'CUSTOMER_PAYMENT')
        AND ft.payment_mode NOT IN ('cash', 'credit', 'due')
    `;
    const ftParams = [restaurantId];

    if (dateFrom) {
      ftWhere += ' AND DATE(ft.created_at) >= ?';
      ftParams.push(dateFrom);
    }
    if (dateTo) {
      ftWhere += ' AND DATE(ft.created_at) <= ?';
      ftParams.push(dateTo);
    }
    if (paymentMode && paymentMode !== 'all') {
      ftWhere += ' AND ft.payment_mode = ?';
      ftParams.push(paymentMode);
    }
    if (accountId && accountId !== 'all') {
      ftWhere += ' AND ft.account_id = ?';
      ftParams.push(accountId);
    }

    const [ftSummary] = await pool.execute(`
      SELECT
        COALESCE(SUM(ft.amount_in), 0) AS total_expected,
        COALESCE(SUM(CASE WHEN ft.reconciled = 1 THEN ft.amount_in ELSE 0 END), 0) AS total_reconciled_sales,
        COALESCE(SUM(CASE WHEN ft.reconciled = 0 THEN ft.amount_in ELSE 0 END), 0) AS total_unreconciled_sales,
        COUNT(ft.id) AS total_transactions_count,
        COUNT(CASE WHEN ft.reconciled = 0 THEN 1 END) AS unreconciled_count
      FROM financial_transactions ft
      ${ftWhere}
    `, ftParams);

    // 2. Settlements Summary
    let psWhere = 'WHERE ps.restaurant_id = ?';
    const psParams = [restaurantId];

    if (dateFrom) {
      psWhere += ' AND ps.settlement_date >= ?';
      psParams.push(dateFrom);
    }
    if (dateTo) {
      psWhere += ' AND ps.settlement_date <= ?';
      psParams.push(dateTo);
    }
    if (paymentMode && paymentMode !== 'all') {
      psWhere += ' AND ps.payment_mode = ?';
      psParams.push(paymentMode);
    }
    if (accountId && accountId !== 'all') {
      psWhere += ' AND ps.account_id = ?';
      psParams.push(accountId);
    }

    const [psSummary] = await pool.execute(`
      SELECT
        COALESCE(SUM(ps.gross_amount), 0) AS total_settlement_gross,
        COALESCE(SUM(ps.fee_amount), 0) AS total_fee_amount,
        COALESCE(SUM(ps.tax_on_fee), 0) AS total_tax_on_fee,
        COALESCE(SUM(ps.net_amount), 0) AS total_net_settled,
        COALESCE(SUM(ps.matched_amount), 0) AS total_matched,
        COALESCE(SUM(ps.unmatched_amount), 0) AS total_unmatched_settlements,
        COUNT(ps.id) AS total_settlements_count,
        COUNT(CASE WHEN ps.status = 'UNMATCHED' THEN 1 END) AS unmatched_settlements_count,
        COUNT(CASE WHEN ps.status = 'DISCREPANCY' THEN 1 END) AS discrepancy_count
      FROM payment_settlements ps
      ${psWhere}
    `, psParams);

    // 3. Discrepancies and Variances from settlement items
    const [siSummary] = await pool.execute(`
      SELECT
        COALESCE(SUM(ABS(si.variance)), 0) AS total_discrepancy_amount
      FROM settlement_items si
      JOIN payment_settlements ps ON si.settlement_id = ps.id
      ${psWhere} AND si.variance != 0
    `, psParams);

    const expected = parseFloat(ftSummary[0].total_expected || 0);
    const matched = parseFloat(psSummary[0].total_matched || 0);
    const unreconciled = parseFloat(ftSummary[0].total_unreconciled_sales || 0);
    const grossSettled = parseFloat(psSummary[0].total_settlement_gross || 0);
    const feeAmount = parseFloat(psSummary[0].total_fee_amount || 0);
    const taxOnFee = parseFloat(psSummary[0].total_tax_on_fee || 0);
    const totalCharges = parseFloat((feeAmount + taxOnFee).toFixed(2));
    const netSettled = parseFloat(psSummary[0].total_net_settled || 0);
    const discrepancy = parseFloat(siSummary[0]?.total_discrepancy_amount || 0);

    return {
      expected_collection: expected,
      actual_settlement: grossSettled,
      matched_amount: matched,
      unreconciled_amount: unreconciled,
      discrepancy_amount: discrepancy,
      charges_fees: totalCharges,
      net_settlement: netSettled,
      unreconciled_count: parseInt(ftSummary[0].unreconciled_count || 0, 10),
      unmatched_settlements_count: parseInt(psSummary[0].unmatched_settlements_count || 0, 10),
      total_settlements_count: parseInt(psSummary[0].total_settlements_count || 0, 10)
    };
  }

  /**
   * Get Unreconciled POS Sales / Financial Transactions awaiting settlement
   */
  static async getUnreconciledPayments(restaurantId, filters = {}) {
    const {
      dateFrom,
      dateTo,
      paymentMode,
      accountId,
      search,
      limit = 50,
      offset = 0
    } = filters;

    let sql = `
      SELECT
        ft.id AS financial_transaction_id,
        ft.restaurant_id,
        ft.account_id,
        fa.account_name,
        fa.bank_name,
        fa.account_type,
        ft.transaction_type,
        ft.reference_type,
        ft.reference_id,
        ft.reference_number AS order_number,
        ft.payment_mode,
        ft.party_name AS customer_name,
        ft.amount_in AS expected_amount,
        ft.reconciled,
        ft.created_at AS sale_date,
        o.customer_phone,
        o.table_number_or_takeaway,
        o.order_status,
        COALESCE((
          SELECT SUM(si.settled_amount)
          FROM settlement_items si
          WHERE si.financial_transaction_id = ft.id
        ), 0) AS already_settled_amount
      FROM financial_transactions ft
      LEFT JOIN financial_accounts fa ON ft.account_id = fa.id
      LEFT JOIN orders o ON (ft.reference_type = 'order' AND ft.reference_id = o.id)
      WHERE ft.restaurant_id = ?
        AND ft.transaction_type IN ('SALE_RECEIPT', 'CUSTOMER_PAYMENT')
        AND ft.payment_mode NOT IN ('cash', 'credit', 'due')
        AND ft.reconciled = 0
    `;
    const params = [restaurantId];

    if (dateFrom) {
      sql += ' AND DATE(ft.created_at) >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND DATE(ft.created_at) <= ?';
      params.push(dateTo);
    }
    if (paymentMode && paymentMode !== 'all') {
      sql += ' AND ft.payment_mode = ?';
      params.push(paymentMode);
    }
    if (accountId && accountId !== 'all') {
      sql += ' AND ft.account_id = ?';
      params.push(accountId);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      sql += ' AND (ft.reference_number LIKE ? OR ft.party_name LIKE ? OR o.customer_phone LIKE ?)';
      params.push(term, term, term);
    }

    // Count total matching
    const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS subquery`;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.total || 0;

    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    sql += ` ORDER BY ft.id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await pool.execute(sql, params);

    // Compute remaining amount for partial settlements
    const enriched = rows.map(r => {
      const exp = parseFloat(r.expected_amount || 0);
      const settled = parseFloat(r.already_settled_amount || 0);
      const remaining = Math.max(0, parseFloat((exp - settled).toFixed(2)));
      return {
        ...r,
        expected_amount: exp,
        already_settled_amount: settled,
        remaining_amount: remaining
      };
    });

    return {
      payments: enriched,
      total: totalCount,
      limit: safeLimit,
      offset: safeOffset
    };
  }

  /**
   * Create a new Bank / Gateway Settlement
   */
  static async createSettlement(restaurantId, settlementData, user = {}, connection = null) {
    const executor = connection || pool;
    const {
      account_id,
      payment_mode,
      settlement_date,
      gross_amount,
      fee_amount = 0.00,
      tax_on_fee = 0.00,
      reference_number,
      notes,
      idempotency_key = null
    } = settlementData;

    // 1. Check idempotency key
    if (idempotency_key) {
      const [existing] = await executor.execute(
        'SELECT * FROM payment_settlements WHERE restaurant_id = ? AND idempotency_key = ? LIMIT 1',
        [restaurantId, idempotency_key]
      );
      if (existing.length > 0) {
        return this.findSettlementById(existing[0].id, restaurantId, executor);
      }
    }

    const gross = parseFloat(gross_amount || 0);
    const fee = parseFloat(fee_amount || 0);
    const tax = parseFloat(tax_on_fee || 0);
    const net = parseFloat((gross - fee - tax).toFixed(2));
    const sNumber = await this.getNextSettlementNumber(restaurantId, executor);

    const [result] = await executor.execute(`
      INSERT INTO payment_settlements (
        restaurant_id, settlement_number, account_id, payment_mode,
        settlement_date, gross_amount, fee_amount, tax_on_fee,
        net_amount, matched_amount, unmatched_amount, reference_number,
        status, notes, idempotency_key, created_by_user_id,
        created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, 'UNMATCHED', ?, ?, ?, ?, NOW())
    `, [
      restaurantId, sNumber, account_id, (payment_mode || 'upi').toLowerCase().trim(),
      settlement_date || getISTDateString(),
      gross, fee, tax, net, gross, reference_number || null,
      notes || null, idempotency_key || null, user.id || null, user.name || 'Staff'
    ]);

    return this.findSettlementById(result.insertId, restaurantId, executor);
  }

  /**
   * Find Settlement by ID with joined items and account info
   */
  static async findSettlementById(id, restaurantId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.execute(`
      SELECT
        ps.*,
        fa.account_name,
        fa.bank_name,
        fa.account_type,
        fa.account_number
      FROM payment_settlements ps
      LEFT JOIN financial_accounts fa ON ps.account_id = fa.id
      WHERE ps.id = ? AND ps.restaurant_id = ?
    `, [id, restaurantId]);

    if (rows.length === 0) return null;
    const settlement = rows[0];

    // Fetch matched items
    const [items] = await executor.execute(`
      SELECT
        si.*,
        ft.payment_mode AS transaction_payment_mode,
        ft.party_name,
        ft.created_at AS sale_date,
        o.customer_phone
      FROM settlement_items si
      LEFT JOIN financial_transactions ft ON si.financial_transaction_id = ft.id
      LEFT JOIN orders o ON si.order_id = o.id
      WHERE si.settlement_id = ? AND si.restaurant_id = ?
      ORDER BY si.id ASC
    `, [id, restaurantId]);

    settlement.items = items;
    return settlement;
  }

  /**
   * List all settlements with filters and pagination
   */
  static async findAllSettlements(restaurantId, filters = {}) {
    const {
      dateFrom,
      dateTo,
      paymentMode,
      accountId,
      status,
      search,
      limit = 50,
      offset = 0
    } = filters;

    let sql = `
      SELECT
        ps.*,
        fa.account_name,
        fa.bank_name,
        fa.account_type,
        (SELECT COUNT(*) FROM settlement_items si WHERE si.settlement_id = ps.id) AS matched_orders_count
      FROM payment_settlements ps
      LEFT JOIN financial_accounts fa ON ps.account_id = fa.id
      WHERE ps.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (dateFrom) {
      sql += ' AND ps.settlement_date >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND ps.settlement_date <= ?';
      params.push(dateTo);
    }
    if (paymentMode && paymentMode !== 'all') {
      sql += ' AND ps.payment_mode = ?';
      params.push(paymentMode);
    }
    if (accountId && accountId !== 'all') {
      sql += ' AND ps.account_id = ?';
      params.push(accountId);
    }
    if (status && status !== 'all') {
      sql += ' AND ps.status = ?';
      params.push(status);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      sql += ' AND (ps.settlement_number LIKE ? OR ps.reference_number LIKE ? OR ps.notes LIKE ?)';
      params.push(term, term, term);
    }

    const countSql = `SELECT COUNT(*) AS total FROM (${sql}) AS subquery`;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.total || 0;

    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    sql += ` ORDER BY ps.settlement_date DESC, ps.id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await pool.execute(sql, params);

    return {
      settlements: rows,
      total: totalCount,
      limit: safeLimit,
      offset: safeOffset
    };
  }

  /**
   * Atomic Payment Settlement Matching
   * Matches one or more POS order payments to a settlement batch
   */
  static async matchSettlement(restaurantId, {
    settlementId,
    matches = [], // [{ financial_transaction_id, settled_amount, fee_amount, tax_on_fee, variance_reason, notes }]
    varianceReason = null,
    notes = null
  }, user = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Lock settlement FOR UPDATE
      const [sRows] = await connection.execute(
        'SELECT * FROM payment_settlements WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [settlementId, restaurantId]
      );
      if (sRows.length === 0) {
        throw new Error(`Settlement #${settlementId} not found or unauthorized.`);
      }
      const settlement = sRows[0];

      let currentMatched = parseFloat(settlement.matched_amount || 0);
      const grossAmount = parseFloat(settlement.gross_amount || 0);
      let totalVariance = 0;

      for (const m of matches) {
        const ftId = m.financial_transaction_id;
        // Lock financial transaction
        const [ftRows] = await connection.execute(
          'SELECT * FROM financial_transactions WHERE id = ? AND restaurant_id = ? FOR UPDATE',
          [ftId, restaurantId]
        );
        if (ftRows.length === 0) {
          throw new Error(`Financial transaction #${ftId} not found.`);
        }
        const ft = ftRows[0];

        const expectedAmt = parseFloat(m.expected_amount !== undefined ? m.expected_amount : ft.amount_in);
        const settledAmt = parseFloat(m.settled_amount !== undefined ? m.settled_amount : expectedAmt);
        const isPartial = Boolean(m.is_partial);
        const feeAmt = parseFloat(m.fee_amount || 0);
        const taxAmt = parseFloat(m.tax_on_fee || 0);
        const netAmt = parseFloat((settledAmt - feeAmt - taxAmt).toFixed(2));
        const variance = isPartial ? 0 : parseFloat((settledAmt - expectedAmt).toFixed(2));
        totalVariance += variance;

        // Verify already settled sum for this transaction
        const [existItems] = await connection.execute(
          'SELECT COALESCE(SUM(settled_amount), 0) AS total_settled FROM settlement_items WHERE financial_transaction_id = ?',
          [ftId]
        );
        const priorSettled = parseFloat(existItems[0].total_settled || 0);
        const totalSettledNow = parseFloat((priorSettled + settledAmt).toFixed(2));

        // Insert settlement item
        await connection.execute(`
          INSERT INTO settlement_items (
            restaurant_id, settlement_id, order_id, order_number,
            financial_transaction_id, expected_amount, settled_amount,
            fee_amount, tax_on_fee, net_amount, variance, variance_reason,
            match_type, notes, reconciled_by_user_id, reconciled_by_name,
            reconciled_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [
          restaurantId, settlementId,
          ft.reference_type === 'order' ? parseInt(ft.reference_id, 10) : null,
          ft.reference_number || null,
          ft.id, expectedAmt, settledAmt, feeAmt, taxAmt, netAmt, variance,
          m.variance_reason || varianceReason || null,
          m.match_type || 'MANUAL_MATCH',
          m.notes || notes || null,
          user.id || null, user.name || 'Staff'
        ]);

        // If transaction is fully settled or balanced, mark reconciled = 1
        if (totalSettledNow >= expectedAmt || variance !== 0) {
          await connection.execute(`
            UPDATE financial_transactions SET
              reconciled = 1,
              reconciled_at = NOW(),
              reconciliation_ref = ?
            WHERE id = ?
          `, [settlement.reference_number || settlement.settlement_number, ft.id]);
        }

        currentMatched = parseFloat((currentMatched + settledAmt).toFixed(2));
      }

      // If fee was deducted on settlement and not yet posted to financial ledger, post fee as expense
      const totalFee = parseFloat(settlement.fee_amount || 0) + parseFloat(settlement.tax_on_fee || 0);
      if (totalFee > 0) {
        const feeIdempotencyKey = `fee_settle_${restaurantId}_${settlement.id}`;
        const existingFee = await FinancialAccountRepository.findTransactionByIdempotency(
          restaurantId,
          feeIdempotencyKey,
          connection
        );

        if (!existingFee) {
          // Deduct MDR/Gateway charge from account balance
          const lockedAcc = await FinancialAccountRepository.lockAccount(settlement.account_id, restaurantId, connection);
          if (lockedAcc) {
            const prevBal = parseFloat(lockedAcc.current_balance || 0);
            const newBal = parseFloat((prevBal - totalFee).toFixed(2));

            await FinancialAccountRepository.recordTransaction({
              restaurant_id: restaurantId,
              account_id: settlement.account_id,
              transaction_type: 'EXPENSE_PAYMENT',
              reference_type: 'settlement',
              reference_id: String(settlement.id),
              reference_number: settlement.settlement_number,
              payment_mode: settlement.payment_mode,
              amount_in: 0.00,
              amount_out: totalFee,
              balance_after: newBal,
              description: `Payment Gateway / MDR Charges for Settlement #${settlement.settlement_number}`,
              user_id: user.id,
              user_name: user.name,
              idempotency_key: feeIdempotencyKey
            }, connection);

            await FinancialAccountRepository.updateBalance(settlement.account_id, restaurantId, newBal, connection);
          }
        }
      }

      // Update settlement status and matched amounts
      const remainingUnmatched = Math.max(0, parseFloat((grossAmount - currentMatched).toFixed(2)));
      let newStatus = 'PARTIALLY_MATCHED';
      if (currentMatched === 0) {
        newStatus = 'UNMATCHED';
      } else if (remainingUnmatched === 0) {
        newStatus = (totalVariance !== 0) ? 'DISCREPANCY' : 'SETTLED';
      } else if (totalVariance !== 0) {
        newStatus = 'DISCREPANCY';
      }

      await connection.execute(`
        UPDATE payment_settlements SET
          matched_amount = ?,
          unmatched_amount = ?,
          status = ?,
          updated_at = NOW()
        WHERE id = ?
      `, [currentMatched, remainingUnmatched, newStatus, settlementId]);

      // Audit Log
      await connection.execute(`
        INSERT INTO audit_logs (
          restaurant_id, user_id, user_name, user_role, action,
          description, created_at
        ) VALUES (?, ?, ?, ?, 'PAYMENT_RECONCILIATION_MATCH', ?, NOW())
      `, [
        restaurantId, user.id || null, user.name || 'Staff', user.role || 'manager',
        `Matched ${matches.length} payment(s) to settlement #${settlement.settlement_number} (Matched: ₹${currentMatched}, Status: ${newStatus})`
      ]);

      await connection.commit();
      return this.findSettlementById(settlementId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Deterministic Auto-Matching Engine
   */
  static async runAutoMatching(restaurantId, settlementId = null, user = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let settlements = [];
      if (settlementId) {
        const [sRows] = await connection.execute(
          'SELECT * FROM payment_settlements WHERE id = ? AND restaurant_id = ? AND status IN ("UNMATCHED", "PARTIALLY_MATCHED") FOR UPDATE',
          [settlementId, restaurantId]
        );
        settlements = sRows;
      } else {
        const [sRows] = await connection.execute(
          'SELECT * FROM payment_settlements WHERE restaurant_id = ? AND status IN ("UNMATCHED", "PARTIALLY_MATCHED") ORDER BY id ASC LIMIT 25 FOR UPDATE',
          [restaurantId]
        );
        settlements = sRows;
      }

      let autoMatchedCount = 0;

      for (const settle of settlements) {
        const unmatchedAmt = parseFloat(settle.unmatched_amount || settle.gross_amount || 0);
        if (unmatchedAmt <= 0) continue;

        // Level 1: Match by exact reference number (UTR / Payout ID)
        if (settle.reference_number) {
          const [refMatches] = await connection.execute(`
            SELECT ft.* FROM financial_transactions ft
            WHERE ft.restaurant_id = ?
              AND ft.reconciled = 0
              AND ft.transaction_type IN ('SALE_RECEIPT', 'CUSTOMER_PAYMENT')
              AND (ft.reference_number = ? OR ft.idempotency_key LIKE ?)
            LIMIT 1
          `, [restaurantId, settle.reference_number, `%${settle.reference_number}%`]);

          if (refMatches.length === 1) {
            const matchFt = refMatches[0];
            const ftAmt = parseFloat(matchFt.amount_in || 0);
            if (ftAmt <= unmatchedAmt) {
              await connection.rollback(); // Release transaction for atomic call
              connection.release();
              await this.matchSettlement(restaurantId, {
                settlementId: settle.id,
                matches: [{
                  financial_transaction_id: matchFt.id,
                  settled_amount: ftAmt,
                  match_type: 'AUTO_EXACT_REF'
                }]
              }, user);
              autoMatchedCount++;
              return { matched: autoMatchedCount };
            }
          }
        }

        // Level 2: Exact Amount Match within ±3 days for same payment mode
        const [amtMatches] = await connection.execute(`
          SELECT ft.* FROM financial_transactions ft
          WHERE ft.restaurant_id = ?
            AND ft.reconciled = 0
            AND ft.transaction_type IN ('SALE_RECEIPT', 'CUSTOMER_PAYMENT')
            AND ft.payment_mode = ?
            AND ft.amount_in = ?
            AND DATE(ft.created_at) BETWEEN DATE_SUB(?, INTERVAL 3 DAY) AND DATE_ADD(?, INTERVAL 3 DAY)
        `, [restaurantId, settle.payment_mode, unmatchedAmt, settle.settlement_date, settle.settlement_date]);

        // Only auto-match if exactly ONE candidate exists (avoid ambiguous matches!)
        if (amtMatches.length === 1) {
          const singleMatch = amtMatches[0];
          await connection.rollback();
          connection.release();
          await this.matchSettlement(restaurantId, {
            settlementId: settle.id,
            matches: [{
              financial_transaction_id: singleMatch.id,
              settled_amount: unmatchedAmt,
              match_type: 'AUTO_EXACT_AMOUNT'
            }]
          }, user);
          autoMatchedCount++;
          return { matched: autoMatchedCount };
        }
      }

      await connection.commit();
      return { matched: autoMatchedCount };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      if (!connection._released) connection.release();
    }
  }

  /**
   * Create Audited Financial Adjustment
   */
  static async createAdjustment(restaurantId, adjustmentData, user = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const {
        settlement_id = null,
        order_id = null,
        account_id,
        adjustment_type,
        amount,
        reason
      } = adjustmentData;

      if (!account_id || !adjustment_type || !amount || !reason) {
        throw new Error('Account, adjustment type, amount, and reason are mandatory.');
      }

      const adjAmount = parseFloat(amount || 0);
      const adjNumber = await this.getNextAdjustmentNumber(restaurantId, connection);

      // Lock financial account
      const lockedAcc = await FinancialAccountRepository.lockAccount(account_id, restaurantId, connection);
      if (!lockedAcc) throw new Error('Financial account not found.');

      const isOutflow = ['FEE_DEDUCTION', 'SHORT_SETTLEMENT', 'CHARGEBACK'].includes(adjustment_type);
      const prevBal = parseFloat(lockedAcc.current_balance || 0);
      const newBal = isOutflow ? parseFloat((prevBal - adjAmount).toFixed(2)) : parseFloat((prevBal + adjAmount).toFixed(2));

      // Post adjustment to financial transactions
      const ftId = await FinancialAccountRepository.recordTransaction({
        restaurant_id: restaurantId,
        account_id,
        transaction_type: isOutflow ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN',
        reference_type: 'adjustment',
        reference_id: String(settlement_id || order_id || adjNumber),
        reference_number: adjNumber,
        amount_in: isOutflow ? 0.00 : adjAmount,
        amount_out: isOutflow ? adjAmount : 0.00,
        balance_after: newBal,
        description: `Reconciliation Adjustment #${adjNumber} (${adjustment_type}): ${reason}`,
        user_id: user.id,
        user_name: user.name,
        idempotency_key: `adj_${restaurantId}_${adjNumber}`
      }, connection);

      await FinancialAccountRepository.updateBalance(account_id, restaurantId, newBal, connection);

      // Insert adjustment record
      const [res] = await connection.execute(`
        INSERT INTO reconciliation_adjustments (
          restaurant_id, adjustment_number, settlement_id, order_id,
          account_id, adjustment_type, amount, reason,
          financial_transaction_id, user_id, user_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, adjNumber, settlement_id || null, order_id || null,
        account_id, adjustment_type, adjAmount, reason,
        ftId, user.id || null, user.name || 'Staff'
      ]);

      // Audit Log
      await connection.execute(`
        INSERT INTO audit_logs (
          restaurant_id, user_id, user_name, user_role, action,
          description, created_at
        ) VALUES (?, ?, ?, ?, 'RECONCILIATION_ADJUSTMENT', ?, NOW())
      `, [
        restaurantId, user.id || null, user.name || 'Staff', user.role || 'admin',
        `Created adjustment #${adjNumber} (${adjustment_type}, ₹${adjAmount}) on account #${account_id}. Reason: ${reason}`
      ]);

      await connection.commit();
      return { id: res.insertId, adjustment_number: adjNumber };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Unmatch / Reverse Settlement Item
   */
  static async unmatchSettlementItem(restaurantId, settlementItemId, user = {}) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [itemRows] = await connection.execute(
        'SELECT * FROM settlement_items WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [settlementItemId, restaurantId]
      );
      if (itemRows.length === 0) throw new Error('Settlement item not found.');
      const item = itemRows[0];

      // Reset financial transaction reconciled status
      if (item.financial_transaction_id) {
        await connection.execute(`
          UPDATE financial_transactions SET
            reconciled = 0,
            reconciled_at = NULL,
            reconciliation_ref = NULL
          WHERE id = ?
        `, [item.financial_transaction_id]);
      }

      // Delete settlement item
      await connection.execute(
        'DELETE FROM settlement_items WHERE id = ?',
        [settlementItemId]
      );

      // Recalculate settlement matched / unmatched amounts and status
      const [recalc] = await connection.execute(
        'SELECT COALESCE(SUM(settled_amount), 0) AS new_matched FROM settlement_items WHERE settlement_id = ?',
        [item.settlement_id]
      );
      const newMatched = parseFloat(recalc[0].new_matched || 0);

      const [sRows] = await connection.execute(
        'SELECT * FROM payment_settlements WHERE id = ? FOR UPDATE',
        [item.settlement_id]
      );
      if (sRows.length > 0) {
        const s = sRows[0];
        const gross = parseFloat(s.gross_amount || 0);
        const newUnmatched = Math.max(0, parseFloat((gross - newMatched).toFixed(2)));
        const newStatus = (newMatched === 0) ? 'UNMATCHED' : (newUnmatched === 0 ? 'SETTLED' : 'PARTIALLY_MATCHED');

        await connection.execute(`
          UPDATE payment_settlements SET
            matched_amount = ?,
            unmatched_amount = ?,
            status = ?,
            updated_at = NOW()
          WHERE id = ?
        `, [newMatched, newUnmatched, newStatus, item.settlement_id]);
      }

      // Audit Log
      await connection.execute(`
        INSERT INTO audit_logs (
          restaurant_id, user_id, user_name, user_role, action,
          description, created_at
        ) VALUES (?, ?, ?, ?, 'PAYMENT_RECONCILIATION_UNMATCH', ?, NOW())
      `, [
        restaurantId, user.id || null, user.name || 'Staff', user.role || 'manager',
        `Unmatched settlement item #${settlementItemId} (Amount: ₹${item.settled_amount})`
      ]);

      await connection.commit();
      return { success: true, settlement_id: item.settlement_id };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = PaymentReconciliationRepository;
