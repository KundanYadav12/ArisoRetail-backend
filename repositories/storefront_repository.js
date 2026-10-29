const pool = require('../config/db');
const crypto = require('crypto');
const CustomerRepository = require('./customer_repository');
const QRCode = require('qrcode');
const { validateSubdomain } = require('../utils/subdomain_validator');
const { validateCustomDomain, normalizeDomain } = require('../utils/domain_validator');
const DomainVerificationService = require('../services/domain_verification_service');

class StorefrontRepository {
  /**
   * Resolve public storefront by subdomain, custom domain, or ID
   */
  static async resolveStore(subdomainOrIdentifier) {
    if (!subdomainOrIdentifier) return null;

    const rawTerm = String(subdomainOrIdentifier).trim().toLowerCase();
    const cleanTerm = rawTerm.replace(/:\d+$/, '').replace(/\.$/, ''); // strip port and trailing dot
    const withoutWww = cleanTerm.startsWith('www.') ? cleanTerm.substring(4) : cleanTerm;

    // 1. Check merchant_custom_domains table for active, verified custom domain
    let customDomainStoreId = null;
    try {
      const [cdRows] = await pool.execute(`
        SELECT restaurant_id, domain, include_www, is_active, verification_status 
        FROM merchant_custom_domains 
        WHERE (LOWER(domain) = ? OR LOWER(domain) = ?) 
          AND is_active = 1 
          AND verification_status = 'verified'
        LIMIT 1
      `, [cleanTerm, withoutWww]);

      if (cdRows.length > 0) {
        const match = cdRows[0];
        // If accessed with www, check if include_www is true or if apex domain matches
        if (!cleanTerm.startsWith('www.') || match.include_www || match.domain.toLowerCase() === cleanTerm) {
          customDomainStoreId = match.restaurant_id;
        }
      }
    } catch (cdErr) {
      console.warn('[Custom Domain Resolution Notice]:', cdErr.message);
    }

    // 2. Query restaurant by subdomain, domain column, custom domain match, or integer ID
    const isId = !isNaN(parseInt(cleanTerm, 10)) && !cleanTerm.includes('.');
    const numericId = isId ? parseInt(cleanTerm, 10) : -1;

    let query = `
      SELECT 
        r.id, r.name, r.domain, r.subdomain, r.logo_url, r.address, r.phone, r.email,
        r.gst_number, r.online_store_enabled, r.store_tagline, r.store_banner_url,
        r.store_theme_color, r.store_about, r.store_announcement, r.delivery_enabled,
        r.pickup_enabled, r.min_order_value, r.delivery_charge, r.free_delivery_threshold,
        r.estimated_delivery_time, r.delivery_instructions, r.store_contact_email,
        r.store_contact_phone, r.store_contact_whatsapp, r.store_qr_code_url,
        r.subscription_status
      FROM restaurants r
      WHERE (
        LOWER(r.subdomain) = ? 
        OR LOWER(r.subdomain) = ?
        OR LOWER(r.domain) = ? 
        OR LOWER(r.domain) = ?
        OR r.id = ?
        ${customDomainStoreId ? `OR r.id = ${customDomainStoreId}` : ''}
      )
      LIMIT 1
    `;

    const [rows] = await pool.execute(query, [cleanTerm, withoutWww, cleanTerm, withoutWww, numericId]);

    if (rows.length === 0) return null;

    const store = rows[0];

    // Fetch public payment options (no secrets!)
    const [pRows] = await pool.execute(`
      SELECT 
        razorpay_enabled, 
        razorpay_key_id, 
        paytm_enabled,
        paytm_mid,
        phonepe_enabled,
        phonepe_merchant_id,
        default_online_gateway,
        cod_enabled, 
        upi_qr_enabled, 
        upi_id
      FROM merchant_payment_settings
      WHERE restaurant_id = ?
      LIMIT 1
    `, [store.id]);

    const paymentConfig = pRows[0] || {
      razorpay_enabled: 0,
      razorpay_key_id: null,
      paytm_enabled: 0,
      paytm_mid: null,
      phonepe_enabled: 0,
      phonepe_merchant_id: null,
      default_online_gateway: 'razorpay',
      cod_enabled: 1,
      upi_qr_enabled: 0,
      upi_id: null
    };

    return {
      id: store.id,
      name: store.name,
      domain: store.domain,
      subdomain: store.subdomain,
      logo_url: store.logo_url,
      address: store.address,
      phone: store.phone,
      email: store.email,
      gst_number: store.gst_number,
      online_store_enabled: Boolean(store.online_store_enabled),
      store_tagline: store.store_tagline || 'Shop Quality Products Online',
      store_banner_url: store.store_banner_url,
      store_theme_color: store.store_theme_color || '#ea580c',
      store_about: store.store_about,
      store_announcement: store.store_announcement,
      delivery_enabled: store.delivery_enabled !== 0,
      pickup_enabled: store.pickup_enabled !== 0,
      min_order_value: parseFloat(store.min_order_value || 0),
      delivery_charge: parseFloat(store.delivery_charge || 0),
      free_delivery_threshold: parseFloat(store.free_delivery_threshold || 0),
      estimated_delivery_time: store.estimated_delivery_time || '30-45 mins',
      delivery_instructions: store.delivery_instructions,
      contact: {
        email: store.store_contact_email || store.email,
        phone: store.store_contact_phone || store.phone,
        whatsapp: store.store_contact_whatsapp || store.phone
      },
      payment_methods: {
        cod: Boolean(paymentConfig.cod_enabled),
        razorpay: Boolean(paymentConfig.razorpay_enabled && paymentConfig.razorpay_key_id),
        razorpay_key_id: paymentConfig.razorpay_enabled ? paymentConfig.razorpay_key_id : null,
        paytm: Boolean(paymentConfig.paytm_enabled && paymentConfig.paytm_mid),
        paytm_mid: paymentConfig.paytm_enabled ? paymentConfig.paytm_mid : null,
        phonepe: Boolean(paymentConfig.phonepe_enabled && paymentConfig.phonepe_merchant_id),
        phonepe_merchant_id: paymentConfig.phonepe_enabled ? paymentConfig.phonepe_merchant_id : null,
        default_online_gateway: paymentConfig.default_online_gateway || 'razorpay',
        upi: Boolean(paymentConfig.upi_qr_enabled && paymentConfig.upi_id),
        upi_id: paymentConfig.upi_qr_enabled ? paymentConfig.upi_id : null
      },
      is_active: store.subscription_status === 'active' || store.subscription_status === 'trial'
    };
  }

  /**
   * Get public store catalog (categories & products)
   */
  static async getStoreCatalog(restaurantId, { categoryId, search, featuredOnly } = {}) {
    // 1. Fetch Categories that have online items
    const [catRows] = await pool.execute(`
      SELECT DISTINCT c.id, c.name, c.seq
      FROM categories c
      INNER JOIN menu_items m ON m.category_id = c.id
      WHERE m.restaurant_id = ? 
        AND m.available_online = 1 
        AND m.is_available = 1
      ORDER BY c.seq ASC, c.name ASC
    `, [restaurantId]);

    // 2. Fetch Products available online
    let query = `
      SELECT 
        m.id, m.category_id, c.name as category_name, m.name, m.description, 
        m.online_description, m.price, m.online_price, m.mrp, m.is_veg, 
        m.is_available, m.available_online, m.is_featured_online, m.image_url, 
        m.unit, m.current_stock, m.reserved_stock, m.track_inventory, 
        m.is_weight_based, m.min_sale_qty, m.max_sale_qty, m.gst_rate,
        m.online_seq
      FROM menu_items m
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE m.restaurant_id = ? 
        AND m.available_online = 1 
        AND m.is_available = 1
    `;
    const params = [restaurantId];

    if (categoryId) {
      query += ` AND m.category_id = ?`;
      params.push(categoryId);
    }

    if (featuredOnly) {
      query += ` AND m.is_featured_online = 1`;
    }

    if (search && search.trim()) {
      query += ` AND (m.name LIKE ? OR m.description LIKE ? OR m.online_description LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY m.is_featured_online DESC, m.online_seq ASC, m.name ASC`;

    const [prodRows] = await pool.execute(query, params);

    const products = prodRows.map(p => {
      const currentStock = parseFloat(p.current_stock || 0);
      const reservedStock = parseFloat(p.reserved_stock || 0);
      const availableStock = p.track_inventory === 0 ? 9999 : Math.max(0, currentStock - reservedStock);
      const inStock = p.track_inventory === 0 || availableStock > 0;
      const effectivePrice = p.online_price !== null && p.online_price !== undefined 
        ? parseFloat(p.online_price) 
        : parseFloat(p.price || 0);
      const effectiveMrp = p.mrp ? parseFloat(p.mrp) : effectivePrice;
      const savings = Math.max(0, effectiveMrp - effectivePrice);

      return {
        id: p.id,
        category_id: p.category_id,
        category_name: p.category_name || 'General',
        name: p.name,
        description: p.online_description || p.description || '',
        price: effectivePrice,
        original_price: parseFloat(p.price || 0),
        mrp: effectiveMrp,
        savings: savings,
        discount_percentage: effectiveMrp > effectivePrice ? Math.round((savings / effectiveMrp) * 100) : 0,
        is_veg: Boolean(p.is_veg),
        image_url: p.image_url,
        unit: p.unit || 'pcs',
        is_weight_based: Boolean(p.is_weight_based),
        min_qty: parseFloat(p.min_sale_qty || 1),
        max_qty: Math.min(parseFloat(p.max_sale_qty || 100), availableStock),
        available_stock: availableStock,
        in_stock: inStock,
        gst_rate: parseFloat(p.gst_rate || 0),
        is_featured: Boolean(p.is_featured_online)
      };
    });

    return {
      categories: catRows,
      products
    };
  }

  /**
   * Get single product details
   */
  static async getProductDetails(restaurantId, productId) {
    const [rows] = await pool.execute(`
      SELECT 
        m.id, m.category_id, c.name as category_name, m.name, m.description, 
        m.online_description, m.price, m.online_price, m.mrp, m.is_veg, 
        m.is_available, m.available_online, m.is_featured_online, m.image_url, 
        m.unit, m.current_stock, m.reserved_stock, m.track_inventory, 
        m.is_weight_based, m.min_sale_qty, m.max_sale_qty, m.gst_rate
      FROM menu_items m
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE m.restaurant_id = ? AND m.id = ? AND m.available_online = 1 AND m.is_available = 1
      LIMIT 1
    `, [restaurantId, productId]);

    if (rows.length === 0) return null;

    const p = rows[0];
    const currentStock = parseFloat(p.current_stock || 0);
    const reservedStock = parseFloat(p.reserved_stock || 0);
    const availableStock = p.track_inventory === 0 ? 9999 : Math.max(0, currentStock - reservedStock);
    const inStock = p.track_inventory === 0 || availableStock > 0;
    const effectivePrice = p.online_price !== null && p.online_price !== undefined 
      ? parseFloat(p.online_price) 
      : parseFloat(p.price || 0);
    const effectiveMrp = p.mrp ? parseFloat(p.mrp) : effectivePrice;

    return {
      id: p.id,
      category_id: p.category_id,
      category_name: p.category_name,
      name: p.name,
      description: p.online_description || p.description || '',
      price: effectivePrice,
      mrp: effectiveMrp,
      savings: Math.max(0, effectiveMrp - effectivePrice),
      is_veg: Boolean(p.is_veg),
      image_url: p.image_url,
      unit: p.unit || 'pcs',
      is_weight_based: Boolean(p.is_weight_based),
      available_stock: availableStock,
      in_stock: inStock,
      gst_rate: parseFloat(p.gst_rate || 0),
      is_featured: Boolean(p.is_featured_online)
    };
  }

  /**
   * Revalidate cart, prices, stock availability, and totals on backend
   */
  static async validateCart(restaurantId, rawItems, deliveryPreference = 'delivery') {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      throw new Error('Cart is empty.');
    }

    // 1. Fetch store delivery parameters
    const [storeRows] = await pool.execute(`
      SELECT min_order_value, delivery_charge, free_delivery_threshold, delivery_enabled, pickup_enabled
      FROM restaurants
      WHERE id = ?
    `, [restaurantId]);

    const storeSettings = storeRows[0] || {};
    const minOrderValue = parseFloat(storeSettings.min_order_value || 0);
    const deliveryCharge = parseFloat(storeSettings.delivery_charge || 0);
    const freeDeliveryThreshold = parseFloat(storeSettings.free_delivery_threshold || 0);

    const validatedItems = [];
    let subtotal = 0;
    let totalTax = 0;

    for (const item of rawItems) {
      const productId = item.id || item.product_id || item.menu_item_id;
      const requestedQty = parseFloat(item.quantity || 1);

      if (isNaN(requestedQty) || requestedQty <= 0) {
        throw new Error(`Invalid quantity for item ID ${productId}.`);
      }

      const [rows] = await pool.execute(`
        SELECT 
          id, name, price, online_price, mrp, gst_rate, current_stock, reserved_stock,
          track_inventory, is_available, available_online, unit, is_weight_based, image_url
        FROM menu_items
        WHERE id = ? AND restaurant_id = ?
        LIMIT 1
      `, [productId, restaurantId]);

      if (rows.length === 0 || rows[0].available_online === 0 || rows[0].is_available === 0) {
        throw new Error(`Product "${item.name || productId}" is no longer available online.`);
      }

      const p = rows[0];
      const currentStock = parseFloat(p.current_stock || 0);
      const reservedStock = parseFloat(p.reserved_stock || 0);
      const availableStock = p.track_inventory === 0 ? 9999 : Math.max(0, currentStock - reservedStock);

      if (p.track_inventory !== 0 && requestedQty > availableStock) {
        throw new Error(`Insufficient stock for "${p.name}". Requested: ${requestedQty} ${p.unit || 'pcs'}, but only ${availableStock} ${p.unit || 'pcs'} is available.`);
      }

      const effectiveUnitPrice = p.online_price !== null && p.online_price !== undefined 
        ? parseFloat(p.online_price) 
        : parseFloat(p.price || 0);
      const lineSubtotal = Math.round(effectiveUnitPrice * requestedQty * 100) / 100;
      const gstRate = parseFloat(p.gst_rate || 0);
      const lineTax = Math.round(((lineSubtotal * gstRate) / 100) * 100) / 100;
      const lineTotal = lineSubtotal + lineTax;

      subtotal += lineSubtotal;
      totalTax += lineTax;

      validatedItems.push({
        menu_item_id: p.id,
        name: p.name,
        quantity: requestedQty,
        unit_price: effectiveUnitPrice,
        mrp: p.mrp ? parseFloat(p.mrp) : effectiveUnitPrice,
        gst_rate: gstRate,
        tax_amount: lineTax,
        line_total: lineTotal,
        unit: p.unit || 'pcs',
        image_url: p.image_url
      });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;

    let deliveryFee = 0;
    if (deliveryPreference === 'delivery') {
      if (freeDeliveryThreshold > 0 && subtotal >= freeDeliveryThreshold) {
        deliveryFee = 0;
      } else {
        deliveryFee = deliveryCharge;
      }
    }

    const grandTotal = Math.round((subtotal + totalTax + deliveryFee) * 100) / 100;
    const meetsMinOrder = subtotal >= minOrderValue;

    return {
      items: validatedItems,
      subtotal,
      tax_amount: totalTax,
      delivery_fee: deliveryFee,
      total_amount: grandTotal,
      min_order_value: minOrderValue,
      meets_min_order: meetsMinOrder,
      free_delivery_threshold: freeDeliveryThreshold
    };
  }

  /**
   * Concurrency-safe Online Order Placement
   */
  static async createOnlineOrder(restaurantId, {
    customerName,
    customerPhone,
    customerEmail,
    deliveryAddress,
    deliveryCity,
    deliveryState,
    deliveryPincode,
    deliveryInstructions,
    deliveryPreference = 'delivery',
    paymentMode = 'cod',
    paymentGateway = null,
    items,
    gatewayOrderId = null,
    gatewayPaymentId = null,
    gatewaySignature = null,
    initialPaymentStatus = 'pending'
  }) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Authoritative Cart & Stock Validation inside transaction with lock
      const validated = await this.validateCart(restaurantId, items, deliveryPreference);

      if (!validated.meets_min_order) {
        throw new Error(`Order minimum value of ₹${validated.min_order_value.toFixed(2)} has not been met (Current subtotal: ₹${validated.subtotal.toFixed(2)}).`);
      }

      // 2. Concurrency-Safe Order Number (WEB-YYYYMMDD-XXXX)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const dateStr = `${year}${month}${day}`;
      const prefix = `WEB-${dateStr}-`;

      await connection.execute(`
        INSERT IGNORE INTO order_sequences (restaurant_id, order_date, last_seq) VALUES (?, ?, 0)
      `, [restaurantId, dateStr]);

      const [seqRows] = await connection.execute(`
        SELECT last_seq FROM order_sequences WHERE restaurant_id = ? AND order_date = ? FOR UPDATE
      `, [restaurantId, dateStr]);

      let seq = parseInt(seqRows[0]?.last_seq || 0, 10) + 1;
      await connection.execute(`
        UPDATE order_sequences SET last_seq = ? WHERE restaurant_id = ? AND order_date = ?
      `, [seq, restaurantId, dateStr]);

      const uniqueOrderNumber = `${prefix}${String(seq).padStart(4, '0')}`;
      const orderAccessToken = crypto.randomBytes(24).toString('hex');

      // 3. Resolve Customer record
      let customerId = null;
      try {
        const cust = await CustomerRepository.findOrCreate(restaurantId, {
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_address: deliveryAddress
        }, connection);
        if (cust) customerId = cust.id;
      } catch (cErr) {
        console.warn('[Online Order Customer Lookup Warning]:', cErr.message);
      }

      // 4. Reserve stock on menu_items for each line item
      for (const item of validated.items) {
        const [mRows] = await connection.execute(`
          SELECT name, track_inventory, current_stock, reserved_stock, unit 
          FROM menu_items 
          WHERE id = ? AND restaurant_id = ? FOR UPDATE
        `, [item.menu_item_id, restaurantId]);

        if (mRows.length > 0 && mRows[0].track_inventory !== 0) {
          const m = mRows[0];
          const curr = parseFloat(m.current_stock || 0);
          const res = parseFloat(m.reserved_stock || 0);
          const avail = curr - res;

          if (item.quantity > avail) {
            throw new Error(`Stock for "${m.name}" ran out just now. Only ${avail} ${m.unit || 'pcs'} left.`);
          }

          await connection.execute(`
            UPDATE menu_items 
            SET reserved_stock = reserved_stock + ? 
            WHERE id = ? AND restaurant_id = ?
          `, [item.quantity, item.menu_item_id, restaurantId]);
        }
      }

      // 5. Insert into `orders`
      const [orderRes] = await connection.execute(`
        INSERT INTO orders (
          order_number, unique_order_number, restaurant_id, customer_id, customer_name,
          customer_phone, subtotal, tax_amount, discount_amount, delivery_fee, total_amount,
          paid_amount, payment_mode, payment_status, order_status, online_order_status,
          is_online, order_source, order_access_token, delivery_city, delivery_state,
          delivery_pincode, delivery_instructions, delivery_preference, shipping_address,
          gateway_order_id, gateway_payment_id, gateway_signature, order_type, table_number_or_takeaway,
          payment_gateway
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, 0.00, ?, ?,
          ?, ?, ?, 'pending', 'pending',
          1, 'online', ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?
        )
      `, [
        uniqueOrderNumber, uniqueOrderNumber, restaurantId, customerId, customerName,
        customerPhone, validated.subtotal, validated.tax_amount, validated.delivery_fee, validated.total_amount,
        initialPaymentStatus === 'paid' ? validated.total_amount : 0.00,
        paymentMode, initialPaymentStatus,
        orderAccessToken, deliveryCity || null, deliveryState || null,
        deliveryPincode || null, deliveryInstructions || null, deliveryPreference, deliveryAddress,
        gatewayOrderId || null, gatewayPaymentId || null, gatewaySignature || null,
        deliveryPreference === 'pickup' ? 'takeaway' : 'delivery',
        deliveryPreference === 'pickup' ? 'Online Pickup' : 'Online Delivery',
        paymentGateway || (paymentMode === 'cod' ? 'cod' : paymentMode)
      ]);

      const orderId = orderRes.insertId;

      // 6. Insert order items snapshots
      for (const item of validated.items) {
        await connection.execute(`
          INSERT INTO order_items (
            order_id, menu_item_id, item_name, name, unit_price, price,
            quantity, gst_rate, tax_amount, total_price, mrp, unit_rate,
            original_rate
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          orderId, item.menu_item_id, item.name, item.name, item.unit_price, item.unit_price,
          item.quantity, item.gst_rate, item.tax_amount, item.line_total, item.mrp, item.unit_price,
          item.unit_price
        ]);
      }

      await connection.commit();

      return {
        order_id: orderId,
        order_number: uniqueOrderNumber,
        order_access_token: orderAccessToken,
        total_amount: validated.total_amount,
        subtotal: validated.subtotal,
        delivery_fee: validated.delivery_fee,
        tax_amount: validated.tax_amount,
        payment_status: initialPaymentStatus,
        online_order_status: 'pending',
        items_count: validated.items.length
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Update Online Order Status (Accept/Reject/Dispatch/Complete) with Stock Consistency
   */
  static async updateOnlineOrderStatus(restaurantId, orderId, newStatus, reason = null, actor = 'Merchant') {
    const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'dispatched', 'completed', 'rejected', 'cancelled'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Lock order
      const [orderRows] = await connection.execute(`
        SELECT 
          id, unique_order_number, online_order_status, order_status, total_amount,
          payment_status, payment_mode, gateway_payment_id, customer_name, customer_phone
        FROM orders
        WHERE id = ? AND restaurant_id = ? FOR UPDATE
      `, [orderId, restaurantId]);

      if (orderRows.length === 0) {
        throw new Error('Order not found.');
      }

      const ord = orderRows[0];
      const prevStatus = ord.online_order_status || 'pending';

      if (prevStatus === 'completed') {
        throw new Error('Completed orders cannot be modified.');
      }
      if (prevStatus === 'rejected' || prevStatus === 'cancelled') {
        throw new Error(`Order is already ${prevStatus} and cannot be updated.`);
      }

      // Fetch items in order to adjust stock
      const [items] = await connection.execute(`
        SELECT menu_item_id, quantity, item_name 
        FROM order_items 
        WHERE order_id = ?
      `, [orderId]);

      let targetOrderStatus = 'pending';
      let targetPaymentStatus = ord.payment_status;

      if (newStatus === 'completed') {
        targetOrderStatus = 'completed';
        if (ord.payment_mode === 'cod') {
          targetPaymentStatus = 'paid';
        }

        // Deduct from physical stock, release reserved stock
        for (const item of items) {
          if (item.menu_item_id) {
            await connection.execute(`
              UPDATE menu_items 
              SET 
                current_stock = GREATEST(0, current_stock - ?),
                reserved_stock = GREATEST(0, reserved_stock - ?)
              WHERE id = ? AND restaurant_id = ?
            `, [item.quantity, item.quantity, item.menu_item_id, restaurantId]);

            // Add stock log
            await connection.execute(`
              INSERT INTO stock_logs (restaurant_id, menu_item_id, user_name, adjustment_type, quantity, reason)
              VALUES (?, ?, ?, 'sale', ?, ?)
            `, [restaurantId, item.menu_item_id, actor, item.quantity, `Online Order #${ord.unique_order_number} Delivered`]).catch(() => {});
          }
        }
      } else if (newStatus === 'rejected' || newStatus === 'cancelled') {
        targetOrderStatus = 'cancelled';

        // Release reserved stock!
        for (const item of items) {
          if (item.menu_item_id) {
            await connection.execute(`
              UPDATE menu_items 
              SET reserved_stock = GREATEST(0, reserved_stock - ?)
              WHERE id = ? AND restaurant_id = ?
            `, [item.quantity, item.menu_item_id, restaurantId]);
          }
        }

        // Check if refund needed
        if (ord.payment_status === 'paid' && ord.payment_mode === 'razorpay') {
          targetPaymentStatus = 'refund_pending';
        }
      } else if (newStatus === 'confirmed') {
        targetOrderStatus = 'active';
      }

      await connection.execute(`
        UPDATE orders 
        SET 
          online_order_status = ?,
          order_status = ?,
          payment_status = ?,
          rejection_reason = ?,
          updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [newStatus, targetOrderStatus, targetPaymentStatus, reason || null, orderId, restaurantId]);

      await connection.commit();

      return {
        order_id: orderId,
        order_number: ord.unique_order_number,
        previous_status: prevStatus,
        new_status: newStatus,
        payment_status: targetPaymentStatus,
        customer_name: ord.customer_name,
        customer_phone: ord.customer_phone
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Get Online Order by ID for Merchant Dashboard
   */
  static async getOnlineOrderById(restaurantId, orderId) {
    const [orderRows] = await pool.execute(`
      SELECT 
        o.id, o.unique_order_number, o.order_number, o.created_at, o.subtotal,
        o.tax_amount, o.delivery_fee, o.total_amount, o.paid_amount, o.payment_mode,
        o.payment_status, o.online_order_status, o.rejection_reason, o.customer_name,
        o.customer_phone, o.delivery_city, o.delivery_state, o.delivery_pincode,
        o.delivery_instructions, o.delivery_preference, o.shipping_address,
        o.gateway_order_id, o.gateway_payment_id, o.order_access_token
      FROM orders o
      WHERE o.id = ? AND o.restaurant_id = ?
      LIMIT 1
    `, [orderId, restaurantId]);

    if (orderRows.length === 0) return null;

    const order = orderRows[0];

    const [itemRows] = await pool.execute(`
      SELECT 
        oi.id, oi.menu_item_id, oi.item_name, oi.unit_price, oi.quantity,
        oi.gst_rate, oi.tax_amount, oi.total_price, oi.mrp, m.image_url, m.unit
      FROM order_items oi
      LEFT JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE oi.order_id = ?
    `, [orderId]);

    return {
      ...order,
      items: itemRows
    };
  }

  /**
   * Get Online Order for Customer by Order Number & Token or Phone
   */
  static async getCustomerOrderStatus(subdomain, orderNumber, { token, phone }) {
    const store = await this.resolveStore(subdomain);
    if (!store) return null;

    let query = `
      SELECT 
        o.id, o.unique_order_number, o.created_at, o.subtotal, o.tax_amount,
        o.delivery_fee, o.total_amount, o.payment_mode, o.payment_status,
        o.online_order_status, o.rejection_reason, o.customer_name, o.customer_phone,
        o.delivery_city, o.delivery_state, o.delivery_pincode, o.delivery_instructions,
        o.delivery_preference, o.shipping_address
      FROM orders o
      WHERE o.restaurant_id = ? AND o.unique_order_number = ?
    `;
    const params = [store.id, orderNumber];

    if (token) {
      query += ` AND o.order_access_token = ?`;
      params.push(token);
    } else if (phone) {
      query += ` AND (o.customer_phone = ? OR o.customer_phone LIKE ?)`;
      params.push(phone, `%${phone.slice(-10)}`);
    } else {
      return { error: 'Authentication required. Please provide tracking token or customer phone number.' };
    }

    const [rows] = await pool.execute(query, params);
    if (rows.length === 0) return null;

    const ord = rows[0];

    const [itemRows] = await pool.execute(`
      SELECT item_name, unit_price, quantity, total_price, mrp
      FROM order_items
      WHERE order_id = ?
    `, [ord.id]);

    return {
      store: {
        name: store.name,
        phone: store.phone,
        logo_url: store.logo_url,
        theme_color: store.store_theme_color
      },
      order: {
        ...ord,
        items: itemRows
      }
    };
  }

  /**
   * Get Merchant Online Orders list
   */
  static async getMerchantOrders(restaurantId, { status, search, fromDate, toDate, page = 1, limit = 20 } = {}) {
    let query = `
      SELECT 
        o.id, o.unique_order_number, o.created_at, o.subtotal, o.tax_amount,
        o.delivery_fee, o.total_amount, o.payment_mode, o.payment_status,
        o.online_order_status, o.customer_name, o.customer_phone, o.delivery_preference,
        COUNT(oi.id) as items_count
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.restaurant_id = ? AND o.is_online = 1
    `;
    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ` AND o.online_order_status = ?`;
      params.push(status);
    }

    if (search && search.trim()) {
      query += ` AND (o.unique_order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (fromDate) {
      query += ` AND o.created_at >= ?`;
      params.push(`${fromDate} 00:00:00`);
    }
    if (toDate) {
      query += ` AND o.created_at <= ?`;
      params.push(`${toDate} 23:59:59`);
    }

    query += ` GROUP BY o.id ORDER BY o.id DESC`;

    // Pagination
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    query += ` LIMIT ${parseInt(limit, 10)} OFFSET ${offset}`;

    const [rows] = await pool.execute(query, params);

    // Total count query
    let countQuery = `
      SELECT COUNT(DISTINCT o.id) as total 
      FROM orders o 
      WHERE o.restaurant_id = ? AND o.is_online = 1
    `;
    const countParams = [restaurantId];
    if (status && status !== 'all') {
      countQuery += ` AND o.online_order_status = ?`;
      countParams.push(status);
    }
    if (search && search.trim()) {
      countQuery += ` AND (o.unique_order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)`;
      const term = `%${search.trim()}%`;
      countParams.push(term, term, term);
    }
    if (fromDate) {
      countQuery += ` AND o.created_at >= ?`;
      countParams.push(`${fromDate} 00:00:00`);
    }
    if (toDate) {
      countQuery += ` AND o.created_at <= ?`;
      countParams.push(`${toDate} 23:59:59`);
    }

    const [countRows] = await pool.execute(countQuery, countParams);
    const total = countRows[0]?.total || 0;

    return {
      orders: rows,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Merchant Storefront Settings
   */
  static async getMerchantStoreSettings(restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        id, name, subdomain, domain, logo_url, online_store_enabled,
        store_tagline, store_banner_url, store_theme_color, store_about,
        store_announcement, delivery_enabled, pickup_enabled, min_order_value,
        delivery_charge, free_delivery_threshold, estimated_delivery_time,
        delivery_instructions, store_contact_email, store_contact_phone,
        store_contact_whatsapp, store_qr_code_url
      FROM restaurants
      WHERE id = ?
      LIMIT 1
    `, [restaurantId]);

    if (rows.length === 0) return null;

    const r = rows[0];
    const storeUrl = r.subdomain ? `https://${r.subdomain}.arisopos.in` : null;

    return {
      ...r,
      store_url: storeUrl,
      online_store_enabled: Boolean(r.online_store_enabled)
    };
  }

  static async updateMerchantStoreSettings(restaurantId, settings) {
    const fields = [
      'store_tagline', 'store_banner_url', 'store_theme_color', 'store_about',
      'store_announcement', 'delivery_enabled', 'pickup_enabled', 'min_order_value',
      'delivery_charge', 'free_delivery_threshold', 'estimated_delivery_time',
      'delivery_instructions', 'store_contact_email', 'store_contact_phone',
      'store_contact_whatsapp', 'online_store_enabled'
    ];

    const updates = [];
    const params = [];

    for (const f of fields) {
      if (settings[f] !== undefined) {
        updates.push(`\`${f}\` = ?`);
        params.push(settings[f]);
      }
    }

    if (updates.length === 0) return await this.getMerchantStoreSettings(restaurantId);

    params.push(restaurantId);
    await pool.execute(`
      UPDATE restaurants 
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = ?
    `, params);

    return await this.getMerchantStoreSettings(restaurantId);
  }

  /**
   * Merchant Payment Settings
   */
  static async getMerchantPaymentSettings(restaurantId, includeSecrets = false) {
    const [rows] = await pool.execute(`
      SELECT * FROM merchant_payment_settings WHERE restaurant_id = ? LIMIT 1
    `, [restaurantId]);

    if (rows.length === 0) {
      // Default initialization
      await pool.execute(`
        INSERT IGNORE INTO merchant_payment_settings (restaurant_id, cod_enabled, razorpay_enabled, default_online_gateway)
        VALUES (?, 1, 0, 'razorpay')
      `, [restaurantId]);
      return await this.getMerchantPaymentSettings(restaurantId, includeSecrets);
    }

    const p = rows[0];
    return {
      id: p.id,
      restaurant_id: p.restaurant_id,

      // Razorpay
      razorpay_enabled: Boolean(p.razorpay_enabled),
      razorpay_key_id: p.razorpay_key_id || '',
      razorpay_key_secret: includeSecrets ? p.razorpay_key_secret : (p.razorpay_key_secret ? '••••••••••••••••' : ''),
      razorpay_webhook_secret: includeSecrets ? p.razorpay_webhook_secret : (p.razorpay_webhook_secret ? '••••••••••••••••' : ''),
      has_key_secret: Boolean(p.razorpay_key_secret),
      has_webhook_secret: Boolean(p.razorpay_webhook_secret),

      // Paytm
      paytm_enabled: Boolean(p.paytm_enabled),
      paytm_mid: p.paytm_mid || '',
      paytm_merchant_key: includeSecrets ? p.paytm_merchant_key : (p.paytm_merchant_key ? '••••••••••••••••' : ''),
      has_paytm_key: Boolean(p.paytm_merchant_key),
      paytm_website: p.paytm_website || 'DEFAULT',
      paytm_industry_type_id: p.paytm_industry_type_id || 'Retail',
      paytm_channel_id: p.paytm_channel_id || 'WEB',
      paytm_mode: p.paytm_mode || 'sandbox',

      // PhonePe
      phonepe_enabled: Boolean(p.phonepe_enabled),
      phonepe_merchant_id: p.phonepe_merchant_id || '',
      phonepe_salt_key: includeSecrets ? p.phonepe_salt_key : (p.phonepe_salt_key ? '••••••••••••••••' : ''),
      has_phonepe_salt_key: Boolean(p.phonepe_salt_key),
      phonepe_salt_index: parseInt(p.phonepe_salt_index || 1, 10),
      phonepe_mode: p.phonepe_mode || 'sandbox',

      // Default Gateway
      default_online_gateway: p.default_online_gateway || 'razorpay',

      // Offline & Settlement
      cod_enabled: Boolean(p.cod_enabled),
      upi_qr_enabled: Boolean(p.upi_qr_enabled),
      upi_id: p.upi_id || '',
      account_holder_name: p.account_holder_name || '',
      bank_name: p.bank_name || '',
      account_number: p.account_number || '',
      ifsc_code: p.ifsc_code || '',
      settlement_notes: p.settlement_notes || ''
    };
  }

  static async updateMerchantPaymentSettings(restaurantId, data) {
    const [existing] = await pool.execute('SELECT * FROM merchant_payment_settings WHERE restaurant_id = ? LIMIT 1', [restaurantId]);
    const ex = existing[0] || {};

    const razorpayEnabled = data.razorpay_enabled !== undefined ? (data.razorpay_enabled ? 1 : 0) : (ex.razorpay_enabled || 0);
    const razorpayKeyId = data.razorpay_key_id !== undefined ? (data.razorpay_key_id ? data.razorpay_key_id.trim() : null) : (ex.razorpay_key_id || null);
    
    // Only update secrets if a new non-masked value is supplied
    let razorpayKeySecret = ex.razorpay_key_secret || null;
    if (data.razorpay_key_secret && !data.razorpay_key_secret.includes('••••')) {
      razorpayKeySecret = data.razorpay_key_secret.trim();
    }

    let razorpayWebhookSecret = ex.razorpay_webhook_secret || null;
    if (data.razorpay_webhook_secret && !data.razorpay_webhook_secret.includes('••••')) {
      razorpayWebhookSecret = data.razorpay_webhook_secret.trim();
    }

    // Paytm
    const paytmEnabled = data.paytm_enabled !== undefined ? (data.paytm_enabled ? 1 : 0) : (ex.paytm_enabled || 0);
    const paytmMid = data.paytm_mid !== undefined ? (data.paytm_mid ? data.paytm_mid.trim() : null) : (ex.paytm_mid || null);
    let paytmMerchantKey = ex.paytm_merchant_key || null;
    if (data.paytm_merchant_key && !data.paytm_merchant_key.includes('••••')) {
      paytmMerchantKey = data.paytm_merchant_key.trim();
    }
    const paytmWebsite = data.paytm_website ? data.paytm_website.trim() : (ex.paytm_website || 'DEFAULT');
    const paytmIndustry = data.paytm_industry_type_id ? data.paytm_industry_type_id.trim() : (ex.paytm_industry_type_id || 'Retail');
    const paytmChannel = data.paytm_channel_id ? data.paytm_channel_id.trim() : (ex.paytm_channel_id || 'WEB');
    const paytmMode = data.paytm_mode === 'production' ? 'production' : 'sandbox';

    // PhonePe
    const phonepeEnabled = data.phonepe_enabled !== undefined ? (data.phonepe_enabled ? 1 : 0) : (ex.phonepe_enabled || 0);
    const phonepeMid = data.phonepe_merchant_id !== undefined ? (data.phonepe_merchant_id ? data.phonepe_merchant_id.trim() : null) : (ex.phonepe_merchant_id || null);
    let phonepeSaltKey = ex.phonepe_salt_key || null;
    if (data.phonepe_salt_key && !data.phonepe_salt_key.includes('••••')) {
      phonepeSaltKey = data.phonepe_salt_key.trim();
    }
    const phonepeSaltIndex = data.phonepe_salt_index !== undefined ? parseInt(data.phonepe_salt_index, 10) || 1 : (ex.phonepe_salt_index || 1);
    const phonepeMode = data.phonepe_mode === 'production' ? 'production' : 'sandbox';

    // Default Gateway
    const defaultOnlineGateway = ['razorpay', 'paytm', 'phonepe'].includes(data.default_online_gateway)
      ? data.default_online_gateway
      : (ex.default_online_gateway || 'razorpay');

    // Offline & Settlement
    const codEnabled = data.cod_enabled !== undefined ? (data.cod_enabled ? 1 : 0) : (ex.cod_enabled ?? 1);
    const upiQrEnabled = data.upi_qr_enabled !== undefined ? (data.upi_qr_enabled ? 1 : 0) : (ex.upi_qr_enabled || 0);
    const upiId = data.upi_id !== undefined ? (data.upi_id ? data.upi_id.trim() : null) : (ex.upi_id || null);
    const accHolder = data.account_holder_name !== undefined ? (data.account_holder_name ? data.account_holder_name.trim() : null) : (ex.account_holder_name || null);
    const bankName = data.bank_name !== undefined ? (data.bank_name ? data.bank_name.trim() : null) : (ex.bank_name || null);
    const accNum = data.account_number !== undefined ? (data.account_number ? data.account_number.trim() : null) : (ex.account_number || null);
    const ifsc = data.ifsc_code !== undefined ? (data.ifsc_code ? data.ifsc_code.trim() : null) : (ex.ifsc_code || null);
    const notes = data.settlement_notes !== undefined ? (data.settlement_notes ? data.settlement_notes.trim() : null) : (ex.settlement_notes || null);

    await pool.execute(`
      INSERT INTO merchant_payment_settings (
        restaurant_id, razorpay_enabled, razorpay_key_id, razorpay_key_secret,
        razorpay_webhook_secret, paytm_enabled, paytm_mid, paytm_merchant_key,
        paytm_website, paytm_industry_type_id, paytm_channel_id, paytm_mode,
        phonepe_enabled, phonepe_merchant_id, phonepe_salt_key, phonepe_salt_index, phonepe_mode,
        default_online_gateway, cod_enabled, upi_qr_enabled, upi_id,
        account_holder_name, bank_name, account_number, ifsc_code, settlement_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        razorpay_enabled = VALUES(razorpay_enabled),
        razorpay_key_id = VALUES(razorpay_key_id),
        razorpay_key_secret = VALUES(razorpay_key_secret),
        razorpay_webhook_secret = VALUES(razorpay_webhook_secret),
        paytm_enabled = VALUES(paytm_enabled),
        paytm_mid = VALUES(paytm_mid),
        paytm_merchant_key = VALUES(paytm_merchant_key),
        paytm_website = VALUES(paytm_website),
        paytm_industry_type_id = VALUES(paytm_industry_type_id),
        paytm_channel_id = VALUES(paytm_channel_id),
        paytm_mode = VALUES(paytm_mode),
        phonepe_enabled = VALUES(phonepe_enabled),
        phonepe_merchant_id = VALUES(phonepe_merchant_id),
        phonepe_salt_key = VALUES(phonepe_salt_key),
        phonepe_salt_index = VALUES(phonepe_salt_index),
        phonepe_mode = VALUES(phonepe_mode),
        default_online_gateway = VALUES(default_online_gateway),
        cod_enabled = VALUES(cod_enabled),
        upi_qr_enabled = VALUES(upi_qr_enabled),
        upi_id = VALUES(upi_id),
        account_holder_name = VALUES(account_holder_name),
        bank_name = VALUES(bank_name),
        account_number = VALUES(account_number),
        ifsc_code = VALUES(ifsc_code),
        settlement_notes = VALUES(settlement_notes),
        updated_at = NOW()
    `, [
      restaurantId, razorpayEnabled, razorpayKeyId, razorpayKeySecret,
      razorpayWebhookSecret, paytmEnabled, paytmMid, paytmMerchantKey,
      paytmWebsite, paytmIndustry, paytmChannel, paytmMode,
      phonepeEnabled, phonepeMid, phonepeSaltKey, phonepeSaltIndex, phonepeMode,
      defaultOnlineGateway, codEnabled, upiQrEnabled, upiId,
      accHolder, bankName, accNum, ifsc, notes
    ]);

    return await this.getMerchantPaymentSettings(restaurantId, false);
  }

  /**
   * Merchant Store Products
   */
  static async getMerchantProducts(restaurantId, { categoryId, search, availableOnlineOnly } = {}) {
    let query = `
      SELECT 
        m.id, m.category_id, c.name as category_name, m.name, m.description,
        m.online_description, m.price, m.online_price, m.mrp, m.image_url,
        m.unit, m.current_stock, m.reserved_stock, m.track_inventory,
        m.available_online, m.is_featured_online, m.online_seq, m.is_available
      FROM menu_items m
      LEFT JOIN categories c ON m.category_id = c.id
      WHERE m.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (categoryId) {
      query += ` AND m.category_id = ?`;
      params.push(categoryId);
    }
    if (availableOnlineOnly) {
      query += ` AND m.available_online = 1`;
    }
    if (search && search.trim()) {
      query += ` AND (m.name LIKE ? OR m.barcode LIKE ?)`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    query += ` ORDER BY m.available_online DESC, m.online_seq ASC, m.name ASC`;

    const [rows] = await pool.execute(query, params);

    return rows.map(r => ({
      ...r,
      available_online: Boolean(r.available_online),
      is_featured_online: Boolean(r.is_featured_online),
      available_stock: r.track_inventory === 0 ? 9999 : Math.max(0, parseFloat(r.current_stock || 0) - parseFloat(r.reserved_stock || 0))
    }));
  }

  static async updateMerchantProduct(restaurantId, productId, data) {
    const fields = ['available_online', 'online_price', 'online_description', 'is_featured_online', 'online_seq'];
    const updates = [];
    const params = [];

    for (const f of fields) {
      if (data[f] !== undefined) {
        updates.push(`\`${f}\` = ?`);
        params.push(data[f]);
      }
    }

    if (updates.length > 0) {
      params.push(productId, restaurantId);
      await pool.execute(`
        UPDATE menu_items 
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, params);
    }

    return true;
  }

  static async bulkUpdateMerchantProducts(restaurantId, productIds, availableOnline) {
    if (!Array.isArray(productIds) || productIds.length === 0) return 0;

    const placeholders = productIds.map(() => '?').join(', ');
    const [res] = await pool.execute(`
      UPDATE menu_items 
      SET available_online = ?, updated_at = NOW()
      WHERE restaurant_id = ? AND id IN (${placeholders})
    `, [availableOnline ? 1 : 0, restaurantId, ...productIds]);

    return res.affectedRows;
  }

  /**
   * SuperAdmin: List all merchant storefronts
   */
  static async getAllMerchantStores() {
    const [rows] = await pool.execute(`
      SELECT 
        r.id, r.name, r.subdomain, r.domain, r.phone, r.email,
        r.subscription_status, r.online_store_enabled, r.logo_url,
        r.created_at,
        mps.razorpay_enabled,
        mps.paytm_enabled,
        mps.phonepe_enabled,
        mps.cod_enabled,
        mcd.id as custom_domain_id,
        mcd.domain as custom_domain,
        mcd.include_www as custom_domain_include_www,
        mcd.verification_status as custom_domain_status,
        mcd.is_active as custom_domain_active,
        mcd.ssl_status as custom_domain_ssl,
        mcd.last_verified_at as custom_domain_last_verified,
        (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id AND o.is_online = 1) as online_order_count,
        (SELECT COUNT(*) FROM menu_items m WHERE m.restaurant_id = r.id AND m.available_online = 1) as online_product_count
      FROM restaurants r
      LEFT JOIN merchant_payment_settings mps ON r.id = mps.restaurant_id
      LEFT JOIN merchant_custom_domains mcd ON r.id = mcd.restaurant_id
      ORDER BY r.id ASC
    `);

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      subdomain: r.subdomain,
      domain: r.domain,
      phone: r.phone,
      email: r.email,
      subscription_status: r.subscription_status,
      online_store_enabled: Boolean(r.online_store_enabled),
      logo_url: r.logo_url,
      created_at: r.created_at,
      store_url: r.subdomain ? `https://${r.subdomain}.arisopos.in` : null,
      custom_domain: r.custom_domain ? {
        id: r.custom_domain_id,
        domain: r.custom_domain,
        include_www: Boolean(r.custom_domain_include_www),
        verification_status: r.custom_domain_status,
        is_active: Boolean(r.custom_domain_active),
        ssl_status: r.custom_domain_ssl,
        last_verified_at: r.custom_domain_last_verified,
        url: `https://${r.custom_domain}`
      } : null,
      online_order_count: parseInt(r.online_order_count || 0, 10),
      online_product_count: parseInt(r.online_product_count || 0, 10),
      payment_setup: {
        razorpay_enabled: Boolean(r.razorpay_enabled),
        paytm_enabled: Boolean(r.paytm_enabled),
        phonepe_enabled: Boolean(r.phonepe_enabled),
        cod_enabled: Boolean(r.cod_enabled ?? 1)
      }
    }));
  }

  /**
   * SuperAdmin: Assign or update merchant subdomain
   */
  static async assignSubdomain(restaurantId, rawSubdomain, actor = 'SuperAdmin') {
    const { valid, error, subdomain } = validateSubdomain(rawSubdomain);
    if (!valid) {
      throw new Error(error);
    }

    // Check if subdomain is already taken by another merchant
    const [existing] = await pool.execute(`
      SELECT id, name FROM restaurants WHERE LOWER(subdomain) = ? AND id != ? LIMIT 1
    `, [subdomain, restaurantId]);

    if (existing.length > 0) {
      throw new Error(`Subdomain "${subdomain}" is already assigned to merchant "${existing[0].name}" (ID #${existing[0].id}).`);
    }

    const storeUrl = `https://${subdomain}.arisopos.in`;

    // Generate QR code data URL
    let qrCodeDataUrl = null;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(storeUrl, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 320,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
    } catch (qrErr) {
      console.warn('[QR Code Generation Warning]:', qrErr.message);
    }

    await pool.execute(`
      UPDATE restaurants 
      SET 
        subdomain = ?,
        store_qr_code_url = COALESCE(?, store_qr_code_url),
        updated_at = NOW()
      WHERE id = ?
    `, [subdomain, qrCodeDataUrl, restaurantId]);

    // Audit log
    await pool.execute(`
      INSERT INTO audit_logs (restaurant_id, user_name, action, details)
      VALUES (?, ?, 'SUBDOMAIN_ASSIGNED', ?)
    `, [restaurantId, actor, `Assigned storefront subdomain "${subdomain}" (URL: ${storeUrl})`]).catch(() => {});

    return {
      subdomain,
      store_url: storeUrl,
      qr_code_data_url: qrCodeDataUrl
    };
  }

  /**
   * SuperAdmin: Toggle merchant online store enabled / disabled
   */
  static async toggleStoreStatus(restaurantId, enabled, actor = 'SuperAdmin') {
    const val = enabled ? 1 : 0;
    await pool.execute(`
      UPDATE restaurants 
      SET online_store_enabled = ?, updated_at = NOW()
      WHERE id = ?
    `, [val, restaurantId]);

    await pool.execute(`
      INSERT INTO audit_logs (restaurant_id, user_name, action, details)
      VALUES (?, ?, 'STORE_STATUS_TOGGLED', ?)
    `, [restaurantId, actor, `Online Storefront ${val ? 'ENABLED' : 'DISABLED'}`]).catch(() => {});

    return Boolean(val);
  }

  /**
   * Generate QR Code for store
   */
  static async generateStoreQrCode(restaurantId) {
    const [rows] = await pool.execute('SELECT subdomain, name FROM restaurants WHERE id = ?', [restaurantId]);
    if (rows.length === 0 || !rows[0].subdomain) {
      throw new Error('A valid subdomain must be assigned before generating a QR code.');
    }

    const subdomain = rows[0].subdomain;
    const storeUrl = `https://${subdomain}.arisopos.in`;

    const dataUrl = await QRCode.toDataURL(storeUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 400,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    await pool.execute('UPDATE restaurants SET store_qr_code_url = ? WHERE id = ?', [dataUrl, restaurantId]);

    return {
      store_url: storeUrl,
      qr_code_url: dataUrl
    };
  }

  /**
   * SuperAdmin: Get custom domain for merchant
   */
  static async getMerchantCustomDomain(restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        id, restaurant_id, domain, include_www, verification_token,
        verification_status, is_active, ssl_status, dns_records,
        last_verified_at, verification_error, created_at, updated_at
      FROM merchant_custom_domains
      WHERE restaurant_id = ?
      LIMIT 1
    `, [restaurantId]);

    if (rows.length === 0) return null;

    const row = rows[0];
    let parsedDns = null;
    try {
      parsedDns = typeof row.dns_records === 'string' ? JSON.parse(row.dns_records) : row.dns_records;
    } catch (_) {}

    return {
      ...row,
      include_www: Boolean(row.include_www),
      is_active: Boolean(row.is_active),
      dns_records: parsedDns || DomainVerificationService.generateDnsInstructions(row.domain, row.verification_token, Boolean(row.include_www))
    };
  }

  /**
   * SuperAdmin: Assign or update custom domain for merchant
   */
  static async assignCustomDomain(restaurantId, { domain, includeWww = true }, actor = 'SuperAdmin') {
    const { valid, error, domain: normalizedDomain } = validateCustomDomain(domain);
    if (!valid) {
      throw new Error(error);
    }

    // Check if domain is already claimed by another merchant in merchant_custom_domains
    const withoutWww = normalizedDomain.startsWith('www.') ? normalizedDomain.substring(4) : normalizedDomain;
    const withWww = normalizedDomain.startsWith('www.') ? normalizedDomain : `www.${normalizedDomain}`;

    const [existing] = await pool.execute(`
      SELECT mcd.id, mcd.restaurant_id, mcd.domain, r.name as merchant_name
      FROM merchant_custom_domains mcd
      LEFT JOIN restaurants r ON mcd.restaurant_id = r.id
      WHERE (LOWER(mcd.domain) = ? OR LOWER(mcd.domain) = ? OR LOWER(mcd.domain) = ?)
        AND mcd.restaurant_id != ?
      LIMIT 1
    `, [normalizedDomain, withoutWww, withWww, restaurantId]);

    if (existing.length > 0) {
      throw new Error(`Domain "${normalizedDomain}" is already claimed by merchant "${existing[0].merchant_name || 'Another Merchant'}" (ID #${existing[0].restaurant_id}).`);
    }

    // Generate cryptographic verification token
    const verificationToken = crypto.randomBytes(16).toString('hex');
    const dnsInstructions = DomainVerificationService.generateDnsInstructions(normalizedDomain, verificationToken, includeWww);

    // Insert or update merchant_custom_domains
    const existingDomain = await this.getMerchantCustomDomain(restaurantId);
    if (existingDomain) {
      await pool.execute(`
        UPDATE merchant_custom_domains
        SET 
          domain = ?,
          include_www = ?,
          verification_token = ?,
          verification_status = 'pending',
          is_active = 0,
          ssl_status = 'pending',
          dns_records = ?,
          verification_error = NULL,
          updated_at = NOW()
        WHERE restaurant_id = ?
      `, [normalizedDomain, includeWww ? 1 : 0, verificationToken, JSON.stringify(dnsInstructions), restaurantId]);
    } else {
      await pool.execute(`
        INSERT INTO merchant_custom_domains (
          restaurant_id, domain, include_www, verification_token,
          verification_status, is_active, ssl_status, dns_records,
          verification_error, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', 0, 'pending', ?, NULL, NOW())
      `, [restaurantId, normalizedDomain, includeWww ? 1 : 0, verificationToken, JSON.stringify(dnsInstructions)]);
    }

    // Mirror to restaurants.domain column for backward compatibility
    await pool.execute(`
      UPDATE restaurants SET domain = ?, updated_at = NOW() WHERE id = ?
    `, [normalizedDomain, restaurantId]);

    // Audit log
    await pool.execute(`
      INSERT INTO audit_logs (restaurant_id, user_name, action, details)
      VALUES (?, ?, 'CUSTOM_DOMAIN_ASSIGNED', ?)
    `, [restaurantId, actor, `Assigned custom domain "${normalizedDomain}" (Include WWW: ${includeWww ? 'Yes' : 'No'})`]).catch(() => {});

    return await this.getMerchantCustomDomain(restaurantId);
  }

  /**
   * SuperAdmin: Verify custom domain DNS and TLS readiness
   */
  static async verifyCustomDomain(restaurantId, actor = 'SuperAdmin') {
    const domainRecord = await this.getMerchantCustomDomain(restaurantId);
    if (!domainRecord) {
      throw new Error('No custom domain found for this merchant.');
    }

    const { domain, verification_token, include_www } = domainRecord;

    const checkResult = await DomainVerificationService.verifyDomain(domain, verification_token, include_www);

    const newStatus = checkResult.verified ? 'verified' : 'failed';
    const sslStatus = checkResult.verified ? 'provisioned' : 'failed';
    const isActive = checkResult.verified ? 1 : 0;
    const errorMsg = checkResult.verified ? null : (checkResult.error || 'DNS configuration could not be verified.');

    await pool.execute(`
      UPDATE merchant_custom_domains
      SET 
        verification_status = ?,
        is_active = ?,
        ssl_status = ?,
        verification_error = ?,
        last_verified_at = NOW(),
        updated_at = NOW()
      WHERE restaurant_id = ?
    `, [newStatus, isActive, sslStatus, errorMsg, restaurantId]);

    // Audit log
    await pool.execute(`
      INSERT INTO audit_logs (restaurant_id, user_name, action, details)
      VALUES (?, ?, 'CUSTOM_DOMAIN_VERIFIED', ?)
    `, [restaurantId, actor, `Domain verification ${checkResult.verified ? 'SUCCEEDED' : 'FAILED'} for "${domain}"`]).catch(() => {});

    const updated = await this.getMerchantCustomDomain(restaurantId);
    return {
      ...checkResult,
      domain: updated
    };
  }

  /**
   * SuperAdmin: Toggle custom domain active/inactive
   */
  static async toggleCustomDomainStatus(restaurantId, isActive, actor = 'SuperAdmin') {
    const domainRecord = await this.getMerchantCustomDomain(restaurantId);
    if (!domainRecord) {
      throw new Error('No custom domain found for this merchant.');
    }

    if (isActive && domainRecord.verification_status !== 'verified') {
      throw new Error('Domain must be verified with active DNS configuration before activation.');
    }

    const val = isActive ? 1 : 0;
    await pool.execute(`
      UPDATE merchant_custom_domains
      SET is_active = ?, updated_at = NOW()
      WHERE restaurant_id = ?
    `, [val, restaurantId]);

    // Audit log
    await pool.execute(`
      INSERT INTO audit_logs (restaurant_id, user_name, action, details)
      VALUES (?, ?, 'CUSTOM_DOMAIN_TOGGLED', ?)
    `, [restaurantId, actor, `Custom domain ${val ? 'ACTIVATED' : 'DEACTIVATED'} for "${domainRecord.domain}"`]).catch(() => {});

    return Boolean(val);
  }

  /**
   * SuperAdmin: Delete custom domain mapping
   */
  static async deleteCustomDomain(restaurantId, actor = 'SuperAdmin') {
    const domainRecord = await this.getMerchantCustomDomain(restaurantId);
    if (!domainRecord) return true;

    await pool.execute(`
      DELETE FROM merchant_custom_domains WHERE restaurant_id = ?
    `, [restaurantId]);

    // Clear restaurants.domain
    await pool.execute(`
      UPDATE restaurants SET domain = NULL, updated_at = NOW() WHERE id = ?
    `, [restaurantId]);

    // Audit log
    await pool.execute(`
      INSERT INTO audit_logs (restaurant_id, user_name, action, details)
      VALUES (?, ?, 'CUSTOM_DOMAIN_REMOVED', ?)
    `, [restaurantId, actor, `Removed custom domain "${domainRecord.domain}"`]).catch(() => {});

    return true;
  }

  /**
   * Log payment event
   */
  static async logPaymentEvent(restaurantId, { orderId = null, eventType, gateway = 'razorpay', gatewayPaymentId = null, gatewayOrderId = null, status, amount = 0, currency = 'INR', payload = null, errorMessage = null }) {
    await pool.execute(`
      INSERT INTO online_payment_logs (
        restaurant_id, order_id, event_type, gateway, gateway_payment_id,
        gateway_order_id, status, amount, currency, payload, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      restaurantId, orderId, eventType, gateway, gatewayPaymentId,
      gatewayOrderId, status, amount, currency,
      payload ? JSON.stringify(payload) : null, errorMessage || null
    ]).catch(err => console.error('[logPaymentEvent Error]:', err.message));
  }
}

module.exports = StorefrontRepository;
