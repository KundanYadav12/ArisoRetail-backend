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
   * Scan active local Wi-Fi / subnet and USB ports for thermal printers
   */
  static async discoverPrinters(req, res) {
    try {
      const restaurantId = req.user?.restaurant_id || 1;
      const PrinterService = require('../services/printer_service');
      const discovered = await PrinterService.discoverAllPrinters();

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

  /**
   * Return local Windows installed printers dynamically
   */
  static async getSystemPrinters(req, res) {
    try {
      const PrinterService = require('../services/printer_service');
      const printers = await PrinterService.getSystemPrinters();
      return res.json({ success: true, printers });
    } catch (err) {
      console.error('[Get System Printers Error]', err);
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
    if (!name) {
      return res.status(400).json({ error: 'Printer Name is required.' });
    }
    if (type !== 'usb' && !ip_address) {
      return res.status(400).json({ error: 'IP Address is required for network printers.' });
    }

    try {
      const restaurantId = req.user?.restaurant_id || 1;
      const printerId = await PrinterRepository.create(restaurantId, {
        name, type: type || (ip_address ? 'lan' : 'usb'), ip_address: ip_address || null, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer
      });

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'PRINTER_CREATE', `Added printer: ${name} (${ip_address || 'USB'})`, req.ip);
      return res.status(201).json({ message: 'Printer added successfully.', id: printerId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to add printer.' });
    }
  }

  static async update(req, res) {
    const { name, type, ip_address, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer, is_active, status } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Printer Name is required.' });
    }
    if (type !== 'usb' && !ip_address) {
      return res.status(400).json({ error: 'IP Address is required for network printers.' });
    }

    try {
      const restaurantId = req.user?.restaurant_id || 1;
      const success = await PrinterRepository.update(req.params.id, restaurantId, {
        name, type: type || (ip_address ? 'lan' : 'usb'), ip_address: ip_address || null, port, paper_width, character_encoding, role, is_default_receipt, is_default_kot, auto_cut, cash_drawer, is_active, status
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
   * Test connection & print test receipt/label on LAN or USB thermal printer
   */
  static async testConnection(req, res) {
    const { id, ip_address, port, paper_width, name, type } = req.body;
    const restaurantId = req.user?.restaurant_id || 1;
    const PrinterService = require('../services/printer_service');

    let targetIp = ip_address;
    let targetPort = parseInt(port || 9100, 10);
    let targetName = name || '';
    let targetWidth = paper_width || '80';
    let targetType = type || (targetIp ? 'lan' : 'usb');

    if (id) {
      const prn = await PrinterRepository.getById(id, restaurantId);
      if (prn) {
        targetIp = targetIp || prn.ip_address;
        targetPort = parseInt(targetPort || prn.port || 9100, 10);
        targetName = targetName || prn.name;
        targetWidth = targetWidth || prn.paper_width || '80';
        targetType = prn.type || targetType;
      }
    }

    // Check if target is a local Windows USB printer
    const sysPrinters = await PrinterService.getSystemPrinters();
    const matchedSys = sysPrinters.find(p => p.name.toLowerCase() === (targetName || '').toLowerCase());

    if (matchedSys || targetType === 'usb' || (!targetIp && targetName)) {
      const printerToTest = matchedSys ? matchedSys.name : targetName;
      const isLabel = matchedSys ? matchedSys.is_label : /label|barcode|tsc|te244|zebra|zpl/i.test(targetName);

      try {
        if (isLabel) {
          const testLabel = PrinterService.buildTsplLabel({
            storeName: 'ARISO RETAIL',
            productName: 'TEST BARCODE LABEL',
            barcode: 'ARISO-TEST-01',
            price: 99.00,
            copies: 1
          });
          const result = await PrinterService.sendToWindowsSpooler(printerToTest, Buffer.from(testLabel, 'utf8'), 'Ariso Retail Test Label');
          if (id) {
            await PrinterRepository.updateStatus(id, restaurantId, 'online').catch(() => {});
          }
          return res.json({
            status: 'connected',
            success: true,
            message: `Successfully printed test barcode label to "${printerToTest}"!`,
            printer: { name: printerToTest, type: 'usb', protocol: 'tspl' },
            details: result
          });
        } else {
          const cols = (targetWidth === 58 || targetWidth === '58') ? 32 : 48;
          let testReceipt = '\x1B@\x1Ba\x01\x1BE\x01ARISO RETAIL POS\n\x1BE\x00';
          testReceipt += '--------------------------------\n';
          testReceipt += `Printer: ${printerToTest}\nType: USB Spooler\n`;
          testReceipt += `Date: ${new Date().toLocaleString()}\n`;
          testReceipt += '*** TEST PRINT SUCCESSFUL ***\n\n\n\n\x1DV\x41\x03';
          const result = await PrinterService.sendToWindowsSpooler(printerToTest, Buffer.from(testReceipt, 'utf8'), 'Ariso Retail Test Receipt');
          if (id) {
            await PrinterRepository.updateStatus(id, restaurantId, 'online').catch(() => {});
          }
          return res.json({
            status: 'connected',
            success: true,
            message: `Successfully printed test receipt to "${printerToTest}"!`,
            printer: { name: printerToTest, type: 'usb', protocol: 'escpos' },
            details: result
          });
        }
      } catch (err) {
        if (id) {
          await PrinterRepository.updateStatus(id, restaurantId, 'offline').catch(() => {});
        }
        return res.status(502).json({
          status: 'failed',
          success: false,
          error: `Failed to print to local printer "${printerToTest}": ${err.message}`
        });
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
        error: 'No printer IP address specified and no supported printer detected on this system or local network.'
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
   * Directly print a product barcode/label to connected USB label printer or LAN printer
   */
  static async printLabel(req, res) {
    try {
      const restaurantId = req.user?.restaurant_id || 1;
      const { printer_id, printer_name, label_data, copies, product_id, barcode, sku, productName, price, mrp, payload_base64 } = req.body;
      const PrinterService = require('../services/printer_service');

      console.log('[POST /api/printers/print-label] Received label print request:', {
        printer_name,
        printer_id,
        has_payload_base64: !!payload_base64,
        copies,
        product_id,
        barcode: barcode || label_data?.barcode,
        sku: sku || label_data?.sku,
        productName: productName || label_data?.productName || label_data?.name
      });

      // Direct raw TSPL spooler payload printing (exact ScanGo architecture)
      if (payload_base64) {
        const payloadBuffer = Buffer.from(payload_base64, 'base64');
        const targetPrinterName = printer_name || 'TSC TE244';
        const spoolResult = await PrinterService.sendToWindowsSpooler(targetPrinterName, payloadBuffer, 'Ariso Barcode Label');
        console.log('[POST /api/printers/print-label] Sent payload_base64 to spooler:', { targetPrinterName, bytes: payloadBuffer.length, spoolResult });
        return res.json({
          success: true,
          protocol: 'tspl',
          printer: { name: targetPrinterName, type: 'usb' },
          message: `Successfully printed barcode stickers on "${targetPrinterName}"!`,
          details: spoolResult
        });
      }

      let resolvedLabelData = { ...(label_data || {}) };

      // Ensure direct body properties are merged into resolvedLabelData
      if (!resolvedLabelData.productName) {
        resolvedLabelData.productName = productName || req.body.name || req.body.item_name || '';
      }
      if (!resolvedLabelData.barcode) {
        resolvedLabelData.barcode = barcode || req.body.serial_number || '';
      }
      if (!resolvedLabelData.sku) {
        resolvedLabelData.sku = sku || '';
      }
      if (price !== undefined && price !== null && resolvedLabelData.price === undefined) {
        resolvedLabelData.price = price;
      }
      if (mrp !== undefined && mrp !== null && resolvedLabelData.mrp === undefined) {
        resolvedLabelData.mrp = mrp;
      }

      // If product_id, barcode or sku provided and productName still missing, query item details
      if (!resolvedLabelData.productName && (product_id || resolvedLabelData.barcode || resolvedLabelData.sku)) {
        const pool = require('../config/db');
        let itemRow = null;
        if (product_id) {
          const [rows] = await pool.execute('SELECT * FROM menu_items WHERE id = ?', [product_id]);
          itemRow = rows[0];
        } else if (resolvedLabelData.barcode) {
          const [rows] = await pool.execute('SELECT * FROM menu_items WHERE barcode = ? LIMIT 1', [resolvedLabelData.barcode]);
          itemRow = rows[0];
        } else if (resolvedLabelData.sku) {
          const [rows] = await pool.execute('SELECT * FROM menu_items WHERE sku = ? LIMIT 1', [resolvedLabelData.sku]);
          itemRow = rows[0];
        }

        if (itemRow) {
          resolvedLabelData = {
            ...resolvedLabelData,
            productName: resolvedLabelData.productName || itemRow.name,
            barcode: resolvedLabelData.barcode || itemRow.barcode || itemRow.sku || String(itemRow.id),
            sku: resolvedLabelData.sku || itemRow.sku || '',
            price: (resolvedLabelData.price !== undefined && resolvedLabelData.price !== null) ? resolvedLabelData.price : itemRow.price,
            mrp: (resolvedLabelData.mrp !== undefined && resolvedLabelData.mrp !== null) ? resolvedLabelData.mrp : itemRow.mrp
          };
        }
      }

      // Price fallback if one is missing
      if ((resolvedLabelData.price === undefined || resolvedLabelData.price === null || Number(resolvedLabelData.price) <= 0) && resolvedLabelData.mrp) {
        resolvedLabelData.price = resolvedLabelData.mrp;
      }
      if ((resolvedLabelData.mrp === undefined || resolvedLabelData.mrp === null || Number(resolvedLabelData.mrp) <= 0) && resolvedLabelData.price) {
        resolvedLabelData.mrp = resolvedLabelData.price;
      }

      if (!resolvedLabelData.storeName) {
        resolvedLabelData.storeName = req.user?.restaurant_name || 'ARISO RETAIL';
      }

      console.log('[POST /api/printers/print-label] Printing resolved label data:', {
        printer_name,
        storeName: resolvedLabelData.storeName,
        productName: resolvedLabelData.productName,
        price: resolvedLabelData.price,
        mrp: resolvedLabelData.mrp,
        barcode: resolvedLabelData.barcode,
        rows: resolvedLabelData.rows,
        copies: copies || 1
      });

      const result = await PrinterService.printBarcodeLabel(restaurantId, {
        printer_id: printer_id || null,
        printer_name: printer_name || null,
        label_data: resolvedLabelData,
        copies: copies || 1
      });

      return res.json(result);
    } catch (err) {
      console.error('[Print Label Error]:', err);
      return res.status(500).json({ success: false, error: err.message });
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
