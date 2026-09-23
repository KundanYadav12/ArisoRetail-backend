/**
 * Migration 044: Create Inventory and Warehouse Management Suite
 * Supports Multi-Warehouse, Stock Requests, Transfers, Receiving, Suppliers, POs, Bills, Returns, Adjustments & Stock Ledger
 */
module.exports = {
  name: '044_create_inventory_and_warehouse_management_suite',
  async up(connection) {
    console.log('[Migration 044] Creating Enterprise Inventory & Warehouse Management Suite...');

    // 1. Warehouses
    await connection.query(`
      CREATE TABLE IF NOT EXISTS warehouses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50) NOT NULL,
        address TEXT DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        state VARCHAR(100) DEFAULT NULL,
        pincode VARCHAR(20) DEFAULT NULL,
        contact_person VARCHAR(100) DEFAULT NULL,
        contact_number VARCHAR(30) DEFAULT NULL,
        email VARCHAR(100) DEFAULT NULL,
        is_default TINYINT(1) DEFAULT 0,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_wh_rest (restaurant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "warehouses".');

    // 2. Warehouse Stock per Item
    await connection.query(`
      CREATE TABLE IF NOT EXISTS warehouse_stocks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        current_stock DECIMAL(10,3) DEFAULT 0.000,
        reserved_stock DECIMAL(10,3) DEFAULT 0.000,
        min_stock DECIMAL(10,3) DEFAULT 0.000,
        max_stock DECIMAL(10,3) DEFAULT 0.000,
        reorder_level DECIMAL(10,3) DEFAULT 0.000,
        batch_number VARCHAR(100) DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wh_stock_item (restaurant_id, warehouse_id, menu_item_id),
        INDEX idx_wh_stock (warehouse_id, current_stock)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "warehouse_stocks".');

    // 3. Suppliers
    await connection.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        company_name VARCHAR(150) DEFAULT NULL,
        mobile VARCHAR(30) NOT NULL,
        email VARCHAR(150) DEFAULT NULL,
        address TEXT DEFAULT NULL,
        city VARCHAR(100) DEFAULT NULL,
        state VARCHAR(100) DEFAULT NULL,
        pincode VARCHAR(20) DEFAULT NULL,
        gst_number VARCHAR(30) DEFAULT NULL,
        pan_number VARCHAR(30) DEFAULT NULL,
        opening_balance DECIMAL(12,2) DEFAULT 0.00,
        current_balance DECIMAL(12,2) DEFAULT 0.00,
        payment_terms VARCHAR(100) DEFAULT 'Net 30',
        status ENUM('active', 'inactive') DEFAULT 'active',
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_supp_rest (restaurant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "suppliers".');

    // 4. Stock Requests
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        request_number VARCHAR(50) NOT NULL UNIQUE,
        request_date DATE NOT NULL,
        requesting_warehouse_id INT NOT NULL,
        source_warehouse_id INT NOT NULL,
        requested_by_user_id INT NOT NULL,
        requested_by_name VARCHAR(100) NOT NULL,
        approved_by_user_id INT DEFAULT NULL,
        approved_by_name VARCHAR(100) DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        status ENUM('draft', 'pending', 'approved', 'partially_approved', 'rejected', 'processing', 'transferred', 'partially_received', 'received', 'cancelled') DEFAULT 'pending',
        notes TEXT DEFAULT NULL,
        approval_notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sr_rest (restaurant_id, status),
        INDEX idx_sr_date (restaurant_id, request_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "stock_requests".');

    // 5. Stock Request Items
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_request_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        stock_request_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'pcs',
        requested_qty DECIMAL(10,3) NOT NULL,
        available_qty DECIMAL(10,3) DEFAULT 0.000,
        approved_qty DECIMAL(10,3) DEFAULT 0.000,
        rejected_qty DECIMAL(10,3) DEFAULT 0.000,
        transferred_qty DECIMAL(10,3) DEFAULT 0.000,
        received_qty DECIMAL(10,3) DEFAULT 0.000,
        notes TEXT DEFAULT NULL,
        INDEX idx_sri_req (stock_request_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "stock_request_items".');

    // 6. Stock Transfers
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_transfers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        transfer_number VARCHAR(50) NOT NULL UNIQUE,
        stock_request_id INT DEFAULT NULL,
        transfer_date DATE NOT NULL,
        source_warehouse_id INT NOT NULL,
        destination_warehouse_id INT NOT NULL,
        created_by_user_id INT NOT NULL,
        created_by_name VARCHAR(100) NOT NULL,
        approved_by_user_id INT DEFAULT NULL,
        approved_by_name VARCHAR(100) DEFAULT NULL,
        received_by_user_id INT DEFAULT NULL,
        received_by_name VARCHAR(100) DEFAULT NULL,
        received_at DATETIME DEFAULT NULL,
        status ENUM('draft', 'pending', 'approved', 'in_transit', 'partially_received', 'received', 'cancelled') DEFAULT 'pending',
        notes TEXT DEFAULT NULL,
        receiving_notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_st_rest (restaurant_id, status),
        INDEX idx_st_date (restaurant_id, transfer_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "stock_transfers".');

    // 7. Stock Transfer Items
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_transfer_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        stock_transfer_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'pcs',
        sent_qty DECIMAL(10,3) NOT NULL,
        received_qty DECIMAL(10,3) DEFAULT 0.000,
        damaged_qty DECIMAL(10,3) DEFAULT 0.000,
        unit_cost DECIMAL(10,2) DEFAULT 0.00,
        batch_number VARCHAR(100) DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        INDEX idx_sti_transfer (stock_transfer_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "stock_transfer_items".');

    // 8. Immutable Stock Ledger (Transactions)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_transactions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        transaction_type ENUM('OPENING_STOCK', 'PURCHASE', 'PURCHASE_RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'SALE', 'SALES_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE', 'EXPIRED', 'STOCK_CORRECTION') NOT NULL,
        quantity DECIMAL(10,3) NOT NULL,
        previous_stock DECIMAL(10,3) NOT NULL,
        new_stock DECIMAL(10,3) NOT NULL,
        unit_cost DECIMAL(10,2) DEFAULT 0.00,
        total_cost DECIMAL(12,2) DEFAULT 0.00,
        reference_type VARCHAR(50) DEFAULT NULL,
        reference_id INT DEFAULT NULL,
        reference_number VARCHAR(100) DEFAULT NULL,
        user_id INT DEFAULT NULL,
        user_name VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tx_wh_item (restaurant_id, warehouse_id, menu_item_id),
        INDEX idx_tx_type (restaurant_id, transaction_type),
        INDEX idx_tx_date (restaurant_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "stock_transactions".');

    // 9. Purchase Orders
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        po_number VARCHAR(50) NOT NULL UNIQUE,
        supplier_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        order_date DATE NOT NULL,
        expected_delivery_date DATE DEFAULT NULL,
        subtotal DECIMAL(12,2) DEFAULT 0.00,
        tax_amount DECIMAL(12,2) DEFAULT 0.00,
        discount_amount DECIMAL(12,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) DEFAULT 0.00,
        status ENUM('draft', 'pending', 'approved', 'partially_received', 'received', 'cancelled') DEFAULT 'pending',
        created_by_user_id INT NOT NULL,
        created_by_name VARCHAR(100) NOT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_po_rest (restaurant_id, supplier_id),
        INDEX idx_po_status (restaurant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "purchase_orders".');

    // 10. Purchase Order Items
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_order_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'pcs',
        quantity DECIMAL(10,3) NOT NULL,
        received_qty DECIMAL(10,3) DEFAULT 0.000,
        rate DECIMAL(10,2) NOT NULL,
        tax_rate DECIMAL(5,2) DEFAULT 0.00,
        tax_amount DECIMAL(10,2) DEFAULT 0.00,
        discount_amount DECIMAL(10,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) NOT NULL,
        INDEX idx_poi_order (purchase_order_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "purchase_order_items".');

    // 11. Purchase Bills (Goods Receiving)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_bills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        bill_number VARCHAR(50) NOT NULL,
        internal_bill_number VARCHAR(50) NOT NULL UNIQUE,
        purchase_order_id INT DEFAULT NULL,
        supplier_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        bill_date DATE NOT NULL,
        due_date DATE DEFAULT NULL,
        subtotal DECIMAL(12,2) DEFAULT 0.00,
        tax_amount DECIMAL(12,2) DEFAULT 0.00,
        discount_amount DECIMAL(12,2) DEFAULT 0.00,
        additional_charges DECIMAL(10,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) DEFAULT 0.00,
        paid_amount DECIMAL(12,2) DEFAULT 0.00,
        payment_status ENUM('unpaid', 'partially_paid', 'paid') DEFAULT 'unpaid',
        payment_mode VARCHAR(50) DEFAULT NULL,
        status ENUM('received', 'cancelled') DEFAULT 'received',
        notes TEXT DEFAULT NULL,
        created_by_user_id INT NOT NULL,
        created_by_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_pb_rest (restaurant_id, supplier_id),
        INDEX idx_pb_date (restaurant_id, bill_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "purchase_bills".');

    // 12. Purchase Bill Items
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_bill_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_bill_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'pcs',
        quantity DECIMAL(10,3) NOT NULL,
        rate DECIMAL(10,2) NOT NULL,
        tax_rate DECIMAL(5,2) DEFAULT 0.00,
        tax_amount DECIMAL(10,2) DEFAULT 0.00,
        discount_amount DECIMAL(10,2) DEFAULT 0.00,
        total_amount DECIMAL(12,2) NOT NULL,
        batch_number VARCHAR(100) DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,
        INDEX idx_pbi_bill (purchase_bill_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "purchase_bill_items".');

    // 13. Purchase Returns
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        return_number VARCHAR(50) NOT NULL UNIQUE,
        purchase_bill_id INT DEFAULT NULL,
        supplier_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        return_date DATE NOT NULL,
        total_amount DECIMAL(12,2) DEFAULT 0.00,
        reason TEXT DEFAULT NULL,
        created_by_user_id INT NOT NULL,
        created_by_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pr_rest (restaurant_id, supplier_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "purchase_returns".');

    // 14. Purchase Return Items
    await connection.query(`
      CREATE TABLE IF NOT EXISTS purchase_return_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        purchase_return_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'pcs',
        quantity DECIMAL(10,3) NOT NULL,
        rate DECIMAL(10,2) NOT NULL,
        total_amount DECIMAL(12,2) NOT NULL,
        INDEX idx_pri_return (purchase_return_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "purchase_return_items".');

    // 15. Stock Adjustments
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_adjustments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        adjustment_number VARCHAR(50) NOT NULL UNIQUE,
        warehouse_id INT NOT NULL,
        adjustment_date DATE NOT NULL,
        reason VARCHAR(100) NOT NULL,
        created_by_user_id INT NOT NULL,
        created_by_name VARCHAR(100) NOT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_adj_rest (restaurant_id, warehouse_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "stock_adjustments".');

    // 16. Stock Adjustment Items
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_adjustment_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        stock_adjustment_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(20) DEFAULT 'pcs',
        adjustment_type ENUM('add', 'reduce', 'set') NOT NULL,
        quantity DECIMAL(10,3) NOT NULL,
        previous_stock DECIMAL(10,3) NOT NULL,
        new_stock DECIMAL(10,3) NOT NULL,
        unit_cost DECIMAL(10,2) DEFAULT 0.00,
        INDEX idx_adji_adj (stock_adjustment_id, menu_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 044] Created table "stock_adjustment_items".');

    // 17. Additive Column to orders & users
    try {
      await connection.query('ALTER TABLE orders ADD COLUMN warehouse_id INT DEFAULT NULL');
      console.log('[Migration 044] Added column "warehouse_id" to orders.');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.warn('[Migration 044] orders.warehouse_id notice:', e.message);
    }

    try {
      await connection.query('ALTER TABLE users ADD COLUMN assigned_warehouse_id INT DEFAULT NULL');
      console.log('[Migration 044] Added column "assigned_warehouse_id" to users.');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') console.warn('[Migration 044] users.assigned_warehouse_id notice:', e.message);
    }

    // 18. Auto-seeding: Initialize Default Primary Warehouse & Seed warehouse_stocks for each tenant
    const [restaurants] = await connection.query('SELECT id, name, address, phone, email FROM restaurants');

    for (const rest of restaurants) {
      const restaurantId = rest.id;

      // Check if default warehouse exists
      const [existingWh] = await connection.query(
        'SELECT id FROM warehouses WHERE restaurant_id = ? AND is_default = 1',
        [restaurantId]
      );

      let defaultWhId;
      if (existingWh.length === 0) {
        const [insertWh] = await connection.query(`
          INSERT INTO warehouses (restaurant_id, name, code, address, contact_person, contact_number, email, is_default, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active')
        `, [
          restaurantId,
          `${rest.name || 'Main'} Central Warehouse`,
          'WH-MAIN',
          rest.address || 'Central Premises',
          'Warehouse Manager',
          rest.phone || '9999999999',
          rest.email || 'warehouse@arisoretail.com'
        ]);
        defaultWhId = insertWh.insertId;
        console.log(`[Migration 044] Seeded primary warehouse (ID: ${defaultWhId}) for restaurant #${restaurantId}.`);
      } else {
        defaultWhId = existingWh[0].id;
      }

      // Populate warehouse_stocks from existing menu_items
      const [menuItems] = await connection.query(
        'SELECT id, name, current_stock, reserved_stock, low_stock_threshold, min_stock, at_par_stock, cost_price, price FROM menu_items WHERE restaurant_id = ?',
        [restaurantId]
      );

      for (const item of menuItems) {
        const curStock = parseFloat(item.current_stock || 0);
        const resStock = parseFloat(item.reserved_stock || 0);
        const minStock = parseFloat(item.min_stock || item.low_stock_threshold || 10);
        const atPar = parseFloat(item.at_par_stock || 100);
        const costPrice = parseFloat(item.cost_price || item.price || 0);

        await connection.query(`
          INSERT INTO warehouse_stocks (restaurant_id, warehouse_id, menu_item_id, current_stock, reserved_stock, min_stock, reorder_level)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE current_stock = VALUES(current_stock), reserved_stock = VALUES(reserved_stock)
        `, [restaurantId, defaultWhId, item.id, curStock, resStock, minStock, minStock]);

        // Check if opening stock ledger record exists
        const [existingTx] = await connection.query(
          'SELECT id FROM stock_transactions WHERE restaurant_id = ? AND warehouse_id = ? AND menu_item_id = ? AND transaction_type = "OPENING_STOCK"',
          [restaurantId, defaultWhId, item.id]
        );

        if (existingTx.length === 0 && curStock > 0) {
          await connection.query(`
            INSERT INTO stock_transactions (restaurant_id, warehouse_id, menu_item_id, transaction_type, quantity, previous_stock, new_stock, unit_cost, total_cost, reference_type, reference_number, user_name, notes)
            VALUES (?, ?, ?, 'OPENING_STOCK', ?, 0, ?, ?, ?, 'system', 'INIT-STOCK', 'System Migration', 'Initial stock initialization from menu item master')
          `, [restaurantId, defaultWhId, item.id, curStock, curStock, costPrice, curStock * costPrice]);
        }
      }
      console.log(`[Migration 044] Synchronized ${menuItems.length} item stocks for restaurant #${restaurantId}.`);
    }

    console.log('[Migration 044] Enterprise Inventory & Warehouse Suite migration successfully completed.');
  }
};
