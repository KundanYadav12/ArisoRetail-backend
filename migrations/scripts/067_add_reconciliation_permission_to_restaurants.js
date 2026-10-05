/**
 * Migration 067: Add reconciliation_enabled permission column to restaurants table
 * 
 * Allows Super Admin to control per-tenant access to the Payment Reconciliation module.
 * Defaults to 0 (OFF) for all tenants.
 */

module.exports = {
  name: '067_add_reconciliation_permission_to_restaurants',
  async up(connection) {
    console.log('[Migration 067] Adding reconciliation_enabled column to restaurants table...');

    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'restaurants' AND column_name = 'reconciliation_enabled'
      `);

      if (colExist.length === 0) {
        await connection.query(`
          ALTER TABLE restaurants 
          ADD COLUMN reconciliation_enabled TINYINT(1) NOT NULL DEFAULT 0 
          AFTER feature_serial_numbers
        `);
        console.log('[Migration 067] Successfully added column "reconciliation_enabled" to restaurants.');
      } else {
        console.log('[Migration 067] Column "reconciliation_enabled" already exists on restaurants.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.error('[Migration 067] Error adding column "reconciliation_enabled":', err.message);
        throw err;
      }
    }
  },

  async down(connection) {
    console.log('[Migration 067] Reverting reconciliation_enabled...');
    try {
      await connection.query('ALTER TABLE restaurants DROP COLUMN reconciliation_enabled');
    } catch (err) {
      console.warn('[Migration 067] Error dropping reconciliation_enabled:', err.message);
    }
  }
};
