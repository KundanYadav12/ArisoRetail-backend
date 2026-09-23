/**
 * Migration 050: Complete Expense Management Suite
 *
 * Implements:
 *  - expense_categories      (Customizable Expense Heads / Categories)
 *  - Alters expenses table   (Status, Tax/GST, Attachments, Supplier link, Employee link)
 *  - expense_claims          (Employee Expense Reimbursement Workflow)
 *  - Seeds standard retail categories for all restaurants
 */
module.exports = {
  name: '050_complete_expense_management_suite',
  async up(connection) {
    console.log('[Migration 050] Starting Complete Expense Management Suite migration...');

    // =========================================================================
    // 1. Expense Categories / Heads
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(50) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by_user_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_rest_expcat (restaurant_id, name),
        INDEX idx_ec_rest (restaurant_id, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 050] Created table "expense_categories".');

    // =========================================================================
    // 2. Alter Expenses Table (Add missing columns for status, tax, attachments)
    // =========================================================================
    const expenseColumns = [
      { name: 'category_id', spec: 'INT DEFAULT NULL AFTER category' },
      { name: 'status', spec: "ENUM('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED') NOT NULL DEFAULT 'POSTED' AFTER category_id" },
      { name: 'supplier_id', spec: 'INT DEFAULT NULL AFTER payee' },
      { name: 'employee_user_id', spec: 'INT DEFAULT NULL AFTER supplier_id' },
      { name: 'employee_name', spec: 'VARCHAR(100) DEFAULT NULL AFTER employee_user_id' },
      { name: 'taxable_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00 AFTER amount' },
      { name: 'gst_rate', spec: 'DECIMAL(5,2) DEFAULT 0.00 AFTER taxable_amount' },
      { name: 'cgst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00 AFTER gst_rate' },
      { name: 'sgst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00 AFTER cgst_amount' },
      { name: 'igst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00 AFTER sgst_amount' },
      { name: 'tax_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00 AFTER igst_amount' },
      { name: 'total_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00 AFTER tax_amount' },
      { name: 'tax_inclusive', spec: 'TINYINT(1) DEFAULT 0 AFTER total_amount' },
      { name: 'attachment_url', spec: 'VARCHAR(255) DEFAULT NULL AFTER notes' },
      { name: 'attachment_name', spec: 'VARCHAR(255) DEFAULT NULL AFTER attachment_url' },
      { name: 'attachment_type', spec: 'VARCHAR(50) DEFAULT NULL AFTER attachment_name' },
      { name: 'financial_transaction_id', spec: 'BIGINT DEFAULT NULL AFTER attachment_type' },
      { name: 'cancelled_at', spec: 'DATETIME DEFAULT NULL AFTER financial_transaction_id' },
      { name: 'cancelled_by_user_id', spec: 'INT DEFAULT NULL AFTER cancelled_at' },
      { name: 'cancelled_reason', spec: 'TEXT DEFAULT NULL AFTER cancelled_by_user_id' },
      { name: 'updated_at', spec: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at' }
    ];

    for (const col of expenseColumns) {
      try {
        await connection.query(`ALTER TABLE expenses ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 050] Added column ${col.name} to expenses.`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.warn(`[Migration 050] Warning on expenses.${col.name}:`, err.message);
        }
      }
    }

    // Initialize total_amount = amount where total_amount is 0 or null
    try {
      await connection.query('UPDATE expenses SET total_amount = amount, taxable_amount = amount WHERE total_amount = 0.00 OR total_amount IS NULL');
    } catch (e) {}

    // =========================================================================
    // 3. Employee Expense Reimbursement Claims
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS expense_claims (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        claim_number VARCHAR(50) NOT NULL UNIQUE,
        employee_user_id INT NOT NULL,
        employee_name VARCHAR(100) NOT NULL,
        expense_date DATE NOT NULL,
        category_id INT DEFAULT NULL,
        category_name VARCHAR(100) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        tax_amount DECIMAL(12, 2) DEFAULT 0.00,
        total_amount DECIMAL(12, 2) NOT NULL,
        description TEXT DEFAULT NULL,
        proof_attachment_url VARCHAR(255) DEFAULT NULL,
        proof_attachment_name VARCHAR(255) DEFAULT NULL,
        status ENUM('DRAFT', 'SUBMITTED', 'REVIEWED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REIMBURSED', 'CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
        reviewed_by_user_id INT DEFAULT NULL,
        reviewed_by_name VARCHAR(100) DEFAULT NULL,
        reviewed_at DATETIME DEFAULT NULL,
        approved_by_user_id INT DEFAULT NULL,
        approved_by_name VARCHAR(100) DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        rejection_reason TEXT DEFAULT NULL,
        reimbursed_at DATETIME DEFAULT NULL,
        reimbursement_account_id INT DEFAULT NULL,
        reimbursement_payment_mode VARCHAR(50) DEFAULT NULL,
        reimbursement_financial_tx_id BIGINT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_eclaim_rest (restaurant_id, employee_user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 050] Created table "expense_claims".');

    // Ensure financial_transactions party_type supports employee
    try {
      await connection.query(`
        ALTER TABLE financial_transactions 
        MODIFY COLUMN party_type ENUM('customer', 'supplier', 'bank', 'employee', 'other') DEFAULT NULL
      `);
    } catch (e) {}

    // =========================================================================
    // 4. Seed Standard Retail Expense Categories
    // =========================================================================
    const defaultCategories = [
      { name: 'Rent', code: 'EXP-RENT', description: 'Store, warehouse, or office rent' },
      { name: 'Electricity', code: 'EXP-ELEC', description: 'Power and utility bills' },
      { name: 'Internet & Telephone', code: 'EXP-COMM', description: 'Broadband, Wi-Fi, landline and mobile bills' },
      { name: 'Salaries & Wages', code: 'EXP-SAL', description: 'Staff payroll, cashier allowances, overtime' },
      { name: 'Office Expenses', code: 'EXP-OFF', description: 'Stationery, printing, consumables' },
      { name: 'Transport & Freight', code: 'EXP-TRN', description: 'Delivery van, goods transport, courier' },
      { name: 'Fuel', code: 'EXP-FUEL', description: 'Vehicle fuel and travel conveyance' },
      { name: 'Repairs & Maintenance', code: 'EXP-REP', description: 'Equipment, AC, POS hardware, electrical repairs' },
      { name: 'Marketing & Advertising', code: 'EXP-MKT', description: 'Pamphlets, local ads, promotions' },
      { name: 'Packaging', code: 'EXP-PKG', description: 'Carry bags, boxes, wrapping materials' },
      { name: 'Cleaning & Housekeeping', code: 'EXP-CLN', description: 'Detergents, sanitizers, pest control' },
      { name: 'Professional Fees', code: 'EXP-PRO', description: 'CA, auditor, legal, accounting charges' },
      { name: 'Bank Charges', code: 'EXP-BNK', description: 'POS swipe machine fees, bank charges' },
      { name: 'Delivery Charges', code: 'EXP-DEL', description: 'Third-party delivery and rider charges' },
      { name: 'Miscellaneous', code: 'EXP-MISC', description: 'Tea, coffee, daily contingencies' }
    ];

    const [restaurants] = await connection.query('SELECT id FROM restaurants');
    for (const rest of restaurants) {
      for (const cat of defaultCategories) {
        await connection.query(`
          INSERT IGNORE INTO expense_categories (restaurant_id, name, code, description, is_active)
          VALUES (?, ?, ?, ?, 1)
        `, [rest.id, cat.name, cat.code, cat.description]);
      }
    }

    console.log('[Migration 050] Seeded standard expense categories for all restaurants.');
  }
};
