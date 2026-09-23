const express = require('express');
const router = express.Router();
const InventoryController = require('../controllers/inventory_controller');
const SupplierPayableController = require('../controllers/supplier_payable_controller');
const WarehouseRackController = require('../controllers/warehouse_rack_controller');
const StockCountingController = require('../controllers/stock_counting_controller');
const { authenticateToken, authorizeRoles, enforceWarehouseScope } = require('../middlewares/auth_middleware');

router.use(authenticateToken);
router.use(authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'salesman', 'warehouse_manager'));
router.use(enforceWarehouseScope);

// 1. Existing Report & Legacy Adjustments
router.get('/report/export-excel', InventoryController.exportStockExcel);
router.get('/report/export-csv', InventoryController.exportStockCSV);
router.get('/report', InventoryController.getStockReport);
router.post('/adjust', InventoryController.adjustStock);
router.get('/logs', InventoryController.getStockLogs);

// 2. Dashboard Metrics & Stock Ledger
router.get('/dashboard-metrics', InventoryController.getDashboardMetrics);
router.get('/ledger', InventoryController.getLedger);

// 3. Warehouses & Outlets
router.get('/warehouses', InventoryController.getWarehouses);
router.get('/warehouses/:id', InventoryController.getWarehouseById);
router.get('/warehouses/:id/stock', InventoryController.getWarehouseStock);
router.post('/warehouses', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createWarehouse);
router.put('/warehouses/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.updateWarehouse);

// 4. Supplier Payables & Outstanding (Must be before /suppliers/:id)
router.get('/suppliers/outstanding', SupplierPayableController.getSupplierOutstandingDashboard);
router.get('/suppliers/payments/:id', SupplierPayableController.getPaymentById);
router.post('/suppliers/payments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), SupplierPayableController.recordSupplierPayment);
router.post('/suppliers/adjust-advance', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), SupplierPayableController.adjustSupplierAdvance);

// 4b. Suppliers & Vendor Management
router.get('/suppliers', InventoryController.getSuppliers);
router.get('/suppliers/:id', InventoryController.getSupplierById);
router.get('/suppliers/:id/bills', InventoryController.getSupplierBills);
router.get('/suppliers/:id/payables', SupplierPayableController.getSupplierPayableDetails);
router.get('/suppliers/:id/ledger-statement', SupplierPayableController.getDetailedLedger);
router.post('/suppliers', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createSupplier);
router.put('/suppliers/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.updateSupplier);
router.delete('/suppliers/:id', authorizeRoles('admin', 'super_admin', 'superadmin'), InventoryController.deleteSupplier);

// 5. Stock Requests & Approvals
router.get('/stock-requests', InventoryController.getStockRequests);
router.get('/stock-requests/:id', InventoryController.getStockRequestById);
router.post('/stock-requests', InventoryController.createStockRequest);
router.post('/stock-requests/:id/approve', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), InventoryController.approveStockRequest);
router.post('/stock-requests/:id/reject', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), InventoryController.rejectStockRequest);

// 6. Stock Transfers & Receiving
router.get('/stock-transfers', InventoryController.getStockTransfers);
router.get('/stock-transfers/:id', InventoryController.getStockTransferById);
router.post('/stock-transfers', InventoryController.createStockTransfer);
router.post('/stock-transfers/:id/receive', InventoryController.receiveStockTransfer);

// 7. Purchases — Purchase Orders
router.get('/purchases/orders', InventoryController.getPurchaseOrders);
router.get('/purchases/orders/:id', InventoryController.getPurchaseOrderById);
router.post('/purchases/orders', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createPurchaseOrder);
router.put('/purchases/orders/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.updatePurchaseOrder);
router.post('/purchases/orders/:id/approve', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.approvePurchaseOrder);
router.post('/purchases/orders/:id/cancel', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.cancelPurchaseOrder);

// 8. Purchases — GRN (Goods Received Notes)
router.get('/purchases/grns', InventoryController.getGRNs);
router.get('/purchases/grns/:id', InventoryController.getGRNById);
router.post('/purchases/grns', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), InventoryController.createGRN);
router.post('/purchases/grns/:id/convert-to-bill', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.convertGRNToBill);

// 9. Purchases — Purchase Bills
router.get('/purchases/bills', InventoryController.getPurchaseBills);
router.get('/purchases/bills/:id', InventoryController.getPurchaseBillById);
router.post('/purchases/bills', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createPurchaseBill);

// 10. Purchases — Purchase Returns
router.get('/purchases/returns', InventoryController.getPurchaseReturns);
router.post('/purchases/returns', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), InventoryController.createPurchaseReturn);

// 11. Supplier Payments
router.get('/purchases/payments', InventoryController.getSupplierPayments);
router.post('/purchases/payments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.recordSupplierPayment);

// 12. Supplier Ledger
router.get('/suppliers/:id/ledger', InventoryController.getSupplierLedger);

// 13. Stock Adjustments (Multi-line)
router.get('/adjustments', InventoryController.getAdjustments);
router.get('/adjustments/:id', InventoryController.getAdjustmentById);
router.post('/adjustments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), InventoryController.createAdjustment);

// 14. Warehouse Racks & Exact Stock Locations
router.get('/racks', WarehouseRackController.getRacks);
router.get('/racks/:id', WarehouseRackController.getRackById);
router.post('/racks', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), WarehouseRackController.createRack);
router.put('/racks/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), WarehouseRackController.updateRack);
router.delete('/racks/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), WarehouseRackController.deleteRack);
router.get('/racks/:id/products', WarehouseRackController.getProductsByRack);
router.get('/products/:productId/racks', WarehouseRackController.getRacksByProduct);
router.post('/racks/transfer', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), WarehouseRackController.moveRackStock);
router.get('/stock-tally', WarehouseRackController.getStockTally);
router.get('/products/:productId/timeline', WarehouseRackController.getProductMovementTimeline);

// 15. Stock Counting & Device Assignments
router.get('/stock-counting/devices', StockCountingController.getDevices);
router.get('/stock-counting/devices/:id', StockCountingController.getDeviceById);
router.post('/stock-counting/devices', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), StockCountingController.createDevice);
router.put('/stock-counting/devices/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), StockCountingController.updateDevice);
router.delete('/stock-counting/devices/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), StockCountingController.deleteDevice);

router.get('/stock-counting/assignments', StockCountingController.getAssignments);
router.post('/stock-counting/assignments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), StockCountingController.assignProducts);
router.delete('/stock-counting/assignments/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), StockCountingController.removeAssignment);

// Barcode restricted scan verification
router.post('/stock-counting/scan', StockCountingController.scanBarcode);

// Stock counting sessions & approvals
router.get('/stock-counting/sessions', StockCountingController.getSessions);
router.get('/stock-counting/sessions/:id', StockCountingController.getSessionById);
router.post('/stock-counting/sessions', StockCountingController.submitSession);
router.post('/stock-counting/sessions/:id/approve', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), StockCountingController.approveSession);
router.post('/stock-counting/sessions/:id/reject', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), StockCountingController.rejectSession);

module.exports = router;

