/**
 * Migration 007: Add popup button configuration columns to receipt_settings
 * Adds toggles for Stage 1 and Stage 2 "Show Action Popup" button visibility
 */
module.exports = {
  name: '007_add_popup_button_config',
  async up(connection) {
    const newColumns = [
      // Stage 1 popup button toggles
      { name: 'stage1_popup_save_only',        def: 'TINYINT(1) DEFAULT 1' },
      { name: 'stage1_popup_receipt_only',     def: 'TINYINT(1) DEFAULT 1' },
      { name: 'stage1_popup_kot_only',         def: 'TINYINT(1) DEFAULT 1' },
      { name: 'stage1_popup_kot_receipt',      def: 'TINYINT(1) DEFAULT 1' },
      // Stage 2 popup button toggles
      { name: 'stage2_popup_save_only',        def: 'TINYINT(1) DEFAULT 1' },
      { name: 'stage2_popup_receipt_only',     def: 'TINYINT(1) DEFAULT 1' },
      { name: 'stage2_popup_kot_only',         def: 'TINYINT(1) DEFAULT 1' },
      { name: 'stage2_popup_kot_receipt',      def: 'TINYINT(1) DEFAULT 1' },
    ];

    for (const col of newColumns) {
      try {
        await connection.query(`ALTER TABLE receipt_settings ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[Migration 007] Added column: ${col.name}`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 007] Column already exists (skipping): ${col.name}`);
        } else {
          throw err;
        }
      }
    }
  }
};
