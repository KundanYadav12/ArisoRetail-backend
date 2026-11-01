const express = require('express');
const router = express.Router();
const SyncController = require('../controllers/sync_controller');
const { authenticateToken, enforceTenantScope } = require('../middlewares/auth_middleware');

router.use(authenticateToken);
router.use(enforceTenantScope);

router.post('/upward', SyncController.ingestUpwardSync);
router.get('/downward', SyncController.serveDownwardSync);

module.exports = router;
