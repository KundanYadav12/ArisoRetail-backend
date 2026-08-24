const pool = require('../config/db');

class ReportRepository {
  /**
   * Cashier Dashboard metrics for today
   */
  static async getCashierDashboardMetrics(restaurantId, cashierId) {
    const today = new Date().toISOString().slice(0, 10);
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
        SUM(
          CASE 
            WHEN rs.gst_mode = 'included' THEN (oi.price / (1 + (COALESCE(oi.gst_rate, 0) / 100))) * oi.quantity
            ELSE (oi.price * oi.quantity)
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
       GROUP BY COALESCE(oi.gst_rate, 0.00)
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
}

module.exports = ReportRepository;

