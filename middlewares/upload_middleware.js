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
  'image/tiff': '.tiff'
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
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.gif', '.heic', '.heif', '.jfif', '.bmp', '.tiff'];
  const ext = getExtension(file);
  if (allowedExts.includes(ext) || (file.mimetype && file.mimetype.startsWith('image/'))) {
    return cb(null, true);
  }
  const err = new Error('Only image uploads are allowed! Supported formats: JPG, JPEG, PNG, WEBP, SVG, GIF, HEIC, JFIF, BMP, TIFF.');
  err.status = 400;
  cb(err);
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: fileFilter
});

module.exports = upload;
