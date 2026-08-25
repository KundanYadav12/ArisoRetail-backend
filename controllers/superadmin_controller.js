const SuperAdminRepository = require('../repositories/superadmin_repository');
const UserRepository = require('../repositories/user_repository');
const OTPService = require('../services/otp_service');
const bcrypt = require('bcryptjs');

class SuperAdminController {
  static async getDashboard(req, res) {
    try {
      const stats = await SuperAdminRepository.getPlatformStats();
      return res.json(stats);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to fetch platform metrics.' });
    }
  }

  static async getRestaurants(req, res) {
    try {
      const restaurants = await SuperAdminRepository.getAllRestaurants();
      return res.json(restaurants);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve tenants.' });
    }
  }

  static async getSubscriptionPlans(req, res) {
    try {
      const plans = await SuperAdminRepository.getAllSubscriptionPlans();
      return res.json(plans);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve subscription plans.' });
    }
  }

  /**
   * Provision New Tenant & Send Hashed OTP Verification Email to Owner
   */
  static async createRestaurant(req, res) {
    const {
      name, domain, logo_url, address, phone, email, gst_number,
      owner_name, owner_email, owner_mobile,
      subscription_plan_id, duration_months, max_user_limit, max_manager_limit, max_cashier_limit,
      admin_username, admin_password
    } = req.body;

    const targetEmail = owner_email || email;
    const targetOwnerName = owner_name || `${name} Owner`;

    if (!name || !targetEmail) {
      return res.status(400).json({ error: 'Restaurant Name and Owner Email are required.' });
    }

    try {
      // 1. Create Restaurant Record
      const restaurantId = await SuperAdminRepository.createRestaurant({
        name, domain, logo_url, address, phone, email: targetEmail,
        owner_name: targetOwnerName, owner_email: targetEmail, owner_mobile: owner_mobile || phone,
        gst_number, subscription_plan_id: subscription_plan_id || 1,
        duration_months: duration_months || 12,
        max_user_limit: max_user_limit || 5,
        max_manager_limit: max_manager_limit || 2,
        max_cashier_limit: max_cashier_limit || 3,
        subscription_status: 'active'
      });

      // 2. Provision Owner User Account in Pending Activation State (unless password is explicitly specified)
      const username = admin_username || targetEmail.split('@')[0] || `admin_${restaurantId}`;
      const passwordHash = admin_password ? await bcrypt.hash(admin_password, 10) : 'PENDING_OTP_ACTIVATION';
      
      const userId = await UserRepository.create({
        restaurant_id: restaurantId,
        name: targetOwnerName,
        username,
        email: targetEmail,
        password_hash: passwordHash,
        role: 'admin',
        is_active: admin_password ? 1 : 0
      });

      // 3. Dispatch OTP Email Notification
      await OTPService.createAndSendOTP({
        email: targetEmail,
        ownerName: targetOwnerName,
        restaurantName: name,
        restaurantId
      });

      await SuperAdminRepository.addAuditLog(
        restaurantId,
        req.user.id,
        'RESTAURANT_CREATED',
        `Restaurant '${name}' created by Super Admin (ID: ${restaurantId}) & dispatched OTP invitation to ${targetEmail}`,
        req.ip,
        {
          user_name: req.user.name || 'Super Admin',
          user_role: req.user.role || 'super_admin',
          prev_name: null,
          new_name: name,
          prev_logo: null,
          new_logo: logo_url || null
        }
      );

      return res.status(201).json({
        message: `Tenant created successfully. Verification OTP dispatched to ${targetEmail}.`,
        restaurantId,
        ownerUserId: userId,
        ownerEmail: targetEmail
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to provision restaurant tenant.' });
    }
  }

  static async updateRestaurant(req, res) {
    const {
      name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile,
      gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit,
      subscription_status, subscription_expires_at
    } = req.body;
    const restaurantId = req.params.id;

    try {
      const existingRest = await SuperAdminRepository.getRestaurantById(restaurantId);
      const prevName = existingRest?.name || null;
      const prevLogo = existingRest?.logo_url || null;

      const success = await SuperAdminRepository.updateRestaurant(restaurantId, {
        name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile,
        gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit,
        subscription_status, subscription_expires_at
      });

      if (!success) {
        return res.status(404).json({ error: 'Restaurant not found.' });
      }

      if ((name && name !== prevName) || (logo_url !== undefined && logo_url !== prevLogo)) {
        await SuperAdminRepository.addAuditLog(
          restaurantId,
          req.user.id,
          'RESTAURANT_PROFILE_UPDATED',
          `Restaurant Profile updated. Name: '${prevName}' -> '${name || prevName}'`,
          req.ip,
          {
            user_name: req.user.name || 'Super Admin',
            user_role: req.user.role || 'super_admin',
            prev_name: prevName,
            new_name: name || prevName,
            prev_logo: prevLogo,
            new_logo: logo_url !== undefined ? logo_url : prevLogo
          }
        );
      } else {
        await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'TENANT_UPDATE', `Updated settings for Restaurant ID: ${restaurantId}`, req.ip);
      }

      return res.json({ message: 'Restaurant updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update restaurant.' });
    }
  }

  /**
   * Renew / Extend Subscription
   */
  static async renewSubscription(req, res) {
    const { duration_months, custom_expiry_date } = req.body;
    const restaurantId = req.params.id;

    try {
      const success = await SuperAdminRepository.renewSubscription(restaurantId, duration_months, custom_expiry_date);
      if (!success) {
        return res.status(404).json({ error: 'Restaurant not found.' });
      }

      await SuperAdminRepository.addAuditLog(null, req.user.id, 'TENANT_RENEW', `Renewed subscription for Restaurant ID ${restaurantId} (+${duration_months || 'custom'} months)`, req.ip);
      return res.json({ message: 'Subscription renewed and tenant reactivated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to renew subscription.' });
    }
  }

  static async toggleStatus(req, res) {
    const { status } = req.body;
    const restaurantId = req.params.id;

    if (!['active', 'suspended', 'expired', 'trial', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid subscription status.' });
    }

    try {
      const success = await SuperAdminRepository.setSubscriptionStatus(restaurantId, status);
      if (!success) {
        return res.status(404).json({ error: 'Restaurant not found.' });
      }

      await SuperAdminRepository.addAuditLog(null, req.user.id, 'TENANT_STATUS_TOGGLE', `Updated subscription status of Restaurant ID ${restaurantId} to: ${status}`, req.ip);
      return res.json({ message: `Restaurant subscription status changed to ${status}.` });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to alter subscription status.' });
    }
  }

  static async deleteRestaurant(req, res) {
    const restaurantId = req.params.id;
    try {
      const restaurant = await SuperAdminRepository.getRestaurantById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant tenant not found.' });
      }

      const success = await SuperAdminRepository.deleteRestaurant(restaurantId);
      if (!success) {
        return res.status(400).json({ error: 'Failed to delete restaurant tenant.' });
      }

      await SuperAdminRepository.addAuditLog(null, req.user.id, 'TENANT_DELETE', `Deleted restaurant tenant "${restaurant.name}" (ID: ${restaurantId})`, req.ip);
      return res.json({ message: `Restaurant "${restaurant.name}" deleted successfully.` });
    } catch (err) {
      console.error('Delete restaurant error:', err);
      return res.status(500).json({ error: 'Failed to delete restaurant tenant.' });
    }
  }

  static async resendOwnerOTP(req, res) {
    const restaurantId = req.params.id;
    try {
      const restaurant = await SuperAdminRepository.getRestaurantById(restaurantId);
      if (!restaurant) {
        return res.status(404).json({ error: 'Restaurant tenant not found.' });
      }

      const targetEmail = restaurant.owner_email || restaurant.email;
      if (!targetEmail) {
        return res.status(400).json({ error: 'No owner email address associated with this restaurant.' });
      }

      await OTPService.createAndSendOTP({
        email: targetEmail,
        ownerName: restaurant.owner_name || `${restaurant.name} Owner`,
        restaurantName: restaurant.name,
        restaurantId
      });

      await SuperAdminRepository.addAuditLog(null, req.user.id, 'TENANT_RESEND_OTP', `Resent invitation OTP code to ${targetEmail} for restaurant "${restaurant.name}"`, req.ip);
      return res.json({ message: `Verification OTP code successfully resent to ${targetEmail}.` });
    } catch (err) {
      console.error('Resend tenant OTP error:', err);
      return res.status(500).json({ error: 'Failed to resend OTP verification email.' });
    }
  }

  static async getLogs(req, res) {
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;

    try {
      const logs = await SuperAdminRepository.getGlobalAuditLogs(limit, offset);
      return res.json(logs);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve logs.' });
    }
  }

  /**
   * Get Google AI Studio Gemini Configuration (Masked for Security)
   */
  static async getAiConfig(req, res) {
    try {
      const AiConfigRepository = require('../repositories/ai_config_repository');
      const config = await AiConfigRepository.getMaskedConfig();
      return res.json(config);
    } catch (err) {
      console.error('[SuperAdminController.getAiConfig Error]', err);
      return res.status(500).json({ error: 'Failed to retrieve AI configuration.' });
    }
  }

  /**
   * Update Google AI Studio Gemini Configuration
   */
  static async updateAiConfig(req, res) {
    const { api_key, model_name, is_enabled } = req.body;
    try {
      const AiConfigRepository = require('../repositories/ai_config_repository');
      const updatedConfig = await AiConfigRepository.updateConfig({ api_key, model_name, is_enabled });

      await SuperAdminRepository.addAuditLog(
        null,
        req.user.id,
        'AI_CONFIG_UPDATE',
        `Updated Google Gemini AI settings (Model: ${model_name || 'gemini-2.5-flash'}, Enabled: ${is_enabled ? 'Yes' : 'No'})`,
        req.ip
      );

      return res.json({
        message: 'Google Gemini AI configuration updated successfully.',
        config: updatedConfig
      });
    } catch (err) {
      console.error('[SuperAdminController.updateAiConfig Error]', err);
      return res.status(500).json({ error: 'Failed to update AI configuration.' });
    }
  }

  /**
   * Test Google AI Studio Gemini API Connection
   */
  static async testAiConnection(req, res) {
    const { api_key } = req.body;
    try {
      const { testGeminiApiKeyConnection } = require('../utils/menu_ai_ocr_helper');
      const result = await testGeminiApiKeyConnection(api_key);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Gemini API connection test failed.' });
    }
  }

  // Distributor CRUD Handlers
  static async getDistributors(req, res) {
    try {
      const LicenseRepository = require('../repositories/license_repository');
      const distributors = await LicenseRepository.getAllDistributors();
      return res.json(distributors);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve distributors.' });
    }
  }

  static async createDistributor(req, res) {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Distributor name is required.' });
    }
    try {
      const LicenseRepository = require('../repositories/license_repository');
      const id = await LicenseRepository.createDistributor(name);
      return res.status(201).json({ message: 'Distributor created successfully.', id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create distributor.' });
    }
  }

  static async updateDistributor(req, res) {
    const { name } = req.body;
    const { id } = req.params;
    if (!name) {
      return res.status(400).json({ error: 'Distributor name is required.' });
    }
    try {
      const LicenseRepository = require('../repositories/license_repository');
      const success = await LicenseRepository.updateDistributor(id, name);
      if (!success) return res.status(404).json({ error: 'Distributor not found.' });
      return res.json({ message: 'Distributor updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update distributor.' });
    }
  }

  static async deleteDistributor(req, res) {
    const { id } = req.params;
    try {
      const LicenseRepository = require('../repositories/license_repository');
      const success = await LicenseRepository.deleteDistributor(id);
      if (!success) return res.status(404).json({ error: 'Distributor not found.' });
      return res.json({ message: 'Distributor deleted successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete distributor.' });
    }
  }

  // License Handlers
  static async getLicenses(req, res) {
    const { distributor_id } = req.query;
    try {
      const LicenseRepository = require('../repositories/license_repository');
      const licenses = await LicenseRepository.getAllLicenses(distributor_id);
      return res.json(licenses);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve licenses.' });
    }
  }

  static async generateLicenses(req, res) {
    const { distributor_id, quantity, current_year_pricing, next_year_pricing } = req.body;
    if (!distributor_id || !quantity) {
      return res.status(400).json({ error: 'Distributor ID and Quantity are required.' });
    }
    try {
      const LicenseRepository = require('../repositories/license_repository');
      const codes = await LicenseRepository.generateLicenses(distributor_id, quantity, current_year_pricing, next_year_pricing);
      return res.status(201).json({ message: `Successfully generated ${codes.length} licenses.`, codes });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate licenses.' });
    }
  }

  static async updateLicense(req, res) {
    const { id } = req.params;
    const { current_year_pricing, next_year_pricing } = req.body;

    if (current_year_pricing === undefined || next_year_pricing === undefined) {
      return res.status(400).json({ error: 'Current year and next year pricing are required.' });
    }

    try {
      const LicenseRepository = require('../repositories/license_repository');
      const success = await LicenseRepository.updateLicensePricing(id, parseFloat(current_year_pricing), parseFloat(next_year_pricing));
      if (!success) {
        return res.status(400).json({ error: 'License pricing could not be updated. Ensure the license exists and is still AVAILABLE.' });
      }
      return res.json({ message: 'License pricing updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update license pricing.' });
    }
  }

  static async exportDistributorLicenses(req, res) {
    const { id } = req.params;
    try {
      const LicenseRepository = require('../repositories/license_repository');
      const distributor = await LicenseRepository.getDistributorById(id);
      if (!distributor) {
        return res.status(404).json({ error: 'Distributor not found.' });
      }

      const licenses = await LicenseRepository.getAllLicenses(id);
      const { generateExcelWorkbook } = require('../utils/excel_helper');

      const columns = [
        { header: 'Distributor Name', key: 'distributor_name', width: 22 },
        { header: 'License ID', key: 'license_code', width: 18 },
        { header: 'License Status', key: 'status', width: 14 },
        { header: 'Generated Date', key: 'generated_date', width: 20 },
        { header: 'Activation Date', key: 'activated_date', width: 20 },
        { header: 'Store Name', key: 'store_name', width: 22 },
        { header: 'User Name', key: 'owner_name', width: 18 },
        { header: 'Email', key: 'owner_email', width: 22 },
        { header: 'Phone', key: 'owner_mobile', width: 16 },
        { header: 'Subscription Start Date', key: 'subscription_start_date', width: 20 },
        { header: 'Subscription Expiry Date', key: 'subscription_expiry_date', width: 20 },
        { header: 'Current Year Pricing', key: 'current_year_pricing', width: 18 },
        { header: 'Next Year Pricing', key: 'next_year_pricing', width: 18 }
      ];

      const data = licenses.map(lic => ({
        distributor_name: lic.distributor_name,
        license_code: lic.license_code,
        status: (lic.status || 'AVAILABLE').toUpperCase(),
        generated_date: lic.created_at ? new Date(lic.created_at).toLocaleString() : 'N/A',
        activated_date: lic.activated_at ? new Date(lic.activated_at).toLocaleString() : 'N/A',
        store_name: lic.store_name || 'N/A',
        owner_name: lic.owner_name || 'N/A',
        owner_email: lic.owner_email || 'N/A',
        owner_mobile: lic.owner_mobile || 'N/A',
        subscription_start_date: lic.subscription_start_date ? new Date(lic.subscription_start_date).toLocaleDateString() : 'N/A',
        subscription_expiry_date: lic.subscription_expires_at ? new Date(lic.subscription_expires_at).toLocaleDateString() : 'N/A',
        current_year_pricing: lic.current_year_pricing !== undefined ? parseFloat(lic.current_year_pricing).toFixed(2) : '0.00',
        next_year_pricing: lic.next_year_pricing !== undefined ? parseFloat(lic.next_year_pricing).toFixed(2) : '0.00'
      }));

      const buffer = await generateExcelWorkbook({
        sheetName: 'License Inventory',
        columns,
        data
      });

      const filename = `${distributor.name.replace(/\s+/g, '_')}_Distributor_License_Inventory.xlsx`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buffer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to export license inventory.' });
    }
  }
}

module.exports = SuperAdminController;
