const pool = require('../../config/db');

module.exports = {
  name: '014_expand_category_and_menu_column_lengths',
  up: async () => {
    try {
      await pool.query(`
        ALTER TABLE categories
        MODIFY COLUMN name VARCHAR(255) NOT NULL,
        MODIFY COLUMN description TEXT NULL;
      `);
    } catch (err) {
      console.warn('[Migration 014 Categories Alert]', err.message);
    }

    try {
      await pool.query(`
        ALTER TABLE menu_items
        MODIFY COLUMN name VARCHAR(255) NOT NULL,
        MODIFY COLUMN description TEXT NULL;
      `);
    } catch (err) {
      console.warn('[Migration 014 MenuItems Alert]', err.message);
    }

    console.log('[Migration] Expanded name and description column lengths in categories and menu_items tables.');
  }
};
