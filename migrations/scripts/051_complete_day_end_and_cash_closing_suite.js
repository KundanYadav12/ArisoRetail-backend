/**
 * Migration 051: Complete Day End & Cash Closing Suite
 *
 * Implements:
 *  - business_days                  (Daily business day lifecycle: OPEN, CLOSING, CLOSED, REOPENED)
 *  - day_ends                       (Immutable daily reconciliation snapshot & Z-Report)
 *  - day_end_payment_reconciliations(Mode-by-mode expected vs actual settlement & variance)
 *  - cash_counts                    (Denomination-level physical cash counting)
 *  - Enhances cashier_shifts        (Links cashier shifts to business day, adds cash counted & variance)
 */
module.exports = {
  name: '051_complete_day_end_and_cash_closing_suite',
  async up(connection) {
    console.log('[Migration 051] Starting Complete Day End & Cash Closing Suite migration...');

    // =========================================================================
    // 1. Business Days Table
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS business_days (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        business_date DATE NOT NULL,
        opening_time DATETIME NOT NULL,
        closing_time DATETIME DEFAULT NULL,
        opening_cash_float DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        status ENUM('OPEN', 'CLOSING', 'CLOSED', 'REOPENED_FOR_CORRECTION') NOT NULL DEFAULT 'OPEN',
        opened_by_user_id INT DEFAULT NULL,
        opened_by_name VARCHAR(100) DEFAULT NULL,
        closed_by_user_id INT DEFAULT NULL,
        closed_by_name VARCHAR(100) DEFAULT NULL,
        closed_at DATETIME DEFAULT NULL,
        approval_status ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED',
        approved_by_user_id INT DEFAULT NULL,
        approved_by_name VARCHAR(100) DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        approval_note TEXT DEFAULT NULL,
        reopened_by_user_id INT DEFAULT NULL,
        reopened_by_name VARCHAR(100) DEFAULT NULL,
        reopened_at DATETIME DEFAULT NULL,
        reopen_reason TEXT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_bday_rest_date (restaurant_id, business_date),
        INDEX idx_bday_rest_status (restaurant_id, status),
        INDEX idx_bday_date (business_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 051] Created table "business_days".');

    // =========================================================================
    // 2. Day Ends Table (Final Closing Snapshot & Z Report)
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS day_ends (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        business_day_id INT NOT NULL,
        business_date DATE NOT NULL,
        z_report_number VARCHAR(50) DEFAULT NULL,
        status ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
        
        -- Sales Summary
        gross_sales DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        total_discount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        taxable_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        total_tax DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cgst_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        sgst_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        igst_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        round_off DECIMAL(6, 2) NOT NULL DEFAULT 0.00,
        net_sales DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        
        total_bills INT NOT NULL DEFAULT 0,
        paid_bills INT NOT NULL DEFAULT 0,
        credit_bills INT NOT NULL DEFAULT 0,
        credit_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cancelled_bills INT NOT NULL DEFAULT 0,
        cancelled_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        returned_bills INT NOT NULL DEFAULT 0,
        returned_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        refunded_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        
        -- Cash Reconciliation
        opening_float DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_sales DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        other_cash_in DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_expenses DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_withdrawals DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_transfers_in DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_transfers_out DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        refunds_from_cash DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        expected_cash DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        actual_cash DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_variance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_variance_reason VARCHAR(255) DEFAULT NULL,
        
        -- Digital / Bank Reconciliation
        expected_bank_digital DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        actual_bank_digital DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        digital_variance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        
        -- Expenses
        total_expenses DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        cash_expenses_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        bank_expenses_total DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        
        -- Metadata, Signoff & Approvals
        closing_notes TEXT DEFAULT NULL,
        closed_by_user_id INT DEFAULT NULL,
        closed_by_name VARCHAR(100) DEFAULT NULL,
        closed_at DATETIME DEFAULT NULL,
        requires_approval TINYINT(1) NOT NULL DEFAULT 0,
        approved_by_user_id INT DEFAULT NULL,
        approved_by_name VARCHAR(100) DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        approval_notes TEXT DEFAULT NULL,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_dayend_rest_bday (restaurant_id, business_day_id),
        INDEX idx_dayend_rest_date (restaurant_id, business_date),
        INDEX idx_dayend_zreport (restaurant_id, z_report_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 051] Created table "day_ends".');

    // =========================================================================
    // 3. Day End Payment Reconciliations Table
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS day_end_payment_reconciliations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        day_end_id INT NOT NULL,
        restaurant_id INT NOT NULL,
        payment_mode VARCHAR(50) NOT NULL,
        account_id INT DEFAULT NULL,
        account_name VARCHAR(150) DEFAULT NULL,
        expected_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        actual_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        variance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        variance_reason VARCHAR(255) DEFAULT NULL,
        reference_number VARCHAR(100) DEFAULT NULL,
        settlement_status ENUM('SETTLED', 'PENDING_SETTLEMENT', 'PARTIALLY_SETTLED', 'DISCREPANCY') NOT NULL DEFAULT 'SETTLED',
        settlement_date DATE DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_depr_day_mode (day_end_id, payment_mode),
        INDEX idx_depr_rest (restaurant_id, payment_mode)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 051] Created table "day_end_payment_reconciliations".');

    // =========================================================================
    // 4. Cash Counts Table (Denominations)
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS cash_counts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        business_day_id INT DEFAULT NULL,
        day_end_id INT DEFAULT NULL,
        shift_id INT DEFAULT NULL,
        user_id INT NOT NULL,
        user_name VARCHAR(100) DEFAULT NULL,
        count_type ENUM('SHIFT_CLOSE', 'DAY_END', 'MID_DAY_AUDIT', 'OPENING_FLOAT') NOT NULL DEFAULT 'DAY_END',
        c2000 INT NOT NULL DEFAULT 0,
        c500 INT NOT NULL DEFAULT 0,
        c200 INT NOT NULL DEFAULT 0,
        c100 INT NOT NULL DEFAULT 0,
        c50 INT NOT NULL DEFAULT 0,
        c20 INT NOT NULL DEFAULT 0,
        c10 INT NOT NULL DEFAULT 0,
        c5 INT NOT NULL DEFAULT 0,
        c2 INT NOT NULL DEFAULT 0,
        c1 INT NOT NULL DEFAULT 0,
        coins_total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        total_physical_cash DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cc_rest_bday (restaurant_id, business_day_id),
        INDEX idx_cc_dayend (day_end_id),
        INDEX idx_cc_shift (shift_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 051] Created table "cash_counts".');

    // =========================================================================
    // 5. Enhance cashier_shifts table with shift close & business day columns
    // =========================================================================
    const shiftColumns = [
      { name: 'business_day_id', spec: 'INT DEFAULT NULL AFTER cashier_id' },
      { name: 'cash_counted', spec: 'DECIMAL(10, 2) DEFAULT 0.00 AFTER total_bills' },
      { name: 'cash_variance', spec: 'DECIMAL(10, 2) DEFAULT 0.00 AFTER cash_counted' },
      { name: 'variance_reason', spec: 'VARCHAR(255) DEFAULT NULL AFTER cash_variance' },
      { name: 'handover_to_user_id', spec: 'INT DEFAULT NULL AFTER variance_reason' },
      { name: 'handover_notes', spec: 'TEXT DEFAULT NULL AFTER handover_to_user_id' },
      { name: 'closed_by_user_id', spec: 'INT DEFAULT NULL AFTER handover_notes' }
    ];

    for (const col of shiftColumns) {
      try {
        await connection.query(`ALTER TABLE cashier_shifts ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 051] Added column ${col.name} to cashier_shifts.`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.warn(`[Migration 051] Notice adding cashier_shifts.${col.name}:`, err.message);
        }
      }
    }

    // Index for business_day_id on cashier_shifts
    try {
      await connection.query(`ALTER TABLE cashier_shifts ADD INDEX idx_shift_bday (restaurant_id, business_day_id)`);
    } catch (e) {}

    console.log('[Migration 051] Complete Day End & Cash Closing Suite migration executed successfully.');
  }
};
