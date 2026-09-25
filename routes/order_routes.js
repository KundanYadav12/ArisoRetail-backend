const express = require('express');
const OrderController = require('../controllers/order_controller');
const { authenticateToken, authorizeRoles, requirePermission } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

// Staff members can place active ticket orders
router.post('/', authorizeRoles('cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('pos_billing'), OrderController.create);
router.get('/', OrderController.getAll);
router.get('/history/list', OrderController.getHistory);
router.get('/history/export-excel', OrderController.exportHistoryExcel);
router.get('/history/export-csv', OrderController.exportHistory);
router.get('/history/export', OrderController.exportHistory);
router.get('/shift-summary', OrderController.getShiftSummary);
router.get('/:id', OrderController.getById);
router.get('/:id/pdf', OrderController.getReceiptPdf);
router.post('/:id/reprint', OrderController.reprint);
router.put('/:id/kitchen-status', OrderController.updateKitchenStatus);

// Confirm pending sales order (deducts stock and completes order)
router.post('/:id/confirm', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'warehouse_manager'), requirePermission('sales_orders'), OrderController.confirmOrder);

// Convert Sales Order to Invoice (partial or full)
router.post('/:id/convert-to-invoice', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'warehouse_manager'), requirePermission('sales_orders'), OrderController.convertToInvoice);

// Convert Estimate to Sales Order
router.post('/:id/convert-estimate', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'warehouse_manager'), requirePermission('sales_orders'), OrderController.convertEstimateToSalesOrder);

// Get order timeline (Estimate -> SO -> Challans -> Invoices)
router.get('/:id/timeline', OrderController.getOrderTimeline);

// Edit pending sales order
router.put('/:id', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'warehouse_manager'), requirePermission('sales_orders'), OrderController.update);

// Send sales order voucher via email
router.post('/:id/send-email', authorizeRoles('admin', 'manager', 'cashier', 'salesman'), OrderController.sendVoucherEmail);

// Cashiers & Salesmen can complete or cancel orders; managers/admins can update any status
router.put('/:id/status', authorizeRoles('admin', 'manager', 'cashier', 'salesman', 'warehouse_manager'), requirePermission('sales_orders'), OrderController.updateStatus);

module.exports = router;
