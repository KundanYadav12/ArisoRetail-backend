const express = require('express');
const SuperBillController = require('../controllers/superbill_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const { requireSuperBillPermission } = require('../middlewares/superbill_middleware');
const upload = require('../middlewares/upload_middleware');

const router = express.Router();

// Enforce both JWT Auth and Store-Level SuperBill Feature Permission
router.use(authenticateToken, requireSuperBillPermission);

router.get('/items', SuperBillController.getItems);
router.post('/generate-barcode', SuperBillController.generateBarcode);
router.post('/items', upload.single('image'), SuperBillController.createItem);
router.post('/stock-adjust', SuperBillController.stockAdjust);
router.post('/bill', SuperBillController.createBill);

module.exports = router;
