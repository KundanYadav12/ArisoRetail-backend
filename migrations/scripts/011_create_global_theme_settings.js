const pool = require('../../config/db');

module.exports = {
  name: '011_create_global_theme_settings',
  up: async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_theme_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        primary_color VARCHAR(30) NOT NULL DEFAULT '#f97316',
        secondary_color VARCHAR(30) NOT NULL DEFAULT '#10b981',
        danger_color VARCHAR(30) NOT NULL DEFAULT '#ef4444',
        info_color VARCHAR(30) NOT NULL DEFAULT '#3b82f6',
        preset_name VARCHAR(50) DEFAULT 'Orange (Default)',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed default theme if empty
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM global_theme_settings');
    if (rows[0].count === 0) {
      await pool.query(`
        INSERT INTO global_theme_settings (primary_color, secondary_color, danger_color, info_color, preset_name)
        VALUES ('#f97316', '#10b981', '#ef4444', '#3b82f6', 'Orange (Default)');
      `);
    }
    console.log('[Migration] Created global_theme_settings table with default theme seed.');
  }
};
