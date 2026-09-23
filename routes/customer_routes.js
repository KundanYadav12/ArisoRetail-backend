const express = require('express');
const CustomerController = require('../controllers/customer_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

const router = express.Router();

router.use(authenticateToken);

const allowedRoles = ['cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];

router.get('/', authorizeRoles(...allowedRoles), CustomerController.getAll);
router.get('/charge-presets/list', authorizeRoles(...allowedRoles), CustomerController.getChargePresets);
router.post('/charge-presets', authorizeRoles(...allowedRoles), CustomerController.addChargePreset);
router.post('/find-or-create', authorizeRoles(...allowedRoles), CustomerController.findOrCreate);
router.get('/:id/orders', authorizeRoles(...allowedRoles), CustomerController.getOrderHistory);
router.get('/:id/ledger', authorizeRoles(...allowedRoles), CustomerController.getLedger);
router.post('/:id/payment', authorizeRoles(...allowedRoles), CustomerController.recordPayment);
router.get('/:id', authorizeRoles(...allowedRoles), CustomerController.getById);
router.post('/', authorizeRoles(...allowedRoles), CustomerController.create);
router.put('/:id', authorizeRoles(...allowedRoles), CustomerController.update);

module.exports = router;
