const pool = require('../config/db');

class SuperBillController {
  /**
   * GET /api/superbill/items
   * Fetch items list for SuperBill UI with stock, unit, prices, barcodes, and tags
   */
  static async getItems(req, res) {
    const restaurantId = req.user.restaurant_id;
    const { search, category_id, type } = req.query;

    try {
      let query = `
        SELECT m.*, c.name as category_name, m.barcode_image_url
        FROM menu_items m
        LEFT JOIN categories c ON m.category_id = c.id
        WHERE m.restaurant_id = ?
      `;
      const params = [restaurantId];

      if (category_id) {
        query += ' AND m.category_id = ?';
        params.push(category_id);
      }

      if (type === 'service') {
        query += ' AND m.is_veg = 3'; // Use 3 to represent Service tag if applicable or sub_category
      } else if (type === 'product') {
        query += ' AND m.is_veg != 3';
      }

      if (search) {
        const clean = `%${search.trim().toLowerCase()}%`;
        query += ' AND (LOWER(m.name) LIKE ? OR LOWER(m.barcode) LIKE ? OR LOWER(m.sku) LIKE ?)';
        params.push(clean, clean, clean);
      }

      query += ' ORDER BY m.seq ASC, m.id DESC';

      const [items] = await pool.query(query, params);
      const [categories] = await pool.query('SELECT * FROM categories WHERE restaurant_id = ? ORDER BY seq ASC, name ASC', [restaurantId]);

      return res.json({
        success: true,
        items,
        categories
      });
    } catch (err) {
      console.error('[SuperBill.getItems Error]', err);
      return res.status(500).json({ error: 'Failed to fetch SuperBill items.' });
    }
  }

  /**
   * POST /api/superbill/generate-barcode
   * Generate a unique 13-digit EAN/UPC barcode
   */
  static async generateBarcode(req, res) {
    try {
      const prefix = '890'; // India GS1 prefix for retail items
      const random7 = Math.floor(1000000 + Math.random() * 9000000).toString();
      const timestamp3 = Date.now().toString().slice(-3);
      const barcode = `${prefix}${random7}${timestamp3}`.slice(0, 13);
      return res.json({ success: true, barcode });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate barcode.' });
    }
  }

  /**
   * POST /api/superbill/items
   * Add new item with Product/Service toggle, image, UOM, price, barcode & opening stock
   */
  static async createItem(req, res) {
    const restaurantId = req.user.restaurant_id;
    const {
      name, barcode, price, purchase_price, unit, category_id,
      item_type, opening_stock, description, image_url
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Item name is required.' });
    }

    if (price === undefined || isNaN(parseFloat(price)) || parseFloat(price) < 0) {
      return res.status(400).json({ error: 'Valid sale price is required.' });
    }

    try {
      // Auto-generate barcode if blank
      let finalBarcode = barcode ? barcode.trim() : null;
      if (!finalBarcode) {
        const prefix = '890';
        const randomDigits = Math.floor(1000000000 + Math.random() * 9000000000).toString();
        finalBarcode = `${prefix}${randomDigits}`.slice(0, 13);
      }

      // Check unique barcode in store
      if (finalBarcode) {
        const [dup] = await pool.query('SELECT id FROM menu_items WHERE restaurant_id = ? AND barcode = ?', [restaurantId, finalBarcode]);
        if (dup.length > 0) {
          finalBarcode = `${finalBarcode}-${Date.now().toString().slice(-4)}`;
        }
      }

      let categoryIdToUse = category_id ? parseInt(category_id) : null;
      if (!categoryIdToUse) {
        const [defaultCats] = await pool.query('SELECT id FROM categories WHERE restaurant_id = ? ORDER BY id ASC LIMIT 1', [restaurantId]);
        if (defaultCats.length > 0) {
          categoryIdToUse = defaultCats[0].id;
        } else {
          const [newCat] = await pool.query('INSERT INTO categories (restaurant_id, name) VALUES (?, "General")', [restaurantId]);
          categoryIdToUse = newCat.insertId;
        }
      }

      const isService = (item_type || '').toLowerCase() === 'service';
      const uomUnit = unit || 'PCS';
      const stockQty = opening_stock ? parseFloat(opening_stock) : 0;
      const purchasePrice = purchase_price ? parseFloat(purchase_price) : 0.00;
      const uploadedImgUrl = req.file ? `/uploads/${req.file.filename}` : (image_url || null);

      const [result] = await pool.query(
        'INSERT INTO menu_items (restaurant_id, category_id, name, description, price, purchase_price, barcode, base_unit, is_veg, is_available, image_url, seq, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, NOW())',
        [
          restaurantId, categoryIdToUse, name.trim(), description || null,
          parseFloat(price), purchasePrice, finalBarcode, uomUnit,
          isService ? 3 : 1, uploadedImgUrl
        ]
      );

      const newItemId = result.insertId;

      // Record opening stock log if > 0
      if (stockQty > 0) {
        await pool.query(
          'INSERT INTO stock_logs (restaurant_id, menu_item_id, user_id, change_qty, reason, created_at) VALUES (?, ?, ?, ?, "Opening Stock", NOW())',
          [restaurantId, newItemId, req.user.id, stockQty]
        ).catch(() => {});
      }

      return res.status(201).json({
        success: true,
        message: 'Stock Successfully Added',
        item: {
          id: newItemId,
          name: name.trim(),
          barcode: finalBarcode,
          price: parseFloat(price),
          purchase_price: purchasePrice,
          unit: uomUnit,
          item_type: isService ? 'service' : 'product',
          stock: stockQty,
          image_url: uploadedImgUrl
        }
      });
    } catch (err) {
      console.error('[SuperBill.createItem Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to add item.' });
    }
  }

  /**
   * POST /api/superbill/stock-adjust
   * Perform signed Stock In / Stock Out adjustment
   */
  static async stockAdjust(req, res) {
    const restaurantId = req.user.restaurant_id;
    const { item_id, adjustment_type, quantity, reason } = req.body;

    if (!item_id || isNaN(parseInt(item_id))) {
      return res.status(400).json({ error: 'Valid item_id is required.' });
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number.' });
    }

    const type = (adjustment_type || '').toLowerCase();
    if (!['in', 'out'].includes(type)) {
      return res.status(400).json({ error: 'adjustment_type must be "in" or "out".' });
    }

    try {
      const changeQty = type === 'in' ? qty : -qty;

      // Verify item exists in store
      const [items] = await pool.query('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?', [item_id, restaurantId]);
      if (items.length === 0) {
        return res.status(404).json({ error: 'Item not found in store.' });
      }

      // Log stock movement
      await pool.query(
        'INSERT INTO stock_logs (restaurant_id, menu_item_id, user_id, change_qty, reason, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [restaurantId, item_id, req.user.id, changeQty, reason || `Manual Stock ${type.toUpperCase()}`]
      ).catch(() => {});

      return res.json({
        success: true,
        message: `Stock ${type === 'in' ? 'In' : 'Out'} of ${qty} recorded successfully.`,
        item_id,
        adjustment_type: type,
        change_qty: changeQty
      });
    } catch (err) {
      console.error('[SuperBill.stockAdjust Error]', err);
      return res.status(500).json({ error: 'Failed to adjust stock.' });
    }
  }

  /**
   * POST /api/superbill/bill
   * Process bill checkout, calculate discount & totals, and format ESC/POS thermal receipt
   */
  static async createBill(req, res) {
    const restaurantId = req.user.restaurant_id;
    const { items, discount_percentage, payment_mode, mark_fully_paid, notes, cashier_shift_id } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart must contain at least one item.' });
    }

    try {
      let subtotal = 0;
      const formattedItems = [];

      for (const cartItem of items) {
        const qty = parseFloat(cartItem.quantity || 1);
        const price = parseFloat(cartItem.price || 0);
        const itemTotal = qty * price;
        subtotal += itemTotal;

        formattedItems.push({
          id: cartItem.id,
          name: cartItem.name || 'Item',
          price,
          quantity: qty,
          unit: cartItem.unit || 'PCS',
          total: itemTotal
        });

        // Deduct inventory if item id is provided
        if (cartItem.id) {
          pool.query(
            'INSERT INTO stock_logs (restaurant_id, menu_item_id, user_id, change_qty, reason, created_at) VALUES (?, ?, ?, ?, "SuperBill Sale", NOW())',
            [restaurantId, cartItem.id, req.user.id, -qty]
          ).catch(() => {});
        }
      }

      const discountPct = parseFloat(discount_percentage || 0);
      const discountAmount = (subtotal * discountPct) / 100;
      const totalAmount = Math.max(0, subtotal - discountAmount);

      const orderNumber = `SB-${Date.now()}`;
      const isFullyPaid = mark_fully_paid !== false;
      const activePaymentMode = (payment_mode || 'cash').toLowerCase();

      // Get receipt settings for merchant header
      let storeHeader = { name: 'Ariso Retail Store', phone: '', address: '', gst: '' };
      const [rRows] = await pool.query('SELECT name, phone, address, gst_number FROM restaurants WHERE id = ?', [restaurantId]);
      if (rRows.length > 0) {
        storeHeader = {
          name: rRows[0].name || 'Ariso Retail Store',
          phone: rRows[0].phone || '',
          address: rRows[0].address || '',
          gst: rRows[0].gst_number || ''
        };
      }

      // Generate UPI QR String
      const upiId = 'arisoretail@upi';
      const upiQrString = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(storeHeader.name)}&am=${totalAmount.toFixed(2)}&cu=INR`;

      // Record Order in MySQL
      const [orderResult] = await pool.query(
        'INSERT INTO orders (restaurant_id, unique_order_number, cashier_id, cashier_name, subtotal, tax_amount, discount_amount, total_amount, payment_mode, order_status, cashier_shift_id, notes, completed_at, created_at) ' +
        'VALUES (?, ?, ?, ?, ?, 0.00, ?, ?, ?, "completed", ?, ?, NOW(), NOW())',
        [
          restaurantId, orderNumber, req.user.id, req.user.name || 'Cashier',
          subtotal, discountAmount, totalAmount, activePaymentMode,
          cashier_shift_id || 1, notes || 'SuperBill Entry'
        ]
      );

      const orderId = orderResult.insertId;

      return res.status(201).json({
        success: true,
        message: 'Payment Successfully Completed',
        receipt_no: orderId,
        order_number: orderNumber,
        subtotal: subtotal.toFixed(2),
        discount_percentage: discountPct,
        discount_amount: discountAmount.toFixed(2),
        total_amount: totalAmount.toFixed(2),
        payment_mode: activePaymentMode,
        balance_due: isFullyPaid ? '0.00' : totalAmount.toFixed(2),
        upi_qr_string: upiQrString,
        store_header: storeHeader,
        items: formattedItems
      });
    } catch (err) {
      console.error('[SuperBill.createBill Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to complete bill.' });
    }
  }
}

module.exports = SuperBillController;
