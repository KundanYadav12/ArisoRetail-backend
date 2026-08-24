const pool = require('../config/db');

class DeviceRepository {
  /**
   * Register a new restaurant print gateway device
   */
  static async createDevice(restaurantId, deviceName, deviceToken, ipAddress = null) {
    const [result] = await pool.execute(
      `INSERT INTO restaurant_devices (restaurant_id, device_name, device_token, ip_address, status, last_seen_at)
       VALUES (?, ?, ?, ?, 'online', NOW())`,
      [restaurantId, deviceName || 'Cashier PC Print Gateway', deviceToken, ipAddress]
    );
    return result.insertId;
  }

  /**
   * Find a device by its unique permanent device token
   */
  static async findByToken(deviceToken) {
    const [rows] = await pool.execute(
      `SELECT d.*, r.name as restaurant_name, r.address as restaurant_address 
       FROM restaurant_devices d 
       LEFT JOIN restaurants r ON d.restaurant_id = r.id 
       WHERE d.device_token = ?`,
      [deviceToken]
    );
    return rows[0] || null;
  }

  /**
   * Update device last seen timestamp & status
   */
  static async updateLastSeen(deviceToken, status = 'online', ipAddress = null) {
    const [result] = await pool.execute(
      `UPDATE restaurant_devices 
       SET status = ?, last_seen_at = NOW(), ip_address = COALESCE(?, ip_address) 
       WHERE device_token = ?`,
      [status, ipAddress, deviceToken]
    );
    return result.affectedRows > 0;
  }

  /**
   * List all registered devices for a restaurant
   */
  static async getDevicesForRestaurant(restaurantId) {
    const [rows] = await pool.execute(
      `SELECT id, device_name, device_token, ip_address, status, last_seen_at, created_at 
       FROM restaurant_devices WHERE restaurant_id = ? ORDER BY id DESC`,
      [restaurantId]
    );
    return rows;
  }

  static async getDevicesByRestaurant(restaurantId) {
    return this.getDevicesForRestaurant(restaurantId);
  }

  /**
   * Check if a restaurant has an active Desktop Print Gateway device seen recently (last 15 minutes)
   */
  static async hasActiveGatewayDevice(restaurantId) {
    if (!restaurantId) return false;
    const [rows] = await pool.execute(
      `SELECT id FROM restaurant_devices 
       WHERE restaurant_id = ? AND status = 'online' AND last_seen_at >= NOW() - INTERVAL 15 MINUTE 
       LIMIT 1`,
      [restaurantId]
    );
    return rows.length > 0;
  }
}

module.exports = DeviceRepository;
