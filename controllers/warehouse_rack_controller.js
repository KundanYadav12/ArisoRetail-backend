const WarehouseRackRepository = require('../repositories/warehouse_rack_repository');
const StockReconciliationService = require('../services/stock_reconciliation_service');

class WarehouseRackController {
  static async getRacks(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { warehouse_id } = req.query;
      const racks = await WarehouseRackRepository.getAll(restaurantId, warehouse_id);
      return res.json(racks);
    } catch (err) {
      console.error('Fetch racks error:', err);
      return res.status(500).json({ error: 'Failed to retrieve warehouse racks: ' + err.message });
    }
  }

  static async getRackById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const rack = await WarehouseRackRepository.getById(id, restaurantId);
      if (!rack) return res.status(404).json({ error: 'Rack not found.' });
      return res.json(rack);
    } catch (err) {
      console.error('Fetch rack by ID error:', err);
      return res.status(500).json({ error: 'Failed to retrieve rack details: ' + err.message });
    }
  }

  static async createRack(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const rack = await WarehouseRackRepository.create(restaurantId, req.body);
      return res.status(201).json(rack);
    } catch (err) {
      console.error('Create rack error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async updateRack(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const rack = await WarehouseRackRepository.update(id, restaurantId, req.body);
      return res.json(rack);
    } catch (err) {
      console.error('Update rack error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async deleteRack(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const result = await WarehouseRackRepository.delete(id, restaurantId);
      return res.json(result);
    } catch (err) {
      console.error('Delete rack error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async getProductsByRack(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const products = await WarehouseRackRepository.getProductsByRack(id, restaurantId);
      return res.json(products);
    } catch (err) {
      console.error('Fetch products by rack error:', err);
      return res.status(500).json({ error: 'Failed to retrieve products for rack: ' + err.message });
    }
  }

  static async getRacksByProduct(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { productId } = req.params;
      const { warehouse_id } = req.query;
      const racks = await WarehouseRackRepository.getRacksByProduct(productId, restaurantId, warehouse_id);
      return res.json(racks);
    } catch (err) {
      console.error('Fetch racks by product error:', err);
      return res.status(500).json({ error: 'Failed to retrieve locations for product: ' + err.message });
    }
  }

  static async moveRackStock(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;
      const result = await WarehouseRackRepository.moveRackStock(restaurantId, userId, userName, req.body);
      return res.json(result);
    } catch (err) {
      console.error('Move rack stock error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async getStockTally(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { warehouse_id } = req.query;
      const tally = await StockReconciliationService.validateStockTally(restaurantId, warehouse_id);
      return res.json(tally);
    } catch (err) {
      console.error('Stock tally validation error:', err);
      return res.status(500).json({ error: 'Failed to validate stock tally: ' + err.message });
    }
  }

  static async getProductMovementTimeline(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { productId } = req.params;
      const timeline = await StockReconciliationService.getProductMovementTimeline(restaurantId, productId, req.query);
      return res.json(timeline);
    } catch (err) {
      console.error('Product movement timeline error:', err);
      return res.status(500).json({ error: 'Failed to retrieve product movement timeline: ' + err.message });
    }
  }
}

module.exports = WarehouseRackController;
