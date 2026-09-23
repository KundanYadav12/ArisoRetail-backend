/**
 * Migration 055: Warehouse Rack Management, Stock Location Tracking, and Stock Counting Suite
 *
 * Creates:
 *  - warehouse_racks            (Racks, shelves, and bins within specific warehouses)
 *  - product_rack_stocks        (Exact stock location tracking per rack and item)
 *  - stock_counting_devices     (Dedicated warehouse counting devices/terminals)
 *  - stock_counting_assignments (Product-restricted counting device assignments)
 *  - stock_count_sessions       (Physical stock counting sessions with variance and review)
 *
 * Alters:
 *  - stock_transactions         ADD: rack_id, rack_code, dest_rack_id, dest_rack_code
 *  - stock_transfer_items       ADD: source_rack_id, destination_rack_id
 *  - goods_received_note_items  ADD: rack_id
 *  - purchase_bill_items        ADD: rack_id
 *  - stock_adjustment_items     ADD: rack_id
 *
 * Auto-seeding:
 *  - Creates default rack 'GEN-01' for existing warehouses
 *  - Syncs initial warehouse_stocks into product_rack_stocks for 100% stock tally
 */
module.exports = {
  name: '055_warehouse_rack_management_and_stock_counting',
  async up(connection) {
    console.log('[Migration 055] Starting Warehouse Rack Management & Stock Counting Suite migration...');

    // 1. Warehouse Racks
    await connection.query(`
      CREATE TABLE IF NOT EXISTS warehouse_racks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        rack_code VARCHAR(50) NOT NULL,
        rack_name VARCHAR(150) NOT NULL,
        zone VARCHAR(100) DEFAULT NULL,
        shelf VARCHAR(50) DEFAULT NULL,
        bin VARCHAR(50) DEFAULT NULL,
        status ENUM('active', 'inactive') DEFAULT 'active',
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_wh_rack (restaurant_id, warehouse_id, rack_code),
        INDEX idx_wr_wh (warehouse_id, status),
        INDEX idx_wr_rest (restaurant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 055] Created table "warehouse_racks".');

    // 2. Product Rack Stocks (Product Stock by Location)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS product_rack_stocks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        rack_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        current_stock DECIMAL(10,3) DEFAULT 0.000,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_prs (restaurant_id, warehouse_id, rack_id, menu_item_id),
        INDEX idx_prs_item (menu_item_id),
        INDEX idx_prs_rack (rack_id),
        INDEX idx_prs_wh (warehouse_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 055] Created table "product_rack_stocks".');

    // 3. Stock Counting Devices
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_counting_devices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        device_code VARCHAR(50) NOT NULL,
        device_name VARCHAR(150) NOT NULL,
        assigned_user_id INT DEFAULT NULL,
        status ENUM('active', 'inactive', 'locked') DEFAULT 'active',
        notes TEXT DEFAULT NULL,
        last_active_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_scd_code (restaurant_id, device_code),
        INDEX idx_scd_wh (restaurant_id, warehouse_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 055] Created table "stock_counting_devices".');

    // 4. Stock Counting Device Assignments (Strict Product Restriction)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_counting_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        device_id INT NOT NULL,
        menu_item_id INT NOT NULL,
        warehouse_id INT NOT NULL,
        rack_id INT DEFAULT NULL,
        assigned_by_user_id INT NOT NULL,
        assigned_by_name VARCHAR(100) DEFAULT NULL,
        status ENUM('assigned', 'in_progress', 'completed', 'cancelled') DEFAULT 'assigned',
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME DEFAULT NULL,
        INDEX idx_sca_dev (device_id, status),
        INDEX idx_sca_item (menu_item_id),
        INDEX idx_sca_wh (warehouse_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 055] Created table "stock_counting_assignments".');

    // 5. Stock Count Sessions (Physical Counting, Variance & Adjustment Review)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock_count_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        session_number VARCHAR(50) NOT NULL UNIQUE,
        warehouse_id INT NOT NULL,
        rack_id INT DEFAULT NULL,
        device_id INT DEFAULT NULL,
        menu_item_id INT NOT NULL,
        system_stock DECIMAL(10,3) NOT NULL,
        counted_stock DECIMAL(10,3) NOT NULL,
        variance DECIMAL(10,3) NOT NULL,
        status ENUM('draft', 'submitted', 'approved', 'rejected', 'adjusted') DEFAULT 'submitted',
        counted_by_user_id INT NOT NULL,
        counted_by_name VARCHAR(100) NOT NULL,
        approved_by_user_id INT DEFAULT NULL,
        approved_by_name VARCHAR(100) DEFAULT NULL,
        stock_adjustment_id INT DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_scs_wh (restaurant_id, warehouse_id),
        INDEX idx_scs_item (restaurant_id, menu_item_id),
        INDEX idx_scs_status (restaurant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('[Migration 055] Created table "stock_count_sessions".');

    // 6. Alter existing tables with additive location columns
    const alterations = [
      {
        table: 'stock_transactions',
        columns: [
          { name: 'rack_id', spec: 'INT DEFAULT NULL AFTER warehouse_id' },
          { name: 'rack_code', spec: 'VARCHAR(50) DEFAULT NULL AFTER rack_id' },
          { name: 'dest_rack_id', spec: 'INT DEFAULT NULL AFTER rack_code' },
          { name: 'dest_rack_code', spec: 'VARCHAR(50) DEFAULT NULL AFTER dest_rack_id' }
        ]
      },
      {
        table: 'stock_transfer_items',
        columns: [
          { name: 'source_rack_id', spec: 'INT DEFAULT NULL' },
          { name: 'destination_rack_id', spec: 'INT DEFAULT NULL' }
        ]
      },
      {
        table: 'goods_received_note_items',
        columns: [
          { name: 'rack_id', spec: 'INT DEFAULT NULL' }
        ]
      },
      {
        table: 'purchase_bill_items',
        columns: [
          { name: 'rack_id', spec: 'INT DEFAULT NULL' }
        ]
      },
      {
        table: 'stock_adjustment_items',
        columns: [
          { name: 'rack_id', spec: 'INT DEFAULT NULL' }
        ]
      }
    ];

    for (const alt of alterations) {
      for (const col of alt.columns) {
        try {
          await connection.query(`ALTER TABLE ${alt.table} ADD COLUMN ${col.name} ${col.spec}`);
          console.log(`[Migration 055] Added ${alt.table}.${col.name}.`);
        } catch (e) {
          if (e.code !== 'ER_DUP_FIELDNAME') {
            console.warn(`[Migration 055] ${alt.table}.${col.name} notice:`, e.message);
          }
        }
      }
    }

    // 7. Auto-seeding: Initialize default General Rack 'GEN-01' and seed product_rack_stocks
    const [warehouses] = await connection.query('SELECT id, restaurant_id, name FROM warehouses');
    for (const wh of warehouses) {
      // Check if any rack exists for this warehouse
      const [existingRacks] = await connection.query(
        'SELECT id FROM warehouse_racks WHERE warehouse_id = ? AND restaurant_id = ? LIMIT 1',
        [wh.id, wh.restaurant_id]
      );

      let defaultRackId;
      if (existingRacks.length === 0) {
        const [insertRack] = await connection.query(`
          INSERT INTO warehouse_racks (restaurant_id, warehouse_id, rack_code, rack_name, zone, status, notes)
          VALUES (?, ?, 'GEN-01', 'General Floor / Default Rack', 'General Zone', 'active', 'Auto-created default floor location')
        `, [wh.restaurant_id, wh.id]);
        defaultRackId = insertRack.insertId;
        console.log(`[Migration 055] Seeded default rack GEN-01 (ID: ${defaultRackId}) for warehouse #${wh.id}.`);
      } else {
        defaultRackId = existingRacks[0].id;
      }

      // Populate product_rack_stocks from warehouse_stocks so initial tally is 100% consistent
      const [whStocks] = await connection.query(
        'SELECT menu_item_id, current_stock FROM warehouse_stocks WHERE warehouse_id = ? AND restaurant_id = ?',
        [wh.id, wh.restaurant_id]
      );

      for (const st of whStocks) {
        await connection.query(`
          INSERT INTO product_rack_stocks (restaurant_id, warehouse_id, rack_id, menu_item_id, current_stock)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE current_stock = VALUES(current_stock)
        `, [wh.restaurant_id, wh.id, defaultRackId, st.menu_item_id, st.current_stock || 0]);
      }
      console.log(`[Migration 055] Synchronized ${whStocks.length} rack stock records for warehouse #${wh.id}.`);
    }

    console.log('[Migration 055] Warehouse Rack Management & Stock Counting Suite migration successfully completed.');
  }
};
