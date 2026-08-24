module.exports = {
  name: '027_create_printers_and_print_queue',
  async up(connection) {
    console.log('[Migration 027] Creating printers and print_queue tables...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS printers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        device_id INT DEFAULT NULL,
        name VARCHAR(100) NOT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        bluetooth_address VARCHAR(100) DEFAULT NULL,
        port INT DEFAULT 9100,
        paper_width VARCHAR(20) DEFAULT '80mm',
        role VARCHAR(50) DEFAULT 'receipt',
        type VARCHAR(50) DEFAULT 'thermal',
        auto_cut TINYINT(1) DEFAULT 1,
        cash_drawer TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS print_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        printer_id INT DEFAULT NULL,
        order_id INT DEFAULT NULL,
        job_type VARCHAR(50) DEFAULT 'receipt',
        status ENUM('PENDING', 'PRINTED', 'FAILED') DEFAULT 'PENDING',
        payload_base64 LONGTEXT,
        retry_count INT DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        printed_at DATETIME DEFAULT NULL,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[Migration 027] printers and print_queue tables created successfully.');
  }
};
