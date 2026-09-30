const pool = require('../config/db');
const { getISTDateString, formatLocalDate } = require('../utils/date_utils');

class InventoryReportsEngine {
  /**
   * Resolve Date Range for Inventory Reports
   */
  static resolveDateRange(preset = 'month', queryFrom = '', queryTo = '') {
    const pad = (n) => String(n).padStart(2, '0');
    const formatYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const now = new Date();

    if (preset === 'custom' && queryFrom && queryTo) {
      let from = String(queryFrom).trim();
      let to = String(queryTo).trim();
      if (from.length === 10) from = `${from} 00:00:00`;
      if (to.length === 10) to = `${to} 23:59:59`;
      return { from, to, label: `${from.slice(0, 10)} to ${to.slice(0, 10)}`, preset };
    }

    let fromDate = new Date();
    let toDate = new Date();
    let label = '';

    switch (preset) {
      case 'today': {
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        label = `Today (${formatYmd(fromDate)})`;
        break;
      }
      case 'yesterday': {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        fromDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0);
        toDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
        label = `Yesterday (${formatYmd(fromDate)})`;
        break;
      }
      case 'this_week': {
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        fromDate = new Date(d.setDate(diff));
        fromDate.setHours(0, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        label = 'This Week';
        break;
      }
      case 'last_week': {
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
        fromDate = new Date(d.setDate(diff));
        fromDate.setHours(0, 0, 0, 0);
        const endLastWeek = new Date(fromDate);
        endLastWeek.setDate(endLastWeek.getDate() + 6);
        endLastWeek.setHours(23, 59, 59, 999);
        toDate = endLastWeek;
        label = 'Last Week';
        break;
      }
      case 'this_month':
      case 'month': {
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        label = 'This Month';
        break;
      }
      case 'last_month': {
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        label = 'Last Month';
        break;
      }
      case 'this_quarter':
      case 'quarter': {
        const currentQ = Math.floor(now.getMonth() / 3);
        fromDate = new Date(now.getFullYear(), currentQ * 3, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), (currentQ + 1) * 3, 0, 23, 59, 59);
        label = `Q${currentQ + 1} (${now.getFullYear()})`;
        break;
      }
      case 'this_fy':
      case 'fy':
      case 'year': {
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const fyStartYear = currentMonth >= 3 ? currentYear : currentYear - 1;
        fromDate = new Date(fyStartYear, 3, 1, 0, 0, 0);
        toDate = new Date(fyStartYear + 1, 2, 31, 23, 59, 59);
        label = `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
        break;
      }
      default: {
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        fromDate.setHours(0, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        label = 'Last 30 Days';
      }
    }

    const from = `${formatYmd(fromDate)} 00:00:00`;
    const to = `${formatYmd(toDate)} 23:59:59`;
    return { from, to, label, preset };
  }

  /**
   * Main Dispatcher for All 15 Inventory Reports
   */
  static async runInventoryReport(restaurantId, reportId, options = {}, user = {}) {
    const dateRange = this.resolveDateRange(options.preset, options.dateFrom, options.dateTo);
    const parsedPage = Math.max(1, parseInt(options.page) || 1);
    const parsedLimit = Math.min(500, Math.max(1, parseInt(options.limit) || 50));
    const offset = (parsedPage - 1) * parsedLimit;
    const search = (options.search || '').trim();
    const warehouseId = options.warehouseId || null;
    const categoryId = options.categoryId || null;

    switch (reportId) {
      case 'inventory_valuation_summary':
        return await this.getValuationSummary(restaurantId, { search, warehouseId, categoryId, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_godown_summary':
        return await this.getGodownSummary(restaurantId, { search, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_categorywise_summary':
        return await this.getCategorywiseSummary(restaurantId, { search, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_category_mis':
        return await this.getCategoryMisReport(restaurantId, { search, dateRange, page: parsedPage, limit: parsedLimit, offset });

      case 'inventory_groupwise_summary':
        return await this.getGroupwiseSummary(restaurantId, { search, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_negative_stock':
        return await this.getNegativeStockDetail(restaurantId, { search, warehouseId, categoryId, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_fifo_lot_tracking':
        return await this.getFifoLotTracking(restaurantId, { search, warehouseId, categoryId, dateRange, page: parsedPage, limit: parsedLimit, offset });

      case 'inventory_stock_summary':
        return await this.getStockSummaryReport(restaurantId, { search, warehouseId, categoryId, dateRange, page: parsedPage, limit: parsedLimit, offset });

      case 'inventory_highest_selling':
        return await this.getHighestSellingItems(restaurantId, { search, categoryId, dateRange, page: parsedPage, limit: parsedLimit, offset });

      case 'inventory_least_selling':
        return await this.getLeastSellingItems(restaurantId, { search, categoryId, dateRange, page: parsedPage, limit: parsedLimit, offset });

      case 'inventory_batch_wise':
        return await this.getBatchWiseItems(restaurantId, { search, warehouseId, categoryId, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_item_stock_levels':
        return await this.getItemStockLevels(restaurantId, { search, warehouseId, categoryId, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_reorder_suggestions':
        return await this.getReorderSuggestions(restaurantId, { search, warehouseId, categoryId, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_reserved_stock':
        return await this.getReservedStockReport(restaurantId, { search, warehouseId, categoryId, page: parsedPage, limit: parsedLimit, offset, dateRange });

      case 'inventory_challan_invoice_variance':
        return await this.getChallanInvoiceVarianceReport(restaurantId, { search, warehouseId, dateRange, page: parsedPage, limit: parsedLimit, offset });

      default:
        throw new Error(`Unknown inventory report ID: ${reportId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 1. INVENTORY VALUATION SUMMARY
  // ---------------------------------------------------------------------------
  static async getValuationSummary(restaurantId, { search, warehouseId, categoryId, page, limit, offset, dateRange }) {
    let whereClause = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service'`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ? OR mi.brand LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    let stockSelect = `COALESCE(mi.current_stock, 0)`;
    let joinWarehouse = ``;
    if (warehouseId) {
      joinWarehouse = `LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND ws.warehouse_id = ?`;
      stockSelect = `COALESCE(ws.current_stock, 0)`;
      params.unshift(warehouseId);
    }

    const countSql = `
      SELECT COUNT(*) as totalCount,
             COALESCE(SUM(${stockSelect}), 0) as totalStockOnHand,
             COALESCE(SUM(${stockSelect} * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) as totalAssetValue
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      ${joinWarehouse}
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;
    const totalStockOnHand = parseFloat(countRows[0]?.totalStockOnHand || 0);
    const totalAssetValue = parseFloat(countRows[0]?.totalAssetValue || 0);

    const dataSql = `
      SELECT 
        mi.id,
        mi.name as item_name,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(mi.brand, '-') as brand,
        COALESCE(mi.hsn_code, '-') as hsn_sac,
        ROUND(${stockSelect}, 2) as stock_on_hand,
        COALESCE(mi.unit, 'PCS') as unit,
        ROUND(COALESCE(mi.cost_price, mi.purchase_price, 0), 2) as rate,
        ROUND(${stockSelect} * COALESCE(mi.cost_price, mi.purchase_price, 0), 2) as asset_value
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      ${joinWarehouse}
      ${whereClause}
      ORDER BY mi.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(dataSql, params);

    return {
      title: 'Inventory Valuation Summary',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalItems: totalCount,
        totalStockOnHand: parseFloat(totalStockOnHand.toFixed(2)),
        totalStockValue: parseFloat(totalAssetValue.toFixed(2)),
        totalAssetValue: parseFloat(totalAssetValue.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 2. GODOWN SUMMARY
  // ---------------------------------------------------------------------------
  static async getGodownSummary(restaurantId, { search, page, limit, offset, dateRange }) {
    let whereClause = `WHERE w.restaurant_id = ?`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (w.name LIKE ? OR w.code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const countSql = `
      SELECT COUNT(DISTINCT w.id) as totalCount
      FROM warehouses w
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        w.id as godown_id,
        w.name as godown_name,
        COUNT(DISTINCT CASE WHEN ws.current_stock > 0 THEN ws.menu_item_id END) as item_count,
        ROUND(COALESCE(SUM(ws.current_stock), 0), 2) as quantity,
        ROUND(CASE 
          WHEN COALESCE(SUM(ws.current_stock), 0) > 0 
          THEN COALESCE(SUM(ws.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) / SUM(ws.current_stock)
          ELSE 0 
        END, 2) as rate,
        ROUND(COALESCE(SUM(ws.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0), 2) as amount
      FROM warehouses w
      LEFT JOIN warehouse_stocks ws ON w.id = ws.warehouse_id
      LEFT JOIN menu_items mi ON ws.menu_item_id = mi.id
      ${whereClause}
      GROUP BY w.id, w.name
      ORDER BY w.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(dataSql, params);

    // Compute grand totals across all warehouses
    const [totRows] = await pool.execute(`
      SELECT 
        COALESCE(SUM(ws.current_stock), 0) as grandQty,
        COALESCE(SUM(ws.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) as grandAmount
      FROM warehouses w
      LEFT JOIN warehouse_stocks ws ON w.id = ws.warehouse_id
      LEFT JOIN menu_items mi ON ws.menu_item_id = mi.id
      ${whereClause}
    `, params);

    const grandQty = parseFloat(totRows[0]?.grandQty || 0);
    const grandAmount = parseFloat(totRows[0]?.grandAmount || 0);

    return {
      title: 'Godown Summary',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalGodowns: totalCount,
        totalQuantity: parseFloat(grandQty.toFixed(2)),
        totalStockValue: parseFloat(grandAmount.toFixed(2)),
        grandTotal: parseFloat(grandAmount.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 3. CATEGORYWISE SUMMARY
  // ---------------------------------------------------------------------------
  static async getCategorywiseSummary(restaurantId, { search, page, limit, offset, dateRange }) {
    let whereClause = `WHERE c.restaurant_id = ?`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND c.name LIKE ?`;
      params.push(`%${search}%`);
    }

    const countSql = `
      SELECT COUNT(DISTINCT c.id) as totalCount
      FROM categories c
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        c.id as category_id,
        c.name as category_name,
        COUNT(DISTINCT mi.id) as item_count,
        ROUND(COALESCE(SUM(mi.current_stock), 0), 2) as quantity,
        ROUND(CASE 
          WHEN COALESCE(SUM(mi.current_stock), 0) > 0 
          THEN COALESCE(SUM(mi.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) / SUM(mi.current_stock)
          ELSE 0 
        END, 2) as rate,
        ROUND(COALESCE(SUM(mi.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0), 2) as amount
      FROM categories c
      LEFT JOIN menu_items mi ON c.id = mi.category_id AND mi.restaurant_id = c.restaurant_id AND mi.goods_or_service != 'service'
      ${whereClause}
      GROUP BY c.id, c.name
      ORDER BY c.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(dataSql, params);

    const [totRows] = await pool.execute(`
      SELECT 
        COALESCE(SUM(mi.current_stock), 0) as grandQty,
        COALESCE(SUM(mi.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) as grandAmount
      FROM categories c
      LEFT JOIN menu_items mi ON c.id = mi.category_id AND mi.restaurant_id = c.restaurant_id AND mi.goods_or_service != 'service'
      ${whereClause}
    `, params);

    const grandQty = parseFloat(totRows[0]?.grandQty || 0);
    const grandAmount = parseFloat(totRows[0]?.grandAmount || 0);

    return {
      title: 'Categorywise Summary',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalCategories: totalCount,
        totalQuantity: parseFloat(grandQty.toFixed(2)),
        totalStockValue: parseFloat(grandAmount.toFixed(2)),
        grandTotal: parseFloat(grandAmount.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 4. CATEGORY-WISE MIS REPORT
  // ---------------------------------------------------------------------------
  static async getCategoryMisReport(restaurantId, { search, dateRange, page, limit, offset }) {
    const fromDateOnly = dateRange.from.slice(0, 10);
    const toDateOnly = dateRange.to.slice(0, 10);

    let searchCond = '';
    const searchParams = [];
    if (search) {
      searchCond = ` AND c.name LIKE ?`;
      searchParams.push(`%${search}%`);
    }

    const [countRows] = await pool.execute(`
      SELECT COUNT(DISTINCT c.id) as totalCount
      FROM categories c
      WHERE c.restaurant_id = ? ${searchCond}
    `, [restaurantId, ...searchParams]);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        c.id as category_id,
        c.name as category_name,
        
        -- Purchase MIS Data
        ROUND(COALESCE(p.purchase_qty, 0), 2) as purchase_qty,
        ROUND(COALESCE(p.purchase_cost, 0), 2) as purchase_cost,
        ROUND(COALESCE(p.purchase_selling, 0), 2) as purchase_selling,
        ROUND(COALESCE(p.purchase_mrp, 0), 2) as purchase_mrp,
        ROUND(COALESCE(p.purchase_taxable_amount, 0), 2) as purchase_taxable_amount,
        ROUND(COALESCE(p.purchase_tax_amount, 0), 2) as purchase_tax_amount,
        ROUND(COALESCE(p.purchase_total_amount, 0), 2) as purchase_total_amount,
        
        -- Sales MIS Data
        ROUND(COALESCE(s.sales_qty, 0), 2) as sales_qty,
        ROUND(COALESCE(s.sales_revenue, 0), 2) as sales_revenue
      FROM categories c
      LEFT JOIN (
        SELECT 
          mi.category_id,
          SUM(pbi.quantity) as purchase_qty,
          SUM(pbi.taxable_amount) as purchase_cost,
          SUM(pbi.quantity * COALESCE(mi.price, pbi.rate)) as purchase_selling,
          SUM(pbi.quantity * COALESCE(mi.mrp, mi.price, pbi.rate)) as purchase_mrp,
          SUM(pbi.taxable_amount) as purchase_taxable_amount,
          SUM(pbi.tax_amount) as purchase_tax_amount,
          SUM(pbi.total_amount) as purchase_total_amount
        FROM purchase_bill_items pbi
        JOIN purchase_bills pb ON pbi.purchase_bill_id = pb.id
        JOIN menu_items mi ON pbi.menu_item_id = mi.id
        WHERE pb.restaurant_id = ? AND pb.bill_date >= ? AND pb.bill_date <= ?
        GROUP BY mi.category_id
      ) p ON c.id = p.category_id
      LEFT JOIN (
        SELECT 
          mi.category_id,
          SUM(oi.quantity) as sales_qty,
          SUM(oi.total_price) as sales_revenue
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN menu_items mi ON oi.menu_item_id = mi.id
        WHERE o.restaurant_id = ? AND o.order_status = 'completed' AND o.created_at >= ? AND o.created_at <= ?
        GROUP BY mi.category_id
      ) s ON c.id = s.category_id
      WHERE c.restaurant_id = ? ${searchCond}
      ORDER BY c.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const queryParams = [
      restaurantId, fromDateOnly, toDateOnly,
      restaurantId, dateRange.from, dateRange.to,
      restaurantId, ...searchParams
    ];
    const [rows] = await pool.execute(dataSql, queryParams);

    // Calculate Summary totals
    let totPurchaseQty = 0;
    let totPurchaseCost = 0;
    let totPurchaseTax = 0;
    let totPurchaseAmount = 0;
    let totSalesQty = 0;
    let totSalesRevenue = 0;

    rows.forEach(r => {
      totPurchaseQty += parseFloat(r.purchase_qty || 0);
      totPurchaseCost += parseFloat(r.purchase_cost || 0);
      totPurchaseTax += parseFloat(r.purchase_tax_amount || 0);
      totPurchaseAmount += parseFloat(r.purchase_total_amount || 0);
      totSalesQty += parseFloat(r.sales_qty || 0);
      totSalesRevenue += parseFloat(r.sales_revenue || 0);
    });

    return {
      title: 'Category-wise MIS Report',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalPurchaseQty: parseFloat(totPurchaseQty.toFixed(2)),
        totalPurchaseCost: parseFloat(totPurchaseCost.toFixed(2)),
        totalPurchaseTax: parseFloat(totPurchaseTax.toFixed(2)),
        totalPurchaseAmount: parseFloat(totPurchaseAmount.toFixed(2)),
        totalSalesQty: parseFloat(totSalesQty.toFixed(2)),
        totalSalesRevenue: parseFloat(totSalesRevenue.toFixed(2)),
        grandTotal: parseFloat(totPurchaseAmount.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 5. GROUPWISE SUMMARY
  // ---------------------------------------------------------------------------
  static async getGroupwiseSummary(restaurantId, { search, page, limit, offset, dateRange }) {
    let whereClause = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service'`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.item_group LIKE ? OR mi.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const countSql = `
      SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General')) as totalCount
      FROM menu_items mi
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        COUNT(DISTINCT mi.id) as item_count,
        ROUND(COALESCE(SUM(mi.current_stock), 0), 2) as quantity,
        ROUND(CASE 
          WHEN COALESCE(SUM(mi.current_stock), 0) > 0 
          THEN COALESCE(SUM(mi.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) / SUM(mi.current_stock)
          ELSE 0 
        END, 2) as rate,
        ROUND(COALESCE(SUM(mi.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0), 2) as amount
      FROM menu_items mi
      ${whereClause}
      GROUP BY COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General')
      ORDER BY group_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(dataSql, params);

    const [totRows] = await pool.execute(`
      SELECT 
        COALESCE(SUM(mi.current_stock), 0) as grandQty,
        COALESCE(SUM(mi.current_stock * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) as grandAmount
      FROM menu_items mi
      ${whereClause}
    `, params);

    const grandQty = parseFloat(totRows[0]?.grandQty || 0);
    const grandAmount = parseFloat(totRows[0]?.grandAmount || 0);

    return {
      title: 'Groupwise Summary',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalGroups: totalCount,
        totalQuantity: parseFloat(grandQty.toFixed(2)),
        totalStockValue: parseFloat(grandAmount.toFixed(2)),
        grandTotal: parseFloat(grandAmount.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 6. INVENTORY NEGATIVE STOCK DETAIL
  // ---------------------------------------------------------------------------
  static async getNegativeStockDetail(restaurantId, { search, warehouseId, categoryId, page, limit, offset, dateRange }) {
    let whereClause = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service' AND mi.current_stock < 0`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    const countSql = `
      SELECT COUNT(*) as totalCount,
             COALESCE(SUM(mi.current_stock), 0) as totalDeficitQty,
             COALESCE(SUM(ABS(mi.current_stock) * COALESCE(mi.cost_price, mi.purchase_price, 0)), 0) as totalDeficitValue
      FROM menu_items mi
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;
    const totalDeficitQty = parseFloat(countRows[0]?.totalDeficitQty || 0);
    const totalDeficitValue = parseFloat(countRows[0]?.totalDeficitValue || 0);

    const dataSql = `
      SELECT 
        mi.id,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        'Main Godown' as warehouse_name,
        ROUND(mi.current_stock, 2) as negative_stock_qty,
        COALESCE(mi.unit, 'PCS') as unit,
        ROUND(COALESCE(mi.cost_price, mi.purchase_price, 0), 2) as rate,
        ROUND(ABS(mi.current_stock) * COALESCE(mi.cost_price, mi.purchase_price, 0), 2) as deficit_value
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      ${whereClause}
      ORDER BY mi.current_stock ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(dataSql, params);

    return {
      title: 'Inventory Negative Stock Detail',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        negativeItemsCount: totalCount,
        totalDeficitQuantity: parseFloat(totalDeficitQty.toFixed(2)),
        totalDeficitValue: parseFloat(totalDeficitValue.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 7. FIFO COST LOT TRACKING
  // ---------------------------------------------------------------------------
  static async getFifoLotTracking(restaurantId, { search, warehouseId, categoryId, dateRange, page, limit, offset }) {
    // 1. Fetch items to track
    let itemWhere = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service'`;
    const itemParams = [restaurantId];
    if (search) {
      itemWhere += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ?)`;
      itemParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      itemWhere += ` AND mi.category_id = ?`;
      itemParams.push(categoryId);
    }

    const [itemRows] = await pool.execute(`
      SELECT mi.id, mi.name, mi.sku, mi.item_code, mi.cost_price, mi.purchase_price
      FROM menu_items mi
      ${itemWhere}
      ORDER BY mi.name ASC
    `, itemParams);

    const itemIds = itemRows.map(i => i.id);
    if (itemIds.length === 0) {
      return {
        title: 'FIFO Cost Lot Tracking',
        dateRange,
        pagination: { page, limit, totalCount: 0, totalPages: 1 },
        summary: { totalLots: 0, totalRemainingQty: 0, totalLotAssetValue: 0 },
        rows: []
      };
    }

    // 2. Fetch all inward transactions (Lots)
    const inwardTypes = ['OPENING_STOCK', 'PURCHASE', 'TRANSFER_IN', 'ADJUSTMENT_IN'];
    const placeholders = itemIds.map(() => '?').join(',');

    const [inwardRows] = await pool.execute(`
      SELECT 
        st.id,
        st.menu_item_id,
        st.warehouse_id,
        st.transaction_type,
        st.reference_number,
        st.quantity as inward_qty,
        st.created_at,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(mi.cost_price, mi.purchase_price, 0) as unit_cost
      FROM stock_transactions st
      JOIN menu_items mi ON st.menu_item_id = mi.id
      WHERE st.restaurant_id = ? AND st.menu_item_id IN (${placeholders})
        AND st.transaction_type IN ('OPENING_STOCK', 'PURCHASE', 'TRANSFER_IN', 'ADJUSTMENT_IN')
      ORDER BY st.menu_item_id, st.created_at ASC, st.id ASC
    `, [restaurantId, ...itemIds]);

    // 3. Fetch cumulative outward quantity per item
    const [outwardRows] = await pool.execute(`
      SELECT 
        st.menu_item_id,
        COALESCE(SUM(st.quantity), 0) as total_outward_qty
      FROM stock_transactions st
      WHERE st.restaurant_id = ? AND st.menu_item_id IN (${placeholders})
        AND st.transaction_type IN ('SALE', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRED', 'ADJUSTMENT_OUT', 'PURCHASE_RETURN')
      GROUP BY st.menu_item_id
    `, [restaurantId, ...itemIds]);

    const outwardMap = {};
    outwardRows.forEach(r => {
      outwardMap[r.menu_item_id] = parseFloat(r.total_outward_qty || 0);
    });

    // 4. Perform FIFO lot depletion
    const allLots = [];
    const itemOutwardTracker = { ...outwardMap };

    for (const lot of inwardRows) {
      const mId = lot.menu_item_id;
      const inwardQty = parseFloat(lot.inward_qty || 0);
      const remainingOutward = itemOutwardTracker[mId] || 0;

      let consumedQty = 0;
      if (remainingOutward > 0) {
        if (remainingOutward >= inwardQty) {
          consumedQty = inwardQty;
          itemOutwardTracker[mId] = remainingOutward - inwardQty;
        } else {
          consumedQty = remainingOutward;
          itemOutwardTracker[mId] = 0;
        }
      }

      const balanceQty = Math.max(0, inwardQty - consumedQty);
      const unitCost = parseFloat(lot.unit_cost || 0);
      const balanceValue = balanceQty * unitCost;

      let lotStatus = 'Unconsumed';
      if (balanceQty === 0) lotStatus = 'Fully Consumed';
      else if (consumedQty > 0) lotStatus = 'Partially Consumed';

      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date(lot.created_at);
      const formattedDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

      allLots.push({
        lot_id: lot.id,
        lot_date: formattedDate,
        item_name: lot.item_name,
        item_code: lot.item_code,
        lot_ref: lot.reference_number || `LOT-${lot.id}`,
        source_type: lot.transaction_type.replace(/_/g, ' '),
        inward_qty: parseFloat(inwardQty.toFixed(2)),
        unit_cost: parseFloat(unitCost.toFixed(2)),
        consumed_qty: parseFloat(consumedQty.toFixed(2)),
        balance_qty: parseFloat(balanceQty.toFixed(2)),
        balance_value: parseFloat(balanceValue.toFixed(2)),
        lot_status: lotStatus
      });
    }

    const totalCount = allLots.length;
    const paginatedRows = allLots.slice(offset, offset + limit);

    let totalRemainingQty = 0;
    let totalLotAssetValue = 0;
    allLots.forEach(l => {
      totalRemainingQty += l.balance_qty;
      totalLotAssetValue += l.balance_value;
    });

    return {
      title: 'FIFO Cost Lot Tracking',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalLots: totalCount,
        totalRemainingQty: parseFloat(totalRemainingQty.toFixed(2)),
        totalStockValue: parseFloat(totalLotAssetValue.toFixed(2)),
        totalLotAssetValue: parseFloat(totalLotAssetValue.toFixed(2)),
        grandTotal: parseFloat(totalLotAssetValue.toFixed(2))
      },
      rows: paginatedRows
    };
  }

  // ---------------------------------------------------------------------------
  // 8. STOCK SUMMARY REPORT
  // ---------------------------------------------------------------------------
  static async getStockSummaryReport(restaurantId, { search, warehouseId, categoryId, dateRange, page, limit, offset }) {
    let whereClause = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service'`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    const countSql = `SELECT COUNT(*) as totalCount FROM menu_items mi ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        mi.id,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(mi.unit, 'PCS') as unit,
        mi.current_stock as live_current_stock,
        
        -- 1. Movements Before Date Range (Opening Balance)
        COALESCE(pre.pre_in, 0) - COALESCE(pre.pre_out, 0) as calculated_opening,
        
        -- 2. Movements During Date Range
        COALESCE(dur.purchase_qty, 0) as purchase_qty,
        COALESCE(dur.transfer_in_qty, 0) as transfer_in_qty,
        COALESCE(dur.excess_qty, 0) as excess_qty,
        0 as production_qty,
        (COALESCE(dur.purchase_qty, 0) + COALESCE(dur.transfer_in_qty, 0) + COALESCE(dur.excess_qty, 0)) as total_in_qty,
        
        COALESCE(dur.sales_qty, 0) as sales_qty,
        COALESCE(dur.transfer_out_qty, 0) as transfer_out_qty,
        COALESCE(dur.shortage_qty, 0) as shortage_qty,
        0 as consumption_qty,
        (COALESCE(dur.sales_qty, 0) + COALESCE(dur.transfer_out_qty, 0) + COALESCE(dur.shortage_qty, 0)) as total_out_qty
      FROM menu_items mi
      LEFT JOIN (
        SELECT 
          st.menu_item_id,
          SUM(CASE WHEN st.transaction_type IN ('OPENING_STOCK', 'PURCHASE', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'STOCK_CORRECTION') THEN st.quantity ELSE 0 END) as pre_in,
          SUM(CASE WHEN st.transaction_type IN ('SALE', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRED', 'ADJUSTMENT_OUT', 'PURCHASE_RETURN') THEN st.quantity ELSE 0 END) as pre_out
        FROM stock_transactions st
        WHERE st.restaurant_id = ? AND st.created_at < ?
        GROUP BY st.menu_item_id
      ) pre ON mi.id = pre.menu_item_id
      LEFT JOIN (
        SELECT 
          st.menu_item_id,
          SUM(CASE WHEN st.transaction_type = 'PURCHASE' THEN st.quantity ELSE 0 END) as purchase_qty,
          SUM(CASE WHEN st.transaction_type = 'TRANSFER_IN' THEN st.quantity ELSE 0 END) as transfer_in_qty,
          SUM(CASE WHEN st.transaction_type IN ('ADJUSTMENT_IN', 'OPENING_STOCK', 'STOCK_CORRECTION') THEN st.quantity ELSE 0 END) as excess_qty,
          SUM(CASE WHEN st.transaction_type = 'SALE' THEN st.quantity ELSE 0 END) as sales_qty,
          SUM(CASE WHEN st.transaction_type = 'TRANSFER_OUT' THEN st.quantity ELSE 0 END) as transfer_out_qty,
          SUM(CASE WHEN st.transaction_type IN ('DAMAGE', 'EXPIRED', 'ADJUSTMENT_OUT', 'PURCHASE_RETURN') THEN st.quantity ELSE 0 END) as shortage_qty
        FROM stock_transactions st
        WHERE st.restaurant_id = ? AND st.created_at >= ? AND st.created_at <= ?
        GROUP BY st.menu_item_id
      ) dur ON mi.id = dur.menu_item_id
      ${whereClause}
      ORDER BY mi.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const queryParams = [
      restaurantId, dateRange.from,
      restaurantId, dateRange.from, dateRange.to,
      ...params
    ];
    const [rawRows] = await pool.execute(dataSql, queryParams);

    const rows = rawRows.map(r => {
      const opening = parseFloat(r.calculated_opening || 0);
      const totalIn = parseFloat(r.total_in_qty || 0);
      const totalOut = parseFloat(r.total_out_qty || 0);
      const closingStock = opening + totalIn - totalOut;
      const closingSummary = parseFloat(r.live_current_stock || 0);
      const difference = closingSummary - closingStock;

      return {
        item_name: r.item_name,
        item_code: r.item_code,
        unit: r.unit,
        opening: parseFloat(opening.toFixed(2)),
        purchase: parseFloat(parseFloat(r.purchase_qty || 0).toFixed(2)),
        transfer_in: parseFloat(parseFloat(r.transfer_in_qty || 0).toFixed(2)),
        excess: parseFloat(parseFloat(r.excess_qty || 0).toFixed(2)),
        production: 0,
        total_in: parseFloat(totalIn.toFixed(2)),
        sales: parseFloat(parseFloat(r.sales_qty || 0).toFixed(2)),
        transfer_out: parseFloat(parseFloat(r.transfer_out_qty || 0).toFixed(2)),
        shortage: parseFloat(parseFloat(r.shortage_qty || 0).toFixed(2)),
        consumption: 0,
        total_out: parseFloat(totalOut.toFixed(2)),
        closing_stock: parseFloat(closingStock.toFixed(2)),
        closing_summary: parseFloat(closingSummary.toFixed(2)),
        difference: parseFloat(difference.toFixed(2))
      };
    });

    let totOpening = 0, totIn = 0, totOut = 0, totClosing = 0, totSummary = 0, totDiff = 0;
    rows.forEach(r => {
      totOpening += r.opening;
      totIn += r.total_in;
      totOut += r.total_out;
      totClosing += r.closing_stock;
      totSummary += r.closing_summary;
      totDiff += r.difference;
    });

    return {
      title: 'Stock Summary Report',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalOpening: parseFloat(totOpening.toFixed(2)),
        totalIn: parseFloat(totIn.toFixed(2)),
        totalOut: parseFloat(totOut.toFixed(2)),
        totalClosing: parseFloat(totClosing.toFixed(2)),
        totalClosingSummary: parseFloat(totSummary.toFixed(2)),
        totalDifference: parseFloat(totDiff.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 9. HIGHEST SELLING ITEMS
  // ---------------------------------------------------------------------------
  static async getHighestSellingItems(restaurantId, { search, categoryId, dateRange, page, limit, offset }) {
    let whereClause = `WHERE o.restaurant_id = ? AND o.order_status = 'completed' AND o.created_at >= ? AND o.created_at <= ?`;
    const params = [restaurantId, dateRange.from, dateRange.to];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    const countSql = `
      SELECT COUNT(DISTINCT oi.menu_item_id) as totalCount
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        mi.id as item_id,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        ROUND(SUM(oi.quantity), 2) as qty_sold,
        ROUND(SUM(oi.quantity * COALESCE(oi.price, mi.price)), 2) as total_sales,
        ROUND(SUM(COALESCE(oi.discount_amount, 0)), 2) as discount_amount,
        ROUND(SUM(oi.total_price), 2) as net_sales,
        ROUND(SUM(oi.total_price) / NULLIF(SUM(oi.quantity), 0), 2) as avg_rate,
        COUNT(DISTINCT o.id) as orders_count
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN menu_items mi ON oi.menu_item_id = mi.id
      LEFT JOIN categories c ON mi.category_id = c.id
      ${whereClause}
      GROUP BY mi.id, mi.name, mi.sku, mi.item_code, c.name, mi.item_group
      ORDER BY qty_sold DESC, net_sales DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(dataSql, params);

    let totQty = 0, totGross = 0, totDisc = 0, totNet = 0;
    rows.forEach(r => {
      totQty += parseFloat(r.qty_sold || 0);
      totGross += parseFloat(r.total_sales || 0);
      totDisc += parseFloat(r.discount_amount || 0);
      totNet += parseFloat(r.net_sales || 0);
    });

    return {
      title: 'Highest Selling Items',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalQuantitySold: parseFloat(totQty.toFixed(2)),
        grossSales: parseFloat(totGross.toFixed(2)),
        discounts: parseFloat(totDisc.toFixed(2)),
        netSales: parseFloat(totNet.toFixed(2)),
        grandTotal: parseFloat(totNet.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 10. LEAST SELLING ITEMS (INDEPENDENT QUERY - INCLUDES 0-SALES ITEMS)
  // ---------------------------------------------------------------------------
  static async getLeastSellingItems(restaurantId, { search, categoryId, dateRange, page, limit, offset }) {
    let whereClause = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service'`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    const countSql = `SELECT COUNT(*) as totalCount FROM menu_items mi ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        mi.id as item_id,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        ROUND(COALESCE(mi.current_stock, 0), 2) as current_stock,
        ROUND(COALESCE(s.qty_sold, 0), 2) as qty_sold,
        ROUND(COALESCE(s.total_sales, 0), 2) as total_sales,
        COALESCE(DATE_FORMAT(s.last_sold, '%Y-%m-%d'), 'Never') as last_sold_date,
        CASE 
          WHEN s.last_sold IS NULL THEN 'No Sales Record'
          ELSE CONCAT(DATEDIFF(NOW(), s.last_sold), ' Days')
        END as days_inactive
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      LEFT JOIN (
        SELECT 
          oi.menu_item_id,
          SUM(oi.quantity) as qty_sold,
          SUM(oi.total_price) as total_sales,
          MAX(o.created_at) as last_sold
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.restaurant_id = ? AND o.order_status = 'completed' AND o.created_at >= ? AND o.created_at <= ?
        GROUP BY oi.menu_item_id
      ) s ON mi.id = s.menu_item_id
      ${whereClause}
      ORDER BY COALESCE(s.qty_sold, 0) ASC, mi.current_stock DESC, mi.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const queryParams = [restaurantId, dateRange.from, dateRange.to, ...params];
    const [rows] = await pool.execute(dataSql, queryParams);

    const zeroSalesCount = rows.filter(r => parseFloat(r.qty_sold) === 0).length;

    return {
      title: 'Least Selling Items',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalCatalogItems: totalCount,
        zeroSalesItemsInBatch: zeroSalesCount,
        period: dateRange.label
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 11. BATCH WISE ITEMS
  // ---------------------------------------------------------------------------
  static async getBatchWiseItems(restaurantId, { search, warehouseId, categoryId, page, limit, offset, dateRange }) {
    let whereClause = `WHERE ws.restaurant_id = ?`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ? OR ws.batch_number LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (warehouseId) {
      whereClause += ` AND ws.warehouse_id = ?`;
      params.push(warehouseId);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    const countSql = `
      SELECT COUNT(*) as totalCount
      FROM warehouse_stocks ws
      JOIN menu_items mi ON ws.menu_item_id = mi.id
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        ws.id as stock_id,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(mi.unit, 'PCS') as unit,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        COALESCE(ws.batch_number, 'DEFAULT') as batch_name,
        COALESCE(w.name, 'Main Godown') as location_name,
        CASE 
          WHEN ws.expiry_date IS NULL THEN 'Active'
          WHEN ws.expiry_date < CURDATE() THEN 'Expired'
          WHEN DATEDIFF(ws.expiry_date, CURDATE()) <= 30 THEN 'Near Expiry'
          ELSE 'Active'
        END as expiry_status,
        COALESCE(DATE_FORMAT(ws.expiry_date, '%Y-%m-%d'), 'N/A') as expiry_date,
        'N/A' as manufacturing_date,
        ROUND(COALESCE(mi.mrp, mi.price, 0), 2) as mrp,
        ROUND(COALESCE(mi.cost_price, mi.purchase_price, 0), 2) as batch_purchase_price,
        ROUND(COALESCE(mi.price, 0), 2) as batch_sales_price,
        ROUND(COALESCE(ws.current_stock, 0), 2) as current_stock,
        ROUND(COALESCE(ws.current_stock, 0) * COALESCE(mi.cost_price, mi.purchase_price, 0), 2) as stock_value
      FROM warehouse_stocks ws
      JOIN menu_items mi ON ws.menu_item_id = mi.id
      LEFT JOIN warehouses w ON ws.warehouse_id = w.id
      LEFT JOIN categories c ON mi.category_id = c.id
      ${whereClause}
      ORDER BY mi.name ASC, ws.batch_number ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(dataSql, params);

    let totStock = 0, totValue = 0;
    rows.forEach(r => {
      totStock += parseFloat(r.current_stock || 0);
      totValue += parseFloat(r.stock_value || 0);
    });

    return {
      title: 'Batch Wise Items',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalBatches: totalCount,
        totalStockOnHand: parseFloat(totStock.toFixed(2)),
        totalStockValue: parseFloat(totValue.toFixed(2)),
        grandTotal: parseFloat(totValue.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 12. ITEM STOCK LEVELS
  // ---------------------------------------------------------------------------
  static async getItemStockLevels(restaurantId, { search, warehouseId, categoryId, page, limit, offset, dateRange }) {
    let whereClause = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service'`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    const countSql = `SELECT COUNT(*) as totalCount FROM menu_items mi ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        mi.id,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(mi.unit, 'PCS') as unit,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        'All Locations' as location,
        ROUND(COALESCE(mi.current_stock, 0), 2) as current_stock,
        ROUND(COALESCE(mi.min_stock, mi.low_stock_threshold, 10), 2) as min_stock,
        ROUND(COALESCE(mi.at_par_stock, COALESCE(mi.min_stock, mi.low_stock_threshold, 10) * 2), 2) as par_stock,
        ROUND(COALESCE(mi.cost_price, mi.purchase_price, 0), 2) as rate,
        COALESCE(vel.avg_daily_sales, 0) as avg_daily_sales
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      LEFT JOIN (
        SELECT 
          oi.menu_item_id,
          ROUND(SUM(oi.quantity) / 30, 2) as avg_daily_sales
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.restaurant_id = ? AND o.order_status = 'completed' AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY oi.menu_item_id
      ) vel ON mi.id = vel.menu_item_id
      ${whereClause}
      ORDER BY mi.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [rawRows] = await pool.execute(dataSql, [restaurantId, ...params]);

    const rows = rawRows.map(r => {
      const curStock = parseFloat(r.current_stock || 0);
      const minStock = parseFloat(r.min_stock || 0);
      const parStock = parseFloat(r.par_stock || 0);
      const rate = parseFloat(r.rate || 0);
      const avgDaily = parseFloat(r.avg_daily_sales || 0);

      let stockStatus = 'In Stock';
      let alertLevel = 'Normal';

      if (curStock <= 0) {
        stockStatus = 'Out of Stock';
        alertLevel = 'Critical';
      } else if (curStock <= minStock) {
        stockStatus = 'Low Stock';
        alertLevel = 'Warning';
      } else if (parStock > 0 && curStock > parStock * 1.5) {
        stockStatus = 'Overstock';
        alertLevel = 'Normal';
      }

      const minStockRatio = minStock > 0 ? parseFloat((curStock / minStock).toFixed(2)) : 1.0;
      const parStockRatio = parStock > 0 ? parseFloat((curStock / parStock).toFixed(2)) : 1.0;
      const reorderQty = Math.max(0, parseFloat((parStock - curStock).toFixed(2)));
      const reorderValue = parseFloat((reorderQty * rate).toFixed(2));
      const stockValue = parseFloat((curStock * rate).toFixed(2));
      const daysRemaining = avgDaily > 0 ? Math.min(999, Math.round(curStock / avgDaily)) : 999;

      return {
        item_name: r.item_name,
        item_code: r.item_code,
        unit: r.unit,
        category: r.category_name,
        group: r.group_name,
        location: r.location,
        stock_status: stockStatus,
        alert_level: alertLevel,
        current_stock: curStock,
        min_stock: minStock,
        min_stock_ratio: minStockRatio,
        par_stock: parStock,
        par_stock_ratio: parStockRatio,
        reorder_qty: reorderQty,
        reorder_value: reorderValue,
        days_remaining: daysRemaining === 999 ? '90+ Days' : `${daysRemaining} Days`,
        stock_value: stockValue,
        rate: rate
      };
    });

    let totalStockVal = 0, totalReorderVal = 0;
    rows.forEach(r => {
      totalStockVal += r.stock_value;
      totalReorderVal += r.reorder_value;
    });

    return {
      title: 'Item Stock Levels',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalItems: totalCount,
        totalStockValue: parseFloat(totalStockVal.toFixed(2)),
        totalReorderValue: parseFloat(totalReorderVal.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 13. ITEM REORDER SUGGESTIONS
  // ---------------------------------------------------------------------------
  static async getReorderSuggestions(restaurantId, { search, warehouseId, categoryId, page, limit, offset, dateRange }) {
    let whereClause = `
      WHERE mi.restaurant_id = ? 
        AND mi.goods_or_service != 'service'
        AND (
          ${warehouseId ? 'COALESCE(ws.current_stock, 0)' : 'COALESCE(mi.current_stock, 0)'} <= COALESCE(${warehouseId ? 'ws.min_stock' : 'mi.min_stock'}, mi.low_stock_threshold, 10)
          OR ${warehouseId ? 'COALESCE(ws.current_stock, 0)' : 'COALESCE(mi.current_stock, 0)'} < COALESCE(${warehouseId ? 'ws.max_stock' : 'mi.at_par_stock'}, COALESCE(${warehouseId ? 'ws.min_stock' : 'mi.min_stock'}, mi.low_stock_threshold, 10) * 2)
        )
    `;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ? OR mi.brand LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    let joinWarehouse = '';
    let stockSelect = `COALESCE(mi.current_stock, 0)`;
    let minSelect = `COALESCE(mi.min_stock, mi.low_stock_threshold, 10)`;
    let parSelect = `COALESCE(mi.at_par_stock, COALESCE(mi.min_stock, mi.low_stock_threshold, 10) * 2)`;
    let locationSelect = `'Main Godown'`;

    if (warehouseId) {
      joinWarehouse = `LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND ws.warehouse_id = ?
                       LEFT JOIN warehouses w ON ws.warehouse_id = w.id`;
      stockSelect = `COALESCE(ws.current_stock, 0)`;
      minSelect = `COALESCE(ws.min_stock, mi.min_stock, mi.low_stock_threshold, 10)`;
      parSelect = `COALESCE(ws.max_stock, mi.at_par_stock, COALESCE(ws.min_stock, mi.low_stock_threshold, 10) * 2)`;
      locationSelect = `COALESCE(w.name, 'Specified Godown')`;
      params.unshift(warehouseId);
    } else {
      joinWarehouse = `LEFT JOIN warehouses w ON w.restaurant_id = mi.restaurant_id AND w.is_default = 1`;
      locationSelect = `COALESCE(w.name, 'All Godowns')`;
    }

    const countSql = `
      SELECT COUNT(*) as totalCount 
      FROM menu_items mi 
      ${joinWarehouse}
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        mi.id,
        mi.name as item_name,
        COALESCE(mi.item_code, mi.sku, '-') as item_code,
        COALESCE(mi.unit, 'PCS') as unit,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(NULLIF(TRIM(mi.item_group), ''), 'General') as group_name,
        ${locationSelect} as location_name,
        ROUND(${stockSelect}, 2) as current_stock,
        ROUND(${minSelect}, 2) as min_stock,
        ROUND(${parSelect}, 2) as par_stock,
        ROUND(COALESCE(mi.purchase_price, mi.cost_price, 0), 2) as purchase_rate,
        COALESCE(vel.avg_daily_sales, 0) as avg_daily_sales
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      ${joinWarehouse}
      LEFT JOIN (
        SELECT 
          oi.menu_item_id,
          ROUND(SUM(oi.quantity) / 30, 2) as avg_daily_sales
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.restaurant_id = ? AND o.order_status = 'completed' AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY oi.menu_item_id
      ) vel ON mi.id = vel.menu_item_id
      ${whereClause}
      ORDER BY (${parSelect} - ${stockSelect}) DESC, mi.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [rawRows] = await pool.execute(dataSql, [restaurantId, ...params]);

    const rows = rawRows.map(r => {
      const curStock = parseFloat(r.current_stock || 0);
      const minStock = parseFloat(r.min_stock || 0);
      const parStock = parseFloat(r.par_stock || 0);
      const purchaseRate = parseFloat(r.purchase_rate || 0);
      const avgDailySales = parseFloat(r.avg_daily_sales || 0);

      // INFERRED: Suggested Order Quantity = required quantity to reach Par Stock
      const suggestedOrderQty = Math.max(0, parseFloat((parStock - curStock).toFixed(2)));

      // INFERRED: Order Value = Suggested Order Quantity × Purchase Rate
      const orderValue = parseFloat((suggestedOrderQty * purchaseRate).toFixed(2));

      // INFERRED: Stock Shortfall = required minimum/par quantity − Current Stock
      const stockShortfall = Math.max(0, parseFloat((minStock - curStock).toFixed(2)));

      // INFERRED: Urgency, Reason, Days Until Stockout based on stock and consumption velocity
      let urgency = 'Medium';
      let reason = 'Below Par Stock';

      if (curStock <= 0) {
        urgency = 'Immediate';
        reason = 'Out of Stock';
      } else if (curStock <= minStock) {
        urgency = 'High';
        reason = 'Below Minimum Stock Level';
      } else if (curStock < parStock) {
        urgency = 'Medium';
        reason = 'Below Par Stock Level';
      }

      let daysUntilStockout = '90+ Days';
      if (curStock <= 0) {
        daysUntilStockout = '0 Days';
      } else if (avgDailySales > 0) {
        const days = Math.round(curStock / avgDailySales);
        daysUntilStockout = `${Math.min(999, days)} Days`;
      }

      return {
        item_name: r.item_name,
        item_code: r.item_code,
        unit: r.unit,
        category_name: r.category_name,
        group_name: r.group_name,
        location_name: r.location_name,
        current_stock: curStock,
        min_stock: minStock,
        par_stock: parStock,
        stock: curStock,
        suggested_order_qty: suggestedOrderQty,
        suggested_qty: suggestedOrderQty, // alias
        purchase_rate: purchaseRate,
        unit_cost: purchaseRate, // alias
        order_value: orderValue,
        estimated_cost: orderValue, // alias
        urgency,
        reason,
        days_until_stockout: daysUntilStockout,
        stock_shortfall: stockShortfall
      };
    });

    let totalSuggestedQty = 0, totalOrderValue = 0, totalShortfall = 0;
    rows.forEach(r => {
      totalSuggestedQty += r.suggested_order_qty;
      totalOrderValue += r.order_value;
      totalShortfall += r.stock_shortfall;
    });

    return {
      title: 'Item Reorder Suggestions',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        itemsRequiringReorder: totalCount,
        totalSuggestedQuantity: parseFloat(totalSuggestedQty.toFixed(2)),
        totalOrderValue: parseFloat(totalOrderValue.toFixed(2)),
        totalStockShortfall: parseFloat(totalShortfall.toFixed(2)),
        grandTotal: parseFloat(totalOrderValue.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 14. RESERVED STOCK REPORT
  // ---------------------------------------------------------------------------
  static async getReservedStockReport(restaurantId, { search, warehouseId, categoryId, page, limit, offset, dateRange }) {
    let whereClause = `WHERE mi.restaurant_id = ? AND mi.goods_or_service != 'service'`;
    const params = [restaurantId];

    if (search) {
      whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ? OR mi.item_code LIKE ? OR mi.brand LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (categoryId) {
      whereClause += ` AND mi.category_id = ?`;
      params.push(categoryId);
    }

    let soWhere = `WHERE o.restaurant_id = ? AND o.is_sales_order = 1 AND (o.is_estimate = 0 OR o.is_estimate IS NULL) AND o.order_status NOT IN ('completed', 'cancelled')`;
    const soParams = [restaurantId];

    if (warehouseId) {
      soWhere += ` AND o.warehouse_id = ?`;
      soParams.push(warehouseId);
    }

    if (dateRange && dateRange.preset === 'custom' && dateRange.from && dateRange.to) {
      soWhere += ` AND o.created_at >= ? AND o.created_at <= ?`;
      soParams.push(dateRange.from, dateRange.to);
    }

    // Reservation source: live pending Sales Order allocations (Estimates strictly excluded)
    // combined with item-level or warehouse-level reserved_stock balance
    const stockField = warehouseId ? 'ws.reserved_stock' : 'mi.reserved_stock';
    let joinWarehouse = '';
    if (warehouseId) {
      joinWarehouse = `LEFT JOIN warehouse_stocks ws ON mi.id = ws.menu_item_id AND ws.warehouse_id = ?`;
      params.unshift(warehouseId);
    }

    const countSql = `
      SELECT COUNT(DISTINCT mi.id) as totalCount
      FROM menu_items mi
      ${joinWarehouse}
      LEFT JOIN (
        SELECT oi.menu_item_id, SUM(GREATEST(0, oi.quantity - COALESCE(oi.delivered_qty, 0))) as open_reserved_qty
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        ${soWhere}
        GROUP BY oi.menu_item_id
      ) so_alloc ON mi.id = so_alloc.menu_item_id
      ${whereClause}
      AND (COALESCE(so_alloc.open_reserved_qty, 0) > 0 OR COALESCE(${stockField}, 0) > 0)
    `;
    const [countRows] = await pool.execute(countSql, [...soParams, ...params]);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        mi.id,
        mi.name as item_name,
        COALESCE(NULLIF(TRIM(mi.brand), ''), '-') as brand,
        COALESCE(c.name, 'Uncategorized') as category_name,
        COALESCE(mi.unit, 'PCS') as unit,
        ROUND(GREATEST(COALESCE(so_alloc.open_reserved_qty, 0), COALESCE(${stockField}, 0)), 2) as reserved_qty,
        ROUND(COALESCE(mi.cost_price, mi.purchase_price, mi.price, 0), 2) as valuation_rate
      FROM menu_items mi
      LEFT JOIN categories c ON mi.category_id = c.id
      ${joinWarehouse}
      LEFT JOIN (
        SELECT oi.menu_item_id, SUM(GREATEST(0, oi.quantity - COALESCE(oi.delivered_qty, 0))) as open_reserved_qty
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        ${soWhere}
        GROUP BY oi.menu_item_id
      ) so_alloc ON mi.id = so_alloc.menu_item_id
      ${whereClause}
      AND (COALESCE(so_alloc.open_reserved_qty, 0) > 0 OR COALESCE(${stockField}, 0) > 0)
      ORDER BY reserved_qty DESC, mi.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [rawRows] = await pool.execute(dataSql, [...soParams, ...params]);

    const rows = rawRows.map(r => {
      const resQty = parseFloat(r.reserved_qty || 0);
      const rate = parseFloat(r.valuation_rate || 0);
      const resValue = parseFloat((resQty * rate).toFixed(2));

      return {
        item_name: r.item_name,
        brand: r.brand,
        category_name: r.category_name,
        unit: r.unit,
        reserved_qty: resQty,
        reserved_value: resValue,
        reserved_stock: resQty // alias
      };
    });

    let totReservedQty = 0, totReservedVal = 0;
    rows.forEach(r => {
      totReservedQty += r.reserved_qty;
      totReservedVal += r.reserved_value;
    });

    return {
      title: 'Reserved Stock Report',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        itemsWithReservations: totalCount,
        totalReservedStock: parseFloat(totReservedQty.toFixed(2)),
        totalReservedValue: parseFloat(totReservedVal.toFixed(2)),
        grandTotal: parseFloat(totReservedVal.toFixed(2))
      },
      rows
    };
  }

  // ---------------------------------------------------------------------------
  // 15. DELIVERY CHALLAN TO INVOICE VARIANCE REPORT
  // ---------------------------------------------------------------------------
  static async getChallanInvoiceVarianceReport(restaurantId, { search, warehouseId, dateRange, page, limit, offset }) {
    let whereClause = `WHERE dc.restaurant_id = ?`;
    const params = [restaurantId];

    if (dateRange && dateRange.from && dateRange.to) {
      whereClause += ` AND dc.challan_date >= ? AND dc.challan_date <= ?`;
      params.push(dateRange.from.slice(0, 10), dateRange.to.slice(0, 10));
    }

    if (warehouseId) {
      whereClause += ` AND dc.warehouse_id = ?`;
      params.push(warehouseId);
    }

    if (search) {
      whereClause += ` AND (dc.challan_number LIKE ? OR dc.party_name LIKE ? OR inv.unique_order_number LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const countSql = `
      SELECT COUNT(DISTINCT dc.id) as totalCount
      FROM delivery_challans dc
      LEFT JOIN orders inv ON (inv.delivery_challan_id = dc.id OR (dc.sales_order_id IS NOT NULL AND inv.parent_order_id = dc.sales_order_id AND inv.is_sales_order = 0))
      ${whereClause}
    `;
    const [countRows] = await pool.execute(countSql, params);
    const totalCount = countRows[0]?.totalCount || 0;

    const dataSql = `
      SELECT 
        dc.id as challan_id,
        dc.challan_number as dc_no,
        DATE_FORMAT(dc.challan_date, '%Y-%m-%d') as dc_date,
        COALESCE(inv.unique_order_number, '-') as invoice_no,
        COALESCE(dc.party_name, so.customer_name, 'Direct Client') as party_name,
        ROUND(COALESCE(dc_sum.total_delivered, 0), 2) as dc_qty,
        ROUND(COALESCE(inv_sum.total_invoiced, 0), 2) as invoiced_qty
      FROM delivery_challans dc
      LEFT JOIN orders so ON dc.sales_order_id = so.id
      LEFT JOIN (
        SELECT delivery_challan_id, SUM(delivered_qty) as total_delivered
        FROM delivery_challan_items
        GROUP BY delivery_challan_id
      ) dc_sum ON dc.id = dc_sum.delivery_challan_id
      LEFT JOIN orders inv ON (inv.delivery_challan_id = dc.id OR (dc.sales_order_id IS NOT NULL AND inv.parent_order_id = dc.sales_order_id AND inv.is_sales_order = 0))
      LEFT JOIN (
        SELECT order_id, SUM(quantity) as total_invoiced
        FROM order_items
        GROUP BY order_id
      ) inv_sum ON inv.id = inv_sum.order_id
      ${whereClause}
      ORDER BY dc.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [rawRows] = await pool.execute(dataSql, params);

    const rows = rawRows.map(r => {
      const dcQty = parseFloat(r.dc_qty || 0);
      const invoicedQty = parseFloat(r.invoiced_qty || 0);

      // INFERRED: Variance Qty = Invoiced Qty − DC Qty
      const varianceQty = parseFloat((invoicedQty - dcQty).toFixed(2));

      // INFERRED: Variance Type = Matched / Over-invoiced / Under-invoiced
      let varianceType = 'Matched';
      if (Math.abs(varianceQty) < 0.0001) {
        varianceType = 'Matched';
      } else if (varianceQty > 0) {
        varianceType = 'Over-invoiced';
      } else {
        varianceType = 'Under-invoiced';
      }

      return {
        dc_no: r.dc_no,
        dc_date: r.dc_date,
        invoice_no: r.invoice_no,
        party_name: r.party_name,
        dc_qty: dcQty,
        invoiced_qty: invoicedQty,
        variance_qty: varianceQty,
        variance_type: varianceType,
        // Aliases for compatibility
        challan_number: r.dc_no,
        challan_date: r.dc_date,
        customer_name: r.party_name,
        challan_qty: dcQty,
        variance_status: varianceType
      };
    });

    let totDcQty = 0, totInvoicedQty = 0, totVarianceQty = 0;
    let matchedCount = 0, overCount = 0, underCount = 0;

    rows.forEach(r => {
      totDcQty += r.dc_qty;
      totInvoicedQty += r.invoiced_qty;
      totVarianceQty += r.variance_qty;
      if (r.variance_type === 'Matched') matchedCount++;
      else if (r.variance_type === 'Over-invoiced') overCount++;
      else underCount++;
    });

    return {
      title: 'Delivery Challan to Invoice Variance Report',
      dateRange,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1
      },
      summary: {
        totalChallans: totalCount,
        totalChallanQuantity: parseFloat(totDcQty.toFixed(2)),
        totalInvoicedQuantity: parseFloat(totInvoicedQty.toFixed(2)),
        totalVarianceQuantity: parseFloat(totVarianceQty.toFixed(2)),
        matchedCount,
        overInvoicedCount: overCount,
        underInvoicedCount: underCount,
        grandTotal: parseFloat(totVarianceQty.toFixed(2))
      },
      rows
    };
  }
}

module.exports = InventoryReportsEngine;
