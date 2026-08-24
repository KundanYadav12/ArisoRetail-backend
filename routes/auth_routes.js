const express = require('express');
const AuthController = require('../controllers/auth_controller');
const { authenticateToken, optionalAuthenticateToken } = require('../middlewares/auth_middleware');
const router = express.Router();

router.post('/login', AuthController.login);
router.post('/logout', optionalAuthenticateToken, AuthController.logout);
router.post('/refresh', AuthController.refreshToken);
router.get('/me', authenticateToken, AuthController.getMe);

// OTP & Account Activation / Forgot Password Routes
router.post('/send-otp', AuthController.sendOTP);
router.post('/forgot-password', AuthController.sendOTP);
router.post('/verify-otp', AuthController.verifyOTP);
router.post('/activate-password', AuthController.activatePassword);
router.post('/reset-password', AuthController.activatePassword);
router.post('/change-password', authenticateToken, AuthController.changePassword);

// Staff User Management Routes
router.get('/users', authenticateToken, AuthController.getUsers);
router.post('/users', authenticateToken, AuthController.createUser);
router.put('/users/:id', authenticateToken, AuthController.updateUser);
router.delete('/users/:id', authenticateToken, AuthController.deleteUser);

module.exports = router;
