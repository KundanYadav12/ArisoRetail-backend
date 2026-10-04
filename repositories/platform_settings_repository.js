const pool = require('../config/db');

const SUPPORT_KEY = 'support_contact_number';

class PlatformSettingsRepository {
  static async ensureTable() {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
        setting_value TEXT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
  }

  static async getSupportContactNumber() {
    try {
      const [rows] = await pool.execute(
        'SELECT setting_value FROM platform_settings WHERE setting_key = ?',
        [SUPPORT_KEY]
      );
      return (rows[0] && rows[0].setting_value) || '';
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') {
        await this.ensureTable();
        return '';
      }
      throw err;
    }
  }

  static async setSupportContactNumber(value) {
    await this.ensureTable();
    await pool.execute(
      `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [SUPPORT_KEY, value]
    );
    return value;
  }
}

module.exports = PlatformSettingsRepository;
