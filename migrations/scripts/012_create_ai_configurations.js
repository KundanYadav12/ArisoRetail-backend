const pool = require('../../config/db');

module.exports = {
  name: '012_create_ai_configurations',
  up: async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_configurations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        provider VARCHAR(50) NOT NULL DEFAULT 'google_gemini',
        api_key TEXT NULL,
        model_name VARCHAR(50) NOT NULL DEFAULT 'gemini-2.5-flash',
        is_enabled TINYINT(1) NOT NULL DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Insert initial record if empty
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM ai_configurations');
    if (rows[0].count === 0) {
      await pool.query(`
        INSERT INTO ai_configurations (provider, model_name, is_enabled)
        VALUES ('google_gemini', 'gemini-2.5-flash', 1);
      `);
    }
    console.log('[Migration] Created ai_configurations table for Gemini AI integration.');
  }
};
