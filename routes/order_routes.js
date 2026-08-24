const express = require('express');
const OrderController = require('../controllers/order_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

// Staff members can place active ticket orders
router.post('/', authorizeRoles('cashier', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'), OrderController.create);
router.get('/', OrderController.getAll);
router.get('/history/list', OrderController.getHistory);
router.get('/history/export-excel', OrderController.exportHistoryExcel);
router.get('/history/export-csv', OrderController.exportHistory);
router.get('/history/export', OrderController.exportHistory);
router.get('/shift-summary', OrderController.getShiftSummary);
router.get('/:id', OrderController.getById);
router.post('/:id/reprint', OrderController.reprint);
router.put('/:id/kitchen-status', OrderController.updateKitchenStatus);

// Cashiers can update status to complete held orders; managers/admins can update any status (refunds, cancellations)
router.put('/:id/status', authorizeRoles('admin', 'manager', 'cashier'), OrderController.updateStatus);

module.exports = router;
