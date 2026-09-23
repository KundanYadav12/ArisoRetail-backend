/**
 * Migration 048: Create Saved Reports Table & Performance Indexes
 *
 * Adds:
 *  - `saved_reports` table for custom/dynamic report templates
 *  - High-performance composite indexes for large data reporting
 */
module.exports = {
  name: '048_create_saved_reports_and_indexes',
  async up(connection) {
    console.log('[Migration 048] Starting Saved Reports and Reporting Indexes migration...');

    // 1. Table: saved_reports
    await connection.query(`
      CREATE TABLE IF NOT EXISTS saved_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        description TEXT DEFAULT NULL,
        category VARCHAR(50) DEFAULT 'custom',
        data_source ENUM('sales', 'purchase', 'inventory', 'payment', 'customer', 'supplier', 'staff') DEFAULT 'sales',
        config JSON NOT NULL,
        created_by_user_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_saved_reports_rest (restaurant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 048] Created table "saved_reports".');

    // Helper to safely add index if not exists
    const addIndexSafe = async (table, indexName, indexCols) => {
      try {
        await connection.query(`CREATE INDEX ${indexName} ON ${table} (${indexCols})`);
        console.log(`[Migration 048] Added index ${indexName} to ${table}.`);
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate key name')) {
          console.log(`[Migration 048] Index ${indexName} already exists on ${table}.`);
        } else {
          console.warn(`[Migration 048] Notice on index ${indexName} for ${table}:`, err.message);
        }
      }
    };

    // 2. High-performance composite indexes
    await addIndexSafe('orders', 'idx_orders_rep_perf', 'restaurant_id, created_at, order_status');
    await addIndexSafe('orders', 'idx_orders_cashier_perf', 'restaurant_id, cashier_id, created_at');
    await addIndexSafe('orders', 'idx_orders_salesman_perf', 'restaurant_id, salesman_id, created_at');
    await addIndexSafe('orders', 'idx_orders_customer_perf', 'restaurant_id, customer_id, created_at');
    await addIndexSafe('order_items', 'idx_order_items_perf', 'order_id, menu_item_id');
    await addIndexSafe('stock_transactions', 'idx_stock_trans_perf', 'restaurant_id, transaction_type, created_at');
    await addIndexSafe('stock_transactions', 'idx_stock_trans_wh_perf', 'restaurant_id, warehouse_id, created_at');
    await addIndexSafe('purchase_bills', 'idx_pb_rep_perf', 'restaurant_id, bill_date, status');
    await addIndexSafe('purchase_bills', 'idx_pb_supp_perf', 'restaurant_id, supplier_id, bill_date');
    await addIndexSafe('customer_ledger', 'idx_cust_ledger_perf', 'restaurant_id, customer_id, created_at');
    await addIndexSafe('supplier_ledger', 'idx_supp_ledger_perf', 'restaurant_id, supplier_id, created_at');

    console.log('[Migration 048] Completed Saved Reports and Reporting Indexes migration successfully.');
  }
};
