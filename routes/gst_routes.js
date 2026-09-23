const express = require('express');
const GstController = require('../controllers/gst_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

// 1. GST Settings
router.get('/settings', GstController.getSettings);
router.put('/settings', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.updateSettings);

// 2. GST Compliance Dashboard & Reports
router.get('/dashboard', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.getDashboard);
router.get('/gstr-1', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.getGstr1);
router.get('/gstr-1/export-excel', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.exportGstr1Excel);
router.get('/gstr-2', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.getGstr2);
router.get('/gstr-2/export-excel', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.exportGstr2Excel);
router.get('/hsn-summary', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.getHsnSummary);

// 3. Sales Returns & Credit Notes
router.post('/credit-notes', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'owner', 'super_admin', 'superadmin'), GstController.createCreditNote);
router.get('/credit-notes', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'owner', 'super_admin', 'superadmin'), GstController.getCreditNotes);
router.get('/credit-notes/:id', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'owner', 'super_admin', 'superadmin'), GstController.getCreditNoteById);

// 4. E-Invoice Operations
router.post('/orders/:id/einvoice', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'owner', 'super_admin', 'superadmin'), GstController.generateEInvoice);
router.post('/orders/:id/einvoice/cancel', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.cancelEInvoice);
router.get('/orders/:id/einvoice', GstController.getEInvoiceStatus);

// 5. E-Way Bill Operations
router.post('/orders/:id/ewaybill', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'owner', 'super_admin', 'superadmin'), GstController.generateEWayBill);
router.post('/orders/:id/ewaybill/cancel', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), GstController.cancelEWayBill);
router.get('/orders/:id/ewaybill', GstController.getEWayBillStatus);

module.exports = router;
