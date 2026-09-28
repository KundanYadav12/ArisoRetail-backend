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
   * Manual generation of serial numbers for existing inventory / stock
   */
  static async generateManual(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const result = await SerialNumberService.generateManual(restaurantId, req.body);
      return res.status(201).json({
        message: `Successfully generated ${result.quantity} unique serial numbers for "${result.product_name}".`,
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

      // Build ESC/POS thermal command stream with Code128 barcode
      const escposData = SerialNumberService.buildEscposSerialBarcode({
        serialNumber: serialData.serial_number,
        productName: serialData.product.name,
        sku: serialData.product.sku,
        purchaseInvoice: serialData.purchase.invoice,
        purchaseDate: serialData.purchase.date,
        storeName
      });

      // If printer_id supplied, enqueue print job in print queue
      let jobId = null;
      if (printer_id) {
        const [pRows] = await pool.execute(
          'SELECT id FROM printers WHERE id = ? AND restaurant_id = ?',
          [printer_id, restaurantId]
        );
        if (pRows.length > 0) {
          const job = await PrintQueueRepository.enqueue({
            restaurant_id: restaurantId,
            printer_id: printer_id,
            job_type: 'SERIAL_BARCODE',
            order_id: null,
            payload: escposData
          });
          jobId = job?.id;
        }
      }

      return res.json({
        success: true,
        message: `Barcode for Serial #${serialData.serial_number} generated for printing.`,
        serial_number: serialData.serial_number,
        job_id: jobId,
        escpos_payload: escposData
      });
    } catch (err) {
      console.error('[SerialNumberController.printBarcode] Error:', err);
      return res.status(500).json({ error: err.message || 'Failed to print serial barcode.' });
    }
  }
}

module.exports = SerialNumberController;
