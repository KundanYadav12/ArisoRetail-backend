const CustomerReceivableRepository = require('../repositories/customer_receivable_repository');

class CustomerReceivableController {
  static async getSummary(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const data = await CustomerReceivableRepository.getReceivablesSummary(restaurantId, req.query);
      return res.json(data);
    } catch (err) {
      console.error('[CustomerReceivableController.getSummary error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to retrieve receivables summary.' });
    }
  }

  static async getUnpaidInvoices(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const { customerId } = req.params;
      const invoices = await CustomerReceivableRepository.getCustomerUnpaidInvoices(restaurantId, customerId);
      return res.json(invoices);
    } catch (err) {
      console.error('[CustomerReceivableController.getUnpaidInvoices error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to retrieve unpaid invoices.' });
    }
  }

  static async recordPayment(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;

      const result = await CustomerReceivableRepository.recordCustomerPayment(
        restaurantId,
        req.body,
        userId,
        userName
      );

      return res.status(201).json(result);
    } catch (err) {
      console.error('[CustomerReceivableController.recordPayment error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to record customer payment.' });
    }
  }

  static async getAgeingReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const report = await CustomerReceivableRepository.getAgeingReport(restaurantId, req.query);
      return res.json(report);
    } catch (err) {
      console.error('[CustomerReceivableController.getAgeingReport error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to retrieve ageing report.' });
    }
  }

  static async getStatement(req, res) {
    try {
      const restaurantId = req.user.restaurant_id || req.user.restaurantId;
      const { customerId } = req.params;
      const { start_date, end_date } = req.query;

      const statement = await CustomerReceivableRepository.getCustomerStatement(
        restaurantId,
        customerId,
        start_date,
        end_date
      );
      return res.json(statement);
    } catch (err) {
      console.error('[CustomerReceivableController.getStatement error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to retrieve customer statement.' });
    }
  }
}

module.exports = CustomerReceivableController;
