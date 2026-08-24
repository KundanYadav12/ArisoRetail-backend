const pool = require('../../config/db');

module.exports = {
  name: '017_create_order_sequences_table',
  up: async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS order_sequences (
          restaurant_id INT NOT NULL,
          order_date VARCHAR(10) NOT NULL,
          last_seq INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (restaurant_id, order_date)
        ) ENGINE=InnoDB;
      `);
      console.log('[Migration 017] Created order_sequences table successfully.');
    } catch (err) {
      console.warn('[Migration 017 Warning]', err.message);
    }
  }
};
