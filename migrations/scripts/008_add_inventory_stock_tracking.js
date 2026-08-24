/**
 * Migration 008: Add Inventory Stock Tracking and Stock Logs
 * Adds stock tracking columns to menu_items and creates stock_logs audit table
 */
module.exports = {
  name: '008_add_inventory_stock_tracking',
  async up(connection) {
    // 1. Add stock tracking columns to menu_items table
    const menuItemColumns = [
      { name: 'sku', spec: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'unit', spec: "VARCHAR(20) DEFAULT 'pcs'" },
      { name: 'current_stock', spec: 'DECIMAL(10,2) DEFAULT 100.00' },
      { name: 'low_stock_threshold', spec: 'DECIMAL(10,2) DEFAULT 10.00' },
      { name: 'track_inventory', spec: 'TINYINT(1) DEFAULT 1' }
    ];

    for (const col of menuItemColumns) {
      try {
        await connection.query(`ALTER TABLE menu_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 008] Added column ${col.name} to menu_items.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 008] Column ${col.name} already exists on menu_items (skipping).`);
        } else {
          throw err;
        }
      }
    }

    // 2. Create stock_logs table for audit trail
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        user_id INT DEFAULT NULL,
        user_name VARCHAR(100) DEFAULT NULL,
        adjustment_type ENUM('add', 'reduce', 'set', 'sale') NOT NULL,
        quantity DECIMAL(10,2) NOT NULL,
        previous_stock DECIMAL(10,2) NOT NULL,
        new_stock DECIMAL(10,2) NOT NULL,
        reason VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
        INDEX idx_stock_logs_search (restaurant_id, menu_item_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 008] Created stock_logs table successfully.');
  }
};
