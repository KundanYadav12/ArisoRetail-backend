/**
 * Migration 033: Create Cashier Shifts Table
 * Creates the cashier_shifts table with all required columns, including Phase 2 enhancements,
 * foreign key constraints, and performance indexes.
 */
module.exports = {
  name: '033_create_cashier_shifts',
  async up(connection) {
    console.log('[Migration 033] Creating cashier_shifts table if not exists...');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS cashier_shifts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        cashier_id INT NOT NULL,
        login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        logout_time TIMESTAMP NULL DEFAULT NULL,
        device VARCHAR(255) DEFAULT NULL,
        ip_address VARCHAR(50) DEFAULT NULL,
        starting_cash DECIMAL(10, 2) DEFAULT 0.00,
        cash_collected DECIMAL(10, 2) DEFAULT 0.00,
        upi_collected DECIMAL(10, 2) DEFAULT 0.00,
        card_collected DECIMAL(10, 2) DEFAULT 0.00,
        wallet_collected DECIMAL(10, 2) DEFAULT 0.00,
        other_collected DECIMAL(10, 2) DEFAULT 0.00,
        total_collected DECIMAL(10, 2) DEFAULT 0.00,
        total_bills INT DEFAULT 0,
        status ENUM('open', 'closed') DEFAULT 'open',
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (cashier_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_shift_rest (restaurant_id, cashier_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[Migration 033] Created cashier_shifts table successfully.');
  }
};
