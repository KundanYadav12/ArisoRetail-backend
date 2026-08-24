module.exports = {
  name: '002_enterprise_auth_and_subscriptions',
  async up(connection) {
    // 1. Subscription Plans Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        monthly_price DECIMAL(10,2) NOT NULL,
        yearly_price DECIMAL(10,2) NOT NULL,
        max_user_limit INT DEFAULT 5,
        max_manager_limit INT DEFAULT 2,
        max_cashier_limit INT DEFAULT 3,
        features TEXT,
        is_active TINYINT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Email Logs Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT DEFAULT NULL,
        to_email VARCHAR(100) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        status ENUM('SENT', 'FAILED') DEFAULT 'SENT',
        error_message TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Printer Settings Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS printer_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        printer_name VARCHAR(100) NOT NULL,
        printer_type ENUM('lan', 'usb', 'bluetooth', 'virtual') DEFAULT 'lan',
        ip_address VARCHAR(50) DEFAULT NULL,
        port VARCHAR(10) DEFAULT '9100',
        paper_width VARCHAR(10) DEFAULT '80mm',
        printer_role ENUM('receipt', 'kitchen', 'both') DEFAULT 'receipt',
        is_default_receipt TINYINT(1) DEFAULT 0,
        is_default_kot TINYINT(1) DEFAULT 0,
        status ENUM('online', 'offline', 'error') DEFAULT 'online',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. Receipt Settings Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS receipt_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL UNIQUE,
        header_title VARCHAR(100) DEFAULT NULL,
        tagline VARCHAR(255) DEFAULT NULL,
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. Audit Logs Table
    await connection.query(`
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

    // 6. OTP Verifications Table
    await connection.query(`
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
  }
};
