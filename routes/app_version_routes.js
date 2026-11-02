const express = require('express');
const router = express.Router();
const AppVersionController = require('../controllers/app_version_controller');
const packageUpload = require('../middlewares/package_upload_middleware');
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');

// Public endpoints for applications (Windows Desktop, Mobile Android/iOS, Web)
router.get('/check', AppVersionController.checkUpdate);
router.get('/download/:id', AppVersionController.downloadPackage);
router.get('/:platform/latest', AppVersionController.getLatestVersion);
router.get('/:platform/latest.yml', AppVersionController.getLatestYml);

// Superadmin protected version management endpoints
const superAdminAuth = [authenticateToken, authorizeRoles('super_admin', 'superadmin')];

router.get('/admin/list', superAdminAuth, AppVersionController.getSuperAdminVersions);
router.post('/admin/create', superAdminAuth, packageUpload.single('package'), AppVersionController.createVersion);
router.put('/admin/:id', superAdminAuth, packageUpload.single('package'), AppVersionController.updateVersion);
router.patch('/admin/:id/publish', superAdminAuth, AppVersionController.togglePublish);
router.patch('/admin/:id/toggle-mandatory', superAdminAuth, AppVersionController.toggleMandatory);
router.patch('/admin/:id/set-latest', superAdminAuth, AppVersionController.setLatestVersion);
router.delete('/admin/:id', superAdminAuth, AppVersionController.deleteVersion);

module.exports = router;
