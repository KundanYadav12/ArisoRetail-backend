const express = require('express');
const router = express.Router();
const StorefrontMerchantController = require('../controllers/storefront_merchant_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

// Merchant staff authentication
router.use(authenticateToken);
router.use(authorizeRoles('admin', 'manager', 'owner', 'super_admin', 'superadmin'));

// Store profile & delivery settings
router.get('/settings', StorefrontMerchantController.getSettings);
router.put('/settings', StorefrontMerchantController.updateSettings);

// Payment configuration
router.get('/payment-settings', StorefrontMerchantController.getPaymentSettings);
router.put('/payment-settings', StorefrontMerchantController.updatePaymentSettings);

// Online products visibility & pricing
router.get('/products', StorefrontMerchantController.getProducts);
router.put('/products/:id', StorefrontMerchantController.updateProduct);
router.post('/products/bulk-toggle', StorefrontMerchantController.bulkUpdateProducts);

// Online Orders management
router.get('/orders', StorefrontMerchantController.getOrders);
router.get('/orders/:id', StorefrontMerchantController.getOrderById);
router.put('/orders/:id/status', StorefrontMerchantController.updateOrderStatus);

// Store QR code & share link
router.get('/qr-code', StorefrontMerchantController.getQrCode);

module.exports = router;
