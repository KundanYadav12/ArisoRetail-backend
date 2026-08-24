const pool = require('../../config/db');

module.exports = {
  name: '013_add_gst_enabled_setting',
  up: async () => {
    try {
      await pool.query(`
        ALTER TABLE receipt_settings
        ADD COLUMN gst_enabled TINYINT(1) NOT NULL DEFAULT 1;
      `);
    } catch (err) {
      if (!err.message.includes('Duplicate column')) throw err;
    }

    try {
      await pool.query(`
        ALTER TABLE restaurants
        ADD COLUMN gst_enabled TINYINT(1) NOT NULL DEFAULT 1;
      `);
    } catch (err) {
      if (!err.message.includes('Duplicate column')) throw err;
    }

    console.log('[Migration] Added gst_enabled setting to receipt_settings and restaurants tables.');
  }
};
