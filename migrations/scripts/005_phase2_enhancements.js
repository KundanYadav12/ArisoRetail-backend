module.exports = {
  name: '005_phase2_enhancements',
  async up(connection) {
    // 1. Alter receipt_settings to add GST and printing stage settings
    const receiptSettingsColumns = [
      { name: 'gst_mode', spec: "ENUM('included', 'excluded') DEFAULT 'excluded'" },
      { name: 'default_gst_rate', spec: 'DECIMAL(5,2) DEFAULT 5.00' },
      { name: 'print_stage1_mode', spec: "VARCHAR(30) DEFAULT 'print_kot_receipt'" },
      { name: 'print_stage2_mode', spec: "VARCHAR(30) DEFAULT 'print_receipt_only'" },
      { name: 'allow_cashier_view_all_reports', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'enable_whatsapp_receipt', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'whatsapp_business_phone', spec: 'VARCHAR(20) DEFAULT NULL' }
    ];

    for (const col of receiptSettingsColumns) {
      try {
        await connection.query(`ALTER TABLE receipt_settings ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration] Added column ${col.name} to receipt_settings.`);
      } catch (err) {
        // Ignored if column already exists
      }
    }

    // 2. Alter orders to add discount and customer details
    const ordersColumns = [
      { name: 'discount_type', spec: "ENUM('amount', 'percentage') DEFAULT 'amount'" },
      { name: 'discount_value', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'customer_name', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'customer_phone', spec: 'VARCHAR(20) DEFAULT NULL' }
    ];

    for (const col of ordersColumns) {
      try {
        await connection.query(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration] Added column ${col.name} to orders.`);
      } catch (err) {
        // Ignored if column already exists
      }
    }

    // 2.5 Alter cashier_shifts to support wallet and other collection modes
    const cashierShiftsColumns = [
      { name: 'wallet_collected', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'other_collected', spec: 'DECIMAL(10,2) DEFAULT 0.00' }
    ];

    for (const col of cashierShiftsColumns) {
      try {
        await connection.query(`ALTER TABLE cashier_shifts ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration] Added column ${col.name} to cashier_shifts.`);
      } catch (err) {
        // Ignored if column already exists
      }
    }

    // 3. Create indexes on orders and order_items
    const indexes = [
      { name: 'idx_orders_search', table: 'orders', spec: '(restaurant_id, cashier_id, created_at)' },
      { name: 'idx_orders_phone', table: 'orders', spec: '(restaurant_id, customer_phone)' },
      { name: 'idx_orders_name', table: 'orders', spec: '(restaurant_id, customer_name)' },
      { name: 'idx_order_items_name', table: 'order_items', spec: '(order_id, name)' }
    ];

    for (const idx of indexes) {
      try {
        await connection.query(`CREATE INDEX ${idx.name} ON ${idx.table} ${idx.spec}`);
        console.log(`[Migration] Created index ${idx.name} on ${idx.table}.`);
      } catch (err) {
        // Ignored if index already exists
      }
    }
  }
};
