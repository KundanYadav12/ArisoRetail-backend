const express = require('express');
const MenuController = require('../controllers/menu_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const upload = require('../middlewares/upload_middleware');
const multer = require('multer');
const path = require('path');

const docUploadDir = path.join(__dirname, '../uploads');
const docUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, docUploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
  }),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const { bulkLimiter } = require('../middlewares/rate_limiter_middleware');

const router = express.Router();

router.use(authenticateToken);

// Bulk Import & Bulk Operation Routes (Admin & Manager Only)
router.get('/import-sample-template', authorizeRoles('admin', 'manager'), MenuController.downloadSampleTemplate);
router.post('/import-excel', bulkLimiter, authorizeRoles('admin', 'manager'), docUpload.single('file'), MenuController.importExcel);
router.post('/import-ai-ocr', bulkLimiter, authorizeRoles('admin', 'manager'), docUpload.single('file'), MenuController.importAiOcr);
router.post('/bulk-save', bulkLimiter, authorizeRoles('admin', 'manager'), MenuController.bulkSaveItems);
router.post('/bulk-delete', bulkLimiter, authorizeRoles('admin'), MenuController.bulkDelete);
router.post('/bulk-status', bulkLimiter, authorizeRoles('admin', 'manager'), MenuController.bulkUpdateStatus);

router.get('/', MenuController.getAll);
router.get('/check-barcode', MenuController.checkBarcodeDuplicate);
router.get('/:id', MenuController.getById);

// Admin/Manager can write menu items, supporting optional image upload
router.post('/', authorizeRoles('admin', 'manager'), upload.single('image'), MenuController.create);
router.put('/:id', authorizeRoles('admin', 'manager'), upload.single('image'), MenuController.update);
router.post('/reorder', authorizeRoles('admin', 'manager'), MenuController.reorder);

// Only Admin can delete menu items
router.delete('/:id', authorizeRoles('admin'), MenuController.delete);

// Barcode image capture: stores a data-URL or image URL captured during barcode scan
router.patch('/:id/barcode-image', authorizeRoles('admin', 'manager'), MenuController.updateBarcodeImage);

module.exports = router;
