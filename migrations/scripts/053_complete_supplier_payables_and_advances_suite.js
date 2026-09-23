/**
 * Migration 053: Complete Supplier Payables and Advances Suite
 *
 * Implements:
 *  - supplier_payment_allocations  (Multi-bill settlement allocation breakdown)
 *  - supplier_payments extensions  (account_id, advance_amount, is_advance)
 *  - suppliers extensions          (supplier_code, advance_balance)
 *  - supplier_ledger extensions    (support SUPPLIER_ADVANCE and ADVANCE_ADJUSTMENT)
 *  - Performance indexes for fast supplier outstanding, overdue, and ledger queries
 */
module.exports = {
  name: '053_complete_supplier_payables_and_advances_suite',
  async up(connection) {
    console.log('[Migration 053] Starting Complete Supplier Payables and Advances Suite migration...');

    // Helper to safely add column if not exists
    const addColumnSafe = async (table, column, spec) => {
      try {
        const [rows] = await connection.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
        `, [table, column]);
        if (rows.length === 0) {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${spec}`);
          console.log(`[Migration 053] Added column ${table}.${column}`);
        }
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.warn(`[Migration 053] Warning adding ${table}.${column}:`, err.message);
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
          console.log(`[Migration 053] Added index ${indexName} to ${table}`);
        }
      } catch (err) {
        console.warn(`[Migration 053] Warning adding index ${indexName}:`, err.message);
      }
    };

    // =========================================================================
    // 1. Supplier Payment Allocations Table
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        supplier_payment_id INT NOT NULL,
        purchase_bill_id INT NOT NULL,
        allocated_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        notes VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_spa_pay (supplier_payment_id),
        INDEX idx_spa_bill (purchase_bill_id),
        INDEX idx_spa_rest (restaurant_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 053] Created table "supplier_payment_allocations".');

    // =========================================================================
    // 2. Extend supplier_payments table
    // =========================================================================
    await addColumnSafe('supplier_payments', 'account_id', 'INT DEFAULT NULL AFTER purchase_bill_id');
    await addColumnSafe('supplier_payments', 'advance_amount', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER amount');
    await addColumnSafe('supplier_payments', 'is_advance', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER advance_amount');
    await addIndexSafe('supplier_payments', 'idx_sp_paymode', 'restaurant_id, payment_mode, payment_date');

    // =========================================================================
    // 3. Extend suppliers table
    // =========================================================================
    await addColumnSafe('suppliers', 'supplier_code', 'VARCHAR(50) DEFAULT NULL AFTER id');
    await addColumnSafe('suppliers', 'advance_balance', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER current_balance');
    await addIndexSafe('suppliers', 'idx_supp_code', 'restaurant_id, supplier_code');

    // Populate missing supplier_codes with SUPP-0001 format
    try {
      await connection.query(`
        UPDATE suppliers 
        SET supplier_code = CONCAT('SUPP-', LPAD(id, 4, '0')) 
        WHERE supplier_code IS NULL OR supplier_code = ''
      `);
      console.log('[Migration 053] Populated default supplier_code values.');
    } catch (scErr) {
      console.warn('[Migration 053] supplier_code population note:', scErr.message);
    }

    // =========================================================================
    // 4. Extend supplier_ledger table
    // =========================================================================
    try {
      await connection.query(`
        ALTER TABLE supplier_ledger 
        MODIFY COLUMN transaction_type ENUM(
          'PURCHASE_BILL', 
          'PAYMENT', 
          'PURCHASE_RETURN', 
          'OPENING_BALANCE', 
          'ADJUSTMENT', 
          'SUPPLIER_ADVANCE', 
          'ADVANCE_ADJUSTMENT'
        ) NOT NULL
      `);
      console.log('[Migration 053] Expanded supplier_ledger transaction_type ENUM.');
    } catch (enumErr) {
      console.warn('[Migration 053] Note on supplier_ledger ENUM update:', enumErr.message);
    }

    // =========================================================================
    // 5. Extend purchase_bills table & indexes
    // =========================================================================
    await addIndexSafe('purchase_bills', 'idx_pb_supp_status_due', 'restaurant_id, supplier_id, payment_status, due_date');

    console.log('[Migration 053] Complete Supplier Payables and Advances Suite migration completed successfully.');
  }
};
