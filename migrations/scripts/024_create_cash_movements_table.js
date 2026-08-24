module.exports = {
  name: '024_create_cash_movements_table',
  async up(connection) {
    // 1. Create cash_movements table for tracking Cash In / Cash Out float entries
    await connection.query(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        user_id INT NOT NULL,
        shift_id INT DEFAULT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        movement_type ENUM('in', 'out') NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('[Migration 024] Created cash_movements table successfully.');
  }
};
