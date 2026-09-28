/**
 * Migration 061: Add feature_serial_numbers permission column to restaurants table
 * 
 * Allows Super Admin to control per-tenant access to Product Serial Number Tracking & Printing.
 */

module.exports = {
  name: '061_add_serial_numbers_permission_to_restaurants',
  async up(connection) {
    console.log('[Migration 061] Adding feature_serial_numbers column to restaurants table...');

    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'restaurants' AND column_name = 'feature_serial_numbers'
      `);

      if (colExist.length === 0) {
        await connection.query(`
          ALTER TABLE restaurants 
          ADD COLUMN feature_serial_numbers TINYINT(1) NOT NULL DEFAULT 1 
          AFTER barcode_scanner_enabled
        `);
        console.log('[Migration 061] Successfully added column "feature_serial_numbers" to restaurants.');
      } else {
        console.log('[Migration 061] Column "feature_serial_numbers" already exists on restaurants.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.error('[Migration 061] Error adding column "feature_serial_numbers":', err.message);
        throw err;
      }
    }
  },

  async down(connection) {
    console.log('[Migration 061] Reverting feature_serial_numbers...');
    try {
      await connection.query('ALTER TABLE restaurants DROP COLUMN feature_serial_numbers');
    } catch (err) {
      console.warn('[Migration 061] Error dropping feature_serial_numbers:', err.message);
    }
  }
};
