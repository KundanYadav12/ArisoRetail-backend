const express = require('express');
const router = express.Router();
const SyncController = require('../controllers/sync_controller');
const { authenticateToken } = require('../middlewares/auth_middleware');

router.use(authenticateToken);

router.post('/upward', SyncController.ingestUpwardSync);
router.get('/downward', SyncController.serveDownwardSync);

module.exports = router;
