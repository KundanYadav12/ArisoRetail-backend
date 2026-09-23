/**
 * Migration 047: Complete GST Management & Compliance Suite
 *
 * Adds:
 *  - Store GST profile to `receipt_settings` & `restaurants`
 *  - Exemption flag `is_tax_exempt` to `menu_items`
 *  - State and State Code to `customers` for automated Place of Supply
 *  - Line-level tax snapshots to `order_items`
 *  - Order-level tax breakdown to `orders`
 *  - Purchase bill tax details and line-level tax snapshots
 *  - `credit_notes` & `credit_note_items` for sales returns
 *  - `e_invoices` for IRN/Ack/QR tracking
 *  - `e_way_bills` for consignment and transport tracking
 */
module.exports = {
  name: '047_complete_gst_compliance_suite',
  async up(connection) {
    console.log('[Migration 047] Starting Complete GST Compliance Suite migration...');

    // Helper to safely add column if not exists
    const addColumnSafe = async (table, colName, colSpec) => {
      try {
        await connection.query(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colSpec}`);
        console.log(`[Migration 047] Added column ${colName} to ${table}.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 047] Column ${colName} already exists on ${table}.`);
        } else {
          console.warn(`[Migration 047] Warning adding ${colName} to ${table}:`, err.message);
        }
      }
    };

    // 1. receipt_settings: store GST profile
    const receiptColumns = [
      { name: 'legal_name', spec: 'VARCHAR(150) DEFAULT NULL' },
      { name: 'trade_name', spec: 'VARCHAR(150) DEFAULT NULL' },
      { name: 'state', spec: "VARCHAR(100) DEFAULT 'Maharashtra'" },
      { name: 'state_code', spec: "VARCHAR(5) DEFAULT '27'" },
      { name: 'gst_registration_type', spec: "ENUM('regular', 'composition', 'unregistered', 'sez') DEFAULT 'regular'" },
      { name: 'composition_tax_rate', spec: 'DECIMAL(5,2) DEFAULT 1.00' },
      { name: 'default_hsn_code', spec: 'VARCHAR(20) DEFAULT NULL' },
      { name: 'invoice_prefix', spec: "VARCHAR(20) DEFAULT 'INV-'" },
      { name: 'einvoice_enabled', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'eway_bill_enabled', spec: 'TINYINT(1) DEFAULT 0' }
    ];
    for (const col of receiptColumns) {
      await addColumnSafe('receipt_settings', col.name, col.spec);
    }

    // 2. restaurants: store GST profile sync
    const restColumns = [
      { name: 'legal_name', spec: 'VARCHAR(150) DEFAULT NULL' },
      { name: 'trade_name', spec: 'VARCHAR(150) DEFAULT NULL' },
      { name: 'state', spec: "VARCHAR(100) DEFAULT 'Maharashtra'" },
      { name: 'state_code', spec: "VARCHAR(5) DEFAULT '27'" },
      { name: 'gst_registration_type', spec: "ENUM('regular', 'composition', 'unregistered', 'sez') DEFAULT 'regular'" },
      { name: 'composition_tax_rate', spec: 'DECIMAL(5,2) DEFAULT 1.00' },
      { name: 'default_hsn_code', spec: 'VARCHAR(20) DEFAULT NULL' },
      { name: 'invoice_prefix', spec: "VARCHAR(20) DEFAULT 'INV-'" },
      { name: 'einvoice_enabled', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'eway_bill_enabled', spec: 'TINYINT(1) DEFAULT 0' }
    ];
    for (const col of restColumns) {
      await addColumnSafe('restaurants', col.name, col.spec);
    }

    // 3. menu_items: tax exemption flag
    await addColumnSafe('menu_items', 'is_tax_exempt', 'TINYINT(1) DEFAULT 0');

    // 4. customers: state and state code for automatic Place of Supply
    await addColumnSafe('customers', 'state', 'VARCHAR(100) DEFAULT NULL');
    await addColumnSafe('customers', 'state_code', 'VARCHAR(5) DEFAULT NULL');

    // 5. order_items: line-level tax snapshot
    const orderItemCols = [
      { name: 'hsn_code', spec: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'taxable_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'cgst_rate', spec: 'DECIMAL(5,2) DEFAULT 0.00' },
      { name: 'cgst_amount', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'sgst_rate', spec: 'DECIMAL(5,2) DEFAULT 0.00' },
      { name: 'sgst_amount', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'igst_rate', spec: 'DECIMAL(5,2) DEFAULT 0.00' },
      { name: 'igst_amount', spec: 'DECIMAL(10,2) DEFAULT 0.00' }
    ];
    for (const col of orderItemCols) {
      await addColumnSafe('order_items', col.name, col.spec);
    }

    // 6. orders: header-level tax breakdown
    const orderCols = [
      { name: 'cgst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'sgst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'igst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'round_off', spec: 'DECIMAL(6,2) DEFAULT 0.00' },
      { name: 'tax_invoice_type', spec: "ENUM('TAX_INVOICE', 'BILL_OF_SUPPLY') DEFAULT 'TAX_INVOICE'" }
    ];
    for (const col of orderCols) {
      await addColumnSafe('orders', col.name, col.spec);
    }

    // 7. purchase_bills: header-level tax breakdown
    const purchaseBillCols = [
      { name: 'tax_type', spec: "VARCHAR(10) DEFAULT 'intra'" },
      { name: 'cgst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'sgst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'igst_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'place_of_supply', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'supplier_gstin', spec: 'VARCHAR(30) DEFAULT NULL' }
    ];
    for (const col of purchaseBillCols) {
      await addColumnSafe('purchase_bills', col.name, col.spec);
    }

    // 8. purchase_bill_items: line-level tax snapshot
    const purchaseBillItemCols = [
      { name: 'hsn_code', spec: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'taxable_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'cgst_rate', spec: 'DECIMAL(5,2) DEFAULT 0.00' },
      { name: 'cgst_amount', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'sgst_rate', spec: 'DECIMAL(5,2) DEFAULT 0.00' },
      { name: 'sgst_amount', spec: 'DECIMAL(10,2) DEFAULT 0.00' },
      { name: 'igst_rate', spec: 'DECIMAL(5,2) DEFAULT 0.00' },
      { name: 'igst_amount', spec: 'DECIMAL(10,2) DEFAULT 0.00' }
    ];
    for (const col of purchaseBillItemCols) {
      await addColumnSafe('purchase_bill_items', col.name, col.spec);
    }

    // 9. purchase_orders: tax_type and place_of_supply
    await addColumnSafe('purchase_orders', 'tax_type', "VARCHAR(10) DEFAULT 'intra'");
    await addColumnSafe('purchase_orders', 'place_of_supply', 'VARCHAR(100) DEFAULT NULL');

    // 10. Table: credit_notes (Sales Returns)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS credit_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        credit_note_number VARCHAR(50) NOT NULL UNIQUE,
        order_id INT NOT NULL,
        customer_id INT DEFAULT NULL,
        credit_note_date DATE NOT NULL,
        reason VARCHAR(50) DEFAULT 'sales_return',
        subtotal DECIMAL(12,2) DEFAULT 0.00,
        cgst_amount DECIMAL(12,2) DEFAULT 0.00,
        sgst_amount DECIMAL(12,2) DEFAULT 0.00,
        igst_amount DECIMAL(12,2) DEFAULT 0.00,
        total_tax DECIMAL(12,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) DEFAULT 0.00,
        status ENUM('active', 'cancelled') DEFAULT 'active',
        notes TEXT DEFAULT NULL,
        created_by_user_id INT DEFAULT NULL,
        created_by_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cn_rest (restaurant_id, credit_note_date),
        INDEX idx_cn_order (order_id),
        INDEX idx_cn_cust (customer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 047] Created table "credit_notes".');

    // 11. Table: credit_note_items
    await connection.query(`
      CREATE TABLE IF NOT EXISTS credit_note_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        credit_note_id INT NOT NULL,
        order_item_id INT DEFAULT NULL,
        menu_item_id INT DEFAULT NULL,
        item_name VARCHAR(255) NOT NULL,
        quantity DECIMAL(10,3) NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        taxable_amount DECIMAL(12,2) NOT NULL,
        gst_rate DECIMAL(5,2) DEFAULT 0.00,
        cgst_rate DECIMAL(5,2) DEFAULT 0.00,
        cgst_amount DECIMAL(10,2) DEFAULT 0.00,
        sgst_rate DECIMAL(5,2) DEFAULT 0.00,
        sgst_amount DECIMAL(10,2) DEFAULT 0.00,
        igst_rate DECIMAL(5,2) DEFAULT 0.00,
        igst_amount DECIMAL(10,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) NOT NULL,
        notes TEXT DEFAULT NULL,
        INDEX idx_cni_note (credit_note_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 047] Created table "credit_note_items".');

    // 12. Table: e_invoices
    await connection.query(`
      CREATE TABLE IF NOT EXISTS e_invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        order_id INT NOT NULL,
        invoice_number VARCHAR(50) NOT NULL,
        irn VARCHAR(100) DEFAULT NULL,
        ack_no VARCHAR(50) DEFAULT NULL,
        ack_date DATETIME DEFAULT NULL,
        signed_invoice MEDIUMTEXT DEFAULT NULL,
        signed_qr_data MEDIUMTEXT DEFAULT NULL,
        status ENUM('NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'GENERATED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING',
        error_code VARCHAR(50) DEFAULT NULL,
        error_message TEXT DEFAULT NULL,
        cancelled_at DATETIME DEFAULT NULL,
        cancel_reason VARCHAR(255) DEFAULT NULL,
        request_payload JSON DEFAULT NULL,
        response_payload JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_einv_order (order_id),
        INDEX idx_einv_rest_status (restaurant_id, status),
        INDEX idx_einv_irn (irn)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 047] Created table "e_invoices".');

    // 13. Table: e_way_bills
    await connection.query(`
      CREATE TABLE IF NOT EXISTS e_way_bills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        order_id INT DEFAULT NULL,
        delivery_challan_id INT DEFAULT NULL,
        eway_bill_no VARCHAR(50) DEFAULT NULL,
        eway_bill_date DATETIME DEFAULT NULL,
        valid_until DATETIME DEFAULT NULL,
        status ENUM('PENDING', 'GENERATED', 'CANCELLED', 'REJECTED', 'EXPIRED') DEFAULT 'PENDING',
        transporter_id VARCHAR(50) DEFAULT NULL,
        transporter_name VARCHAR(150) DEFAULT NULL,
        vehicle_number VARCHAR(50) DEFAULT NULL,
        vehicle_type ENUM('regular', 'over_dimensional_cargo') DEFAULT 'regular',
        transport_mode ENUM('road', 'rail', 'air', 'ship') DEFAULT 'road',
        distance_km INT DEFAULT 0,
        error_code VARCHAR(50) DEFAULT NULL,
        error_message TEXT DEFAULT NULL,
        cancelled_at DATETIME DEFAULT NULL,
        cancel_reason VARCHAR(255) DEFAULT NULL,
        request_payload JSON DEFAULT NULL,
        response_payload JSON DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ewb_rest_status (restaurant_id, status),
        INDEX idx_ewb_no (eway_bill_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 047] Created table "e_way_bills".');

    console.log('[Migration 047] Complete GST Compliance Suite migration completed successfully.');
  }
};
