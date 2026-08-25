module.exports = {
  name: '031_add_missing_menu_items_columns',
  async up(connection) {
    console.log('[Migration 031] Adding missing columns to menu_items table...');

    const columnsToAdd = [
      { name: 'gst_rate', spec: 'DECIMAL(5, 2) DEFAULT 5.00' },
      { name: 'prep_time_minutes', spec: 'INT DEFAULT 10' },
      { name: 'spicy_level', spec: 'INT DEFAULT 0' },
      { name: 'seq', spec: 'INT DEFAULT 0' },
      { name: 'kitchen_category', spec: "VARCHAR(50) DEFAULT 'Main Kitchen'" },
      { name: 'printer_id', spec: 'INT DEFAULT NULL' }
    ];

    for (const col of columnsToAdd) {
      try {
        await connection.query(`ALTER TABLE menu_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 031] Successfully added column "${col.name}" to menu_items.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 031] Column "${col.name}" already exists on menu_items.`);
        } else {
          console.error(`[Migration 031] Error adding column "${col.name}":`, err.message);
          throw err;
        }
      }
    }

    // Try to add Foreign Key constraint for printer_id
    try {
      await connection.query(`
        ALTER TABLE menu_items 
        ADD CONSTRAINT fk_menu_items_printer 
        FOREIGN KEY (printer_id) REFERENCES printers(id) 
        ON DELETE SET NULL
      `);
      console.log('[Migration 031] Successfully added foreign key constraint fk_menu_items_printer.');
    } catch (err) {
      if (err.code === 'ER_DUP_KEY' || err.code === 'ER_FK_DUP_NAME' || err.message.includes('already exists')) {
        console.log('[Migration 031] Foreign key constraint fk_menu_items_printer already exists.');
      } else {
        console.warn('[Migration 031] Warning adding foreign key fk_menu_items_printer:', err.message);
      }
    }
  }
};
