/**
 * Migration 035: Add barcode_scanner_enabled column to restaurants table
 * Enables store-level permission control for Barcode Scanner POS module.
 */
module.exports = {
  name: '035_add_barcode_scanner_permission_to_restaurants',
  async up(connection) {
    console.log('[Migration 035] Adding barcode_scanner_enabled column to restaurants table...');

    try {
      await connection.query(`ALTER TABLE restaurants ADD COLUMN barcode_scanner_enabled TINYINT(1) NOT NULL DEFAULT 0`);
      console.log('[Migration 035] Successfully added column "barcode_scanner_enabled" to restaurants.');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('[Migration 035] Column "barcode_scanner_enabled" already exists on restaurants.');
      } else {
        console.error('[Migration 035] Error adding column "barcode_scanner_enabled":', err.message);
        throw err;
      }
    }
  }
};
