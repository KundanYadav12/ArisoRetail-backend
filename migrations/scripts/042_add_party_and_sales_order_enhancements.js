/**
 * Migration 042: Add Party and Sales Order Enhancements
 * 
 * - Adds Party fields to customers: contact_person, shipping_address, place_of_supply, pan_number, credit_limit
 * - Adds Sales Order fields to orders: delivery_date, billing_address, shipping_address, place_of_supply, price_list, reference_number, additional_charges, is_sales_order
 */
module.exports = {
  name: '042_add_party_and_sales_order_enhancements',
  async up(connection) {
    console.log('[Migration 042] Enhancing customers table with Party fields...');
    const customerColumns = [
      { name: 'contact_person', spec: 'VARCHAR(150) DEFAULT NULL' },
      { name: 'shipping_address', spec: 'TEXT DEFAULT NULL' },
      { name: 'place_of_supply', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'pan_number', spec: 'VARCHAR(30) DEFAULT NULL' },
      { name: 'credit_limit', spec: 'DECIMAL(10,2) DEFAULT 0.00' }
    ];

    for (const col of customerColumns) {
      try {
        await connection.query(`ALTER TABLE customers ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 042] Added column ${col.name} to customers.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 042] Column ${col.name} already exists on customers.`);
        } else {
          console.warn(`[Migration 042] Warning adding ${col.name} to customers:`, err.message);
        }
      }
    }

    console.log('[Migration 042] Enhancing orders table with Sales Order fields...');
    const orderColumns = [
      { name: 'delivery_date', spec: 'DATE DEFAULT NULL' },
      { name: 'billing_address', spec: 'TEXT DEFAULT NULL' },
      { name: 'shipping_address', spec: 'TEXT DEFAULT NULL' },
      { name: 'place_of_supply', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'price_list', spec: 'VARCHAR(50) DEFAULT "standard"' },
      { name: 'reference_number', spec: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'additional_charges', spec: 'JSON DEFAULT NULL' },
      { name: 'is_sales_order', spec: 'TINYINT(1) DEFAULT 0' }
    ];

    for (const col of orderColumns) {
      try {
        await connection.query(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.spec}`);
        console.log(`[Migration 042] Added column ${col.name} to orders.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration 042] Column ${col.name} already exists on orders.`);
        } else {
          console.warn(`[Migration 042] Warning adding ${col.name} to orders:`, err.message);
        }
      }
    }

    // Create additional_charge_presets table
    console.log('[Migration 042] Creating additional_charge_presets table...');
    try {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS additional_charge_presets (
          id INT AUTO_INCREMENT PRIMARY KEY,
          restaurant_id INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          default_amount DECIMAL(10,2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
          UNIQUE KEY uq_rest_charge_name (restaurant_id, name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
      console.log('[Migration 042] Created additional_charge_presets table.');
    } catch (err) {
      console.warn('[Migration 042] Warning creating additional_charge_presets:', err.message);
    }

    console.log('[Migration 042] Migration completed successfully.');
  }
};
