const pool = require('../../config/db');

module.exports = {
  name: '016_fix_users_email_unique_constraint',
  up: async () => {
    try {
      // 1. Drop global uq_users_email index if it exists
      try {
        await pool.query('ALTER TABLE users DROP INDEX uq_users_email');
        console.log('[Migration 016] Dropped global uq_users_email index.');
      } catch (e) {
        console.log('[Migration 016] Index uq_users_email was not present or already dropped.');
      }

      // 2. Add composite tenant unique index on (restaurant_id, email)
      try {
        await pool.query('ALTER TABLE users ADD UNIQUE KEY uq_rest_email (restaurant_id, email)');
        console.log('[Migration 016] Added composite uq_rest_email (restaurant_id, email) index.');
      } catch (e) {
        console.log('[Migration 016] Index uq_rest_email already exists.');
      }

      // 3. Fix auto-suffixed email addresses in users table
      await pool.query(`
        UPDATE users u 
        JOIN restaurants r ON u.restaurant_id = r.id 
        SET u.email = r.owner_email 
        WHERE u.role = 'admin' 
          AND r.owner_email IS NOT NULL 
          AND u.email LIKE '%\\_%@%'
      `);
      console.log('[Migration 016] Restored owner email addresses in users table.');
    } catch (err) {
      console.warn('[Migration 016 Warning]', err.message);
    }
  }
};
