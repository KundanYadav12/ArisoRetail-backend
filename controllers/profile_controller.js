const pool = require('../config/db');
const SuperAdminRepository = require('../repositories/superadmin_repository');

class ProfileController {
  /**
   * GET /api/settings/profile
   * Fetch current restaurant profile (Multi-tenant)
   */
  static async getProfile(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant ID is required.' });
      }

      const [rows] = await pool.query('SELECT * FROM restaurants WHERE id = ?', [restaurantId]);
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Restaurant not found.' });
      }

      const rest = rows[0];
      return res.json({
        id: rest.id,
        name: rest.name,
        domain: rest.domain,
        logo_url: rest.logo_url,
        address: rest.address,
        phone: rest.phone,
        email: rest.email,
        owner_name: rest.owner_name,
        owner_email: rest.owner_email,
        owner_mobile: rest.owner_mobile,
        gst_number: rest.gst_number,
        created_at: rest.created_at,
        updated_at: rest.updated_at
      });
    } catch (err) {
      console.error('[Get Profile Error]', err);
      return res.status(500).json({ error: 'Failed to fetch restaurant profile.' });
    }
  }

  /**
   * PUT /api/settings/profile
   * Update Restaurant Name & Logo (Multi-tenant + Syncs receipt_settings + Audit History)
   */
  static async updateProfile(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      if (!restaurantId) {
        return res.status(400).json({ error: 'Restaurant ID is required.' });
      }

      const { name, logo_url, address, phone, email, gst_number } = req.body;

      if (name !== undefined && !name.trim()) {
        return res.status(400).json({ error: 'Restaurant Name cannot be empty.' });
      }

      const [existingRows] = await pool.query('SELECT * FROM restaurants WHERE id = ?', [restaurantId]);
      if (existingRows.length === 0) {
        return res.status(404).json({ error: 'Restaurant not found.' });
      }

      const prevRest = existingRows[0];
      const prevName = prevRest.name;
      const prevLogo = prevRest.logo_url;

      const newName = name !== undefined ? name.trim() : prevName;
      const newLogo = logo_url !== undefined ? logo_url : prevLogo;

      await pool.query(
        'UPDATE restaurants SET name = ?, logo_url = ?, address = ?, phone = ?, email = ?, gst_number = ?, updated_at = NOW() WHERE id = ?',
        [
          newName,
          newLogo,
          address !== undefined ? address : prevRest.address,
          phone !== undefined ? phone : prevRest.phone,
          email !== undefined ? email : prevRest.email,
          gst_number !== undefined ? gst_number : prevRest.gst_number,
          restaurantId
        ]
      );

      // Sync name in receipt_settings table so receipt, KOT, and POS stay in sync!
      try {
        await pool.query(
          'UPDATE receipt_settings SET restaurant_name = ? WHERE restaurant_id = ?',
          [newName, restaurantId]
        );
      } catch (err) {
        console.warn('[Profile Controller] receipt_settings sync warning:', err.message);
      }

      // Record Version History Audit Log
      const hasNameChanged = newName !== prevName;
      const hasLogoChanged = newLogo !== prevLogo;

      if (hasNameChanged || hasLogoChanged) {
        let descParts = [];
        if (hasNameChanged) descParts.push(`Name changed from '${prevName}' to '${newName}'`);
        if (hasLogoChanged) descParts.push(`Logo updated`);

        await SuperAdminRepository.addAuditLog(
          restaurantId,
          req.user.id,
          'RESTAURANT_PROFILE_UPDATED',
          `Restaurant Profile updated: ${descParts.join(' & ')}`,
          req.ip,
          {
            user_name: req.user.name || req.user.username,
            user_role: req.user.role || 'admin',
            prev_name: prevName,
            new_name: newName,
            prev_logo: prevLogo,
            new_logo: newLogo
          }
        );
      }

      const [updatedRows] = await pool.query('SELECT * FROM restaurants WHERE id = ?', [restaurantId]);
      return res.json({
        message: 'Restaurant profile updated successfully.',
        profile: updatedRows[0]
      });
    } catch (err) {
      console.error('[Update Profile Error]', err);
      return res.status(500).json({ error: 'Failed to update restaurant profile: ' + err.message });
    }
  }

  /**
   * POST /api/settings/profile/logo
   * Upload logo image file (JPG, JPEG, PNG, WEBP, SVG)
   */
  static async uploadLogo(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
      }

      const fileUrl = `/uploads/logos/${req.file.filename}`;
      return res.json({
        message: 'Restaurant logo uploaded successfully.',
        logo_url: fileUrl,
        filename: req.file.filename
      });
    } catch (err) {
      console.error('[Upload Logo Error]', err);
      return res.status(500).json({ error: 'Failed to upload logo: ' + err.message });
    }
  }
}

module.exports = ProfileController;
