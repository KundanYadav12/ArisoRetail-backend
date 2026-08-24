const ThemeRepository = require('../repositories/theme_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');

class ThemeController {
  /**
   * Public / Authenticated route to get current active global theme
   */
  static async getTheme(req, res) {
    try {
      const theme = await ThemeRepository.getTheme();
      return res.json(theme);
    } catch (err) {
      console.error('[ThemeController.getTheme Error]', err);
      return res.status(500).json({ error: 'Failed to fetch global theme settings.' });
    }
  }

  /**
   * Super Admin endpoint to update global theme
   */
  static async updateTheme(req, res) {
    try {
      const { primary_color, secondary_color, danger_color, info_color, preset_name } = req.body;
      
      const updatedTheme = await ThemeRepository.updateTheme({
        primary_color,
        secondary_color,
        danger_color,
        info_color,
        preset_name
      });

      if (req.user && req.user.id) {
        await SuperAdminRepository.addAuditLog(
          null,
          req.user.id,
          'THEME_UPDATE',
          `Updated global theme color to ${primary_color} (Preset: ${preset_name || 'Custom'})`,
          req.ip
        );
      }

      return res.json({
        message: 'Global theme updated successfully across all modules.',
        theme: updatedTheme
      });
    } catch (err) {
      console.error('[ThemeController.updateTheme Error]', err);
      return res.status(500).json({ error: 'Failed to update global theme settings.' });
    }
  }

  /**
   * Super Admin endpoint to reset theme to default
   */
  static async resetTheme(req, res) {
    try {
      const defaultTheme = await ThemeRepository.resetTheme();

      if (req.user && req.user.id) {
        await SuperAdminRepository.addAuditLog(
          null,
          req.user.id,
          'THEME_RESET',
          'Reset global theme colors back to default Orange (#f97316)',
          req.ip
        );
      }

      return res.json({
        message: 'Global theme reset to default successfully.',
        theme: defaultTheme
      });
    } catch (err) {
      console.error('[ThemeController.resetTheme Error]', err);
      return res.status(500).json({ error: 'Failed to reset global theme.' });
    }
  }
}

module.exports = ThemeController;
