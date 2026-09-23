const pool = require('../config/db');
const ReportRepository = require('../repositories/report_repository');
const CreditNoteRepository = require('../repositories/credit_note_repository');
const EinvoiceService = require('../services/einvoice_service');
const EwayBillService = require('../services/eway_bill_service');
const ExcelJS = require('exceljs');

const parseAndExpandDates = (queryDateFrom, queryDateTo) => {
  const getLocalDateString = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayStr = getLocalDateString(new Date());
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

class GstController {
  /**
   * GST Liability & Compliance Dashboard Overview
   */
  static async getDashboard(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
      const summary = await ReportRepository.getGstDashboardSummary(restaurantId, dateFrom, dateTo);
      return res.json({
        success: true,
        summary,
        dateFrom,
        dateTo
      });
    } catch (err) {
      console.error('[GST Controller Dashboard Error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve GST dashboard summary: ' + err.message });
    }
  }

  /**
   * GSTR-1 Sales Register Data
   */
  static async getGstr1(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
      const report = await ReportRepository.getGstr1Report(restaurantId, dateFrom, dateTo);
      return res.json({
        success: true,
        report,
        dateFrom,
        dateTo
      });
    } catch (err) {
      console.error('[GST Controller GSTR-1 Error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve GSTR-1 report: ' + err.message });
    }
  }

  /**
   * GSTR-2 Purchase Register Data
   */
  static async getGstr2(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
      const report = await ReportRepository.getGstr2Report(restaurantId, dateFrom, dateTo);
      return res.json({
        success: true,
        report,
        dateFrom,
        dateTo
      });
    } catch (err) {
      console.error('[GST Controller GSTR-2 Error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve GSTR-2 report: ' + err.message });
    }
  }

  /**
   * HSN Summary Report Data
   */
  static async getHsnSummary(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
      const report = await ReportRepository.getHsnSummaryReport(restaurantId, dateFrom, dateTo);
      return res.json({
        success: true,
        report,
        dateFrom,
        dateTo
      });
    } catch (err) {
      console.error('[GST Controller HSN Error]:', err);
      return res.status(500).json({ error: 'Failed to retrieve HSN summary: ' + err.message });
    }
  }

  /**
   * Fetch Business GST Configuration
   */
  static async getSettings(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const [rows] = await pool.execute(
        `SELECT 
          restaurant_name, legal_name, trade_name, gst_number,
          state, state_code, gst_registration_type, composition_tax_rate,
          default_hsn_code, invoice_prefix, einvoice_enabled, eway_bill_enabled,
          gst_mode, default_gst_rate, gst_enabled
         FROM receipt_settings WHERE restaurant_id = ?`,
        [restaurantId]
      );

      return res.json(rows[0] || {});
    } catch (err) {
      console.error('[GST Controller Get Settings Error]:', err);
      return res.status(500).json({ error: 'Failed to load GST settings.' });
    }
  }

  /**
   * Update Business GST Configuration
   */
  static async updateSettings(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const {
        legal_name,
        trade_name,
        gst_number,
        state,
        state_code,
        gst_registration_type,
        composition_tax_rate,
        default_hsn_code,
        invoice_prefix,
        einvoice_enabled,
        eway_bill_enabled,
        gst_mode,
        default_gst_rate,
        gst_enabled
      } = req.body;

      // Update receipt_settings
      await pool.execute(
        `UPDATE receipt_settings SET
          legal_name = ?, trade_name = ?, gst_number = ?,
          state = ?, state_code = ?, gst_registration_type = ?,
          composition_tax_rate = ?, default_hsn_code = ?, invoice_prefix = ?,
          einvoice_enabled = ?, eway_bill_enabled = ?,
          gst_mode = COALESCE(?, gst_mode),
          default_gst_rate = COALESCE(?, default_gst_rate),
          gst_enabled = COALESCE(?, gst_enabled)
         WHERE restaurant_id = ?`,
        [
          legal_name || null,
          trade_name || null,
          gst_number || null,
          state || 'Maharashtra',
          state_code || '27',
          gst_registration_type || 'regular',
          parseFloat(composition_tax_rate || 1.00),
          default_hsn_code || null,
          invoice_prefix || 'INV-',
          einvoice_enabled ? 1 : 0,
          eway_bill_enabled ? 1 : 0,
          gst_mode || null,
          default_gst_rate !== undefined ? parseFloat(default_gst_rate) : null,
          gst_enabled !== undefined ? (gst_enabled ? 1 : 0) : null,
          restaurantId
        ]
      );

      // Sync to restaurants table
      await pool.execute(
        `UPDATE restaurants SET
          legal_name = ?, trade_name = ?, gst_number = ?,
          state = ?, state_code = ?, gst_registration_type = ?,
          composition_tax_rate = ?, default_hsn_code = ?, invoice_prefix = ?,
          einvoice_enabled = ?, eway_bill_enabled = ?,
          gst_enabled = COALESCE(?, gst_enabled)
         WHERE id = ?`,
        [
          legal_name || null,
          trade_name || null,
          gst_number || null,
          state || 'Maharashtra',
          state_code || '27',
          gst_registration_type || 'regular',
          parseFloat(composition_tax_rate || 1.00),
          default_hsn_code || null,
          invoice_prefix || 'INV-',
          einvoice_enabled ? 1 : 0,
          eway_bill_enabled ? 1 : 0,
          gst_enabled !== undefined ? (gst_enabled ? 1 : 0) : null,
          restaurantId
        ]
      );

      return res.json({ message: 'GST configuration updated successfully.' });
    } catch (err) {
      console.error('[GST Controller Update Settings Error]:', err);
      return res.status(500).json({ error: 'Failed to update GST settings: ' + err.message });
    }
  }

  /**
   * Create Sales Return & Credit Note
   */
  static async createCreditNote(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.username || req.user.name;
      const { creditNoteData, items } = req.body;

      if (!creditNoteData || !creditNoteData.order_id) {
        return res.status(400).json({ error: 'Original order_id is required for credit note.' });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'At least one return item is required.' });
      }

      const creditNote = await CreditNoteRepository.create(
        restaurantId,
        creditNoteData,
        items,
        userId,
        userName
      );

      return res.status(201).json({
        success: true,
        message: 'Credit Note issued successfully.',
        creditNote
      });
    } catch (err) {
      console.error('[GST Controller Create Credit Note Error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to create credit note.' });
    }
  }

  /**
   * Get all Credit Notes
   */
  static async getCreditNotes(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const notes = await CreditNoteRepository.getAll(restaurantId, req.query);
      return res.json(notes);
    } catch (err) {
      console.error('[GST Controller Get Credit Notes Error]:', err);
      return res.status(500).json({ error: 'Failed to load credit notes.' });
    }
  }

  /**
   * Get Credit Note By ID
   */
  static async getCreditNoteById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const note = await CreditNoteRepository.getById(req.params.id, restaurantId);
      if (!note) return res.status(404).json({ error: 'Credit Note not found.' });
      return res.json(note);
    } catch (err) {
      console.error('[GST Controller Get Credit Note By ID Error]:', err);
      return res.status(500).json({ error: 'Failed to load credit note.' });
    }
  }

  /**
   * Generate E-Invoice
   */
  static async generateEInvoice(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const result = await EinvoiceService.processEInvoice(restaurantId, orderId, req.body || {});
      return res.json(result);
    } catch (err) {
      console.error('[GST Controller Generate E-Invoice Error]:', err);
      return res.status(500).json({ error: err.message || 'E-Invoice generation failed.' });
    }
  }

  /**
   * Cancel E-Invoice
   */
  static async cancelEInvoice(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const { cancelReason, cancelRemarks } = req.body || {};
      const result = await EinvoiceService.cancelEInvoice(restaurantId, orderId, cancelReason, cancelRemarks);
      return res.json(result);
    } catch (err) {
      console.error('[GST Controller Cancel E-Invoice Error]:', err);
      return res.status(500).json({ error: err.message || 'E-Invoice cancellation failed.' });
    }
  }

  /**
   * Get E-Invoice Status
   */
  static async getEInvoiceStatus(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const result = await EinvoiceService.getEInvoiceStatus(restaurantId, orderId);
      return res.json(result || { status: 'NOT_APPLICABLE' });
    } catch (err) {
      console.error('[GST Controller E-Invoice Status Error]:', err);
      return res.status(500).json({ error: 'Failed to fetch E-Invoice status.' });
    }
  }

  /**
   * Generate E-Way Bill
   */
  static async generateEWayBill(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const result = await EwayBillService.generateEWayBill(restaurantId, orderId, req.body || {});
      return res.json(result);
    } catch (err) {
      console.error('[GST Controller Generate E-Way Bill Error]:', err);
      return res.status(500).json({ error: err.message || 'E-Way Bill generation failed.' });
    }
  }

  /**
   * Cancel E-Way Bill
   */
  static async cancelEWayBill(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const { cancelReason } = req.body || {};
      const result = await EwayBillService.cancelEWayBill(restaurantId, orderId, cancelReason);
      return res.json(result);
    } catch (err) {
      console.error('[GST Controller Cancel E-Way Bill Error]:', err);
      return res.status(500).json({ error: err.message || 'E-Way Bill cancellation failed.' });
    }
  }

  /**
   * Get E-Way Bill Status
   */
  static async getEWayBillStatus(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const result = await EwayBillService.getEWayBillStatus(restaurantId, orderId);
      return res.json(result || { status: 'NOT_APPLICABLE' });
    } catch (err) {
      console.error('[GST Controller E-Way Bill Status Error]:', err);
      return res.status(500).json({ error: 'Failed to fetch E-Way Bill status.' });
    }
  }

  /**
   * Export GSTR-1 Excel (.xlsx)
   */
  static async exportGstr1Excel(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
      const report = await ReportRepository.getGstr1Report(restaurantId, dateFrom, dateTo);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Ariso Retail GST Compliance';

      // 1. Sheet B2B
      const wsB2b = workbook.addWorksheet('B2B Invoices');
      wsB2b.columns = [
        { header: 'GSTIN of Recipient', key: 'customer_gstin', width: 20 },
        { header: 'Receiver Name', key: 'customer_name', width: 25 },
        { header: 'Invoice Number', key: 'invoice_number', width: 20 },
        { header: 'Invoice Date', key: 'invoice_date', width: 15 },
        { header: 'Invoice Value (₹)', key: 'invoice_value', width: 18 },
        { header: 'Place of Supply', key: 'place_of_supply', width: 20 },
        { header: 'Reverse Charge', key: 'reverse_charge', width: 15 },
        { header: 'Taxable Value (₹)', key: 'taxable_value', width: 18 },
        { header: 'CGST (₹)', key: 'cgst_amount', width: 14 },
        { header: 'SGST (₹)', key: 'sgst_amount', width: 14 },
        { header: 'IGST (₹)', key: 'igst_amount', width: 14 },
        { header: 'Total Tax (₹)', key: 'tax_amount', width: 16 }
      ];
      wsB2b.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
      wsB2b.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
      report.b2b.forEach(row => wsB2b.addRow(row));

      // 2. Sheet B2C
      const wsB2c = workbook.addWorksheet('B2C Invoices');
      wsB2c.columns = [
        { header: 'Invoice Number', key: 'invoice_number', width: 20 },
        { header: 'Invoice Date', key: 'invoice_date', width: 15 },
        { header: 'Customer Name', key: 'customer_name', width: 22 },
        { header: 'Place of Supply', key: 'place_of_supply', width: 18 },
        { header: 'Taxable Value (₹)', key: 'taxable_value', width: 18 },
        { header: 'CGST (₹)', key: 'cgst_amount', width: 14 },
        { header: 'SGST (₹)', key: 'sgst_amount', width: 14 },
        { header: 'IGST (₹)', key: 'igst_amount', width: 14 },
        { header: 'Total Tax (₹)', key: 'tax_amount', width: 16 },
        { header: 'Invoice Total (₹)', key: 'invoice_value', width: 18 },
        { header: 'Payment Mode', key: 'payment_mode', width: 15 }
      ];
      wsB2c.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
      wsB2c.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
      report.b2c.forEach(row => wsB2c.addRow(row));

      // 3. Sheet HSN Summary
      const wsHsn = workbook.addWorksheet('HSN Summary');
      wsHsn.columns = [
        { header: 'HSN / SAC', key: 'hsn_code', width: 15 },
        { header: 'Description', key: 'description', width: 25 },
        { header: 'UOM', key: 'uom', width: 10 },
        { header: 'Total Quantity', key: 'total_quantity', width: 16 },
        { header: 'Taxable Value (₹)', key: 'total_taxable_value', width: 18 },
        { header: 'GST Rate %', key: 'gst_rate', width: 12 },
        { header: 'CGST (₹)', key: 'total_cgst', width: 14 },
        { header: 'SGST (₹)', key: 'total_sgst', width: 14 },
        { header: 'IGST (₹)', key: 'total_igst', width: 14 },
        { header: 'Total Tax (₹)', key: 'total_tax', width: 16 }
      ];
      wsHsn.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
      wsHsn.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
      report.hsnSummary.forEach(row => wsHsn.addRow(row));

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=GSTR1_Sales_Report_${dateFrom.slice(0, 10)}_to_${dateTo.slice(0, 10)}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error('[GST Controller GSTR-1 Excel Error]:', err);
      return res.status(500).json({ error: 'Failed to generate GSTR-1 Excel export.' });
    }
  }

  /**
   * Export GSTR-2 Excel (.xlsx)
   */
  static async exportGstr2Excel(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { dateFrom, dateTo } = parseAndExpandDates(req.query.date_from, req.query.date_to);
      const report = await ReportRepository.getGstr2Report(restaurantId, dateFrom, dateTo);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Ariso Retail GST Compliance';

      const ws = workbook.addWorksheet('GSTR-2 Inward Supplies (ITC)');
      ws.columns = [
        { header: 'Supplier GSTIN', key: 'supplier_gstin', width: 20 },
        { header: 'Supplier Name', key: 'supplier_name', width: 25 },
        { header: 'Bill Number', key: 'bill_number', width: 20 },
        { header: 'Bill Date', key: 'bill_date', width: 15 },
        { header: 'Tax Type', key: 'tax_type', width: 14 },
        { header: 'Taxable Value (₹)', key: 'taxable_value', width: 18 },
        { header: 'Input CGST (₹)', key: 'cgst_amount', width: 15 },
        { header: 'Input SGST (₹)', key: 'sgst_amount', width: 15 },
        { header: 'Input IGST (₹)', key: 'igst_amount', width: 15 },
        { header: 'Total ITC (₹)', key: 'total_itc', width: 16 },
        { header: 'Bill Amount (₹)', key: 'invoice_value', width: 18 },
        { header: 'Payment Status', key: 'payment_status', width: 15 }
      ];
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
      report.purchases.forEach(row => ws.addRow(row));

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=GSTR2_Purchase_ITC_Report_${dateFrom.slice(0, 10)}_to_${dateTo.slice(0, 10)}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error('[GST Controller GSTR-2 Excel Error]:', err);
      return res.status(500).json({ error: 'Failed to generate GSTR-2 Excel export.' });
    }
  }
}

module.exports = GstController;
