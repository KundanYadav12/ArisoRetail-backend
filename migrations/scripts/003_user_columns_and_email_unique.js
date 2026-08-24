module.exports = {
  name: '003_user_columns_and_email_unique',
  async up(connection) {
    // 1. Ensure user table columns exist
    const userColumns = [
      { name: 'must_change_password', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'is_verified', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'verified_at', spec: 'DATETIME DEFAULT NULL' },
      { name: 'temp_password', spec: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'last_login_at', spec: 'DATETIME DEFAULT NULL' }
    ];

    for (const col of userColumns) {
      try {
        await connection.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.spec}`);
      } catch (err) {
        // Ignored if column already exists
      }
    }

    // 2. Ensure email unique constraint on users table
    try {
      await connection.query('ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email)');
    } catch (err) {
      // Ignored if constraint already exists
    }
  }
};
