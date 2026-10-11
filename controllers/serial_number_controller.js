/**
 * Serial Number Controller
 * Handles lookup, listing, generation, and barcode printing for product serial numbers.
 * Protected by Super Admin permission.
 */

const SerialNumberService = require('../services/serial_number_service');
const PrintQueueRepository = require('../repositories/print_queue_repository');
const pool = require('../config/db');

class SerialNumberController {
  /**
   * Lookup complete history and status by 8-digit Serial Number
   */
  static async lookup(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const serial = req.query.serial || req.query.sn || req.query.serial_number;

      if (!serial || !String(serial).trim()) {
        return res.status(400).json({ error: 'Please enter or scan an 8-digit Serial Number.' });
      }

      const result = await SerialNumberService.lookupSerialNumber(restaurantId, String(serial).trim());
      if (!result) {
        return res.status(404).json({
          error: `Serial Number "${serial}" not found in system. Verify number or scan again.`
        });
      }

      return res.json({ success: true, data: result, ...result });
    } catch (err) {
      console.error('[SerialNumberController.lookup] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to lookup serial number.' });
    }
  }

  /**
   * Search / List serial numbers with pagination & filters
   */
  static async list(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const data = await SerialNumberService.searchSerialNumbers(restaurantId, req.query);
      return res.json(data);
    } catch (err) {
      console.error('[SerialNumberController.list] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch serial numbers.' });
    }
  }

  /**
   * Get overall Serial Number statistics
   */
  static async getStats(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const stats = await SerialNumberService.getSerialStats(restaurantId);
      return res.json(stats);
    } catch (err) {
      console.error('[SerialNumberController.getStats] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch statistics.' });
    }
  }

  /**
   * Get all currently available (in_stock) serial numbers for a specific product
   */
  static async getAvailable(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const menuItemId = req.params.menuItemId || req.query.menu_item_id || req.query.product_id || req.query.id;
      if (!menuItemId) {
        return res.status(400).json({ error: 'menu_item_id is required.' });
      }

      const serials = await SerialNumberService.getAvailableSerialsByItem(restaurantId, menuItemId);
      return res.json({
        success: true,
        count: serials.length,
        serial_numbers: serials,
        data: serials
      });
    } catch (err) {
      console.error('[SerialNumberController.getAvailable] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to fetch available serial numbers.' });
    }
  }

  /**
   * Check availability and format of a proposed manual 8-digit Serial Number
   */
  static async checkAvailability(req, res) {
    try {
      const serial = req.query.serial || req.query.sn || req.query.serial_number;
      if (!serial || !String(serial).trim()) {
        return res.status(400).json({ error: 'Please provide a serial number to validate.' });
      }

      const cleanSerial = String(serial).trim();
      const isValidFormat = /^\d{8}$/.test(cleanSerial);

      if (!isValidFormat) {
        return res.json({
          available: false,
          valid_format: false,
          error: 'Serial number must be exactly 8 digits (e.g. 12345678).'
        });
      }

      const [rows] = await pool.execute(
        'SELECT id, serial_number FROM product_serial_numbers WHERE serial_number = ? LIMIT 1',
        [cleanSerial]
      );

      if (rows.length > 0) {
        return res.json({
          available: false,
          valid_format: true,
          error: `Serial number "${cleanSerial}" is already registered in the system.`
        });
      }

      return res.json({
        available: true,
        valid_format: true,
        message: `Serial number "${cleanSerial}" is unique and available.`
      });
    } catch (err) {
      console.error('[SerialNumberController.checkAvailability] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to check availability.' });
    }
  }

  /**
   * Manual generation or registration of serial numbers for existing inventory / stock
   */
  static async generateManual(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const result = await SerialNumberService.generateManual(restaurantId, req.body);
      const isManual = result.mode === 'manual';
      const msg = isManual
        ? `Successfully registered serial number "${result.serial_numbers[0]}" for "${result.product_name}".`
        : `Successfully generated ${result.quantity} unique serial numbers for "${result.product_name}".`;

      return res.status(201).json({
        message: msg,
        data: result,
        created_count: result.quantity,
        serial_numbers: result.serial_numbers
      });
    } catch (err) {
      console.error('[SerialNumberController.generateManual] Error:', err);
      return res.status(400).json({ error: err.message || 'Failed to generate serial numbers.' });
    }
  }

  /**
   * Print Serial Number Barcode through connected thermal printer machine
   */
  static async printBarcode(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { serial_number, printer_id } = req.body;

      if (!serial_number) {
        return res.status(400).json({ error: 'serial_number is required for printing.' });
      }

      const serialData = await SerialNumberService.lookupSerialNumber(restaurantId, String(serial_number).trim());
      if (!serialData) {
        return res.status(404).json({ error: `Serial Number "${serial_number}" not found.` });
      }

    // Fetch store profile for header
      const [restRows] = await pool.execute(
        'SELECT name FROM restaurants WHERE id = ?',
        [restaurantId]
      );
      const storeName = restRows[0]?.name || 'ARISO RETAIL';

      const PrinterService = require('../services/printer_service');
      const printResult = await PrinterService.printBarcodeLabel(restaurantId, {
        printer_id: printer_id || null,
        label_data: {
          serialNumber: serialData.serial_number,
          barcode: serialData.serial_number,
          productName: serialData.product?.name || 'Product',
          sku: serialData.product?.sku || '',
          price: serialData.product?.selling_price || serialData.product?.price || null,
          storeName
        },
        copies: 1
      });

      return res.json({
        success: true,
        message: printResult.message || `Barcode for Serial #${serialData.serial_number} printed successfully.`,
        serial_number: serialData.serial_number,
        printer: printResult.printer,
        protocol: printResult.protocol
      });
    } catch (err) {
      console.error('[SerialNumberController.printBarcode] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to print serial barcode.' });
    }
  }
}

module.exports = SerialNumberController;
