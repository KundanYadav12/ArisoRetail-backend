const express = require('express');
const DeliveryChallanController = require('../controllers/delivery_challan_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

const router = express.Router();
router.use(authenticateToken);

const allowedRoles = ['admin', 'manager', 'cashier', 'salesman', 'owner', 'super_admin', 'superadmin'];

router.get('/', authorizeRoles(...allowedRoles), DeliveryChallanController.getAll);
router.post('/', authorizeRoles(...allowedRoles), DeliveryChallanController.create);
router.get('/order/:salesOrderId', authorizeRoles(...allowedRoles), DeliveryChallanController.getBySalesOrderId);
router.get('/:id', authorizeRoles(...allowedRoles), DeliveryChallanController.getById);
router.post('/:id/cancel', authorizeRoles(...allowedRoles), DeliveryChallanController.cancel);

module.exports = router;
