/**
 * Migration 034: Add feature_superbill column to restaurants table
 * Enables store-level permission control for SuperBill POS feature suite.
 */
module.exports = {
  name: '034_add_superbill_permission_to_restaurants',
  async up(connection) {
    console.log('[Migration 034] Adding feature_superbill column to restaurants table...');

    try {
      await connection.query(`ALTER TABLE restaurants ADD COLUMN feature_superbill TINYINT(1) NOT NULL DEFAULT 0`);
      console.log('[Migration 034] Successfully added column "feature_superbill" to restaurants.');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('[Migration 034] Column "feature_superbill" already exists on restaurants.');
      } else {
        console.error('[Migration 034] Error adding column "feature_superbill":', err.message);
        throw err;
      }
    }
  }
};
