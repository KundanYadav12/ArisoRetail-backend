const DayEndService = require('../services/day_end_service');
const DayEndRepository = require('../repositories/day_end_repository');

class DayEndController {
  /**
   * GET /api/day-end/status
   * Get active business day status
   */
  static async getStatus(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const bDay = await DayEndService.getActiveOrTodayBusinessDay(restaurantId, false, req.user);
      return res.json({
        active_business_day: bDay,
        has_open_day: !!(bDay && bDay.status !== 'CLOSED')
      });
    } catch (err) {
      console.error('[DayEndController.getStatus error]', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch business day status.' });
    }
  }

  /**
   * POST /api/day-end/open-day
   * Open a business day and set opening cash float
   */
  static async openDay(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { businessDate, openingFloat, notes } = req.body;

      const floatVal = parseFloat(openingFloat || 0);
      if (isNaN(floatVal) || floatVal < 0) {
        return res.status(400).json({ error: 'Opening cash float must be a non-negative number.' });
      }

      const bDay = await DayEndRepository.openBusinessDay(restaurantId, {
        businessDate,
        openingFloat: floatVal,
        userId: req.user.id,
        userName: req.user.name || req.user.username || 'Staff',
        notes
      });

      return res.status(201).json({
        success: true,
        message: `Business day for ${bDay.business_date} opened successfully with float ₹${floatVal.toFixed(2)}.`,
        business_day: bDay
      });
    } catch (err) {
      console.error('[DayEndController.openDay error]', err);
      return res.status(400).json({ error: err.message || 'Failed to open business day.' });
    }
  }

  /**
   * GET /api/day-end/summary
   * Fetch live calculated Day End reconciliation summary
   */
  static async getSummary(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const targetDate = req.query.date || null;
      const summary = await DayEndService.getReconciliationSummary(restaurantId, targetDate, req.user);
      return res.json(summary);
    } catch (err) {
      console.error('[DayEndController.getSummary error]', err);
      return res.status(400).json({ error: err.message || 'Failed to calculate day end summary.' });
    }
  }

  /**
   * POST /api/day-end/cash-count
   * Record denomination-level cash counting
   */
  static async recordCashCount(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const countData = req.body;

      const result = await DayEndRepository.recordCashCount(restaurantId, {
        ...countData,
        user_id: req.user.id,
        user_name: req.user.name || req.user.username || 'Staff'
      });

      return res.status(201).json({
        success: true,
        message: `Physical cash count of ₹${result.total_physical_cash.toFixed(2)} recorded successfully.`,
        cash_count: result
      });
    } catch (err) {
      console.error('[DayEndController.recordCashCount error]', err);
      return res.status(400).json({ error: err.message || 'Failed to record cash count.' });
    }
  }

  /**
   * POST /api/day-end/draft
   * Save Day End draft
   */
  static async saveDraft(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { business_day_id, ...draftData } = req.body;

      if (!business_day_id) {
        return res.status(400).json({ error: 'business_day_id is required.' });
      }

      const saved = await DayEndRepository.saveDraft(restaurantId, business_day_id, {
        ...draftData,
        userId: req.user.id,
        userName: req.user.name || req.user.username || 'Staff'
      });

      return res.json({
        success: true,
        message: 'Day End reconciliation draft saved successfully.',
        day_end: saved
      });
    } catch (err) {
      console.error('[DayEndController.saveDraft error]', err);
      return res.status(400).json({ error: err.message || 'Failed to save day end draft.' });
    }
  }

  /**
   * POST /api/day-end/close
   * Final atomic Day Close
   */
  static async closeDay(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const closeData = req.body;

      if (!closeData.business_day_id) {
        return res.status(400).json({ error: 'business_day_id is required.' });
      }

      const result = await DayEndService.executeDayClose(restaurantId, closeData, req.user);

      return res.json({
        success: true,
        message: `Business day closed successfully. Z-Report #${result.z_report_number || ''} generated.`,
        day_end: result
      });
    } catch (err) {
      console.error('[DayEndController.closeDay error]', err);
      return res.status(400).json({ error: err.message || 'Failed to close business day.' });
    }
  }

  /**
   * POST /api/day-end/reopen
   * Reopen closed day for correction (Admin/Manager only)
   */
  static async reopenDay(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { business_day_id, reason } = req.body;

      if (!business_day_id) {
        return res.status(400).json({ error: 'business_day_id is required.' });
      }
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'A mandatory reason is required to reopen a closed day.' });
      }

      const reopened = await DayEndService.reopenClosedDay(restaurantId, business_day_id, reason, req.user);

      return res.json({
        success: true,
        message: `Business day for ${reopened.business_date} reopened for correction.`,
        business_day: reopened
      });
    } catch (err) {
      console.error('[DayEndController.reopenDay error]', err);
      return res.status(403).json({ error: err.message || 'Failed to reopen business day.' });
    }
  }

  /**
   * GET /api/day-end/x-report
   * Live X Report snapshot
   */
  static async getXReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const targetDate = req.query.date || null;
      const report = await DayEndService.generateXReport(restaurantId, targetDate);
      return res.json(report);
    } catch (err) {
      console.error('[DayEndController.getXReport error]', err);
      return res.status(500).json({ error: err.message || 'Failed to generate X Report.' });
    }
  }

  /**
   * GET /api/day-end/z-report/:id
   * Final closed Z Report
   */
  static async getZReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const dayEndId = parseInt(req.params.id, 10);
      const report = await DayEndService.getZReport(restaurantId, dayEndId);
      return res.json(report);
    } catch (err) {
      console.error('[DayEndController.getZReport error]', err);
      return res.status(404).json({ error: err.message || 'Z Report not found.' });
    }
  }

  /**
   * GET /api/day-end/history
   * List past day ends
   */
  static async getHistory(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { limit, offset, date_from, date_to, status } = req.query;

      const history = await DayEndRepository.getDayEndHistory(restaurantId, {
        limit: limit ? parseInt(limit, 10) : 30,
        offset: offset ? parseInt(offset, 10) : 0,
        dateFrom: date_from || null,
        dateTo: date_to || null,
        status: status || null
      });

      return res.json(history);
    } catch (err) {
      console.error('[DayEndController.getHistory error]', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch Day End history.' });
    }
  }
}

module.exports = DayEndController;
