/**
 * Subdomain Validator
 * 
 * Validates merchant custom subdomains:
 * - Length: 3 - 50 characters
 * - Characters: lowercase a-z, 0-9, and single hyphens
 * - Cannot start or end with a hyphen
 * - Cannot be a reserved domain name
 */

const RESERVED_SUBDOMAINS = new Set([
  'api',
  'admin',
  'superadmin',
  'app',
  'www',
  'mail',
  'pos',
  'retail',
  'root',
  'support',
  'billing',
  'dashboard',
  'static',
  'assets',
  'cdn',
  'test',
  'demo',
  'staging',
  'dev',
  'beta',
  'auth',
  'login',
  'portal',
  'store',
  'shop',
  'arisoretail',
  'arisopos',
  'ariso',
  'system',
  'help',
  'docs',
  'webhook',
  'payment',
  'payments',
  'checkout',
  'cart'
]);

function validateSubdomain(rawSubdomain) {
  if (!rawSubdomain || typeof rawSubdomain !== 'string') {
    return { valid: false, error: 'Subdomain is required.' };
  }

  const subdomain = rawSubdomain.trim().toLowerCase();

  if (subdomain.length < 3) {
    return { valid: false, error: 'Subdomain must be at least 3 characters long.' };
  }

  if (subdomain.length > 50) {
    return { valid: false, error: 'Subdomain cannot exceed 50 characters.' };
  }

  // Must only contain a-z, 0-9, and hyphens
  const validPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!validPattern.test(subdomain)) {
    return {
      valid: false,
      error: 'Subdomain can only contain lowercase alphanumeric characters and hyphens, and cannot start or end with a hyphen.'
    };
  }

  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return {
      valid: false,
      error: `"${subdomain}" is a reserved system subdomain and cannot be assigned to a merchant.`
    };
  }

  return { valid: true, error: null, subdomain };
}

module.exports = {
  validateSubdomain,
  RESERVED_SUBDOMAINS
};
