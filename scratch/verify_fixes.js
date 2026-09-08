const path = require('path');
const uploadMiddleware = require('../middlewares/upload_middleware');
const pool = require('../config/db');

// Test Case 1: Check dynamic extension resolving helper
console.log('--- TEST CASE 1: Dynamic Extension Resolving ---');
const testFiles = [
  { originalname: 'test.png', mimetype: 'image/png' },
  { originalname: 'test.PNG', mimetype: 'image/png' },
  { originalname: 'no_extension', mimetype: 'image/jpeg' },
  { originalname: 'no_ext_webp', mimetype: 'image/webp' },
  { originalname: 'logo', mimetype: 'image/gif' }
];

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

for (const file of testFiles) {
  const resolvedExt = getExtension(file);
  console.log(`Original: "${file.originalname}" | Mime: "${file.mimetype}" => Resolved Ext: "${resolvedExt}"`);
}

// Test Case 2: Verify database shift queries
console.log('\n--- TEST CASE 2: DB Cashier Shifts Access Test ---');
async function runDbTest() {
  try {
    const [rows] = await pool.query('SELECT * FROM cashier_shifts LIMIT 5');
    console.log('✅ DB cashier_shifts table query successful. Shift count:', rows.length);
    process.exit(0);
  } catch (err) {
    console.error('❌ DB query failed:', err.message);
    process.exit(1);
  }
}

runDbTest();
