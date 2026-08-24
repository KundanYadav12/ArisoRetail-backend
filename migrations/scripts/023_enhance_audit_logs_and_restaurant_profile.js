module.exports = {
  name: '023_enhance_audit_logs_and_restaurant_profile',
  async up(connection) {
    // 1. Add missing audit log detail columns if not present
    const columnsToAdd = [
      { name: 'user_name', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'user_role', type: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'prev_name', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'new_name', type: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'prev_logo', type: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'new_logo', type: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'metadata', type: 'JSON DEFAULT NULL' }
    ];

    for (const col of columnsToAdd) {
      try {
        await connection.query(`ALTER TABLE audit_logs ADD COLUMN ${col.name} ${col.type}`);
      } catch (err) {
        if (!err.message.includes('Duplicate column name')) {
          console.warn(`[Migration 023 Warning] Column ${col.name}:`, err.message);
        }
      }
    }

    // 2. Ensure logo_url column exists in receipt_settings
    try {
      await connection.query('ALTER TABLE receipt_settings ADD COLUMN logo_url VARCHAR(255) DEFAULT NULL');
    } catch (err) {
      if (!err.message.includes('Duplicate column name')) {
        console.warn('[Migration 023 Warning] receipt_settings logo_url:', err.message);
      }
    }

    console.log('[Migration 023] Enhanced audit_logs & receipt_settings schema successfully.');
  }
};
