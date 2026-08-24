const InventoryRepository = require('../repositories/inventory_repository');
const { generateExcelWorkbook } = require('../utils/excel_helper');

class InventoryController {
  /**
   * Get Stock Report & summary alerts
   */
  static async getStockReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const report = await InventoryRepository.getStockReport(restaurantId, {
        categoryId: req.query.category_id,
        search: req.query.search,
        status: req.query.status
      });
      return res.json(report);
    } catch (err) {
      console.error('Fetch stock report error:', err);
      return res.status(500).json({ error: 'Failed to retrieve stock report: ' + err.message });
    }
  }

  /**
   * Adjust stock for a menu item (Add, Reduce, Set)
   */
  static async adjustStock(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { menuItemId, adjustmentType, quantity, unit, lowStockThreshold, reason } = req.body;

      if (!menuItemId || !adjustmentType || quantity === undefined) {
        return res.status(400).json({ error: 'Item ID, adjustment type, and quantity are required.' });
      }

      const result = await InventoryRepository.adjustStock(restaurantId, {
        menuItemId,
        userId: req.user.id,
        userName: req.user.name || req.user.username,
        adjustmentType,
        quantity,
        unit,
        lowStockThreshold,
        reason
      });

      return res.json({
        message: 'Stock updated successfully.',
        stock: result
      });
    } catch (err) {
      console.error('Adjust stock error:', err);
      return res.status(500).json({ error: 'Failed to adjust stock: ' + err.message });
    }
  }

  /**
   * Get audit log history for stock adjustments
   */
  static async getStockLogs(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const logs = await InventoryRepository.getStockLogs(restaurantId, req.query.menu_item_id, req.query.limit);
      return res.json(logs);
    } catch (err) {
      console.error('Fetch stock logs error:', err);
      return res.status(500).json({ error: 'Failed to retrieve stock logs.' });
    }
  }

  /**
   * Export stock inventory to Excel (.xlsx)
   */
  static async exportStockExcel(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const report = await InventoryRepository.getStockReport(restaurantId, {
        categoryId: req.query.category_id,
        search: req.query.search,
        status: req.query.status
      });

      const columns = [
        { header: 'Item Name', key: 'name', width: 25 },
        { header: 'Category', key: 'category_name', width: 18 },
        { header: 'SKU', key: 'sku', width: 14 },
        { header: 'Current Stock', key: 'stock_quantity', width: 14 },
        { header: 'Unit', key: 'unit', width: 10 },
        { header: 'Low Stock Threshold', key: 'low_stock_threshold', width: 20 },
        { header: 'Stock Status', key: 'stock_status', width: 16 },
        { header: 'Last Updated', key: 'updated_at', width: 20 }
      ];

      const rows = (report.items || []).map(item => ({
        name: item.name || '',
        category_name: item.category_name || '',
        sku: item.sku || '',
        stock_quantity: item.stock_quantity || 0,
        unit: item.unit || 'pcs',
        low_stock_threshold: item.low_stock_threshold || 10,
        stock_status: (item.stock_status || '').toUpperCase(),
        updated_at: item.stock_updated_at ? new Date(item.stock_updated_at).toISOString().slice(0, 19).replace('T', ' ') : 'N/A'
      }));

      const buffer = await generateExcelWorkbook({
        sheetName: 'Stock Inventory',
        columns,
        data: rows
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=stock_report_${new Date().toISOString().slice(0, 10)}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate stock Excel export.' });
    }
  }

  /**
   * Export stock inventory to CSV
   */
  static async exportStockCSV(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const report = await InventoryRepository.getStockReport(restaurantId, {
        categoryId: req.query.category_id,
        search: req.query.search,
        status: req.query.status
      });

      let csv = 'Item Name,Category,SKU,Current Stock,Unit,Low Stock Threshold,Stock Status,Last Updated\r\n';
      
      (report.items || []).forEach(item => {
        const lastUpdated = item.stock_updated_at ? new Date(item.stock_updated_at).toISOString().slice(0, 19).replace('T', ' ') : 'N/A';
        const cleanName = `"${(item.name || '').replace(/"/g, '""')}"`;
        const cleanCat = `"${(item.category_name || '').replace(/"/g, '""')}"`;
        const cleanSku = `"${(item.sku || '').replace(/"/g, '""')}"`;

        csv += `${cleanName},${cleanCat},${cleanSku},${item.stock_quantity || 0},${item.unit || 'pcs'},${item.low_stock_threshold || 10},${(item.stock_status || '').toUpperCase()},${lastUpdated}\r\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=stock_report_${new Date().toISOString().slice(0, 10)}.csv`);
      return res.send(csv);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate stock CSV export.' });
    }
  }
}

module.exports = InventoryController;
