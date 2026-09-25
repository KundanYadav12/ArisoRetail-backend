/**
 * Migration 057: Complete Customer Receivables and Credit Sale Workflow
 * 
 * Supports Petpooja-aligned connected lifecycle for:
 * POS Credit / Udhar Sales, Invoices, Customer Payments, Multi-Invoice Allocations,
 * Outstanding Balances, Customer Advance/Credit, and Due Date Tracking.
 */
module.exports = {
  name: '057_complete_customer_receivables_and_credit_sale_workflow',
  async up(connection) {
    console.log('[Migration 057] Starting Customer Receivables & Credit Sale migration...');

    // Helper to safely add column if not exists
    const addColumnSafe = async (table, column, spec) => {
      try {
        const [rows] = await connection.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
        `, [table, column]);
        if (rows.length === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${spec}`);
          console.log(`[Migration 057] Added column ${table}.${column}`);
        }
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.warn(`[Migration 057] Warning adding ${table}.${column}:`, err.message);
        }
      }
    };

    // Helper to safely add index if not exists
    const addIndexSafe = async (table, indexName, columns) => {
      try {
        const [rows] = await connection.query(`
          SELECT index_name FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
        `, [table, indexName]);
        if (rows.length === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (${columns})`);
          console.log(`[Migration 057] Added index ${indexName} to ${table}`);
        }
      } catch (err) {
        console.warn(`[Migration 057] Warning adding index ${indexName}:`, err.message);
      }
    };

    // 1. Extend orders table with paid_amount, due_date, advance_amount
    await addColumnSafe('orders', 'paid_amount', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER total_amount');
    await addColumnSafe('orders', 'due_date', 'DATE DEFAULT NULL AFTER delivery_date');
    await addColumnSafe('orders', 'advance_amount', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER paid_amount');

    // Modify payment_status to VARCHAR(30) to allow descriptive statuses ('unpaid', 'partially_paid', 'completed', 'paid', 'pending')
    try {
      await connection.query(`ALTER TABLE orders MODIFY COLUMN payment_status VARCHAR(30) NOT NULL DEFAULT 'completed'`);
      console.log('[Migration 057] Updated orders.payment_status to VARCHAR(30)');
    } catch (e) {
      console.warn('[Migration 057] Notice modifying payment_status:', e.message);
    }

    await addIndexSafe('orders', 'idx_orders_cust_paystatus', 'restaurant_id, customer_id, payment_status');
    await addIndexSafe('orders', 'idx_orders_due_date', 'restaurant_id, due_date');

    // 2. Extend customers table with credit_days, allow_credit, advance_balance
    await addColumnSafe('customers', 'credit_days', 'INT NOT NULL DEFAULT 30 AFTER credit_limit');
    await addColumnSafe('customers', 'allow_credit', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER credit_days');
    await addColumnSafe('customers', 'advance_balance', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER current_balance');

    // 3. Create customer_payments table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_payments (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        payment_number VARCHAR(50) NOT NULL,
        customer_id INT NOT NULL,
        order_id INT DEFAULT NULL,
        payment_date DATE NOT NULL,
        amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        allocated_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        advance_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        payment_mode VARCHAR(50) NOT NULL DEFAULT 'cash',
        account_id INT DEFAULT NULL,
        reference_number VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_by_user_id INT DEFAULT NULL,
        created_by_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cp_rest_cust (restaurant_id, customer_id),
        INDEX idx_cp_date (restaurant_id, payment_date),
        INDEX idx_cp_number (restaurant_id, payment_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 057] Created table "customer_payments".');

    // 4. Create customer_payment_allocations table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_payment_allocations (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        payment_id BIGINT NOT NULL,
        order_id INT NOT NULL,
        allocated_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        notes VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cpa_payment (restaurant_id, payment_id),
        INDEX idx_cpa_order (restaurant_id, order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 057] Created table "customer_payment_allocations".');

    // 5. Initialize historical data for orders
    try {
      // Historical paid orders: paid_amount = total_amount
      await connection.query(`
        UPDATE orders 
        SET paid_amount = total_amount, payment_status = 'completed'
        WHERE order_status = 'completed' 
          AND (payment_mode NOT IN ('credit', 'due') OR payment_mode IS NULL)
          AND paid_amount = 0.00 
          AND total_amount > 0.00
      `);

      // Historical credit orders: paid_amount = 0.00, payment_status = 'unpaid'
      await connection.query(`
        UPDATE orders 
        SET paid_amount = 0.00, payment_status = 'unpaid'
        WHERE order_status = 'completed' 
          AND payment_mode IN ('credit', 'due')
          AND paid_amount = 0.00
      `);
      console.log('[Migration 057] Historical orders data initialized for receivables.');
    } catch (initErr) {
      console.warn('[Migration 057] Notice initializing historical orders:', initErr.message);
    }

    console.log('[Migration 057] Customer Receivables & Credit Sale migration completed successfully.');
  },

  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS customer_payment_allocations');
    await connection.query('DROP TABLE IF EXISTS customer_payments');
  }
};
