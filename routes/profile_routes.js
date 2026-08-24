const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const ProfileController = require('../controllers/profile_controller');

// Multer Storage Configuration for Logo Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/logos');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const restId = req.user?.restaurant_id || 'rest';
    cb(null, `logo_${restId}_${Date.now()}${ext}`);
  }
});

const uploadLogoMiddleware = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB Limit
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext) || (file.mimetype && file.mimetype.startsWith('image/'))) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image file format. Supported formats: JPG, JPEG, PNG, WEBP, SVG, GIF.'));
    }
  }
});

// GET /api/settings/profile
router.get('/', authenticateToken, ProfileController.getProfile);

// PUT /api/settings/profile
router.put('/', authenticateToken, authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), ProfileController.updateProfile);

// POST /api/settings/profile/logo
router.post('/logo', authenticateToken, authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), uploadLogoMiddleware.single('logo'), ProfileController.uploadLogo);

module.exports = router;
