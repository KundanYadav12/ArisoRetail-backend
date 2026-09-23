const pool = require('../config/db');

class ExpenseRepository {
  // ==========================================
  // 1. EXPENSE CATEGORIES
  // ==========================================

  /**
   * Find all categories for a restaurant with usage stats
   */
  static async findAllCategories(restaurantId, { activeOnly = false, search = '' } = {}, connection = null) {
    const executor = connection || pool;
    let sql = `
      SELECT ec.*,
        COUNT(DISTINCT e.id) AS expense_count,
        COALESCE(SUM(CASE WHEN e.status != 'CANCELLED' THEN e.total_amount ELSE 0 END), 0) AS total_spent
      FROM expense_categories ec
      LEFT JOIN expenses e ON ec.id = e.category_id AND e.restaurant_id = ec.restaurant_id
      WHERE ec.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (activeOnly) {
      sql += ' AND ec.is_active = 1';
    }

    if (search && search.trim()) {
      sql += ' AND (ec.name LIKE ? OR ec.code LIKE ? OR ec.description LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    sql += ' GROUP BY ec.id ORDER BY ec.name ASC';

    const [rows] = await executor.execute(sql, params);
    return rows;
  }

  /**
   * Find category by ID
   */
  static async findCategoryById(id, restaurantId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.execute(
      `SELECT * FROM expense_categories WHERE id = ? AND restaurant_id = ?`,
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Find category by Name (case-insensitive)
   */
  static async findCategoryByName(name, restaurantId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.execute(
      `SELECT * FROM expense_categories WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND restaurant_id = ? LIMIT 1`,
      [name, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Create category
   */
  static async createCategory(restaurantId, categoryData, connection = null) {
    const executor = connection || pool;
    const {
      name,
      code = null,
      description = null,
      is_active = 1,
      created_by_user_id = null
    } = categoryData;

    const [res] = await executor.execute(
      `INSERT INTO expense_categories (
        restaurant_id, name, code, description, is_active, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [restaurantId, name.trim(), code ? code.trim().toUpperCase() : null, description ? description.trim() : null, is_active ? 1 : 0, created_by_user_id]
    );
    return res.insertId;
  }

  /**
   * Update category
   */
  static async updateCategory(id, restaurantId, categoryData, connection = null) {
    const executor = connection || pool;
    const {
      name,
      code,
      description,
      is_active
    } = categoryData;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (code !== undefined) {
      updates.push('code = ?');
      params.push(code ? code.trim().toUpperCase() : null);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? description.trim() : null);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    if (updates.length === 0) return false;

    updates.push('updated_at = NOW()');
    params.push(id, restaurantId);

    const [res] = await executor.execute(
      `UPDATE expense_categories SET ${updates.join(', ')} WHERE id = ? AND restaurant_id = ?`,
      params
    );
    return res.affectedRows > 0;
  }

  /**
   * Check if category is in use by any expenses or claims
   */
  static async isCategoryInUse(id, restaurantId, connection = null) {
    const executor = connection || pool;
    const [expRows] = await executor.execute(
      `SELECT COUNT(*) as count FROM expenses WHERE category_id = ? AND restaurant_id = ?`,
      [id, restaurantId]
    );
    if (expRows[0].count > 0) return true;

    const [claimRows] = await executor.execute(
      `SELECT COUNT(*) as count FROM expense_claims WHERE category_id = ? AND restaurant_id = ?`,
      [id, restaurantId]
    );
    return claimRows[0].count > 0;
  }

  /**
   * Delete category (safe deletion)
   */
  static async deleteCategory(id, restaurantId, connection = null) {
    const executor = connection || pool;
    const inUse = await this.isCategoryInUse(id, restaurantId, connection);
    if (inUse) {
      throw new Error('Cannot delete category because active expenses or claims are linked to it. You can deactivate it instead.');
    }
    const [res] = await executor.execute(
      `DELETE FROM expense_categories WHERE id = ? AND restaurant_id = ?`,
      [id, restaurantId]
    );
    return res.affectedRows > 0;
  }

  // ==========================================
  // 2. EXPENSES NUMBERING & CRUD
  // ==========================================

  /**
   * Generate sequential expense number: EXP-YYYYMMDD-0001
   */
  static async generateExpenseNumber(restaurantId, connection = null) {
    const executor = connection || pool;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const datePrefix = `EXP-${yyyy}${mm}${dd}-`;

    const [rows] = await executor.execute(
      `SELECT expense_number FROM expenses 
       WHERE restaurant_id = ? AND expense_number LIKE ? 
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [restaurantId, `${datePrefix}%`]
    );

    let nextSeq = 1;
    if (rows.length > 0 && rows[0].expense_number) {
      const parts = rows[0].expense_number.split('-');
      if (parts.length === 3) {
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) {
          nextSeq = parsed + 1;
        }
      }
    }

    return `${datePrefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Create business expense
   */
  static async createExpense(restaurantId, expenseData, connection = null) {
    const executor = connection || pool;
    const {
      expense_number,
      category,
      category_id,
      status = 'POSTED',
      amount = 0.00,
      taxable_amount = 0.00,
      gst_rate = 0.00,
      cgst_amount = 0.00,
      sgst_amount = 0.00,
      igst_amount = 0.00,
      tax_amount = 0.00,
      total_amount = 0.00,
      tax_inclusive = 0,
      account_id = null,
      payment_mode = 'cash',
      expense_date,
      payee = null,
      supplier_id = null,
      employee_user_id = null,
      employee_name = null,
      reference_number = null,
      notes = null,
      attachment_url = null,
      attachment_name = null,
      attachment_type = null,
      financial_transaction_id = null,
      created_by_user_id = null,
      created_by_name = null
    } = expenseData;

    const [res] = await executor.execute(
      `INSERT INTO expenses (
        restaurant_id, expense_number, category, category_id, status,
        amount, taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount,
        tax_amount, total_amount, tax_inclusive, account_id, payment_mode,
        expense_date, payee, supplier_id, employee_user_id, employee_name,
        reference_number, notes, attachment_url, attachment_name, attachment_type,
        financial_transaction_id, created_by_user_id, created_by_name,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        NOW(), NOW()
      )`,
      [
        restaurantId, expense_number, category, category_id || null, status,
        amount, taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount,
        tax_amount, total_amount, tax_inclusive ? 1 : 0, account_id || null, payment_mode,
        expense_date || new Date(), payee, supplier_id || null, employee_user_id || null, employee_name || null,
        reference_number, notes, attachment_url, attachment_name, attachment_type,
        financial_transaction_id || null, created_by_user_id || null, created_by_name || null
      ]
    );

    return res.insertId;
  }

  /**
   * Find expense by ID with rich joins
   */
  static async findById(id, restaurantId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.execute(
      `SELECT e.*,
        ec.name AS category_title,
        ec.code AS category_code,
        fa.account_name,
        fa.bank_name,
        fa.account_type,
        s.name AS supplier_name,
        s.mobile AS supplier_phone,
        s.gst_number AS supplier_gstin,
        ft.transaction_type AS ft_type,
        ft.idempotency_key AS ft_idempotency_key
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      LEFT JOIN financial_accounts fa ON e.account_id = fa.id
      LEFT JOIN suppliers s ON e.supplier_id = s.id
      LEFT JOIN financial_transactions ft ON e.financial_transaction_id = ft.id
      WHERE e.id = ? AND e.restaurant_id = ?`,
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Find all expenses with flexible filters and pagination
   */
  static async findAll(restaurantId, filters = {}, connection = null) {
    const executor = connection || pool;
    const {
      dateFrom,
      dateTo,
      categoryId,
      status,
      paymentMode,
      accountId,
      supplierId,
      employeeUserId,
      search,
      page = 1,
      limit = 50
    } = filters;

    let baseSql = `
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      LEFT JOIN financial_accounts fa ON e.account_id = fa.id
      LEFT JOIN suppliers s ON e.supplier_id = s.id
      WHERE e.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (dateFrom) {
      baseSql += ' AND DATE(e.expense_date) >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      baseSql += ' AND DATE(e.expense_date) <= ?';
      params.push(dateTo);
    }
    if (categoryId) {
      baseSql += ' AND e.category_id = ?';
      params.push(categoryId);
    }
    if (status) {
      baseSql += ' AND e.status = ?';
      params.push(status);
    }
    if (paymentMode) {
      baseSql += ' AND LOWER(e.payment_mode) = LOWER(?)';
      params.push(paymentMode);
    }
    if (accountId) {
      baseSql += ' AND e.account_id = ?';
      params.push(accountId);
    }
    if (supplierId) {
      baseSql += ' AND e.supplier_id = ?';
      params.push(supplierId);
    }
    if (employeeUserId) {
      baseSql += ' AND e.employee_user_id = ?';
      params.push(employeeUserId);
    }
    if (search && search.trim()) {
      baseSql += ' AND (e.expense_number LIKE ? OR e.payee LIKE ? OR e.employee_name LIKE ? OR e.reference_number LIKE ? OR e.notes LIKE ? OR ec.name LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term, term);
    }

    // 1. Get totals
    const countSql = `
      SELECT COUNT(*) AS total_count,
        COALESCE(SUM(CASE WHEN e.status != 'CANCELLED' THEN e.total_amount ELSE 0 END), 0) AS total_amount,
        COALESCE(SUM(CASE WHEN e.status != 'CANCELLED' THEN e.taxable_amount ELSE 0 END), 0) AS total_taxable,
        COALESCE(SUM(CASE WHEN e.status != 'CANCELLED' THEN e.tax_amount ELSE 0 END), 0) AS total_tax
      ${baseSql}
    `;
    const [statsRows] = await executor.execute(countSql, params);
    const stats = statsRows[0] || { total_count: 0, total_amount: 0, total_taxable: 0, total_tax: 0 };

    // 2. Get paginated records
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const dataSql = `
      SELECT e.*,
        ec.name AS category_title,
        ec.code AS category_code,
        fa.account_name,
        fa.bank_name,
        fa.account_type,
        s.name AS supplier_name
      ${baseSql}
      ORDER BY e.expense_date DESC, e.id DESC
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `;
    const [rows] = await executor.execute(dataSql, params);

    return {
      expenses: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalCount: stats.total_count,
        totalPages: Math.ceil(stats.total_count / parseInt(limit, 10))
      },
      summary: {
        totalAmount: parseFloat(stats.total_amount || 0),
        totalTaxable: parseFloat(stats.total_taxable || 0),
        totalTax: parseFloat(stats.total_tax || 0)
      }
    };
  }

  /**
   * Update expense record
   */
  static async updateExpense(id, restaurantId, expenseData, connection = null) {
    const executor = connection || pool;
    const fields = [
      'category', 'category_id', 'status', 'amount', 'taxable_amount',
      'gst_rate', 'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_amount',
      'total_amount', 'tax_inclusive', 'account_id', 'payment_mode', 'expense_date',
      'payee', 'supplier_id', 'employee_user_id', 'employee_name', 'reference_number',
      'notes', 'attachment_url', 'attachment_name', 'attachment_type', 'financial_transaction_id'
    ];

    const updates = [];
    const params = [];

    fields.forEach(field => {
      if (expenseData[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(expenseData[field]);
      }
    });

    if (updates.length === 0) return false;

    updates.push('updated_at = NOW()');
    params.push(id, restaurantId);

    const [res] = await executor.execute(
      `UPDATE expenses SET ${updates.join(', ')} WHERE id = ? AND restaurant_id = ?`,
      params
    );
    return res.affectedRows > 0;
  }

  /**
   * Cancel business expense
   */
  static async cancelExpense(id, restaurantId, { cancelledByUserId, cancelledReason }, connection = null) {
    const executor = connection || pool;
    const [res] = await executor.execute(
      `UPDATE expenses 
       SET status = 'CANCELLED',
           cancelled_at = NOW(),
           cancelled_by_user_id = ?,
           cancelled_reason = ?,
           updated_at = NOW()
       WHERE id = ? AND restaurant_id = ? AND status != 'CANCELLED'`,
      [cancelledByUserId || null, cancelledReason || 'Expense cancelled by user', id, restaurantId]
    );
    return res.affectedRows > 0;
  }

  /**
   * Summary analytics for Dashboard and Reports
   */
  static async getAnalyticsSummary(restaurantId, { dateFrom, dateTo } = {}, connection = null) {
    const executor = connection || pool;
    let whereSql = `WHERE e.restaurant_id = ? AND e.status != 'CANCELLED'`;
    const params = [restaurantId];

    if (dateFrom) {
      whereSql += ' AND DATE(e.expense_date) >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      whereSql += ' AND DATE(e.expense_date) <= ?';
      params.push(dateTo);
    }

    // 1. Overall totals
    const [totals] = await executor.execute(`
      SELECT 
        COUNT(*) AS total_count,
        COALESCE(SUM(total_amount), 0) AS total_amount,
        COALESCE(SUM(taxable_amount), 0) AS total_taxable,
        COALESCE(SUM(tax_amount), 0) AS total_tax,
        COALESCE(SUM(CASE WHEN LOWER(payment_mode) = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_expenses,
        COALESCE(SUM(CASE WHEN LOWER(payment_mode) != 'cash' THEN total_amount ELSE 0 END), 0) AS bank_expenses
      FROM expenses e
      ${whereSql}
    `, params);

    // 2. Category Breakdown
    const [categoryBreakdown] = await executor.execute(`
      SELECT 
        COALESCE(ec.name, e.category, 'Uncategorized') AS category_name,
        COUNT(e.id) AS count,
        COALESCE(SUM(e.total_amount), 0) AS total_amount
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      ${whereSql}
      GROUP BY category_name
      ORDER BY total_amount DESC
    `, params);

    // 3. Payment Mode Breakdown
    const [paymentModeBreakdown] = await executor.execute(`
      SELECT 
        COALESCE(e.payment_mode, 'other') AS payment_mode,
        COUNT(e.id) AS count,
        COALESCE(SUM(e.total_amount), 0) AS total_amount
      FROM expenses e
      ${whereSql}
      GROUP BY e.payment_mode
      ORDER BY total_amount DESC
    `, params);

    // 4. Pending Claims Count
    const [pendingClaims] = await executor.execute(`
      SELECT 
        COUNT(*) AS pending_claims_count,
        COALESCE(SUM(total_amount), 0) AS pending_claims_amount
      FROM expense_claims
      WHERE restaurant_id = ? AND status IN ('SUBMITTED', 'REVIEWED', 'APPROVED')
    `, [restaurantId]);

    return {
      totals: totals[0] || {},
      categoryBreakdown,
      paymentModeBreakdown,
      pendingClaims: pendingClaims[0] || {}
    };
  }

  // ==========================================
  // 3. EMPLOYEE REIMBURSEMENT CLAIMS
  // ==========================================

  /**
   * Generate sequential claim number: CLM-YYYYMMDD-0001
   */
  static async generateClaimNumber(restaurantId, connection = null) {
    const executor = connection || pool;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const datePrefix = `CLM-${yyyy}${mm}${dd}-`;

    const [rows] = await executor.execute(
      `SELECT claim_number FROM expense_claims 
       WHERE restaurant_id = ? AND claim_number LIKE ? 
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [restaurantId, `${datePrefix}%`]
    );

    let nextSeq = 1;
    if (rows.length > 0 && rows[0].claim_number) {
      const parts = rows[0].claim_number.split('-');
      if (parts.length === 3) {
        const parsed = parseInt(parts[2], 10);
        if (!isNaN(parsed)) {
          nextSeq = parsed + 1;
        }
      }
    }

    return `${datePrefix}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Create expense claim
   */
  static async createClaim(restaurantId, claimData, connection = null) {
    const executor = connection || pool;
    const {
      claim_number,
      employee_user_id = null,
      employee_name,
      expense_date,
      category_id = null,
      category_name = null,
      amount = 0.00,
      tax_amount = 0.00,
      total_amount = 0.00,
      description = null,
      proof_attachment_url = null,
      proof_attachment_name = null,
      status = 'SUBMITTED'
    } = claimData;

    const [res] = await executor.execute(
      `INSERT INTO expense_claims (
        restaurant_id, claim_number, employee_user_id, employee_name,
        expense_date, category_id, category_name, amount, tax_amount,
        total_amount, description, proof_attachment_url, proof_attachment_name,
        status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, NOW(), NOW()
      )`,
      [
        restaurantId, claim_number, employee_user_id || null, employee_name,
        expense_date || new Date(), category_id || null, category_name || null,
        parseFloat(amount || 0), parseFloat(tax_amount || 0), parseFloat(total_amount || 0),
        description || null, proof_attachment_url || null, proof_attachment_name || null,
        status
      ]
    );

    return res.insertId;
  }

  /**
   * Find claim by ID
   */
  static async findClaimById(id, restaurantId, connection = null) {
    const executor = connection || pool;
    const [rows] = await executor.execute(
      `SELECT c.*,
        ec.name AS category_title,
        fa.account_name AS reimbursement_account_name,
        fa.bank_name AS reimbursement_bank_name
      FROM expense_claims c
      LEFT JOIN expense_categories ec ON c.category_id = ec.id
      LEFT JOIN financial_accounts fa ON c.reimbursement_account_id = fa.id
      WHERE c.id = ? AND c.restaurant_id = ?`,
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Find all claims with filters
   */
  static async findAllClaims(restaurantId, filters = {}, connection = null) {
    const executor = connection || pool;
    const {
      status,
      employeeUserId,
      dateFrom,
      dateTo,
      search,
      page = 1,
      limit = 50
    } = filters;

    let baseSql = `
      FROM expense_claims c
      LEFT JOIN expense_categories ec ON c.category_id = ec.id
      LEFT JOIN financial_accounts fa ON c.reimbursement_account_id = fa.id
      WHERE c.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (status) {
      baseSql += ' AND c.status = ?';
      params.push(status);
    }
    if (employeeUserId) {
      baseSql += ' AND c.employee_user_id = ?';
      params.push(employeeUserId);
    }
    if (dateFrom) {
      baseSql += ' AND DATE(c.expense_date) >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      baseSql += ' AND DATE(c.expense_date) <= ?';
      params.push(dateTo);
    }
    if (search && search.trim()) {
      baseSql += ' AND (c.claim_number LIKE ? OR c.employee_name LIKE ? OR c.description LIKE ? OR ec.name LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    // Count
    const [countRows] = await executor.execute(`SELECT COUNT(*) AS total_count ${baseSql}`, params);
    const totalCount = countRows[0] ? countRows[0].total_count : 0;

    // Data
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const [rows] = await executor.execute(
      `SELECT c.*,
        ec.name AS category_title,
        fa.account_name AS reimbursement_account_name
      ${baseSql}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}`,
      params
    );

    return {
      claims: rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit, 10))
      }
    };
  }

  /**
   * Update claim status and workflow metadata
   */
  static async updateClaimWorkflow(id, restaurantId, workflowData, connection = null) {
    const executor = connection || pool;
    const allowedFields = [
      'status', 'reviewed_by_user_id', 'reviewed_by_name', 'reviewed_at',
      'approved_by_user_id', 'approved_by_name', 'approved_at',
      'rejection_reason', 'reimbursed_at', 'reimbursement_account_id',
      'reimbursement_payment_mode', 'reimbursement_financial_tx_id'
    ];

    const updates = [];
    const params = [];

    allowedFields.forEach(field => {
      if (workflowData[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(workflowData[field]);
      }
    });

    if (updates.length === 0) return false;

    updates.push('updated_at = NOW()');
    params.push(id, restaurantId);

    const [res] = await executor.execute(
      `UPDATE expense_claims SET ${updates.join(', ')} WHERE id = ? AND restaurant_id = ?`,
      params
    );
    return res.affectedRows > 0;
  }
}

module.exports = ExpenseRepository;
