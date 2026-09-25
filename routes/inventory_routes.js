const express = require('express');
const router = express.Router();
const InventoryController = require('../controllers/inventory_controller');
const SupplierPayableController = require('../controllers/supplier_payable_controller');
const WarehouseRackController = require('../controllers/warehouse_rack_controller');
const StockCountingController = require('../controllers/stock_counting_controller');
const { authenticateToken, authorizeRoles, requirePermission, enforceWarehouseScope } = require('../middlewares/auth_middleware');

router.use(authenticateToken);
router.use(authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'salesman', 'warehouse_manager'));
router.use(enforceWarehouseScope);

// 1. Existing Report & Legacy Adjustments
router.get('/report/export-excel', requirePermission('inventory_catalog'), InventoryController.exportStockExcel);
router.get('/report/export-csv', requirePermission('inventory_catalog'), InventoryController.exportStockCSV);
router.get('/report', requirePermission('inventory_catalog'), InventoryController.getStockReport);
router.post('/adjust', requirePermission('stock_adjustment'), InventoryController.adjustStock);
router.get('/logs', requirePermission('stock_ledger'), InventoryController.getStockLogs);

// 2. Dashboard Metrics & Stock Ledger
router.get('/dashboard-metrics', requirePermission('warehouse_dashboard'), InventoryController.getDashboardMetrics);
router.get('/ledger', requirePermission('stock_ledger'), InventoryController.getLedger);

// 3. Warehouses & Outlets
router.get('/warehouses', requirePermission('warehouses'), InventoryController.getWarehouses);
router.get('/warehouses/:id', requirePermission('warehouses'), InventoryController.getWarehouseById);
router.get('/warehouses/:id/stock', requirePermission('warehouses'), InventoryController.getWarehouseStock);
router.post('/warehouses', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createWarehouse);
router.put('/warehouses/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.updateWarehouse);

// 4. Supplier Payables & Outstanding (Must be before /suppliers/:id)
router.get('/suppliers/outstanding', requirePermission('suppliers'), SupplierPayableController.getSupplierOutstandingDashboard);
router.get('/suppliers/payments/:id', requirePermission('suppliers'), SupplierPayableController.getPaymentById);
router.post('/suppliers/payments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), SupplierPayableController.recordSupplierPayment);
router.post('/suppliers/adjust-advance', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), SupplierPayableController.adjustSupplierAdvance);

// 4b. Suppliers & Vendor Management
router.get('/suppliers', requirePermission('suppliers'), InventoryController.getSuppliers);
router.get('/suppliers/:id', requirePermission('suppliers'), InventoryController.getSupplierById);
router.get('/suppliers/:id/bills', requirePermission('suppliers'), InventoryController.getSupplierBills);
router.get('/suppliers/:id/payables', requirePermission('suppliers'), SupplierPayableController.getSupplierPayableDetails);
router.get('/suppliers/:id/ledger-statement', requirePermission('suppliers'), SupplierPayableController.getDetailedLedger);
router.post('/suppliers', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createSupplier);
router.put('/suppliers/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.updateSupplier);
router.delete('/suppliers/:id', authorizeRoles('admin', 'super_admin', 'superadmin'), InventoryController.deleteSupplier);

// 5. Stock Requests & Approvals
router.get('/stock-requests', requirePermission('stock_requests'), InventoryController.getStockRequests);
router.get('/stock-requests/:id', requirePermission('stock_requests'), InventoryController.getStockRequestById);
router.post('/stock-requests', requirePermission('stock_requests'), InventoryController.createStockRequest);
router.post('/stock-requests/:id/approve', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_requests'), InventoryController.approveStockRequest);
router.post('/stock-requests/:id/reject', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_requests'), InventoryController.rejectStockRequest);

// 6. Stock Transfers & Receiving
router.get('/stock-transfers', requirePermission('stock_transfer'), InventoryController.getStockTransfers);
router.get('/stock-transfers/:id', requirePermission('stock_transfer'), InventoryController.getStockTransferById);
router.post('/stock-transfers', requirePermission('stock_transfer'), InventoryController.createStockTransfer);
router.post('/stock-transfers/:id/receive', requirePermission('stock_receiving'), InventoryController.receiveStockTransfer);

// 7. Purchases — Purchase Orders
router.get('/purchases/orders', requirePermission('purchases'), InventoryController.getPurchaseOrders);
router.get('/purchases/orders/:id', requirePermission('purchases'), InventoryController.getPurchaseOrderById);
router.post('/purchases/orders', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createPurchaseOrder);
router.put('/purchases/orders/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.updatePurchaseOrder);
router.post('/purchases/orders/:id/approve', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.approvePurchaseOrder);
router.post('/purchases/orders/:id/cancel', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.cancelPurchaseOrder);

// 8. Purchases — GRN (Goods Received Notes)
router.get('/purchases/grns', requirePermission('stock_receiving'), InventoryController.getGRNs);
router.get('/purchases/grns/:id', requirePermission('stock_receiving'), InventoryController.getGRNById);
router.post('/purchases/grns', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_receiving'), InventoryController.createGRN);
router.post('/purchases/grns/:id/convert-to-bill', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.convertGRNToBill);

// 9. Purchases — Purchase Bills
router.get('/purchases/bills', requirePermission('purchases'), InventoryController.getPurchaseBills);
router.get('/purchases/bills/:id', requirePermission('purchases'), InventoryController.getPurchaseBillById);
router.post('/purchases/bills', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.createPurchaseBill);

// 10. Purchases — Purchase Returns
router.get('/purchases/returns', requirePermission('purchases'), InventoryController.getPurchaseReturns);
router.post('/purchases/returns', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('purchases'), InventoryController.createPurchaseReturn);

// 11. Supplier Payments
router.get('/purchases/payments', requirePermission('suppliers'), InventoryController.getSupplierPayments);
router.post('/purchases/payments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), InventoryController.recordSupplierPayment);

// 12. Supplier Ledger
router.get('/suppliers/:id/ledger', requirePermission('suppliers'), InventoryController.getSupplierLedger);

// 13. Stock Adjustments (Multi-line)
router.get('/adjustments', requirePermission('stock_adjustment'), InventoryController.getAdjustments);
router.get('/adjustments/:id', requirePermission('stock_adjustment'), InventoryController.getAdjustmentById);
router.post('/adjustments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_adjustment'), InventoryController.createAdjustment);

// 14. Warehouse Racks & Exact Stock Locations
router.get('/racks', requirePermission('rack_management'), WarehouseRackController.getRacks);
router.get('/racks/:id', requirePermission('rack_management'), WarehouseRackController.getRackById);
router.post('/racks', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('rack_management'), WarehouseRackController.createRack);
router.put('/racks/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('rack_management'), WarehouseRackController.updateRack);
router.delete('/racks/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), WarehouseRackController.deleteRack);
router.get('/racks/:id/products', requirePermission('rack_management'), WarehouseRackController.getProductsByRack);
router.get('/products/:productId/racks', requirePermission('rack_management'), WarehouseRackController.getRacksByProduct);
router.post('/racks/transfer', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('rack_management'), WarehouseRackController.moveRackStock);
router.get('/stock-tally', requirePermission('rack_management'), WarehouseRackController.getStockTally);
router.get('/products/:productId/timeline', requirePermission('rack_management'), WarehouseRackController.getProductMovementTimeline);

// 15. Stock Counting & Device Assignments
router.get('/stock-counting/devices', requirePermission('stock_count'), StockCountingController.getDevices);
router.get('/stock-counting/devices/:id', requirePermission('stock_count'), StockCountingController.getDeviceById);
router.post('/stock-counting/devices', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_count'), StockCountingController.createDevice);
router.put('/stock-counting/devices/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_count'), StockCountingController.updateDevice);
router.delete('/stock-counting/devices/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), StockCountingController.deleteDevice);

router.get('/stock-counting/assignments', requirePermission('stock_count'), StockCountingController.getAssignments);
router.post('/stock-counting/assignments', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_count'), StockCountingController.assignProducts);
router.delete('/stock-counting/assignments/:id', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_count'), StockCountingController.removeAssignment);

// Barcode restricted scan verification
router.post('/stock-counting/scan', requirePermission('stock_count'), StockCountingController.scanBarcode);

// Stock counting sessions & approvals
router.get('/stock-counting/sessions', requirePermission('stock_count'), StockCountingController.getSessions);
router.get('/stock-counting/sessions/:id', requirePermission('stock_count'), StockCountingController.getSessionById);
router.post('/stock-counting/sessions', requirePermission('stock_count'), StockCountingController.submitSession);
router.post('/stock-counting/sessions/:id/approve', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_count'), StockCountingController.approveSession);
router.post('/stock-counting/sessions/:id/reject', authorizeRoles('admin', 'manager', 'super_admin', 'superadmin', 'warehouse_manager'), requirePermission('stock_count'), StockCountingController.rejectSession);

module.exports = router;

