/**
 * Migration 069: Add MRP to order_items and show_mrp_savings to receipt_settings
 * 
 * Supports:
 * - Storing line-level MRP snapshot in order_items at the time of sale
 * - Show MRP column and You Saved toggle in receipt_settings (default ON)
 */

module.exports = {
  name: '069_add_mrp_and_savings_to_receipts',

  async up(connection) {
    console.log('[Migration 069] Adding MRP column to order_items and show_mrp_savings to receipt_settings...');

    // 1. Column for order_items table
    const [orderItemExists] = await connection.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'order_items' AND column_name = 'mrp'
    `);

    if (orderItemExists.length === 0) {
      await connection.query('ALTER TABLE order_items ADD COLUMN mrp DECIMAL(10,2) NULL DEFAULT NULL AFTER price');
      console.log('[Migration 069] Added column "mrp" to order_items.');
    } else {
      console.log('[Migration 069] Column "mrp" already exists on order_items.');
    }

    // 2. Column for receipt_settings table
    const [receiptSettingsExists] = await connection.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = DATABASE() AND table_name = 'receipt_settings' AND column_name = 'show_mrp_savings'
    `);

    if (receiptSettingsExists.length === 0) {
      await connection.query('ALTER TABLE receipt_settings ADD COLUMN show_mrp_savings TINYINT(1) NOT NULL DEFAULT 1');
      console.log('[Migration 069] Added column "show_mrp_savings" to receipt_settings.');
    } else {
      console.log('[Migration 069] Column "show_mrp_savings" already exists on receipt_settings.');
    }

    console.log('[Migration 069] Finished adding MRP and savings columns.');
  },

  async down(connection) {
    console.log('[Migration 069] Reverting MRP and savings columns...');

    try {
      await connection.query('ALTER TABLE order_items DROP COLUMN mrp');
    } catch (err) {
      console.warn('[Migration 069] Error dropping order_items.mrp:', err.message);
    }

    try {
      await connection.query('ALTER TABLE receipt_settings DROP COLUMN show_mrp_savings');
    } catch (err) {
      console.warn('[Migration 069] Error dropping receipt_settings.show_mrp_savings:', err.message);
    }
  }
};
