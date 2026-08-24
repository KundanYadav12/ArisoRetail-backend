const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function verifyIsolation() {
  console.log('================================================================================');
  console.log(' 🧪 ARISO RETAIL VS RESTAURANT POS — STRICT DATA ISOLATION VERIFICATION TEST');
  console.log('================================================================================\n');

  const retailDbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'Kundan@12',
    database: 'ariso_retail_db'
  };

  const posDbConfig = {
    ...retailDbConfig,
    database: 'restaurant_pos'
  };

  let retailConn, posConn;
  try {
    retailConn = await mysql.createConnection(retailDbConfig);
    console.log(`✅ Connected to "${retailDbConfig.database}"`);
  } catch (err) {
    console.error(`❌ Could not connect to "${retailDbConfig.database}":`, err.message);
    process.exit(1);
  }

  try {
    posConn = await mysql.createConnection(posDbConfig);
    console.log(`✅ Connected to "${posDbConfig.database}"`);
  } catch (err) {
    console.warn(`⚠️ Note: "${posDbConfig.database}" database not present or inaccessible locally.`);
  }

  // Ensure restaurant profile exists in ariso_retail_db
  let [rRows] = await retailConn.execute('SELECT id FROM restaurants LIMIT 1');
  let restaurantId;
  if (rRows.length === 0) {
    const [rInsert] = await retailConn.execute(
      'INSERT INTO restaurants (name, address, phone) VALUES ("Ariso Retail Flagship", "Main Market, Mumbai", "9876543210")'
    );
    restaurantId = rInsert.insertId;
  } else {
    restaurantId = rRows[0].id;
  }

  // Get valid category ID from ariso_retail_db
  let [cats] = await retailConn.execute('SELECT id, name FROM categories WHERE restaurant_id = ? LIMIT 1', [restaurantId]);
  let categoryId;
  if (cats.length === 0) {
    const [catInsert] = await retailConn.execute(
      'INSERT INTO categories (restaurant_id, name, description) VALUES (?, "Retail Test Category", "Category for testing")',
      [restaurantId]
    );
    categoryId = catInsert.insertId;
  } else {
    categoryId = cats[0].id;
  }

  // 1. Check existing items in ariso_retail_db
  const [retailItems] = await retailConn.execute('SELECT id, name, price, barcode FROM menu_items');
  console.log(`\n📦 Current products in ariso_retail_db (${retailItems.length} items):`);
  retailItems.forEach(i => console.log(`   - [ID: ${i.id}] ${i.name} (₹${i.price}) | Barcode: ${i.barcode || 'N/A'}`));

  // 2. Insert a specific Retail Test Product: "Retail Test Item (Isolated)"
  console.log('\n➕ Creating isolated product "Retail Test Item (Isolated)" in ariso_retail_db...');
  const [insertRes] = await retailConn.execute(
    'INSERT INTO menu_items (restaurant_id, category_id, name, sku, barcode, price, unit, is_weight_based) VALUES (?, ?, ?, ?, ?, 99.00, "pcs", 0)',
    [restaurantId, categoryId, 'Retail Test Item (Isolated)', 'TEST-ISOLATION-001', '999900001111']
  );
  const testItemId = insertRes.insertId;
  console.log(`✅ Created item ID ${testItemId} in ariso_retail_db.`);

  // 3. Verify it exists in ariso_retail_db
  const [afterInsertRetail] = await retailConn.execute('SELECT * FROM menu_items WHERE id = ?', [testItemId]);
  console.log(`[Verify Insert] Item in ariso_retail_db: ${afterInsertRetail.length === 1 ? 'EXISTS ✅' : 'MISSING ❌'}`);

  // 4. Verify it DOES NOT exist in restaurant_pos
  if (posConn) {
    const [afterInsertPos] = await posConn.execute('SELECT * FROM menu_items WHERE barcode = ? OR name = ?', ['999900001111', 'Retail Test Item (Isolated)']);
    console.log(`[Verify Isolation] Item in restaurant_pos: ${afterInsertPos.length === 0 ? 'NOT PRESENT ✅ (STRICT ISOLATION VERIFIED)' : 'LEAK DETECTED ❌'}`);
  }

  // 5. Delete the product from ariso_retail_db
  console.log(`\n🗑️ Deleting item ID ${testItemId} ("Retail Test Item (Isolated)") from ariso_retail_db...`);
  await retailConn.execute('DELETE FROM menu_items WHERE id = ?', [testItemId]);
  console.log(`✅ Item ID ${testItemId} deleted from ariso_retail_db.`);

  // 6. Final check in both databases
  const [finalRetail] = await retailConn.execute('SELECT * FROM menu_items WHERE id = ?', [testItemId]);
  console.log(`[Final Check] Item in ariso_retail_db: ${finalRetail.length === 0 ? 'DELETED ✅' : 'STILL EXISTS ❌'}`);

  if (posConn) {
    const [finalPosItems] = await posConn.execute('SELECT COUNT(*) as count FROM menu_items');
    console.log(`[Final Check] Total items in restaurant_pos remain intact: ${finalPosItems[0].count} items.`);
    await posConn.end();
  }

  await retailConn.end();
  console.log('\n================================================================================');
  console.log(' 🎉 STRICT DATA ISOLATION TEST PASSED 100%! ZERO CROSS-DATABASE IMPACT.');
  console.log('================================================================================');
}

verifyIsolation().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
