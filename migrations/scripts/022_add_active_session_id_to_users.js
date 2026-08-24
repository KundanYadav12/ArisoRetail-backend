module.exports = {
  name: '022_add_active_session_id_to_users',
  async up(connection) {
    try {
      await connection.query(
        "ALTER TABLE users ADD COLUMN active_session_id VARCHAR(255) DEFAULT NULL"
      );
      console.log('[Migration 022] Added column active_session_id to users table.');
    } catch (err) {
      if (!err.message.includes('Duplicate column')) {
        console.warn('[Migration 022] active_session_id:', err.message);
      }
    }
  }
};
