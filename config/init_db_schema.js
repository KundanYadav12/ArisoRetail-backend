const pool = require('./db');

async function initDBSchema() {
  try {
    // 1. Subscription Plans Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        duration_months INT NOT NULL DEFAULT 12,
        user_limit INT NOT NULL DEFAULT 5,
        manager_limit INT NOT NULL DEFAULT 2,
        cashier_limit INT NOT NULL DEFAULT 3,
        price DECIMAL(10,2) DEFAULT 0.00,
        features TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed default subscription plans if empty
    const [existingPlans] = await pool.query('SELECT COUNT(*) as cnt FROM subscription_plans');
    if (existingPlans[0].cnt === 0) {
      await pool.query(`
        INSERT INTO subscription_plans (name, duration_months, user_limit, manager_limit, cashier_limit, price, features) VALUES
        ('Starter Plan', 3, 5, 1, 3, 1499.00, '{"pos": true, "kot": true, "printers": 2}'),
        ('Business Plan', 6, 15, 3, 10, 2999.00, '{"pos": true, "kot": true, "printers": 5, "reports": true}'),
        ('Enterprise Plan', 12, 100, 20, 75, 5999.00, '{"pos": true, "kot": true, "printers": 99, "reports": true, "multi_terminal": true}')
      `);
    }

    // 2. Enhance Restaurants Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        domain VARCHAR(100) DEFAULT NULL,
        logo_url TEXT DEFAULT NULL,
        address TEXT DEFAULT NULL,
        phone VARCHAR(20) DEFAULT NULL,
        email VARCHAR(100) DEFAULT NULL,
        owner_name VARCHAR(100) DEFAULT NULL,
        owner_email VARCHAR(100) DEFAULT NULL,
        owner_mobile VARCHAR(20) DEFAULT NULL,
        gst_number VARCHAR(50) DEFAULT NULL,
        subscription_plan_id INT DEFAULT 1,
        max_user_limit INT DEFAULT 5,
        max_manager_limit INT DEFAULT 2,
        max_cashier_limit INT DEFAULT 3,
        subscription_status VARCHAR(20) DEFAULT 'trial',
        subscription_start_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        subscription_expires_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const restaurantColumns = [
      { name: 'owner_name', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'owner_email', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'owner_mobile', spec: 'VARCHAR(20) DEFAULT NULL' },
      { name: 'subscription_plan_id', spec: 'INT DEFAULT 1' },
      { name: 'max_user_limit', spec: 'INT DEFAULT 5' },
      { name: 'max_manager_limit', spec: 'INT DEFAULT 2' },
      { name: 'max_cashier_limit', spec: 'INT DEFAULT 3' },
      { name: 'subscription_start_at', spec: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
      { name: 'subscription_expires_at', spec: 'DATETIME DEFAULT NULL' }
    ];

    for (const col of restaurantColumns) {
      try {
        await pool.query(`ALTER TABLE restaurants ADD COLUMN ${col.name} ${col.spec}`);
      } catch (err) {
        // Ignored if column already exists
      }
    }

    // Set default active subscription expiration for existing tenants
    await pool.query(
      'UPDATE restaurants SET subscription_status = "active", subscription_expires_at = DATE_ADD(NOW(), INTERVAL 12 MONTH) WHERE subscription_expires_at IS NULL OR subscription_status IS NULL'
    );

    // 3. Ensure users table has activation & password change columns
    const userColumns = [
      { name: 'must_change_password', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'is_verified', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'verified_at', spec: 'DATETIME DEFAULT NULL' },
      { name: 'temp_password', spec: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'last_login_at', spec: 'DATETIME DEFAULT NULL' },
      { name: 'active_session_id', spec: 'VARCHAR(255) DEFAULT NULL' }
    ];

    for (const col of userColumns) {
      try {
        await pool.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.spec}`);
      } catch (err) {
        // Ignored if column already exists
      }
    }

    try {
      await pool.query('ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email)');
    } catch (err) {
      // Ignored if constraint already exists
    }

    // 4. OTP Verifications Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_verifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(100) NOT NULL,
        otp_hash VARCHAR(255) NOT NULL,
        attempts INT DEFAULT 0,
        is_verified TINYINT(1) DEFAULT 0,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_otp_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. Email Audit Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT DEFAULT NULL,
        to_email VARCHAR(100) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        status VARCHAR(20) DEFAULT 'SENT',
        error_message TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. Ensure printers table has all columns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS printers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        device_id INT DEFAULT NULL,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(20) DEFAULT 'lan',
        ip_address VARCHAR(50) DEFAULT NULL,
        bluetooth_address VARCHAR(17) DEFAULT NULL,
        port INT DEFAULT 9100,
        paper_width VARCHAR(10) DEFAULT '80',
        character_encoding VARCHAR(20) DEFAULT 'UTF-8',
        role VARCHAR(50) DEFAULT 'receipt',
        is_default_receipt TINYINT(1) DEFAULT 0,
        is_default_kot TINYINT(1) DEFAULT 0,
        auto_cut TINYINT(1) DEFAULT 1,
        cash_drawer TINYINT(1) DEFAULT 1,
        is_active TINYINT(1) DEFAULT 1,
        status VARCHAR(20) DEFAULT 'online',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 6. Ensure print_queue table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS print_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        order_id INT NOT NULL,
        printer_id INT DEFAULT NULL,
        print_type VARCHAR(20) DEFAULT 'RECEIPT',
        status VARCHAR(20) DEFAULT 'PENDING',
        retry_count INT DEFAULT 0,
        error_message TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        backend_received_at DATETIME DEFAULT NULL,
        gateway_polled_at DATETIME DEFAULT NULL,
        connection_started_at DATETIME DEFAULT NULL,
        connected_at DATETIME DEFAULT NULL,
        data_sent_at DATETIME DEFAULT NULL,
        completed_at DATETIME DEFAULT NULL,
        total_duration_ms INT DEFAULT NULL,
        printed_at DATETIME DEFAULT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. Ensure receipt_settings table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS receipt_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL UNIQUE,
        restaurant_name VARCHAR(100) DEFAULT NULL,
        branch_name VARCHAR(100) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        phone VARCHAR(20) DEFAULT NULL,
        whatsapp VARCHAR(20) DEFAULT NULL,
        email VARCHAR(100) DEFAULT NULL,
        website VARCHAR(100) DEFAULT NULL,
        gst_number VARCHAR(50) DEFAULT NULL,
        fssai_number VARCHAR(50) DEFAULT NULL,
        logo_url TEXT DEFAULT NULL,
        header_message TEXT DEFAULT NULL,
        footer_message TEXT DEFAULT NULL,
        thank_you_message VARCHAR(255) DEFAULT 'Thank You! Visit Again.',
        terms_conditions TEXT DEFAULT NULL,
        paper_size VARCHAR(10) DEFAULT '80mm',
        font_size VARCHAR(10) DEFAULT 'normal',
        header_alignment VARCHAR(10) DEFAULT 'center',
        show_logo TINYINT(1) DEFAULT 1,
        show_qr_code TINYINT(1) DEFAULT 1,
        show_customer_details TINYINT(1) DEFAULT 1,
        show_cashier_name TINYINT(1) DEFAULT 1,
        show_tax_details TINYINT(1) DEFAULT 1,
        show_payment_details TINYINT(1) DEFAULT 1,
        show_footer_notes TINYINT(1) DEFAULT 1,
        kot_header VARCHAR(100) DEFAULT 'KITCHEN ORDER TICKET',
        kitchen_name VARCHAR(100) DEFAULT 'Main Kitchen',
        kot_footer_note VARCHAR(255) DEFAULT 'Prepare with priority',
        show_kot_order_notes TINYINT(1) DEFAULT 1,
        show_kot_time TINYINT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 8. Ensure audit_logs table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT DEFAULT NULL,
        user_id INT DEFAULT NULL,
        action VARCHAR(100) NOT NULL,
        description TEXT DEFAULT NULL,
        ip_address VARCHAR(50) DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 9. Ensure order_sequences table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_sequences (
        restaurant_id INT NOT NULL,
        order_date VARCHAR(10) NOT NULL,
        last_seq INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (restaurant_id, order_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 9. Seed Default Super Admin if no super admin account exists
    const [existingSuperAdmins] = await pool.query(
      'SELECT id, username, email FROM users WHERE role IN ("super_admin", "superadmin") OR email = "kundanyadav96197@gmail.com" OR username = "superadmin"'
    );

    if (existingSuperAdmins.length === 0) {
      const crypto = require('crypto');
      const bcrypt = require('bcryptjs');

      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      let generatedPass = '';
      const bytes = crypto.randomBytes(8);
      for (let i = 0; i < 8; i++) {
        generatedPass += chars[bytes[i] % chars.length];
      }

      const passwordHash = await bcrypt.hash(generatedPass, 10);

      const [res] = await pool.query(
        `INSERT INTO users (restaurant_id, name, username, email, password_hash, role, is_active, must_change_password, is_verified)
         VALUES (NULL, 'Super Admin', 'superadmin', 'kundanyadav96197@gmail.com', ?, 'super_admin', 1, 0, 1)`,
        [passwordHash]
      );

      console.log('==================================================');
      console.log('       [DEFAULT SUPER ADMIN INITIALIZED]         ');
      console.log(' Username: superadmin');
      console.log(' Email:    kundanyadav96197@gmail.com');
      console.log(` Password: ${generatedPass}`);
      console.log(' (Stored exclusively as bcrypt hash in MySQL database)');
      console.log('==================================================');
    }

    console.log('[Database Schema Engine] Enterprise Auth, OTP, Subscription, Audit Logs, Printer & Receipt Settings tables initialized.');
  } catch (err) {
    console.error('[Database Schema Engine Error]', err.message);
  }
}

module.exports = initDBSchema;
