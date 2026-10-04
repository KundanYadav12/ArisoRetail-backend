/**
 * Migration 065: Add subscription_start_date to restaurants table and sync expired tenant status
 */
module.exports = {
  name: '065_add_subscription_start_date_and_expiry_sync',

  async up(connection) {
    console.log('[Migration 065] Checking if subscription_start_date column exists in restaurants...');
    const [cols] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'restaurants' 
        AND COLUMN_NAME = 'subscription_start_date'
    `);

    if (cols.length === 0) {
      console.log('[Migration 065] Adding subscription_start_date column to restaurants table...');
      await connection.query(`
        ALTER TABLE restaurants 
        ADD COLUMN subscription_start_date DATETIME NULL AFTER subscription_status
      `);
      console.log('[Migration 065] subscription_start_date column added successfully.');
    }

    // Backfill subscription_start_date from linked licenses or restaurant created_at
    console.log('[Migration 065] Backfilling subscription_start_date for existing restaurants...');
    await connection.query(`
      UPDATE restaurants r
      LEFT JOIN licenses l ON l.restaurant_id = r.id
      SET r.subscription_start_date = COALESCE(l.activated_at, r.created_at)
      WHERE r.subscription_start_date IS NULL
    `);

    // Sync any existing expired tenants where expiry has passed
    console.log('[Migration 065] Synchronizing expired tenant statuses...');
    await connection.query(`
      UPDATE restaurants
      SET subscription_status = 'expired',
          feature_serial_numbers = 0,
          updated_at = NOW()
      WHERE subscription_expires_at IS NOT NULL
        AND subscription_expires_at < NOW()
        AND subscription_status = 'active'
    `);

    console.log('[Migration 065] Migration completed successfully.');
  },

  async down(connection) {
    console.log('[Migration 065] Rollback: dropping subscription_start_date column...');
    const [cols] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'restaurants' 
        AND COLUMN_NAME = 'subscription_start_date'
    `);

    if (cols.length > 0) {
      await connection.query(`
        ALTER TABLE restaurants DROP COLUMN subscription_start_date
      `);
    }
  }
};
