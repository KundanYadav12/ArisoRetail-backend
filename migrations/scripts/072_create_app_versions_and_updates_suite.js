/**
 * Migration 072: Centralized Application Version Management & Auto Updates Suite
 * Supports separate tracking and management for Windows Desktop and Mobile applications.
 */

exports.up = async function(connection) {
  console.log('[Migration 072] Creating app_versions table...');

  await connection.query(`
    CREATE TABLE IF NOT EXISTS app_versions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      platform ENUM('windows', 'mobile', 'android', 'ios') NOT NULL,
      version VARCHAR(50) NOT NULL,
      version_code INT NOT NULL DEFAULT 1,
      title VARCHAR(255) NOT NULL DEFAULT 'Ariso Retail POS Update',
      release_notes TEXT,
      update_instructions TEXT,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_mandatory TINYINT(1) NOT NULL DEFAULT 0,
      min_supported_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
      download_url VARCHAR(1000) NULL,
      file_name VARCHAR(255) NULL,
      file_size BIGINT NOT NULL DEFAULT 0,
      checksum_sha256 VARCHAR(128) NULL,
      package_type ENUM('installer_exe', 'apk', 'store_redirect', 'zip') NOT NULL DEFAULT 'installer_exe',
      download_count INT NOT NULL DEFAULT 0,
      created_by INT NULL,
      published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_platform_version (platform, version),
      INDEX idx_platform_active (platform, is_active, published_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Seed baseline published versions for Windows and Mobile if not exists
  const [existingWindows] = await connection.query(
    'SELECT id FROM app_versions WHERE platform = "windows" LIMIT 1'
  );
  if (existingWindows.length === 0) {
    await connection.query(`
      INSERT INTO app_versions (
        platform, version, version_code, title, release_notes,
        is_active, is_mandatory, min_supported_version,
        download_url, file_name, file_size, package_type, published_at
      ) VALUES (
        'windows', '1.0.0', 100, 'Ariso Retail POS v1.0.0 (Windows)',
        '• Initial production release with high-speed thermal billing.\n• ESC/POS native printer spooling & barcode scanner support.\n• Full offline Dexie cache & cloud sync engine.\n• Complete SuperBill and inventory management.',
        1, 0, '1.0.0',
        '/uploads/updates/Ariso_Retail_POS_Setup_1.0.0.exe', 'Ariso Retail POS Setup 1.0.0.exe', 105135387, 'installer_exe', NOW()
      )
    `);
    console.log('[Migration 072] Seeded baseline Windows version 1.0.0.');
  }

  const [existingMobile] = await connection.query(
    'SELECT id FROM app_versions WHERE platform = "mobile" LIMIT 1'
  );
  if (existingMobile.length === 0) {
    await connection.query(`
      INSERT INTO app_versions (
        platform, version, version_code, title, release_notes,
        is_active, is_mandatory, min_supported_version,
        download_url, file_name, file_size, package_type, published_at
      ) VALUES (
        'mobile', '1.0.0', 100, 'Ariso Retail POS v1.0.0 (Mobile)',
        '• Initial mobile release with mobile counter POS.\n• Bluetooth thermal receipt printer integration.\n• Real-time stock lookups & cloud sync.',
        1, 0, '1.0.0',
        '/uploads/updates/app-release.apk', 'app-release.apk', 86596648, 'apk', NOW()
      )
    `);
    console.log('[Migration 072] Seeded baseline Mobile version 1.0.0.');
  }

  console.log('[Migration 072] Successfully completed Application Version Management schema.');
};

exports.down = async function(connection) {
  await connection.query('DROP TABLE IF EXISTS app_versions;');
};
