module.exports = {
  name: '028_license_and_distributor_management',
  async up(connection) {
    console.log('[Migration 028] Creating distributors, licenses, and subscription_history tables...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS distributors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        license_code VARCHAR(12) NOT NULL UNIQUE,
        distributor_id INT NOT NULL,
        status ENUM('available', 'activated', 'expired') DEFAULT 'available',
        current_year_pricing DECIMAL(10, 2) DEFAULT 0.00,
        next_year_pricing DECIMAL(10, 2) DEFAULT 0.00,
        subscription_period_years INT DEFAULT 1,
        activated_at TIMESTAMP NULL DEFAULT NULL,
        restaurant_id INT DEFAULT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (distributor_id) REFERENCES distributors(id) ON DELETE CASCADE,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE SET NULL,
        INDEX idx_lic_code (license_code),
        INDEX idx_lic_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS subscription_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        license_id INT DEFAULT NULL,
        amount_charged DECIMAL(10, 2) NOT NULL,
        start_date TIMESTAMP NOT NULL,
        expiry_date TIMESTAMP NOT NULL,
        year INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[Migration 028] license management tables created successfully.');
  }
};
