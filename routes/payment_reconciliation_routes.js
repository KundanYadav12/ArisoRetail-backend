const express = require('express');
const { authenticateToken } = require('../middlewares/auth_middleware');
const PaymentReconciliationController = require('../controllers/payment_reconciliation_controller');

const router = express.Router();

// All payment reconciliation endpoints require authenticated session
router.use(authenticateToken);

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
