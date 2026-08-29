/**
 * Migration 036: Add barcode_image_url column to menu_items table
 * Used by both Admin Panel (Add/Edit Item) and SuperBill Billing scanner.
 * Single source of truth — shared field for all barcode image storage.
 */
module.exports = {
  name: '036_add_barcode_image_url_to_menu_items',
  async up(connection) {
    console.log('[Migration 036] Adding barcode_image_url column to menu_items table...');

    try {
      await connection.query(`ALTER TABLE menu_items ADD COLUMN barcode_image_url VARCHAR(500) DEFAULT NULL AFTER image_url`);
      console.log('[Migration 036] Successfully added column "barcode_image_url" to menu_items.');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('[Migration 036] Column "barcode_image_url" already exists on menu_items.');
      } else {
        console.error('[Migration 036] Error adding column "barcode_image_url":', err.message);
        throw err;
      }
    }
  }
};
