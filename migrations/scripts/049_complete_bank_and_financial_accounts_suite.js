/**
 * Migration 049: Complete Bank and Financial Accounts Suite
 *
 * Implements:
 *  - financial_accounts         (Cash, Bank, Current, Savings, Wallet accounts)
 *  - payment_account_mappings   (Payment mode -> Financial account mapping)
 *  - financial_transactions     (Immutable double-entry-safe account transaction ledger)
 *  - account_transfers          (Inter-account contra transfers)
 *  - expenses                   (Business expense vouchers and categorization)
 *  - Seeds default Cash Drawer account and mappings for existing restaurants
 */
module.exports = {
  name: '049_complete_bank_and_financial_accounts_suite',
  async up(connection) {
    console.log('[Migration 049] Starting Complete Bank & Financial Accounts Suite migration...');

    // =========================================================================
    // 1. Financial Accounts
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS financial_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        account_name VARCHAR(150) NOT NULL,
        bank_name VARCHAR(150) DEFAULT NULL,
        account_number VARCHAR(100) DEFAULT NULL,
        account_type ENUM('cash', 'bank', 'current', 'savings', 'wallet', 'other') NOT NULL DEFAULT 'bank',
        ifsc_code VARCHAR(20) DEFAULT NULL,
        branch_name VARCHAR(150) DEFAULT NULL,
        opening_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        opening_balance_date DATE DEFAULT NULL,
        current_balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_default TINYINT(1) NOT NULL DEFAULT 0,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_fa_rest (restaurant_id, is_active),
        INDEX idx_fa_type (restaurant_id, account_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 049] Created table "financial_accounts".');

    // =========================================================================
    // 2. Payment Mode -> Account Mappings
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS payment_account_mappings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        payment_mode VARCHAR(50) NOT NULL,
        account_id INT NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_rest_paymode (restaurant_id, payment_mode),
        INDEX idx_pam_acc (restaurant_id, account_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 049] Created table "payment_account_mappings".');

    // =========================================================================
    // 3. Financial Transactions Ledger
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS financial_transactions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        account_id INT NOT NULL,
        transaction_type ENUM(
          'OPENING_BALANCE', 'SALE_RECEIPT', 'CUSTOMER_PAYMENT',
          'SUPPLIER_PAYMENT', 'PURCHASE_PAYMENT', 'EXPENSE_PAYMENT',
          'ACCOUNT_TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
          'REFUND', 'OTHER_INCOME', 'OTHER_EXPENSE'
        ) NOT NULL,
        reference_type VARCHAR(50) NOT NULL,
        reference_id VARCHAR(100) DEFAULT NULL,
        reference_number VARCHAR(100) DEFAULT NULL,
        payment_mode VARCHAR(50) DEFAULT NULL,
        party_type ENUM('customer', 'supplier', 'bank', 'other') DEFAULT NULL,
        party_id INT DEFAULT NULL,
        party_name VARCHAR(150) DEFAULT NULL,
        amount_in DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        amount_out DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        balance_after DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        description TEXT DEFAULT NULL,
        reconciled TINYINT(1) NOT NULL DEFAULT 0,
        reconciled_at DATETIME DEFAULT NULL,
        reconciliation_ref VARCHAR(100) DEFAULT NULL,
        user_id INT DEFAULT NULL,
        user_name VARCHAR(100) DEFAULT NULL,
        idempotency_key VARCHAR(150) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ft_acc (restaurant_id, account_id, created_at),
        INDEX idx_ft_ref (restaurant_id, reference_type, reference_id),
        INDEX idx_ft_idem (restaurant_id, idempotency_key),
        INDEX idx_ft_type (restaurant_id, transaction_type),
        INDEX idx_ft_recon (restaurant_id, account_id, reconciled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 049] Created table "financial_transactions".');

    // =========================================================================
    // 4. Inter-Account Contra Transfers
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS account_transfers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        transfer_number VARCHAR(50) NOT NULL UNIQUE,
        from_account_id INT NOT NULL,
        to_account_id INT NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        transfer_date DATE NOT NULL,
        reference_number VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_by_user_id INT DEFAULT NULL,
        created_by_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_at_rest (restaurant_id, transfer_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 049] Created table "account_transfers".');

    // =========================================================================
    // 5. Expenses
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        expense_number VARCHAR(50) NOT NULL UNIQUE,
        category VARCHAR(100) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        account_id INT NOT NULL,
        payment_mode VARCHAR(50) NOT NULL DEFAULT 'cash',
        expense_date DATE NOT NULL,
        payee VARCHAR(150) DEFAULT NULL,
        reference_number VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_by_user_id INT DEFAULT NULL,
        created_by_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_exp_rest (restaurant_id, expense_date),
        INDEX idx_exp_cat (restaurant_id, category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 049] Created table "expenses".');

    // =========================================================================
    // 6. Seed Default Cash Account & Default Payment Mappings
    // =========================================================================
    const [restaurants] = await connection.query('SELECT id, name FROM restaurants');
    for (const rest of restaurants) {
      const restId = rest.id;
      // Check if cash account exists
      const [existingCash] = await connection.query(
        "SELECT id FROM financial_accounts WHERE restaurant_id = ? AND account_type = 'cash' LIMIT 1",
        [restId]
      );

      let cashAccountId;
      if (existingCash.length === 0) {
        const [insertRes] = await connection.query(`
          INSERT INTO financial_accounts (
            restaurant_id, account_name, bank_name, account_type,
            opening_balance, current_balance, is_active, is_default, notes
          ) VALUES (?, 'Main Cash Drawer', 'Cash Drawer', 'cash', 0.00, 0.00, 1, 1, 'Default Cash Drawer account')
        `, [restId]);
        cashAccountId = insertRes.insertId;
        console.log(`[Migration 049] Seeded default cash account #${cashAccountId} for restaurant #${restId}.`);
      } else {
        cashAccountId = existingCash[0].id;
      }

      // Ensure 'cash' payment mode maps to cashAccountId
      await connection.query(`
        INSERT IGNORE INTO payment_account_mappings (restaurant_id, payment_mode, account_id, is_active)
        VALUES (?, 'cash', ?, 1)
      `, [restId, cashAccountId]);
    }

    console.log('[Migration 049] Complete Bank & Financial Accounts Suite migration executed successfully.');
  }
};
