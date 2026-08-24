/**
 * Migration 025: Add Retail POS Schema Enhancements
 * Adds barcode, weight-based flags, purchase price, units, min/max sale quantities,
 * and order item weight tracking for Ariso Retail POS.
 */
module.exports = {
  name: '025_retail_pos_schema_enhancements',
  async up(connection) {
    console.log('[Migration 025] Executing Ariso Retail POS schema enhancements...');

    // 1. Add retail columns to menu_items (products) table
    const menuItemColumns = [
      { name: 'barcode', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'is_weight_based', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'base_unit', spec: "VARCHAR(20) DEFAULT 'pcs'" },
      { name: 'purchase_price', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'min_sale_qty', spec: 'DECIMAL(10,3) DEFAULT 0.001' },
      { name: 'max_sale_qty', spec: 'DECIMAL(10,3) DEFAULT 1000.000' },
      { name: 'sub_category', spec: 'VARCHAR(100) DEFAULT NULL' }
    ];

    for (const col of menuItemColumns) {
      try {
        await connection.query(`ALTER TABLE menu_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 025] Added column ${col.name} to menu_items.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 025] Column ${col.name} already exists on menu_items.`);
        } else {
          console.warn(`[Migration 025] Warning adding ${col.name}:`, err.message);
        }
      }
    }

    // 2. Add barcode index if missing
    try {
      await connection.query(`CREATE INDEX idx_menu_items_barcode ON menu_items(restaurant_id, barcode)`);
      console.log('[Migration 025] Created barcode index on menu_items.');
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') {
        console.warn('[Migration 025] Barcode index notice:', err.message);
      }
    }

    // 3. Add weight columns to order_items table
    const orderItemColumns = [
      { name: 'item_weight', spec: 'DECIMAL(10,3) DEFAULT NULL' },
      { name: 'weight_unit', spec: 'VARCHAR(20) DEFAULT NULL' },
      { name: 'base_unit_price', spec: 'DECIMAL(10,2) DEFAULT NULL' },
      { name: 'barcode', spec: 'VARCHAR(100) DEFAULT NULL' }
    ];

    for (const col of orderItemColumns) {
      try {
        await connection.query(`ALTER TABLE order_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 025] Added column ${col.name} to order_items.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 025] Column ${col.name} already exists on order_items.`);
        } else {
          console.warn(`[Migration 025] Warning adding ${col.name}:`, err.message);
        }
      }
    }

    // 4. Add Bluetooth scale fields to printer / store configuration
    const storeColumns = [
      { name: 'weighing_scale_mac', spec: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'weighing_scale_name', spec: 'VARCHAR(100) DEFAULT NULL' }
    ];

    for (const col of storeColumns) {
      try {
        await connection.query(`ALTER TABLE restaurants ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 025] Added column ${col.name} to restaurants.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 025] Column ${col.name} already exists on restaurants.`);
        } else {
          console.warn(`[Migration 025] Warning adding ${col.name}:`, err.message);
        }
      }
    }

    console.log('[Migration 025] Ariso Retail POS schema enhancements completed.');
  }
};
