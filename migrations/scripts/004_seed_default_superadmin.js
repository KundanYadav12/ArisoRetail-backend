const crypto = require('crypto');
const bcrypt = require('bcryptjs');

module.exports = {
  name: '004_seed_default_superadmin',
  async up(connection) {
    const [existing] = await connection.query(
      'SELECT id, username, email FROM users WHERE role IN ("super_admin", "superadmin") OR email = "kundanyadav96197@gmail.com" OR username = "superadmin"'
    );

    if (existing.length === 0) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      let generatedPass = '';
      const bytes = crypto.randomBytes(8);
      for (let i = 0; i < 8; i++) {
        generatedPass += chars[bytes[i] % chars.length];
      }

      const passwordHash = await bcrypt.hash(generatedPass, 10);

      await connection.query(
        `INSERT INTO users (restaurant_id, name, username, email, password_hash, role, is_active, must_change_password, is_verified)
         VALUES (NULL, 'Super Admin', 'superadmin', 'kundanyadav96197@gmail.com', ?, 'super_admin', 1, 0, 1)`,
        [passwordHash]
      );

      console.log('==================================================');
      console.log('       [DEFAULT SUPER ADMIN INITIALIZED]         ');
      console.log(' Username: superadmin');
      console.log(' Email:    kundanyadav96197@gmail.com');
      console.log(` Password: ${generatedPass}`);
      console.log(' (Stored exclusively as bcrypt hash in MySQL database)');
      console.log('==================================================');
    }
  }
};
