const pool = require('../config/db');

class CategoryRepository {
  static async getAll(restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM categories WHERE restaurant_id = ? ORDER BY seq ASC, id ASC',
      [restaurantId]
    );
    return rows;
  }

  static async getById(id, restaurantId) {
    const [rows] = await pool.execute(
      'SELECT * FROM categories WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return rows[0];
  }

  static async create(restaurantId, category) {
    const { name, description, seq } = category;
    let targetSeq = seq;
    if (targetSeq === undefined || targetSeq === null) {
      const [maxRow] = await pool.execute(
        'SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq FROM categories WHERE restaurant_id = ?',
        [restaurantId]
      );
      targetSeq = maxRow[0]?.nextSeq || 1;
    }

    const [result] = await pool.execute(
      'INSERT INTO categories (restaurant_id, name, description, seq) VALUES (?, ?, ?, ?)',
      [restaurantId, name || '', description || null, targetSeq]
    );
    return result.insertId;
  }

  static async update(id, restaurantId, category) {
    const { name, description, seq } = category;
    const [result] = await pool.execute(
      'UPDATE categories SET name = ?, description = ?, seq = ? WHERE id = ? AND restaurant_id = ?',
      [name || '', description || null, seq || 0, id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async delete(id, restaurantId) {
    // Delete all child menu items or they cascade automatically in DB
    const [result] = await pool.execute(
      'DELETE FROM categories WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    return result.affectedRows > 0;
  }

  static async updateSequence(restaurantId, sequenceArray) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (let i = 0; i < sequenceArray.length; i++) {
        const item = sequenceArray[i];
        const categoryId = typeof item === 'object' ? item.id : item;
        const seqVal = typeof item === 'object' && item.seq !== undefined ? item.seq : (i + 1);
        
        await connection.execute(
          'UPDATE categories SET seq = ? WHERE id = ? AND restaurant_id = ?',
          [seqVal, categoryId, restaurantId]
        );
      }
      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

module.exports = CategoryRepository;
