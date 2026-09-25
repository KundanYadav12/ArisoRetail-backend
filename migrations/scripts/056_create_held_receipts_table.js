/**
 * Migration 056: Create held_receipts table
 * 
 * Supports holding / parking incomplete POS carts and resuming them later
 * with full item, customer, discount, tax, and audit traceability.
 */
module.exports = {
  name: '056_create_held_receipts_table',
  async up(connection) {
    console.log('[Migration 056] Creating held_receipts table...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS held_receipts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        hold_number VARCHAR(50) NOT NULL,
        warehouse_id INT DEFAULT NULL,
        user_id INT DEFAULT NULL,
        cashier_name VARCHAR(100) DEFAULT NULL,
        customer_id INT DEFAULT NULL,
        customer_name VARCHAR(150) DEFAULT 'Walk-in Customer',
        customer_phone VARCHAR(30) DEFAULT NULL,
        customer_address TEXT DEFAULT NULL,
        customer_gst VARCHAR(30) DEFAULT NULL,
        cart_data JSON NOT NULL,
        item_count INT DEFAULT 0,
        subtotal DECIMAL(12,2) DEFAULT 0.00,
        discount_type VARCHAR(20) DEFAULT 'percentage',
        discount_value VARCHAR(20) DEFAULT '0',
        discount_amount DECIMAL(12,2) DEFAULT 0.00,
        tax_type VARCHAR(20) DEFAULT 'intra',
        tax_amount DECIMAL(12,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) DEFAULT 0.00,
        payment_mode VARCHAR(50) DEFAULT 'cash',
        notes TEXT DEFAULT NULL,
        status VARCHAR(20) DEFAULT 'held',
        completed_order_id INT DEFAULT NULL,
        resumed_at DATETIME DEFAULT NULL,
        resumed_by_user_id INT DEFAULT NULL,
        resumed_by_name VARCHAR(100) DEFAULT NULL,
        cancelled_at DATETIME DEFAULT NULL,
        cancelled_by_user_id INT DEFAULT NULL,
        cancelled_reason VARCHAR(255) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_held_rest_status (restaurant_id, status),
        INDEX idx_held_number (restaurant_id, hold_number),
        INDEX idx_held_customer (restaurant_id, customer_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[Migration 056] Table held_receipts created successfully.');
  },

  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS held_receipts');
    console.log('[Migration 056] Dropped table held_receipts.');
  }
};
