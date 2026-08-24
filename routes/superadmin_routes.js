const express = require('express');
const SuperAdminController = require('../controllers/superadmin_controller');
const ThemeController = require('../controllers/theme_controller');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const router = express.Router();

router.use(authenticateToken, authorizeRoles('super_admin', 'superadmin'));

router.get('/dashboard', SuperAdminController.getDashboard);
router.get('/restaurants', SuperAdminController.getRestaurants);
router.post('/restaurants', SuperAdminController.createRestaurant);
router.put('/restaurants/:id', SuperAdminController.updateRestaurant);
router.delete('/restaurants/:id', SuperAdminController.deleteRestaurant);
router.post('/restaurants/:id/resend-otp', SuperAdminController.resendOwnerOTP);
router.post('/restaurants/:id/renew', SuperAdminController.renewSubscription);
router.put('/restaurants/:id/status', SuperAdminController.toggleStatus);
router.get('/plans', SuperAdminController.getSubscriptionPlans);
router.get('/logs', SuperAdminController.getLogs);

// Global Theme Management Routes (Super Admin Only)
router.put('/theme', ThemeController.updateTheme);
router.post('/theme/reset', ThemeController.resetTheme);

// Google AI Configuration Routes (Super Admin Only)
router.get('/ai-config', SuperAdminController.getAiConfig);
router.put('/ai-config', SuperAdminController.updateAiConfig);
router.post('/ai-config/test', SuperAdminController.testAiConnection);

module.exports = router;
