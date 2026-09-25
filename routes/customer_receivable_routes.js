const express = require('express');
const CustomerReceivableController = require('../controllers/customer_receivable_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

const router = express.Router();

router.use(authenticateToken);

const allowedRoles = ['cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];

router.get('/summary', authorizeRoles(...allowedRoles), CustomerReceivableController.getSummary);
router.get('/customers/:customerId/invoices', authorizeRoles(...allowedRoles), CustomerReceivableController.getUnpaidInvoices);
router.get('/customers/:customerId/unpaid-invoices', authorizeRoles(...allowedRoles), CustomerReceivableController.getUnpaidInvoices);
router.post('/payments', authorizeRoles(...allowedRoles), CustomerReceivableController.recordPayment);
router.get('/ageing', authorizeRoles(...allowedRoles), CustomerReceivableController.getAgeingReport);
router.get('/customers/:customerId/statement', authorizeRoles(...allowedRoles), CustomerReceivableController.getStatement);

module.exports = router;
