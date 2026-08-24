const express = require('express');
const ReportController = require('../controllers/report_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

// Cashiers can query their daily sales summary
router.get('/cashier', ReportController.getCashierDashboard);

// Managers and Admins can query aggregate reports and trigger downloads
router.get('/admin', authorizeRoles('admin', 'manager'), ReportController.getAdminDashboard);
router.get('/export/sales-excel', authorizeRoles('admin', 'manager'), ReportController.exportSalesExcel);
router.get('/export/sales-csv', authorizeRoles('admin', 'manager'), ReportController.exportSalesCSV);

// Item-wise Sales Analytics routes
router.get('/item-wise/export-excel', authorizeRoles('admin', 'manager'), ReportController.exportItemSalesExcel);
router.get('/item-wise/export-csv', authorizeRoles('admin', 'manager'), ReportController.exportItemSalesCSV);
router.get('/item-wise/:id/history', authorizeRoles('admin', 'manager'), ReportController.getItemSalesHistory);
router.get('/item-wise', authorizeRoles('admin', 'manager'), ReportController.getItemWiseReport);

// CA-Ready GST Slab Report routes
router.get('/gst-slab/export-excel', authorizeRoles('admin', 'manager'), ReportController.exportGstSlabExcel);
router.get('/gst-slab', authorizeRoles('admin', 'manager'), ReportController.getGstSlabReport);

module.exports = router;
