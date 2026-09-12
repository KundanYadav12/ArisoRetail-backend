module.exports = {
  name: '040_add_qr_code_url_setting',
  async up(connection) {
    try {
      await connection.query("ALTER TABLE receipt_settings ADD COLUMN qr_code_url TEXT DEFAULT NULL");
      console.log('[Migration 040] Added column qr_code_url to receipt_settings.');
    } catch (err) {
      if (!err.message.includes('Duplicate column')) {
        console.warn('[Migration 040 Warning]', err.message);
      }
    }
  }
};
