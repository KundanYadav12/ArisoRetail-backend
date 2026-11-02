const multer = require('multer');
const path = require('path');
const fs = require('fs');

const updateUploadDir = path.join(__dirname, '../uploads/updates');
if (!fs.existsSync(updateUploadDir)) {
  fs.mkdirSync(updateUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, updateUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const cleanBaseName = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `${cleanBaseName}_${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExts = ['.exe', '.msi', '.apk', '.aab', '.zip', '.dmg', '.pkg'];
  if (allowedExts.includes(ext)) {
    return cb(null, true);
  }
  const err = new Error(`Unsupported package format: ${ext}. Supported formats: .exe, .msi, .apk, .aab, .zip`);
  err.status = 400;
  cb(err);
};

const packageUpload = multer({
  storage: storage,
  limits: { fileSize: 350 * 1024 * 1024 }, // 350 MB limit
  fileFilter: fileFilter
});

module.exports = packageUpload;
