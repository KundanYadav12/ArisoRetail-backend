const pool = require('../config/db');
const { getISTDateString } = require('../utils/date_utils');

class ReportRepository {
  /**
   * Cashier Dashboard metrics for today
   */
  static async getCashierDashboardMetrics(restaurantId, cashierId) {
    const today = getISTDateString();
    const datePattern = `${today}%`;

    // 1. Sales, Bills Count, GST, and Discount totals
    const [salesRow] = await pool.execute(
      'SELECT COALESCE(SUM(total_amount), 0) as todaySales, ' +
      'COUNT(id) as billsCount, ' +
      'COALESCE(SUM(tax_amount), 0) as gstCollected, ' +
      'COALESCE(SUM(discount_amount), 0) as discountGiven, ' +
      'COALESCE(AVG(total_amount), 0) as avgBill ' +
      'FROM orders WHERE restaurant_id = ? AND cashier_id = ? AND created_at LIKE ? AND order_status = "completed"',
      [restaurantId, cashierId, datePattern]
    );

    // 2. Collection breakdown including wallet and other modes
    const [collectionRow] = await pool.execute(
      'SELECT ' +
      'COALESCE(SUM(CASE WHEN payment_mode = "cash" THEN total_amount ELSE 0 END), 0) as cashCollected, ' +
      'COALESCE(SUM(CASE WHEN payment_mode IN ("upi", "gpay", "phonepe", "paytm") THEN total_amount ELSE 0 END), 0) as upiCollected, ' +
      'COALESCE(SUM(CASE WHEN payment_mode IN ("card", "credit", "debit") THEN total_amount ELSE 0 END), 0) as cardCollected, ' +
      'COALESCE(SUM(CASE WHEN payment_mode = "wallet" THEN total_amount ELSE 0 END), 0) as walletCollected, ' +
      'COALESCE(SUM(CASE WHEN payment_mode NOT IN ("cash", "upi", "gpay", "phonepe", "paytm", "card", "credit", "debit", "wallet") THEN total_amount ELSE 0 END), 0) as otherCollected ' +
      'FROM orders WHERE restaurant_id = ? AND cashier_id = ? AND created_at LIKE ? AND order_status = "completed"',
      [restaurantId, cashierId, datePattern]
    );

    return {
      todaySales: parseFloat(salesRow[0].todaySales),
      billsCount: parseInt(salesRow[0].billsCount),
      avgBill: parseFloat(salesRow[0].avgBill),
      gstCollected: parseFloat(salesRow[0].gstCollected),
      discountGiven: parseFloat(salesRow[0].discountGiven),
      collections: {
        cash: parseFloat(collectionRow[0].cashCollected),
        upi: parseFloat(collectionRow[0].upiCollected),
        card: parseFloat(collectionRow[0].cardCollected),
        wallet: parseFloat(collectionRow[0].walletCollected),
        other: parseFloat(collectionRow[0].otherCollected),
        total: parseFloat(collectionRow[0].cashCollected) + 
               parseFloat(collectionRow[0].upiCollected) + 
               parseFloat(collectionRow[0].cardCollected) + 
               parseFloat(collectionRow[0].walletCollected) + 
               parseFloat(collectionRow[0].otherCollected)
      }
    };
  }

  /**
   * Admin General Dashboard & Custom Range report summaries
   */
  static async getSalesSummary(restaurantId, dateFrom, dateTo) {
    const [rows] = await pool.execute(
      'SELECT COALESCE(SUM(total_amount), 0) as totalRevenue, ' +
      'COALESCE(SUM(subtotal), 0) as subtotal, ' +
      'COALESCE(SUM(tax_amount), 0) as totalTax, ' +
      'COALESCE(SUM(discount_amount), 0) as totalDiscount, ' +
      'COUNT(id) as totalOrders ' +
      'FROM orders WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND (order_status != "cancelled" OR order_status IS NULL)',
      [restaurantId, dateFrom, dateTo]
    );
    return rows[0];
  }

  static async getPaymentBreakdown(restaurantId, dateFrom, dateTo) {
    const [rows] = await pool.execute(
      'SELECT LOWER(COALESCE(payment_mode, "cash")) as payment_mode, COALESCE(SUM(total_amount), 0) as totalAmount, COUNT(id) as orderCount ' +
      'FROM orders ' +
      'WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND (order_status != "cancelled" OR order_status IS NULL) ' +
      'GROUP BY LOWER(COALESCE(payment_mode, "cash"))',
      [restaurantId, dateFrom, dateTo]
    );
    return rows;
  }

  static async getTopSellingItems(restaurantId, dateFrom, dateTo, limit = 5) {
    const parsedLimit = parseInt(limit) || 5;
    const [rows] = await pool.execute(
      'SELECT name, SUM(quantity) as qtySold, SUM(price * quantity) as totalRevenue ' +
      'FROM order_items oi JOIN orders o ON oi.order_id = o.id ' +
      'WHERE o.restaurant_id = ? AND o.created_at >= ? AND o.created_at <= ? AND o.order_status != "cancelled" ' +
      'GROUP BY menu_item_id, name ' +
      `ORDER BY qtySold DESC LIMIT ${parsedLimit}`,
      [restaurantId, dateFrom, dateTo]
    );
    return rows;
  }

  static async getLeastSellingItems(restaurantId, dateFrom, dateTo, limit = 5) {
    const parsedLimit = parseInt(limit) || 5;
    const [rows] = await pool.execute(
      'SELECT name, SUM(quantity) as qtySold, SUM(price * quantity) as totalRevenue ' +
      'FROM order_items oi JOIN orders o ON oi.order_id = o.id ' +
      'WHERE o.restaurant_id = ? AND o.created_at >= ? AND o.created_at <= ? AND o.order_status != "cancelled" ' +
      'GROUP BY menu_item_id, name ' +
      `ORDER BY qtySold ASC LIMIT ${parsedLimit}`,
      [restaurantId, dateFrom, dateTo]
    );
    return rows;
  }

  static async getMostActiveCashiers(restaurantId, dateFrom, dateTo) {
    const [rows] = await pool.execute(
      'SELECT cashier_name, COUNT(id) as billsIssued, SUM(total_amount) as totalSales ' +
      'FROM orders ' +
      'WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status != "cancelled" ' +
      'GROUP BY cashier_id, cashier_name ' +
      'ORDER BY totalSales DESC',
      [restaurantId, dateFrom, dateTo]
    );
    return rows;
  }

  static async getPeakHours(restaurantId, dateFrom, dateTo) {
    const [rows] = await pool.execute(
      'SELECT HOUR(created_at) as hourOfDay, COUNT(id) as orderCount, SUM(total_amount) as hourlySales ' +
      'FROM orders ' +
      'WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status != "cancelled" ' +
      'GROUP BY HOUR(created_at) ' +
      'ORDER BY hourOfDay ASC',
      [restaurantId, dateFrom, dateTo]
    );
    return rows;
  }

  static async getDailySalesChartData(restaurantId, dateFrom, dateTo) {
    const [rows] = await pool.execute(
      'SELECT DATE(created_at) as salesDate, COALESCE(SUM(total_amount), 0) as dailyRevenue, COUNT(id) as orderCount ' +
      'FROM orders ' +
      'WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status != "cancelled" ' +
      'GROUP BY DATE(created_at) ' +
      'ORDER BY salesDate ASC',
      [restaurantId, dateFrom, dateTo]
    );
    return rows;
  }

  static async getTaxesAndDiscountsReport(restaurantId, dateFrom, dateTo) {
    const [rows] = await pool.execute(
      'SELECT DATE(created_at) as salesDate, ' +
      'SUM(subtotal) as subtotal, ' +
      'SUM(tax_amount) as taxCollected, ' +
      'SUM(discount_amount) as discountGiven, ' +
      'SUM(total_amount) as netSales ' +
      'FROM orders ' +
      'WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status != "cancelled" ' +
      'GROUP BY DATE(created_at) ' +
      'ORDER BY salesDate ASC',
      [restaurantId, dateFrom, dateTo]
    );
    return rows;
  }

  /**
   * Item-wise Sales Analytics Report
   */
  static async getItemWiseSalesReport(restaurantId, { dateFrom, dateTo, categoryId, search, sortBy = 'qtySold', sortOrder = 'DESC' }) {
    let query = `
      SELECT 
        COALESCE(oi.menu_item_id, 0) as item_id,
        oi.name,
        COALESCE(c.name, 'Uncategorized') as category_name,
        mi.sku,
        SUM(oi.quantity) as qty_sold,
        SUM(oi.price * oi.quantity) as gross_sales,
        SUM(oi.discount_amount) as discount_given,
        SUM(oi.tax_amount) as gst_collected,
        SUM((oi.price * oi.quantity) - oi.discount_amount) as net_sales,
        AVG(oi.price) as avg_selling_price,
        MAX(o.created_at) as last_sold_at
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
      LEFT JOIN categories c ON mi.category_id = c.id
      WHERE o.restaurant_id = ? 
        AND o.created_at >= ? 
        AND o.created_at <= ? 
        AND o.order_status != "cancelled"
    `;

    const params = [restaurantId, dateFrom, dateTo];

    if (categoryId && categoryId !== 'all') {
      query += ' AND mi.category_id = ?';
      params.push(categoryId);
    }

    if (search && search.trim()) {
      query += ' AND (oi.name LIKE ? OR mi.sku LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    query += ' GROUP BY oi.menu_item_id, oi.name, c.name, mi.sku';

    const sortCol = sortBy === 'netSales' ? 'net_sales' : sortBy === 'grossSales' ? 'gross_sales' : 'qty_sold';
    const direction = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortCol} ${direction}`;

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * CA-Ready GST Slab Summary & Invoice Audit Trail Report
   */
  static async getGstSlabReport(restaurantId, dateFrom, dateTo, paymentMode = 'all') {
    let paymentFilterSql = '';
    const params = [restaurantId, dateFrom, dateTo];

    if (paymentMode && paymentMode !== 'all') {
      paymentFilterSql = ' AND o.payment_mode = ?';
      params.push(paymentMode);
    }

    // 1. Fetch GST Slabs Breakdown (0%, 5%, 12%, 18%, 28%)
    const [slabRows] = await pool.execute(
      `SELECT 
        COALESCE(oi.gst_rate, 0.00) as gst_rate,
        COALESCE(o.tax_type, 'intra') as tax_type,
        SUM(
          CASE 
            WHEN rs.gst_mode = 'included' THEN ((oi.price * oi.quantity - oi.discount_amount) / (1 + (COALESCE(oi.gst_rate, 0) / 100)))
            ELSE (oi.price * oi.quantity - oi.discount_amount)
          END
        ) as taxable_amount,
        SUM(oi.tax_amount) as total_gst,
        COUNT(DISTINCT o.id) as invoice_count
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       LEFT JOIN receipt_settings rs ON o.restaurant_id = rs.restaurant_id
       WHERE o.restaurant_id = ? 
         AND o.created_at >= ? 
         AND o.created_at <= ? 
         AND o.order_status = 'completed'${paymentFilterSql}
       GROUP BY COALESCE(oi.gst_rate, 0.00), COALESCE(o.tax_type, 'intra')
       ORDER BY gst_rate ASC`,
      params
    );

    // 2. Fetch Itemized B2C Invoice Audit Trail
    const [invoiceRows] = await pool.execute(
      `SELECT 
        o.id,
        o.unique_order_number,
        o.created_at,
        o.customer_name,
        o.customer_phone,
        o.payment_mode,
        o.table_number_or_takeaway,
        o.subtotal,
        o.tax_amount,
        o.discount_amount,
        o.total_amount
       FROM orders o
       WHERE o.restaurant_id = ? 
         AND o.created_at >= ? 
         AND o.created_at <= ? 
         AND o.order_status = 'completed'${paymentFilterSql}
       ORDER BY o.id DESC`,
      params
    );

    // 3. Fetch Restaurant & GSTIN Header info
    const [receiptRows] = await pool.execute(
      'SELECT restaurant_name, branch_name, address, phone, gst_number FROM receipt_settings WHERE restaurant_id = ?',
      [restaurantId]
    );

    return {
      restaurantInfo: receiptRows[0] || {},
      slabs: slabRows,
      invoices: invoiceRows
    };
  }

  /**
   * Detailed sales transaction history for a specific menu item
   */
  static async getItemSalesHistory(restaurantId, itemId, { dateFrom, dateTo, limit = 50 }) {
    const [rows] = await pool.execute(`
      SELECT 
        o.id as order_id,
        o.unique_order_number,
        o.cashier_name,
        o.payment_mode,
        oi.quantity,
        oi.price,
        oi.discount_amount,
        oi.tax_amount,
        (oi.price * oi.quantity) as total_item_amount,
        o.created_at
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.restaurant_id = ? 
        AND oi.menu_item_id = ?
        AND o.created_at >= ? 
        AND o.created_at <= ?
        AND o.order_status != "cancelled"
      ORDER BY o.created_at DESC
      LIMIT ${parseInt(limit) || 50}
    `, [restaurantId, itemId, dateFrom, dateTo]);

    return rows;
  }

  /**
   * Complete GST Compliance & Liability Dashboard Summary
   */
  static async getGstDashboardSummary(restaurantId, dateFrom, dateTo) {
    // 1. Output GST from Sales Invoices
    const [salesRows] = await pool.execute(`
      SELECT 
        COUNT(id) as total_invoices,
        COALESCE(SUM(subtotal - discount_amount), 0) as taxable_sales,
        COALESCE(SUM(cgst_amount), 0) as output_cgst,
        COALESCE(SUM(sgst_amount), 0) as output_sgst,
        COALESCE(SUM(igst_amount), 0) as output_igst,
        COALESCE(SUM(tax_amount), 0) as total_output_tax,
        COALESCE(SUM(total_amount), 0) as gross_sales
      FROM orders
      WHERE restaurant_id = ?
        AND created_at >= ?
        AND created_at <= ?
        AND order_status = 'completed'
    `, [restaurantId, dateFrom, dateTo]);

    // 2. Sales Returns / Credit Notes (Output GST Reversal)
    const [cnRows] = await pool.execute(`
      SELECT 
        COUNT(id) as total_credit_notes,
        COALESCE(SUM(subtotal), 0) as cn_taxable,
        COALESCE(SUM(cgst_amount), 0) as cn_cgst,
        COALESCE(SUM(sgst_amount), 0) as cn_sgst,
        COALESCE(SUM(igst_amount), 0) as cn_igst,
        COALESCE(SUM(total_tax), 0) as cn_tax,
        COALESCE(SUM(total_amount), 0) as cn_amount
      FROM credit_notes
      WHERE restaurant_id = ?
        AND credit_note_date >= ?
        AND credit_note_date <= ?
        AND status = 'active'
    `, [restaurantId, dateFrom.slice(0, 10), dateTo.slice(0, 10)]);

    // 3. Input Tax Credit (ITC) from Purchase Bills
    const [purchaseRows] = await pool.execute(`
      SELECT 
        COUNT(id) as total_purchase_bills,
        COALESCE(SUM(subtotal - discount_amount), 0) as taxable_purchases,
        COALESCE(SUM(cgst_amount), 0) as input_cgst,
        COALESCE(SUM(sgst_amount), 0) as input_sgst,
        COALESCE(SUM(igst_amount), 0) as input_igst,
        COALESCE(SUM(tax_amount), 0) as total_input_tax,
        COALESCE(SUM(total_amount), 0) as gross_purchases
      FROM purchase_bills
      WHERE restaurant_id = ?
        AND bill_date >= ?
        AND bill_date <= ?
        AND status = 'received'
    `, [restaurantId, dateFrom.slice(0, 10), dateTo.slice(0, 10)]);

    // 4. Purchase Returns / Debit Notes (Input Tax Credit Reversal)
    const [prRows] = await pool.execute(`
      SELECT 
        COUNT(id) as total_debit_notes,
        COALESCE(SUM(total_amount), 0) as pr_amount,
        COALESCE(SUM(COALESCE(tax_amount, 0)), 0) as pr_tax
      FROM purchase_returns
      WHERE restaurant_id = ?
        AND return_date >= ?
        AND return_date <= ?
    `, [restaurantId, dateFrom.slice(0, 10), dateTo.slice(0, 10)]);

    const sales = salesRows[0] || {};
    const cn = cnRows[0] || {};
    const purchases = purchaseRows[0] || {};
    const pr = prRows[0] || {};

    // Calculate Net Liability
    const netOutputCgst = Math.max(0, parseFloat(sales.output_cgst || 0) - parseFloat(cn.cn_cgst || 0));
    const netOutputSgst = Math.max(0, parseFloat(sales.output_sgst || 0) - parseFloat(cn.cn_sgst || 0));
    const netOutputIgst = Math.max(0, parseFloat(sales.output_igst || 0) - parseFloat(cn.cn_igst || 0));

    const netInputCgst = Math.max(0, parseFloat(purchases.input_cgst || 0));
    const netInputSgst = Math.max(0, parseFloat(purchases.input_sgst || 0));
    const netInputIgst = Math.max(0, parseFloat(purchases.input_igst || 0));

    const payableCgst = Math.max(0, netOutputCgst - netInputCgst);
    const payableSgst = Math.max(0, netOutputSgst - netInputSgst);
    const payableIgst = Math.max(0, netOutputIgst - netInputIgst);
    const totalNetPayable = payableCgst + payableSgst + payableIgst;

    // 5. Rate-wise Slab Breakdown from order_items
    const [rateRows] = await pool.execute(`
      SELECT 
        oi.gst_rate,
        COALESCE(SUM(oi.taxable_amount), 0) as taxable_amount,
        COALESCE(SUM(oi.cgst_amount), 0) as cgst_amount,
        COALESCE(SUM(oi.sgst_amount), 0) as sgst_amount,
        COALESCE(SUM(oi.igst_amount), 0) as igst_amount,
        COALESCE(SUM(oi.tax_amount), 0) as total_tax
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.restaurant_id = ?
        AND o.created_at >= ?
        AND o.created_at <= ?
        AND o.order_status = 'completed'
      GROUP BY oi.gst_rate
      ORDER BY oi.gst_rate ASC
    `, [restaurantId, dateFrom, dateTo]);

    const rateBreakdown = {};
    for (const r of rateRows) {
      const slabKey = `${parseFloat(r.gst_rate || 0)}%`;
      rateBreakdown[slabKey] = {
        rate: parseFloat(r.gst_rate || 0),
        taxableAmount: parseFloat(r.taxable_amount || 0),
        cgstAmount: parseFloat(r.cgst_amount || 0),
        sgstAmount: parseFloat(r.sgst_amount || 0),
        igstAmount: parseFloat(r.igst_amount || 0),
        totalTax: parseFloat(r.total_tax || 0)
      };
    }

    // Fetch Store Settings
    const [settingsRows] = await pool.execute(
      'SELECT restaurant_name, legal_name, trade_name, gst_number, state, state_code, gst_registration_type FROM receipt_settings WHERE restaurant_id = ?',
      [restaurantId]
    );

    return {
      storeInfo: settingsRows[0] || {},
      sales: {
        totalInvoices: parseInt(sales.total_invoices || 0),
        taxableSales: parseFloat(sales.taxable_sales || 0),
        cgst: parseFloat(sales.output_cgst || 0),
        sgst: parseFloat(sales.output_sgst || 0),
        igst: parseFloat(sales.output_igst || 0),
        totalTax: parseFloat(sales.total_output_tax || 0),
        grossSales: parseFloat(sales.gross_sales || 0)
      },
      outputGst: {
        totalOutputTax: parseFloat(sales.total_output_tax || 0),
        totalTaxableAmount: parseFloat(sales.taxable_sales || 0),
        totalInvoices: parseInt(sales.total_invoices || 0),
        cgst: parseFloat(sales.output_cgst || 0),
        sgst: parseFloat(sales.output_sgst || 0),
        igst: parseFloat(sales.output_igst || 0)
      },
      creditNotes: {
        totalCount: parseInt(cn.total_credit_notes || 0),
        taxable: parseFloat(cn.cn_taxable || 0),
        cgst: parseFloat(cn.cn_cgst || 0),
        sgst: parseFloat(cn.cn_sgst || 0),
        igst: parseFloat(cn.cn_igst || 0),
        totalTax: parseFloat(cn.cn_tax || 0),
        totalReversedTax: parseFloat(cn.cn_tax || 0),
        totalAmount: parseFloat(cn.cn_amount || 0)
      },
      purchases: {
        totalBills: parseInt(purchases.total_purchase_bills || 0),
        taxablePurchases: parseFloat(purchases.taxable_purchases || 0),
        cgst: parseFloat(purchases.input_cgst || 0),
        sgst: parseFloat(purchases.input_sgst || 0),
        igst: parseFloat(purchases.input_igst || 0),
        totalTax: parseFloat(purchases.total_input_tax || 0),
        grossPurchases: parseFloat(purchases.gross_purchases || 0)
      },
      inputTaxCredit: {
        totalItc: parseFloat(purchases.total_input_tax || 0),
        totalTaxableAmount: parseFloat(purchases.taxable_purchases || 0),
        totalBills: parseInt(purchases.total_purchase_bills || 0),
        cgst: parseFloat(purchases.input_cgst || 0),
        sgst: parseFloat(purchases.input_sgst || 0),
        igst: parseFloat(purchases.input_igst || 0)
      },
      debitNotes: {
        totalCount: parseInt(pr.total_debit_notes || 0),
        totalAmount: parseFloat(pr.pr_amount || 0),
        totalTax: parseFloat(pr.pr_tax || 0)
      },
      liability: {
        netOutputCgst,
        netOutputSgst,
        netOutputIgst,
        totalNetOutput: netOutputCgst + netOutputSgst + netOutputIgst,
        itcCgst: netInputCgst,
        itcSgst: netInputSgst,
        itcIgst: netInputIgst,
        totalItc: netInputCgst + netInputSgst + netInputIgst,
        payableCgst,
        payableSgst,
        payableIgst,
        totalPayable: totalNetPayable
      },
      netGstPayable: totalNetPayable,
      rateBreakdown
    };
  }

  /**
   * GSTR-1 Ready Sales Register
   */
  static async getGstr1Report(restaurantId, dateFrom, dateTo) {
    // 1. Table 4: B2B Invoices (Registered Customers with GSTIN)
    const [b2bRows] = await pool.execute(`
      SELECT 
        o.id,
        o.id as order_id,
        o.unique_order_number as invoice_number,
        o.created_at as invoice_date,
        c.name as customer_name,
        c.name as receiver_name,
        c.gst_number as customer_gstin,
        c.gst_number as gstin_uin_of_recipient,
        COALESCE(o.place_of_supply, c.state, 'Intra-State') as place_of_supply,
        'N' as reverse_charge,
        'Regular' as invoice_type,
        (o.subtotal - o.discount_amount) as taxable_value,
        o.tax_amount,
        o.cgst_amount,
        o.cgst_amount as central_tax_amount,
        o.sgst_amount,
        o.sgst_amount as state_ut_tax_amount,
        o.igst_amount,
        o.igst_amount as integrated_tax_amount,
        o.total_amount as invoice_value,
        ei.irn,
        ei.status as irn_status,
        ewb.eway_bill_no as eway_bill_number,
        ewb.status as eway_bill_status
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN e_invoices ei ON o.id = ei.order_id
      LEFT JOIN e_way_bills ewb ON o.id = ewb.order_id
      WHERE o.restaurant_id = ?
        AND o.created_at >= ?
        AND o.created_at <= ?
        AND o.order_status = 'completed'
        AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL)
        AND (o.is_estimate = 0 OR o.is_estimate IS NULL)
        AND c.gst_number IS NOT NULL
        AND c.gst_number != ''
      ORDER BY o.id DESC
    `, [restaurantId, dateFrom, dateTo]);

    // 2. Table 7: B2C Invoices (Unregistered Customers)
    const [b2cRows] = await pool.execute(`
      SELECT 
        o.id,
        o.unique_order_number as invoice_number,
        o.created_at as invoice_date,
        COALESCE(o.customer_name, 'Consumer') as customer_name,
        COALESCE(o.place_of_supply, 'Intra-State') as place_of_supply,
        (o.subtotal - o.discount_amount) as taxable_value,
        o.tax_amount,
        o.cgst_amount,
        o.cgst_amount as central_tax_amount,
        o.sgst_amount,
        o.sgst_amount as state_ut_tax_amount,
        o.igst_amount,
        o.igst_amount as integrated_tax_amount,
        o.total_amount as invoice_value,
        o.payment_mode,
        COALESCE(
          (SELECT ROUND(AVG(oi.gst_rate), 2) FROM order_items oi WHERE oi.order_id = o.id),
          5.00
        ) as rate
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.restaurant_id = ?
        AND o.created_at >= ?
        AND o.created_at <= ?
        AND o.order_status = 'completed'
        AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL)
        AND (o.is_estimate = 0 OR o.is_estimate IS NULL)
        AND (c.gst_number IS NULL OR c.gst_number = '')
      ORDER BY o.id DESC
    `, [restaurantId, dateFrom, dateTo]);

    // 3. Table 9: Credit Notes
    const [cnRows] = await pool.execute(`
      SELECT 
        cn.*,
        o.unique_order_number as original_invoice_number,
        o.created_at as original_invoice_date,
        c.name as customer_name,
        c.gst_number as customer_gstin
      FROM credit_notes cn
      LEFT JOIN orders o ON cn.order_id = o.id
      LEFT JOIN customers c ON cn.customer_id = c.id
      WHERE cn.restaurant_id = ?
        AND cn.credit_note_date >= ?
        AND cn.credit_note_date <= ?
        AND cn.status = 'active'
      ORDER BY cn.id DESC
    `, [restaurantId, dateFrom.slice(0, 10), dateTo.slice(0, 10)]);

    // 4. Table 12: HSN-wise Sales Summary
    const [hsnRows] = await pool.execute(`
      SELECT 
        COALESCE(oi.hsn_code, m.hsn_code, '1905') as hsn_code,
        COALESCE(m.name, oi.name) as description,
        COALESCE(oi.weight_unit, m.base_unit, 'PCS') as uom,
        SUM(COALESCE(oi.item_weight, oi.quantity)) as total_quantity,
        SUM(COALESCE(oi.taxable_amount, (oi.price * oi.quantity - oi.discount_amount))) as total_taxable_value,
        SUM(COALESCE(oi.taxable_amount, (oi.price * oi.quantity - oi.discount_amount))) as taxable_value,
        COALESCE(oi.gst_rate, 5.00) as gst_rate,
        SUM(COALESCE(oi.cgst_amount, oi.tax_amount / 2)) as total_cgst,
        SUM(COALESCE(oi.cgst_amount, oi.tax_amount / 2)) as central_tax_amount,
        SUM(COALESCE(oi.sgst_amount, oi.tax_amount / 2)) as total_sgst,
        SUM(COALESCE(oi.sgst_amount, oi.tax_amount / 2)) as state_ut_tax_amount,
        SUM(COALESCE(oi.igst_amount, 0)) as total_igst,
        SUM(COALESCE(oi.igst_amount, 0)) as integrated_tax_amount,
        SUM(oi.tax_amount) as total_tax
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN menu_items m ON oi.menu_item_id = m.id
      WHERE o.restaurant_id = ?
        AND o.created_at >= ?
        AND o.created_at <= ?
        AND o.order_status = 'completed'
        AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL)
        AND (o.is_estimate = 0 OR o.is_estimate IS NULL)
      GROUP BY COALESCE(oi.hsn_code, m.hsn_code, '1905'), COALESCE(m.name, oi.name), COALESCE(oi.weight_unit, m.base_unit, 'PCS'), COALESCE(oi.gst_rate, 5.00)
      ORDER BY total_taxable_value DESC
    `, [restaurantId, dateFrom, dateTo]);

    return {
      b2b: b2bRows,
      b2c: b2cRows,
      creditNotes: cnRows,
      cdnr: cnRows,
      hsnSummary: hsnRows,
      hsn: hsnRows
    };
  }

  /**
   * GSTR-2 Ready Purchase Register (Inward Supplies & ITC)
   */
  static async getGstr2Report(restaurantId, dateFrom, dateTo) {
    const [billRows] = await pool.execute(`
      SELECT 
        pb.id,
        pb.bill_number,
        pb.internal_bill_number,
        pb.bill_date,
        s.name as supplier_name,
        COALESCE(pb.supplier_gstin, s.gst_number) as supplier_gstin,
        s.state as supplier_state,
        pb.place_of_supply,
        pb.tax_type,
        (pb.subtotal - pb.discount_amount) as taxable_value,
        pb.cgst_amount,
        pb.sgst_amount,
        pb.igst_amount,
        pb.tax_amount as total_itc,
        pb.additional_charges,
        pb.total_amount as invoice_value,
        pb.paid_amount,
        pb.payment_status
      FROM purchase_bills pb
      JOIN suppliers s ON pb.supplier_id = s.id
      WHERE pb.restaurant_id = ?
        AND pb.bill_date >= ?
        AND pb.bill_date <= ?
        AND pb.status = 'received'
      ORDER BY pb.id DESC
    `, [restaurantId, dateFrom.slice(0, 10), dateTo.slice(0, 10)]);

    const [prRows] = await pool.execute(`
      SELECT 
        pr.*,
        pb.bill_number as original_bill_number,
        s.name as supplier_name,
        s.gst_number as supplier_gstin
      FROM purchase_returns pr
      LEFT JOIN purchase_bills pb ON pr.purchase_bill_id = pb.id
      JOIN suppliers s ON pr.supplier_id = s.id
      WHERE pr.restaurant_id = ?
        AND pr.return_date >= ?
        AND pr.return_date <= ?
      ORDER BY pr.id DESC
    `, [restaurantId, dateFrom.slice(0, 10), dateTo.slice(0, 10)]);

    return {
      purchases: billRows,
      debitNotes: prRows
    };
  }

  /**
   * Complete HSN Summary (Sales + Purchases)
   */
  static async getHsnSummaryReport(restaurantId, dateFrom, dateTo) {
    const gstr1 = await this.getGstr1Report(restaurantId, dateFrom, dateTo);

    const [purchaseHsnRows] = await pool.execute(`
      SELECT 
        COALESCE(pbi.hsn_code, m.hsn_code, '1905') as hsn_code,
        pbi.item_name as description,
        pbi.unit as uom,
        SUM(pbi.quantity) as total_quantity,
        SUM(COALESCE(pbi.taxable_amount, (pbi.rate * pbi.quantity - pbi.discount_amount))) as total_taxable_value,
        pbi.tax_rate as gst_rate,
        SUM(COALESCE(pbi.cgst_amount, pbi.tax_amount / 2)) as total_cgst,
        SUM(COALESCE(pbi.sgst_amount, pbi.tax_amount / 2)) as total_sgst,
        SUM(COALESCE(pbi.igst_amount, 0)) as total_igst,
        SUM(pbi.tax_amount) as total_tax
      FROM purchase_bill_items pbi
      JOIN purchase_bills pb ON pbi.purchase_bill_id = pb.id
      LEFT JOIN menu_items m ON pbi.menu_item_id = m.id
      WHERE pb.restaurant_id = ?
        AND pb.bill_date >= ?
        AND pb.bill_date <= ?
        AND pb.status = 'received'
      GROUP BY COALESCE(pbi.hsn_code, m.hsn_code, '1905'), pbi.item_name, pbi.unit, pbi.tax_rate
      ORDER BY total_taxable_value DESC
    `, [restaurantId, dateFrom.slice(0, 10), dateTo.slice(0, 10)]);

    return {
      salesHsn: gstr1.hsnSummary,
      purchaseHsn: purchaseHsnRows,
      hsnSummary: gstr1.hsnSummary,
      hsn: gstr1.hsnSummary
    };
  }
}

module.exports = ReportRepository;


