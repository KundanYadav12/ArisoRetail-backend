module.exports = {
  name: '029_add_updated_at_to_menu_items',
  async up(connection) {
    console.log('[Migration 029] Adding updated_at column to menu_items table...');
    try {
      await connection.query(`
        ALTER TABLE menu_items 
        ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      `);
      console.log('[Migration 029] Successfully added updated_at column to menu_items.');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('[Migration 029] Column updated_at already exists on menu_items.');
      } else {
        throw err;
      }
    }
  }
};
