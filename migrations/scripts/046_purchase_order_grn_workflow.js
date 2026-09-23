/**
 * Migration 046: Purchase Order GRN Workflow
 *
 * Adds:
 *  - goods_received_notes      (GRN header)
 *  - goods_received_note_items (GRN line items)
 *  - supplier_ledger           (immutable journal for supplier payables)
 *  - supplier_payments         (payment records against bills)
 *
 * Alters:
 *  - purchase_orders           ADD: reference_number, approved_by_*, cancelled_by_*, sent_at
 *  - purchase_order_items      ADD: billed_qty
 *  - purchase_bills            ADD: grn_id, supplier_ledger_id
 *  - purchase_returns          ADD: tax_rate, tax_amount, discount_amount per item
 */
module.exports = {
  name: '046_purchase_order_grn_workflow',
  async up(connection) {
    console.log('[Migration 046] Starting Purchase Order GRN Workflow migration...');

    // =========================================================================
    // 1. Goods Received Notes (GRN Header)
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS goods_received_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        grn_number VARCHAR(50) NOT NULL UNIQUE,
        purchase_order_id INT NOT NULL,
        supplier_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        grn_date DATE NOT NULL,
        status ENUM('draft', 'confirmed', 'cancelled') DEFAULT 'confirmed',
        total_ordered_qty DECIMAL(10,3) DEFAULT 0.000,
        total_received_qty DECIMAL(10,3) DEFAULT 0.000,
        total_accepted_qty DECIMAL(10,3) DEFAULT 0.000,
        total_rejected_qty DECIMAL(10,3) DEFAULT 0.000,
        total_damaged_qty DECIMAL(10,3) DEFAULT 0.000,
        vehicle_number VARCHAR(50) DEFAULT NULL,
        driver_name VARCHAR(100) DEFAULT NULL,
        invoice_number VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_by_user_id INT NOT NULL,
        created_by_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_grn_rest (restaurant_id, status),
        INDEX idx_grn_po (purchase_order_id),
        INDEX idx_grn_date (restaurant_id, grn_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 046] Created table "goods_received_notes".');

    // =========================================================================
    // 2. Goods Received Note Items
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS goods_received_note_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        grn_id INT NOT NULL,
        purchase_order_item_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'pcs',
        ordered_qty DECIMAL(10,3) NOT NULL,
        previously_received_qty DECIMAL(10,3) DEFAULT 0.000,
        received_qty DECIMAL(10,3) NOT NULL,
        accepted_qty DECIMAL(10,3) NOT NULL,
        rejected_qty DECIMAL(10,3) DEFAULT 0.000,
        damaged_qty DECIMAL(10,3) DEFAULT 0.000,
        rate DECIMAL(10,2) NOT NULL,
        tax_rate DECIMAL(5,2) DEFAULT 0.00,
        batch_number VARCHAR(100) DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        INDEX idx_grni_grn (grn_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 046] Created table "goods_received_note_items".');

    // =========================================================================
    // 3. Supplier Ledger (immutable journal — mirrors customer_ledger)
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS supplier_ledger (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        supplier_id INT NOT NULL,
        transaction_type ENUM('PURCHASE_BILL', 'PAYMENT', 'PURCHASE_RETURN', 'OPENING_BALANCE', 'ADJUSTMENT') NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        balance_after DECIMAL(12,2) NOT NULL,
        reference_type VARCHAR(50) DEFAULT NULL,
        reference_id INT DEFAULT NULL,
        reference_number VARCHAR(100) DEFAULT NULL,
        payment_mode VARCHAR(50) DEFAULT NULL,
        user_id INT DEFAULT NULL,
        user_name VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sl_supp_date (restaurant_id, supplier_id, created_at),
        INDEX idx_sl_type (restaurant_id, transaction_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 046] Created table "supplier_ledger".');

    // =========================================================================
    // 4. Supplier Payments
    // =========================================================================
    await connection.query(`
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        payment_number VARCHAR(50) NOT NULL UNIQUE,
        supplier_id INT NOT NULL,
        purchase_bill_id INT DEFAULT NULL,
        payment_date DATE NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        payment_mode VARCHAR(50) NOT NULL DEFAULT 'Bank Transfer',
        reference_number VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_by_user_id INT DEFAULT NULL,
        created_by_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sp_rest (restaurant_id, supplier_id),
        INDEX idx_sp_bill (purchase_bill_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 046] Created table "supplier_payments".');

    // =========================================================================
    // 5. Alter purchase_orders — add workflow tracking columns
    // =========================================================================
    const poColumns = [
      { name: 'reference_number',     spec: 'VARCHAR(100) DEFAULT NULL AFTER notes' },
      { name: 'approved_by_user_id',  spec: 'INT DEFAULT NULL' },
      { name: 'approved_by_name',     spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'approved_at',          spec: 'DATETIME DEFAULT NULL' },
      { name: 'sent_at',              spec: 'DATETIME DEFAULT NULL' },
      { name: 'cancelled_by_user_id', spec: 'INT DEFAULT NULL' },
      { name: 'cancelled_by_name',    spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'cancelled_at',         spec: 'DATETIME DEFAULT NULL' },
      { name: 'cancel_reason',        spec: 'TEXT DEFAULT NULL' }
    ];
    for (const col of poColumns) {
      try {
        await connection.query(`ALTER TABLE purchase_orders ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 046] Added purchase_orders.${col.name}.`);
      } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') console.warn(`[Migration 046] purchase_orders.${col.name}:`, e.message);
      }
    }

    // =========================================================================
    // 6. Alter purchase_order_items — add billed_qty
    // =========================================================================
    try {
      await connection.query('ALTER TABLE purchase_order_items ADD COLUMN billed_qty DECIMAL(10,3) DEFAULT 0.000');
      console.log('[Migration 046] Added purchase_order_items.billed_qty.');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.warn('[Migration 046] purchase_order_items.billed_qty:', e.message);
    }

    // =========================================================================
    // 7. Alter purchase_bills — link to GRN and supplier_ledger
    // =========================================================================
    const billColumns = [
      { name: 'grn_id',             spec: 'INT DEFAULT NULL' },
      { name: 'supplier_ledger_id', spec: 'BIGINT DEFAULT NULL' }
    ];
    for (const col of billColumns) {
      try {
        await connection.query(`ALTER TABLE purchase_bills ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 046] Added purchase_bills.${col.name}.`);
      } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') console.warn(`[Migration 046] purchase_bills.${col.name}:`, e.message);
      }
    }

    // =========================================================================
    // 8. Alter purchase_return_items — add tax fields for proper debit notes
    // =========================================================================
    const returnItemCols = [
      { name: 'tax_rate',        spec: 'DECIMAL(5,2) DEFAULT 0.00' },
      { name: 'tax_amount',      spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'discount_amount', spec: 'DECIMAL(10,2) DEFAULT 0.00' }
    ];
    for (const col of returnItemCols) {
      try {
        await connection.query(`ALTER TABLE purchase_return_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 046] Added purchase_return_items.${col.name}.`);
      } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') console.warn(`[Migration 046] purchase_return_items.${col.name}:`, e.message);
      }
    }

    // =========================================================================
    // 9. Alter purchase_returns — add tax fields at header level
    // =========================================================================
    const returnHeaderCols = [
      { name: 'tax_amount',      spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'discount_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' }
    ];
    for (const col of returnHeaderCols) {
      try {
        await connection.query(`ALTER TABLE purchase_returns ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 046] Added purchase_returns.${col.name}.`);
      } catch (e) {
        if (e.code !== 'ER_DUP_FIELDNAME') console.warn(`[Migration 046] purchase_returns.${col.name}:`, e.message);
      }
    }

    console.log('[Migration 046] Purchase Order GRN Workflow migration completed successfully.');
  }
};
