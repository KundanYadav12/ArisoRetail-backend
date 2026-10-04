/**
 * Migration 066: Create platform_settings key/value table (platform-wide Super Admin settings,
 * e.g. support contact number shown in the tenant expired-account banner)
 */
module.exports = {
  name: '066_create_platform_settings',

  async up(connection) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
        setting_value TEXT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('[Migration 066] platform_settings table ready.');
  },

  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS platform_settings');
  }
};
