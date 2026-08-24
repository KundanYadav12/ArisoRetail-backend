const pool = require('../config/db');

const DEFAULT_THEME = {
  primary_color: '#f97316',
  secondary_color: '#10b981',
  danger_color: '#ef4444',
  info_color: '#3b82f6',
  preset_name: 'Orange (Default)'
};

class ThemeRepository {
  /**
   * Get active global theme settings
   */
  static async getTheme() {
    try {
      const [rows] = await pool.execute('SELECT * FROM global_theme_settings ORDER BY id ASC LIMIT 1');
      if (rows.length === 0) {
        return DEFAULT_THEME;
      }
      return rows[0];
    } catch (err) {
      console.error('[ThemeRepository.getTheme Error]', err.message);
      return DEFAULT_THEME;
    }
  }

  /**
   * Update global theme colors
   */
  static async updateTheme({ primary_color, secondary_color, danger_color, info_color, preset_name }) {
    const primary = primary_color || DEFAULT_THEME.primary_color;
    const secondary = secondary_color || DEFAULT_THEME.secondary_color;
    const danger = danger_color || DEFAULT_THEME.danger_color;
    const info = info_color || DEFAULT_THEME.info_color;
    const preset = preset_name || 'Custom';

    const [rows] = await pool.execute('SELECT id FROM global_theme_settings ORDER BY id ASC LIMIT 1');
    
    if (rows.length > 0) {
      const id = rows[0].id;
      await pool.execute(
        'UPDATE global_theme_settings SET primary_color = ?, secondary_color = ?, danger_color = ?, info_color = ?, preset_name = ?, updated_at = NOW() WHERE id = ?',
        [primary, secondary, danger, info, preset, id]
      );
    } else {
      await pool.execute(
        'INSERT INTO global_theme_settings (primary_color, secondary_color, danger_color, info_color, preset_name) VALUES (?, ?, ?, ?, ?)',
        [primary, secondary, danger, info, preset]
      );
    }

    return this.getTheme();
  }

  /**
   * Reset global theme to default Orange & Emerald Green
   */
  static async resetTheme() {
    return this.updateTheme(DEFAULT_THEME);
  }
}

module.exports = ThemeRepository;
