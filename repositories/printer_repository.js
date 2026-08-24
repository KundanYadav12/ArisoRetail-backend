const pool = require('../config/db');

class PrinterRepository {
  static async getAll(restaurantId) {
    const [rows] = await pool.execute(
      'SELECT p.*, d.device_name FROM printers p LEFT JOIN restaurant_devices d ON p.device_id = d.id WHERE p.restaurant_id = ? ORDER BY p.id ASC',
      [restaurantId]
    );
    return rows;
  }

  /**
   * Fetch printers assigned to a specific Gateway Device.
   * Auto-assigns unassigned printers for the restaurant to this device if no explicit assignment exists.
   */
  static async getPrintersForDevice(restaurantId, deviceId) {
    if (deviceId) {
      // First check if any printers are unassigned for this restaurant
      const [unassigned] = await pool.execute(
        'SELECT id FROM printers WHERE restaurant_id = ? AND device_id IS NULL',
        [restaurantId]
      );
      if (unassigned.length > 0) {
        await pool.execute(
          'UPDATE printers SET device_id = ? WHERE restaurant_id = ? AND device_id IS NULL',
          [deviceId, restaurantId]
        );
      }

      // Fetch printers specifically assigned to this gateway device
      const [assignedRows] = await pool.execute(
        'SELECT p.*, d.device_name FROM printers p LEFT JOIN restaurant_devices d ON p.device_id = d.id WHERE p.restaurant_id = ? AND p.device_id = ? ORDER BY p.id ASC',
        [restaurantId, deviceId]
      );

      if (assignedRows.length > 0) {
        return assignedRows;
      }
    }

    // Fallback for non-device queries or unassigned mode
    return this.getAll(restaurantId);
  }

  /**
   * Bind unassigned printers belonging to a restaurant to a target gateway device
   */
  static async assignUnassignedPrintersToDevice(restaurantId, deviceId) {
    if (!deviceId) return 0;
    const [result] = await pool.execute(
      'UPDATE printers SET device_id = ? WHERE restaurant_id = ? AND device_id IS NULL',
      [deviceId, restaurantId]
    );
    return result.affectedRows;
  }

  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      'SELECT p.*, d.device_name FROM printers p LEFT JOIN restaurant_devices d ON p.device_id = d.id WHERE p.id = ? AND p.restaurant_id = ?',
      [id, restaurantId]
    );
    return rows[0];
  }

  static async getByRole(restaurantId, role) {
    const [rows] = await pool.execute(
      'SELECT * FROM printers WHERE restaurant_id = ? AND role = ? AND is_active = 1',
      [restaurantId, role]
    );
    return rows;
  }

  static async getDefaultReceiptPrinter(restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM printers WHERE restaurant_id = ? AND is_default_receipt = 1 AND is_active = 1 LIMIT 1',
      [restaurantId]
    );
    if (rows.length > 0) return rows[0];
    
    // Fallback to first active receipt/counter/all printer
    const [fallback] = await pool.execute(
      'SELECT * FROM printers WHERE restaurant_id = ? AND (role = "receipt" OR role = "counter" OR role = "all") AND is_active = 1 LIMIT 1',
      [restaurantId]
    );
    if (fallback.length > 0) return fallback[0];

    // Final fallback to any active printer
    const [anyPrinter] = await pool.execute(
      'SELECT * FROM printers WHERE restaurant_id = ? AND is_active = 1 LIMIT 1',
      [restaurantId]
    );
    return anyPrinter[0] || null;
  }

  static async getDefaultKOTPrinter(restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM printers WHERE restaurant_id = ? AND is_default_kot = 1 AND is_active = 1 LIMIT 1',
      [restaurantId]
    );
    if (rows.length > 0) return rows[0];

    // Fallback to first active kitchen/kot/all printer
    const [fallback] = await pool.execute(
      'SELECT * FROM printers WHERE restaurant_id = ? AND (role = "kitchen" OR role = "kot" OR role = "all") AND is_active = 1 LIMIT 1',
      [restaurantId]
    );
    if (fallback.length > 0) return fallback[0];

    // Final fallback to any active printer
    const [anyPrinter] = await pool.execute(
      'SELECT * FROM printers WHERE restaurant_id = ? AND is_active = 1 LIMIT 1',
      [restaurantId]
    );
    return anyPrinter[0] || null;
  }

  static async create(restaurantId, printer) {
    const {
      name, device_id, type, ip_address, bluetooth_address, port, paper_width, character_encoding,
      role, is_default_receipt, is_default_kot, auto_cut, cash_drawer
    } = printer;

    if (is_default_receipt) {
      await pool.execute('UPDATE printers SET is_default_receipt = 0 WHERE restaurant_id = ?', [restaurantId]);
    }
    if (is_default_kot) {
      await pool.execute('UPDATE printers SET is_default_kot = 0 WHERE restaurant_id = ?', [restaurantId]);
    }

    const [result] = await pool.execute(
      'INSERT INTO printers (restaurant_id, device_id, name, type, ip_address, bluetooth_address, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer, is_active, status, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, "online", NOW(), NOW())',
      [
        restaurantId, device_id || null, name, type || 'lan', ip_address || null, bluetooth_address || null, port || 9100,
        paper_width || '80', character_encoding || 'UTF-8', role || 'receipt',
        is_default_receipt ? 1 : 0, is_default_kot ? 1 : 0,
        auto_cut !== undefined ? (auto_cut ? 1 : 0) : 1,
        cash_drawer !== undefined ? (cash_drawer ? 1 : 0) : 1
      ]
    );
    return result.insertId;
  }

  static async update(id, restaurantId, printer) {
    const {
      name, device_id, type, ip_address, bluetooth_address, port, paper_width, character_encoding,
      role, is_default_receipt, is_default_kot, auto_cut, cash_drawer, is_active, status
    } = printer;

    if (is_default_receipt) {
      await pool.execute('UPDATE printers SET is_default_receipt = 0 WHERE restaurant_id = ?', [restaurantId]);
    }
    if (is_default_kot) {
      await pool.execute('UPDATE printers SET is_default_kot = 0 WHERE restaurant_id = ?', [restaurantId]);
    }

    const [result] = await pool.execute(
      'UPDATE printers SET name = ?, device_id = ?, type = ?, ip_address = ?, bluetooth_address = ?, port = ?, paper_width = ?, character_encoding = ?, role = ?, is_default_receipt = ?, is_default_kot = ?, auto_cut = ?, cash_drawer = ?, is_active = ?, status = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
      [
        name, device_id || null, type || 'lan', ip_address || null, bluetooth_address || null, port || 9100, paper_width || '80', character_encoding || 'UTF-8',
        role || 'receipt', is_default_receipt ? 1 : 0, is_default_kot ? 1 : 0,
        auto_cut !== undefined ? (auto_cut ? 1 : 0) : 1,
        cash_drawer !== undefined ? (cash_drawer ? 1 : 0) : 1,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        status || 'online', id, restaurantId
      ]
    );
    return result.affectedRows > 0;
  }

  static async updateStatus(id, restaurantId, status) {
    const [result] = await pool.execute(
      'UPDATE printers SET status = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
      [status, id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async updateHeartbeat(id, restaurantId, status) {
    const [result] = await pool.execute(
      'UPDATE printers SET status = ?, last_heartbeat_at = NOW(), updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
      [status, id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async delete(id, restaurantId) {
    const [result] = await pool.execute(
      'DELETE FROM printers WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = PrinterRepository;
