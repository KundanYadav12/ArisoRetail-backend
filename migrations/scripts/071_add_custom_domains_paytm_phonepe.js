/**
 * Migration 071: Custom Merchant Domains, Paytm & PhonePe Payment Providers
 * 
 * - Creates `merchant_custom_domains` table for domain mappings, verification & SSL status
 * - Enhances `merchant_payment_settings` with Paytm and PhonePe merchant configuration
 * - Enhances `orders` table with payment_gateway tracking
 */

module.exports = {
  name: '071_add_custom_domains_paytm_phonepe',

  async up(connection) {
    console.log('[Migration 071] Executing Custom Domains, Paytm & PhonePe Schema Migrations...');

    const addColumnIfNotExists = async (table, column, definition) => {
      const [rows] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
      `, [table, column]);
      if (rows.length === 0) {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        console.log(`[Migration 071] Added column "${column}" to table "${table}".`);
      } else {
        console.log(`[Migration 071] Column "${column}" already exists in table "${table}".`);
      }
    };

    // 1. Create `merchant_custom_domains` table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS merchant_custom_domains (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        domain VARCHAR(255) NOT NULL,
        include_www TINYINT(1) NOT NULL DEFAULT 1,
        verification_token VARCHAR(64) NOT NULL,
        verification_status ENUM('pending', 'verified', 'failed') NOT NULL DEFAULT 'pending',
        is_active TINYINT(1) NOT NULL DEFAULT 0,
        ssl_status ENUM('pending', 'provisioned', 'failed', 'not_applicable') NOT NULL DEFAULT 'pending',
        dns_records JSON DEFAULT NULL,
        last_verified_at DATETIME DEFAULT NULL,
        verification_error TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_custom_domain (domain),
        INDEX idx_mcd_restaurant (restaurant_id),
        INDEX idx_mcd_status (is_active, verification_status),
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 071] Table "merchant_custom_domains" verified.');

    // 2. Add Paytm configuration columns to `merchant_payment_settings`
    await addColumnIfNotExists('merchant_payment_settings', 'paytm_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfNotExists('merchant_payment_settings', 'paytm_mid', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('merchant_payment_settings', 'paytm_merchant_key', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfNotExists('merchant_payment_settings', 'paytm_website', "VARCHAR(50) DEFAULT 'DEFAULT'");
    await addColumnIfNotExists('merchant_payment_settings', 'paytm_industry_type_id', "VARCHAR(50) DEFAULT 'Retail'");
    await addColumnIfNotExists('merchant_payment_settings', 'paytm_channel_id', "VARCHAR(20) DEFAULT 'WEB'");
    await addColumnIfNotExists('merchant_payment_settings', 'paytm_mode', "ENUM('sandbox', 'production') NOT NULL DEFAULT 'sandbox'");

    // 3. Add PhonePe configuration columns to `merchant_payment_settings`
    await addColumnIfNotExists('merchant_payment_settings', 'phonepe_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
    await addColumnIfNotExists('merchant_payment_settings', 'phonepe_merchant_id', 'VARCHAR(100) DEFAULT NULL');
    await addColumnIfNotExists('merchant_payment_settings', 'phonepe_salt_key', 'VARCHAR(255) DEFAULT NULL');
    await addColumnIfNotExists('merchant_payment_settings', 'phonepe_salt_index', 'INT NOT NULL DEFAULT 1');
    await addColumnIfNotExists('merchant_payment_settings', 'phonepe_mode', "ENUM('sandbox', 'production') NOT NULL DEFAULT 'sandbox'");

    // 4. Add default online gateway selector
    await addColumnIfNotExists('merchant_payment_settings', 'default_online_gateway', "ENUM('razorpay', 'paytm', 'phonepe') NOT NULL DEFAULT 'razorpay'");

    // 5. Add payment_gateway to `orders` table
    await addColumnIfNotExists('orders', 'payment_gateway', "VARCHAR(50) DEFAULT NULL");

    // 6. Index on restaurants.domain if not exists
    try {
      const [idxRows] = await connection.query(`
        SHOW INDEX FROM restaurants WHERE Key_name = 'idx_restaurants_domain'
      `);
      if (idxRows.length === 0) {
        await connection.query('CREATE INDEX idx_restaurants_domain ON restaurants(domain)');
        console.log('[Migration 071] Created index idx_restaurants_domain on restaurants(domain).');
      }
    } catch (err) {
      console.warn('[Migration 071] Domain index notice:', err.message);
    }

    console.log('[Migration 071] Completed successfully.');
  }
};
