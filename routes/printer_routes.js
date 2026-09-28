const express = require('express');
const PrinterController = require('../controllers/printer_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken);

// All logged in staff can see the printer mapping, discover LAN printers, and run test prints
router.get('/', PrinterController.getAll);
router.get('/discover', PrinterController.discoverPrinters);
router.post('/auto-detect', PrinterController.discoverPrinters);
router.post('/test', PrinterController.testConnection);
router.post('/print-receipt', PrinterController.printReceipt);
router.get('/:id', PrinterController.getById);

// Only administrators can edit/create/delete network printer profiles
router.post('/', authorizeRoles('admin'), PrinterController.create);
router.put('/:id', authorizeRoles('admin'), PrinterController.update);
router.put('/:id/status', authorizeRoles('admin'), PrinterController.updateStatus);
router.delete('/:id', authorizeRoles('admin'), PrinterController.delete);

module.exports = router;
