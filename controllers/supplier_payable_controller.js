const SupplierPayableRepository = require('../repositories/supplier_payable_repository');

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
