module.exports = {
  name: '038_add_enter_key_qty_popup_setting',
  async up(connection) {
    try {
      await connection.query('ALTER TABLE receipt_settings ADD COLUMN enter_key_qty_popup TINYINT(1) DEFAULT 1 NOT NULL');
      console.log('[Migration 038] Added column enter_key_qty_popup to receipt_settings.');
    } catch (err) {
      // Ignored if column already exists
      if (!err.message.includes('Duplicate column')) {
        console.warn('[Migration 038 Warning]', err.message);
      }
    }
  }
};
