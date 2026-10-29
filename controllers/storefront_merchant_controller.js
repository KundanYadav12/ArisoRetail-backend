const StorefrontRepository = require('../repositories/storefront_repository');
const { notify: rtNotify } = require('../services/realtime_service');

class StorefrontMerchantController {
  /**
   * GET /api/merchant/store/settings
   */
  static async getSettings(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const settings = await StorefrontRepository.getMerchantStoreSettings(restaurantId);
      if (!settings) {
        return res.status(404).json({ error: 'Store profile not found.' });
      }
      return res.json({ settings });
    } catch (err) {
      console.error('[StorefrontMerchantController.getSettings Error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch store settings.' });
    }
  }

  /**
   * PUT /api/merchant/store/settings
   */
  static async updateSettings(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const updated = await StorefrontRepository.updateMerchantStoreSettings(restaurantId, req.body);
      return res.json({
        message: 'Storefront settings updated successfully.',
        settings: updated
      });
    } catch (err) {
      console.error('[StorefrontMerchantController.updateSettings Error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to update store settings.' });
    }
  }

  /**
   * GET /api/merchant/store/payment-settings
   */
  static async getPaymentSettings(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const paymentSettings = await StorefrontRepository.getMerchantPaymentSettings(restaurantId, false);
      return res.json({ payment_settings: paymentSettings });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch payment settings.' });
    }
  }

  /**
   * PUT /api/merchant/store/payment-settings
   */
  static async updatePaymentSettings(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const updated = await StorefrontRepository.updateMerchantPaymentSettings(restaurantId, req.body);
      return res.json({
        message: 'Payment configuration saved successfully.',
        payment_settings: updated
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to save payment settings.' });
    }
  }

  /**
   * GET /api/merchant/store/products
   */
  static async getProducts(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { category_id, search, online_only } = req.query;

      const products = await StorefrontRepository.getMerchantProducts(restaurantId, {
        categoryId: category_id,
        search,
        availableOnlineOnly: online_only === 'true' || online_only === '1'
      });

      return res.json({ products });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch products.' });
    }
  }

  /**
   * PUT /api/merchant/store/products/:id
   */
  static async updateProduct(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const productId = req.params.id;

      await StorefrontRepository.updateMerchantProduct(restaurantId, productId, req.body);
      return res.json({ message: 'Product online visibility updated.' });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to update product.' });
    }
  }

  /**
   * POST /api/merchant/store/products/bulk-toggle
   */
  static async bulkUpdateProducts(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { product_ids, available_online } = req.body;

      if (!Array.isArray(product_ids) || product_ids.length === 0) {
        return res.status(400).json({ error: 'Please select at least one product.' });
      }

      const affected = await StorefrontRepository.bulkUpdateMerchantProducts(restaurantId, product_ids, available_online);
      return res.json({
        message: `Successfully updated ${affected} product(s) for online store.`,
        affected
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Bulk update failed.' });
    }
  }

  /**
   * GET /api/merchant/store/orders
   */
  static async getOrders(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { status, search, from_date, to_date, page, limit } = req.query;

      const result = await StorefrontRepository.getMerchantOrders(restaurantId, {
        status,
        search,
        fromDate: from_date,
        toDate: to_date,
        page,
        limit
      });

      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch online orders.' });
    }
  }

  /**
   * GET /api/merchant/store/orders/:id
   */
  static async getOrderById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;

      const order = await StorefrontRepository.getOnlineOrderById(restaurantId, orderId);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      return res.json({ order });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch order details.' });
    }
  }

  /**
   * PUT /api/merchant/store/orders/:id/status
   * Accept / Reject / Update Status
   */
  static async updateOrderStatus(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const { status, reason } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status is required.' });
      }

      const result = await StorefrontRepository.updateOnlineOrderStatus(
        restaurantId,
        orderId,
        status,
        reason,
        req.user.name || 'Merchant Staff'
      );

      // Emit SSE event
      try {
        rtNotify.orderUpdated(restaurantId, {
          action: 'online_order_status_updated',
          orderId: orderId,
          orderNumber: result.order_number,
          newStatus: status
        });
      } catch (_) {}

      return res.json({
        message: `Order #${result.order_number} status updated to "${status.toUpperCase()}".`,
        order: result
      });
    } catch (err) {
      console.error('[StorefrontMerchantController.updateOrderStatus Error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to update order status.' });
    }
  }

  /**
   * GET /api/merchant/store/qr-code
   */
  static async getQrCode(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const qrData = await StorefrontRepository.generateStoreQrCode(restaurantId);
      return res.json(qrData);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to generate QR code.' });
    }
  }
}

module.exports = StorefrontMerchantController;
