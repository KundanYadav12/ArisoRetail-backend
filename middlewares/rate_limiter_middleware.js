const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt_config');

/**
 * Key Generator for Multi-Tenant Rate Limiting Isolation
 * Differentiates requests by Tenant (restaurant_id) and User ID.
 * One restaurant's high request volume will NEVER exhaust or affect another restaurant's limit.
 */
function getTenantUserKey(req) {
  // 1. If user is authenticated via auth_middleware
  if (req.user) {
    if (req.user.role === 'super_admin') {
      return `superadmin_${req.user.id}`;
    }
    if (req.user.restaurant_id) {
      return `tenant_${req.user.restaurant_id}_user_${req.user.id || 'anon'}`;
    }
  }

  // 2. Parse Authorization header if auth_middleware hasn't executed yet
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7).trim();
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role === 'super_admin') {
        return `superadmin_${decoded.id}`;
      }
      if (decoded && decoded.restaurant_id) {
        return `tenant_${decoded.restaurant_id}_user_${decoded.id || 'anon'}`;
      }
    } catch (e) {
      // Invalid/expired token, fallback to client IP
    }
  }

  // 3. Unauthenticated client - extract clean client IP
  let clientIp = '127.0.0.1';
  if (req.headers['x-forwarded-for']) {
    clientIp = req.headers['x-forwarded-for'].split(',')[0].trim();
  } else if (req.ip) {
    clientIp = req.ip;
  } else if (req.socket && req.socket.remoteAddress) {
    clientIp = req.socket.remoteAddress;
  }

  return `ip_${clientIp}`;
}

/**
 * Standard API Rate Limiter
 * High cap per Tenant/User (1200 requests / 15 mins).
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  keyGenerator: getTenantUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Exempt health check, token refresh, and theme config from data rate limiters
    const path = req.path || req.originalUrl || '';
    return path.includes('/api/health') ||
           path.includes('/api/auth/refresh') ||
           path.includes('/api/theme/config');
  },
  handler: (req, res) => {
    const key = getTenantUserKey(req);
    console.warn(`[RateLimit Warning] Limit exceeded for key: ${key} on route ${req.originalUrl}`);
    return res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded for your account/IP. Please wait a few minutes before trying again.'
    });
  }
});

/**
 * Auth & Login Rate Limiter (Protects against brute force logins)
 * 30 attempts per 15 minutes per Client IP / User.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => {
    let clientIp = '127.0.0.1';
    if (req.headers['x-forwarded-for']) {
      clientIp = req.headers['x-forwarded-for'].split(',')[0].trim();
    } else if (req.ip) {
      clientIp = req.ip;
    }
    const identifier = req.body.email || req.body.username || '';
    return `auth_${clientIp}_${identifier.trim().toLowerCase()}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`[Auth RateLimit Warning] Too many login attempts for ${req.body.email || req.body.username || req.ip}`);
    return res.status(429).json({
      error: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Too many authentication attempts. Please wait 15 minutes before logging in again.'
    });
  }
});

/**
 * Bulk Operations Rate Limiter
 * Dedicated rate limiter for bulk operations (save/delete/import).
 * 60 operations per 15 minutes per Tenant.
 */
const bulkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: getTenantUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({
      error: 'BULK_RATE_LIMIT_EXCEEDED',
      message: 'Too many bulk operations executed in a short period. Please wait a few minutes.'
    });
  }
});

module.exports = {
  getTenantUserKey,
  apiLimiter,
  authLimiter,
  bulkLimiter
};
