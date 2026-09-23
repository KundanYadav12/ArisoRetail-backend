const express = require('express');
const router = express.Router();
const ExpenseController = require('../controllers/expense_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const upload = require('../middlewares/upload_middleware');

// All expense routes require authentication
router.use(authenticateToken);

// ==========================================
// 1. FILE UPLOAD (RECEIPTS / INVOICES / CLAIMS)
// ==========================================
router.post(
  '/upload',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier', 'staff'),
  upload.single('file'),
  ExpenseController.uploadAttachment
);

// ==========================================
// 2. EXPENSE CATEGORIES
// ==========================================
router.get(
  '/categories',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier', 'staff'),
  ExpenseController.getCategories
);

router.get(
  '/categories/:id',
  authorizeRoles('super_admin', 'admin', 'manager'),
  ExpenseController.getCategoryById
);

router.post(
  '/categories',
  authorizeRoles('super_admin', 'admin', 'manager'),
  ExpenseController.createCategory
);

router.put(
  '/categories/:id',
  authorizeRoles('super_admin', 'admin', 'manager'),
  ExpenseController.updateCategory
);

router.delete(
  '/categories/:id',
  authorizeRoles('super_admin', 'admin'),
  ExpenseController.deleteCategory
);

// ==========================================
// 3. BUSINESS EXPENSES
// ==========================================
router.get(
  '/',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier'),
  ExpenseController.getExpenses
);

router.get(
  '/summary',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier'),
  ExpenseController.getSummary
);

router.get(
  '/:id',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier'),
  ExpenseController.getExpenseById
);

router.post(
  '/',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier'),
  ExpenseController.recordExpense
);

router.put(
  '/:id',
  authorizeRoles('super_admin', 'admin', 'manager'),
  ExpenseController.updateExpense
);

router.post(
  '/:id/cancel',
  authorizeRoles('super_admin', 'admin', 'manager'),
  ExpenseController.cancelExpense
);

// ==========================================
// 4. EMPLOYEE REIMBURSEMENT CLAIMS
// ==========================================
router.get(
  '/claims/list',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier', 'staff'),
  ExpenseController.getClaims
);

router.get(
  '/claims/:id',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier', 'staff'),
  ExpenseController.getClaimById
);

router.post(
  '/claims',
  authorizeRoles('super_admin', 'admin', 'manager', 'cashier', 'staff'),
  ExpenseController.submitClaim
);

router.post(
  '/claims/:id/review',
  authorizeRoles('super_admin', 'admin', 'manager'),
  ExpenseController.reviewClaim
);

router.post(
  '/claims/:id/approve',
  authorizeRoles('super_admin', 'admin'),
  ExpenseController.approveClaim
);

router.post(
  '/claims/:id/reject',
  authorizeRoles('super_admin', 'admin', 'manager'),
  ExpenseController.rejectClaim
);

router.post(
  '/claims/:id/reimburse',
  authorizeRoles('super_admin', 'admin'),
  ExpenseController.reimburseClaim
);

module.exports = router;
