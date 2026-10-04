/**
 * Migration 064: Add pos_unit_type to menu_items
 * 
 * Supports 3 POS Unit Types:
 *  - 'PCS': Count/piece based sales
 *  - 'WEIGHT': Scale / weight based sales (kg, g, etc.)
 *  - 'SERIAL': Serial number tracked sales where each unit is bound to an 8-digit serial number
 */

module.exports = {
  name: '064_add_pos_unit_type_to_menu_items',
  async up(connection) {
    console.log('[Migration 064] Starting pos_unit_type Migration...');

    try {
      const [colExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'menu_items' AND column_name = 'pos_unit_type'
      `);

      if (colExist.length === 0) {
        await connection.query(`ALTER TABLE menu_items ADD COLUMN pos_unit_type VARCHAR(20) NOT NULL DEFAULT 'PCS' AFTER is_weight_based`);
        console.log('[Migration 064] Added column "pos_unit_type" to menu_items.');
      } else {
        console.log('[Migration 064] Column "pos_unit_type" already exists on menu_items.');
      }

      // Check is_serial_tracked column
      const [snColExist] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'menu_items' AND column_name = 'is_serial_tracked'
      `);

      if (snColExist.length === 0) {
        await connection.query(`ALTER TABLE menu_items ADD COLUMN is_serial_tracked TINYINT(1) NOT NULL DEFAULT 0 AFTER track_inventory`);
        console.log('[Migration 064] Added column "is_serial_tracked" to menu_items.');
      }

      // Synchronize existing menu items:
      // 1. Weight items
      await connection.query(`UPDATE menu_items SET pos_unit_type = 'WEIGHT', is_serial_tracked = 0 WHERE is_weight_based = 1`);

      // 2. Serial-tracked items (items in product_serial_numbers or SKU/Barcode 122)
      await connection.query(`
        UPDATE menu_items 
        SET pos_unit_type = 'SERIAL', is_serial_tracked = 1, is_weight_based = 0 
        WHERE id IN (SELECT DISTINCT menu_item_id FROM product_serial_numbers WHERE menu_item_id IS NOT NULL)
           OR sku = '122' OR barcode = '122'
      `);

      // 3. Regular PCS items without serials
      await connection.query(`
        UPDATE menu_items 
        SET pos_unit_type = 'PCS', is_serial_tracked = 0 
        WHERE is_weight_based = 0 
          AND pos_unit_type != 'SERIAL'
      `);

      console.log('[Migration 064] Synchronized existing menu items with accurate pos_unit_type values.');
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.error('[Migration 064] Error adding column "pos_unit_type":', err.message);
        throw err;
      }
    }

    console.log('[Migration 064] Completed successfully.');
  },

  async down(connection) {
    console.log('[Migration 064] Reverting pos_unit_type column...');
    try {
      await connection.query(`ALTER TABLE menu_items DROP COLUMN pos_unit_type`);
    } catch (e) {
      // ignore
    }
  }
};
