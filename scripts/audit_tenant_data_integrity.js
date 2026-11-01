/**
 * Safe Data Integrity Audit Script
 * Audits database rows across tenants to find any orphaned, cross-tenant, or mismatched records.
 * READ-ONLY: Never modifies or deletes any data.
 */
const pool = require('../config/db');

async function auditDataIntegrity() {
  console.log('====================================================');
  console.log('ARISO RETAIL — MULTI-TENANT DATA INTEGRITY AUDIT');
  console.log('Mode: READ-ONLY (No data will be altered or deleted)');
  console.log('====================================================\n');

  let issueCount = 0;

  try {
    // 1. Audit Restaurants List
    const [restaurants] = await pool.query('SELECT id, name, domain, created_at FROM restaurants ORDER BY id ASC');
    console.log(`[INFO] Total Registered Restaurants: ${restaurants.length}`);
    restaurants.forEach(r => console.log(`  - Tenant #${r.id}: "${r.name}" (Domain: ${r.domain || 'N/A'})`));
    console.log('');

    const validRestaurantIds = restaurants.map(r => r.id);

    // 2. Audit Menu Items pointing to invalid tenant
    const [invalidTenantItems] = await pool.query(
      `SELECT id, name, restaurant_id, category_id FROM menu_items WHERE restaurant_id NOT IN (${validRestaurantIds.join(',')}) OR restaurant_id IS NULL`
    );
    if (invalidTenantItems.length > 0) {
      console.warn(`⚠️ [MISMATCH] ${invalidTenantItems.length} menu items carry an invalid/null restaurant_id:`);
      console.table(invalidTenantItems);
      issueCount += invalidTenantItems.length;
    } else {
      console.log('✅ [CHECK] All menu items carry a valid restaurant_id.');
    }

    // 3. Audit Cross-Tenant Menu Item <-> Category Mismatches
    // Check where menu_item.restaurant_id != category.restaurant_id
    const [crossTenantCats] = await pool.query(`
      SELECT m.id as item_id, m.name as item_name, m.restaurant_id as item_restaurant_id,
             c.id as category_id, c.name as category_name, c.restaurant_id as category_restaurant_id
      FROM menu_items m
      INNER JOIN categories c ON m.category_id = c.id
      WHERE m.restaurant_id != c.restaurant_id
    `);
    if (crossTenantCats.length > 0) {
      console.warn(`⚠️ [CROSS-TENANT MISMATCH] ${crossTenantCats.length} menu items reference a category belonging to a DIFFERENT tenant:`);
      console.table(crossTenantCats);
      issueCount += crossTenantCats.length;
    } else {
      console.log('✅ [CHECK] All menu item category mappings match the parent tenant (zero cross-tenant category references).');
    }

    // 4. Audit Categories pointing to invalid tenant
    const [invalidTenantCats] = await pool.query(
      `SELECT id, name, restaurant_id FROM categories WHERE restaurant_id NOT IN (${validRestaurantIds.join(',')}) OR restaurant_id IS NULL`
    );
    if (invalidTenantCats.length > 0) {
      console.warn(`⚠️ [MISMATCH] ${invalidTenantCats.length} categories carry an invalid/null restaurant_id:`);
      console.table(invalidTenantCats);
      issueCount += invalidTenantCats.length;
    } else {
      console.log('✅ [CHECK] All categories carry a valid restaurant_id.');
    }

    // 5. Audit Stock Movements <-> Menu Item Tenant Alignment
    const [stockTableCheck] = await pool.query("SHOW TABLES LIKE 'stock_movements'");
    if (stockTableCheck.length > 0) {
      const [mismatchedMovements] = await pool.query(`
        SELECT sm.id, sm.menu_item_id, sm.restaurant_id as movement_restaurant_id, m.restaurant_id as item_restaurant_id
        FROM stock_movements sm
        INNER JOIN menu_items m ON sm.menu_item_id = m.id
        WHERE sm.restaurant_id != m.restaurant_id
      `);
      if (mismatchedMovements.length > 0) {
        console.warn(`⚠️ [MISMATCH] ${mismatchedMovements.length} stock movements carry a restaurant_id different from the menu item:`);
        console.table(mismatchedMovements);
        issueCount += mismatchedMovements.length;
      } else {
        console.log('✅ [CHECK] All stock movements match their parent menu item tenant.');
      }
    }

    // 6. Audit Warehouse Stock <-> Warehouse Tenant Alignment
    const [whStockTable] = await pool.query("SHOW TABLES LIKE 'warehouse_stocks'");
    if (whStockTable.length > 0) {
      const [mismatchedWhStock] = await pool.query(`
        SELECT ws.id, ws.warehouse_id, ws.menu_item_id, ws.restaurant_id as ws_restaurant_id, w.restaurant_id as warehouse_restaurant_id
        FROM warehouse_stocks ws
        INNER JOIN warehouses w ON ws.warehouse_id = w.id
        WHERE ws.restaurant_id != w.restaurant_id
      `);
      if (mismatchedWhStock.length > 0) {
        console.warn(`⚠️ [MISMATCH] ${mismatchedWhStock.length} warehouse stock rows carry a mismatched restaurant_id:`);
        console.table(mismatchedWhStock);
        issueCount += mismatchedWhStock.length;
      } else {
        console.log('✅ [CHECK] All warehouse stock rows match warehouse tenant ownership.');
      }
    }

    // 7. Audit Orders <-> Restaurant Tenant Alignment
    const [invalidOrders] = await pool.query(
      `SELECT id, unique_order_number, restaurant_id FROM orders WHERE restaurant_id NOT IN (${validRestaurantIds.join(',')}) OR restaurant_id IS NULL`
    );
    if (invalidOrders.length > 0) {
      console.warn(`⚠️ [MISMATCH] ${invalidOrders.length} orders carry an invalid/null restaurant_id:`);
      console.table(invalidOrders);
      issueCount += invalidOrders.length;
    } else {
      console.log('✅ [CHECK] All orders carry a valid restaurant_id.');
    }

    console.log('\n====================================================');
    if (issueCount === 0) {
      console.log('🎉 AUDIT COMPLETE: 0 DATA INTEGRITY ANOMALIES FOUND! All rows strictly adhere to multi-tenant boundaries.');
    } else {
      console.log(`⚠️ AUDIT COMPLETE: Found ${issueCount} potential anomalies (listed above). No data was altered.`);
    }
    console.log('====================================================');

    process.exit(0);
  } catch (err) {
    console.error('Audit failed with error:', err);
    process.exit(1);
  }
}

auditDataIntegrity();
