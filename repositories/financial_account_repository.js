const pool = require('../config/db');
const { getISTDateString, getISTDateTimeString } = require('../utils/date_utils');

class FinancialAccountRepository {
  /**
   * List all financial accounts for a restaurant with stats
   */
  static async findAll(restaurantId, { activeOnly = false, search = '' } = {}) {
    let sql = `
      SELECT fa.*,
        (SELECT MAX(created_at) FROM financial_transactions ft WHERE ft.account_id = fa.id) AS last_transaction_at,
        (SELECT COUNT(*) FROM financial_transactions ft WHERE ft.account_id = fa.id) AS total_transactions,
        (SELECT COUNT(*) FROM financial_transactions ft WHERE ft.account_id = fa.id AND ft.reconciled = 0) AS unreconciled_count
      FROM financial_accounts fa
      WHERE fa.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (activeOnly) {
      sql += ' AND fa.is_active = 1';
    }

    if (search && search.trim()) {
      sql += ' AND (fa.account_name LIKE ? OR fa.bank_name LIKE ? OR fa.account_number LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    sql += ' ORDER BY fa.is_default DESC, fa.account_type ASC, fa.id ASC';

    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  /**
   * Find account by ID with tenant isolation
   */
  static async findById(id, restaurantId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.execute(
      `SELECT fa.*,
        (SELECT MAX(created_at) FROM financial_transactions ft WHERE ft.account_id = fa.id) AS last_transaction_at,
        (SELECT COUNT(*) FROM financial_transactions ft WHERE ft.account_id = fa.id) AS total_transactions,
        (SELECT COUNT(*) FROM financial_transactions ft WHERE ft.account_id = fa.id AND ft.reconciled = 0) AS unreconciled_count
       FROM financial_accounts fa
       WHERE fa.id = ? AND fa.restaurant_id = ?`,
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Create financial account
   */
  static async create(restaurantId, accountData, connection = null) {
    const executor = connection || pool;
    const {
      account_name,
      bank_name,
      account_number,
      account_type = 'bank',
      ifsc_code,
      branch_name,
      opening_balance = 0.00,
      opening_balance_date,
      is_active = 1,
      is_default = 0,
      notes
    } = accountData;

    const opBal = parseFloat(opening_balance || 0);

    const [res] = await executor.execute(`
      INSERT INTO financial_accounts (
        restaurant_id, account_name, bank_name, account_number, account_type,
        ifsc_code, branch_name, opening_balance, opening_balance_date,
        current_balance, is_active, is_default, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      restaurantId, account_name, bank_name || null, account_number || null, account_type,
      ifsc_code || null, branch_name || null, opBal, opening_balance_date || null,
      opBal, is_active ? 1 : 0, is_default ? 1 : 0, notes || null
    ]);

    return res.insertId;
  }

  /**
   * Update financial account
   */
  static async update(id, restaurantId, accountData, connection = null) {
    const executor = connection || pool;
    const {
      account_name,
      bank_name,
      account_number,
      account_type,
      ifsc_code,
      branch_name,
      is_active,
      is_default,
      notes
    } = accountData;

    await executor.execute(`
      UPDATE financial_accounts SET
        account_name = COALESCE(?, account_name),
        bank_name = COALESCE(?, bank_name),
        account_number = COALESCE(?, account_number),
        account_type = COALESCE(?, account_type),
        ifsc_code = COALESCE(?, ifsc_code),
        branch_name = COALESCE(?, branch_name),
        is_active = COALESCE(?, is_active),
        is_default = COALESCE(?, is_default),
        notes = COALESCE(?, notes),
        updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [
      account_name !== undefined ? account_name : null,
      bank_name !== undefined ? bank_name : null,
      account_number !== undefined ? account_number : null,
      account_type !== undefined ? account_type : null,
      ifsc_code !== undefined ? ifsc_code : null,
      branch_name !== undefined ? branch_name : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      is_default !== undefined ? (is_default ? 1 : 0) : null,
      notes !== undefined ? notes : null,
      id, restaurantId
    ]);

    return this.findById(id, restaurantId, executor);
  }

  /**
   * Toggle active state of account
   */
  static async toggleActive(id, restaurantId, isActive) {
    await pool.execute(
      'UPDATE financial_accounts SET is_active = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
      [isActive ? 1 : 0, id, restaurantId]
    );
    return this.findById(id, restaurantId);
  }

  /**
   * Update account balance
   */
  static async updateBalance(id, restaurantId, newBalance, connection = null) {
    const executor = connection || pool;
    await executor.execute(
      'UPDATE financial_accounts SET current_balance = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
      [newBalance, id, restaurantId]
    );
  }

  /**
   * Lock account row FOR UPDATE inside a transaction
   */
  static async lockAccount(id, restaurantId, connection) {
    const [rows] = await connection.execute(
      'SELECT * FROM financial_accounts WHERE id = ? AND restaurant_id = ? FOR UPDATE',
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Get all payment mode -> account mappings
   */
  static async getMappings(restaurantId) {
    const [rows] = await pool.execute(`
      SELECT pam.*, fa.account_name, fa.bank_name, fa.account_type, fa.account_number, fa.is_active as account_active
      FROM payment_account_mappings pam
      LEFT JOIN financial_accounts fa ON pam.account_id = fa.id
      WHERE pam.restaurant_id = ?
      ORDER BY pam.payment_mode ASC
    `, [restaurantId]);
    return rows;
  }

  /**
   * Upsert payment mode mapping
   */
  static async upsertMapping(restaurantId, paymentMode, accountId, isActive = 1) {
    const cleanMode = (paymentMode || '').toLowerCase().trim();
    await pool.execute(`
      INSERT INTO payment_account_mappings (restaurant_id, payment_mode, account_id, is_active, updated_at)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), is_active = VALUES(is_active), updated_at = NOW()
    `, [restaurantId, cleanMode, accountId, isActive ? 1 : 0]);
  }

  /**
   * Resolve account mapped to payment mode
   */
  static async getMappingForMode(restaurantId, paymentMode, connection = null) {
    const executor = connection || pool;
    const cleanMode = (paymentMode || '').toLowerCase().trim();
    const [rows] = await executor.execute(`
      SELECT pam.*, fa.account_name, fa.account_type, fa.current_balance, fa.is_active as account_active
      FROM payment_account_mappings pam
      JOIN financial_accounts fa ON pam.account_id = fa.id
      WHERE pam.restaurant_id = ? AND pam.payment_mode = ? AND pam.is_active = 1 AND fa.is_active = 1
      LIMIT 1
    `, [restaurantId, cleanMode]);
    return rows[0] || null;
  }

  /**
   * Fallback to default Cash or Bank account
   */
  static async getDefaultAccount(restaurantId, accountType = 'cash', connection = null) {
    const executor = connection || pool;
    // 1. Check for is_default = 1
    const [defRows] = await executor.execute(
      'SELECT * FROM financial_accounts WHERE restaurant_id = ? AND account_type = ? AND is_default = 1 AND is_active = 1 LIMIT 1',
      [restaurantId, accountType]
    );
    if (defRows.length > 0) return defRows[0];

    // 2. Any active account of that type
    const [anyRows] = await executor.execute(
      'SELECT * FROM financial_accounts WHERE restaurant_id = ? AND account_type = ? AND is_active = 1 ORDER BY id ASC LIMIT 1',
      [restaurantId, accountType]
    );
    if (anyRows.length > 0) return anyRows[0];

    // 3. Any active account at all
    const [fallback] = await executor.execute(
      'SELECT * FROM financial_accounts WHERE restaurant_id = ? AND is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1',
      [restaurantId]
    );
    return fallback[0] || null;
  }

  /**
   * Record a financial transaction
   */
  static async recordTransaction(transactionData, connection = null) {
    const executor = connection || pool;
    const {
      restaurant_id,
      account_id,
      transaction_type,
      reference_type,
      reference_id = null,
      reference_number = null,
      payment_mode = null,
      party_type = null,
      party_id = null,
      party_name = null,
      amount_in = 0.00,
      amount_out = 0.00,
      balance_after,
      description = null,
      user_id = null,
      user_name = null,
      idempotency_key = null
    } = transactionData;

    const [res] = await executor.execute(`
      INSERT INTO financial_transactions (
        restaurant_id, account_id, transaction_type, reference_type,
        reference_id, reference_number, payment_mode, party_type,
        party_id, party_name, amount_in, amount_out, balance_after,
        description, user_id, user_name, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      restaurant_id, account_id, transaction_type, reference_type,
      reference_id, reference_number, payment_mode, party_type,
      party_id, party_name, parseFloat(amount_in || 0), parseFloat(amount_out || 0),
      parseFloat(balance_after || 0), description, user_id, user_name, idempotency_key
    ]);

    return res.insertId;
  }

  /**
   * Find transaction by idempotency key
   */
  static async findTransactionByIdempotency(restaurantId, idempotencyKey, connection = null) {
    if (!idempotencyKey) return null;
    const executor = connection || pool;
    const [rows] = await executor.execute(
      'SELECT * FROM financial_transactions WHERE restaurant_id = ? AND idempotency_key = ? LIMIT 1',
      [restaurantId, idempotencyKey]
    );
    return rows[0] || null;
  }

  /**
   * Get account transaction ledger
   */
  static async getLedger(restaurantId, accountId, filters = {}) {
    const {
      dateFrom,
      dateTo,
      transactionType,
      paymentMode,
      reconciled,
      limit = 100,
      offset = 0
    } = filters;

    let sql = `
      SELECT ft.*, fa.account_name, fa.account_type, fa.bank_name
      FROM financial_transactions ft
      JOIN financial_accounts fa ON ft.account_id = fa.id
      WHERE ft.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (accountId) {
      sql += ' AND ft.account_id = ?';
      params.push(accountId);
    }

    if (dateFrom) {
      sql += ' AND ft.created_at >= ?';
      params.push(dateFrom);
    }

    if (dateTo) {
      sql += ' AND ft.created_at <= ?';
      params.push(dateTo);
    }

    if (transactionType) {
      sql += ' AND ft.transaction_type = ?';
      params.push(transactionType);
    }

    if (paymentMode) {
      sql += ' AND ft.payment_mode = ?';
      params.push(paymentMode);
    }

    if (reconciled !== undefined && reconciled !== null && reconciled !== '') {
      sql += ' AND ft.reconciled = ?';
      params.push(reconciled === '1' || reconciled === true ? 1 : 0);
    }

    // Totals summary across matching records
    const summarySql = `
      SELECT
        COALESCE(SUM(ft.amount_in), 0) as total_inflow,
        COALESCE(SUM(ft.amount_out), 0) as total_outflow,
        COUNT(*) as total_count
      FROM financial_transactions ft
      WHERE ft.restaurant_id = ?
      ${accountId ? ' AND ft.account_id = ?' : ''}
      ${dateFrom ? ' AND ft.created_at >= ?' : ''}
      ${dateTo ? ' AND ft.created_at <= ?' : ''}
      ${transactionType ? ' AND ft.transaction_type = ?' : ''}
      ${paymentMode ? ' AND ft.payment_mode = ?' : ''}
      ${(reconciled !== undefined && reconciled !== null && reconciled !== '') ? ' AND ft.reconciled = ?' : ''}
    `;
    const [summaryRows] = await pool.query(summarySql, params);

    const safeLimit = Math.max(1, parseInt(limit, 10) || 100);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    sql += ` ORDER BY ft.id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await pool.query(sql, params);

    return {
      transactions: rows,
      summary: summaryRows[0] || { total_inflow: 0, total_outflow: 0, total_count: 0 }
    };
  }

  /**
   * Reconcile transaction
   */
  static async reconcileTransaction(restaurantId, transactionId, reconciled, reconciliationRef, reconciledAt) {
    const isRecon = reconciled ? 1 : 0;
    const rDate = isRecon ? (reconciledAt || getISTDateTimeString()) : null;
    const rRef = isRecon ? (reconciliationRef || 'Statement Match') : null;

    await pool.execute(`
      UPDATE financial_transactions SET
        reconciled = ?,
        reconciled_at = ?,
        reconciliation_ref = ?
      WHERE id = ? AND restaurant_id = ?
    `, [isRecon, rDate, rRef, transactionId, restaurantId]);

    const [rows] = await pool.execute(
      'SELECT * FROM financial_transactions WHERE id = ? AND restaurant_id = ?',
      [transactionId, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Daily transfer sequence generator (TRF-YYYYMMDD-0001)
   */
  static async getNextTransferNumber(restaurantId, connection = null) {
    const executor = connection || pool;
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `TRF-${dateStr}-`;

    const [rows] = await executor.execute(
      'SELECT transfer_number FROM account_transfers WHERE restaurant_id = ? AND transfer_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextSeq = 1;
    if (rows.length > 0) {
      const parts = rows[0].transfer_number.split('-');
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last)) nextSeq = last + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Daily expense sequence generator (EXP-YYYYMMDD-0001)
   */
  static async getNextExpenseNumber(restaurantId, connection = null) {
    const executor = connection || pool;
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `EXP-${dateStr}-`;

    const [rows] = await executor.execute(
      'SELECT expense_number FROM expenses WHERE restaurant_id = ? AND expense_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [restaurantId, `${prefix}%`]
    );

    let nextSeq = 1;
    if (rows.length > 0) {
      const parts = rows[0].expense_number.split('-');
      const last = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(last)) nextSeq = last + 1;
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Record an account transfer
   */
  static async recordTransfer(transferData, connection = null) {
    const executor = connection || pool;
    const {
      restaurant_id,
      transfer_number,
      from_account_id,
      to_account_id,
      amount,
      transfer_date,
      reference_number = null,
      notes = null,
      created_by_user_id = null,
      created_by_name = null
    } = transferData;

    const [res] = await executor.execute(`
      INSERT INTO account_transfers (
        restaurant_id, transfer_number, from_account_id, to_account_id,
        amount, transfer_date, reference_number, notes,
        created_by_user_id, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      restaurant_id, transfer_number, from_account_id, to_account_id,
      parseFloat(amount), transfer_date, reference_number, notes,
      created_by_user_id, created_by_name
    ]);

    return res.insertId;
  }

  /**
   * List transfers
   */
  static async getTransfers(restaurantId, filters = {}) {
    const { limit = 50, offset = 0 } = filters;
    const [rows] = await pool.execute(`
      SELECT at.*,
        fa_from.account_name as from_account_name, fa_from.account_type as from_account_type,
        fa_to.account_name as to_account_name, fa_to.account_type as to_account_type
      FROM account_transfers at
      JOIN financial_accounts fa_from ON at.from_account_id = fa_from.id
      JOIN financial_accounts fa_to ON at.to_account_id = fa_to.id
      WHERE at.restaurant_id = ?
      ORDER BY at.id DESC
      LIMIT ? OFFSET ?
    `, [restaurantId, parseInt(limit, 10), parseInt(offset, 10)]);

    return rows;
  }

  /**
   * Record expense
   */
  static async recordExpense(expenseData, connection = null) {
    const executor = connection || pool;
    const {
      restaurant_id,
      expense_number,
      category,
      amount,
      account_id,
      payment_mode = 'cash',
      expense_date,
      payee = null,
      reference_number = null,
      notes = null,
      created_by_user_id = null,
      created_by_name = null
    } = expenseData;

    const [res] = await executor.execute(`
      INSERT INTO expenses (
        restaurant_id, expense_number, category, amount, account_id,
        payment_mode, expense_date, payee, reference_number, notes,
        created_by_user_id, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      restaurant_id, expense_number, category, parseFloat(amount), account_id,
      payment_mode, expense_date, payee, reference_number, notes,
      created_by_user_id, created_by_name
    ]);

    return res.insertId;
  }

  /**
   * List expenses
   */
  static async getExpenses(restaurantId, filters = {}) {
    const { category, dateFrom, dateTo, limit = 50, offset = 0 } = filters;
    let sql = `
      SELECT e.*, fa.account_name, fa.account_type, fa.bank_name
      FROM expenses e
      JOIN financial_accounts fa ON e.account_id = fa.id
      WHERE e.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (category) {
      sql += ' AND e.category = ?';
      params.push(category);
    }
    if (dateFrom) {
      sql += ' AND e.expense_date >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      sql += ' AND e.expense_date <= ?';
      params.push(dateTo);
    }

    sql += ' ORDER BY e.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  /**
   * Financial accounts dashboard summary
   */
  static async getDashboardSummary(restaurantId) {
    // 1. Balances across Cash vs Bank
    const [accBalances] = await pool.execute(`
      SELECT
        COUNT(*) as total_accounts,
        COALESCE(SUM(CASE WHEN account_type = 'cash' THEN current_balance ELSE 0 END), 0) as cash_balance,
        COALESCE(SUM(CASE WHEN account_type != 'cash' THEN current_balance ELSE 0 END), 0) as bank_balance,
        COALESCE(SUM(current_balance), 0) as total_balance
      FROM financial_accounts
      WHERE restaurant_id = ? AND is_active = 1
    `, [restaurantId]);

    // 2. All-time Inflows and Outflows
    const [allTimeFlow] = await pool.execute(`
      SELECT
        COALESCE(SUM(amount_in), 0) as total_inflow,
        COALESCE(SUM(amount_out), 0) as total_outflow
      FROM financial_transactions
      WHERE restaurant_id = ?
    `, [restaurantId]);

    // 3. Today's Inflow and Outflow
    const today = getISTDateString();
    const [todayFlow] = await pool.execute(`
      SELECT
        COALESCE(SUM(amount_in), 0) as today_inflow,
        COALESCE(SUM(amount_out), 0) as today_outflow
      FROM financial_transactions
      WHERE restaurant_id = ? AND DATE(created_at) = ?
    `, [restaurantId, today]);

    return {
      total_accounts: parseInt(accBalances[0]?.total_accounts || 0, 10),
      cash_balance: parseFloat(accBalances[0]?.cash_balance || 0),
      bank_balance: parseFloat(accBalances[0]?.bank_balance || 0),
      total_balance: parseFloat(accBalances[0]?.total_balance || 0),
      total_inflow: parseFloat(allTimeFlow[0]?.total_inflow || 0),
      total_outflow: parseFloat(allTimeFlow[0]?.total_outflow || 0),
      today_inflow: parseFloat(todayFlow[0]?.today_inflow || 0),
      today_outflow: parseFloat(todayFlow[0]?.today_outflow || 0)
    };
  }
}

module.exports = FinancialAccountRepository;
