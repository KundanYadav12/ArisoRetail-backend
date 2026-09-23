const ExpenseService = require('../services/expense_service');

class ExpenseController {
  // ==========================================
  // 1. CATEGORIES
  // ==========================================

  static async getCategories(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { activeOnly, search } = req.query;

      const categories = await ExpenseService.getCategories(restaurantId, {
        activeOnly: activeOnly === 'true' || activeOnly === '1',
        search: search || ''
      });

      return res.json({ categories });
    } catch (err) {
      console.error('[ExpenseController.getCategories error]:', err);
      return res.status(500).json({ error: 'Failed to fetch expense categories.' });
    }
  }

  static async getCategoryById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const category = await ExpenseService.getCategoryById(restaurantId, id);
      return res.json({ category });
    } catch (err) {
      console.error('[ExpenseController.getCategoryById error]:', err);
      return res.status(404).json({ error: err.message || 'Category not found.' });
    }
  }

  static async createCategory(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const category = await ExpenseService.createCategory(restaurantId, req.body, req.user);
      return res.status(201).json({ category, message: 'Expense category created successfully.' });
    } catch (err) {
      console.error('[ExpenseController.createCategory error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to create category.' });
    }
  }

  static async updateCategory(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const category = await ExpenseService.updateCategory(restaurantId, id, req.body);
      return res.json({ category, message: 'Expense category updated successfully.' });
    } catch (err) {
      console.error('[ExpenseController.updateCategory error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to update category.' });
    }
  }

  static async deleteCategory(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      await ExpenseService.deleteCategory(restaurantId, id);
      return res.json({ success: true, message: 'Expense category deleted successfully.' });
    } catch (err) {
      console.error('[ExpenseController.deleteCategory error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to delete category.' });
    }
  }

  // ==========================================
  // 2. EXPENSES
  // ==========================================

  static async getExpenses(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
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
      } = req.query;

      const result = await ExpenseService.getExpenses(restaurantId, {
        dateFrom,
        dateTo,
        categoryId,
        status,
        paymentMode,
        accountId,
        supplierId,
        employeeUserId,
        search,
        page,
        limit
      });

      return res.json(result);
    } catch (err) {
      console.error('[ExpenseController.getExpenses error]:', err);
      return res.status(500).json({ error: 'Failed to fetch expenses.' });
    }
  }

  static async getExpenseById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const expense = await ExpenseService.getExpenseById(restaurantId, id);
      return res.json({ expense });
    } catch (err) {
      console.error('[ExpenseController.getExpenseById error]:', err);
      return res.status(404).json({ error: err.message || 'Expense not found.' });
    }
  }

  static async getSummary(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { dateFrom, dateTo } = req.query;

      const summary = await ExpenseService.getAnalyticsSummary(restaurantId, { dateFrom, dateTo });
      return res.json({ summary });
    } catch (err) {
      console.error('[ExpenseController.getSummary error]:', err);
      return res.status(500).json({ error: 'Failed to fetch expense summary.' });
    }
  }

  static async recordExpense(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const expense = await ExpenseService.recordBusinessExpense(restaurantId, req.body, req.user);
      return res.status(201).json({ expense, message: 'Expense recorded successfully.' });
    } catch (err) {
      console.error('[ExpenseController.recordExpense error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to record expense.' });
    }
  }

  static async updateExpense(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const expense = await ExpenseService.updateExpense(restaurantId, id, req.body, req.user);
      return res.json({ expense, message: 'Expense updated successfully.' });
    } catch (err) {
      console.error('[ExpenseController.updateExpense error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to update expense.' });
    }
  }

  static async cancelExpense(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const { cancelledReason } = req.body;

      const expense = await ExpenseService.cancelExpense(restaurantId, id, { cancelledReason }, req.user);
      return res.json({ expense, message: 'Expense cancelled and account balance compensated successfully.' });
    } catch (err) {
      console.error('[ExpenseController.cancelExpense error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to cancel expense.' });
    }
  }

  static async uploadAttachment(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      return res.json({
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });
    } catch (err) {
      console.error('[ExpenseController.uploadAttachment error]:', err);
      return res.status(500).json({ error: 'Failed to process file upload.' });
    }
  }

  // ==========================================
  // 3. CLAIMS (EMPLOYEE REIMBURSEMENTS)
  // ==========================================

  static async getClaims(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const {
        status,
        employeeUserId,
        dateFrom,
        dateTo,
        search,
        page = 1,
        limit = 50
      } = req.query;

      const result = await ExpenseService.getClaims(restaurantId, {
        status,
        employeeUserId,
        dateFrom,
        dateTo,
        search,
        page,
        limit
      });

      return res.json(result);
    } catch (err) {
      console.error('[ExpenseController.getClaims error]:', err);
      return res.status(500).json({ error: 'Failed to fetch expense claims.' });
    }
  }

  static async getClaimById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const claim = await ExpenseService.getClaimById(restaurantId, id);
      return res.json({ claim });
    } catch (err) {
      console.error('[ExpenseController.getClaimById error]:', err);
      return res.status(404).json({ error: err.message || 'Claim not found.' });
    }
  }

  static async submitClaim(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const claim = await ExpenseService.submitClaim(restaurantId, req.body, req.user);
      return res.status(201).json({ claim, message: 'Expense claim submitted successfully.' });
    } catch (err) {
      console.error('[ExpenseController.submitClaim error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to submit claim.' });
    }
  }

  static async reviewClaim(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const claim = await ExpenseService.reviewClaim(restaurantId, id, req.user);
      return res.json({ claim, message: 'Expense claim marked as reviewed.' });
    } catch (err) {
      console.error('[ExpenseController.reviewClaim error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to review claim.' });
    }
  }

  static async approveClaim(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;

      const claim = await ExpenseService.approveClaim(restaurantId, id, req.user);
      return res.json({ claim, message: 'Expense claim approved.' });
    } catch (err) {
      console.error('[ExpenseController.approveClaim error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to approve claim.' });
    }
  }

  static async rejectClaim(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const { rejectionReason } = req.body;

      const claim = await ExpenseService.rejectClaim(restaurantId, id, rejectionReason, req.user);
      return res.json({ claim, message: 'Expense claim rejected.' });
    } catch (err) {
      console.error('[ExpenseController.rejectClaim error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to reject claim.' });
    }
  }

  static async reimburseClaim(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const { accountId, paymentMode } = req.body;

      const claim = await ExpenseService.reimburseClaim(restaurantId, id, { accountId, paymentMode }, req.user);
      return res.json({ claim, message: 'Expense claim disbursed and bank account debited successfully.' });
    } catch (err) {
      console.error('[ExpenseController.reimburseClaim error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to disburse claim.' });
    }
  }
}

module.exports = ExpenseController;
