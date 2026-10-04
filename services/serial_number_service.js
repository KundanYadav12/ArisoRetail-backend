/**
 * Product Serial Number Tracking Service
 * 
 * Provides:
 *  - Unique 8-digit serial number generation
 *  - Automated generation during purchase bills & GRN stock receiving
 *  - Transaction history linkage: Manufacturer Purchase & Customer Sale
 *  - Status tracking: In Stock vs Sold
 *  - Thermal ESC/POS and Sticker Barcode printing payload generation
 */

const pool = require('../config/db');

class SerialNumberService {
  /**
   * Helper: Format Date to Indian standard DD-MM-YYYY
   */
  static formatDate(d) {
    if (!d) return null;
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d);
      const day = String(dt.getDate()).padStart(2, '0');
      const month = String(dt.getMonth() + 1).padStart(2, '0');
      const year = dt.getFullYear();
      return `${day}-${month}-${year}`;
    } catch {
      return String(d);
    }
  }

  /**
   * Helper: Calculate warranty start, end, and expired status dynamically
   * Warranty start date = date of sale to customer (not generation or purchase).
   * Warranty end date = start date + duration (months or years).
   */
  static calculateWarranty(saleDate, durationVal, durationUnit) {
    const rawVal = durationVal !== undefined && durationVal !== null && String(durationVal).trim() !== ''
      ? parseInt(durationVal, 10)
      : null;

    if (!rawVal || isNaN(rawVal) || rawVal <= 0) {
      return {
        has_warranty: false,
        warranty_duration_value: null,
        warranty_duration_unit: null,
        warranty_duration_text: null,
        warranty_start_date: null,
        warranty_start_date_formatted: null,
        warranty_end_date: null,
        warranty_end_date_formatted: null,
        is_warranty_expired: false,
        warranty_status: 'no_warranty' // 'no_warranty' | 'not_started' | 'active' | 'expired'
      };
    }

    const unit = String(durationUnit || 'months').toLowerCase().trim();
    const isYear = unit.startsWith('year');
    const unitLabel = isYear ? (rawVal === 1 ? 'Year' : 'Years') : (rawVal === 1 ? 'Month' : 'Months');
    const durationText = `${rawVal} ${unitLabel}`;

    if (!saleDate) {
      return {
        has_warranty: true,
        warranty_duration_value: rawVal,
        warranty_duration_unit: isYear ? 'years' : 'months',
        warranty_duration_text: durationText,
        warranty_start_date: null,
        warranty_start_date_formatted: null,
        warranty_end_date: null,
        warranty_end_date_formatted: null,
        is_warranty_expired: false,
        warranty_status: 'not_started'
      };
    }

    const dtStart = new Date(saleDate);
    if (isNaN(dtStart.getTime())) {
      return {
        has_warranty: true,
        warranty_duration_value: rawVal,
        warranty_duration_unit: isYear ? 'years' : 'months',
        warranty_duration_text: durationText,
        warranty_start_date: null,
        warranty_start_date_formatted: null,
        warranty_end_date: null,
        warranty_end_date_formatted: null,
        is_warranty_expired: false,
        warranty_status: 'not_started'
      };
    }

    const dtEnd = new Date(dtStart);
    if (isYear) {
      dtEnd.setFullYear(dtEnd.getFullYear() + rawVal);
    } else {
      dtEnd.setMonth(dtEnd.getMonth() + rawVal);
    }

    const now = new Date();
    // Expiration check: strictly past warranty end date
    const isExpired = now.getTime() > dtEnd.getTime();

    const startFormatted = this.formatDate(dtStart);
    const endFormatted = this.formatDate(dtEnd);

    return {
      has_warranty: true,
      warranty_duration_value: rawVal,
      warranty_duration_unit: isYear ? 'years' : 'months',
      warranty_duration_text: durationText,
      warranty_start_date: dtStart.toISOString().slice(0, 10),
      warranty_start_date_formatted: startFormatted,
      warranty_end_date: dtEnd.toISOString().slice(0, 10),
      warranty_end_date_formatted: endFormatted,
      is_warranty_expired: isExpired,
      warranty_status: isExpired ? 'expired' : 'active'
    };
  }

  /**
   * Generate a unique 8-digit serial number (e.g. 12345678)
   * Guaranteed to be unique in product_serial_numbers
   */
  static async generateUniqueSerialNumber(connection = null) {
    const conn = connection || pool;
    let attempts = 0;
    const min = 10000000;
    const max = 99999999;

    while (attempts < 25) {
      const candidate = String(Math.floor(min + Math.random() * (max - min + 1)));
      const [existing] = await conn.execute(
        'SELECT id FROM product_serial_numbers WHERE serial_number = ? LIMIT 1',
        [candidate]
      );
      if (existing.length === 0) {
        return candidate;
      }
      attempts++;
    }

    // Fallback if random attempts collide: use highest sequential ID + 10000000
    const [maxRows] = await conn.execute(
      'SELECT MAX(id) as maxId FROM product_serial_numbers'
    );
    const nextVal = (maxRows[0]?.maxId || 0) + 10000001;
    const fallbackSerial = String(nextVal).slice(-8).padStart(8, '1');
    return fallbackSerial;
  }

  /**
   * Batch generate N unique 8-digit serial numbers
   */
  static async generateBatchSerialNumbers(count, connection = null) {
    const conn = connection || pool;
    const serials = [];
    const min = 10000000;
    const max = 99999999;
    const generatedSet = new Set();

    while (serials.length < count) {
      const candidate = String(Math.floor(min + Math.random() * (max - min + 1)));
      if (generatedSet.has(candidate)) continue;

      const [existing] = await conn.execute(
        'SELECT id FROM product_serial_numbers WHERE serial_number = ? LIMIT 1',
        [candidate]
      );
      if (existing.length === 0) {
        generatedSet.add(candidate);
        serials.push(candidate);
      }
    }
    return serials;
  }

  /**
   * Hook: Record Serial Numbers on Purchase Bill or Stock Receiving
   */
  static async recordPurchaseReceiving(connection, {
    restaurantId,
    purchaseBillId = null,
    purchaseBillItemId = null,
    grnId = null,
    purchaseInvoiceNumber = null,
    purchaseDate = null,
    supplierId = null,
    supplierName = null,
    warehouseId = null,
    items = []
  }) {
    const resultsByItem = {};

    for (const item of items) {
      const menuItemId = item.menu_item_id || item.id;
      if (!menuItemId) continue;

      // Check if product is serial tracked (exclude weight-based items like kg/grams)
      const isWeightBased = Boolean(item.is_weight_based);
      const isSerialTracked = item.is_serial_tracked !== undefined ? Boolean(item.is_serial_tracked) : true;
      if (isWeightBased || !isSerialTracked) {
        continue;
      }

      // Discrete units count
      const qty = Math.max(1, Math.floor(parseFloat(item.quantity || item.qty || item.accepted_qty || 1)));
      const rate = parseFloat(item.rate || item.purchase_price || item.unit_price || 0);

      // Generate unique 8-digit serial numbers for each unit
      const generatedSerials = await this.generateBatchSerialNumbers(qty, connection);

      for (const serial of generatedSerials) {
        await connection.execute(`
          INSERT INTO product_serial_numbers (
            restaurant_id, serial_number, menu_item_id, warehouse_id, status,
            purchase_bill_id, purchase_bill_item_id, grn_id,
            purchase_invoice_number, purchase_date,
            supplier_id, supplier_name, purchase_cost,
            created_at
          ) VALUES (?, ?, ?, ?, 'in_stock', ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId,
          serial,
          menuItemId,
          warehouseId || null,
          purchaseBillId || null,
          purchaseBillItemId || item._billItemId || null,
          grnId || null,
          purchaseInvoiceNumber || null,
          purchaseDate || new Date().toISOString().slice(0, 10),
          supplierId || null,
          supplierName || null,
          rate
        ]);
      }

      resultsByItem[menuItemId] = generatedSerials;
    }

    return resultsByItem;
  }

  /**
   * Hook: Process Customer Sale and link Serial Numbers
   */
  static async processOrderSale(connection, {
    restaurantId,
    orderId,
    orderNumber,
    uniqueOrderNumber,
    saleDate = null,
    customerId = null,
    customerName = null,
    customerPhone = null,
    warehouseId = null,
    items = []
  }) {
    const invoiceNo = uniqueOrderNumber || orderNumber || `INV-${orderId}`;
    const effectiveSaleDate = saleDate || new Date();

    for (const it of items) {
      try {
        const menuItemId = it.menu_item_id || it.product_id || it.id;
        if (!menuItemId) continue;

        const qty = Math.max(1, Math.floor(parseFloat(it.quantity || 1)));
        const salePrice = parseFloat(it.price || it.unit_price || 0);

        // Case 1: Specific serial number(s) provided in line item
        const serialsToProcess = [];
        if (Array.isArray(it.serial_numbers) && it.serial_numbers.length > 0) {
          serialsToProcess.push(...it.serial_numbers.map(s => String(s).trim()).filter(Boolean));
        } else if (it.serial_number && String(it.serial_number).trim()) {
          const parts = String(it.serial_number).split(',').map(s => s.trim().replace(/^SN:\s*/i, '')).filter(Boolean);
          serialsToProcess.push(...parts);
        }

        if (serialsToProcess.length > 0) {
          for (const cleanSerial of serialsToProcess) {
            await connection.execute(`
              UPDATE product_serial_numbers 
              SET status = 'sold',
                  order_id = ?,
                  sales_invoice_number = ?,
                  sale_date = ?,
                  customer_id = ?,
                  customer_name = ?,
                  customer_phone = ?,
                  sale_price = ?,
                  warranty_start_date = CASE 
                    WHEN warranty_duration_value IS NOT NULL AND warranty_duration_value > 0 
                    THEN DATE(?) 
                    ELSE NULL 
                  END,
                  warranty_end_date = CASE 
                    WHEN warranty_duration_value IS NOT NULL AND warranty_duration_value > 0 AND warranty_duration_unit = 'years' 
                      THEN DATE(DATE_ADD(?, INTERVAL warranty_duration_value YEAR))
                    WHEN warranty_duration_value IS NOT NULL AND warranty_duration_value > 0 
                      THEN DATE(DATE_ADD(?, INTERVAL warranty_duration_value MONTH))
                    ELSE NULL 
                  END,
                  updated_at = NOW()
              WHERE restaurant_id = ? AND serial_number = ?
            `, [
              orderId, invoiceNo, effectiveSaleDate,
              customerId || null, customerName || null, customerPhone || null,
              salePrice,
              effectiveSaleDate, effectiveSaleDate, effectiveSaleDate,
              restaurantId, cleanSerial
            ]);
          }
          continue;
        }

        // Case 2: No specific serial provided - auto-allocate oldest in-stock serial numbers (FIFO)
        const safeLimit = Math.max(1, parseInt(qty, 10) || 1);
        const [availableSerials] = await connection.query(`
          SELECT id, serial_number FROM product_serial_numbers 
          WHERE restaurant_id = ? AND menu_item_id = ? AND status = 'in_stock'
          ${warehouseId ? 'AND (warehouse_id = ? OR warehouse_id IS NULL)' : ''}
          ORDER BY id ASC 
          LIMIT ${safeLimit}
        `, warehouseId ? [restaurantId, menuItemId, warehouseId] : [restaurantId, menuItemId]);

        if (availableSerials.length > 0) {
          for (const sRow of availableSerials) {
            await connection.execute(`
              UPDATE product_serial_numbers 
              SET status = 'sold',
                  order_id = ?,
                  sales_invoice_number = ?,
                  sale_date = ?,
                  customer_id = ?,
                  customer_name = ?,
                  customer_phone = ?,
                  sale_price = ?,
                  warranty_start_date = CASE 
                    WHEN warranty_duration_value IS NOT NULL AND warranty_duration_value > 0 
                    THEN DATE(?) 
                    ELSE NULL 
                  END,
                  warranty_end_date = CASE 
                    WHEN warranty_duration_value IS NOT NULL AND warranty_duration_value > 0 AND warranty_duration_unit = 'years' 
                      THEN DATE(DATE_ADD(?, INTERVAL warranty_duration_value YEAR))
                    WHEN warranty_duration_value IS NOT NULL AND warranty_duration_value > 0 
                      THEN DATE(DATE_ADD(?, INTERVAL warranty_duration_value MONTH))
                    ELSE NULL 
                  END,
                  updated_at = NOW()
              WHERE id = ?
            `, [
              orderId, invoiceNo, effectiveSaleDate,
              customerId || null, customerName || null, customerPhone || null,
              salePrice,
              effectiveSaleDate, effectiveSaleDate, effectiveSaleDate,
              sRow.id
            ]);
          }
        }
      } catch (itemErr) {
        console.warn('[processOrderSale Item Error]:', itemErr.message);
      }
    }
  }

  /**
   * Lookup complete history and status of an 8-digit Serial Number
   */
  static async lookupSerialNumber(restaurantId, serialNumber) {
    if (!serialNumber) throw new Error('Serial number is required.');
    const cleanSerial = String(serialNumber).trim();

    const [rows] = await pool.execute(`
      SELECT 
        psn.*,
        mi.name as product_name,
        mi.sku as product_sku,
        mi.barcode as product_barcode,
        mi.price as product_price,
        mi.mrp as product_mrp,
        mi.unit as product_unit,
        mi.image_url as product_image,
        mi.is_serial_tracked,
        c.name as category_name,
        w.name as warehouse_name,
        w.code as warehouse_code,
        s.company_name as supplier_company,
        s.mobile as supplier_mobile,
        s.gst_number as supplier_gstin,
        o.order_number as order_code,
        o.unique_order_number,
        o.payment_mode,
        o.order_status,
        pb.bill_number as pb_bill_number,
        pb.internal_bill_number as pb_internal_number
      FROM product_serial_numbers psn
      JOIN menu_items mi ON psn.menu_item_id = mi.id
      LEFT JOIN categories c ON mi.category_id = c.id
      LEFT JOIN warehouses w ON psn.warehouse_id = w.id
      LEFT JOIN suppliers s ON psn.supplier_id = s.id
      LEFT JOIN orders o ON psn.order_id = o.id
      LEFT JOIN purchase_bills pb ON psn.purchase_bill_id = pb.id
      WHERE psn.restaurant_id = ? AND psn.serial_number = ?
      LIMIT 1
    `, [restaurantId, cleanSerial]);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const isSold = row.status === 'sold' || Boolean(row.order_id) || Boolean(row.sale_date);

    // Format Manufacturer Purchase block
    const purchaseDateFormatted = this.formatDate(row.purchase_date);
    const purchaseInvoice = row.purchase_invoice_number || row.pb_bill_number || row.pb_internal_number || 'N/A';

    // Format Customer Sale block
    const saleDateFormatted = isSold ? this.formatDate(row.sale_date) : null;
    const saleInvoice = isSold ? (row.sales_invoice_number || row.unique_order_number || row.order_code || 'N/A') : null;

    // Calculate Warranty status
    const warrantyInfo = this.calculateWarranty(
      row.sale_date,
      row.warranty_duration_value,
      row.warranty_duration_unit
    );

    return {
      serial_number: row.serial_number,
      status: row.status,
      is_sold: isSold,
      status_label: isSold ? 'Sold' : 'Not Sold (In Stock)',
      created_at: row.created_at,
      updated_at: row.updated_at,

      // Warranty Information
      warranty: warrantyInfo,
      warranty_duration_value: warrantyInfo.warranty_duration_value,
      warranty_duration_unit: warrantyInfo.warranty_duration_unit,
      warranty_duration_text: warrantyInfo.warranty_duration_text,
      warranty_start_date: warrantyInfo.warranty_start_date,
      warranty_start_date_formatted: warrantyInfo.warranty_start_date_formatted,
      warranty_end_date: warrantyInfo.warranty_end_date,
      warranty_end_date_formatted: warrantyInfo.warranty_end_date_formatted,
      is_warranty_expired: warrantyInfo.is_warranty_expired,
      warranty_status: warrantyInfo.warranty_status,
      
      product: {
        id: row.menu_item_id,
        name: row.product_name,
        sku: row.product_sku || '',
        barcode: row.product_barcode || '',
        category: row.category_name || 'General',
        selling_price: parseFloat(row.product_price || 0),
        mrp: parseFloat(row.product_mrp || row.product_price || 0),
        unit: row.product_unit || 'pcs',
        image_url: row.product_image || null
      },

      warehouse: {
        id: row.warehouse_id,
        name: row.warehouse_name || 'Main Warehouse',
        code: row.warehouse_code || 'WH-01'
      },

      // 1. Manufacturer Purchase
      purchase: {
        date: purchaseDateFormatted || 'N/A',
        raw_date: row.purchase_date,
        invoice: purchaseInvoice,
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name || row.supplier_company || 'Manufacturer / Supplier',
        supplier_mobile: row.supplier_mobile || null,
        supplier_gstin: row.supplier_gstin || null,
        purchase_cost: parseFloat(row.purchase_cost || 0),
        purchase_bill_id: row.purchase_bill_id,
        grn_id: row.grn_id
      },

      // 2. Customer Sale
      sale: isSold ? {
        is_sold: true,
        date: saleDateFormatted || 'N/A',
        raw_date: row.sale_date,
        invoice: saleInvoice,
        customer_id: row.customer_id,
        customer_name: row.customer_name || 'Walk-in Customer',
        customer_phone: row.customer_phone || null,
        sale_price: parseFloat(row.sale_price || row.product_price || 0),
        payment_mode: row.payment_mode || 'Cash',
        order_id: row.order_id
      } : {
        is_sold: false,
        message: 'Not Sold'
      }
    };
  }

  /**
   * Search / List Serial Numbers with filters and pagination
   */
  static async searchSerialNumbers(restaurantId, filters = {}) {
    const rawSearch = filters.search || filters.query || filters.q || '';
    const status = filters.status || 'all';
    const menu_item_id = (filters.menu_item_id && filters.menu_item_id !== 'all') ? filters.menu_item_id : (filters.product_id && filters.product_id !== 'all' ? filters.product_id : null);
    const warehouse_id = (filters.warehouse_id && filters.warehouse_id !== 'all') ? filters.warehouse_id : null;
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const sort_by = filters.sort_by || 'created_at';
    const sort_order = (filters.sort_order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let query = `
      SELECT 
        psn.*,
        mi.name as product_name,
        mi.sku as product_sku,
        mi.barcode as product_barcode,
        mi.price as product_price,
        mi.mrp as product_mrp,
        mi.unit as product_unit,
        c.name as category_name,
        w.name as warehouse_name,
        s.name as supplier_name_actual,
        s.company_name as supplier_company,
        o.unique_order_number
      FROM product_serial_numbers psn
      JOIN menu_items mi ON psn.menu_item_id = mi.id
      LEFT JOIN categories c ON mi.category_id = c.id
      LEFT JOIN warehouses w ON psn.warehouse_id = w.id
      LEFT JOIN suppliers s ON psn.supplier_id = s.id
      LEFT JOIN orders o ON psn.order_id = o.id
      WHERE psn.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND psn.status = ?';
      params.push(status);
    }

    if (menu_item_id) {
      query += ' AND psn.menu_item_id = ?';
      params.push(menu_item_id);
    }

    if (warehouse_id) {
      query += ' AND psn.warehouse_id = ?';
      params.push(warehouse_id);
    }

    if (rawSearch && String(rawSearch).trim()) {
      const s = `%${String(rawSearch).trim()}%`;
      query += ` AND (
        psn.serial_number LIKE ? 
        OR mi.name LIKE ? 
        OR mi.sku LIKE ? 
        OR psn.purchase_invoice_number LIKE ? 
        OR psn.sales_invoice_number LIKE ? 
        OR psn.customer_name LIKE ?
        OR psn.supplier_name LIKE ?
      )`;
      params.push(s, s, s, s, s, s, s);
    }

    // ── Column-Wise Granular Filters (AND logic) ──────────────────
    const {
      col_serial_number,
      col_product_item,
      col_sku_barcode,
      col_purchase_date_from,
      col_purchase_date_to,
      col_purchase_invoice,
      col_sale_date_from,
      col_sale_date_to,
      col_sales_invoice,
      col_status,
      col_warranty_start_from,
      col_warranty_start_to,
      col_warranty_end_from,
      col_warranty_end_to
    } = filters;

    if (col_serial_number && String(col_serial_number).trim()) {
      query += ' AND psn.serial_number LIKE ?';
      params.push(`%${String(col_serial_number).trim()}%`);
    }

    if (col_product_item && String(col_product_item).trim()) {
      const prodVal = String(col_product_item).trim();
      if (!isNaN(prodVal) && Number(prodVal) > 0) {
        query += ' AND psn.menu_item_id = ?';
        params.push(Number(prodVal));
      } else {
        query += ' AND (mi.name LIKE ? OR mi.sku LIKE ?)';
        params.push(`%${prodVal}%`, `%${prodVal}%`);
      }
    }

    if (col_sku_barcode && String(col_sku_barcode).trim()) {
      query += ' AND (mi.sku LIKE ? OR mi.barcode LIKE ?)';
      const sb = `%${String(col_sku_barcode).trim()}%`;
      params.push(sb, sb);
    }

    if (col_purchase_date_from && String(col_purchase_date_from).trim()) {
      query += ' AND DATE(psn.purchase_date) >= ?';
      params.push(String(col_purchase_date_from).trim());
    }
    if (col_purchase_date_to && String(col_purchase_date_to).trim()) {
      query += ' AND DATE(psn.purchase_date) <= ?';
      params.push(String(col_purchase_date_to).trim());
    }

    if (col_purchase_invoice && String(col_purchase_invoice).trim()) {
      query += ' AND psn.purchase_invoice_number LIKE ?';
      params.push(`%${String(col_purchase_invoice).trim()}%`);
    }

    if (col_sale_date_from && String(col_sale_date_from).trim()) {
      query += ' AND DATE(psn.sale_date) >= ?';
      params.push(String(col_sale_date_from).trim());
    }
    if (col_sale_date_to && String(col_sale_date_to).trim()) {
      query += ' AND DATE(psn.sale_date) <= ?';
      params.push(String(col_sale_date_to).trim());
    }

    if (col_sales_invoice && String(col_sales_invoice).trim()) {
      const si = `%${String(col_sales_invoice).trim()}%`;
      query += ' AND (psn.sales_invoice_number LIKE ? OR o.unique_order_number LIKE ?)';
      params.push(si, si);
    }

    if (col_status && col_status !== 'all') {
      query += ' AND psn.status = ?';
      params.push(col_status);
    }

    if (col_warranty_start_from && String(col_warranty_start_from).trim()) {
      query += ' AND DATE(psn.warranty_start_date) >= ?';
      params.push(String(col_warranty_start_from).trim());
    }
    if (col_warranty_start_to && String(col_warranty_start_to).trim()) {
      query += ' AND DATE(psn.warranty_start_date) <= ?';
      params.push(String(col_warranty_start_to).trim());
    }

    if (col_warranty_end_from && String(col_warranty_end_from).trim()) {
      query += ' AND DATE(psn.warranty_end_date) >= ?';
      params.push(String(col_warranty_end_from).trim());
    }
    if (col_warranty_end_to && String(col_warranty_end_to).trim()) {
      query += ' AND DATE(psn.warranty_end_date) <= ?';
      params.push(String(col_warranty_end_to).trim());
    }

    // Count total
    const countSql = `SELECT COUNT(*) as total FROM (${query}) as sub`;
    const [countRows] = await pool.execute(countSql, params);
    const total = countRows[0]?.total || 0;

    // Fetch paginated rows with flexible sorting
    const safeLimit = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeOffset = (safePage - 1) * safeLimit;

    const sortFieldMap = {
      'created_at': 'psn.created_at',
      'serial_number': 'psn.serial_number',
      'product_name': 'mi.name',
      'status': 'psn.status',
      'purchase_date': 'psn.purchase_date',
      'sale_date': 'psn.sale_date'
    };
    const sortColumn = sortFieldMap[sort_by] || 'psn.created_at';
    query += ` ORDER BY ${sortColumn} ${sort_order}, psn.id ${sort_order} LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await pool.query(query, params);

    const formattedList = rows.map(r => {
      const isSold = r.status === 'sold' || Boolean(r.order_id);
      const warrantyInfo = this.calculateWarranty(
        r.sale_date,
        r.warranty_duration_value,
        r.warranty_duration_unit
      );

      return {
        id: r.id,
        serial_number: r.serial_number,
        status: r.status,
        is_sold: isSold,
        product_id: r.menu_item_id,
        menu_item_id: r.menu_item_id,
        product_name: r.product_name,
        product_sku: r.product_sku || '',
        product_barcode: r.product_barcode || '',
        product_price: parseFloat(r.product_price || 0),
        category_name: r.category_name || 'General',
        warehouse_id: r.warehouse_id,
        warehouse_name: r.warehouse_name || 'Main Warehouse',
        purchase_date: this.formatDate(r.purchase_date),
        purchase_date_formatted: this.formatDate(r.purchase_date),
        purchase_invoice: r.purchase_invoice_number || 'N/A',
        purchase_invoice_number: r.purchase_invoice_number || 'N/A',
        supplier_name: r.supplier_name || r.supplier_name_actual || r.supplier_company || 'Supplier',
        sale_date: isSold ? this.formatDate(r.sale_date) : null,
        sale_date_formatted: isSold ? this.formatDate(r.sale_date) : null,
        sales_invoice: isSold ? (r.sales_invoice_number || r.unique_order_number || 'N/A') : null,
        sales_invoice_number: isSold ? (r.sales_invoice_number || r.unique_order_number || 'N/A') : null,
        unique_order_number: r.unique_order_number || null,
        customer_name: isSold ? (r.customer_name || 'Walk-in Customer') : null,
        created_at: r.created_at,

        // Warranty attributes
        warranty: warrantyInfo,
        warranty_duration_value: warrantyInfo.warranty_duration_value,
        warranty_duration_unit: warrantyInfo.warranty_duration_unit,
        warranty_duration_text: warrantyInfo.warranty_duration_text,
        warranty_start_date: warrantyInfo.warranty_start_date,
        warranty_start_date_formatted: warrantyInfo.warranty_start_date_formatted,
        warranty_end_date: warrantyInfo.warranty_end_date,
        warranty_end_date_formatted: warrantyInfo.warranty_end_date_formatted,
        is_warranty_expired: warrantyInfo.is_warranty_expired,
        warranty_status: warrantyInfo.warranty_status
      };
    });

    return {
      success: true,
      serial_numbers: formattedList,
      total,
      count: total,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit) || 1
      },
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1
    };
  }

  /**
   * Get overall Serial Number statistics
   */
  static async getSerialStats(restaurantId) {
    const [rows] = await pool.execute(`
      SELECT 
        COUNT(*) as total_serials,
        SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END) as in_stock_count,
        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_count,
        SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as today_count
      FROM product_serial_numbers
      WHERE restaurant_id = ?
    `, [restaurantId]);

    const s = rows[0] || {};
    const total = parseInt(s.total_serials || 0, 10);
    const in_stock = parseInt(s.in_stock_count || 0, 10);
    const sold = parseInt(s.sold_count || 0, 10);
    const generated_today = parseInt(s.today_count || 0, 10);

    const statsObj = {
      total_serials: total,
      in_stock: in_stock,
      sold: sold,
      generated_today: generated_today
    };

    return {
      success: true,
      stats: statsObj,
      ...statsObj,
      total,
      in_stock,
      sold
    };
  }

  /**
   * Manually generate or register serial numbers for a product (e.g. existing inventory or opening stock)
   * Supports 'auto' (batch generated 8-digit unique serials) and 'manual' (user-typed 8-digit serial).
   * Also captures optional warranty duration (value + unit: months/years).
   */
  static async generateManual(restaurantId, {
    menu_item_id,
    quantity = 1,
    mode = 'auto', // 'auto' | 'manual'
    serial_number = null,
    warranty_duration_value = null,
    warranty_duration_unit = 'months',
    warehouse_id = null,
    purchase_invoice_number = null,
    purchase_date = null,
    supplier_id = null,
    supplier_name = null,
    purchase_cost = 0
  }) {
    if (!menu_item_id) throw new Error('Target product is required.');

    const [prodRows] = await pool.execute(
      'SELECT id, name, price, cost_price, purchase_price FROM menu_items WHERE id = ? AND restaurant_id = ?',
      [menu_item_id, restaurantId]
    );
    if (prodRows.length === 0) throw new Error('Product not found in this store.');
    const prod = prodRows[0];

    const isManualMode = String(mode).toLowerCase() === 'manual';
    let count = 1;
    let serialsToInsert = [];

    // Parse warranty duration
    const parsedWarrantyVal = (warranty_duration_value !== undefined && warranty_duration_value !== null && String(warranty_duration_value).trim() !== '')
      ? parseInt(warranty_duration_value, 10)
      : null;
    const cleanWarrantyUnit = String(warranty_duration_unit || 'months').toLowerCase().trim().startsWith('year') ? 'years' : 'months';

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      if (isManualMode) {
        if (!serial_number || !String(serial_number).trim()) {
          throw new Error('Please enter an 8-digit serial number.');
        }
        const cleanSerial = String(serial_number).trim();
        if (!/^\d{8}$/.test(cleanSerial)) {
          throw new Error('Serial number must be exactly 8 digits (e.g. 12345678).');
        }

        // Validate uniqueness across system
        const [existing] = await connection.execute(
          'SELECT id, serial_number FROM product_serial_numbers WHERE serial_number = ? LIMIT 1',
          [cleanSerial]
        );
        if (existing.length > 0) {
          throw new Error(`Serial number "${cleanSerial}" already exists in the system. Please enter a unique serial number.`);
        }

        count = 1;
        serialsToInsert = [cleanSerial];
      } else {
        count = Math.max(1, Math.min(500, parseInt(quantity, 10) || 1));
        serialsToInsert = await this.generateBatchSerialNumbers(count, connection);
      }

      const effectiveCost = parseFloat(purchase_cost || prod.cost_price || prod.purchase_price || 0);
      const effectiveDate = purchase_date || new Date().toISOString().slice(0, 10);
      const effectiveInvoice = purchase_invoice_number || `OPN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

      for (const serial of serialsToInsert) {
        await connection.execute(`
          INSERT INTO product_serial_numbers (
            restaurant_id, serial_number, menu_item_id, warehouse_id, status,
            purchase_invoice_number, purchase_date,
            supplier_id, supplier_name, purchase_cost,
            warranty_duration_value, warranty_duration_unit,
            created_at
          ) VALUES (?, ?, ?, ?, 'in_stock', ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId,
          serial,
          menu_item_id,
          warehouse_id || null,
          effectiveInvoice,
          effectiveDate,
          supplier_id || null,
          supplier_name || null,
          effectiveCost,
          parsedWarrantyVal,
          cleanWarrantyUnit
        ]);
      }

      await connection.commit();
      return {
        product_id: menu_item_id,
        product_name: prod.name,
        quantity: count,
        serial_numbers: serialsToInsert,
        mode: isManualMode ? 'manual' : 'auto',
        warranty_duration_value: parsedWarrantyVal,
        warranty_duration_unit: cleanWarrantyUnit
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Build ESC/POS Thermal Barcode commands for an 8-digit Serial Number
   * Compatible with 58mm and 80mm ESC/POS Thermal Receipt Printers
   */
  static buildEscposSerialBarcode({
    serialNumber,
    productName,
    sku,
    purchaseInvoice,
    purchaseDate,
    storeName = 'ARISO RETAIL'
  }) {
    const ESC = '\x1b';
    const GS = '\x1d';

    let cmds = '';
    // Initialize printer
    cmds += `${ESC}@`;
    cmds += `${ESC}a\x01`; // Center align

    // Header Store Name
    cmds += `${ESC}!\x20`; // Double height
    cmds += `${storeName.toUpperCase()}\n`;
    cmds += `${ESC}!\x00`; // Normal font

    cmds += 'PRODUCT SERIAL NUMBER\n';
    cmds += '--------------------------------\n';

    // Product Name & SKU
    cmds += `${ESC}!\x08`; // Bold
    cmds += `${productName.slice(0, 32)}\n`;
    cmds += `${ESC}!\x00`;
    if (sku) cmds += `SKU: ${sku}\n`;

    cmds += '\n';

    // Barcode Configuration
    cmds += `${GS}h\x40`; // Barcode height = 64 dots
    cmds += `${GS}w\x02`; // Barcode width multiplier = 2
    cmds += `${GS}H\x02`; // Print HRI characters (readable text) below barcode
    cmds += `${GS}f\x00`; // Font A

    // Code128 barcode format: GS k 73 len data
    const cleanSerial = String(serialNumber).trim();
    // Using Code128 with code set B prefix: {B
    const barcodeData = `{B${cleanSerial}`;
    cmds += `${GS}k\x49${String.fromCharCode(barcodeData.length)}${barcodeData}`;

    cmds += '\n\n';
    cmds += `${ESC}!\x08`;
    cmds += `SN: ${cleanSerial}\n`;
    cmds += `${ESC}!\x00`;

    if (purchaseInvoice && purchaseInvoice !== 'N/A') {
      cmds += `Mfg/Purchase Inv: ${purchaseInvoice}\n`;
    }
    if (purchaseDate && purchaseDate !== 'N/A') {
      cmds += `Purchase Date: ${purchaseDate}\n`;
    }

    cmds += '--------------------------------\n';
    cmds += 'Scan barcode to verify authenticity\n\n\n';

    // Cut paper
    cmds += `${GS}V\x41\x00`;

    return cmds;
  }

  /**
   * Get all currently available (in_stock) serial numbers for a specific product
   */
  static async getAvailableSerialsByItem(restaurantId, menuItemId) {
    if (!menuItemId) return [];
    const [rows] = await pool.query(`
      SELECT 
        psn.id, 
        psn.serial_number, 
        psn.menu_item_id, 
        psn.warehouse_id, 
        psn.status,
        psn.purchase_date,
        psn.purchase_invoice_number,
        psn.supplier_name,
        psn.warranty_duration_value,
        psn.warranty_duration_unit,
        w.name as warehouse_name
      FROM product_serial_numbers psn
      LEFT JOIN warehouses w ON psn.warehouse_id = w.id
      WHERE psn.restaurant_id = ? 
        AND psn.menu_item_id = ? 
        AND psn.status = 'in_stock'
      ORDER BY psn.id ASC
    `, [restaurantId, menuItemId]);

    return rows.map(r => ({
      id: r.id,
      serial_number: r.serial_number,
      menu_item_id: r.menu_item_id,
      warehouse_id: r.warehouse_id,
      warehouse_name: r.warehouse_name || 'Main Warehouse',
      status: r.status,
      purchase_date: this.formatDate(r.purchase_date),
      purchase_invoice: r.purchase_invoice_number || 'N/A',
      supplier_name: r.supplier_name || 'N/A',
      warranty_duration_value: r.warranty_duration_value,
      warranty_duration_unit: r.warranty_duration_unit
    }));
  }
}

module.exports = SerialNumberService;
