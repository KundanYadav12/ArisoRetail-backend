const express = require('express');
const router = express.Router();
const InventoryController = require('../controllers/inventory_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

router.use(authenticateToken);
router.use(authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'));

router.get('/report/export-excel', InventoryController.exportStockExcel);
router.get('/report/export-csv', InventoryController.exportStockCSV);
router.get('/report', InventoryController.getStockReport);
router.post('/adjust', InventoryController.adjustStock);
router.get('/logs', InventoryController.getStockLogs);

module.exports = router;
