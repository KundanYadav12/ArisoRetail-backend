const express = require('express');
const { authenticateToken } = require('../middlewares/auth_middleware');
const DayEndController = require('../controllers/day_end_controller');

const router = express.Router();

// All Day End endpoints require authentication
router.use(authenticateToken);

// Business Day status & open
router.get('/status', DayEndController.getStatus);
router.post('/open-day', DayEndController.openDay);

// Live Reconciliation Summary
router.get('/summary', DayEndController.getSummary);

// Cash Counting (Denominations)
router.post('/cash-count', DayEndController.recordCashCount);

// Draft & Closing Actions
router.post('/draft', DayEndController.saveDraft);
router.post('/close', DayEndController.closeDay);
router.post('/reopen', DayEndController.reopenDay);

// X Report (Live snapshot) & Z Report (Closed audit)
router.get('/x-report', DayEndController.getXReport);
router.get('/z-report/:id', DayEndController.getZReport);

// History
router.get('/history', DayEndController.getHistory);

module.exports = router;
