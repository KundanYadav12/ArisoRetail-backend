const express = require('express');
const router = express.Router();
const FinancialAccountController = require('../controllers/financial_account_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

// All routes require authentication
router.use(authenticateToken);

// Dashboard metrics
router.get('/dashboard', authorizeRoles('super_admin', 'admin', 'manager', 'cashier'), FinancialAccountController.getDashboardSummary);

// Financial Accounts CRUD
router.get('/accounts', authorizeRoles('super_admin', 'admin', 'manager', 'cashier'), FinancialAccountController.getAccounts);
router.get('/accounts/:id', authorizeRoles('super_admin', 'admin', 'manager'), FinancialAccountController.getAccountById);
router.post('/accounts', authorizeRoles('super_admin', 'admin', 'manager'), FinancialAccountController.createAccount);
router.put('/accounts/:id', authorizeRoles('super_admin', 'admin', 'manager'), FinancialAccountController.updateAccount);
router.patch('/accounts/:id/toggle', authorizeRoles('super_admin', 'admin'), FinancialAccountController.toggleActive);

// Account Ledger & Reconciliation
router.get('/accounts/:id/ledger', authorizeRoles('super_admin', 'admin', 'manager', 'cashier'), FinancialAccountController.getLedger);
router.get('/ledger', authorizeRoles('super_admin', 'admin', 'manager', 'cashier'), FinancialAccountController.getLedger);
router.patch('/transactions/:id/reconcile', authorizeRoles('super_admin', 'admin', 'manager'), FinancialAccountController.reconcileTransaction);

// Payment Mode Mappings
router.get('/mappings', authorizeRoles('super_admin', 'admin', 'manager', 'cashier'), FinancialAccountController.getMappings);
router.post('/mappings', authorizeRoles('super_admin', 'admin', 'manager'), FinancialAccountController.upsertMapping);

// Inter-Account Contra Transfers
router.get('/transfers', authorizeRoles('super_admin', 'admin', 'manager'), FinancialAccountController.getTransfers);
router.post('/transfers', authorizeRoles('super_admin', 'admin', 'manager'), FinancialAccountController.createTransfer);

// Expenses
router.get('/expenses', authorizeRoles('super_admin', 'admin', 'manager', 'cashier'), FinancialAccountController.getExpenses);
router.post('/expenses', authorizeRoles('super_admin', 'admin', 'manager', 'cashier'), FinancialAccountController.createExpense);

module.exports = router;
