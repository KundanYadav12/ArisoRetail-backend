const express = require('express');
const router = express.Router();
const StorefrontPublicController = require('../controllers/storefront_public_controller');
const { apiLimiter } = require('../middlewares/rate_limiter_middleware');

// Apply public rate limiting to prevent scraping & abuse
router.use(apiLimiter);

// Store resolution
router.get('/resolve', StorefrontPublicController.resolveStore);
router.get('/resolve/:subdomain', StorefrontPublicController.resolveStore);

// Store Catalog & Product Details
router.get('/:subdomain/catalog', StorefrontPublicController.getCatalog);
router.get('/:subdomain/product/:id', StorefrontPublicController.getProduct);

// Cart Revalidation & Checkout
router.post('/:subdomain/cart/validate', StorefrontPublicController.validateCart);
router.post('/:subdomain/checkout', StorefrontPublicController.checkout);
router.post('/:subdomain/verify-payment', StorefrontPublicController.verifyPayment);

// Customer Order Status Tracking
router.get('/:subdomain/order-status/:orderNumber', StorefrontPublicController.getOrderStatus);

// Payment Gateway Callbacks & Webhooks
router.post('/payment/callback/paytm', StorefrontPublicController.handlePaytmCallback);
router.all('/payment/callback/phonepe', StorefrontPublicController.handlePhonePeCallback);
router.post('/payment/webhook/:restaurant_id', StorefrontPublicController.handleWebhook);

module.exports = router;
