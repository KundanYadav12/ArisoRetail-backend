const pool = require('../config/db');

class AiConfigRepository {
  /**
   * Get active AI configuration details from database (Includes full API key for internal server use)
   */
  static async getConfig() {
    try {
      const [rows] = await pool.execute(
        'SELECT id, provider, api_key, model_name, is_enabled, updated_at FROM ai_configurations ORDER BY id ASC LIMIT 1'
      );
      if (rows.length === 0) {
        return {
          provider: 'google_gemini',
          api_key: process.env.GEMINI_API_KEY || null,
          model_name: 'gemini-flash-latest',
          is_enabled: 1
        };
      }

      const config = rows[0];
      if (!config.api_key && process.env.GEMINI_API_KEY) {
        config.api_key = process.env.GEMINI_API_KEY;
      }
      return config;
    } catch (err) {
      console.error('[AiConfigRepository.getConfig Error]', err.message);
      return {
        provider: 'google_gemini',
        api_key: process.env.GEMINI_API_KEY || null,
        model_name: 'gemini-flash-latest',
        is_enabled: 1
      };
    }
  }

  /**
   * Get masked AI config (safe for Super Admin UI display, never exposes plain API key)
   */
  static async getMaskedConfig() {
    const config = await this.getConfig();
    const key = config.api_key || '';
    let maskedKey = '';
    if (key.length > 8) {
      maskedKey = key.slice(0, 4) + '••••••••••••' + key.slice(-4);
    } else if (key.length > 0) {
      maskedKey = '••••••••';
    }

    return {
      provider: config.provider || 'google_gemini',
      has_key: Boolean(key),
      masked_key: maskedKey,
      model_name: config.model_name || 'gemini-flash-latest',
      is_enabled: Boolean(config.is_enabled)
    };
  }

  /**
   * Update AI configuration (Super Admin Only)
   */
  static async updateConfig({ api_key, model_name, is_enabled }) {
    const [rows] = await pool.execute('SELECT id, api_key FROM ai_configurations ORDER BY id ASC LIMIT 1');
    const model = model_name || 'gemini-flash-latest';
    const enabled = is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1;

    if (rows.length > 0) {
      const id = rows[0].id;
      if (api_key === '') {
        // Explicit removal requested
        await pool.execute(
          'UPDATE ai_configurations SET api_key = NULL, model_name = ?, is_enabled = ?, updated_at = NOW() WHERE id = ?',
          [model, enabled, id]
        );
      } else if (api_key !== undefined && api_key !== null && api_key.trim() !== '' && !api_key.includes('••••')) {
        await pool.execute(
          'UPDATE ai_configurations SET api_key = ?, model_name = ?, is_enabled = ?, updated_at = NOW() WHERE id = ?',
          [api_key.trim(), model, enabled, id]
        );
      } else {
        await pool.execute(
          'UPDATE ai_configurations SET model_name = ?, is_enabled = ?, updated_at = NOW() WHERE id = ?',
          [model, enabled, id]
        );
      }
    } else {
      await pool.execute(
        'INSERT INTO ai_configurations (provider, api_key, model_name, is_enabled) VALUES ("google_gemini", ?, ?, ?)',
        [api_key ? api_key.trim() : null, model, enabled]
      );
    }

    return this.getMaskedConfig();
  }
}

module.exports = AiConfigRepository;
