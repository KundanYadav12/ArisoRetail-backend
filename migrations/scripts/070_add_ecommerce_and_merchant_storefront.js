/**
 * Migration 070: Add Ecommerce, Online Ordering & Custom Store Subdomains
 * 
 * - Adds online store configuration and subdomain columns to restaurants
 * - Adds ecommerce visibility and online pricing to menu_items
 * - Adds online order lifecycle, tokens, and delivery details to orders
 * - Creates merchant_payment_settings for isolated merchant-owned payment accounts
 * - Creates online_payment_logs for payment transaction auditing and webhook logging
 */

module.exports = {
  name: '070_add_ecommerce_and_merchant_storefront',

  async up(connection) {
    console.log('[Migration 070] Executing Ecommerce & Merchant Storefront Schema Migrations...');

    // Helper to safely add column if not exists
    const addColumnIfNotExists = async (table, column, definition) => {
      const [rows] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      `, [table, column]);
      if (rows.length === 0) {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`[Migration 070] Added column "${column}" to table "${table}".`);
      } else {
        console.log(`[Migration 070] Column "${column}" already exists in table "${table}".`);
      }
    };

    // 1. Enhance `restaurants` table with online storefront settings & custom subdomain
    await addColumnIfNotExists('restaurants', 'subdomain', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'online_store_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfNotExists('restaurants', 'store_tagline', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'store_banner_url', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'store_theme_color', "VARCHAR(20) DEFAULT '#ea580c'");
    await addColumnIfNotExists('restaurants', 'store_about', 'TEXT DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'store_announcement', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'delivery_enabled', 'TINYINT(1) DEFAULT 1');
    await addColumnIfNotExists('restaurants', 'pickup_enabled', 'TINYINT(1) DEFAULT 1');
    await addColumnIfNotExists('restaurants', 'min_order_value', 'DECIMAL(10,2) DEFAULT 0.00');
    await addColumnIfNotExists('restaurants', 'delivery_charge', 'DECIMAL(10,2) DEFAULT 0.00');
    await addColumnIfNotExists('restaurants', 'free_delivery_threshold', 'DECIMAL(10,2) DEFAULT 0.00');
    await addColumnIfNotExists('restaurants', 'estimated_delivery_time', "VARCHAR(50) DEFAULT '30-45 mins'");
    await addColumnIfNotExists('restaurants', 'delivery_instructions', 'TEXT DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'store_contact_email', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'store_contact_phone', 'VARCHAR(20) DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'store_contact_whatsapp', 'VARCHAR(20) DEFAULT NULL');
    await addColumnIfNotExists('restaurants', 'store_qr_code_url', 'TEXT DEFAULT NULL');

    // Add unique index on subdomain if not already indexed
    try {
      const [idxRows] = await connection.query(`
        SHOW INDEX FROM restaurants WHERE Key_name = 'uq_restaurants_subdomain'
      `);
      if (idxRows.length === 0) {
        await connection.query('CREATE UNIQUE INDEX uq_restaurants_subdomain ON restaurants(subdomain)');
        console.log('[Migration 070] Created unique index uq_restaurants_subdomain on restaurants(subdomain).');
      }
    } catch (err) {
      console.warn('[Migration 070] Subdomain index notice:', err.message);
    }

    // 2. Enhance `menu_items` table with online availability and online prices
    await addColumnIfNotExists('menu_items', 'available_online', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfNotExists('menu_items', 'online_price', 'DECIMAL(10,2) DEFAULT NULL');
    await addColumnIfNotExists('menu_items', 'online_description', 'TEXT DEFAULT NULL');
    await addColumnIfNotExists('menu_items', 'online_seq', 'INT DEFAULT 0');
    await addColumnIfNotExists('menu_items', 'is_featured_online', 'TINYINT(1) DEFAULT 0');

    // 3. Enhance `orders` table with online order details
    await addColumnIfNotExists('orders', 'is_online', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfNotExists('orders', 'order_source', "VARCHAR(20) DEFAULT 'pos'");
    await addColumnIfNotExists('orders', 'online_order_status', "ENUM('pending', 'confirmed', 'preparing', 'ready', 'dispatched', 'completed', 'rejected', 'cancelled') DEFAULT NULL");
    await addColumnIfNotExists('orders', 'rejection_reason', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfNotExists('orders', 'delivery_fee', 'DECIMAL(10,2) DEFAULT 0.00');
    await addColumnIfNotExists('orders', 'order_access_token', 'VARCHAR(64) DEFAULT NULL');
    await addColumnIfNotExists('orders', 'delivery_city', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('orders', 'delivery_state', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('orders', 'delivery_pincode', 'VARCHAR(20) DEFAULT NULL');
    await addColumnIfNotExists('orders', 'delivery_instructions', 'TEXT DEFAULT NULL');
    await addColumnIfNotExists('orders', 'delivery_preference', "ENUM('delivery', 'pickup') DEFAULT 'delivery'");
    await addColumnIfNotExists('orders', 'gateway_order_id', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('orders', 'gateway_payment_id', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('orders', 'gateway_signature', 'VARCHAR(255) DEFAULT NULL');

    // 4. Create `merchant_payment_settings` table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchant_payment_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL UNIQUE,
        razorpay_enabled TINYINT(1) DEFAULT 0,
        razorpay_key_id VARCHAR(100) DEFAULT NULL,
        razorpay_key_secret VARCHAR(255) DEFAULT NULL,
        razorpay_webhook_secret VARCHAR(255) DEFAULT NULL,
        cod_enabled TINYINT(1) DEFAULT 1,
        upi_qr_enabled TINYINT(1) DEFAULT 0,
        upi_id VARCHAR(100) DEFAULT NULL,
        account_holder_name VARCHAR(150) DEFAULT NULL,
        bank_name VARCHAR(150) DEFAULT NULL,
        account_number VARCHAR(50) DEFAULT NULL,
        ifsc_code VARCHAR(20) DEFAULT NULL,
        settlement_notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 070] Table "merchant_payment_settings" verified.');

    // 5. Create `online_payment_logs` table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS online_payment_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        order_id INT DEFAULT NULL,
        event_type VARCHAR(100) NOT NULL,
        gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay',
        gateway_payment_id VARCHAR(100) DEFAULT NULL,
        gateway_order_id VARCHAR(100) DEFAULT NULL,
        status VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
        currency VARCHAR(10) NOT NULL DEFAULT 'INR',
        payload JSON DEFAULT NULL,
        error_message TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_opl_rest_order (restaurant_id, order_id),
        INDEX idx_opl_gateway_order (gateway_order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 070] Table "online_payment_logs" verified.');

    // 6. Seed demo subdomain for Restaurant 1 ("rampal") and Restaurant 99999 ("galaxy") if null
    try {
      await connection.query(`
        UPDATE restaurants 
        SET subdomain = 'rampal', online_store_enabled = 1, store_tagline = 'Fresh Quality Groceries Delivered Fast'
        WHERE id = 1 AND subdomain IS NULL
      `);
      // Also make first 10 items of restaurant 1 available online
      await connection.query(`
        UPDATE menu_items 
        SET available_online = 1 
        WHERE restaurant_id = 1 LIMIT 10
      `);

      // Initialize default payment settings for restaurant 1
      await connection.query(`
        INSERT IGNORE INTO merchant_payment_settings (restaurant_id, cod_enabled, razorpay_enabled)
        VALUES (1, 1, 0)
      `);
      console.log('[Migration 070] Seeded initial online store settings for demo merchant.');
    } catch (sErr) {
      console.warn('[Migration 070] Demo merchant seed notice:', sErr.message);
    }

    console.log('[Migration 070] Ecommerce & Merchant Storefront Schema Migrations completed successfully.');
  },

  async down(connection) {
    console.log('[Migration 070] Down migration not implemented to prevent accidental data loss.');
  }
};
