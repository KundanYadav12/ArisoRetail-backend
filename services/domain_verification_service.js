/**
 * Custom Domain Verification & DNS Inspection Service
 * 
 * - Generates authoritative DNS instructions for merchants
 * - Performs real-time DNS resolution checks (A, CNAME, TXT) using Node.js dns.promises
 * - Validates expected server IP and cryptographic verification challenge tokens
 * - Generates production reverse-proxy (Nginx) configuration snippets for custom domains
 */

const dns = require('dns').promises;
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

class DomainVerificationService {
  /**
   * Get server public IP from environment or default
   */
  static getServerPublicIp() {
    return process.env.SERVER_PUBLIC_IP || process.env.PUBLIC_IP || '159.89.168.120';
  }

  /**
   * Generate a unique domain verification token
   */
  static generateVerificationToken() {
    return 'ariso-verify-' + crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate required DNS records instructions for a domain
   */
  static generateExpectedDnsRecords(domain, token, includeWww = true) {
    const serverIp = this.getServerPublicIp();

    const records = [
      {
        type: 'A',
        host: '@',
        fqdn: domain,
        value: serverIp,
        purpose: 'Directs root domain traffic to the Ariso Retail cloud server',
        required: true
      },
      {
        type: 'TXT',
        host: `_ariso-challenge.${domain}`,
        fqdn: `_ariso-challenge.${domain}`,
        value: token,
        purpose: 'Cryptographic ownership verification for Ariso Retail',
        required: true
      }
    ];

    if (includeWww) {
      records.push({
        type: 'CNAME',
        host: 'www',
        fqdn: `www.${domain}`,
        value: domain,
        purpose: 'Aliases www subdomain to your root domain',
        required: false
      });
    }

    return records;
  }

  /**
   * Check DNS configuration of a domain using live DNS lookups
   */
  static async verifyDns(domain, expectedToken, includeWww = true) {
    const serverIp = this.getServerPublicIp();
    const results = {
      domain,
      verified: false,
      timestamp: new Date().toISOString(),
      checks: {
        aRecord: { status: 'pending', actual: [], expected: serverIp },
        txtRecord: { status: 'pending', actual: [], expected: expectedToken },
        wwwRecord: includeWww ? { status: 'pending', actual: [], expected: domain } : null
      },
      error: null
    };

    // 1. Check A record
    try {
      const aAddresses = await dns.resolve4(domain);
      results.checks.aRecord.actual = aAddresses;
      if (aAddresses.includes(serverIp)) {
        results.checks.aRecord.status = 'matched';
      } else if (aAddresses.length > 0) {
        results.checks.aRecord.status = 'mismatched';
        results.checks.aRecord.note = `Points to ${aAddresses.join(', ')} instead of ${serverIp}`;
      } else {
        results.checks.aRecord.status = 'missing';
      }
    } catch (err) {
      results.checks.aRecord.status = 'missing';
      results.checks.aRecord.error = err.code || err.message;
    }

    // 2. Check TXT verification record
    try {
      const challengeHost = `_ariso-challenge.${domain}`;
      let txtRecords = [];
      try {
        txtRecords = await dns.resolveTxt(challengeHost);
      } catch (_) {
        // Fallback: check apex domain for TXT
        try {
          txtRecords = await dns.resolveTxt(domain);
        } catch (__) {}
      }

      const flatTxt = txtRecords.map(r => (Array.isArray(r) ? r.join('') : String(r)));
      results.checks.txtRecord.actual = flatTxt;

      const hasMatchingToken = flatTxt.some(val => val.includes(expectedToken));
      if (hasMatchingToken) {
        results.checks.txtRecord.status = 'matched';
      } else if (flatTxt.length > 0) {
        results.checks.txtRecord.status = 'mismatched';
      } else {
        results.checks.txtRecord.status = 'missing';
      }
    } catch (err) {
      results.checks.txtRecord.status = 'missing';
      results.checks.txtRecord.error = err.code || err.message;
    }

    // 3. Check WWW record (if enabled)
    if (includeWww) {
      const wwwDomain = `www.${domain}`;
      try {
        const cnameRecords = await dns.resolveCname(wwwDomain);
        results.checks.wwwRecord.actual = cnameRecords;
        if (cnameRecords.some(c => c.toLowerCase().includes(domain.toLowerCase()))) {
          results.checks.wwwRecord.status = 'matched';
        } else {
          results.checks.wwwRecord.status = 'mismatched';
        }
      } catch (_) {
        // Alternatively, check if www has an A record pointing to serverIp
        try {
          const wwwAddresses = await dns.resolve4(wwwDomain);
          results.checks.wwwRecord.actual = wwwAddresses;
          if (wwwAddresses.includes(serverIp)) {
            results.checks.wwwRecord.status = 'matched';
          } else {
            results.checks.wwwRecord.status = 'missing';
          }
        } catch (wwwErr) {
          results.checks.wwwRecord.status = 'missing';
          results.checks.wwwRecord.error = wwwErr.code || wwwErr.message;
        }
      }
    }

    // Ownership verification criteria:
    // Either TXT challenge matched OR A record points to our server IP
    const txtPassed = results.checks.txtRecord.status === 'matched';
    const aPassed = results.checks.aRecord.status === 'matched';

    if (txtPassed || aPassed) {
      results.verified = true;
    } else {
      results.verified = false;
      results.error = 'DNS records not yet detected. Ensure you have added the A record or TXT verification record at your domain registrar (e.g. GoDaddy, Namecheap, Cloudflare) and allow time for DNS propagation.';
    }

    return results;
  }

  /**
   * Generate Nginx reverse-proxy configuration snippet for verified custom domains
   */
  static generateNginxConfig(domain, includeWww = true) {
    const serverNames = includeWww ? `${domain} www.${domain}` : domain;
    return `
# Ariso Retail Custom Domain Configuration for: ${domain}
server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${serverNames};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /var/www/ariso-retail/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5004/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:5004/uploads/;
    }
}
`.trim();
  }

  static generateDnsInstructions(domain, token, includeWww = true) {
    const records = this.generateExpectedDnsRecords(domain, token, includeWww);
    return {
      domain,
      verification_token: token,
      include_www: includeWww,
      records
    };
  }

  static async verifyDomain(domain, token, includeWww = true) {
    return await this.verifyDns(domain, token, includeWww);
  }
}

module.exports = DomainVerificationService;
