const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/jfif': '.jfif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'application/pdf': '.pdf'
};

function getExtension(file) {
  let ext = path.extname(file.originalname || '').toLowerCase();
  if (!ext && file.mimetype) {
    ext = MIME_TO_EXT[file.mimetype.toLowerCase()] || '';
  }
  return ext;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = getExtension(file) || '.jpg';
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.heic', '.heif', '.jfif', '.bmp', '.tiff', '.pdf'];
  const ext = getExtension(file);
  if (allowedExts.includes(ext) || (file.mimetype && (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf'))) {
    return cb(null, true);
  }
  const err = new Error('Only image and PDF uploads are allowed! Supported formats: JPG, JPEG, PNG, WEBP, SVG, GIF, HEIC, JFIF, BMP, TIFF, PDF.');
  err.status = 400;
  cb(err);
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit (compressed automatically)
  fileFilter: fileFilter
});

const {
  optimizeUploadedImage,
  optimizeProductImage,
  optimizeLogoImage,
  optimizeProfileImage,
  optimizeCategoryImage,
  optimizeAttachment
} = require('./image_optimizer_middleware');

upload.optimize = optimizeUploadedImage;
upload.optimizeProduct = optimizeProductImage;
upload.optimizeLogo = optimizeLogoImage;
upload.optimizeProfile = optimizeProfileImage;
upload.optimizeCategory = optimizeCategoryImage;
upload.optimizeAttachment = optimizeAttachment;

module.exports = upload;
module.exports.upload = upload;
module.exports.optimizeUploadedImage = optimizeUploadedImage;
module.exports.optimizeProductImage = optimizeProductImage;
module.exports.optimizeLogoImage = optimizeLogoImage;
module.exports.optimizeProfileImage = optimizeProfileImage;
module.exports.optimizeCategoryImage = optimizeCategoryImage;
module.exports.optimizeAttachment = optimizeAttachment;
