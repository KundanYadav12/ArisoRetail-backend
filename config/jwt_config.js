require('dotenv').config();

const JWT_SECRET = process.env.ARISO_RETAIL_JWT_SECRET || process.env.JWT_SECRET || 'ariso-retail-isolated-jwt-secret-key-2026-v2';
const JWT_REFRESH_SECRET = process.env.ARISO_RETAIL_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET || 'ariso-retail-isolated-refresh-secret-key-2026-v2';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '30d';

module.exports = {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  JWT_EXPIRY,
  JWT_REFRESH_EXPIRY
};
