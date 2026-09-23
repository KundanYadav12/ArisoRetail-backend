/**
 * Migration 045: Sales Order Lifecycle Enhancements
 * 
 * Supports Petpooja-aligned connected lifecycle:
 * Estimate -> Sales Order -> Delivery Challan -> Invoice -> Payment
 * 
 * - Enhances orders with parent_order_id, is_estimate, invoiced_amount
 * - Enhances order_items with delivered_qty, invoiced_qty
 * - Creates delivery_challans & delivery_challan_items tables
 * - Enhances customers with opening_balance, current_balance
 * - Creates customer_ledger table
 */
module.exports = {
  name: '045_sales_order_lifecycle_enhancements',
  async up(connection) {
    console.log('[Migration 045] Starting Sales Order Lifecycle Enhancements...');

    // 1. Add parent_order_id, is_estimate, invoiced_amount to orders
    const orderCols = [
      { name: 'parent_order_id', spec: 'INT DEFAULT NULL' },
      { name: 'is_estimate', spec: 'TINYINT(1) DEFAULT 0' },
      { name: 'invoiced_amount', spec: 'DECIMAL(12,2) DEFAULT 0.00' }
    ];

    for (const col of orderCols) {
      try {
        await connection.query(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 045] Added column ${col.name} to orders.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 045] Column ${col.name} already exists on orders.`);
        } else {
          console.warn(`[Migration 045] Notice adding orders.${col.name}:`, err.message);
        }
      }
    }

    try {
      await connection.query('ALTER TABLE orders ADD INDEX idx_orders_parent (parent_order_id)');
    } catch (e) {
      // index might already exist
    }

    // 2. Add delivered_qty, invoiced_qty to order_items
    const orderItemCols = [
      { name: 'delivered_qty', spec: 'DECIMAL(10,3) DEFAULT 0.000' },
      { name: 'invoiced_qty', spec: 'DECIMAL(10,3) DEFAULT 0.000' }
    ];

    for (const col of orderItemCols) {
      try {
        await connection.query(`ALTER TABLE order_items ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 045] Added column ${col.name} to order_items.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 045] Column ${col.name} already exists on order_items.`);
        } else {
          console.warn(`[Migration 045] Notice adding order_items.${col.name}:`, err.message);
        }
      }
    }

    // 3. Create delivery_challans table
    console.log('[Migration 045] Creating delivery_challans table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS delivery_challans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        challan_number VARCHAR(50) NOT NULL UNIQUE,
        sales_order_id INT NOT NULL,
        warehouse_id INT DEFAULT NULL,
        party_id INT DEFAULT NULL,
        party_name VARCHAR(150) NOT NULL,
        party_phone VARCHAR(30) DEFAULT NULL,
        delivery_address TEXT DEFAULT NULL,
        challan_date DATE NOT NULL,
        vehicle_number VARCHAR(50) DEFAULT NULL,
        driver_name VARCHAR(100) DEFAULT NULL,
        driver_phone VARCHAR(30) DEFAULT NULL,
        status ENUM('dispatched', 'delivered', 'cancelled') DEFAULT 'dispatched',
        notes TEXT DEFAULT NULL,
        created_by_user_id INT DEFAULT NULL,
        created_by_name VARCHAR(100) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_dc_rest_status (restaurant_id, status),
        INDEX idx_dc_sales_order (sales_order_id),
        INDEX idx_dc_date (restaurant_id, challan_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 045] Created table "delivery_challans".');

    // 4. Create delivery_challan_items table
    console.log('[Migration 045] Creating delivery_challan_items table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS delivery_challan_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        delivery_challan_id INT NOT NULL,
        order_item_id INT NOT NULL,
        menu_item_id INT DEFAULT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'PCS',
        ordered_qty DECIMAL(10,3) NOT NULL,
        delivered_qty DECIMAL(10,3) NOT NULL,
        notes TEXT DEFAULT NULL,
        INDEX idx_dci_challan (delivery_challan_id),
        INDEX idx_dci_oi (order_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 045] Created table "delivery_challan_items".');

    // 5. Enhance customers table with balance fields
    const customerCols = [
      { name: 'opening_balance', spec: 'DECIMAL(12,2) DEFAULT 0.00' },
      { name: 'current_balance', spec: 'DECIMAL(12,2) DEFAULT 0.00' }
    ];

    for (const col of customerCols) {
      try {
        await connection.query(`ALTER TABLE customers ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 045] Added column ${col.name} to customers.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 045] Column ${col.name} already exists on customers.`);
        } else {
          console.warn(`[Migration 045] Notice adding customers.${col.name}:`, err.message);
        }
      }
    }

    // 6. Create customer_ledger table
    console.log('[Migration 045] Creating customer_ledger table...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS customer_ledger (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        customer_id INT NOT NULL,
        transaction_type ENUM('INVOICE', 'PAYMENT', 'RETURN', 'OPENING_BALANCE') NOT NULL,
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
        INDEX idx_cl_cust_date (restaurant_id, customer_id, created_at),
        INDEX idx_cl_type (restaurant_id, transaction_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 045] Created table "customer_ledger".');

    console.log('[Migration 045] Sales Order Lifecycle Enhancements successfully completed.');
  }
};
