const pool = require('../config/db');

/**
 * Middleware to enforce store-level SuperBill feature permission in backend.
 * Checks database directly so permission grants/revocations apply immediately.
 */
async function requireSuperBillPermission(req, res, next) {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    if (userRole === 'super_admin' || userRole === 'superadmin') {
      return next();
    }

    const restaurantId = req.user?.restaurant_id;
    if (!restaurantId) {
      return res.status(403).json({ error: 'User is not assigned to any retail store.' });
    }

    const [rows] = await pool.execute(
      'SELECT feature_superbill FROM restaurants WHERE id = ?',
      [restaurantId]
    );

    if (rows.length === 0 || !rows[0].feature_superbill) {
      return res.status(403).json({
        error: 'SuperBill feature is not enabled for this store.',
        code: 'SUPERBILL_DISABLED'
      });
    }

    next();
  } catch (err) {
    console.error('[requireSuperBillPermission Error]', err);
    return res.status(500).json({ error: 'Failed to verify SuperBill store permission.' });
  }
}

module.exports = { requireSuperBillPermission };
