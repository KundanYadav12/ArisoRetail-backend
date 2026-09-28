/**
 * Migration 059: Product Serial Number Tracking & Printing Suite
 * 
 * Creates:
 *  - product_serial_numbers: Stores unique 8-digit serial numbers, permanently linked to:
 *      * Product / Unit (menu_item_id)
 *      * Manufacturer Purchase (purchase date, purchase invoice, supplier)
 *      * Customer Sale (sale date, sales invoice, customer)
 *      * Current Status (in_stock, sold, returned, damaged)
 *  - Adds is_serial_tracked to menu_items
 *  - Adds serial_number to order_items
 *  - Adds serial_numbers to purchase_bill_items & goods_received_note_items
 */

module.exports = {
  name: '059_product_serial_number_tracking',
  async up(connection) {
    console.log('[Migration 059] Starting Product Serial Number Tracking Migration...');

    // 1. Create product_serial_numbers table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS product_serial_numbers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        serial_number VARCHAR(16) NOT NULL,
        menu_item_id INT NOT NULL,
        warehouse_id INT DEFAULT NULL,
        status ENUM('in_stock', 'sold', 'returned', 'damaged') DEFAULT 'in_stock',
        
        -- Manufacturer Purchase linkage
        purchase_bill_id INT DEFAULT NULL,
        purchase_bill_item_id INT DEFAULT NULL,
        grn_id INT DEFAULT NULL,
        purchase_invoice_number VARCHAR(100) DEFAULT NULL,
        purchase_date DATE DEFAULT NULL,
        supplier_id INT DEFAULT NULL,
        supplier_name VARCHAR(255) DEFAULT NULL,
        purchase_cost DECIMAL(12, 2) DEFAULT 0.00,
        
        -- Customer Sale linkage
        order_id INT DEFAULT NULL,
        order_item_id INT DEFAULT NULL,
        sales_invoice_number VARCHAR(100) DEFAULT NULL,
        sale_date DATETIME DEFAULT NULL,
        customer_id INT DEFAULT NULL,
        customer_name VARCHAR(255) DEFAULT NULL,
        customer_phone VARCHAR(50) DEFAULT NULL,
        sale_price DECIMAL(12, 2) DEFAULT 0.00,
        
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        UNIQUE KEY uq_serial_number (serial_number),
        INDEX idx_psn_restaurant_serial (restaurant_id, serial_number),
        INDEX idx_psn_menu_item (menu_item_id),
        INDEX idx_psn_status (status),
        INDEX idx_psn_purchase_bill (purchase_bill_id),
        INDEX idx_psn_order (order_id),
        INDEX idx_psn_warehouse (warehouse_id),
        INDEX idx_psn_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[Migration 059] Created table "product_serial_numbers".');

    // 2. Add is_serial_tracked column to menu_items
    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'menu_items' AND column_name = 'is_serial_tracked'
      `);
      if (colExist.length === 0) {
        await connection.query('ALTER TABLE menu_items ADD COLUMN is_serial_tracked TINYINT(1) DEFAULT 1 AFTER track_inventory');
        console.log('[Migration 059] Added column "is_serial_tracked" to menu_items.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') console.warn('[Migration 059] Warning on menu_items:', err.message);
    }

    // 3. Add serial_number column to order_items
    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'order_items' AND column_name = 'serial_number'
      `);
      if (colExist.length === 0) {
        await connection.query('ALTER TABLE order_items ADD COLUMN serial_number VARCHAR(16) DEFAULT NULL AFTER barcode');
        console.log('[Migration 059] Added column "serial_number" to order_items.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') console.warn('[Migration 059] Warning on order_items:', err.message);
    }

    // 4. Add serial_numbers column to purchase_bill_items
    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'purchase_bill_items' AND column_name = 'serial_numbers'
      `);
      if (colExist.length === 0) {
        await connection.query('ALTER TABLE purchase_bill_items ADD COLUMN serial_numbers TEXT DEFAULT NULL AFTER batch_number');
        console.log('[Migration 059] Added column "serial_numbers" to purchase_bill_items.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') console.warn('[Migration 059] Warning on purchase_bill_items:', err.message);
    }

    // 5. Add serial_numbers column to goods_received_note_items
    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'goods_received_note_items' AND column_name = 'serial_numbers'
      `);
      if (colExist.length === 0) {
        await connection.query('ALTER TABLE goods_received_note_items ADD COLUMN serial_numbers TEXT DEFAULT NULL AFTER batch_number');
        console.log('[Migration 059] Added column "serial_numbers" to goods_received_note_items.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') console.warn('[Migration 059] Warning on goods_received_note_items:', err.message);
    }

    console.log('[Migration 059] Product Serial Number Tracking Migration completed successfully.');
  },

  async down(connection) {
    console.log('[Migration 059] Reverting Product Serial Number Tracking...');
    await connection.query('DROP TABLE IF EXISTS product_serial_numbers;');
  }
};
