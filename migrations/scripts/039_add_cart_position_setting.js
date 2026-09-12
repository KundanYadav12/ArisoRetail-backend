module.exports = {
  name: '039_add_cart_position_setting',
  async up(connection) {
    try {
      await connection.query("ALTER TABLE receipt_settings ADD COLUMN cart_position VARCHAR(10) DEFAULT 'right' NOT NULL");
      console.log('[Migration 039] Added column cart_position to receipt_settings.');
    } catch (err) {
      if (!err.message.includes('Duplicate column')) {
        console.warn('[Migration 039 Warning]', err.message);
      }
    }
  }
};
