const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const UserRepository = require('../repositories/user_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const OTPService = require('../services/otp_service');

const { JWT_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRY, JWT_REFRESH_EXPIRY } = require('../config/jwt_config');

class AuthController {
  static async login(req, res) {
    const emailInput = (req.body.email || req.body.username || '').trim().toLowerCase();
    const { password, starting_cash, device } = req.body;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    if (!emailInput || !password) {
      return res.status(400).json({ error: 'Email address/username and password are required.' });
    }

    try {
      // Authenticate by registered email address OR username
      const user = await UserRepository.findByEmailOrUsername(emailInput);

      if (!user) {
        return res.status(401).json({ error: 'Invalid email address/username or password.' });
      }

      if (!user.is_active) {
        return res.status(403).json({ error: 'Account is pending activation or deactivated. Please complete OTP verification.' });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid email address/username or password.' });
      }

      let activeShiftId = null;
      try {
        const isShiftRole = ['cashier', 'admin', 'manager', 'owner'].includes((user.role || '').toLowerCase());
        if (isShiftRole && user.restaurant_id) {
          let shift = await UserRepository.getOpenShift(user.restaurant_id, user.id);
          if (!shift) {
            activeShiftId = await UserRepository.openShift(user.restaurant_id, user.id, {
              device: device || 'Web Browser',
              ip_address: ipAddress,
              starting_cash: parseFloat(starting_cash || 0)
            });
            await SuperAdminRepository.addAuditLog(user.restaurant_id, user.id, 'SHIFT_OPEN', `Opened new shift with starting cash Rs. ${starting_cash || 0}`, ipAddress);
          } else {
            activeShiftId = shift.id;
          }
        }
      } catch (shiftErr) {
        // cashier_shifts table optional
      }

      const sessionId = crypto.randomUUID();

      const tokenPayload = {
        id: user.id,
        restaurant_id: user.restaurant_id || 1,
        role: user.role,
        shift_id: activeShiftId,
        session_id: sessionId
      };

      const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      const refreshToken = jwt.sign(tokenPayload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });

      await pool.query('UPDATE users SET active_session_id = ?, last_login_at = NOW() WHERE id = ?', [sessionId, user.id]);
      await SuperAdminRepository.addAuditLog(user.restaurant_id || 1, user.id, 'LOGIN', 'Logged into the system successfully', ipAddress);

      let restInfo = {};
      const targetRestId = user.restaurant_id || 1;
      const [rRows] = await pool.query('SELECT name, logo_url FROM restaurants WHERE id = ?', [targetRestId]);
      if (rRows.length > 0) restInfo = rRows[0];

      return res.json({
        message: 'Login successful',
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: user.role,
          restaurant_id: targetRestId,
          restaurant_name: restInfo.name || user.name || 'Ariso Retail Store',
          restaurant_logo_url: restInfo.logo_url || null,
          shift_id: activeShiftId,
          must_change_password: Boolean(user.must_change_password),
          is_verified: Boolean(user.is_verified)
        }
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: err.message || 'Internal server error during login.' });
    }
  }

  /**
   * Get current authenticated user session & verify active state
   */
  static async getMe(req, res) {
    try {
      const user = await UserRepository.findById(req.user.id);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'User session is inactive or invalid.' });
      }

      const restaurant = user.restaurant_id 
        ? await SuperAdminRepository.getRestaurantById(user.restaurant_id) 
        : null;

      const userProfile = {
        id: user.id,
        restaurant_id: user.restaurant_id,
        restaurant_name: restaurant ? restaurant.name : null,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        must_change_password: Boolean(user.must_change_password),
        is_verified: Boolean(user.is_verified),
        shift_id: req.user.shift_id || null
      };

      return res.json({ user: userProfile });
    } catch (err) {
      console.error('[GetMe Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve current user session.' });
    }
  }

  /**
   * Request OTP verification code
   */
  static async sendOTP(req, res) {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
      console.log('==================================================');
      console.log(`[FORGOT PASSWORD OTP REQUEST] Email: "${cleanEmail}"`);
      const user = await UserRepository.findByEmail(cleanEmail);
      if (!user) {
        console.log(`[FORGOT PASSWORD REJECTED] No account found matching email "${cleanEmail}".`);
        console.log('==================================================');
        return res.status(404).json({ error: 'No account found matching this email address.' });
      }

      if (user.role === 'cashier') {
        console.log(`[FORGOT PASSWORD REJECTED] Cashier self-service reset restricted for "${cleanEmail}".`);
        console.log('==================================================');
        return res.status(400).json({
          error: 'CASHIER_RESET_RESTRICTED',
          message: 'Cashier password resets are managed directly by your Restaurant Admin. Please contact your Restaurant Admin or Manager to reset your password.'
        });
      }

      const restaurant = user && user.restaurant_id ? await SuperAdminRepository.getRestaurantById(user.restaurant_id) : null;

      const result = await OTPService.createAndSendOTP({
        email: cleanEmail,
        ownerName: user.name || 'User',
        restaurantName: restaurant ? restaurant.name : 'Restaurant POS System',
        restaurantId: user.restaurant_id
      });

      console.log(`[FORGOT PASSWORD SUCCESS] OTP generated & sent to "${cleanEmail}" (Role: ${user.role}).`);
      console.log('==================================================');
      return res.json(result);
    } catch (err) {
      console.error(`❌ [FORGOT PASSWORD ERROR] Failed for "${cleanEmail}":`, err.message);
      return res.status(500).json({ error: 'Failed to send OTP verification email.' });
    }
  }

  /**
   * Verify OTP code
   */
  static async verifyOTP(req, res) {
    const { email, otp_code } = req.body;
    if (!email || !otp_code) {
      return res.status(400).json({ error: 'Email and OTP code are required.' });
    }

    try {
      const result = await OTPService.verifyOTP(email, otp_code);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ message: 'OTP verified successfully.', verified: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'OTP verification failed.' });
    }
  }

  /**
   * First-Time Account Activation & Password Setup
   */
  static async activatePassword(req, res) {
    const { email, otp_code, password } = req.body;
    if (!email || !otp_code || !password) {
      return res.status(400).json({ error: 'Email, OTP code, and new password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    try {
      // 1. Verify OTP
      const otpRes = await OTPService.verifyOTP(email, otp_code);
      if (!otpRes.success) {
        return res.status(400).json({ error: otpRes.error });
      }

      // 2. Find user by email
      const user = await UserRepository.findByEmail(email);
      if (!user) {
        return res.status(404).json({ error: 'No user account found matching this email.' });
      }

      // 3. Hash new password and activate user
      const passwordHash = await bcrypt.hash(password, 10);
      await UserRepository.activateUserPassword(user.id, passwordHash);

      // 4. Generate login tokens
      const sessionId = crypto.randomUUID();

      const tokenPayload = {
        id: user.id,
        restaurant_id: user.restaurant_id,
        role: user.role,
        session_id: sessionId
      };

      const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      const refreshToken = jwt.sign(tokenPayload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });

      await pool.query('UPDATE users SET active_session_id = ?, last_login_at = NOW() WHERE id = ?', [sessionId, user.id]);
      await SuperAdminRepository.addAuditLog(user.restaurant_id, user.id, 'ACCOUNT_ACTIVATE', 'Owner account activated via OTP & password set.', req.ip);

      return res.json({
        message: 'Account activated successfully! Logging in...',
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          restaurant_id: user.restaurant_id
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Account activation failed.' });
    }
  }

  /**
   * Add Staff User (Enforces Max User Limits)
   */
  static async createUser(req, res) {
    const { name, username, email, password, role } = req.body;
    const restaurantId = req.user.restaurant_id || req.user.restaurantId;

    if (!name || !name.trim() || !password || !password.trim()) {
      return res.status(400).json({ error: 'Name and Password are required.' });
    }

    const cleanName = name.trim();
    const cleanUsername = (username && username.trim()) ? username.trim() : cleanName.toLowerCase().replace(/\s+/g, '_');
    
    // Auto-fallback email if email was left blank by Admin
    let cleanEmail = (email && email.trim()) ? email.trim().toLowerCase() : `${cleanUsername}@restaurant${restaurantId || 1}.local`;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (role && ['super_admin', 'superadmin'].includes(role.toLowerCase())) {
      return res.status(403).json({
        error: 'FORBIDDEN_ROLE_CREATION',
        message: 'Super Admin accounts cannot be created via web API. Use "npm run create-superadmin" server CLI.'
      });
    }

    try {
      // 1. Check Email Uniqueness (only if explicit email provided)
      if (email && email.trim()) {
        const existingUser = await UserRepository.findByEmail(cleanEmail);
        if (existingUser) {
          return res.status(400).json({ error: 'A user account with this email address already exists.' });
        }
      }

      // 2. Fetch Tenant's Max User Limit
      const restaurant = await SuperAdminRepository.getRestaurantById(restaurantId);
      const currentCount = await UserRepository.getUserCount(restaurantId);
      const maxLimit = restaurant ? (restaurant.max_user_limit || 5) : 5;

      if (currentCount >= maxLimit) {
        return res.status(400).json({
          error: 'MAX_USER_LIMIT_REACHED',
          message: `Maximum user limit (${maxLimit}) reached for your subscription plan. Please upgrade your plan in SuperAdmin to add more staff.`
        });
      }

      // 3. Hash password & create staff
      const userUsername = (username && username.trim()) || cleanEmail.split('@')[0];
      const passwordHash = await bcrypt.hash(password, 10);
      const userId = await UserRepository.create({
        restaurant_id: restaurantId,
        name,
        username: userUsername,
        email: cleanEmail,
        password_hash: passwordHash,
        role: role || 'cashier',
        is_active: 1
      });

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'USER_CREATE', `Created staff user: ${name} (${role})`, req.ip);

      return res.status(201).json({ message: 'Staff user created successfully.', id: userId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create staff user.' });
    }
  }

  static async getUsers(req, res) {
    try {
      const users = await UserRepository.getAllByRestaurant(req.user.restaurant_id);
      return res.json(users);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve staff users.' });
    }
  }

  static async updateUser(req, res) {
    const { name, email, role, is_active, password } = req.body;
    const userId = req.params.id;
    const restaurantId = req.user.restaurant_id;

    if (!name || !role) {
      return res.status(400).json({ error: 'Name and Role are required.' });
    }

    try {
      const updateData = {
        name,
        email: email || null,
        role,
        is_active: is_active !== undefined ? (is_active ? 1 : 0) : 1
      };

      if (password && password.trim().length >= 6) {
        updateData.password_hash = await bcrypt.hash(password.trim(), 10);
      }

      const success = await UserRepository.update(userId, restaurantId, updateData);
      if (!success) {
        return res.status(404).json({ error: 'Staff user not found.' });
      }

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'USER_UPDATE', `Updated staff user: ${name} (${role})`, req.ip);
      return res.json({ message: 'Staff user updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update staff user.' });
    }
  }

  static async deleteUser(req, res) {
    const userId = req.params.id;
    const restaurantId = req.user.restaurant_id;

    if (parseInt(userId) === parseInt(req.user.id)) {
      return res.status(400).json({ error: 'You cannot delete your own active admin account.' });
    }

    try {
      const success = await UserRepository.delete(userId, restaurantId);
      if (!success) {
        return res.status(404).json({ error: 'Staff user not found.' });
      }

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'USER_DELETE', `Deleted staff user ID: ${userId}`, req.ip);
      return res.json({ message: 'Staff user deleted successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete staff user.' });
    }
  }

  static async logout(req, res) {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    try {
      const user = req.user;
      if (user && user.id) {
        await pool.query('UPDATE users SET active_session_id = NULL WHERE id = ?', [user.id]);
      }
      const userRole = (user?.role || '').toLowerCase();
      const isShiftRole = ['cashier', 'admin', 'manager', 'owner'].includes(userRole);
      if (user && isShiftRole && user.restaurant_id) {
        const shift = await UserRepository.getOpenShift(user.restaurant_id, user.id);
        if (shift) {
          await UserRepository.closeShift(shift.id, user.restaurant_id);
          await SuperAdminRepository.addAuditLog(user.restaurant_id, user.id, 'SHIFT_CLOSE', `Closed cashier/staff shift. Collections synced.`, ipAddress);
        }
      }
      return res.json({ message: 'Logout successful' });
    } catch (err) {
      console.error('Logout error:', err);
      return res.json({ message: 'Logout completed' });
    }
  }

  static async refreshToken(req, res) {
    const token = req.body.token || req.body.refreshToken;
    if (!token) {
      return res.status(401).json({ error: 'Refresh token is required.', code: 'REFRESH_TOKEN_REQUIRED' });
    }

    try {
      const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
      const user = await UserRepository.findById(decoded.id);
      if (!user || !user.is_active) {
        return res.status(403).json({ error: 'Invalid user or deactivated account.', code: 'USER_INACTIVE' });
      }

      // Single-Device Login Enforcement on Refresh Token
      if (user.active_session_id && decoded.session_id && user.active_session_id !== decoded.session_id) {
        console.warn(`[Single Device Lock] User ID ${user.id} logged in on another device. Rejecting refresh token.`);
        return res.status(401).json({
          error: 'You have been logged out because your account was logged in from another device.',
          code: 'LOGGED_IN_ELSEWHERE'
        });
      }

      let activeShiftId = decoded.shift_id;
      const refUserRole = (user.role || '').toLowerCase();
      const refIsShiftRole = ['cashier', 'admin', 'manager', 'owner'].includes(refUserRole);
      if (refIsShiftRole && user.restaurant_id) {
        const shift = await UserRepository.getOpenShift(user.restaurant_id, user.id);
        activeShiftId = shift ? shift.id : null;
      }

      const activeSessionId = user.active_session_id || decoded.session_id;

      const tokenPayload = {
        id: user.id,
        restaurant_id: user.restaurant_id,
        role: user.role,
        shift_id: activeShiftId,
        session_id: activeSessionId
      };

      const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      const refreshToken = jwt.sign(tokenPayload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });

      return res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          role: user.role,
          restaurant_id: user.restaurant_id,
          shift_id: activeShiftId
        }
      });
    } catch (err) {
      console.error('Refresh token error:', err.message);
      return res.status(401).json({ error: 'Refresh token is invalid or has expired.', code: 'REFRESH_TOKEN_EXPIRED' });
    }
  }

  /**
   * Forced First-Time or Account Password Change
   */
  static async changePassword(req, res) {
    const { new_password, current_password } = req.body;
    const userId = req.user.id;

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    try {
      const user = await UserRepository.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User account not found.' });
      }

      // If user is not forcing first-time change, verify current password
      if (!user.must_change_password && current_password) {
        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) {
          return res.status(400).json({ error: 'Current password does not match.' });
        }
      }

      const passwordHash = await bcrypt.hash(new_password, 10);
      await UserRepository.changePassword(userId, passwordHash);

      await SuperAdminRepository.addAuditLog(
        user.restaurant_id,
        userId,
        'PASSWORD_CHANGE',
        'Updated account password and cleared must_change_password flag',
        req.ip
      );

      const updatedUser = await UserRepository.findById(userId);

      return res.json({
        message: 'Password updated successfully.',
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          username: updatedUser.username,
          email: updatedUser.email,
          role: updatedUser.role,
          restaurant_id: updatedUser.restaurant_id,
          must_change_password: false,
          is_verified: true
        }
      });
    } catch (err) {
      console.error('Password change error:', err);
      return res.status(500).json({ error: 'Failed to update password.' });
    }
  }
}

module.exports = AuthController;
