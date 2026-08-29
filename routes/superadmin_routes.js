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
router.patch('/restaurants/:id/toggle-superbill', SuperAdminController.toggleSuperBill);
router.patch('/restaurants/:id/toggle-barcode-scanner', SuperAdminController.toggleBarcodeScanner);
router.get('/plans', SuperAdminController.getSubscriptionPlans);
router.get('/logs', SuperAdminController.getLogs);

// Distributor Management Routes
router.get('/distributors', SuperAdminController.getDistributors);
router.post('/distributors', SuperAdminController.createDistributor);
router.put('/distributors/:id', SuperAdminController.updateDistributor);
router.delete('/distributors/:id', SuperAdminController.deleteDistributor);

// License Management Routes
router.get('/licenses', SuperAdminController.getLicenses);
router.post('/licenses/generate', SuperAdminController.generateLicenses);
router.put('/licenses/:id', SuperAdminController.updateLicense);
router.get('/distributors/:id/export-licenses', SuperAdminController.exportDistributorLicenses);

// Global Theme Management Routes (Super Admin Only)
router.put('/theme', ThemeController.updateTheme);
router.post('/theme/reset', ThemeController.resetTheme);

// Google AI Configuration Routes (Super Admin Only)
router.get('/ai-config', SuperAdminController.getAiConfig);
router.put('/ai-config', SuperAdminController.updateAiConfig);
router.post('/ai-config/test', SuperAdminController.testAiConnection);

module.exports = router;
