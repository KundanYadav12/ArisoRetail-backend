const FinancialAccountRepository = require('../repositories/financial_account_repository');
const FinancialAccountService = require('../services/financial_account_service');

class FinancialAccountController {
  /**
   * Helper to mask account number for security: '123456789012' -> '••••••••9012'
   */
  static maskAccountNumber(accountNumber) {
    if (!accountNumber || typeof accountNumber !== 'string') return accountNumber;
    const trimmed = accountNumber.trim();
    if (trimmed.length <= 4) return trimmed;
    const visible = trimmed.slice(-4);
    const masked = '•'.repeat(Math.min(trimmed.length - 4, 8));
    return `${masked}${visible}`;
  }

  /**
   * List all accounts
   */
  static async getAccounts(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { activeOnly, search } = req.query;

      const accounts = await FinancialAccountRepository.findAll(restaurantId, {
        activeOnly: activeOnly === 'true' || activeOnly === '1',
        search: search || ''
      });

      // Mask account numbers for display safety
      const sanitized = accounts.map(acc => ({
        ...acc,
        account_number_masked: FinancialAccountController.maskAccountNumber(acc.account_number),
        current_balance: parseFloat(acc.current_balance || 0),
        opening_balance: parseFloat(acc.opening_balance || 0)
      }));

      return res.json({ accounts: sanitized });
    } catch (err) {
      console.error('[FinancialAccountController.getAccounts error]:', err);
      return res.status(500).json({ error: 'Failed to fetch financial accounts.' });
    }
  }

  /**
   * Get single account details
   */
  static async getAccountById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const account = await FinancialAccountRepository.findById(id, restaurantId);
      if (!account) {
        return res.status(404).json({ error: 'Financial account not found.' });
      }

      return res.json({
        account: {
          ...account,
          account_number_masked: FinancialAccountController.maskAccountNumber(account.account_number),
          current_balance: parseFloat(account.current_balance || 0),
          opening_balance: parseFloat(account.opening_balance || 0)
        }
      });
    } catch (err) {
      console.error('[FinancialAccountController.getAccountById error]:', err);
      return res.status(500).json({ error: 'Failed to fetch financial account details.' });
    }
  }

  /**
   * Create financial account
   */
  static async createAccount(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const {
        account_name,
        bank_name,
        account_number,
        account_type,
        ifsc_code,
        branch_name,
        opening_balance,
        opening_balance_date,
        is_active,
        is_default,
        notes
      } = req.body;

      if (!account_name || !account_name.trim()) {
        return res.status(400).json({ error: 'Account Name is required.' });
      }

      const account = await FinancialAccountService.createAccount(restaurantId, {
        account_name: account_name.trim(),
        bank_name: bank_name ? bank_name.trim() : null,
        account_number: account_number ? account_number.trim() : null,
        account_type: account_type || 'bank',
        ifsc_code: ifsc_code ? ifsc_code.trim().toUpperCase() : null,
        branch_name: branch_name ? branch_name.trim() : null,
        opening_balance: parseFloat(opening_balance || 0),
        opening_balance_date: opening_balance_date || null,
        is_active: is_active !== undefined ? is_active : 1,
        is_default: is_default !== undefined ? is_default : 0,
        notes: notes || null
      }, req.user.id, req.user.name);

      return res.status(201).json({
        message: 'Financial account created successfully.',
        account: {
          ...account,
          account_number_masked: FinancialAccountController.maskAccountNumber(account.account_number)
        }
      });
    } catch (err) {
      console.error('[FinancialAccountController.createAccount error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to create financial account.' });
    }
  }

  /**
   * Update financial account
   */
  static async updateAccount(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const existing = await FinancialAccountRepository.findById(id, restaurantId);
      if (!existing) {
        return res.status(404).json({ error: 'Financial account not found.' });
      }

      const updated = await FinancialAccountRepository.update(id, restaurantId, req.body);

      return res.json({
        message: 'Financial account updated successfully.',
        account: {
          ...updated,
          account_number_masked: FinancialAccountController.maskAccountNumber(updated.account_number)
        }
      });
    } catch (err) {
      console.error('[FinancialAccountController.updateAccount error]:', err);
      return res.status(500).json({ error: 'Failed to update financial account.' });
    }
  }

  /**
   * Toggle account active status
   */
  static async toggleActive(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const { is_active } = req.body;

      const updated = await FinancialAccountRepository.toggleActive(id, restaurantId, is_active);
      return res.json({
        message: `Financial account ${is_active ? 'activated' : 'deactivated'} successfully.`,
        account: updated
      });
    } catch (err) {
      console.error('[FinancialAccountController.toggleActive error]:', err);
      return res.status(500).json({ error: 'Failed to update account status.' });
    }
  }

  /**
   * List payment mode mappings
   */
  static async getMappings(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const mappings = await FinancialAccountRepository.getMappings(restaurantId);

      const standardModes = ['cash', 'upi', 'card', 'bank_transfer', 'wallet', 'cheque', 'credit'];
      return res.json({
        mappings,
        standard_modes: standardModes
      });
    } catch (err) {
      console.error('[FinancialAccountController.getMappings error]:', err);
      return res.status(500).json({ error: 'Failed to fetch payment mappings.' });
    }
  }

  /**
   * Upsert payment mode mapping
   */
  static async upsertMapping(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { payment_mode, account_id, is_active } = req.body;

      if (!payment_mode || !account_id) {
        return res.status(400).json({ error: 'Payment mode and target Account ID are required.' });
      }

      // Verify account belongs to restaurant
      const targetAcc = await FinancialAccountRepository.findById(account_id, restaurantId);
      if (!targetAcc) {
        return res.status(404).json({ error: 'Selected target financial account not found.' });
      }

      await FinancialAccountRepository.upsertMapping(
        restaurantId,
        payment_mode,
        account_id,
        is_active !== undefined ? is_active : 1
      );

      return res.json({ message: `Mapped "${payment_mode}" to "${targetAcc.account_name}" successfully.` });
    } catch (err) {
      console.error('[FinancialAccountController.upsertMapping error]:', err);
      return res.status(500).json({ error: 'Failed to save payment mapping.' });
    }
  }

  /**
   * Account transaction ledger
   */
  static async getLedger(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params; // Optional account_id in path
      const {
        account_id,
        dateFrom,
        dateTo,
        transactionType,
        paymentMode,
        reconciled,
        limit = 100,
        offset = 0
      } = req.query;

      const targetAccId = id || account_id || null;
      let accountMeta = null;

      if (targetAccId) {
        accountMeta = await FinancialAccountRepository.findById(targetAccId, restaurantId);
        if (!accountMeta) {
          return res.status(404).json({ error: 'Financial account not found.' });
        }
      }

      const ledgerData = await FinancialAccountRepository.getLedger(restaurantId, targetAccId, {
        dateFrom,
        dateTo,
        transactionType,
        paymentMode,
        reconciled,
        limit,
        offset
      });

      return res.json({
        account: accountMeta ? {
          ...accountMeta,
          account_number_masked: FinancialAccountController.maskAccountNumber(accountMeta.account_number),
          current_balance: parseFloat(accountMeta.current_balance || 0),
          opening_balance: parseFloat(accountMeta.opening_balance || 0)
        } : null,
        ...ledgerData
      });
    } catch (err) {
      console.error('[FinancialAccountController.getLedger error]:', err);
      return res.status(500).json({ error: 'Failed to fetch account ledger.' });
    }
  }

  /**
   * Reconcile transaction
   */
  static async reconcileTransaction(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const { reconciled = true, reconciliation_ref = null, reconciled_at = null } = req.body;

      const updated = await FinancialAccountRepository.reconcileTransaction(
        restaurantId,
        id,
        reconciled,
        reconciliation_ref,
        reconciled_at
      );

      if (!updated) {
        return res.status(404).json({ error: 'Transaction not found.' });
      }

      return res.json({
        message: `Transaction ${reconciled ? 'marked reconciled' : 'unmarked reconciliation'} successfully.`,
        transaction: updated
      });
    } catch (err) {
      console.error('[FinancialAccountController.reconcileTransaction error]:', err);
      return res.status(500).json({ error: 'Failed to reconcile transaction.' });
    }
  }

  /**
   * Get transfers
   */
  static async getTransfers(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { limit, offset } = req.query;

      const transfers = await FinancialAccountRepository.getTransfers(restaurantId, { limit, offset });
      return res.json({ transfers });
    } catch (err) {
      console.error('[FinancialAccountController.getTransfers error]:', err);
      return res.status(500).json({ error: 'Failed to fetch transfer history.' });
    }
  }

  /**
   * Execute inter-account contra transfer
   */
  static async createTransfer(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { from_account_id, to_account_id, amount, transfer_date, reference_number, notes } = req.body;

      if (!from_account_id || !to_account_id || !amount) {
        return res.status(400).json({ error: 'From Account, To Account, and Amount are required.' });
      }

      const result = await FinancialAccountService.recordTransfer(restaurantId, {
        fromAccountId: from_account_id,
        toAccountId: to_account_id,
        amount: parseFloat(amount),
        transferDate: transfer_date,
        referenceNumber: reference_number,
        notes,
        userId: req.user.id,
        userName: req.user.name
      });

      return res.status(201).json({
        message: 'Inter-account transfer completed successfully.',
        transfer: result
      });
    } catch (err) {
      console.error('[FinancialAccountController.createTransfer error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to complete account transfer.' });
    }
  }

  /**
   * Get expenses
   */
  static async getExpenses(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { category, dateFrom, dateTo, limit, offset } = req.query;

      const expenses = await FinancialAccountRepository.getExpenses(restaurantId, {
        category, dateFrom, dateTo, limit, offset
      });
      return res.json({ expenses });
    } catch (err) {
      console.error('[FinancialAccountController.getExpenses error]:', err);
      return res.status(500).json({ error: 'Failed to fetch expenses.' });
    }
  }

  /**
   * Record expense
   */
  static async createExpense(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { category, amount, account_id, payment_mode, expense_date, payee, reference_number, notes } = req.body;

      if (!category || !amount) {
        return res.status(400).json({ error: 'Category and Amount are required.' });
      }

      const result = await FinancialAccountService.recordExpense(restaurantId, {
        category,
        amount: parseFloat(amount),
        accountId: account_id || null,
        paymentMode: payment_mode || 'cash',
        expenseDate: expense_date,
        payee,
        referenceNumber: reference_number,
        notes,
        userId: req.user.id,
        userName: req.user.name
      });

      return res.status(201).json({
        message: 'Expense recorded successfully.',
        expense: result
      });
    } catch (err) {
      console.error('[FinancialAccountController.createExpense error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to record expense.' });
    }
  }

  /**
   * Get Dashboard Metrics
   */
  static async getDashboardSummary(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const summary = await FinancialAccountRepository.getDashboardSummary(restaurantId);
      return res.json({ summary });
    } catch (err) {
      console.error('[FinancialAccountController.getDashboardSummary error]:', err);
      return res.status(500).json({ error: 'Failed to fetch finance dashboard metrics.' });
    }
  }
}

module.exports = FinancialAccountController;
