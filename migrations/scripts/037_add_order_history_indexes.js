/**
 * Migration 037: Add performance indexes to orders table
 * Boosts multi-tenant lookup, sorting, and pagination on order history queries.
 */
module.exports = {
  name: '037_add_order_history_indexes',
  async up(connection) {
    console.log('[Migration 037] Adding performance indexes to orders table...');

    const indexes = [
      { name: 'idx_orders_restaurant_uon', cols: '(restaurant_id, unique_order_number)' },
      { name: 'idx_orders_restaurant_created', cols: '(restaurant_id, created_at)' },
      { name: 'idx_orders_restaurant_status', cols: '(restaurant_id, order_status)' },
      { name: 'idx_orders_restaurant_pmode', cols: '(restaurant_id, payment_mode)' }
    ];

    for (const idx of indexes) {
      try {
        await connection.query(`ALTER TABLE orders ADD INDEX ${idx.name} ${idx.cols}`);
        console.log(`[Migration 037] Successfully added index "${idx.name}".`);
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME') {
          console.log(`[Migration 037] Index "${idx.name}" already exists on orders table.`);
        } else {
          console.error(`[Migration 037] Error adding index "${idx.name}":`, err.message);
          throw err;
        }
      }
    }
  }
};
