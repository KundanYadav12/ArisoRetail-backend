const pool = require('../config/db');

class CustomerRepository {
  /**
   * Search/list customers for a restaurant
   */
  static async getAll(restaurantId, search = '', limit = 50) {
    let query = 'SELECT * FROM customers WHERE restaurant_id = ?';
    const params = [restaurantId];

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query += ' AND (name LIKE ? OR phone LIKE ? OR store_name LIKE ? OR gst_number LIKE ?)';
      params.push(term, term, term, term);
    }

    const safeLimit = Math.max(1, Math.min(200, parseInt(limit) || 50));
    query += ` ORDER BY id DESC LIMIT ${safeLimit}`;

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Find customer by ID
   */
  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM customers WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return rows[0] || null;
  }

  /**
   * Find customer by phone number within the tenant
   */
  static async findByPhone(restaurantId, phone, connection = null) {
    if (!phone || !phone.trim()) return null;
    const db = connection || pool;
    const [rows] = await db.execute(
      'SELECT * FROM customers WHERE restaurant_id = ? AND phone = ? LIMIT 1',
      [restaurantId, phone.trim()]
    );
    return rows[0] || null;
  }

  /**
   * Find customer by exact name or store name within the tenant
   */
  static async findByName(restaurantId, name, connection = null) {
    if (!name || !name.trim()) return null;
    const db = connection || pool;
    const [rows] = await db.execute(
      'SELECT * FROM customers WHERE restaurant_id = ? AND (LOWER(name) = LOWER(?) OR LOWER(store_name) = LOWER(?)) LIMIT 1',
      [restaurantId, name.trim(), name.trim()]
    );
    return rows[0] || null;
  }

  /**
   * Create new customer / party record
   */
  static async create(restaurantId, data, connection = null) {
    const db = connection || pool;
    const {
      name,
      phone,
      email,
      address,
      store_name,
      gst_number,
      notes,
      contact_person,
      shipping_address,
      place_of_supply,
      pan_number,
      credit_limit,
      opening_balance
    } = data;

    const cleanName = (name && name.trim()) || (store_name && store_name.trim()) || 'Walk-in Customer';
    const cleanPhone = (phone && phone.trim()) || null;
    const cleanEmail = (email && email.trim()) || null;
    const cleanAddress = (address && address.trim()) || null;
    const cleanStoreName = (store_name && store_name.trim()) || null;
    const cleanGst = (gst_number && gst_number.trim()) || null;
    const cleanNotes = (notes && notes.trim()) || null;
    const cleanContactPerson = (contact_person && contact_person.trim()) || null;
    const cleanShippingAddress = (shipping_address && shipping_address.trim()) || cleanAddress;
    const cleanPlaceOfSupply = (place_of_supply && place_of_supply.trim()) || null;
    const cleanPan = (pan_number && pan_number.trim()) || null;
    const cleanCreditLimit = parseFloat(credit_limit || 0);
    const cleanOpeningBalance = parseFloat(opening_balance || 0);

    const [result] = await db.execute(
      `INSERT INTO customers (
         restaurant_id, name, phone, email, address, store_name, gst_number, notes,
         contact_person, shipping_address, place_of_supply, pan_number, credit_limit,
         opening_balance, current_balance
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        restaurantId, cleanName, cleanPhone, cleanEmail, cleanAddress, cleanStoreName, cleanGst, cleanNotes,
        cleanContactPerson, cleanShippingAddress, cleanPlaceOfSupply, cleanPan, cleanCreditLimit,
        cleanOpeningBalance, cleanOpeningBalance
      ]
    );

    return {
      id: result.insertId,
      restaurant_id: restaurantId,
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      address: cleanAddress,
      store_name: cleanStoreName,
      gst_number: cleanGst,
      notes: cleanNotes,
      contact_person: cleanContactPerson,
      shipping_address: cleanShippingAddress,
      place_of_supply: cleanPlaceOfSupply,
      pan_number: cleanPan,
      credit_limit: cleanCreditLimit,
      opening_balance: cleanOpeningBalance,
      current_balance: cleanOpeningBalance
    };
  }

  /**
   * Update existing customer / party
   */
  static async update(id, restaurantId, data, connection = null) {
    const db = connection || pool;
    const {
      name,
      phone,
      email,
      address,
      store_name,
      gst_number,
      notes,
      contact_person,
      shipping_address,
      place_of_supply,
      pan_number,
      credit_limit,
      opening_balance,
      current_balance
    } = data;

    const [result] = await db.execute(
      `UPDATE customers SET 
         name = COALESCE(?, name),
         phone = COALESCE(?, phone),
         email = COALESCE(?, email),
         address = COALESCE(?, address),
         store_name = COALESCE(?, store_name),
         gst_number = COALESCE(?, gst_number),
         notes = COALESCE(?, notes),
         contact_person = COALESCE(?, contact_person),
         shipping_address = COALESCE(?, shipping_address),
         place_of_supply = COALESCE(?, place_of_supply),
         pan_number = COALESCE(?, pan_number),
         credit_limit = COALESCE(?, credit_limit),
         opening_balance = COALESCE(?, opening_balance),
         current_balance = COALESCE(?, current_balance)
       WHERE id = ? AND restaurant_id = ?`,
      [
        name !== undefined ? name : null,
        phone !== undefined ? phone : null,
        email !== undefined ? email : null,
        address !== undefined ? address : null,
        store_name !== undefined ? store_name : null,
        gst_number !== undefined ? gst_number : null,
        notes !== undefined ? notes : null,
        contact_person !== undefined ? contact_person : null,
        shipping_address !== undefined ? shipping_address : null,
        place_of_supply !== undefined ? place_of_supply : null,
        pan_number !== undefined ? pan_number : null,
        credit_limit !== undefined ? parseFloat(credit_limit || 0) : null,
        opening_balance !== undefined ? parseFloat(opening_balance || 0) : null,
        current_balance !== undefined ? parseFloat(current_balance || 0) : null,
        id,
        restaurantId
      ]
    );

    return result.affectedRows > 0;
  }

  /**
   * Get complete order history for a Party/Customer
   */
  static async getOrderHistory(customerId, restaurantId) {
    const [orders] = await pool.execute(
      `SELECT o.*, 
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS total_items
       FROM orders o
       WHERE (o.customer_id = ? OR o.customer_phone = (SELECT phone FROM customers WHERE id = ? LIMIT 1))
         AND o.restaurant_id = ?
       ORDER BY o.id DESC LIMIT 50`,
      [customerId, customerId, restaurantId]
    );

    for (const ord of orders) {
      const [items] = await pool.execute(
        `SELECT oi.*, m.category_id, c.name AS category_name
         FROM order_items oi
         LEFT JOIN menu_items m ON oi.menu_item_id = m.id
         LEFT JOIN categories c ON m.category_id = c.id
         WHERE oi.order_id = ?`,
        [ord.id]
      );
      ord.items = items;
    }

    return orders;
  }

  /**
   * Get additional charge presets for a restaurant
   */
  static async getChargePresets(restaurantId) {
    const [rows] = await pool.execute(
      `SELECT * FROM additional_charge_presets WHERE restaurant_id = ? ORDER BY id ASC`,
      [restaurantId]
    );
    return rows;
  }

  /**
   * Add a new additional charge preset
   */
  static async addChargePreset(restaurantId, name, defaultAmount = 0.00) {
    if (!name || !name.trim()) return null;
    const cleanName = name.trim();
    await pool.execute(
      `INSERT INTO additional_charge_presets (restaurant_id, name, default_amount)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE default_amount = VALUES(default_amount)`,
      [restaurantId, cleanName, parseFloat(defaultAmount || 0)]
    );
    return { name: cleanName, default_amount: parseFloat(defaultAmount || 0) };
  }

  /**
   * Find existing customer or auto-create a new one if not found
   */
  static async findOrCreate(restaurantId, customerData = {}, connection = null) {
    const {
      customer_id,
      name,
      customer_name,
      phone,
      customer_phone,
      email,
      address,
      customer_address,
      store_name,
      gst_number
    } = customerData;

    const db = connection || pool;

    // 1. If explicit customer_id is provided, verify it exists
    if (customer_id) {
      const [rows] = await db.execute(
        'SELECT * FROM customers WHERE id = ? AND restaurant_id = ?',
        [customer_id, restaurantId]
      );
      if (rows.length > 0) {
        return rows[0];
      }
    }

    const effectiveName = (name || customer_name || store_name || '').trim();
    const effectivePhone = (phone || customer_phone || '').trim();
    const effectiveAddress = (address || customer_address || '').trim();
    const effectiveStore = (store_name || '').trim();

    // If no identifying info is provided at all, return null
    if (!effectiveName && !effectivePhone && !effectiveStore) {
      return null;
    }

    // 2. Lookup by phone first if phone is provided
    if (effectivePhone) {
      const byPhone = await this.findByPhone(restaurantId, effectivePhone, db);
      if (byPhone) {
        // If additional details provided, update them
        if (effectiveAddress && !byPhone.address) {
          await this.update(byPhone.id, restaurantId, { address: effectiveAddress }, db);
          byPhone.address = effectiveAddress;
        }
        if (effectiveStore && !byPhone.store_name) {
          await this.update(byPhone.id, restaurantId, { store_name: effectiveStore }, db);
          byPhone.store_name = effectiveStore;
        }
        return byPhone;
      }
    }

    // 3. Lookup by name if non-generic and no phone was specified
    if (!effectivePhone && effectiveName && effectiveName.toLowerCase() !== 'walk-in customer') {
      const byName = await this.findByName(restaurantId, effectiveName, db);
      if (byName) {
        return byName;
      }
    }

    // 4. Not found -> Automatically create new customer record
    return await this.create(restaurantId, {
      name: effectiveName || 'Walk-in Customer',
      phone: effectivePhone || null,
      email: email || null,
      address: effectiveAddress || null,
      store_name: effectiveStore || null,
      gst_number: gst_number || null
    }, db);
  }
}

module.exports = CustomerRepository;
