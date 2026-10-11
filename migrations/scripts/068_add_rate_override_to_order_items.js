/**
 * Migration 068: Add rate override columns to order_items and receipt_settings
 * 
 * Supports:
 * - Line-level editable rate at POS billing for Weight, Quantity, and Serial items
 * - Tracking original menu rate vs overridden unit rate and override flag on order_items
 * - Configurable permission settings and lower limit protections in receipt_settings
 */

module.exports = {
  name: '068_add_rate_override_to_order_items',

  async up(connection) {
    console.log('[Migration 068] Adding rate override columns to order_items and receipt_settings...');

    // 1. Columns for order_items table
    const orderItemColumns = [
      { name: 'original_rate', spec: 'DECIMAL(10,2) NULL DEFAULT NULL AFTER price' },
      { name: 'unit_rate', spec: 'DECIMAL(10,2) NULL DEFAULT NULL AFTER original_rate' },
      { name: 'rate_overridden', spec: 'TINYINT(1) NOT NULL DEFAULT 0 AFTER unit_rate' },
      { name: 'cashier_id', spec: 'INT NULL DEFAULT NULL AFTER rate_overridden' }
    ];

    for (const col of orderItemColumns) {
      const [exists] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'order_items' AND column_name = ?
      `, [col.name]);

      if (exists.length === 0) {
        await connection.query(`ALTER TABLE order_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 068] Added column "${col.name}" to order_items.`);
      } else {
        console.log(`[Migration 068] Column "${col.name}" already exists on order_items.`);
      }
    }

    // 2. Columns for receipt_settings table
    const receiptSettingsColumns = [
      { name: 'allow_edit_rate_at_billing', spec: 'TINYINT(1) NOT NULL DEFAULT 1' },
      { name: 'edit_rate_allowed_roles', spec: "VARCHAR(255) NOT NULL DEFAULT 'admin,manager,cashier'" },
      { name: 'rate_limit_mode', spec: "VARCHAR(20) NOT NULL DEFAULT 'warning'" },
      { name: 'rate_limit_min_discount_pct', spec: 'DECIMAL(5,2) NOT NULL DEFAULT 0.00' },
      { name: 'rate_limit_below_cost', spec: 'TINYINT(1) NOT NULL DEFAULT 1' }
    ];

    for (const col of receiptSettingsColumns) {
      const [exists] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'receipt_settings' AND column_name = ?
      `, [col.name]);

      if (exists.length === 0) {
        await connection.query(`ALTER TABLE receipt_settings ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 068] Added column "${col.name}" to receipt_settings.`);
      } else {
        console.log(`[Migration 068] Column "${col.name}" already exists on receipt_settings.`);
      }
    }

    console.log('[Migration 068] Finished adding rate override columns.');
  },

  async down(connection) {
    console.log('[Migration 068] Reverting rate override columns...');

    const orderCols = ['original_rate', 'unit_rate', 'rate_overridden', 'cashier_id'];
    for (const col of orderCols) {
      try {
        await connection.query(`ALTER TABLE order_items DROP COLUMN ${col}`);
      } catch (err) {
        console.warn(`[Migration 068] Error dropping order_items.${col}:`, err.message);
      }
    }

    const settingsCols = [
      'allow_edit_rate_at_billing', 'edit_rate_allowed_roles',
      'rate_limit_mode', 'rate_limit_min_discount_pct', 'rate_limit_below_cost'
    ];
    for (const col of settingsCols) {
      try {
        await connection.query(`ALTER TABLE receipt_settings DROP COLUMN ${col}`);
      } catch (err) {
        console.warn(`[Migration 068] Error dropping receipt_settings.${col}:`, err.message);
      }
    }
  }
};
