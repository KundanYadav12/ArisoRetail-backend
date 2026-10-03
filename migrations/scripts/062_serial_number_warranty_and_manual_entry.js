/**
 * Migration 062: Add warranty tracking and manual serial entry columns to product_serial_numbers
 * 
 * Adds:
 *  - warranty_duration_value: Numeric duration (e.g. 12, 1, 24)
 *  - warranty_duration_unit: Unit string ('months', 'years')
 *  - warranty_start_date: Computed from Customer Sale Date upon sale
 *  - warranty_end_date: Computed from Warranty Start Date + duration
 */

module.exports = {
  name: '062_serial_number_warranty_and_manual_entry',
  async up(connection) {
    console.log('[Migration 062] Starting Serial Number Warranty & Manual Entry Migration...');

    const columnsToAdd = [
      { name: 'warranty_duration_value', def: 'INT DEFAULT NULL AFTER sale_price' },
      { name: 'warranty_duration_unit', def: "VARCHAR(20) DEFAULT 'months' AFTER warranty_duration_value" },
      { name: 'warranty_start_date', def: 'DATE DEFAULT NULL AFTER warranty_duration_unit' },
      { name: 'warranty_end_date', def: 'DATE DEFAULT NULL AFTER warranty_start_date' }
    ];

    for (const col of columnsToAdd) {
      try {
        const [colExist] = await connection.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = DATABASE() AND table_name = 'product_serial_numbers' AND column_name = ?
        `, [col.name]);

        if (colExist.length === 0) {
          await connection.query(`ALTER TABLE product_serial_numbers ADD COLUMN ${col.name} ${col.def}`);
          console.log(`[Migration 062] Added column "${col.name}" to product_serial_numbers.`);
        } else {
          console.log(`[Migration 062] Column "${col.name}" already exists on product_serial_numbers.`);
        }
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.error(`[Migration 062] Error adding column "${col.name}":`, err.message);
          throw err;
        }
      }
    }

    console.log('[Migration 062] Completed successfully.');
  },

  async down(connection) {
    console.log('[Migration 062] Reverting warranty columns...');
    const cols = ['warranty_end_date', 'warranty_start_date', 'warranty_duration_unit', 'warranty_duration_value'];
    for (const col of cols) {
      try {
        await connection.query(`ALTER TABLE product_serial_numbers DROP COLUMN ${col}`);
      } catch (e) {
        // ignore
      }
    }
  }
};
