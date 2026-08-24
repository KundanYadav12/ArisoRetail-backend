const pool = require('../../config/db');

module.exports = {
  name: '015_fix_order_items_foreign_key',
  up: async () => {
    try {
      const [fkRows] = await pool.query(`
        SELECT CONSTRAINT_NAME 
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'order_items' 
          AND COLUMN_NAME = 'menu_item_id' 
          AND REFERENCED_TABLE_NAME = 'menu_items'
      `);

      for (const row of fkRows) {
        const constraintName = row.CONSTRAINT_NAME;
        try {
          await pool.query(`ALTER TABLE order_items DROP FOREIGN KEY \`${constraintName}\``);
        } catch (e) {}
      }

      await pool.query(`
        ALTER TABLE order_items 
        MODIFY COLUMN menu_item_id INT NULL;
      `);

      await pool.query(`
        ALTER TABLE order_items 
        ADD CONSTRAINT order_items_menu_item_fk 
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
      `);

      console.log('[Migration 015] Updated order_items menu_item_id foreign key constraint to ON DELETE SET NULL.');
    } catch (err) {
      console.warn('[Migration 015 Warning]', err.message);
    }
  }
};
