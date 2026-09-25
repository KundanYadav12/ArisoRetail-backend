const express = require('express');
const HeldReceiptController = require('../controllers/held_receipt_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

const router = express.Router();

router.use(authenticateToken);

const staffRoles = ['cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];

router.get('/', authorizeRoles(...staffRoles), HeldReceiptController.getHeldReceipts);
router.post('/', authorizeRoles(...staffRoles), HeldReceiptController.createHeldReceipt);
router.get('/:id', authorizeRoles(...staffRoles), HeldReceiptController.getHeldReceiptById);
router.put('/:id', authorizeRoles(...staffRoles), HeldReceiptController.updateHeldReceipt);
router.post('/:id/resume', authorizeRoles(...staffRoles), HeldReceiptController.resumeHeldReceipt);
router.post('/:id/complete', authorizeRoles(...staffRoles), HeldReceiptController.completeHeldReceipt);
router.post('/:id/cancel', authorizeRoles(...staffRoles), HeldReceiptController.cancelHeldReceipt);
router.delete('/:id', authorizeRoles(...staffRoles), HeldReceiptController.cancelHeldReceipt);

module.exports = router;
