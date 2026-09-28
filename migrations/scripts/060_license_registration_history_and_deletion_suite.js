/**
 * Migration 060: License Registration History & Comprehensive Deletion Suite
 * 
 * 1. Modifies `licenses.status` enum to include 'inactive':
 *    ENUM('available', 'activated', 'expired', 'inactive')
 * 
 * 2. Creates `license_registration_history` table:
 *    Preserves minimal registration audit (Licence ID, account name, person name, email, registration status: Active/Inactive)
 *    surviving account tenant deletion.
 * 
 * 3. Populates existing activated licenses into `license_registration_history`.
 */

module.exports = {
  name: '060_license_registration_history_and_deletion_suite',
  async up(connection) {
    console.log('[Migration 060] Creating license_registration_history and updating license status enum...');

    // 1. Update licenses.status to include 'inactive'
    await connection.query(`
      ALTER TABLE licenses 
      MODIFY COLUMN status ENUM('available', 'activated', 'expired', 'inactive') DEFAULT 'available'
    `);

    // 2. Create license_registration_history table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS license_registration_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        license_id INT NULL,
        license_code VARCHAR(50) NOT NULL,
        account_name VARCHAR(255) NULL,
        person_name VARCHAR(255) NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NULL,
        registration_status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        unregistered_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_lrh_license_id (license_id),
        INDEX idx_lrh_license_code (license_code),
        INDEX idx_lrh_email (email),
        INDEX idx_lrh_status (registration_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Backfill currently active licenses
    await connection.query(`
      INSERT INTO license_registration_history (license_id, license_code, account_name, person_name, email, phone, registration_status, registered_at)
      SELECT l.id, l.license_code, r.name, r.owner_name, r.owner_email, r.owner_mobile, 'Active', COALESCE(l.activated_at, r.created_at, NOW())
      FROM licenses l
      JOIN restaurants r ON l.restaurant_id = r.id
      WHERE l.status = 'activated' AND r.owner_email IS NOT NULL
    `);

    console.log('[Migration 060] license_registration_history created and backfilled successfully.');
  }
};
