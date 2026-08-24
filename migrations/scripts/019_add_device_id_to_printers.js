const pool = require('../../config/db');

async function up() {
  console.log('[Migration 019] Adding device_id column to printers table...');
  try {
    const [tables] = await pool.query("SHOW TABLES LIKE 'printers'");
    if (tables.length === 0) {
      console.log('[Migration 019] Table printers does not exist yet. Skipping.');
      return;
    }

    // Check if column device_id exists
    const [cols] = await pool.query("SHOW COLUMNS FROM printers LIKE 'device_id'");
    if (cols.length === 0) {
      await pool.query(
        "ALTER TABLE printers ADD COLUMN device_id INT DEFAULT NULL AFTER restaurant_id"
      );
      console.log('[Migration 019] Added device_id column to printers table.');
    }

    // Auto-assign existing unassigned printers to the first registered gateway device for each restaurant
    const [unassignedRestaurants] = await pool.query(
      "SELECT DISTINCT restaurant_id FROM printers WHERE device_id IS NULL"
    );

    for (const r of unassignedRestaurants) {
      const [devices] = await pool.query(
        "SELECT id FROM restaurant_devices WHERE restaurant_id = ? ORDER BY id ASC LIMIT 1",
        [r.restaurant_id]
      );
      if (devices.length > 0) {
        const deviceId = devices[0].id;
        await pool.query(
          "UPDATE printers SET device_id = ? WHERE restaurant_id = ? AND device_id IS NULL",
          [deviceId, r.restaurant_id]
        );
        console.log(`[Migration 019] Auto-assigned printers for Restaurant #${r.restaurant_id} to Gateway Device #${deviceId}`);
      }
    }

    console.log('[Migration 019] Completed successfully.');
  } catch (err) {
    console.error('[Migration 019 Error]', err.message);
    throw err;
  }
}

module.exports = { up };
