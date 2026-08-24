/**
 * Migration 026: Seed Retail Demo Categories and Products
 * Seeds realistic weight-based and piece-based retail products for testing Ariso Retail POS.
 */
module.exports = {
  name: '026_seed_retail_demo_data',
  async up(connection) {
    console.log('[Migration 026] Seeding Retail Demo Categories and Products...');

    // 1. Get default restaurant ID (McDonald's/Ariso Retail Store ID = 1 or first restaurant)
    const [restaurants] = await connection.query('SELECT id FROM restaurants LIMIT 1');
    if (restaurants.length === 0) return;
    const restId = restaurants[0].id;

    // 2. Define Demo Categories
    const demoCategories = [
      { name: 'Grains & Pulses', description: 'Rice, Dal, Atta and Grains', seq: 1 },
      { name: 'Fruits & Vegetables', description: 'Fresh Farm Produce', seq: 2 },
      { name: 'Spices & Condiments', description: 'Ground spices and seasoning', seq: 3 },
      { name: 'Dairy & Beverages', description: 'Milk, Butter, Juices and Drinks', seq: 4 },
      { name: 'Snacks & Household', description: 'Packaged snacks and cleaning supplies', seq: 5 }
    ];

    const categoryMap = {};

    for (const cat of demoCategories) {
      const [existing] = await connection.query(
        'SELECT id FROM categories WHERE restaurant_id = ? AND name = ?',
        [restId, cat.name]
      );
      if (existing.length > 0) {
        categoryMap[cat.name] = existing[0].id;
      } else {
        const [inserted] = await connection.query(
          'INSERT INTO categories (restaurant_id, name, description, seq) VALUES (?, ?, ?, ?)',
          [restId, cat.name, cat.description, cat.seq]
        );
        categoryMap[cat.name] = inserted.insertId;
      }
    }

    // 3. Define Demo Products (Piece & Weight-based)
    const demoProducts = [
      {
        name: 'Basmati Rice (Premium)',
        category: 'Grains & Pulses',
        sku: 'RICE-001',
        barcode: '890100100001',
        price: 90.00,
        purchase_price: 68.00,
        is_weight_based: 1,
        base_unit: 'kg',
        unit: 'kg',
        current_stock: 50.000,
        low_stock_threshold: 10.000,
        min_sale_qty: 0.100,
        max_sale_qty: 50.000,
        description: 'Long grain aromatic premium basmati rice'
      },
      {
        name: 'Sugar (Crystal White)',
        category: 'Grains & Pulses',
        sku: 'SUGAR-002',
        barcode: '890100100002',
        price: 48.00,
        purchase_price: 38.00,
        is_weight_based: 1,
        base_unit: 'kg',
        unit: 'kg',
        current_stock: 100.000,
        low_stock_threshold: 15.000,
        min_sale_qty: 0.100,
        max_sale_qty: 100.000,
        description: 'Pure refined white crystal sugar'
      },
      {
        name: 'Toor Dal (Yellow Lentils)',
        category: 'Grains & Pulses',
        sku: 'DAL-003',
        barcode: '890100100003',
        price: 140.00,
        purchase_price: 110.00,
        is_weight_based: 1,
        base_unit: 'kg',
        unit: 'kg',
        current_stock: 40.000,
        low_stock_threshold: 8.000,
        min_sale_qty: 0.250,
        max_sale_qty: 25.000,
        description: 'Unpolished protein-rich yellow toor dal'
      },
      {
        name: 'Wheat Flour (Whole Atta)',
        category: 'Grains & Pulses',
        sku: 'ATTA-004',
        barcode: '890100100004',
        price: 42.00,
        purchase_price: 32.00,
        is_weight_based: 1,
        base_unit: 'kg',
        unit: 'kg',
        current_stock: 80.000,
        low_stock_threshold: 10.000,
        min_sale_qty: 0.500,
        max_sale_qty: 50.000,
        description: '100% whole wheat chakki fresh atta'
      },
      {
        name: 'Fresh Apples (Fuji Red)',
        category: 'Fruits & Vegetables',
        sku: 'APPLE-005',
        barcode: '890100100005',
        price: 180.00,
        purchase_price: 130.00,
        is_weight_based: 1,
        base_unit: 'kg',
        unit: 'kg',
        current_stock: 25.500,
        low_stock_threshold: 5.000,
        min_sale_qty: 0.250,
        max_sale_qty: 10.000,
        description: 'Crispy sweet imported Fuji apples'
      },
      {
        name: 'Potatoes (Organic Red)',
        category: 'Fruits & Vegetables',
        sku: 'POTATO-006',
        barcode: '890100100006',
        price: 30.00,
        purchase_price: 18.00,
        is_weight_based: 1,
        base_unit: 'kg',
        unit: 'kg',
        current_stock: 60.000,
        low_stock_threshold: 10.000,
        min_sale_qty: 0.500,
        max_sale_qty: 50.000,
        description: 'Fresh farm-sourced organic red potatoes'
      },
      {
        name: 'Milk Packet (1 Litre)',
        category: 'Dairy & Beverages',
        sku: 'MILK-007',
        barcode: '890100100007',
        price: 66.00,
        purchase_price: 58.00,
        is_weight_based: 0,
        base_unit: 'pcs',
        unit: 'pcs',
        current_stock: 50.000,
        low_stock_threshold: 10.000,
        min_sale_qty: 1.000,
        max_sale_qty: 20.000,
        description: 'Pasteurized full cream fresh milk'
      },
      {
        name: 'Dark Chocolate Bar (100g)',
        category: 'Snacks & Household',
        sku: 'CHOCO-008',
        barcode: '890100100008',
        price: 120.00,
        purchase_price: 85.00,
        is_weight_based: 0,
        base_unit: 'pcs',
        unit: 'pcs',
        current_stock: 35.000,
        low_stock_threshold: 5.000,
        min_sale_qty: 1.000,
        max_sale_qty: 10.000,
        description: 'Rich 70% cocoa artisanal dark chocolate'
      },
      {
        name: 'Dishwash Liquid Soap (500ml)',
        category: 'Snacks & Household',
        sku: 'SOAP-009',
        barcode: '890100100009',
        price: 115.00,
        purchase_price: 80.00,
        is_weight_based: 0,
        base_unit: 'pcs',
        unit: 'pcs',
        current_stock: 40.000,
        low_stock_threshold: 5.000,
        min_sale_qty: 1.000,
        max_sale_qty: 10.000,
        description: 'Lemon anti-bacterial dishwashing liquid'
      },
      {
        name: 'Sunflower Cooking Oil (1L Bottle)',
        category: 'Dairy & Beverages',
        sku: 'OIL-010',
        barcode: '890100100010',
        price: 145.00,
        purchase_price: 115.00,
        is_weight_based: 0,
        base_unit: 'pcs',
        unit: 'pcs',
        current_stock: 45.000,
        low_stock_threshold: 8.000,
        min_sale_qty: 1.000,
        max_sale_qty: 12.000,
        description: 'Heart-healthy light refined sunflower oil'
      }
    ];

    for (const p of demoProducts) {
      const categoryId = categoryMap[p.category];
      const [existing] = await connection.query(
        'SELECT id FROM menu_items WHERE restaurant_id = ? AND (barcode = ? OR sku = ? OR name = ?)',
        [restId, p.barcode, p.sku, p.name]
      );

      if (existing.length === 0) {
        await connection.query(
          `INSERT INTO menu_items (
            restaurant_id, category_id, name, sku, barcode, description, price, purchase_price,
            is_weight_based, base_unit, unit, current_stock, low_stock_threshold, min_sale_qty,
            max_sale_qty, is_available, is_veg, gst_rate, track_inventory
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 5.00, 1)`,
          [
            restId, categoryId, p.name, p.sku, p.barcode, p.description, p.price, p.purchase_price,
            p.is_weight_based, p.base_unit, p.unit, p.current_stock, p.low_stock_threshold,
            p.min_sale_qty, p.max_sale_qty
          ]
        );
        console.log(`[Migration 026] Inserted demo retail product: ${p.name} (Barcode: ${p.barcode})`);
      }
    }

    console.log('[Migration 026] Retail demo categories and products successfully seeded.');
  }
};
