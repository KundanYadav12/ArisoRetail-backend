const SupplierPayableRepository = require('../repositories/supplier_payable_repository');
const nodemailer = require('nodemailer');
const { generateSupplierStatementPDF, generateSupplierStatementExcel, fetchBranding } = require('../services/supplier_statement_pdf_service');

class SupplierPayableController {
  /**
   * GET /api/inventory/suppliers/outstanding
   * Aggregated outstanding summary, KPIs, and paginated supplier list.
   */
  static async getSupplierOutstandingDashboard(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const data = await SupplierPayableRepository.getSupplierOutstandingDashboard(restaurantId, req.query);
      return res.json(data);
    } catch (err) {
      console.error('[SupplierPayableController.getSupplierOutstandingDashboard] Error:', err);
      return res.status(500).json({ error: 'Failed to retrieve supplier outstanding dashboard: ' + err.message });
    }
  }

  /**
   * GET /api/inventory/suppliers/:id/payables
   * Supplier details with unpaid / partially paid bills and available advances for settlement.
   */
  static async getSupplierPayableDetails(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const supplierId = req.params.id;
      const data = await SupplierPayableRepository.getSupplierPayableDetails(supplierId, restaurantId);
      if (!data) {
        return res.status(404).json({ error: 'Supplier not found.' });
      }
      return res.json(data);
    } catch (err) {
      console.error('[SupplierPayableController.getSupplierPayableDetails] Error:', err);
      return res.status(500).json({ error: 'Failed to retrieve supplier payable details: ' + err.message });
    }
  }

  /**
   * POST /api/inventory/suppliers/payments
   * Record a supplier payment with multi-bill allocation and advance handling.
   */
  static async recordSupplierPayment(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username || 'Staff';

      const payment = await SupplierPayableRepository.recordSupplierPaymentWithAllocations(
        restaurantId,
        userId,
        userName,
        req.body
      );

      return res.status(201).json({
        message: 'Supplier payment recorded successfully.',
        payment
      });
    } catch (err) {
      console.error('[SupplierPayableController.recordSupplierPayment] Error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * POST /api/inventory/suppliers/adjust-advance
   * Adjust available advance balance against an unpaid / partially paid purchase bill.
   */
  static async adjustSupplierAdvance(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username || 'Staff';

      const result = await SupplierPayableRepository.adjustSupplierAdvance(
        restaurantId,
        userId,
        userName,
        req.body
      );

      return res.status(200).json({
        message: 'Advance adjusted successfully against purchase bill.',
        result
      });
    } catch (err) {
      console.error('[SupplierPayableController.adjustSupplierAdvance] Error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * GET /api/inventory/suppliers/:id/ledger-statement
   * Fetch detailed running ledger statement.
   */
  static async getDetailedLedger(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const supplierId = req.params.id;
      const data = await SupplierPayableRepository.getDetailedLedger(supplierId, restaurantId, req.query);
      if (!data) {
        return res.status(404).json({ error: 'Supplier not found.' });
      }
      return res.json(data);
    } catch (err) {
      console.error('[SupplierPayableController.getDetailedLedger] Error:', err);
      return res.status(500).json({ error: 'Failed to retrieve supplier ledger: ' + err.message });
    }
  }

  /**
   * GET /api/inventory/suppliers/:id/ledger-statement/pdf
   * Download Supplier Statement of Account as formatted PDF.
   */
  static async downloadLedgerPDF(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const supplierId = req.params.id;
      const pdfBuffer = await generateSupplierStatementPDF(supplierId, restaurantId, req.query);
      const ledgerData = await SupplierPayableRepository.getDetailedLedger(supplierId, restaurantId, req.query);
      const suppName = (ledgerData?.supplier?.name || 'Account').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Supplier_Statement_${suppName}_${new Date().toISOString().slice(0, 10)}.pdf`;

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdfBuffer.length
      });
      return res.send(pdfBuffer);
    } catch (err) {
      console.error('[SupplierPayableController.downloadLedgerPDF] Error:', err);
      return res.status(500).json({ error: 'Failed to generate statement PDF: ' + err.message });
    }
  }

  /**
   * GET /api/inventory/suppliers/:id/ledger-statement/excel
   * Download Supplier Statement of Account as Excel (.xlsx).
   */
  static async downloadLedgerExcel(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const supplierId = req.params.id;
      const excelBuffer = await generateSupplierStatementExcel(supplierId, restaurantId, req.query);
      const ledgerData = await SupplierPayableRepository.getDetailedLedger(supplierId, restaurantId, req.query);
      const suppName = (ledgerData?.supplier?.name || 'Account').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `Supplier_Statement_${suppName}_${new Date().toISOString().slice(0, 10)}.xlsx`;

      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': excelBuffer.length
      });
      return res.send(excelBuffer);
    } catch (err) {
      console.error('[SupplierPayableController.downloadLedgerExcel] Error:', err);
      return res.status(500).json({ error: 'Failed to generate statement Excel: ' + err.message });
    }
  }

  /**
   * POST /api/inventory/suppliers/:id/ledger-statement/email
   * Send Supplier Statement of Account via Email (PDF or Excel).
   */
  static async emailLedgerStatement(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const supplierId = req.params.id;
      const { to, subject, message, format = 'pdf' } = req.body;

      if (!to || !to.trim()) {
        return res.status(400).json({ error: 'Recipient email address (to) is required.' });
      }

      const branding = await fetchBranding(restaurantId);
      const ledgerData = await SupplierPayableRepository.getDetailedLedger(supplierId, restaurantId, req.query);
      if (!ledgerData || !ledgerData.supplier) {
        return res.status(404).json({ error: 'Supplier not found.' });
      }

      const supp = ledgerData.supplier;
      const suppName = (supp.name || 'Account').replace(/[^a-zA-Z0-9_-]/g, '_');
      const isExcel = String(format).toLowerCase() === 'excel' || String(format).toLowerCase() === 'xlsx';

      let fileBuffer;
      let filename;
      let contentType;

      if (isExcel) {
        fileBuffer = await generateSupplierStatementExcel(supplierId, restaurantId, req.query);
        filename = `Supplier_Statement_${suppName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        fileBuffer = await generateSupplierStatementPDF(supplierId, restaurantId, req.query);
        filename = `Supplier_Statement_${suppName}_${new Date().toISOString().slice(0, 10)}.pdf`;
        contentType = 'application/pdf';
      }

      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      const defaultSubject = `Supplier Statement of Account - ${supp.name} (${branding.restaurant_name || 'Retail Store'})`;
      const defaultMessage = `Dear ${supp.name},\n\nPlease find attached your Statement of Account from ${branding.restaurant_name || 'us'}.\n\nClosing Balance: Rs. ${parseFloat(ledgerData.summary?.closing_balance || 0).toFixed(2)}\n\nThank you for your business.\n\nRegards,\n${branding.restaurant_name || ''}`;

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: to.trim(),
        subject: subject || defaultSubject,
        text: message || defaultMessage,
        attachments: [{
          filename,
          content: fileBuffer,
          contentType
        }]
      });

      return res.json({ message: `Statement (${isExcel ? 'Excel' : 'PDF'}) emailed successfully to ${to.trim()}.` });
    } catch (err) {
      console.error('[SupplierPayableController.emailLedgerStatement] Error:', err);
      return res.status(500).json({ error: 'Failed to send email: ' + err.message });
    }
  }

  /**
   * GET /api/inventory/suppliers/payments/:id
   * Fetch payment details with allocated bills.
   */
  static async getPaymentById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const paymentId = req.params.id;
      const payment = await SupplierPayableRepository.getPaymentById(paymentId, restaurantId);
      if (!payment) {
        return res.status(404).json({ error: 'Supplier payment not found.' });
      }
      return res.json(payment);
    } catch (err) {
      console.error('[SupplierPayableController.getPaymentById] Error:', err);
      return res.status(500).json({ error: 'Failed to retrieve payment: ' + err.message });
    }
  }
}

module.exports = SupplierPayableController;
