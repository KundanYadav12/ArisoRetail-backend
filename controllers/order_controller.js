const OrderRepository = require('../repositories/order_repository');
const UserRepository = require('../repositories/user_repository');
const PrinterRepository = require('../repositories/printer_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const PrinterService = require('../services/printer_service');
const { generateExcelWorkbook } = require('../utils/excel_helper');
const PdfReceiptService = require('../services/pdf_receipt_service');
const ReceiptRepository = require('../repositories/receipt_repository');

class OrderController {
  static async create(req, res) {
    const allowedRoles = ['cashier', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN_ROLE',
        message: 'Order placement is restricted to authorized staff accounts.'
      });
    }

    const { 
      items, payment_mode, payment_details, subtotal, tax_amount, discount_amount, total_amount, 
      table_number_or_takeaway, notes, status, discount_type, discount_value, customer_name, customer_phone, print_actions,
      idempotency_key, offline_id, tax_type
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one item.' });
    }

    const orderStatus = status || 'completed';
    if (!payment_mode && orderStatus !== 'pending' && orderStatus !== 'confirmed') {
      return res.status(400).json({ error: 'Payment mode is required.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const cashierId = req.user.id;
      const cashierName = req.user.name;
      const shiftId = req.user.shift_id; // Added by login auth token

      if (!shiftId && req.user.role === 'cashier') {
        return res.status(400).json({ error: 'No active shift found. Please log in again to open a shift.' });
      }

      const safeIdempotencyKey = idempotency_key || offline_id || null;

      // Consolidate order insert parameters
      const orderData = {
        cashier_id: cashierId,
        cashier_name: cashierName,
        subtotal: parseFloat(subtotal),
        tax_amount: parseFloat(tax_amount),
        discount_amount: parseFloat(discount_amount || 0),
        total_amount: parseFloat(total_amount),
        payment_mode: payment_mode || 'pending',
        payment_details,
        cashier_shift_id: shiftId || 1, // Fallback for managers/admins placing orders
        table_number_or_takeaway: table_number_or_takeaway || 'Takeaway',
        notes,
        status: orderStatus,
        discount_type,
        discount_value,
        customer_name,
        customer_phone,
        idempotency_key: safeIdempotencyKey,
        tax_type: tax_type || 'intra'
      };

      // Transactional save to DB
      const result = await OrderRepository.create(restaurantId, orderData, items);
      const createdOrder = result.order;

      try {
        await SuperAdminRepository.addAuditLog(restaurantId, cashierId, 'ORDER_PLACE', `Placed order #${createdOrder.unique_order_number} for Rs. ${createdOrder.total_amount} [Status: ${orderStatus}]`, req.ip);
      } catch (aErr) {
        console.warn('[Order Audit Log Warning]:', aErr.message);
      }

      // Enqueue print jobs to database print_queue
      try {
        PrinterService.enqueueOrderPrintJobs(restaurantId, createdOrder.id, print_actions);
      } catch (pErr) {
        console.error('[Order Placement Print Enqueue Warning]:', pErr.message);
      }

      // Return immediately
      return res.status(201).json({
        message: 'Order placed successfully.',
        orderNumber: createdOrder.unique_order_number,
        orderId: createdOrder.id
      });
    } catch (err) {
      console.error('Order creation error:', err);
      return res.status(500).json({ error: err.message || 'Failed to process order. Please try again.' });
    }
  }

  static async getAll(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const filters = {
        cashier_id: req.query.cashier_id,
        order_status: req.query.order_status,
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        limit: req.query.limit,
        offset: req.query.offset
      };

      const orders = await OrderRepository.getAll(restaurantId, filters);
      return res.json(orders);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve orders.' });
    }
  }

  static async getById(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const order = await OrderRepository.getById(req.params.id, restaurantId);
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      return res.json(order);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve order details.' });
    }
  }

  static async updateStatus(req, res) {
    const { status, payment_mode, payment_details } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }

    const role = (req.user.role || '').toLowerCase();
    if (role === 'cashier' && status !== 'completed') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Cashiers are only authorized to mark held orders as completed.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const shiftId = req.user.shift_id;
      const success = await OrderRepository.updateOrderStatus(req.params.id, restaurantId, status, payment_mode, payment_details, shiftId);
      if (!success) {
        return res.status(404).json({ error: 'Order not found or unauthorized.' });
      }

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'ORDER_STATUS_UPDATE', `Updated order (ID: ${req.params.id}) status to: ${status}`, req.ip);
      
      // If completed, trigger Stage 2 print
      if (status === 'completed') {
        const { print_actions } = req.body;
        PrinterService.enqueueOrderPrintJobs(restaurantId, req.params.id, print_actions);
      }

      return res.json({ message: 'Order status updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update order status.' });
    }
  }

  static async updateKitchenStatus(req, res) {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Kitchen status is required.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const success = await OrderRepository.updateKitchenStatus(req.params.id, restaurantId, status);
      if (!success) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      return res.json({ message: 'Kitchen status updated successfully.' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update kitchen status.' });
    }
  }

  static async reprint(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderData = await OrderRepository.getById(req.params.id, restaurantId);
      if (!orderData) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      // Validate order reprint age window based on role (12h for cashier, 15d default for admin)
      const orderDate = new Date(orderData.order.created_at);
      const orderAgeMs = Date.now() - orderDate.getTime();
      const role = (req.user.role || '').toLowerCase();

      if (role === 'cashier') {
        const twelveHoursMs = 12 * 60 * 60 * 1000;
        if (orderAgeMs > twelveHoursMs) {
          return res.status(403).json({ error: 'LIMIT_EXCEEDED', message: 'Cashiers are restricted to reprinting receipts within a 12-hour window only.' });
        }
      } else {
        const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
        if (orderAgeMs > fifteenDaysMs) {
          return res.status(403).json({ error: 'LIMIT_EXCEEDED', message: 'Admins are restricted to reprinting receipts within a 15-day window by default.' });
        }
      }

      // Trigger dynamic in-memory reprint queue job
      await PrinterService.reprintOrder(restaurantId, req.params.id);
      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'ORDER_REPRINT', `Reprinted order receipt #${orderData.order.unique_order_number}`, req.ip);

      return res.json({
        message: 'Reprint job enqueued successfully.',
        orderNumber: orderData.order.unique_order_number
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to process reprint.' });
    }
  }

  static async getReceiptPdf(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderData = await OrderRepository.getById(req.params.id, restaurantId);
      if (!orderData || !orderData.order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      const receiptSettings = await ReceiptRepository.getByRestaurantId(restaurantId);
      const restaurantInfo = await SuperAdminRepository.getRestaurantById(restaurantId);

      const pdfBuffer = await PdfReceiptService.generate(
        orderData.order,
        orderData.items,
        restaurantInfo || { name: req.user.restaurant_name || 'Retail POS' },
        receiptSettings
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=receipt_${orderData.order.unique_order_number || orderData.order.id}.pdf`);
      return res.send(pdfBuffer);
    } catch (err) {
      console.error('[getReceiptPdf error]:', err);
      return res.status(500).json({ error: 'Failed to generate PDF receipt.' });
    }
  }

  static async getHistory(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const role = (req.user.role || '').toLowerCase();

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = req.query.offset !== undefined ? Math.max(0, parseInt(req.query.offset)) : (page - 1) * limit;

      const filters = {
        order_status: req.query.order_status && req.query.order_status !== 'all' ? req.query.order_status : undefined,
        payment_mode: req.query.payment_mode && req.query.payment_mode !== 'all' ? req.query.payment_mode : undefined,
        search: req.query.search,
        limit,
        offset,
        page
      };

      if (role === 'cashier') {
        filters.cashier_id = req.user.id;
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        filters.date_from = twelveHoursAgo.toISOString().slice(0, 19).replace('T', ' ');
      } else {
        if (req.query.cashier_id && req.query.cashier_id !== 'all') {
          filters.cashier_id = req.query.cashier_id;
        }
        
        if (req.query.date_from) {
          const rawFrom = req.query.date_from.trim();
          filters.date_from = rawFrom.length === 10 ? `${rawFrom} 00:00:00` : rawFrom;
        } else {
          // Default 15 days retention filter limit
          const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
          filters.date_from = fifteenDaysAgo.toISOString().slice(0, 19).replace('T', ' ');
        }

        if (req.query.date_to) {
          const rawTo = req.query.date_to.trim();
          filters.date_to = rawTo.length === 10 ? `${rawTo} 23:59:59` : rawTo;
        }
      }

      const result = await OrderRepository.getHistory(restaurantId, filters);
      return res.json(result);
    } catch (err) {
      console.error('Failed to retrieve order history:', err);
      return res.status(500).json({ error: 'Failed to retrieve order history.' });
    }
  }

  static async exportHistoryExcel(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const role = (req.user.role || '').toLowerCase();
      
      const filters = {
        order_status: req.query.order_status && req.query.order_status !== 'all' ? req.query.order_status : undefined,
        payment_mode: req.query.payment_mode && req.query.payment_mode !== 'all' ? req.query.payment_mode : undefined,
        search: req.query.search
      };

      if (role === 'cashier') {
        filters.cashier_id = req.user.id;
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        filters.date_from = twelveHoursAgo.toISOString().slice(0, 19).replace('T', ' ');
      } else {
        if (req.query.cashier_id && req.query.cashier_id !== 'all') filters.cashier_id = req.query.cashier_id;
        if (req.query.date_from) filters.date_from = req.query.date_from;
        if (req.query.date_to) filters.date_to = req.query.date_to;
      }

      const orders = await OrderRepository.getHistory(restaurantId, filters);

      const columns = [
        { header: 'Order Number', key: 'unique_order_number', width: 22 },
        { header: 'Cashier', key: 'cashier_name', width: 18 },
        { header: 'Date & Time', key: 'created_at', width: 20 },
        { header: 'Subtotal (Rs)', key: 'subtotal', width: 14 },
        { header: 'Tax (Rs)', key: 'tax_amount', width: 14 },
        { header: 'Discount (Rs)', key: 'discount_amount', width: 14 },
        { header: 'Total Amount (Rs)', key: 'total_amount', width: 16 },
        { header: 'Payment Mode', key: 'payment_mode', width: 14 },
        { header: 'Order Status', key: 'order_status', width: 14 },
        { header: 'Customer Name', key: 'customer_name', width: 18 },
        { header: 'Customer Phone', key: 'customer_phone', width: 16 }
      ];

      const rows = orders.map(order => ({
        unique_order_number: order.unique_order_number || '',
        cashier_name: order.cashier_name || '',
        created_at: new Date(order.created_at).toLocaleString(),
        subtotal: parseFloat(order.subtotal || 0).toFixed(2),
        tax_amount: parseFloat(order.tax_amount || 0).toFixed(2),
        discount_amount: parseFloat(order.discount_amount || 0).toFixed(2),
        total_amount: parseFloat(order.total_amount || 0).toFixed(2),
        payment_mode: (order.payment_mode || '').toUpperCase(),
        order_status: (order.order_status || '').toUpperCase(),
        customer_name: order.customer_name || 'N/A',
        customer_phone: order.customer_phone || 'N/A'
      }));

      const buffer = await generateExcelWorkbook({
        sheetName: 'Order History',
        columns,
        data: rows
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=order_history_${new Date().toISOString().slice(0, 10)}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate order history Excel export.' });
    }
  }

  static async exportHistory(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const role = (req.user.role || '').toLowerCase();
      
      const filters = {
        order_status: req.query.order_status && req.query.order_status !== 'all' ? req.query.order_status : undefined,
        payment_mode: req.query.payment_mode && req.query.payment_mode !== 'all' ? req.query.payment_mode : undefined,
        search: req.query.search
      };

      if (role === 'cashier') {
        filters.cashier_id = req.user.id;
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        filters.date_from = twelveHoursAgo.toISOString().slice(0, 19).replace('T', ' ');
      } else {
        if (req.query.cashier_id && req.query.cashier_id !== 'all') filters.cashier_id = req.query.cashier_id;
        if (req.query.date_from) filters.date_from = req.query.date_from;
        if (req.query.date_to) filters.date_to = req.query.date_to;
      }

      const orders = await OrderRepository.getHistory(restaurantId, filters);

      let csv = 'Order Number,Cashier,Date,Subtotal,Tax,Discount,Total,Payment Mode,Status,Customer Name,Customer Phone\r\n';
      orders.forEach(order => {
        const dateStr = new Date(order.created_at).toLocaleString();
        const cleanCustName = (order.customer_name || '').replace(/,/g, ' ');
        csv += `"${order.unique_order_number}","${order.cashier_name}","${dateStr}",${parseFloat(order.subtotal).toFixed(2)},${parseFloat(order.tax_amount).toFixed(2)},${parseFloat(order.discount_amount).toFixed(2)},${parseFloat(order.total_amount).toFixed(2)},"${order.payment_mode}","${order.order_status}","${cleanCustName}","${order.customer_phone || ''}"\r\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=order_history_${new Date().toISOString().slice(0, 10)}.csv`);
      return res.send(csv);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate history CSV export.' });
    }
  }

  static async getShiftSummary(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      let shiftId = req.user.shift_id;

      if (!shiftId) {
        const openShift = await UserRepository.getOpenShift(restaurantId, req.user.id);
        if (openShift) {
          shiftId = openShift.id;
        }
      }

      if (!shiftId) {
        return res.json({
          id: null,
          starting_cash: 0,
          total_sales: 0,
          total_orders: 0,
          cash_sales: 0,
          upi_sales: 0,
          card_sales: 0,
          wallet_sales: 0,
          other_sales: 0,
          status: 'closed',
          opened_at: null,
          closed_at: null
        });
      }

      const shift = await OrderRepository.getShiftSummary(restaurantId, shiftId);
      if (!shift) {
        return res.json({
          id: shiftId,
          starting_cash: 0,
          total_sales: 0,
          total_orders: 0,
          cash_sales: 0,
          upi_sales: 0,
          card_sales: 0,
          wallet_sales: 0,
          other_sales: 0,
          status: 'open',
          opened_at: null,
          closed_at: null
        });
      }

      return res.json({
        id: shift.id,
        starting_cash: parseFloat(shift.starting_cash || 0),
        total_sales: parseFloat(shift.total_collected || 0),
        total_orders: parseInt(shift.total_bills || 0),
        cash_sales: parseFloat(shift.cash_collected || 0),
        upi_sales: parseFloat(shift.upi_collected || 0),
        card_sales: parseFloat(shift.card_collected || 0),
        wallet_sales: parseFloat(shift.wallet_collected || 0),
        other_sales: parseFloat(shift.other_collected || 0),
        status: shift.status,
        opened_at: shift.opened_at,
        closed_at: shift.closed_at
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to retrieve shift summary.' });
    }
  }
}

module.exports = OrderController;
