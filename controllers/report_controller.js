const ReportRepository = require('../repositories/report_repository');
const ReportsEngine = require('../services/reports_engine');
const pool = require('../config/db');
const { generateExcelWorkbook, generateGstSlabExcelWorkbook } = require('../utils/excel_helper');
const { getISTDateString, formatLocalDate } = require('../utils/date_utils');

const parseAndExpandDates = (queryDateFrom, queryDateTo) => {
  const todayStr = getISTDateString();
  let dateTo = (queryDateTo || '').trim() || `${todayStr} 23:59:59`;
  if (dateTo.length === 10) {
    dateTo = `${dateTo} 23:59:59`;
  }

  let dateFrom = (queryDateFrom || '').trim();
  if (!dateFrom) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = getLocalDateString(thirtyDaysAgo);
    dateFrom = `${thirtyDaysAgoStr} 00:00:00`;
  } else if (dateFrom.length === 10) {
    dateFrom = `${dateFrom} 00:00:00`;
  }

  return { dateFrom, dateTo };
};

class ReportController {
  /**
   * Cashier dashboard metrics for the current day
   */
  static async getCashierDashboard(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const cashierId = req.user.id;
      const metrics = await ReportRepository.getCashierDashboardMetrics(restaurantId, cashierId);
      return res.json(metrics);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve cashier metrics.' });
    }
  }

  /**
   * Admin dashboard metrics (requires date range)
   */
  static async getAdminDashboard(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);

    try {
      const restaurantId = req.user.restaurant_id;

      const summary = await ReportRepository.getSalesSummary(restaurantId, dateFrom, dateTo);
      const payments = await ReportRepository.getPaymentBreakdown(restaurantId, dateFrom, dateTo);
      const topItems = await ReportRepository.getTopSellingItems(restaurantId, dateFrom, dateTo, 5);
      const leastItems = await ReportRepository.getLeastSellingItems(restaurantId, dateFrom, dateTo, 5);
      const activeCashiers = await ReportRepository.getMostActiveCashiers(restaurantId, dateFrom, dateTo);
      const peakHours = await ReportRepository.getPeakHours(restaurantId, dateFrom, dateTo);
      const dailyChart = await ReportRepository.getDailySalesChartData(restaurantId, dateFrom, dateTo);

      return res.json({
        summary: {
          totalRevenue: parseFloat(summary.totalRevenue || 0),
          subtotal: parseFloat(summary.subtotal || 0),
          totalTax: parseFloat(summary.totalTax || 0),
          totalDiscount: parseFloat(summary.totalDiscount || 0),
          totalOrders: parseInt(summary.totalOrders || 0)
        },
        payments,
        topItems,
        leastItems,
        activeCashiers,
        peakHours,
        dailyChart
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve admin reports.' });
    }
  }

  /**
   * Export sales report to Excel (.xlsx) format
   */
  static async exportSalesExcel(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);

    try {
      const restaurantId = req.user.restaurant_id;
      const data = await ReportRepository.getTaxesAndDiscountsReport(restaurantId, dateFrom, dateTo);

      const columns = [
        { header: 'Sales Date', key: 'sales_date', width: 16 },
        { header: 'Subtotal (Rs)', key: 'subtotal', width: 16 },
        { header: 'Tax Collected (Rs)', key: 'tax_collected', width: 18 },
        { header: 'Discount Given (Rs)', key: 'discount_given', width: 20 },
        { header: 'Net Sales (Rs)', key: 'net_sales', width: 18 }
      ];

      const rows = data.map(row => ({
        sales_date: formatLocalDate(row.salesDate),
        subtotal: parseFloat(row.subtotal || 0).toFixed(2),
        tax_collected: parseFloat(row.taxCollected || 0).toFixed(2),
        discount_given: parseFloat(row.discountGiven || 0).toFixed(2),
        net_sales: parseFloat(row.netSales || 0).toFixed(2)
      }));

      const buffer = await generateExcelWorkbook({
        sheetName: 'Sales Overview',
        columns,
        data: rows
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=sales_report_${dateFrom.slice(0, 10)}_to_${dateTo.slice(0, 10)}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate Excel export.' });
    }
  }

  /**
   * Export sales report to CSV format
   */
  static async exportSalesCSV(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);

    try {
      const restaurantId = req.user.restaurant_id;
      const data = await ReportRepository.getTaxesAndDiscountsReport(restaurantId, dateFrom, dateTo);

      let csv = 'Sales Date,Subtotal,Tax Collected,Discount Given,Net Sales\r\n';
      
      data.forEach(row => {
        csv += `${formatLocalDate(row.salesDate)},${parseFloat(row.subtotal).toFixed(2)},${parseFloat(row.taxCollected).toFixed(2)},${parseFloat(row.discountGiven).toFixed(2)},${parseFloat(row.netSales).toFixed(2)}\r\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=sales_report_${dateFrom.slice(0, 10)}_to_${dateTo.slice(0, 10)}.csv`);
      return res.send(csv);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate CSV export.' });
    }
  }

  /**
   * Item-wise Sales Analytics Report
   */
  static async getItemWiseReport(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);

    try {
      const restaurantId = req.user.restaurant_id;
      const items = await ReportRepository.getItemWiseSalesReport(restaurantId, {
        dateFrom,
        dateTo,
        categoryId: req.query.category_id,
        search: req.query.search,
        sortBy: req.query.sort_by,
        sortOrder: req.query.sort_order
      });

      return res.json(items);
    } catch (err) {
      console.error('Item-wise report error:', err);
      return res.status(500).json({ error: 'Failed to retrieve item-wise sales report.' });
    }
  }

  /**
   * Individual Item Sales Transaction History
   */
  static async getItemSalesHistory(req, res) {
    const itemId = req.params.id;
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);

    try {
      const restaurantId = req.user.restaurant_id;
      const history = await ReportRepository.getItemSalesHistory(restaurantId, itemId, {
        dateFrom,
        dateTo,
        limit: req.query.limit || 50
      });

      return res.json(history);
    } catch (err) {
      console.error('Item sales history error:', err);
      return res.status(500).json({ error: 'Failed to retrieve item sales history.' });
    }
  }

  /**
   * Export Item-wise Sales Report to Excel (.xlsx)
   */
  static async exportItemSalesExcel(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);

    try {
      const restaurantId = req.user.restaurant_id;
      const items = await ReportRepository.getItemWiseSalesReport(restaurantId, {
        dateFrom,
        dateTo,
        categoryId: req.query.category_id,
        search: req.query.search,
        sortBy: req.query.sort_by,
        sortOrder: req.query.sort_order
      });

      const columns = [
        { header: 'Item Name', key: 'name', width: 25 },
        { header: 'Category', key: 'category_name', width: 18 },
        { header: 'SKU', key: 'sku', width: 14 },
        { header: 'Qty Sold', key: 'qty_sold', width: 12 },
        { header: 'Gross Sales (Rs)', key: 'gross_sales', width: 16 },
        { header: 'Discount Given (Rs)', key: 'discount_given', width: 18 },
        { header: 'GST Collected (Rs)', key: 'gst_collected', width: 18 },
        { header: 'Net Sales (Rs)', key: 'net_sales', width: 16 },
        { header: 'Avg Selling Price (Rs)', key: 'avg_price', width: 22 },
        { header: 'Last Sold Date', key: 'last_sold', width: 20 }
      ];

      const rows = items.map(row => ({
        name: row.name || '',
        category_name: row.category_name || '',
        sku: row.sku || '',
        qty_sold: row.qty_sold || 0,
        gross_sales: parseFloat(row.gross_sales || 0).toFixed(2),
        discount_given: parseFloat(row.discount_given || 0).toFixed(2),
        gst_collected: parseFloat(row.gst_collected || 0).toFixed(2),
        net_sales: parseFloat(row.net_sales || 0).toFixed(2),
        avg_price: parseFloat(row.avg_selling_price || 0).toFixed(2),
        last_sold: row.last_sold_at ? new Date(row.last_sold_at).toISOString().slice(0, 19).replace('T', ' ') : 'N/A'
      }));

      const buffer = await generateExcelWorkbook({
        sheetName: 'Item Sales',
        columns,
        data: rows
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=item_sales_report_${dateFrom.slice(0, 10)}_to_${dateTo.slice(0, 10)}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate item sales Excel export.' });
    }
  }

  /**
   * Export Item-wise Sales Report to CSV
   */
  static async exportItemSalesCSV(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);

    try {
      const restaurantId = req.user.restaurant_id;
      const items = await ReportRepository.getItemWiseSalesReport(restaurantId, {
        dateFrom,
        dateTo,
        categoryId: req.query.category_id,
        search: req.query.search,
        sortBy: req.query.sort_by,
        sortOrder: req.query.sort_order
      });

      let csv = 'Item Name,Category,SKU,Quantity Sold,Gross Sales (Rs),Discount Given (Rs),GST Collected (Rs),Net Sales (Rs),Avg Selling Price (Rs),Last Sold Date\r\n';
      
      items.forEach(row => {
        const lastSold = row.last_sold_at ? new Date(row.last_sold_at).toISOString().slice(0, 19).replace('T', ' ') : 'N/A';
        const cleanName = `"${(row.name || '').replace(/"/g, '""')}"`;
        const cleanCat = `"${(row.category_name || '').replace(/"/g, '""')}"`;
        const cleanSku = `"${(row.sku || '').replace(/"/g, '""')}"`;

        csv += `${cleanName},${cleanCat},${cleanSku},${row.qty_sold},${parseFloat(row.gross_sales || 0).toFixed(2)},${parseFloat(row.discount_given || 0).toFixed(2)},${parseFloat(row.gst_collected || 0).toFixed(2)},${parseFloat(row.net_sales || 0).toFixed(2)},${parseFloat(row.avg_selling_price || 0).toFixed(2)},${lastSold}\r\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=item_sales_report_${dateFrom.slice(0, 10)}_to_${dateTo.slice(0, 10)}.csv`);
      return res.send(csv);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate item sales CSV export.' });
    }
  }

  /**
   * Get GST Slab Report JSON summary for live dashboard display
   */
  static async getGstSlabReport(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
    const paymentMode = req.query.payment_mode || 'all';

    try {
      const restaurantId = req.user.restaurant_id;
      const reportData = await ReportRepository.getGstSlabReport(restaurantId, dateFrom, dateTo, paymentMode);

      // Map standard GST rates (0%, 5%, 12%, 18%, 28%)
      const standardRates = [0, 5, 12, 18, 28];
      const formattedSlabs = standardRates.map(rate => {
        const matches = reportData.slabs.filter(s => Math.round(parseFloat(s.gst_rate)) === rate);
        
        let taxableAmount = 0;
        let totalGst = 0;
        let cgstAmount = 0;
        let sgstAmount = 0;
        let igstAmount = 0;
        let invoiceCount = 0;
        
        matches.forEach(m => {
          const mTaxable = parseFloat(m.taxable_amount || 0);
          const mGst = parseFloat(m.total_gst || 0);
          taxableAmount += mTaxable;
          totalGst += mGst;
          invoiceCount += parseInt(m.invoice_count || 0);
          
          if (m.tax_type === 'inter') {
            igstAmount += mGst;
          } else {
            cgstAmount += mGst / 2;
            sgstAmount += mGst / 2;
          }
        });
        
        const invoiceValue = taxableAmount + totalGst;

        return {
          gst_rate: rate,
          taxable_amount: taxableAmount,
          cgst_rate: rate / 2,
          cgst_amount: cgstAmount,
          sgst_rate: rate / 2,
          sgst_amount: sgstAmount,
          igst_rate: rate,
          igst_amount: igstAmount,
          total_gst: totalGst,
          invoice_value: invoiceValue,
          invoice_count: invoiceCount
        };
      });

      return res.json({
        restaurant_info: reportData.restaurantInfo,
        slabs: formattedSlabs,
        total_invoices_count: reportData.invoices.length,
        date_from: dateFrom,
        date_to: dateTo,
        payment_mode: paymentMode
      });
    } catch (err) {
      console.error('[GST Slab Report Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve GST Slab report.' });
    }
  }

  /**
   * Export CA-Ready GST Slab Excel (.xlsx) file
   */
  static async exportGstSlabExcel(req, res) {
    const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
    const paymentMode = req.query.payment_mode || 'all';

    try {
      const restaurantId = req.user.restaurant_id;
      const reportData = await ReportRepository.getGstSlabReport(restaurantId, dateFrom, dateTo, paymentMode);

      const buffer = await generateGstSlabExcelWorkbook({
        restaurantInfo: reportData.restaurantInfo,
        slabs: reportData.slabs,
        invoices: reportData.invoices,
        dateFrom,
        dateTo,
        paymentMode
      });

      const startDateStr = dateFrom.slice(0, 10);
      const endDateStr = dateTo.slice(0, 10);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=GST_Slab_CA_Report_${startDateStr}_to_${endDateStr}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error('[GST Slab Excel Export Error]', err);
      return res.status(500).json({ error: 'Failed to generate GST Slab Excel report.' });
    }
  }

  // =========================================================================
  // CENTRAL REPORTS & BUSINESS INTELLIGENCE ENGINE ENDPOINTS
  // =========================================================================

  /**
   * Get Report Definitions Catalog
   */
  static async getCatalog(req, res) {
    try {
      const catalog = ReportsEngine.getCatalog();
      return res.json({ success: true, catalog });
    } catch (err) {
      console.error('[Report Catalog Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve report catalog.' });
    }
  }

  /**
   * Run Standard Report with Pagination, Sorting & Server Aggregations
   */
  static async getReportData(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const reportId = req.params.reportId;
      const options = {
        preset: req.query.preset,
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        page: req.query.page,
        limit: req.query.limit,
        sortBy: req.query.sort_by,
        sortOrder: req.query.sort_order,
        search: req.query.search,
        branchId: req.query.branch_id,
        warehouseId: req.query.warehouse_id,
        categoryId: req.query.category_id,
        salesmanId: req.query.salesman_id,
        paymentMode: req.query.payment_mode
      };

      const result = await ReportsEngine.runReport(restaurantId, reportId, options, req.user);
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[Report Execution Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to execute report.' });
    }
  }

  /**
   * Export Report to Excel (.xlsx) or CSV
   */
  static async exportReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const reportId = req.params.reportId;
      const format = (req.query.format || 'excel').toLowerCase();
      const options = {
        preset: req.query.preset,
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        search: req.query.search,
        branchId: req.query.branch_id,
        warehouseId: req.query.warehouse_id,
        categoryId: req.query.category_id,
        salesmanId: req.query.salesman_id,
        paymentMode: req.query.payment_mode
      };

      const { buffer, contentType, filename } = await ReportsEngine.exportReport(
        restaurantId,
        reportId,
        format,
        options,
        req.user
      );

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (err) {
      console.error('[Report Export Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to export report.' });
    }
  }

  /**
   * Business Intelligence Executive Dashboard
   */
  static async getBiDashboard(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const data = await ReportsEngine.getBiDashboard(restaurantId, req.query.date_from, req.query.date_to);
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('[BI Dashboard Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve BI dashboard.' });
    }
  }

  /**
   * Daily Sales Closing (DSR) End of Day Summary
   */
  static async getDailySalesClosing(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const targetDate = req.query.date || '';
      const data = await ReportsEngine.getDailySalesClosing(restaurantId, targetDate);
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('[DSR Closing Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve daily sales closing.' });
    }
  }

  /**
   * Yearly Financial Rollup (Indian Financial Year: 1 April - 31 March)
   */
  static async getYearlySalesRollup(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const year = req.query.year || null;
      const data = await ReportsEngine.getYearlySalesRollup(restaurantId, year);
      return res.json({ success: true, ...data });
    } catch (err) {
      console.error('[Yearly Rollup Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve yearly rollup.' });
    }
  }

  /**
   * Dynamic Custom Report Execution (Controlled, Safe)
   */
  static async runCustomReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const config = req.body || {};
      const result = await ReportsEngine.runCustomReport(restaurantId, config);
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[Custom Report Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to run custom report.' });
    }
  }

  /**
   * Saved Custom Reports Listing
   */
  static async getSavedReports(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const [rows] = await pool.execute(
        'SELECT id, name, description, category, data_source, config, created_at, updated_at FROM saved_reports WHERE restaurant_id = ? ORDER BY id DESC',
        [restaurantId]
      );
      return res.json({ success: true, reports: rows });
    } catch (err) {
      console.error('[Saved Reports Fetch Error]', err);
      return res.status(500).json({ error: 'Failed to load saved reports.' });
    }
  }

  /**
   * Save Custom Report Template
   */
  static async createSavedReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const { name, description, category, data_source, config } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Report name is required.' });
      }

      const [result] = await pool.execute(
        'INSERT INTO saved_reports (restaurant_id, name, description, category, data_source, config, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          restaurantId,
          name.trim(),
          description || null,
          category || 'custom',
          data_source || 'sales',
          JSON.stringify(config || {}),
          userId
        ]
      );

      return res.json({
        success: true,
        id: result.insertId,
        message: 'Report configuration saved successfully.'
      });
    } catch (err) {
      console.error('[Create Saved Report Error]', err);
      return res.status(500).json({ error: 'Failed to save report configuration.' });
    }
  }

  /**
   * Delete Saved Custom Report Template
   */
  static async deleteSavedReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const reportId = req.params.id;

      await pool.execute(
        'DELETE FROM saved_reports WHERE id = ? AND restaurant_id = ?',
        [reportId, restaurantId]
      );

      return res.json({ success: true, message: 'Saved report deleted successfully.' });
    } catch (err) {
      console.error('[Delete Saved Report Error]', err);
      return res.status(500).json({ error: 'Failed to delete saved report.' });
    }
  }
}

module.exports = ReportController;


