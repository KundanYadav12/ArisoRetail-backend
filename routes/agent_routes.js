const express = require('express');
const router = express.Router();
const AgentController = require('../controllers/agent_controller');
const { authenticateToken } = require('../middlewares/auth_middleware');

/**
 * Device-aware middleware that allows authentication via either:
 * 1. User JWT Bearer Token (req.headers.authorization)
 * 2. Permanent Gateway Device Token (req.headers['x-device-token'])
 */
async function authenticateDeviceOrUser(req, res, next) {
  const deviceToken = req.headers['x-device-token'] || 
                     req.headers['device-token'] || 
                     req.query.device_token || 
                     req.query.token;

  if (deviceToken) {
    req.deviceToken = deviceToken;
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer dev_')) {
    req.deviceToken = authHeader.substring(7);
    return next();
  }

  // Fall back to standard JWT user token verification
  return authenticateToken(req, res, next);
}

// 1-Time Setup: Admin/Manager registers the PC as a permanent Restaurant Print Gateway Device
router.post('/register-device', authenticateToken, AgentController.registerDevice);

// Permanent background polling, ACK, and heartbeat routes (Device-authenticated)
router.get('/print-jobs/poll', authenticateDeviceOrUser, AgentController.getPendingJobs);
router.get('/printers', authenticateDeviceOrUser, AgentController.getPrinters);
router.get('/devices', authenticateToken, AgentController.getDevices);
router.post('/print-jobs/ack', authenticateDeviceOrUser, AgentController.acknowledgeJob);
router.post('/heartbeat', authenticateDeviceOrUser, AgentController.sendHeartbeat);

module.exports = router;
