/**
 * Migration 063: Add wholesale_price support to menu_items
 * 
 * Adds:
 *  - wholesale_price: Optional DECIMAL(10, 2) field on menu_items.
 *    If NULL or 0, selling in wholesale mode falls back to regular price.
 */

module.exports = {
  name: '063_add_wholesale_price_to_menu_items',
  async up(connection) {
    console.log('[Migration 063] Starting Wholesale Price Migration...');

    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'menu_items' AND column_name = 'wholesale_price'
      `);

      if (colExist.length === 0) {
        await connection.query(`ALTER TABLE menu_items ADD COLUMN wholesale_price DECIMAL(10, 2) DEFAULT NULL AFTER price`);
        console.log('[Migration 063] Added column "wholesale_price" to menu_items.');
      } else {
        console.log('[Migration 063] Column "wholesale_price" already exists on menu_items.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.error('[Migration 063] Error adding column "wholesale_price":', err.message);
        throw err;
      }
    }

    console.log('[Migration 063] Completed successfully.');
  },

  async down(connection) {
    console.log('[Migration 063] Reverting wholesale_price column...');
    try {
      await connection.query(`ALTER TABLE menu_items DROP COLUMN wholesale_price`);
    } catch (e) {
      // ignore
    }
  }
};
