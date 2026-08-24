const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function seedRetailDatabase() {
  console.log('================================================================================');
  console.log(' 🛍️ SEEDING ISOLATED ARISO RETAIL DATABASE (ariso_retail_db)');
  console.log('================================================================================\n');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'Kundan@12',
    database: 'ariso_retail_db'
  });

  // 1. Ensure Restaurant Profile ID 1 exists
  const [restRows] = await conn.execute('SELECT id FROM restaurants WHERE id = 1');
  if (restRows.length === 0) {
    await conn.execute(
      'INSERT INTO restaurants (id, name, address, phone, subscription_status) VALUES (1, "Ariso Retail Store", "Retail Market, Mumbai", "9876543210", "ACTIVE")'
    );
    console.log('✅ Created Restaurant Profile (ID: 1)');
  }

  // 2. Ensure Users exist with bcrypt password 'admin123'
  const passHash = await bcrypt.hash('admin123', 10);
  const users = [
    { name: 'Ariso Retail Admin', email: 'admin@mcd.com', username: 'retail_admin', role: 'admin' },
    { name: 'Aman Cashier', email: 'aman@mcd.com', username: 'retail_cashier', role: 'cashier' },
    { name: 'Super Admin', email: 'kundanyadav96197@gmail.com', username: 'superadmin', role: 'super_admin' }
  ];

  for (const u of users) {
    const [exist] = await conn.execute('SELECT id FROM users WHERE email = ?', [u.email]);
    if (exist.length > 0) {
      await conn.execute(
        'UPDATE users SET name = ?, username = ?, password_hash = ?, role = ?, is_active = 1 WHERE email = ?',
        [u.name, u.username, passHash, u.role, u.email]
      );
    } else {
      await conn.execute(
        'INSERT INTO users (restaurant_id, name, email, username, password_hash, role, is_active) VALUES (1, ?, ?, ?, ?, ?, 1)',
        [u.name, u.email, u.username, passHash, u.role]
      );
    }
  }
  console.log('✅ Seeded 3 Retail Users (admin@mcd.com, aman@mcd.com, kundanyadav96197@gmail.com)');

  // 3. Create Retail Categories
  const categories = [
    { id: 31, name: 'Grains & Pulses', description: 'Rice, Dal, Atta and Grains', seq: 1 },
    { id: 32, name: 'Fruits & Vegetables', description: 'Fresh Produce', seq: 2 },
    { id: 33, name: 'Spices & Condiments', description: 'Spices and Seasoning', seq: 3 },
    { id: 34, name: 'Dairy & Beverages', description: 'Milk, Oil, Drinks', seq: 4 },
    { id: 35, name: 'Snacks & Household', description: 'Packaged Snacks and Soap', seq: 5 }
  ];

  for (const c of categories) {
    const [exist] = await conn.execute('SELECT id FROM categories WHERE id = ?', [c.id]);
    if (exist.length > 0) {
      await conn.execute('UPDATE categories SET name = ?, description = ?, seq = ? WHERE id = ?', [c.name, c.description, c.seq, c.id]);
    } else {
      await conn.execute('INSERT INTO categories (id, restaurant_id, name, description, seq) VALUES (?, 1, ?, ?, ?)', [c.id, c.name, c.description, c.seq]);
    }
  }
  console.log('✅ Seeded 5 Retail Categories');

  // 4. Create Retail Products (Weight-based & Piece-based)
  const products = [
    { id: 101, cat: 31, name: 'Basmati Rice (Premium)', sku: 'RICE-001', barcode: '890100100001', price: 90.00, purchase: 68.00, unit: 'kg', weight: 1, stock: 100 },
    { id: 102, cat: 31, name: 'Sugar (Crystal White)', sku: 'SUGAR-002', barcode: '890100100002', price: 48.00, purchase: 38.00, unit: 'kg', weight: 1, stock: 150 },
    { id: 103, cat: 31, name: 'Toor Dal (Yellow Lentils)', sku: 'DAL-003', barcode: '890100100003', price: 140.00, purchase: 110.00, unit: 'kg', weight: 1, stock: 80 },
    { id: 104, cat: 31, name: 'Wheat Flour (Whole Atta)', sku: 'ATTA-004', barcode: '890100100004', price: 42.00, purchase: 32.00, unit: 'kg', weight: 1, stock: 200 },
    { id: 105, cat: 32, name: 'Fresh Apples (Fuji Red)', sku: 'APPLE-005', barcode: '890100100005', price: 180.00, purchase: 130.00, unit: 'kg', weight: 1, stock: 50 },
    { id: 106, cat: 32, name: 'Potatoes (Organic Red)', sku: 'POTATO-006', barcode: '890100100006', price: 30.00, purchase: 18.00, unit: 'kg', weight: 1, stock: 120 },
    { id: 107, cat: 34, name: 'Milk Packet (1 Litre)', sku: 'MILK-007', barcode: '890100100007', price: 66.00, purchase: 58.00, unit: 'pcs', weight: 0, stock: 60 },
    { id: 108, cat: 34, name: 'Sunflower Cooking Oil (1L)', sku: 'OIL-010', barcode: '890100100010', price: 145.00, purchase: 115.00, unit: 'pcs', weight: 0, stock: 40 },
    { id: 109, cat: 35, name: 'Dark Chocolate Bar (100g)', sku: 'CHOCO-008', barcode: '890100100008', price: 120.00, purchase: 85.00, unit: 'pcs', weight: 0, stock: 35 },
    { id: 110, cat: 35, name: 'Dishwash Soap (500ml)', sku: 'SOAP-009', barcode: '890100100009', price: 115.00, purchase: 80.00, unit: 'pcs', weight: 0, stock: 45 }
  ];

  for (const p of products) {
    const [exist] = await conn.execute('SELECT id FROM menu_items WHERE id = ?', [p.id]);
    if (exist.length > 0) {
      await conn.execute(
        'UPDATE menu_items SET category_id = ?, name = ?, sku = ?, barcode = ?, price = ?, purchase_price = ?, unit = ?, is_weight_based = ?, current_stock = ? WHERE id = ?',
        [p.cat, p.name, p.sku, p.barcode, p.price, p.purchase, p.unit, p.weight, p.stock, p.id]
      );
    } else {
      await conn.execute(
        'INSERT INTO menu_items (id, restaurant_id, category_id, name, sku, barcode, price, purchase_price, unit, is_weight_based, current_stock, is_available) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
        [p.id, p.cat, p.name, p.sku, p.barcode, p.price, p.purchase, p.unit, p.weight, p.stock]
      );
    }
  }
  console.log('✅ Seeded 10 Retail Products in ariso_retail_db.menu_items');

  const [dbItems] = await conn.execute('SELECT id, name, price, barcode FROM menu_items');
  console.log(`\n📦 Total items in ariso_retail_db.menu_items: ${dbItems.length}`);
  dbItems.forEach(i => console.log(`   - [ID: ${i.id}] ${i.name} (₹${i.price})`));

  await conn.end();
  console.log('\n==================================================');
  console.log(' 🎉 ARISO_RETAIL_DB SEEDING COMPLETED SUCCESSFULLY!');
  console.log('==================================================');
}

seedRetailDatabase().catch(console.error);
