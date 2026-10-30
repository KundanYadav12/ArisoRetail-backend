/**
 * Custom Domain Validator & Normalizer
 * 
 * Validates merchant custom domains (e.g., parkashstore.com, nimal.in, sham.store).
 * Normalizes hostnames according to RFC 1035 / RFC 1123 standards.
 */

const RESERVED_DOMAINS = new Set([
  'arisopos.in',
  'arisotechnologies.com',
  'duckdns.org',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'example.com',
  'test.com'
]);

function normalizeDomain(rawDomain) {
  if (!rawDomain || typeof rawDomain !== 'string') return '';
  let d = rawDomain.trim().toLowerCase();

  // Strip protocol if mistakenly entered
  d = d.replace(/^[a-z]+:\/\//i, '');
  // Strip trailing slashes and paths
  d = d.split('/')[0];
  // Strip port if present
  d = d.split(':')[0];
  // Strip trailing dot if present
  d = d.replace(/\.$/, '');

  return d;
}

function validateDomain(rawDomain) {
  if (!rawDomain || typeof rawDomain !== 'string') {
    return { valid: false, error: 'Domain name is required.' };
  }

  const domain = normalizeDomain(rawDomain);

  if (!domain) {
    return { valid: false, error: 'Domain name cannot be empty.' };
  }

  if (domain.length < 4) {
    return { valid: false, error: 'Domain name is too short.' };
  }

  if (domain.length > 253) {
    return { valid: false, error: 'Domain name cannot exceed 253 characters.' };
  }

  // Reject IP addresses
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(domain)) {
    return { valid: false, error: 'IP addresses cannot be used as custom domains. Please use a registered domain name.' };
  }

  // Check valid hostname syntax (labels separated by dots)
  const fqdnPattern = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  if (!fqdnPattern.test(domain)) {
    return {
      valid: false,
      error: 'Invalid domain format. Enter a valid domain such as "parkashstore.com" or "nimal.in".'
    };
  }

  // Check reserved domains / subdomains of reserved platform domains
  for (const reserved of RESERVED_DOMAINS) {
    if (domain === reserved || domain.endsWith('.' + reserved)) {
      return {
        valid: false,
        error: `"${domain}" is a platform system domain and cannot be registered as a custom merchant domain.`
      };
    }
  }

  // Detect if domain starts with www. and extract apex
  const isWww = domain.startsWith('www.');
  const apexDomain = isWww ? domain.slice(4) : domain;

  return {
    valid: true,
    error: null,
    domain: apexDomain,
    isWww
  };
}

module.exports = {
  normalizeDomain,
  validateDomain,
  validateCustomDomain: validateDomain,
  RESERVED_DOMAINS
};
