/**
 * Product Serial Number Routes
 * Strictly protected by Super Admin permission.
 */

const express = require('express');
const router = express.Router();
const SerialNumberController = require('../controllers/serial_number_controller');
const { authenticateToken, requireSuperAdminOrPermission } = require('../middlewares/auth_middleware');

// Apply authentication and Super Admin permission restriction to all serial number routes
router.use(authenticateToken);
router.use(requireSuperAdminOrPermission('serial_numbers'));

// 1. Lookup single 8-digit Serial Number (Manual Enter or Barcode Scan)
router.get('/lookup', SerialNumberController.lookup);

// 2. Search / List all Serial Numbers with filters
router.get('/', SerialNumberController.list);

// 3. Stats (total, in_stock, sold)
router.get('/stats', SerialNumberController.getStats);

// 3.1 Check availability and validation of manual 8-digit serial number
router.get('/check-availability', SerialNumberController.checkAvailability);

// 4. Manual batch generation or registration
router.post('/generate', SerialNumberController.generateManual);

// 5. Dedicated Serial Number Barcode Print action
router.post('/print', SerialNumberController.printBarcode);

module.exports = router;
