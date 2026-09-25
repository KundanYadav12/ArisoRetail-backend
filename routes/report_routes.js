const express = require('express');
const ReportController = require('../controllers/report_controller');
const { authenticateToken, authorizeRoles, requirePermission } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

// Cashiers can query their daily sales summary
router.get('/cashier', ReportController.getCashierDashboard);

// Managers and Admins can query legacy aggregate reports and downloads
router.get('/admin', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), ReportController.getAdminDashboard);
router.get('/export/sales-excel', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), ReportController.exportSalesExcel);
router.get('/export/sales-csv', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), ReportController.exportSalesCSV);

// Item-wise Sales Analytics routes
router.get('/item-wise/export-excel', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('warehouse_reports'), ReportController.exportItemSalesExcel);
router.get('/item-wise/export-csv', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('warehouse_reports'), ReportController.exportItemSalesCSV);
router.get('/item-wise/:id/history', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('warehouse_reports'), ReportController.getItemSalesHistory);
router.get('/item-wise', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('warehouse_reports'), ReportController.getItemWiseReport);

// CA-Ready GST Slab Report routes
router.get('/gst-slab/export-excel', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), ReportController.exportGstSlabExcel);
router.get('/gst-slab', authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'), ReportController.getGstSlabReport);

// =========================================================================
// CENTRAL REPORTS & BUSINESS INTELLIGENCE ENGINE ROUTES
// =========================================================================

// Catalog of all reports
router.get('/catalog', authorizeRoles('cashier', 'salesman', 'manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.getCatalog);

// Business Intelligence & DSR
router.get('/bi/dashboard', authorizeRoles('cashier', 'salesman', 'manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.getBiDashboard);
router.get('/bi/dsr', authorizeRoles('cashier', 'salesman', 'manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.getDailySalesClosing);
router.get('/bi/yearly', authorizeRoles('manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.getYearlySalesRollup);

// Dynamic Custom Reports
router.get('/custom/saved', authorizeRoles('manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.getSavedReports);
router.post('/custom/saved', authorizeRoles('manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.createSavedReport);
router.delete('/custom/saved/:id', authorizeRoles('manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.deleteSavedReport);
router.post('/custom/run', authorizeRoles('manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.runCustomReport);

// Standard Reports Execution & Exports
router.get('/view/:reportId', authorizeRoles('cashier', 'salesman', 'manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.getReportData);
router.get('/export/:reportId', authorizeRoles('manager', 'admin', 'owner', 'super_admin', 'superadmin'), ReportController.exportReport);

module.exports = router;
