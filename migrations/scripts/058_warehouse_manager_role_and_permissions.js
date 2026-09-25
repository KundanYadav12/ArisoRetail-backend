/**
 * Migration 058: Dedicated Warehouse Manager Role, Warehouse Assignment, and Permission System
 * 
 * - Expands users.role ENUM to include 'warehouse_manager'
 * - Adds 'permissions' (TEXT JSON) to users table for granular RBAC
 * - Ensures 'assigned_warehouse_id' exists on users table
 */
module.exports = {
  name: '058_warehouse_manager_role_and_permissions',
  async up(connection) {
    console.log('[Migration 058] Starting Warehouse Manager Role & Permission System Migration...');

    // 1. Expand users.role ENUM to include 'warehouse_manager'
    try {
      await connection.query(`
        ALTER TABLE users 
        MODIFY COLUMN role ENUM('super_admin', 'admin', 'manager', 'cashier', 'salesman', 'warehouse_manager') DEFAULT 'cashier'
      `);
      console.log('[Migration 058] Successfully added "warehouse_manager" to users.role ENUM.');
    } catch (err) {
      console.warn('[Migration 058] Notice altering users.role:', err.message);
    }

    // 2. Ensure assigned_warehouse_id column exists
    try {
      const [colWh] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'assigned_warehouse_id'
      `);
      if (colWh.length === 0) {
        await connection.query('ALTER TABLE users ADD COLUMN assigned_warehouse_id INT DEFAULT NULL');
        console.log('[Migration 058] Added column "assigned_warehouse_id" to users.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.warn('[Migration 058] Warning checking/adding assigned_warehouse_id:', err.message);
      }
    }

    // 3. Add permissions column (TEXT / JSON array of granted permission keys)
    try {
      const [colPerm] = await connection.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'permissions'
      `);
      if (colPerm.length === 0) {
        await connection.query('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL AFTER assigned_warehouse_id');
        console.log('[Migration 058] Added column "permissions" to users.');
      }
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME') {
        console.warn('[Migration 058] Warning adding users.permissions:', err.message);
      }
    }

    console.log('[Migration 058] Warehouse Manager Role & Permission System migration completed.');
  },

  async down(connection) {
    console.log('[Migration 058] Down migration not implemented.');
  }
};
