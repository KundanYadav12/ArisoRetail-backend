const pool = require('../config/db');
const ExpenseRepository = require('../repositories/expense_repository');
const FinancialAccountRepository = require('../repositories/financial_account_repository');
const FinancialAccountService = require('./financial_account_service');

class ExpenseService {
  /**
   * Helper: Round number to 2 decimal places
   */
  static round(val) {
    return Math.round((parseFloat(val || 0) + Number.EPSILON) * 100) / 100;
  }

  /**
   * Compute tax breakdown based on amount, GST rate, inclusive/exclusive, and state
   */
  static computeTaxBreakdown({ amount = 0, gstRate = 0, taxInclusive = false, isInterState = false }) {
    const rawAmt = parseFloat(amount || 0);
    const rate = parseFloat(gstRate || 0);

    if (rawAmt <= 0 || rate <= 0) {
      return {
        taxable_amount: this.round(rawAmt),
        gst_rate: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        tax_amount: 0,
        total_amount: this.round(rawAmt),
        tax_inclusive: taxInclusive ? 1 : 0
      };
    }

    let taxableAmount, taxAmount, totalAmount;

    if (taxInclusive) {
      // Total amount is the entered amount
      totalAmount = this.round(rawAmt);
      taxableAmount = this.round(rawAmt / (1 + (rate / 100)));
      taxAmount = this.round(totalAmount - taxableAmount);
    } else {
      // Amount is pre-tax taxable amount
      taxableAmount = this.round(rawAmt);
      taxAmount = this.round(taxableAmount * (rate / 100));
      totalAmount = this.round(taxableAmount + taxAmount);
    }

    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (isInterState) {
      igstAmount = taxAmount;
    } else {
      cgstAmount = this.round(taxAmount / 2);
      sgstAmount = this.round(taxAmount - cgstAmount);
    }

    return {
      taxable_amount: taxableAmount,
      gst_rate: rate,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      igst_amount: igstAmount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      tax_inclusive: taxInclusive ? 1 : 0
    };
  }

  // ==========================================
  // 1. CATEGORIES MANAGEMENT
  // ==========================================

  static async getCategories(restaurantId, options = {}) {
    return await ExpenseRepository.findAllCategories(restaurantId, options);
  }

  static async getCategoryById(restaurantId, categoryId) {
    const cat = await ExpenseRepository.findCategoryById(categoryId, restaurantId);
    if (!cat) throw new Error('Expense category not found');
    return cat;
  }

  static async createCategory(restaurantId, categoryData, user = null) {
    const { name, code, description, is_active } = categoryData;
    if (!name || !name.trim()) {
      throw new Error('Category name is required');
    }

    const existing = await ExpenseRepository.findCategoryByName(name, restaurantId);
    if (existing) {
      throw new Error(`Category "${name.trim()}" already exists`);
    }

    const newId = await ExpenseRepository.createCategory(restaurantId, {
      name: name.trim(),
      code: code ? code.trim() : null,
      description: description ? description.trim() : null,
      is_active: is_active !== undefined ? (is_active ? 1 : 0) : 1,
      created_by_user_id: user ? (user.id || user.userId) : null
    });

    return await ExpenseRepository.findCategoryById(newId, restaurantId);
  }

  static async updateCategory(restaurantId, categoryId, categoryData) {
    const existing = await ExpenseRepository.findCategoryById(categoryId, restaurantId);
    if (!existing) throw new Error('Category not found');

    if (categoryData.name && categoryData.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await ExpenseRepository.findCategoryByName(categoryData.name, restaurantId);
      if (duplicate && duplicate.id !== categoryId) {
        throw new Error(`Category "${categoryData.name.trim()}" already exists`);
      }
    }

    await ExpenseRepository.updateCategory(categoryId, restaurantId, categoryData);
    return await ExpenseRepository.findCategoryById(categoryId, restaurantId);
  }

  static async deleteCategory(restaurantId, categoryId) {
    const existing = await ExpenseRepository.findCategoryById(categoryId, restaurantId);
    if (!existing) throw new Error('Category not found');
    return await ExpenseRepository.deleteCategory(categoryId, restaurantId);
  }

  // ==========================================
  // 2. BUSINESS EXPENSE RECORDING & FLOWS
  // ==========================================

  /**
   * Record a business expense with atomic bank account outflow
   */
  static async recordBusinessExpense(restaurantId, expenseInput, user = null) {
    const {
      categoryId,
      categoryName,
      amount,
      gstRate = 0,
      taxInclusive = false,
      isInterState = false,
      paymentMode = 'cash',
      accountId = null,
      expenseDate,
      payee,
      supplierId,
      employeeUserId,
      employeeName,
      referenceNumber,
      notes,
      attachmentUrl,
      attachmentName,
      attachmentType
    } = expenseInput;

    const rawAmount = parseFloat(amount || 0);
    if (rawAmount <= 0) {
      throw new Error('Expense amount must be greater than zero');
    }

    // 1. Resolve Category
    let resolvedCategoryId = categoryId || null;
    let resolvedCategoryName = categoryName || null;

    if (resolvedCategoryId) {
      const cat = await ExpenseRepository.findCategoryById(resolvedCategoryId, restaurantId);
      if (cat) {
        resolvedCategoryName = cat.name;
      }
    } else if (resolvedCategoryName && resolvedCategoryName.trim()) {
      const existing = await ExpenseRepository.findCategoryByName(resolvedCategoryName, restaurantId);
      if (existing) {
        resolvedCategoryId = existing.id;
        resolvedCategoryName = existing.name;
      } else {
        resolvedCategoryId = await ExpenseRepository.createCategory(restaurantId, {
          name: resolvedCategoryName.trim(),
          is_active: 1,
          created_by_user_id: user ? (user.id || user.userId) : null
        });
      }
    }

    // 2. Compute tax breakdown
    const taxCalc = this.computeTaxBreakdown({
      amount: rawAmount,
      gstRate,
      taxInclusive,
      isInterState
    });

    const totalAmount = taxCalc.total_amount;
    const cleanMode = (paymentMode || 'cash').toLowerCase().trim();

    // 3. Open DB transaction for atomic expense creation and bank outflow
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 3.1 Generate sequential expense number
      const expenseNumber = await ExpenseRepository.generateExpenseNumber(restaurantId, connection);

      // 3.2 Resolve Target Financial Account
      let targetAccount = null;
      if (accountId) {
        targetAccount = await FinancialAccountRepository.findById(accountId, restaurantId, connection);
      }
      if (!targetAccount) {
        targetAccount = await FinancialAccountService.resolveAccountForPaymentMode(restaurantId, cleanMode, connection);
      }
      if (!targetAccount) {
        throw new Error(`No active financial account available for payment mode "${cleanMode}". Please configure a Bank or Cash account.`);
      }

      // 3.3 Lock financial account FOR UPDATE
      const lockedAcc = await FinancialAccountRepository.lockAccount(targetAccount.id, restaurantId, connection);
      if (!lockedAcc) {
        throw new Error('Unable to lock financial account for balance update');
      }

      const prevBal = parseFloat(lockedAcc.current_balance || 0);
      const newBal = this.round(prevBal - totalAmount);

      // 3.4 Record Financial Transaction Outflow
      const idempotencyKey = `expense_${restaurantId}_${expenseNumber}_${Date.now()}`;
      const ftId = await FinancialAccountRepository.recordTransaction({
        restaurant_id: restaurantId,
        account_id: targetAccount.id,
        transaction_type: 'EXPENSE_PAYMENT',
        reference_type: 'expense',
        reference_id: null, // will update with expense id
        reference_number: expenseNumber,
        payment_mode: cleanMode,
        party_type: supplierId ? 'supplier' : (employeeUserId ? 'employee' : null),
        party_id: supplierId || employeeUserId || null,
        party_name: payee || employeeName || null,
        amount_in: 0.00,
        amount_out: totalAmount,
        balance_after: newBal,
        description: `Expense Payment: ${resolvedCategoryName || 'General'} (#${expenseNumber})${notes ? ` - ${notes}` : ''}`,
        user_id: user ? (user.id || user.userId) : null,
        user_name: user ? (user.name || user.username) : 'Staff',
        idempotency_key: idempotencyKey
      }, connection);

      // 3.5 Deduct balance on financial account
      await FinancialAccountRepository.updateBalance(targetAccount.id, restaurantId, newBal, connection);

      // 3.6 Insert into expenses table
      const expenseId = await ExpenseRepository.createExpense(restaurantId, {
        expense_number: expenseNumber,
        category: resolvedCategoryName || 'Miscellaneous',
        category_id: resolvedCategoryId,
        status: 'POSTED',
        amount: taxCalc.taxable_amount,
        taxable_amount: taxCalc.taxable_amount,
        gst_rate: taxCalc.gst_rate,
        cgst_amount: taxCalc.cgst_amount,
        sgst_amount: taxCalc.sgst_amount,
        igst_amount: taxCalc.igst_amount,
        tax_amount: taxCalc.tax_amount,
        total_amount: totalAmount,
        tax_inclusive: taxCalc.tax_inclusive,
        account_id: targetAccount.id,
        payment_mode: cleanMode,
        expense_date: expenseDate ? new Date(expenseDate) : new Date(),
        payee: payee || null,
        supplier_id: supplierId || null,
        employee_user_id: employeeUserId || null,
        employee_name: employeeName || null,
        reference_number: referenceNumber || null,
        notes: notes || null,
        attachment_url: attachmentUrl || null,
        attachment_name: attachmentName || null,
        attachment_type: attachmentType || null,
        financial_transaction_id: ftId,
        created_by_user_id: user ? (user.id || user.userId) : null,
        created_by_name: user ? (user.name || user.username) : 'Staff'
      }, connection);

      // 3.7 Update FT reference_id with created expenseId
      await connection.execute(
        `UPDATE financial_transactions SET reference_id = ? WHERE id = ?`,
        [String(expenseId), ftId]
      );

      await connection.commit();

      return await ExpenseRepository.findById(expenseId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Cancel / Reverse a posted expense with atomic balance reimbursement
   */
  static async cancelExpense(restaurantId, expenseId, { cancelledReason } = {}, user = null) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const expense = await ExpenseRepository.findById(expenseId, restaurantId, connection);
      if (!expense) {
        throw new Error('Expense not found');
      }
      if (expense.status === 'CANCELLED') {
        throw new Error('Expense is already cancelled');
      }

      const totalAmount = parseFloat(expense.total_amount || 0);

      // Compensate financial account if an outflow was posted
      if (expense.account_id && totalAmount > 0) {
        const lockedAcc = await FinancialAccountRepository.lockAccount(expense.account_id, restaurantId, connection);
        if (lockedAcc) {
          const prevBal = parseFloat(lockedAcc.current_balance || 0);
          const newBal = this.round(prevBal + totalAmount);

          const reversalIdempotency = `reversal_expense_${restaurantId}_${expense.id}_${Date.now()}`;
          await FinancialAccountRepository.recordTransaction({
            restaurant_id: restaurantId,
            account_id: expense.account_id,
            transaction_type: 'ADJUSTMENT_IN',
            reference_type: 'expense_cancellation',
            reference_id: String(expense.id),
            reference_number: expense.expense_number,
            payment_mode: expense.payment_mode,
            party_type: expense.supplier_id ? 'supplier' : (expense.employee_user_id ? 'employee' : null),
            party_id: expense.supplier_id || expense.employee_user_id || null,
            party_name: expense.payee || expense.employee_name || null,
            amount_in: totalAmount,
            amount_out: 0.00,
            balance_after: newBal,
            description: `Reversal for Cancelled Expense #${expense.expense_number}: ${cancelledReason || 'Cancelled by user'}`,
            user_id: user ? (user.id || user.userId) : null,
            user_name: user ? (user.name || user.username) : 'Staff',
            idempotency_key: reversalIdempotency
          }, connection);

          await FinancialAccountRepository.updateBalance(expense.account_id, restaurantId, newBal, connection);
        }
      }

      await ExpenseRepository.cancelExpense(expenseId, restaurantId, {
        cancelledByUserId: user ? (user.id || user.userId) : null,
        cancelledReason: cancelledReason || 'Cancelled by user'
      }, connection);

      await connection.commit();

      return await ExpenseRepository.findById(expenseId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Edit a posted expense with atomic account adjustment if amount, account, or mode changed
   */
  static async updateExpense(restaurantId, expenseId, updateData, user = null) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const existing = await ExpenseRepository.findById(expenseId, restaurantId, connection);
      if (!existing) {
        throw new Error('Expense not found');
      }
      if (existing.status === 'CANCELLED') {
        throw new Error('Cannot edit a cancelled expense');
      }

      const oldAmount = parseFloat(existing.total_amount || 0);
      const oldAccountId = existing.account_id;
      const oldPaymentMode = existing.payment_mode;

      // Recalculate tax if amount or GST changed
      let taxCalc = null;
      let newTotal = oldAmount;
      if (updateData.amount !== undefined || updateData.gstRate !== undefined || updateData.taxInclusive !== undefined) {
        const rawAmt = updateData.amount !== undefined ? parseFloat(updateData.amount) : parseFloat(existing.taxable_amount || existing.amount);
        const rate = updateData.gstRate !== undefined ? parseFloat(updateData.gstRate) : parseFloat(existing.gst_rate || 0);
        const taxInc = updateData.taxInclusive !== undefined ? updateData.taxInclusive : (existing.tax_inclusive === 1);
        const isInter = updateData.isInterState !== undefined ? updateData.isInterState : (parseFloat(existing.igst_amount || 0) > 0);

        taxCalc = this.computeTaxBreakdown({
          amount: rawAmt,
          gstRate: rate,
          taxInclusive: taxInc,
          isInterState: isInter
        });
        newTotal = taxCalc.total_amount;
      }

      // Resolve new account if account or payment mode changed
      const newPaymentMode = updateData.payment_mode ? updateData.payment_mode.toLowerCase().trim() : oldPaymentMode;
      let newAccountId = updateData.account_id || oldAccountId;

      if (updateData.payment_mode && !updateData.account_id && newPaymentMode !== oldPaymentMode) {
        const resolvedAcc = await FinancialAccountService.resolveAccountForPaymentMode(restaurantId, newPaymentMode, connection);
        if (resolvedAcc) newAccountId = resolvedAcc.id;
      }

      // Handle financial ledger balance adjustments if amounts or accounts changed
      const amountChanged = Math.abs(newTotal - oldAmount) > 0.001;
      const accountChanged = newAccountId !== oldAccountId;

      if (amountChanged || accountChanged) {
        // 1. Reverse old deduction on old account
        if (oldAccountId && oldAmount > 0) {
          const oldLockedAcc = await FinancialAccountRepository.lockAccount(oldAccountId, restaurantId, connection);
          if (oldLockedAcc) {
            const revBal = this.round(parseFloat(oldLockedAcc.current_balance || 0) + oldAmount);
            await FinancialAccountRepository.recordTransaction({
              restaurant_id: restaurantId,
              account_id: oldAccountId,
              transaction_type: 'ADJUSTMENT_IN',
              reference_type: 'expense_adjustment',
              reference_id: String(existing.id),
              reference_number: existing.expense_number,
              payment_mode: oldPaymentMode,
              amount_in: oldAmount,
              amount_out: 0.00,
              balance_after: revBal,
              description: `Adjustment: Reversal of prior amount for Expense #${existing.expense_number}`,
              user_id: user ? (user.id || user.userId) : null,
              user_name: user ? (user.name || user.username) : 'Staff',
              idempotency_key: `edit_rev_${existing.id}_${Date.now()}`
            }, connection);
            await FinancialAccountRepository.updateBalance(oldAccountId, restaurantId, revBal, connection);
          }
        }

        // 2. Apply new deduction on new account
        if (newAccountId && newTotal > 0) {
          const newLockedAcc = await FinancialAccountRepository.lockAccount(newAccountId, restaurantId, connection);
          if (newLockedAcc) {
            const debBal = this.round(parseFloat(newLockedAcc.current_balance || 0) - newTotal);
            const ftId = await FinancialAccountRepository.recordTransaction({
              restaurant_id: restaurantId,
              account_id: newAccountId,
              transaction_type: 'EXPENSE_PAYMENT',
              reference_type: 'expense',
              reference_id: String(existing.id),
              reference_number: existing.expense_number,
              payment_mode: newPaymentMode,
              amount_in: 0.00,
              amount_out: newTotal,
              balance_after: debBal,
              description: `Expense Payment (Updated) #${existing.expense_number}`,
              user_id: user ? (user.id || user.userId) : null,
              user_name: user ? (user.name || user.username) : 'Staff',
              idempotency_key: `edit_deb_${existing.id}_${Date.now()}`
            }, connection);
            await FinancialAccountRepository.updateBalance(newAccountId, restaurantId, debBal, connection);
            updateData.financial_transaction_id = ftId;
          }
        }
      }

      // Build fields to update in expenses
      const expenseUpdate = {
        ...updateData,
        account_id: newAccountId,
        payment_mode: newPaymentMode
      };

      if (taxCalc) {
        expenseUpdate.amount = taxCalc.taxable_amount;
        expenseUpdate.taxable_amount = taxCalc.taxable_amount;
        expenseUpdate.gst_rate = taxCalc.gst_rate;
        expenseUpdate.cgst_amount = taxCalc.cgst_amount;
        expenseUpdate.sgst_amount = taxCalc.sgst_amount;
        expenseUpdate.igst_amount = taxCalc.igst_amount;
        expenseUpdate.tax_amount = taxCalc.tax_amount;
        expenseUpdate.total_amount = taxCalc.total_amount;
        expenseUpdate.tax_inclusive = taxCalc.tax_inclusive;
      }

      if (updateData.categoryId) {
        const cat = await ExpenseRepository.findCategoryById(updateData.categoryId, restaurantId, connection);
        if (cat) {
          expenseUpdate.category = cat.name;
          expenseUpdate.category_id = cat.id;
        }
      }

      await ExpenseRepository.updateExpense(expenseId, restaurantId, expenseUpdate, connection);

      await connection.commit();

      return await ExpenseRepository.findById(expenseId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async getExpenseById(restaurantId, expenseId) {
    const expense = await ExpenseRepository.findById(expenseId, restaurantId);
    if (!expense) throw new Error('Expense not found');
    return expense;
  }

  static async getExpenses(restaurantId, filters = {}) {
    return await ExpenseRepository.findAll(restaurantId, filters);
  }

  static async getAnalyticsSummary(restaurantId, options = {}) {
    return await ExpenseRepository.getAnalyticsSummary(restaurantId, options);
  }

  // ==========================================
  // 3. EMPLOYEE REIMBURSEMENT CLAIMS
  // ==========================================

  /**
   * Submit an employee reimbursement claim (ZERO immediate bank deduction)
   */
  static async submitClaim(restaurantId, claimData, user = null) {
    const {
      employeeName,
      employeeUserId,
      expenseDate,
      categoryId,
      categoryName,
      amount,
      taxAmount = 0,
      description,
      proofAttachmentUrl,
      proofAttachmentName
    } = claimData;

    const rawAmount = parseFloat(amount || 0);
    if (rawAmount <= 0) {
      throw new Error('Claim amount must be greater than zero');
    }

    let resolvedCategoryName = categoryName || null;
    if (categoryId) {
      const cat = await ExpenseRepository.findCategoryById(categoryId, restaurantId);
      if (cat) resolvedCategoryName = cat.name;
    }

    const claimNumber = await ExpenseRepository.generateClaimNumber(restaurantId);
    const taxAmt = parseFloat(taxAmount || 0);
    const totalAmount = this.round(rawAmount + taxAmt);

    const claimId = await ExpenseRepository.createClaim(restaurantId, {
      claim_number: claimNumber,
      employee_user_id: employeeUserId || (user ? (user.id || user.userId) : null),
      employee_name: employeeName || (user ? (user.name || user.username) : 'Employee'),
      expense_date: expenseDate ? new Date(expenseDate) : new Date(),
      category_id: categoryId || null,
      category_name: resolvedCategoryName,
      amount: rawAmount,
      tax_amount: taxAmt,
      total_amount: totalAmount,
      description: description || null,
      proof_attachment_url: proofAttachmentUrl || null,
      proof_attachment_name: proofAttachmentName || null,
      status: 'SUBMITTED'
    });

    return await ExpenseRepository.findClaimById(claimId, restaurantId);
  }

  /**
   * Manager reviews claim: SUBMITTED -> REVIEWED
   */
  static async reviewClaim(restaurantId, claimId, user = null) {
    const claim = await ExpenseRepository.findClaimById(claimId, restaurantId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== 'SUBMITTED') {
      throw new Error(`Cannot review claim with status "${claim.status}"`);
    }

    await ExpenseRepository.updateClaimWorkflow(claimId, restaurantId, {
      status: 'REVIEWED',
      reviewed_by_user_id: user ? (user.id || user.userId) : null,
      reviewed_by_name: user ? (user.name || user.username) : 'Manager',
      reviewed_at: new Date()
    });

    return await ExpenseRepository.findClaimById(claimId, restaurantId);
  }

  /**
   * Admin approves claim: REVIEWED / SUBMITTED -> APPROVED
   */
  static async approveClaim(restaurantId, claimId, user = null) {
    const claim = await ExpenseRepository.findClaimById(claimId, restaurantId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status !== 'SUBMITTED' && claim.status !== 'REVIEWED') {
      throw new Error(`Cannot approve claim with status "${claim.status}"`);
    }

    await ExpenseRepository.updateClaimWorkflow(claimId, restaurantId, {
      status: 'APPROVED',
      approved_by_user_id: user ? (user.id || user.userId) : null,
      approved_by_name: user ? (user.name || user.username) : 'Admin',
      approved_at: new Date()
    });

    return await ExpenseRepository.findClaimById(claimId, restaurantId);
  }

  /**
   * Reject claim: SUBMITTED / REVIEWED -> REJECTED
   */
  static async rejectClaim(restaurantId, claimId, rejectionReason, user = null) {
    const claim = await ExpenseRepository.findClaimById(claimId, restaurantId);
    if (!claim) throw new Error('Claim not found');
    if (claim.status === 'REIMBURSED' || claim.status === 'REJECTED') {
      throw new Error(`Cannot reject claim with status "${claim.status}"`);
    }

    await ExpenseRepository.updateClaimWorkflow(claimId, restaurantId, {
      status: 'REJECTED',
      rejection_reason: rejectionReason || 'Claim rejected by reviewer/admin'
    });

    return await ExpenseRepository.findClaimById(claimId, restaurantId);
  }

  /**
   * Disburse / Reimburse approved claim with atomic bank account outflow
   */
  static async reimburseClaim(restaurantId, claimId, { accountId, paymentMode = 'bank_transfer' }, user = null) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const claim = await ExpenseRepository.findClaimById(claimId, restaurantId, connection);
      if (!claim) throw new Error('Claim not found');
      if (claim.status !== 'APPROVED') {
        throw new Error(`Only APPROVED claims can be reimbursed. Current status: ${claim.status}`);
      }

      const totalAmount = parseFloat(claim.total_amount || 0);
      const cleanMode = (paymentMode || 'bank_transfer').toLowerCase().trim();

      // Resolve disbursement financial account
      let targetAccount = null;
      if (accountId) {
        targetAccount = await FinancialAccountRepository.findById(accountId, restaurantId, connection);
      }
      if (!targetAccount) {
        targetAccount = await FinancialAccountService.resolveAccountForPaymentMode(restaurantId, cleanMode, connection);
      }
      if (!targetAccount) {
        throw new Error(`No financial account available for reimbursement payment mode "${cleanMode}".`);
      }

      // Lock account FOR UPDATE
      const lockedAcc = await FinancialAccountRepository.lockAccount(targetAccount.id, restaurantId, connection);
      if (!lockedAcc) throw new Error('Unable to lock financial account for reimbursement');

      const prevBal = parseFloat(lockedAcc.current_balance || 0);
      const newBal = this.round(prevBal - totalAmount);

      // Record outflow in financial transactions
      const idempotencyKey = `reimburse_${restaurantId}_claim_${claim.id}_${Date.now()}`;
      const ftId = await FinancialAccountRepository.recordTransaction({
        restaurant_id: restaurantId,
        account_id: targetAccount.id,
        transaction_type: 'EXPENSE_PAYMENT',
        reference_type: 'expense_claim',
        reference_id: String(claim.id),
        reference_number: claim.claim_number,
        payment_mode: cleanMode,
        party_type: 'employee',
        party_id: claim.employee_user_id || null,
        party_name: claim.employee_name || null,
        amount_in: 0.00,
        amount_out: totalAmount,
        balance_after: newBal,
        description: `Employee Reimbursement: Claim #${claim.claim_number} to ${claim.employee_name}`,
        user_id: user ? (user.id || user.userId) : null,
        user_name: user ? (user.name || user.username) : 'Admin',
        idempotency_key: idempotencyKey
      }, connection);

      // Update account balance
      await FinancialAccountRepository.updateBalance(targetAccount.id, restaurantId, newBal, connection);

      // Update claim workflow status
      await ExpenseRepository.updateClaimWorkflow(claimId, restaurantId, {
        status: 'REIMBURSED',
        reimbursed_at: new Date(),
        reimbursement_account_id: targetAccount.id,
        reimbursement_payment_mode: cleanMode,
        reimbursement_financial_tx_id: ftId
      }, connection);

      // Mirror posted expense in expenses table for unified accounting/GST records
      const expenseNumber = await ExpenseRepository.generateExpenseNumber(restaurantId, connection);
      await ExpenseRepository.createExpense(restaurantId, {
        expense_number: expenseNumber,
        category: claim.category_title || claim.category_name || 'Staff Welfare / Reimbursement',
        category_id: claim.category_id || null,
        status: 'POSTED',
        amount: claim.amount,
        taxable_amount: claim.amount,
        gst_rate: 0,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        tax_amount: claim.tax_amount,
        total_amount: totalAmount,
        tax_inclusive: 0,
        account_id: targetAccount.id,
        payment_mode: cleanMode,
        expense_date: claim.expense_date,
        payee: claim.employee_name,
        employee_user_id: claim.employee_user_id,
        employee_name: claim.employee_name,
        reference_number: claim.claim_number,
        notes: `Reimbursement for Claim #${claim.claim_number}: ${claim.description || ''}`,
        attachment_url: claim.proof_attachment_url,
        attachment_name: claim.proof_attachment_name,
        attachment_type: 'claim_proof',
        financial_transaction_id: ftId,
        created_by_user_id: user ? (user.id || user.userId) : null,
        created_by_name: user ? (user.name || user.username) : 'Admin'
      }, connection);

      await connection.commit();

      return await ExpenseRepository.findClaimById(claimId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async getClaims(restaurantId, filters = {}) {
    return await ExpenseRepository.findAllClaims(restaurantId, filters);
  }

  static async getClaimById(restaurantId, claimId) {
    const claim = await ExpenseRepository.findClaimById(claimId, restaurantId);
    if (!claim) throw new Error('Claim not found');
    return claim;
  }
}

module.exports = ExpenseService;
