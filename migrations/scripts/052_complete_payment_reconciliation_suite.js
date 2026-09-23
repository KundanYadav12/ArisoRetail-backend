/**
 * Migration 052: Complete Payment Reconciliation Suite
 *
 * Implements:
 *  - payment_settlements          (Bank and payment gateway payout batches / settlement records)
 *  - settlement_items             (Multi-matching relationship between settlements and POS order payments)
 *  - reconciliation_adjustments   (Audited financial adjustments, fee deductions, shortfalls, chargebacks)
 *  - Indexes for fast multi-tenant queries, references, and date-range lookups
 */
module.exports = {
  name: '052_complete_payment_reconciliation_suite',
  async up(connection) {
    console.log('[Migration 052] Starting Complete Payment Reconciliation Suite migration...');

    // =========================================================================
    // 1. Payment Settlements
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS payment_settlements (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        settlement_number VARCHAR(50) NOT NULL UNIQUE,
        account_id INT NOT NULL,
        payment_mode VARCHAR(50) NOT NULL,
        settlement_date DATE NOT NULL,
        gross_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        tax_on_fee DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        matched_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        unmatched_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        reference_number VARCHAR(100) DEFAULT NULL,
        status ENUM('UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'SETTLED', 'DISCREPANCY', 'REVERSED') NOT NULL DEFAULT 'UNMATCHED',
        notes TEXT DEFAULT NULL,
        idempotency_key VARCHAR(150) DEFAULT NULL UNIQUE,
        created_by_user_id INT DEFAULT NULL,
        created_by_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ps_rest_date (restaurant_id, settlement_date),
        INDEX idx_ps_rest_status (restaurant_id, status),
        INDEX idx_ps_acc (restaurant_id, account_id),
        INDEX idx_ps_ref (restaurant_id, reference_number),
        INDEX idx_ps_idem (restaurant_id, idempotency_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 052] Created table "payment_settlements".');

    // =========================================================================
    // 2. Settlement Items (Matching POS Orders to Settlements)
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS settlement_items (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        settlement_id BIGINT NOT NULL,
        order_id INT DEFAULT NULL,
        order_number VARCHAR(100) DEFAULT NULL,
        financial_transaction_id BIGINT DEFAULT NULL,
        expected_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        settled_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        fee_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        tax_on_fee DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        net_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        variance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        variance_reason VARCHAR(255) DEFAULT NULL,
        match_type ENUM('AUTO_EXACT_REF', 'AUTO_EXACT_AMOUNT', 'AUTO_INVOICE', 'MANUAL_MATCH', 'ADJUSTMENT') NOT NULL DEFAULT 'MANUAL_MATCH',
        notes TEXT DEFAULT NULL,
        reconciled_by_user_id INT DEFAULT NULL,
        reconciled_by_name VARCHAR(100) DEFAULT NULL,
        reconciled_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_si_settle (restaurant_id, settlement_id),
        INDEX idx_si_order (restaurant_id, order_id),
        INDEX idx_si_ft (restaurant_id, financial_transaction_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 052] Created table "settlement_items".');

    // =========================================================================
    // 3. Reconciliation Adjustments
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_adjustments (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        adjustment_number VARCHAR(50) NOT NULL UNIQUE,
        settlement_id BIGINT DEFAULT NULL,
        order_id INT DEFAULT NULL,
        account_id INT NOT NULL,
        adjustment_type ENUM('FEE_DEDUCTION', 'SHORT_SETTLEMENT', 'EXCESS_SETTLEMENT', 'ROUNDING_DIFFERENCE', 'CHARGEBACK', 'OTHER') NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        reason TEXT NOT NULL,
        financial_transaction_id BIGINT DEFAULT NULL,
        user_id INT DEFAULT NULL,
        user_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ra_rest (restaurant_id, created_at),
        INDEX idx_ra_settle (restaurant_id, settlement_id),
        INDEX idx_ra_order (restaurant_id, order_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 052] Created table "reconciliation_adjustments".');

    console.log('[Migration 052] Payment Reconciliation Suite migration completed successfully.');
  },

  async down(connection) {
    await connection.query('DROP TABLE IF EXISTS reconciliation_adjustments;');
    await connection.query('DROP TABLE IF EXISTS settlement_items;');
    await connection.query('DROP TABLE IF EXISTS payment_settlements;');
    console.log('[Migration 052] Rolled back Payment Reconciliation Suite migration.');
  }
};
