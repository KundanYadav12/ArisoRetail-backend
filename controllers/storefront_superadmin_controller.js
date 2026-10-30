const StorefrontRepository = require('../repositories/storefront_repository');
const { validateSubdomain } = require('../utils/subdomain_validator');
const pool = require('../config/db');

class StorefrontSuperAdminController {
  /**
   * GET /api/superadmin/merchant-stores
   */
  static async getMerchantStores(req, res) {
    try {
      const stores = await StorefrontRepository.getAllMerchantStores();
      return res.json({ stores });
    } catch (err) {
      console.error('[StorefrontSuperAdminController.getMerchantStores Error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch merchant stores.' });
    }
  }

  /**
   * GET /api/superadmin/merchant-stores/check-subdomain
   */
  static async checkSubdomainAvailability(req, res) {
    try {
      const rawSubdomain = req.query.subdomain;
      const restaurantId = req.query.restaurant_id ? parseInt(req.query.restaurant_id, 10) : null;

      const { valid, error, subdomain } = validateSubdomain(rawSubdomain);
      if (!valid) {
        return res.json({
          available: false,
          reason: error,
          subdomain
        });
      }

      // Check database
      let query = 'SELECT id, name FROM restaurants WHERE LOWER(subdomain) = ?';
      const params = [subdomain];
      if (restaurantId) {
        query += ' AND id != ?';
        params.push(restaurantId);
      }
      query += ' LIMIT 1';

      const [existing] = await pool.execute(query, params);
      if (existing.length > 0) {
        return res.json({
          available: false,
          reason: `Already taken by "${existing[0].name}" (ID #${existing[0].id}).`,
          subdomain
        });
      }

      return res.json({
        available: true,
        subdomain,
        url: `https://${subdomain}.arisopos.in`
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to check subdomain.' });
    }
  }

  /**
   * PUT /api/superadmin/merchant-stores/:id/subdomain
   */
  static async assignSubdomain(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      const { subdomain } = req.body;

      if (!subdomain) {
        return res.status(400).json({ error: 'Subdomain is required.' });
      }

      const result = await StorefrontRepository.assignSubdomain(
        restaurantId,
        subdomain,
        req.user.name || 'SuperAdmin'
      );

      return res.json({
        message: `Subdomain "${result.subdomain}" successfully assigned.`,
        ...result
      });
    } catch (err) {
      console.error('[StorefrontSuperAdminController.assignSubdomain Error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to assign subdomain.' });
    }
  }

  /**
   * PATCH /api/superadmin/merchant-stores/:id/toggle-status
   */
  static async toggleStoreStatus(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      const { enabled } = req.body;

      const newStatus = await StorefrontRepository.toggleStoreStatus(
        restaurantId,
        Boolean(enabled),
        req.user.name || 'SuperAdmin'
      );

      return res.json({
        message: `Storefront has been ${newStatus ? 'ENABLED' : 'DISABLED'}.`,
        online_store_enabled: newStatus
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to toggle store status.' });
    }
  }

  /**
   * GET /api/superadmin/merchant-stores/:id/qr
   */
  static async getStoreQr(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      const qrData = await StorefrontRepository.generateStoreQrCode(restaurantId);
      return res.json(qrData);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to generate store QR code.' });
    }
  }

  /**
   * GET /api/superadmin/merchant-stores/:id/custom-domain
   */
  static async getCustomDomain(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      const customDomain = await StorefrontRepository.getMerchantCustomDomain(restaurantId);
      return res.json({ custom_domain: customDomain });
    } catch (err) {
      console.error('[StorefrontSuperAdminController.getCustomDomain Error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch custom domain.' });
    }
  }

  /**
   * POST /api/superadmin/merchant-stores/:id/custom-domain
   */
  static async assignCustomDomain(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      const { domain, include_www } = req.body;

      if (!domain) {
        return res.status(400).json({ error: 'Domain name is required.' });
      }

      const result = await StorefrontRepository.assignCustomDomain(
        restaurantId,
        { domain, includeWww: include_www !== false },
        req.user?.name || 'SuperAdmin'
      );

      return res.json({
        message: `Custom domain "${result.domain}" assigned successfully. DNS verification is required before activation.`,
        custom_domain: result
      });
    } catch (err) {
      console.error('[StorefrontSuperAdminController.assignCustomDomain Error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to assign custom domain.' });
    }
  }

  /**
   * POST /api/superadmin/merchant-stores/:id/custom-domain/verify
   */
  static async verifyCustomDomain(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      const result = await StorefrontRepository.verifyCustomDomain(
        restaurantId,
        req.user?.name || 'SuperAdmin'
      );

      return res.json({
        verified: result.verified,
        message: result.verified
          ? `Domain "${result.domain.domain}" DNS verification passed and HTTPS status is active!`
          : `Verification failed: ${result.error || 'Required DNS records could not be detected.'}`,
        result
      });
    } catch (err) {
      console.error('[StorefrontSuperAdminController.verifyCustomDomain Error]:', err);
      return res.status(400).json({ error: err.message || 'Verification process failed.' });
    }
  }

  /**
   * PATCH /api/superadmin/merchant-stores/:id/custom-domain/toggle
   */
  static async toggleCustomDomain(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      const { is_active } = req.body;

      const newStatus = await StorefrontRepository.toggleCustomDomainStatus(
        restaurantId,
        Boolean(is_active),
        req.user?.name || 'SuperAdmin'
      );

      return res.json({
        message: `Custom domain status updated to ${newStatus ? 'ACTIVE' : 'INACTIVE'}.`,
        is_active: newStatus
      });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to toggle custom domain.' });
    }
  }

  /**
   * DELETE /api/superadmin/merchant-stores/:id/custom-domain
   */
  static async deleteCustomDomain(req, res) {
    try {
      const restaurantId = parseInt(req.params.id, 10);
      await StorefrontRepository.deleteCustomDomain(
        restaurantId,
        req.user?.name || 'SuperAdmin'
      );

      return res.json({ message: 'Custom domain removed successfully.' });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to remove custom domain.' });
    }
  }
}

module.exports = StorefrontSuperAdminController;
