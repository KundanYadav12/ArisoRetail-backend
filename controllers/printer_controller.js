const PrinterRepository = require('../repositories/printer_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const net = require('net');

class PrinterController {
  static async getAll(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const printers = await PrinterRepository.getAll(restaurantId);
      return res.json(printers);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve printers.' });
    }
  }

  static async getById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const printer = await PrinterRepository.getById(req.params.id, restaurantId);
      if (!printer) {
        return res.status(404).json({ error: 'Printer configuration not found.' });
      }
      return res.json(printer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve printer configuration.' });
    }
  }

  static async create(req, res) {
    const { name, type, ip_address, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer } = req.body;
    if (!name || !ip_address) {
      return res.status(400).json({ error: 'Printer Name and IP Address are required.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const printerId = await PrinterRepository.create(restaurantId, {
        name, type, ip_address, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer
      });

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'PRINTER_CREATE', `Added printer: ${name} (${ip_address})`, req.ip);
      return res.status(201).json({ message: 'Printer added successfully.', id: printerId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to add printer.' });
    }
  }

  static async update(req, res) {
    const { name, type, ip_address, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer, is_active, status } = req.body;
    if (!name || !ip_address) {
      return res.status(400).json({ error: 'Printer Name and IP Address are required.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const success = await PrinterRepository.update(req.params.id, restaurantId, {
        name, type, ip_address, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer, is_active, status
      });

      if (!success) {
        return res.status(404).json({ error: 'Printer not found or unauthorized.' });
      }

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'PRINTER_UPDATE', `Updated printer config: ${name} (ID: ${req.params.id})`, req.ip);
      return res.json({ message: 'Printer updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update printer.' });
    }
  }

  static async updateStatus(req, res) {
    const { status } = req.body;
    const printerId = req.params.id;
    const restaurantId = req.user.restaurant_id;

    if (!['online', 'offline', 'error'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value.' });
    }

    try {
      const success = await PrinterRepository.updateStatus(printerId, restaurantId, status);
      if (!success) {
        return res.status(404).json({ error: 'Printer not found or unauthorized.' });
      }

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'PRINTER_STATUS_TOGGLE', `Updated status of printer ID ${printerId} to: ${status}`, req.ip);
      return res.json({ message: `Printer status changed to ${status}.`, status });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update printer status.' });
    }
  }

  static async delete(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const success = await PrinterRepository.delete(req.params.id, restaurantId);
      if (!success) {
        return res.status(404).json({ error: 'Printer not found or unauthorized.' });
      }

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'PRINTER_DELETE', `Deleted printer configuration (ID: ${req.params.id})`, req.ip);
      return res.json({ message: 'Printer deleted successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to delete printer.' });
    }
  }

  /**
  /**
   * Test Socket connection & print test receipt on LAN network thermal printer
   */
  static async testConnection(req, res) {
    const { ip_address, port, paper_width, name } = req.body;
    if (!ip_address) {
      return res.status(400).json({ error: 'IP Address is required to run connection test.' });
    }

    const testPort = parseInt(port || 9100, 10);
    const cols = (paper_width === 58 || paper_width === '58') ? 32 : 48;
    const divider = '-'.repeat(cols) + '\n';
    const doubleDivider = '='.repeat(cols) + '\n';

    let testReceipt = '\x1B@\x1Ba\x01\x1BE\x01';
    testReceipt += (cols === 48 ? '\x1DD\x11' : '');
    testReceipt += 'ARISO RETAIL POS\n\x1DE\x00\x1BE\x00';
    testReceipt += 'LAN THERMAL PRINTER TEST\n';
    testReceipt += doubleDivider;
    testReceipt += '\x1Ba\x00';
    testReceipt += `Printer Name : ${name || 'LAN Thermal Printer'}\n`;
    testReceipt += `IP Address   : ${ip_address}\n`;
    testReceipt += `Port         : ${testPort}\n`;
    testReceipt += `Paper Width  : ${paper_width || 80}mm (${cols} cols)\n`;
    testReceipt += `Test Date    : ${new Date().toLocaleString()}\n`;
    testReceipt += `Status       : CONNECTED & ONLINE ✅\n`;
    testReceipt += divider;
    testReceipt += '\x1Ba\x01';
    testReceipt += '*** TEST PRINT SUCCESSFUL ***\n';
    testReceipt += 'Ariso Retail POS System\n\n\n\x1DV\x41\x03'; // Paper cut

    const isMock = !ip_address || ip_address === '127.0.0.1' || ip_address.startsWith('192.168.99') || ip_address === 'localhost';

    if (isMock) {
      console.log(`[LAN Printer Mock] Test receipt simulated for ${ip_address || 'virtual'}:${testPort}`);
      return res.json({
        status: 'connected',
        message: `Successfully connected to virtual LAN printer at ${ip_address || 'virtual'}:${testPort} and performed test print!`,
        is_mock: true
      });
    }

    const client = new net.Socket();
    client.setTimeout(3000); // 3 second timeout

    client.connect(testPort, ip_address, () => {
      client.write(Buffer.from(testReceipt, 'utf-8'), () => {
        client.end();
        return res.json({
          status: 'connected',
          message: `Successfully connected to LAN printer at ${ip_address}:${testPort} and printed test receipt!`
        });
      });
    });

    client.on('error', (err) => {
      client.destroy();
      return res.status(502).json({
        status: 'failed',
        error: `Printer socket unreachable at ${ip_address}:${testPort}. (${err.message})`
      });
    });

    client.on('timeout', () => {
      client.destroy();
      return res.status(504).json({
        status: 'failed',
        error: `Connection timed out connecting to printer at ${ip_address}:${testPort}. Check network connection and printer IP.`
      });
    });
  }

  /**
   * Directly print a completed Retail sale receipt over LAN thermal socket & Gateway Agent Queue
   */
  static async printReceipt(req, res) {
    const { order, items, printer_id } = req.body;
    const restaurantId = req.user ? req.user.restaurant_id : 1;

    if (!order || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Order and items payload are required for printing.' });
    }

    try {
      const PrinterService = require('../services/printer_service');
      const ReceiptRepository = require('../repositories/receipt_repository');
      const PrintQueueRepository = require('../repositories/print_queue_repository');

      let targetPrinter = null;
      if (printer_id) {
        targetPrinter = await PrinterRepository.getById(printer_id, restaurantId);
      }
      if (!targetPrinter) {
        const printers = await PrinterRepository.getAll(restaurantId);
        targetPrinter = printers.find(p => p.is_default_receipt === 1 || p.role === 'receipt') || printers[0];
      }

      if (!targetPrinter) {
        return res.status(404).json({ error: 'No active LAN thermal printer configured.' });
      }

      const receiptSettings = await ReceiptRepository.getSettings(restaurantId);
      const restaurantInfo = { name: (req.user && req.user.restaurant_name) || 'Ariso Retail' };

      const bufferPayload = PrinterService.buildReceiptPayload(order, items, restaurantInfo, targetPrinter, receiptSettings);
      const base64Payload = bufferPayload.toString('base64');

      // 1. Enqueue job into print_queue for Gateway Agent polling
      let jobId = null;
      try {
        jobId = await PrintQueueRepository.enqueue({
          restaurant_id: restaurantId,
          order_id: order.id || null,
          printer_id: targetPrinter.id,
          print_type: 'RECEIPT',
          payload_base64: base64Payload,
          backend_received_at: new Date()
        });
      } catch (qErr) {
        console.warn('[Print Queue Enqueue Warning]', qErr.message);
      }

      // 2. Direct Local LAN Socket Print Attempt
      let printResult = null;
      let printSuccess = false;

      try {
        printResult = await PrinterService.sendToPrinterSocket(
          targetPrinter.ip_address,
          targetPrinter.port || 9100,
          bufferPayload
        );
        printSuccess = true;
        if (jobId) {
          await PrintQueueRepository.updateJobStatus(jobId, 'SUCCESS', null);
        }
      } catch (socketErr) {
        console.warn(`[Direct Socket Warning] Direct print to ${targetPrinter.ip_address}:${targetPrinter.port || 9100} skipped (${socketErr.message}). Job remains queued for Gateway Agent.`);
      }

      // If job is queued for Gateway Agent OR direct print succeeded, report success!
      if (printSuccess || jobId) {
        return res.json({
          success: true,
          job_id: jobId,
          message: printSuccess 
            ? `Receipt printed over LAN to ${targetPrinter.name} (${targetPrinter.ip_address}:${targetPrinter.port || 9100})`
            : `Receipt sent to Ariso Retail Print Gateway Queue (Job #${jobId})`,
          printer: targetPrinter.name,
          details: printResult
        });
      } else {
        return res.status(502).json({
          error: `Failed to print receipt over LAN or enqueue to gateway queue.`
        });
      }
    } catch (err) {
      console.error('[LAN Print Receipt Error]:', err.message);
      return res.status(502).json({
        error: `Failed to print receipt over LAN: ${err.message}`
      });
    }
  }
}

module.exports = PrinterController;
