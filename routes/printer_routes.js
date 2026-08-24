const express = require('express');
const PrinterController = require('../controllers/printer_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

// All logged in staff can see the printer mapping
router.get('/', PrinterController.getAll);
router.get('/:id', PrinterController.getById);

// Only administrators can edit/create/delete network printer profiles or trigger manual tests
router.post('/', authorizeRoles('admin'), PrinterController.create);
router.put('/:id', authorizeRoles('admin'), PrinterController.update);
router.put('/:id/status', authorizeRoles('admin'), PrinterController.updateStatus);
router.delete('/:id', authorizeRoles('admin'), PrinterController.delete);
router.post('/test', authorizeRoles('admin'), PrinterController.testConnection);
router.post('/print-receipt', PrinterController.printReceipt);

module.exports = router;
