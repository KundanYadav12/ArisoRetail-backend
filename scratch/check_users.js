require('dotenv').config();
const pool = require('../config/db');
const bcrypt = require('bcryptjs');

async function setKnownCredentials() {
  try {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query('UPDATE users SET password_hash = ?, is_active = 1, is_verified = 1 WHERE email IN ("admin@mcd.com", "aman@mcd.com", "kundanyadav96197@gmail.com")', [hash]);
    console.log('✅ Updated credentials for admin@mcd.com and aman@mcd.com to password: admin123');
  } catch (err) {
    console.error('Error setting credentials:', err);
  } finally {
    process.exit(0);
  }
}

setKnownCredentials();
