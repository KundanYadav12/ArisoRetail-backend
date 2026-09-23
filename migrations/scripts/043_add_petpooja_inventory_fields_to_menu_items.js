/**
 * Migration 043: Add Petpooja-style Inventory, Pricing, and Accounting Fields to menu_items
 */
module.exports = {
  name: '043_add_petpooja_inventory_fields_to_menu_items',
  async up(connection) {
    console.log('[Migration 043] Adding Petpooja inventory fields to menu_items...');

    const columnsToAdd = [
      { name: 'goods_or_service', spec: "VARCHAR(20) DEFAULT 'Goods'" },
      { name: 'item_code', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'hsn_code', spec: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'purchase_unit', spec: "VARCHAR(50) DEFAULT 'pcs'" },
      { name: 'sales_unit', spec: "VARCHAR(50) DEFAULT 'pcs'" },
      { name: 'brand', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'item_group', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'tags', spec: 'TEXT DEFAULT NULL' },
      { name: 'mrp', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'igst_rate', spec: 'DECIMAL(5,2) DEFAULT 5.00' },
      { name: 'discount_type', spec: "VARCHAR(20) DEFAULT 'percentage'" },
      { name: 'discount_value', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'is_trackable', spec: 'TINYINT(1) DEFAULT 1' },
      { name: 'opening_stock', spec: 'DECIMAL(10,3) DEFAULT 0.000' },
      { name: 'cost_price', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'stock_start_date', spec: 'DATE DEFAULT NULL' },
      { name: 'at_par_stock', spec: 'DECIMAL(10,3) DEFAULT 0.000' },
      { name: 'min_stock', spec: 'DECIMAL(10,3) DEFAULT 0.000' },
      { name: 'linked_sales_account', spec: "VARCHAR(100) DEFAULT 'Sales'" },
      { name: 'linked_purchase_account', spec: "VARCHAR(100) DEFAULT 'Purchase'" },
      { name: 'open_qty_popup', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'open_price_popup', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'not_for_sale', spec: 'TINYINT(1) DEFAULT 0' }
    ];

    for (const col of columnsToAdd) {
      try {
        await connection.query(`ALTER TABLE menu_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 043] Added column "${col.name}" to menu_items.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 043] Column "${col.name}" already exists on menu_items.`);
        } else {
          console.warn(`[Migration 043] Notice on "${col.name}":`, err.message);
        }
      }
    }

    // Add index on item_code for fast lookups
    try {
      await connection.query('CREATE INDEX idx_menu_items_item_code ON menu_items(restaurant_id, item_code)');
      console.log('[Migration 043] Created index on item_code.');
    } catch (err) {
      if (err.code !== 'ER_DUP_KEYNAME') {
        console.warn('[Migration 043] Index notice:', err.message);
      }
    }
  }
};
