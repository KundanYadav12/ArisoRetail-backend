const PaymentReconciliationService = require('../services/payment_reconciliation_service');

class PaymentReconciliationController {
  static getRestaurantId(req) {
    return req.user?.restaurant_id || req.restaurantId || (req.query.restaurant_id ? parseInt(req.query.restaurant_id, 10) : null);
  }

  /**
   * GET /api/payment-reconciliation/overview
   */
  static async getOverview(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const data = await PaymentReconciliationService.getOverview(restId, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[PaymentReconciliationController.getOverview error]:', err);
      return res.status(err.message.includes('required') ? 400 : 500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * GET /api/payment-reconciliation/unreconciled-payments
   */
  static async getUnreconciledPayments(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const data = await PaymentReconciliationService.getUnreconciledPayments(restId, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[PaymentReconciliationController.getUnreconciledPayments error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/payment-reconciliation/settlements
   */
  static async getSettlements(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const data = await PaymentReconciliationService.getSettlements(restId, req.query);
      return res.json({ success: true, data });
    } catch (err) {
      console.error('[PaymentReconciliationController.getSettlements error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * GET /api/payment-reconciliation/settlements/:id
   */
  static async getSettlementById(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const settlement = await PaymentReconciliationService.getSettlementById(restId, req.params.id);
      return res.json({ success: true, data: settlement });
    } catch (err) {
      console.error('[PaymentReconciliationController.getSettlementById error]:', err);
      return res.status(err.message.includes('not found') ? 404 : 500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * POST /api/payment-reconciliation/settlements
   */
  static async recordSettlement(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const settlement = await PaymentReconciliationService.recordSettlement(
        restId,
        req.body,
        req.user
      );
      return res.status(201).json({ success: true, data: settlement });
    } catch (err) {
      console.error('[PaymentReconciliationController.recordSettlement error]:', err);
      return res.status(err.message.includes('required') || err.message.includes('greater than') ? 400 : 500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * POST /api/payment-reconciliation/match
   */
  static async matchSettlement(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const result = await PaymentReconciliationService.matchSettlement(
        restId,
        req.body,
        req.user
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[PaymentReconciliationController.matchSettlement error]:', err);
      const isForbidden = err.message.includes('Unauthorized');
      const isBadRequest = err.message.includes('mandatory') || err.message.includes('required');
      return res.status(isForbidden ? 403 : (isBadRequest ? 400 : 500)).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * POST /api/payment-reconciliation/auto-match
   */
  static async autoMatch(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const result = await PaymentReconciliationService.runAutoMatching(
        restId,
        req.body?.settlement_id || null,
        req.user
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[PaymentReconciliationController.autoMatch error]:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/payment-reconciliation/adjustments
   */
  static async createAdjustment(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const result = await PaymentReconciliationService.createAdjustment(
        restId,
        req.body,
        req.user
      );
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      console.error('[PaymentReconciliationController.createAdjustment error]:', err);
      const isForbidden = err.message.includes('Unauthorized');
      return res.status(isForbidden ? 403 : 400).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * POST /api/payment-reconciliation/unmatch/:id
   */
  static async unmatchItem(req, res) {
    try {
      const restId = PaymentReconciliationController.getRestaurantId(req);
      const result = await PaymentReconciliationService.unmatchItem(
        restId,
        req.params.id,
        req.user
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('[PaymentReconciliationController.unmatchItem error]:', err);
      const isForbidden = err.message.includes('Unauthorized');
      return res.status(isForbidden ? 403 : 500).json({
        success: false,
        error: err.message
      });
    }
  }
}

module.exports = PaymentReconciliationController;
