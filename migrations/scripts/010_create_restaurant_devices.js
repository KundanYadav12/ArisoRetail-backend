module.exports = {
  name: '010_create_restaurant_devices',
  async up(connection) {
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS restaurant_devices (
          id INT AUTO_INCREMENT PRIMARY KEY,
          restaurant_id INT NOT NULL,
          device_name VARCHAR(255) NOT NULL,
          device_token VARCHAR(255) NOT NULL UNIQUE,
          ip_address VARCHAR(100),
          status VARCHAR(50) DEFAULT 'online',
          last_seen_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      console.log('[Migration] Created restaurant_devices table successfully.');
    } catch (err) {
      console.error('[Migration Error 010]', err.message);
    }
  }
};
