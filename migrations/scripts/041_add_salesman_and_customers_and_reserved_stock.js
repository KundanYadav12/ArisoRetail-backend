/**
 * Migration 041: Add Salesman Role, Customers Table, and Reserved Stock Tracking
 * 
 * - Adds 'salesman' to users.role ENUM
 * - Adds reserved_stock to menu_items (and ensures current_stock is DECIMAL(10,3) for weight precision)
 * - Creates customers table for store/customer management with restaurant isolation
 * - Adds customer_id, salesman_id, and salesman_name to orders table
 */
module.exports = {
  name: '041_add_salesman_and_customers_and_reserved_stock',
  async up(connection) {
    console.log('[Migration 041] Updating users.role ENUM to include salesman...');
    try {
      await connection.query(`
        ALTER TABLE users 
        MODIFY COLUMN role ENUM('super_admin', 'admin', 'manager', 'cashier', 'salesman') DEFAULT 'cashier'
      `);
      console.log('[Migration 041] Successfully updated users.role ENUM.');
    } catch (err) {
      console.warn('[Migration 041] Warning altering users.role:', err.message);
    }

    console.log('[Migration 041] Adding reserved_stock and ensuring 3 decimals precision on menu_items...');
    // Add reserved_stock column
    try {
      await connection.query(`
        ALTER TABLE menu_items 
        ADD COLUMN reserved_stock DECIMAL(10,3) DEFAULT 0.000
      `);
      console.log('[Migration 041] Added reserved_stock column to menu_items.');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('[Migration 041] reserved_stock column already exists on menu_items.');
      } else {
        console.warn('[Migration 041] Warning adding reserved_stock:', err.message);
      }
    }

    // Ensure current_stock is DECIMAL(10,3) to support fractional weights accurately
    try {
      await connection.query(`
        ALTER TABLE menu_items 
        MODIFY COLUMN current_stock DECIMAL(10,3) DEFAULT 100.000
      `);
      console.log('[Migration 041] Updated current_stock to DECIMAL(10,3) on menu_items.');
    } catch (err) {
      console.warn('[Migration 041] Warning modifying current_stock:', err.message);
    }

    // Ensure low_stock_threshold is DECIMAL(10,3)
    try {
      await connection.query(`
        ALTER TABLE menu_items 
        MODIFY COLUMN low_stock_threshold DECIMAL(10,3) DEFAULT 10.000
      `);
      console.log('[Migration 041] Updated low_stock_threshold to DECIMAL(10,3) on menu_items.');
    } catch (err) {
      console.warn('[Migration 041] Warning modifying low_stock_threshold:', err.message);
    }

    // Create customers table
    console.log('[Migration 041] Creating customers table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        phone VARCHAR(30) DEFAULT NULL,
        email VARCHAR(150) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        store_name VARCHAR(150) DEFAULT NULL,
        gst_number VARCHAR(30) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        INDEX idx_customers_rest_phone (restaurant_id, phone),
        INDEX idx_customers_rest_name (restaurant_id, name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 041] Created customers table successfully.');

    // Add customer & salesman columns to orders table
    const orderColumns = [
      { name: 'customer_id', spec: 'INT DEFAULT NULL' },
      { name: 'salesman_id', spec: 'INT DEFAULT NULL' },
      { name: 'salesman_name', spec: 'VARCHAR(100) DEFAULT NULL' }
    ];

    for (const col of orderColumns) {
      try {
        await connection.query(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 041] Added column ${col.name} to orders.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 041] Column ${col.name} already exists on orders.`);
        } else {
          console.warn(`[Migration 041] Warning adding ${col.name}:`, err.message);
        }
      }
    }

    console.log('[Migration 041] Migration completed successfully.');
  }
};
