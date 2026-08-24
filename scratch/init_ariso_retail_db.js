require('dotenv').config();
const mysql = require('mysql2/promise');
const runMigrations = require('../migrations/runner');
const bcrypt = require('bcryptjs');

async function initializeRetailDatabase() {
  console.log('==================================================');
  console.log('  INITIALIZING ISOLATED DATABASE: ariso_retail_db');
  console.log('==================================================');

  // 1. Connect without database selected to create ariso_retail_db if not exists
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || ''
  });

  await connection.query('CREATE DATABASE IF NOT EXISTS ariso_retail_db;');
  console.log('✅ Database "ariso_retail_db" created or verified.');
  await connection.end();

  // 2. Run all migrations into ariso_retail_db
  console.log('\n--- Running Schema Migrations for ariso_retail_db ---');
  await runMigrations();

  // 3. Set known test credentials in ariso_retail_db
  const pool = require('../config/db');
  const hash = await bcrypt.hash('admin123', 10);
  await pool.query(
    'UPDATE users SET password_hash = ?, is_active = 1, is_verified = 1 WHERE email IN ("admin@mcd.com", "aman@mcd.com", "kundanyadav96197@gmail.com")',
    [hash]
  );
  console.log('✅ Verified login credentials set for admin@mcd.com & aman@mcd.com in ariso_retail_db (Password: admin123)');

  console.log('\n==================================================');
  console.log('  ARISO RETAIL DB ISOLATION COMPLETE!');
  console.log('==================================================');
  process.exit(0);
}

initializeRetailDatabase().catch((err) => {
  console.error('❌ Failed to initialize ariso_retail_db:', err);
  process.exit(1);
});
