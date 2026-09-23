const DeliveryChallanRepository = require('../repositories/delivery_challan_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');

class DeliveryChallanController {
  /**
   * Create a Delivery Challan from Sales Order
   */
  static async create(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { challan_data, items } = req.body;

      if (!challan_data || !challan_data.sales_order_id) {
        return res.status(400).json({ error: 'Sales Order ID is required.' });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'At least one item must be included in the delivery challan.' });
      }

      const result = await DeliveryChallanRepository.create(
        restaurantId,
        challan_data,
        items,
        req.user.id,
        req.user.name
      );

      await SuperAdminRepository.addAuditLog(
        restaurantId,
        req.user.id,
        'CHALLAN_CREATE',
        `Created Delivery Challan #${result.challanNumber} for Sales Order #${result.salesOrderId}`,
        req.ip
      ).catch(() => {});

      return res.status(201).json({
        message: 'Delivery Challan created successfully.',
        ...result
      });
    } catch (err) {
      console.error('[DeliveryChallanController.create error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to create Delivery Challan.' });
    }
  }

  /**
   * Get single Delivery Challan by ID
   */
  static async getById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const challan = await DeliveryChallanRepository.getById(req.params.id, restaurantId);
      if (!challan) {
        return res.status(404).json({ error: 'Delivery Challan not found.' });
      }
      return res.json(challan);
    } catch (err) {
      console.error('[DeliveryChallanController.getById error]:', err);
      return res.status(500).json({ error: 'Failed to fetch Delivery Challan.' });
    }
  }

  /**
   * Get all Delivery Challans for a specific Sales Order
   */
  static async getBySalesOrderId(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const challans = await DeliveryChallanRepository.getBySalesOrderId(req.params.salesOrderId, restaurantId);
      return res.json(challans);
    } catch (err) {
      console.error('[DeliveryChallanController.getBySalesOrderId error]:', err);
      return res.status(500).json({ error: 'Failed to fetch Delivery Challans for Sales Order.' });
    }
  }

  /**
   * List all Delivery Challans (paginated, filtered)
   */
  static async getAll(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const challans = await DeliveryChallanRepository.getAll(restaurantId, req.query);
      return res.json(challans);
    } catch (err) {
      console.error('[DeliveryChallanController.getAll error]:', err);
      return res.status(500).json({ error: 'Failed to fetch Delivery Challans.' });
    }
  }

  /**
   * Cancel Delivery Challan
   */
  static async cancel(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { reason } = req.body;
      const result = await DeliveryChallanRepository.cancel(
        req.params.id,
        restaurantId,
        req.user.id,
        req.user.name,
        reason
      );

      await SuperAdminRepository.addAuditLog(
        restaurantId,
        req.user.id,
        'CHALLAN_CANCEL',
        `Cancelled Delivery Challan #${req.params.id}: ${reason || 'No reason provided'}`,
        req.ip
      ).catch(() => {});

      return res.json(result);
    } catch (err) {
      console.error('[DeliveryChallanController.cancel error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to cancel Delivery Challan.' });
    }
  }
}

module.exports = DeliveryChallanController;
