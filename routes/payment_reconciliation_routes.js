const express = require('express');
const { authenticateToken } = require('../middlewares/auth_middleware');
const PaymentReconciliationController = require('../controllers/payment_reconciliation_controller');

const router = express.Router();

// Middleware to enforce Super Admin-controlled Reconciliation feature flag
const enforceReconciliationFeature = (req, res, next) => {
  const role = (req.user?.role || '').toLowerCase();
  if (['super_admin', 'superadmin'].includes(role)) {
    return next();
  }
  if (!req.user || !req.user.reconciliation_enabled) {
    return res.status(403).json({
      success: false,
      error: 'Access Denied: Payment Reconciliation module is disabled for this store by Super Administrator.',
      code: 'RECONCILIATION_DISABLED'
    });
  }
  next();
};

// All payment reconciliation endpoints require authenticated session and enabled tenant feature flag
router.use(authenticateToken, enforceReconciliationFeature);

// 1. Overview and Summary Metrics
router.get('/overview', PaymentReconciliationController.getOverview);

// 2. Unreconciled POS Payments
router.get('/unreconciled-payments', PaymentReconciliationController.getUnreconciledPayments);

// 3. Settlements List and Single Detail
router.get('/settlements', PaymentReconciliationController.getSettlements);
router.get('/settlements/:id', PaymentReconciliationController.getSettlementById);
router.post('/settlements', PaymentReconciliationController.recordSettlement);

// 4. Matching & Auto-Matching
router.post('/match', PaymentReconciliationController.matchSettlement);
router.post('/auto-match', PaymentReconciliationController.autoMatch);

// 5. Adjustments & Unmatching
router.post('/adjustments', PaymentReconciliationController.createAdjustment);
router.post('/unmatch/:id', PaymentReconciliationController.unmatchItem);

module.exports = router;
