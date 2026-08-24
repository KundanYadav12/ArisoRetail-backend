const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { JWT_SECRET } = require('../config/jwt_config');

/**
 * Main authentication middleware
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch user details to verify state
    const [rows] = await pool.execute(
      'SELECT u.id, u.restaurant_id, u.name, u.username, u.role, u.is_active, u.active_session_id, r.subscription_status, r.subscription_expires_at, r.name as restaurant_name ' +
      'FROM users u LEFT JOIN restaurants r ON u.restaurant_id = r.id ' +
      'WHERE u.id = ? AND u.is_active = 1',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: 'User is inactive or no longer exists.' });
    }

    const user = rows[0];

    // Single-Device Login Enforcement:
    // If the DB user has an active_session_id AND the token contains a session_id, verify match.
    if (user.active_session_id && decoded.session_id && user.active_session_id !== decoded.session_id) {
      return res.status(401).json({
        error: 'You have been logged out because your account was logged in from another device.',
        code: 'LOGGED_IN_ELSEWHERE'
      });
    }

    // Auto-repair missing active_session_id in DB if token contains session_id
    if (!user.active_session_id && decoded.session_id) {
      pool.query('UPDATE users SET active_session_id = ? WHERE id = ?', [decoded.session_id, user.id]).catch(() => {});
    }

    const userRole = (user.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'superadmin';

    // Check restaurant subscription state (unless user is Super Admin)
    if (!isSuperAdmin) {
      if (!user.restaurant_id) {
        return res.status(403).json({ error: 'User is not mapped to any restaurant tenant.' });
      }

      const now = new Date();
      const expires = user.subscription_expires_at ? new Date(user.subscription_expires_at) : null;

      if (user.subscription_status === 'suspended' || user.subscription_status === 'cancelled') {
        return res.status(403).json({ error: 'Your restaurant tenant subscription has been suspended. Contact support.' });
      }

      if (user.subscription_status === 'expired' || (expires && expires < now)) {
        return res.status(403).json({ error: 'Your restaurant tenant subscription has expired. Please renew.' });
      }
    }

    // Attach user information to request
    req.user = {
      id: user.id,
      restaurant_id: user.restaurant_id || 1,
      restaurant_name: user.restaurant_name || 'Ariso Retail Store',
      name: user.name,
      username: user.username,
      role: user.role,
      shift_id: decoded.shift_id
    };

    next();
  } catch (err) {
    if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      console.warn('[JWT Auth Middleware]', err.message);
    }
    return res.status(401).json({ error: 'Token is invalid or has expired.', code: 'TOKEN_EXPIRED' });
  }
}

/**
 * Optional authentication middleware (decodes token if present/valid, but does not block on expiration)
 */
function optionalAuthenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    try {
      const decoded = jwt.decode(token);
      req.user = decoded;
    } catch (dErr) {
      req.user = null;
    }
  }
  next();
}

/**
 * Flexible Role checking helper middleware
 */
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated.' });
    }

    const userRole = (req.user.role || '').toLowerCase();
    const isAllowed = allowedRoles.some(r => {
      const cleanRole = r.toLowerCase();
      if (cleanRole === 'super_admin' || cleanRole === 'superadmin') {
        return userRole === 'super_admin' || userRole === 'superadmin';
      }
      return userRole === cleanRole;
    });

    if (!isAllowed) {
      return res.status(403).json({ error: `Unauthorized. Role '${req.user.role}' does not have permission.` });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  optionalAuthenticateToken,
  authorizeRoles
};
