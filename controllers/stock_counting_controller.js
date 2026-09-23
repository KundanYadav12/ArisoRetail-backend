const StockCountingRepository = require('../repositories/stock_counting_repository');

class StockCountingController {
  // ===========================================================================
  // DEVICES
  // ===========================================================================

  static async getDevices(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { warehouse_id } = req.query;
      const devices = await StockCountingRepository.getDevices(restaurantId, warehouse_id);
      return res.json(devices);
    } catch (err) {
      console.error('Fetch devices error:', err);
      return res.status(500).json({ error: 'Failed to retrieve counting devices: ' + err.message });
    }
  }

  static async getDeviceById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const device = await StockCountingRepository.getDeviceById(id, restaurantId);
      if (!device) return res.status(404).json({ error: 'Device not found.' });
      return res.json(device);
    } catch (err) {
      console.error('Fetch device by ID error:', err);
      return res.status(500).json({ error: 'Failed to retrieve device details: ' + err.message });
    }
  }

  static async createDevice(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const device = await StockCountingRepository.createDevice(restaurantId, req.body);
      return res.status(201).json(device);
    } catch (err) {
      console.error('Create device error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async updateDevice(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const device = await StockCountingRepository.updateDevice(id, restaurantId, req.body);
      return res.json(device);
    } catch (err) {
      console.error('Update device error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async deleteDevice(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const result = await StockCountingRepository.deleteDevice(id, restaurantId);
      return res.json(result);
    } catch (err) {
      console.error('Delete device error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  // ===========================================================================
  // ASSIGNMENTS
  // ===========================================================================

  static async getAssignments(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const assignments = await StockCountingRepository.getAssignments(restaurantId, req.query);
      return res.json(assignments);
    } catch (err) {
      console.error('Fetch assignments error:', err);
      return res.status(500).json({ error: 'Failed to retrieve product assignments: ' + err.message });
    }
  }

  static async assignProducts(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;
      const result = await StockCountingRepository.assignProductsToDevice(restaurantId, userId, userName, req.body);
      return res.status(201).json(result);
    } catch (err) {
      console.error('Assign products error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async removeAssignment(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const result = await StockCountingRepository.removeAssignment(id, restaurantId);
      return res.json(result);
    } catch (err) {
      console.error('Remove assignment error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  // ===========================================================================
  // BARCODE SCAN RESTRICTION VALIDATION
  // ===========================================================================

  static async scanBarcode(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const result = await StockCountingRepository.validateBarcodeScan(restaurantId, req.body);

      if (!result.success) {
        // Return 403 for unauthorized/unassigned product or device error
        const status = (result.code === 'DEVICE_NOT_FOUND' || result.code === 'NO_DATA') ? 404 : 403;
        return res.status(status).json(result);
      }

      return res.json(result);
    } catch (err) {
      console.error('Barcode scan validation error:', err);
      return res.status(500).json({ error: 'Failed to validate barcode scan: ' + err.message });
    }
  }

  // ===========================================================================
  // COUNT SESSIONS
  // ===========================================================================

  static async getSessions(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const sessions = await StockCountingRepository.getSessions(restaurantId, req.query);
      return res.json(sessions);
    } catch (err) {
      console.error('Fetch sessions error:', err);
      return res.status(500).json({ error: 'Failed to retrieve count sessions: ' + err.message });
    }
  }

  static async getSessionById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { id } = req.params;
      const session = await StockCountingRepository.getSessionById(id, restaurantId);
      if (!session) return res.status(404).json({ error: 'Count session not found.' });
      return res.json(session);
    } catch (err) {
      console.error('Fetch session by ID error:', err);
      return res.status(500).json({ error: 'Failed to retrieve session: ' + err.message });
    }
  }

  static async submitSession(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;
      const session = await StockCountingRepository.submitCountSession(restaurantId, userId, userName, req.body);
      return res.status(201).json(session);
    } catch (err) {
      console.error('Submit count session error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async approveSession(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;
      const { id } = req.params;
      const { notes } = req.body;
      const session = await StockCountingRepository.approveSession(id, restaurantId, userId, userName, notes);
      return res.json(session);
    } catch (err) {
      console.error('Approve session error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async rejectSession(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const userId = req.user.id;
      const userName = req.user.name || req.user.username;
      const { id } = req.params;
      const { reason } = req.body;
      const session = await StockCountingRepository.rejectSession(id, restaurantId, userId, userName, reason);
      return res.json(session);
    } catch (err) {
      console.error('Reject session error:', err);
      return res.status(400).json({ error: err.message });
    }
  }
}

module.exports = StockCountingController;
