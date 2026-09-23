/**
 * Migration 054: Add delivery_challan_id to orders table
 * 
 * Supports complete end-to-end traceability:
 * Sales Order -> Delivery Challan -> Invoice -> Payment/Receivable -> Ledger -> Bank/Cash -> Reports
 */
module.exports = {
  name: '054_add_delivery_challan_id_to_orders',
  async up(connection) {
    console.log('[Migration 054] Adding delivery_challan_id to orders table...');

    try {
      await connection.query('ALTER TABLE orders ADD COLUMN delivery_challan_id INT DEFAULT NULL AFTER parent_order_id');
      console.log('[Migration 054] Added column delivery_challan_id to orders.');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('[Migration 054] Column delivery_challan_id already exists on orders.');
      } else {
        console.warn('[Migration 054] Notice adding orders.delivery_challan_id:', err.message);
      }
    }

    try {
      await connection.query('ALTER TABLE orders ADD INDEX idx_orders_delivery_challan (delivery_challan_id)');
      console.log('[Migration 054] Added index idx_orders_delivery_challan on orders.');
    } catch (e) {
      // index may already exist
    }

    console.log('[Migration 054] Migration complete.');
  },

  async down(connection) {
    try {
      await connection.query('ALTER TABLE orders DROP COLUMN delivery_challan_id');
      console.log('[Migration 054] Dropped column delivery_challan_id from orders.');
    } catch (err) {
      console.warn('[Migration 054] Drop column warning:', err.message);
    }
  }
};
