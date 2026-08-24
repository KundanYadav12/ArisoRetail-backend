const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function seedAccounts() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'Kundan@12',
    database: 'ariso_retail_db'
  });

  const passHash = await bcrypt.hash('admin123', 10);

  const accounts = [
    { name: 'Ariso Retail Admin', email: 'admin@mcd.com', username: 'retail_admin', role: 'admin' },
    { name: 'Aman Cashier', email: 'aman@mcd.com', username: 'retail_cashier', role: 'cashier' },
    { name: 'Super Admin', email: 'kundanyadav96197@gmail.com', username: 'superadmin', role: 'super_admin' }
  ];

  for (const acc of accounts) {
    const [existing] = await conn.execute('SELECT id FROM users WHERE email = ?', [acc.email]);
    if (existing.length > 0) {
      await conn.execute(
        'UPDATE users SET name = ?, username = ?, password_hash = ?, role = ?, is_active = 1 WHERE email = ?',
        [acc.name, acc.username, passHash, acc.role, acc.email]
      );
    } else {
      await conn.execute(
        'INSERT INTO users (restaurant_id, name, email, username, password_hash, role, is_active) VALUES (1, ?, ?, ?, ?, ?, 1)',
        [acc.name, acc.email, acc.username, passHash, acc.role]
      );
    }
  }

  const [allUsers] = await conn.execute('SELECT id, name, email, role, is_active FROM users');
  console.log('\n==================================================');
  console.log('  ARISO RETAIL STORE ACCOUNTS IN ARISO_RETAIL_DB');
  console.log('==================================================');
  console.table(allUsers);
  await conn.end();
}

seedAccounts().catch(console.error);
