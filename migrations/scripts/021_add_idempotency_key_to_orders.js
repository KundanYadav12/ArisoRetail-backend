module.exports = {
  name: '021_add_idempotency_key_to_orders',
  async up(connection) {
    // Add idempotency_key column to orders table for safe offline order synchronization
    try {
      await connection.query(
        "ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(100) DEFAULT NULL AFTER unique_order_number"
      );
      console.log('[Migration 021] Added column idempotency_key to orders.');
    } catch (err) {
      if (!err.message.includes('Duplicate column')) {
        console.warn('[Migration 021] idempotency_key:', err.message);
      }
    }

    // Add unique index on (restaurant_id, idempotency_key) to enforce server-side duplicate protection
    try {
      await connection.query(
        "ALTER TABLE orders ADD UNIQUE INDEX idx_restaurant_idempotency (restaurant_id, idempotency_key)"
      );
      console.log('[Migration 021] Created unique index idx_restaurant_idempotency on orders table.');
    } catch (err) {
      if (!err.message.includes('Duplicate key') && !err.message.includes('already exists')) {
        console.warn('[Migration 021] Index creation:', err.message);
      }
    }
  }
};
