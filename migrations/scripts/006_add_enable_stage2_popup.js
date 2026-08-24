module.exports = {
  name: '006_add_enable_stage2_popup',
  async up(connection) {
    try {
      await connection.query("ALTER TABLE receipt_settings ADD COLUMN enable_stage2_popup TINYINT(1) DEFAULT 1");
      console.log("[Migration] Added column enable_stage2_popup to receipt_settings.");
    } catch (err) {
      // Ignored if column already exists
    }
  }
};
