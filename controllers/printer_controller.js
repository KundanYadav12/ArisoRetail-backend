const PrinterRepository = require('../repositories/printer_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const net = require('net');

class PrinterController {
  static async getAll(req, res) {
    try {
      const restaurantId = req.user?.restaurant_id || 1;
      let printers = await PrinterRepository.getAll(restaurantId);

      // If no printer is registered in DB, automatically scan local network and sync
      if (printers.length === 0) {
        const PrinterService = require('../services/printer_service');
        const autoPrn = await PrinterService.autoResolveAndSyncPrinter(restaurantId).catch(() => null);
        if (autoPrn) {
          printers = await PrinterRepository.getAll(restaurantId);
        }
      }

      return res.json(printers);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve printers.' });
    }
  }

  /**
   * Scan active local Wi-Fi / subnet for thermal printers listening on port 9100
   */
  static async discoverPrinters(req, res) {
    try {
      const restaurantId = req.user?.restaurant_id || 1;
      const PrinterService = require('../services/printer_service');
      const discovered = await PrinterService.discoverNetworkPrinters();

      // Automatically sync discovered printer into DB
      if (discovered.length > 0) {
        await PrinterService.autoResolveAndSyncPrinter(restaurantId).catch(() => {});
      }

      const activePrinters = await PrinterRepository.getAll(restaurantId);
      return res.json({
        success: true,
        discovered,
        printers: activePrinters
      });
    } catch (err) {
      console.error('[Discover Printers Error]', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  static async getById(req, res) {
    try {
      const restaurantId = req.user?.restaurant_id || 1;
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
      const restaurantId = req.user?.restaurant_id || 1;
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
      const restaurantId = req.user?.restaurant_id || 1;
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
      const restaurantId = req.user?.restaurant_id || 1;
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
   * Test Socket connection & print test receipt on LAN network thermal printer
   */
  static async testConnection(req, res) {
    const { id, ip_address, port, paper_width, name } = req.body;
    const restaurantId = req.user?.restaurant_id || 1;
    const PrinterService = require('../services/printer_service');

    let targetIp = ip_address;
    let targetPort = parseInt(port || 9100, 10);
    let targetName = name || 'LAN Thermal Printer';
    let targetWidth = paper_width || '80';

    if (!targetIp && id) {
      const prn = await PrinterRepository.getById(id, restaurantId);
      if (prn) {
        targetIp = prn.ip_address;
        targetPort = parseInt(prn.port || 9100, 10);
        targetName = prn.name;
        targetWidth = prn.paper_width || '80';
      }
    }

    if (!targetIp) {
      // Auto-detect printer on local Wi-Fi / network
      const autoPrn = await PrinterService.autoResolveAndSyncPrinter(restaurantId);
      if (autoPrn && autoPrn.ip_address) {
        targetIp = autoPrn.ip_address;
        targetPort = parseInt(autoPrn.port || 9100, 10);
        targetName = autoPrn.name;
        targetWidth = autoPrn.paper_width || '80';
      }
    }

    if (!targetIp) {
      return res.status(400).json({
        status: 'failed',
        error: 'No LAN printer IP address specified and none detected on this local network.'
      });
    }

    const cols = (targetWidth === 58 || targetWidth === '58') ? 32 : 48;
    const divider = '-'.repeat(cols) + '\n';
    const doubleDivider = '='.repeat(cols) + '\n';

    let testReceipt = '\x1B@'; // ESC @: Initialize
    testReceipt += '\x1Ba\x01'; // Center align
    testReceipt += '\x1BE\x01'; // Bold on
    testReceipt += (cols === 48 ? '\x1D!\x11' : ''); // Double size if 80mm
    testReceipt += 'ARISO RETAIL POS\n';
    testReceipt += (cols === 48 ? '\x1D!\x00' : ''); // Normal size
    testReceipt += '\x1BE\x00'; // Bold off
    testReceipt += doubleDivider;
    testReceipt += '\x1Ba\x00'; // Left align
    testReceipt += `Printer Name : ${targetName}\n`;
    testReceipt += `IP Address   : ${targetIp}\n`;
    testReceipt += `Port         : ${targetPort}\n`;
    testReceipt += `Paper Width  : ${targetWidth}mm (${cols} cols)\n`;
    testReceipt += `Test Date    : ${new Date().toLocaleString()}\n`;
    testReceipt += `Status       : CONNECTED & ONLINE ✅\n`;
    testReceipt += divider;
    testReceipt += '\x1Ba\x01'; // Center align
    testReceipt += '*** TEST PRINT SUCCESSFUL ***\n';
    testReceipt += 'LAN Direct Thermal Printing Ready\n\n\n\n';
    testReceipt += '\x1DV\x41\x03'; // Paper cut

    try {
      const result = await PrinterService.sendToPrinterSocket(targetIp, targetPort, Buffer.from(testReceipt, 'utf-8'));
      if (id) {
        await PrinterRepository.updateStatus(id, restaurantId, 'online').catch(() => {});
      }
      return res.json({
        status: 'connected',
        success: true,
        message: `Successfully connected to LAN printer "${targetName}" (${targetIp}:${targetPort}) and printed test receipt!`,
        printer: { name: targetName, ip: targetIp, port: targetPort },
        details: result
      });
    } catch (err) {
      if (id) {
        await PrinterRepository.updateStatus(id, restaurantId, 'offline').catch(() => {});
      }
      return res.status(502).json({
        status: 'failed',
        success: false,
        error: `Printer socket unreachable at ${targetIp}:${targetPort}. (${err.message})`
      });
    }
  }

  /**
   * Directly print a completed Retail sale receipt or KOT over LAN thermal socket & Gateway Agent Queue
   */
  static async printReceipt(req, res) {
    const { order, items, printer_id, payload_base64, print_type } = req.body;
    const restaurantId = req.user?.restaurant_id || (order && order.restaurant_id) || 1;

    if (!order || !items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Order and items payload are required for printing.' });
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
        if (print_type === 'KOT') {
          targetPrinter = await PrinterRepository.getDefaultKOTPrinter(restaurantId);
        } else {
          targetPrinter = await PrinterRepository.getDefaultReceiptPrinter(restaurantId);
        }
      }
      if (!targetPrinter) {
        const printers = await PrinterRepository.getAll(restaurantId);
        targetPrinter = printers.find(p => (print_type === 'KOT' ? p.is_default_kot === 1 : p.is_default_receipt === 1) && (p.type === 'lan' || p.type === 'network' || !!p.ip_address))
          || printers.find(p => p.type === 'lan' || p.type === 'network' || !!p.ip_address)
          || printers.find(p => (print_type === 'KOT' ? p.role === 'kitchen' : p.role === 'receipt'))
          || printers[0];
      }

      // If no printer configured or missing IP, auto-resolve and sync dynamically from local network
      if (!targetPrinter || !targetPrinter.ip_address) {
        targetPrinter = await PrinterService.autoResolveAndSyncPrinter(restaurantId);
      }

      if (!targetPrinter || !targetPrinter.ip_address) {
        return res.status(404).json({ success: false, error: 'No thermal printer configured or detected on this local network.' });
      }

      let targetIp = targetPrinter.ip_address;
      let targetPort = parseInt(targetPrinter.port || 9100, 10);

      const receiptSettings = await ReceiptRepository.getSettings(restaurantId);
      const restaurantInfo = {
        name: (req.user && req.user.restaurant_name) || (receiptSettings && receiptSettings.restaurant_name) || 'Ariso Retail',
        address: (receiptSettings && receiptSettings.address) || '',
        phone: (receiptSettings && receiptSettings.phone) || ''
      };

      let bufferPayload = null;
      if (payload_base64 && typeof payload_base64 === 'string') {
        bufferPayload = Buffer.from(payload_base64, 'base64');
      } else if (print_type === 'KOT') {
        bufferPayload = PrinterService.buildKOTPayload(order, items, targetPrinter, receiptSettings);
      } else {
        bufferPayload = await PrinterService.buildReceiptPayload(order, items, restaurantInfo, targetPrinter, receiptSettings);
      }

      const base64ForQueue = bufferPayload.toString('base64');

      // 1. Enqueue job into print_queue for audit / queue history
      let jobId = null;
      try {
        jobId = await PrintQueueRepository.enqueue({
          restaurant_id: restaurantId,
          order_id: order.id || null,
          printer_id: targetPrinter.id,
          print_type: print_type || 'RECEIPT',
          payload_base64: base64ForQueue,
          backend_received_at: new Date()
        });
      } catch (qErr) {
        console.warn('[Print Queue Enqueue Warning]', qErr.message);
      }

      // 2. Direct Local LAN Socket Print Attempt with Dynamic Auto-Reconnect Recovery
      let printResult = null;
      try {
        printResult = await PrinterService.sendToPrinterSocket(
          targetIp,
          targetPort,
          bufferPayload
        );

        // Update printer status in database to online
        await PrinterRepository.updateStatus(targetPrinter.id, restaurantId, 'online').catch(() => {});

        if (jobId) {
          await PrintQueueRepository.updateJobStatus(jobId, 'SUCCESS', null).catch(() => {});
        }

        return res.json({
          success: true,
          job_id: jobId,
          message: `${print_type === 'KOT' ? 'KOT' : 'Receipt'} printed over LAN to ${targetPrinter.name} (${targetIp}:${targetPort})`,
          printer: targetPrinter.name,
          details: printResult
        });
      } catch (socketErr) {
        console.warn(`[Direct Socket Error] Direct LAN print to ${targetPrinter.name} (${targetIp}:${targetPort}) failed:`, socketErr.message);

        // IP change / DHCP reconnection recovery attempt
        try {
          console.log(`[Printer Recovery] Attempting auto-discovery to check for dynamic IP reassignment...`);
          const recovered = await PrinterService.autoResolveAndSyncPrinter(restaurantId);
          if (recovered && recovered.ip_address && (recovered.ip_address !== targetIp || recovered.port !== targetPort)) {
            console.log(`[Printer Recovered] Found printer at new dynamic IP ${recovered.ip_address}:${recovered.port || 9100}. Retrying print...`);
            targetIp = recovered.ip_address;
            targetPort = parseInt(recovered.port || 9100, 10);
            targetPrinter = recovered;

            printResult = await PrinterService.sendToPrinterSocket(targetIp, targetPort, bufferPayload);
            await PrinterRepository.updateStatus(targetPrinter.id, restaurantId, 'online').catch(() => {});
            if (jobId) {
              await PrintQueueRepository.updateJobStatus(jobId, 'SUCCESS', null).catch(() => {});
            }
            return res.json({
              success: true,
              job_id: jobId,
              message: `${print_type === 'KOT' ? 'KOT' : 'Receipt'} printed over LAN to ${targetPrinter.name} (${targetIp}:${targetPort})`,
              printer: targetPrinter.name,
              details: printResult
            });
          }
        } catch (recoveryErr) {
          console.warn('[Printer Dynamic Recovery Error]', recoveryErr.message);
        }

        // Mark printer status in database to offline
        await PrinterRepository.updateStatus(targetPrinter.id, restaurantId, 'offline').catch(() => {});

        if (jobId) {
          await PrintQueueRepository.updateJobStatus(jobId, 'FAILED', socketErr.message).catch(() => {});
        }

        return res.status(502).json({
          success: false,
          error: `LAN Thermal Printer "${targetPrinter.name}" (${targetIp}:${targetPort}) is offline or unreachable on this network. Please ensure the printer is turned on and connected to the same Wi-Fi/network.`
        });
      }
    } catch (err) {
      console.error('[LAN Print Receipt Error]:', err.message);
      return res.status(500).json({
        success: false,
        error: `Failed to process print request: ${err.message}`
      });
    }
  }
}

module.exports = PrinterController;
