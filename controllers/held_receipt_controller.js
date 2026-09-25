const HeldReceiptRepository = require('../repositories/held_receipt_repository');

class HeldReceiptController {
  static async createHeldReceipt(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;

      const receipt = await HeldReceiptRepository.createHeldReceipt(restaurantId, userId, userName, req.body);
      return res.status(201).json(receipt);
    } catch (err) {
      console.error('[Create Held Receipt Error]', err);
      return res.status(400).json({ error: err.message || 'Failed to hold receipt.' });
    }
  }

  static async getHeldReceipts(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const receipts = await HeldReceiptRepository.getHeldReceipts(restaurantId, req.query);
      return res.json(receipts);
    } catch (err) {
      console.error('[Get Held Receipts Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to retrieve held receipts.' });
    }
  }

  static async getHeldReceiptById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const receipt = await HeldReceiptRepository.getHeldReceiptById(id, restaurantId);

      if (!receipt) {
        return res.status(404).json({ error: 'Held receipt not found.' });
      }

      return res.json(receipt);
    } catch (err) {
      console.error('[Get Held Receipt by ID Error]', err);
      return res.status(500).json({ error: err.message || 'Failed to retrieve held receipt.' });
    }
  }

  static async updateHeldReceipt(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;
      const { id } = req.params;

      const updated = await HeldReceiptRepository.updateHeldReceipt(id, restaurantId, userId, userName, req.body);
      return res.json(updated);
    } catch (err) {
      console.error('[Update Held Receipt Error]', err);
      return res.status(400).json({ error: err.message || 'Failed to update held receipt.' });
    }
  }

  static async resumeHeldReceipt(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;
      const { id } = req.params;

      const resumed = await HeldReceiptRepository.resumeHeldReceipt(id, restaurantId, userId, userName);
      return res.json(resumed);
    } catch (err) {
      console.error('[Resume Held Receipt Error]', err);
      return res.status(400).json({ error: err.message || 'Failed to resume held receipt.' });
    }
  }

  static async completeHeldReceipt(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const orderId = req.body.order_id || req.body.sale_id || null;

      const result = await HeldReceiptRepository.completeHeldReceipt(id, restaurantId, orderId);
      return res.json(result);
    } catch (err) {
      console.error('[Complete Held Receipt Error]', err);
      return res.status(400).json({ error: err.message || 'Failed to complete held receipt.' });
    }
  }

  static async cancelHeldReceipt(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const { id } = req.params;
      const { reason = 'Cancelled by cashier' } = req.body;

      const result = await HeldReceiptRepository.cancelHeldReceipt(id, restaurantId, userId, reason);
      return res.json(result);
    } catch (err) {
      console.error('[Cancel Held Receipt Error]', err);
      return res.status(400).json({ error: err.message || 'Failed to cancel held receipt.' });
    }
  }
}

module.exports = HeldReceiptController;
