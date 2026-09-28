const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { JWT_SECRET } = require('../config/jwt_config');
const { DEFAULT_WAREHOUSE_MANAGER_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } = require('../config/permissions_config');

/**
 * Main authentication middleware
 */
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Fetch user details to verify state
    const [rows] = await pool.execute(
      'SELECT u.id, u.restaurant_id, u.name, u.username, u.role, u.assigned_warehouse_id, u.permissions, u.is_active, u.active_session_id, r.subscription_status, r.subscription_expires_at, r.name as restaurant_name, r.feature_serial_numbers ' +
      'FROM users u LEFT JOIN restaurants r ON u.restaurant_id = r.id ' +
      'WHERE u.id = ? AND u.is_active = 1',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: 'User is inactive or no longer exists.' });
    }

    const user = rows[0];

    const userRole = (user.role || '').toLowerCase();
    const isSuperAdmin = userRole === 'super_admin' || userRole === 'superadmin';

    // Single-Device Login Enforcement:
    // If the DB user has an active_session_id AND token contains session_id, verify match (exempt SuperAdmin).
    if (!isSuperAdmin && user.active_session_id && decoded.session_id && user.active_session_id !== decoded.session_id) {
      return res.status(401).json({
        error: 'You have been logged out because your account was logged in from another device.',
        code: 'LOGGED_IN_ELSEWHERE'
      });
    }

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

    // Parse user permissions
    let parsedPermissions = [];
    if (user.permissions) {
      try {
        parsedPermissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions;
      } catch {
        parsedPermissions = [];
      }
    } else {
      parsedPermissions = ROLE_DEFAULT_PERMISSIONS[userRole] || (userRole === 'warehouse_manager' ? DEFAULT_WAREHOUSE_MANAGER_PERMISSIONS : []);
    }

    // Attach user information to request
    req.user = {
      id: user.id,
      restaurant_id: user.restaurant_id || 1,
      restaurant_name: user.restaurant_name || 'Ariso Retail Store',
      name: user.name,
      username: user.username,
      role: user.role,
      assigned_warehouse_id: user.assigned_warehouse_id || null,
      permissions: Array.isArray(parsedPermissions) ? parsedPermissions : [],
      feature_serial_numbers: user.feature_serial_numbers !== undefined ? Boolean(user.feature_serial_numbers) : true,
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

/**
 * Granular Permission checking middleware
 * Checks if current user possesses the required permission.
 * Superadmins and unrestricted admins are granted full access.
 */
function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated.' });
    }

    const role = (req.user.role || '').toLowerCase();
    // Super admin always bypasses granular sub-checks
    if (['super_admin', 'superadmin'].includes(role)) {
      return next();
    }

    // Unrestricted admin / owner bypass if permissions array is not restricting them
    if (['admin', 'owner'].includes(role) && (!req.user.permissions || req.user.permissions.length === 0)) {
      return next();
    }

    const permissions = Array.isArray(req.user.permissions) && req.user.permissions.length > 0
      ? req.user.permissions
      : (ROLE_DEFAULT_PERMISSIONS[role] || []);

    // User possesses 'all' wildcard permission or the exact permissionKey
    if (permissions.includes('all') || permissions.includes(permissionKey)) {
      return next();
    }

    // Umbrella / Alias permissions:
    if (permissionKey === 'inventory_catalog' && permissions.includes('inventory')) {
      return next();
    }
    if (permissionKey === 'inventory' && permissions.includes('inventory_catalog')) {
      return next();
    }
    if (permissionKey === 'warehouse_reports' && permissions.includes('item_sales_report')) {
      return next();
    }
    if (permissionKey === 'item_sales_report' && permissions.includes('warehouse_reports')) {
      return next();
    }
    if (permissionKey === 'bank_accounts' && permissions.includes('finance_accounts')) {
      return next();
    }
    if (permissionKey === 'finance_accounts' && permissions.includes('bank_accounts')) {
      return next();
    }

    return res.status(403).json({
      error: `Access Denied: Missing permission '${permissionKey}'. Contact your Administrator.`
    });
  };
}

/**
 * Enforces warehouse isolation for any user with assigned_warehouse_id
 */
function enforceWarehouseScope(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated.' });
  }

  const role = (req.user.role || '').toLowerCase();
  if (['super_admin', 'superadmin'].includes(role)) {
    return next();
  }

  if (req.user.assigned_warehouse_id) {
    const assignedWhId = parseInt(req.user.assigned_warehouse_id, 10);

    // If request explicitly targets a different warehouse, reject it
    if (req.body && req.body.warehouse_id && parseInt(req.body.warehouse_id, 10) !== assignedWhId) {
      return res.status(403).json({ error: 'Access denied: User is restricted to their assigned warehouse / store.' });
    }
    if (req.query && req.query.warehouse_id && req.query.warehouse_id !== 'all' && parseInt(req.query.warehouse_id, 10) !== assignedWhId) {
      return res.status(403).json({ error: 'Access denied: User is restricted to their assigned warehouse / store.' });
    }

    // Transfers: Ensure at least one side is the assigned warehouse
    if (req.body && (req.body.from_warehouse_id || req.body.to_warehouse_id)) {
      const fromId = req.body.from_warehouse_id ? parseInt(req.body.from_warehouse_id, 10) : null;
      const toId = req.body.to_warehouse_id ? parseInt(req.body.to_warehouse_id, 10) : null;
      if (fromId && toId && fromId !== assignedWhId && toId !== assignedWhId) {
        return res.status(403).json({ error: 'Access denied: Stock transfer must involve your assigned warehouse.' });
      }
    }

    if (req.query && (!req.query.warehouse_id || req.query.warehouse_id === 'all')) {
      req.query.warehouse_id = assignedWhId;
    }
    if (req.body && !req.body.warehouse_id) {
      req.body.warehouse_id = assignedWhId;
    }
  }

  next();
}

/**
 * Super Admin Permission middleware
 * Only superadmin role OR accounts explicitly granted this specific permission can access.
 */
function requireSuperAdminOrPermission(permissionKey = 'serial_numbers') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthenticated.' });
    }

    const role = (req.user.role || '').toLowerCase();
    // Super admin role always has access
    if (['super_admin', 'superadmin'].includes(role)) {
      return next();
    }

    // Check store-level feature permission if key is serial_numbers
    if (permissionKey === 'serial_numbers' && req.user.feature_serial_numbers === false) {
      return res.status(403).json({
        error: "Access Denied: Product Serial Number Tracking is disabled for this store by Super Administrator."
      });
    }

    // Explicitly granted permission by Super Admin / Tenant Admin
    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (role === 'admin' || permissions.includes(permissionKey) || permissions.includes('all')) {
      return next();
    }

    return res.status(403).json({
      error: `Access Denied: Product Serial Number Tracking is restricted by Super Admin permission ('${permissionKey}'). Contact your Super Administrator.`
    });
  };
}

module.exports = {
  authenticateToken,
  optionalAuthenticateToken,
  authorizeRoles,
  requirePermission,
  requireSuperAdminOrPermission,
  enforceWarehouseScope
};


