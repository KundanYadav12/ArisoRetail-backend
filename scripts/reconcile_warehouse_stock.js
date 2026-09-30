const pool = require('../config/db');

async function reconcile() {
  console.log('--- Starting Inventory Reconciliation ---');

  // 1. Reconcile SKU 499 (Item 111) in Warehouse 3
  const [sku499Res] = await pool.execute(
    'UPDATE warehouse_stocks SET current_stock = 105.000, updated_at = NOW() WHERE menu_item_id = 111 AND warehouse_id = 3 AND restaurant_id = 4'
  );
  console.log('SKU 499 updated in warehouse_stocks:', sku499Res.affectedRows);

  // 2. Remove cross-tenant mismatched rows in warehouse_stocks
  const [delRes] = await pool.execute(
    'DELETE ws FROM warehouse_stocks ws JOIN menu_items mi ON ws.menu_item_id = mi.id WHERE ws.restaurant_id != mi.restaurant_id'
  );
  console.log('Cleaned cross-tenant rows:', delRes.affectedRows);

  // 3. For any menu_items missing warehouse_stocks records, seed them into default active warehouse
  const [missingItems] = await pool.execute(`
    SELECT mi.id, mi.restaurant_id, mi.current_stock, mi.low_stock_threshold 
    FROM menu_items mi 
    LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id 
    WHERE ws.id IS NULL
  `);
  console.log('Items missing warehouse_stocks records:', missingItems.length);
  for (const m of missingItems) {
    const [whs] = await pool.execute(
      "SELECT id FROM warehouses WHERE restaurant_id = ? AND status = 'active' ORDER BY is_default DESC, id ASC LIMIT 1",
      [m.restaurant_id]
    );
    if (whs.length > 0) {
      const whId = whs[0].id;
      await pool.execute(
        'INSERT INTO warehouse_stocks (restaurant_id, warehouse_id, menu_item_id, current_stock, reserved_stock, min_stock, reorder_level) VALUES (?, ?, ?, ?, 0.000, ?, 5.000)',
        [m.restaurant_id, whId, m.id, parseFloat(m.current_stock || 0), parseFloat(m.low_stock_threshold || 10)]
      );
      console.log(`Seeded item ${m.id} into warehouse ${whId} with stock ${m.current_stock}`);
    }
  }

  // 4. Synchronize menu_items.current_stock and reserved_stock to live sum of warehouse_stocks
  const [syncRes] = await pool.execute(`
    UPDATE menu_items mi
    SET 
      mi.current_stock = (SELECT COALESCE(SUM(ws.current_stock), 0) FROM warehouse_stocks ws WHERE ws.menu_item_id = mi.id AND ws.restaurant_id = mi.restaurant_id),
      mi.reserved_stock = (SELECT COALESCE(SUM(ws.reserved_stock), 0) FROM warehouse_stocks ws WHERE ws.menu_item_id = mi.id AND ws.restaurant_id = mi.restaurant_id)
  `);
  console.log('Synchronized menu_items current_stock and reserved_stock:', syncRes.affectedRows);

  // 5. Verify no drift remains
  const [verifyDrift] = await pool.execute(`
    SELECT mi.id, mi.name, mi.sku, mi.restaurant_id, mi.current_stock as mi_stock, COALESCE(SUM(ws.current_stock), 0) as ws_sum
    FROM menu_items mi
    LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND mi.restaurant_id = ws.restaurant_id
    GROUP BY mi.id
    HAVING ABS(COALESCE(mi_stock, 0) - COALESCE(ws_sum, 0)) > 0.001
  `);
  console.log('Remaining drift count:', verifyDrift.length, verifyDrift);

  // Check SKU 499 specifically
  const [sku499Final] = await pool.execute(
    'SELECT mi.id, mi.name, mi.sku, mi.current_stock as mi_stock, ws.current_stock as ws_stock, ws.warehouse_id FROM menu_items mi JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id WHERE mi.sku = "499"'
  );
  console.log('SKU 499 Final Status:', sku499Final);

  process.exit(0);
}

reconcile().catch(err => {
  console.error('Reconciliation error:', err);
  process.exit(1);
});
