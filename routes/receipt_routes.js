const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles } = require('../middlewares/auth_middleware');
const ReceiptRepository = require('../repositories/receipt_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const PrinterRepository = require('../repositories/printer_repository');
const PrinterService = require('../services/printer_service');

// GET /api/settings/receipt/logo-bytes - Fetch base64 ESC/POS logo bytes
router.get('/logo-bytes', authenticateToken, async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id || 1;
    const settings = await ReceiptRepository.getByRestaurantId(restaurantId);
    if (!settings || settings.show_logo === 0 || !settings.logo_url) {
      return res.json({ bytes: '' });
    }

    const paperWidth = req.query.paper_width === '58mm' ? '58' : '80';
    const logoBuffer = await PrinterService.getLogoEscPosBytes(settings.logo_url, paperWidth);
    
    return res.json({ bytes: logoBuffer.toString('base64') });
  } catch (err) {
    console.error('Fetch receipt logo bytes error:', err);
    return res.status(500).json({ error: 'Failed to build receipt logo bytes: ' + err.message });
  }
});

// GET /api/settings/receipt - Fetch settings
router.get('/', authenticateToken, async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id || req.query.restaurant_id || 1;
    const settings = await ReceiptRepository.getByRestaurantId(restaurantId);
    return res.json(settings);
  } catch (err) {
    console.error('Fetch receipt settings error:', err);
    return res.status(500).json({ error: 'Failed to load receipt settings: ' + err.message });
  }
});

// POST /api/settings/receipt - Update settings (Admin/Manager only)
router.post('/', authenticateToken, authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id || req.body.restaurant_id || 1;
    const updatedSettings = await ReceiptRepository.update(restaurantId, req.body);
    return res.json({ message: 'Receipt & KOT settings updated successfully.', settings: updatedSettings });
  } catch (err) {
    console.error('Update receipt settings error:', err);
    return res.status(500).json({ error: 'Failed to update receipt settings: ' + err.message });
  }
});

// POST /api/settings/receipt/test-print - Test print sample receipt & KOT
router.post('/test-print', authenticateToken, authorizeRoles('admin', 'manager', 'super_admin', 'superadmin'), async (req, res) => {
  try {
    const restaurantId = req.user.restaurant_id || req.body.restaurant_id || 1;
    const printType = (req.body.print_type || 'BOTH').toUpperCase(); // RECEIPT, KOT, or BOTH

    // Sample mock order for test print
    const sampleOrder = {
      id: 99999,
      unique_order_number: 'TEST-999',
      cashier_name: req.user.name || 'Admin Tester',
      subtotal: 350.00,
      discount_amount: 25.00,
      tax_amount: 16.25,
      total_amount: 341.25,
      payment_mode: 'CASH',
      table_number_or_takeaway: 'Table #4',
      notes: 'Customer prefers medium spice',
      created_at: new Date()
    };

    const sampleItems = [
      { menu_item_id: 101, name: 'Paneer Butter Masala', quantity: 1, price: 220.00, notes: 'Extra Gravy' },
      { menu_item_id: 102, name: 'Garlic Naan', quantity: 2, price: 40.00, notes: 'Crispy' },
      { menu_item_id: 103, name: 'Mango Lassi', quantity: 1, price: 50.00 }
    ];

    const restaurant = (await SuperAdminRepository.getRestaurantById(restaurantId)) || { name: req.user.restaurant_name || 'RESTAURANT POS' };
    const receiptSettings = await ReceiptRepository.getByRestaurantId(restaurantId);

    const results = [];
    const errors = [];

    const sendTestJob = async (type) => {
      let printer = null;
      if (type === 'RECEIPT') {
        printer = await PrinterRepository.getDefaultReceiptPrinter(restaurantId);
      } else if (type === 'KOT') {
        printer = await PrinterRepository.getDefaultKOTPrinter(restaurantId);
      }

      if (!printer) {
        const allPrinters = await PrinterRepository.getAll(restaurantId);
        printer = allPrinters.find(p => p.is_active === 1) || allPrinters[0] || null;
      }

      if (!printer) {
        throw new Error(`No active printer found for ${type}. Please add a printer in Printers tab first.`);
      }

      const payload = type === 'KOT'
        ? PrinterService.buildKOTPayload(sampleOrder, sampleItems, printer, receiptSettings)
        : PrinterService.buildReceiptPayload(sampleOrder, sampleItems, restaurant, printer, receiptSettings);

      const targetIp = printer.ip_address || '127.0.0.1';
      const targetPort = printer.port || 9100;

      await PrinterService.sendToPrinterSocket(targetIp, targetPort, payload);
      await PrinterRepository.updateStatus(printer.id, restaurantId, 'online');
      
      return `${type} sent to "${printer.name}" (${targetIp}:${targetPort})`;
    };

    if (printType === 'RECEIPT' || printType === 'BOTH') {
      try {
        const msg = await sendTestJob('RECEIPT');
        results.push(msg);
      } catch (err) {
        console.error('Receipt test print error:', err.message);
        errors.push(`Receipt error: ${err.message}`);
      }
    }

    if (printType === 'KOT' || printType === 'BOTH') {
      try {
        const msg = await sendTestJob('KOT');
        results.push(msg);
      } catch (err) {
        console.error('KOT test print error:', err.message);
        errors.push(`KOT error: ${err.message}`);
      }
    }

    if (errors.length > 0 && results.length === 0) {
      return res.status(500).json({ error: errors.join(' | ') });
    }

    let message = results.join(' & ');
    if (errors.length > 0) {
      message += ` (Warnings: ${errors.join(' | ')})`;
    }

    return res.json({ message: `Test print successful! ${message}` });
  } catch (err) {
    console.error('Test print route error:', err);
    return res.status(500).json({ error: err.message || 'Failed to execute test print.' });
  }
});

module.exports = router;
