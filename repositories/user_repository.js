const pool = require('../config/db');

class UserRepository {
  static async findByUsername(username, restaurantId = null) {
    if (restaurantId) {
      const [rows] = await pool.execute(
        'SELECT * FROM users WHERE username = ? AND restaurant_id = ? AND is_active = 1',
        [username, restaurantId]
      );
      return rows[0];
    } else {
      const [rows] = await pool.execute(
        'SELECT * FROM users WHERE username = ? AND is_active = 1',
        [username]
      );
      return rows[0];
    }
  }

  static async findByEmail(email) {
    const clean = (email || '').toLowerCase().trim();
    let [rows] = await pool.execute(
      'SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? ORDER BY id DESC',
      [clean, clean]
    );
    if (rows.length > 0) return rows[0];

    [rows] = await pool.execute(
      'SELECT u.* FROM users u JOIN restaurants r ON u.restaurant_id = r.id ' +
      'WHERE (LOWER(r.owner_email) = ? OR LOWER(r.email) = ?) AND u.role = "admin" ORDER BY u.id DESC',
      [clean, clean]
    );
    return rows[0] || null;
  }

  static async findByEmailOrUsername(input) {
    const clean = (input || '').toLowerCase().trim();
    let [rows] = await pool.execute(
      'SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? ORDER BY id DESC',
      [clean, clean]
    );
    if (rows.length > 0) return rows[0];

    [rows] = await pool.execute(
      'SELECT u.* FROM users u JOIN restaurants r ON u.restaurant_id = r.id ' +
      'WHERE (LOWER(r.owner_email) = ? OR LOWER(r.email) = ?) AND u.role = "admin" ORDER BY u.id DESC',
      [clean, clean]
    );
    return rows[0] || null;
  }

  static async findById(id) {
    const [rows] = await pool.execute(
      `SELECT u.id, u.restaurant_id, u.name, u.username, u.email, u.role, u.is_active, 
              u.must_change_password, u.is_verified, u.active_session_id,
              u.assigned_warehouse_id, u.permissions,
              r.name as restaurant_name, r.logo_url as restaurant_logo_url,
              w.name as assigned_warehouse_name
       FROM users u 
       LEFT JOIN restaurants r ON u.restaurant_id = r.id 
       LEFT JOIN warehouses w ON u.assigned_warehouse_id = w.id
       WHERE u.id = ?`,
      [id]
    );
    if (!rows[0]) return null;
    const user = rows[0];
    if (user.permissions && typeof user.permissions === 'string') {
      try { user.permissions = JSON.parse(user.permissions); } catch { user.permissions = []; }
    }
    return user;
  }

  static async getUserCount(restaurantId) {
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as count FROM users WHERE restaurant_id = ? AND is_active = 1',
      [restaurantId]
    );
    return rows[0]?.count || 0;
  }

  static async getAllByRestaurant(restaurantId) {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.username, u.email, u.role, u.is_active, 
              u.must_change_password, u.is_verified, u.created_at,
              u.assigned_warehouse_id, u.permissions, w.name as assigned_warehouse_name
       FROM users u
       LEFT JOIN warehouses w ON u.assigned_warehouse_id = w.id
       WHERE u.restaurant_id = ? 
       ORDER BY u.id DESC`,
      [restaurantId]
    );
    return rows.map(r => ({
      ...r,
      permissions: r.permissions ? (typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions) : []
    }));
  }

  static async getUsersByRestaurant(restaurantId) {
    return this.getAllByRestaurant(restaurantId);
  }

  static async create(user) {
    const { restaurant_id, name, username, email, password_hash, role, is_active, must_change_password, is_verified, temp_password, assigned_warehouse_id, permissions } = user;
    const activeState = is_active !== undefined ? (is_active ? 1 : 0) : 1;
    const mustChange = must_change_password ? 1 : 0;
    const verified = is_verified ? 1 : 0;
    const serializedPerms = permissions ? (typeof permissions === 'string' ? permissions : JSON.stringify(permissions)) : null;
    
    const [result] = await pool.execute(
      'INSERT INTO users (restaurant_id, name, username, email, password_hash, role, is_active, must_change_password, is_verified, temp_password, assigned_warehouse_id, permissions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [restaurant_id, name, username, email || null, password_hash || 'PENDING_ACTIVATION', role || 'cashier', activeState, mustChange, verified, temp_password || null, assigned_warehouse_id || null, serializedPerms]
    );
    return result.insertId;
  }

  static async activateUserPassword(userId, passwordHash) {
    const [result] = await pool.execute(
      'UPDATE users SET password_hash = ?, is_active = 1, must_change_password = 0, is_verified = 1, verified_at = NOW(), temp_password = NULL WHERE id = ?',
      [passwordHash, userId]
    );
    return result.affectedRows > 0;
  }

  static async changePassword(userId, passwordHash) {
    const [result] = await pool.execute(
      'UPDATE users SET password_hash = ?, must_change_password = 0, temp_password = NULL WHERE id = ?',
      [passwordHash, userId]
    );
    return result.affectedRows > 0;
  }

  static async markUserVerified(userId) {
    const [result] = await pool.execute(
      'UPDATE users SET is_verified = 1, verified_at = NOW() WHERE id = ?',
      [userId]
    );
    return result.affectedRows > 0;
  }

  static async update(id, restaurantId, user) {
    const { name, email, role, is_active, password_hash, assigned_warehouse_id, permissions } = user;
    const serializedPerms = permissions !== undefined ? (typeof permissions === 'string' ? permissions : JSON.stringify(permissions)) : undefined;

    let query = 'UPDATE users SET name = ?, email = ?, role = ?, is_active = ?';
    const params = [name, email || null, role, is_active];

    if (password_hash) {
      query += ', password_hash = ?';
      params.push(password_hash);
    }
    if (assigned_warehouse_id !== undefined) {
      query += ', assigned_warehouse_id = ?';
      params.push(assigned_warehouse_id || null);
    }
    if (serializedPerms !== undefined) {
      query += ', permissions = ?';
      params.push(serializedPerms);
    }

    query += ' WHERE id = ? AND restaurant_id = ?';
    params.push(id, restaurantId);

    const [result] = await pool.execute(query, params);
    return result.affectedRows > 0;
  }

  static async delete(id, restaurantId) {
    const [result] = await pool.execute(
      'DELETE FROM users WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async openShift(restaurantId, cashierId, shiftData) {
    const { starting_cash, device, ip_address } = shiftData;
    const [result] = await pool.execute(
      'INSERT INTO cashier_shifts (restaurant_id, cashier_id, device, ip_address, starting_cash, status, login_time) ' +
      'VALUES (?, ?, ?, ?, ?, "open", NOW())',
      [restaurantId, cashierId, device || 'Web Client', ip_address || null, starting_cash || 0]
    );
    return result.insertId;
  }

  static async getOpenShift(restaurantId, cashierId) {
    const [rows] = await pool.execute(
      'SELECT * FROM cashier_shifts WHERE restaurant_id = ? AND cashier_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [restaurantId, cashierId]
    );
    return rows[0] || null;
  }

  static async closeShift(shiftId, restaurantId) {
    const [result] = await pool.execute(
      'UPDATE cashier_shifts SET status = "closed", logout_time = NOW() WHERE id = ? AND restaurant_id = ?',
      [shiftId, restaurantId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = UserRepository;
