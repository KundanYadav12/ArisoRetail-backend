const OrderRepository = require('../repositories/order_repository');
const UserRepository = require('../repositories/user_repository');
const PrinterRepository = require('../repositories/printer_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const PrinterService = require('../services/printer_service');
const { generateExcelWorkbook } = require('../utils/excel_helper');
const PdfReceiptService = require('../services/pdf_receipt_service');
const ReceiptRepository = require('../repositories/receipt_repository');
const EmailService = require('../services/email_service');
const { getISTDateString } = require('../utils/date_utils');

class OrderController {
  static async create(req, res) {
    const allowedRoles = ['cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN_ROLE',
        message: 'Order placement is restricted to authorized staff accounts.'
      });
    }

    const { 
      items, payment_mode, payment_details, subtotal, tax_amount, discount_amount, total_amount, 
      table_number_or_takeaway, notes, status, discount_type, discount_value, 
      customer_id, customer_name, customer_phone, customer_address, store_name, salesman_id, salesman_name,
      print_actions, idempotency_key, offline_id, tax_type,
      delivery_date, billing_address, shipping_address, place_of_supply, price_list, reference_number,
      additional_charges, is_sales_order, kitchen_status
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
      const cashierShiftId = shiftId || 1;
      const sanitizedItems = items;

      // Determine salesman info if placed by salesman or admin/manager acting as seller
      const isSalesUser = ['salesman', 'admin', 'manager'].includes(req.user.role);
      const effectiveSalesmanId = isSalesUser ? (salesman_id || req.user.id) : (salesman_id || null);
      const effectiveSalesmanName = isSalesUser ? (salesman_name || req.user.name) : (salesman_name || null);

      // Consolidate order insert parameters
      const orderData = {
        cashier_id: cashierId,
        cashier_name: cashierName,
        subtotal: parseFloat(subtotal),
        tax_amount: parseFloat(tax_amount),
        discount_amount: parseFloat(discount_amount || 0),
        total_amount: parseFloat(total_amount),
        payment_mode: payment_mode || 'pending',
        status: orderStatus,
        order_status: orderStatus,
        cashier_shift_id: cashierShiftId,
        table_number_or_takeaway: table_number_or_takeaway || 'takeaway',
        notes: notes || null,
        kitchen_status: kitchen_status || 'pending',
        discount_type: discount_type || null,
        discount_value: discount_value ? parseFloat(discount_value) : null,
        customer_id: customer_id || null,
        customer_name: customer_name || null,
        customer_phone: customer_phone || null,
        customer_address: customer_address || null,
        store_name: store_name || null,
        salesman_id: effectiveSalesmanId,
        salesman_name: effectiveSalesmanName,
        tax_type: tax_type || 'intra',
        delivery_date: delivery_date || null,
        billing_address: billing_address || customer_address || null,
        shipping_address: shipping_address || null,
        place_of_supply: place_of_supply || null,
        price_list: price_list || 'standard',
        reference_number: reference_number || null,
        additional_charges: additional_charges || null,
        is_sales_order: is_sales_order ? 1 : 0
      };

      const createdOrder = await OrderRepository.create(restaurantId, orderData, sanitizedItems, safeIdempotencyKey);
      const orderId = createdOrder.id || createdOrder.order?.id;
      const orderNumber = createdOrder.unique_order_number || createdOrder.order?.unique_order_number;

      try {
        PrinterService.enqueueOrderPrintJobs(restaurantId, orderId, print_actions);
      } catch (pErr) {
        console.error('[Order Placement Print Enqueue Warning]:', pErr.message);
      }

      // Return immediately
      return res.status(201).json({
        message: 'Order placed successfully.',
        orderNumber: orderNumber,
        orderId: orderId,
        order: createdOrder.order || createdOrder
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
        salesman_id: req.query.salesman_id,
        order_status: req.query.order_status || req.query.status,
        is_sales_order: req.query.is_sales_order,
        date_from: req.query.date_from,
        date_to: req.query.date_to,
        search: req.query.search,
        include_items: req.query.include_items === 'true' || req.query.include_items === true,
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
    if ((role === 'cashier' || role === 'salesman') && !['completed', 'cancelled'].includes(status)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Staff can only update orders to completed or cancelled.' });
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

  static async confirmOrder(req, res) {
    const allowedRoles = ['cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE', message: 'Unauthorized to confirm orders.' });
    }

    const { payment_mode, payment_details, print_actions } = req.body;
    try {
      const restaurantId = req.user.restaurant_id;
      const shiftId = req.user.shift_id || null;
      const result = await OrderRepository.confirmOrder(
        req.params.id,
        restaurantId,
        req.user.id,
        req.user.name,
        payment_mode,
        payment_details,
        shiftId
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error || 'Failed to confirm order.' });
      }

      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'ORDER_CONFIRM', `Confirmed pending order #${result.orderNumber} (ID: ${req.params.id})`, req.ip);

      // Enqueue print jobs if requested
      try {
        PrinterService.enqueueOrderPrintJobs(restaurantId, req.params.id, print_actions);
      } catch (pErr) {
        console.warn('[Order Confirm Print Enqueue Warning]:', pErr.message);
      }

      return res.json({
        message: 'Order confirmed successfully.',
        orderId: result.orderId,
        orderNumber: result.orderNumber
      });
    } catch (err) {
      console.error('[OrderController.confirmOrder error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to confirm order.' });
    }
  }

  /**
   * Convert Sales Order to Invoice (partial or full)
   */
  static async convertToInvoice(req, res) {
    const allowedRoles = ['cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE', message: 'Unauthorized to convert orders.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const salesOrderId = req.params.id;
      const { invoice_data = {}, items = [], print_actions } = req.body;
      const shiftId = req.user.shift_id || null;

      const result = await OrderRepository.convertToInvoice(
        salesOrderId,
        restaurantId,
        invoice_data,
        items,
        req.user.id,
        req.user.name,
        shiftId
      );

      await SuperAdminRepository.addAuditLog(
        restaurantId,
        req.user.id,
        'ORDER_INVOICE_CONVERT',
        `Converted Sales Order #${salesOrderId} to Invoice #${result.invoiceNumber} (₹${result.grandTotal})`,
        req.ip
      ).catch(() => {});

      // Enqueue print jobs if requested
      if (print_actions) {
        try {
          PrinterService.enqueueOrderPrintJobs(restaurantId, result.invoiceId, print_actions);
        } catch (pErr) {
          console.warn('[Order Invoice Print Enqueue Warning]:', pErr.message);
        }
      }

      return res.status(201).json({
        message: 'Invoice created successfully.',
        ...result
      });
    } catch (err) {
      console.error('[OrderController.convertToInvoice error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to convert order to invoice.' });
    }
  }

  /**
   * Convert Estimate into a Sales Order
   */
  static async convertEstimateToSalesOrder(req, res) {
    const allowedRoles = ['cashier', 'salesman', 'admin', 'manager', 'owner', 'super_admin', 'superadmin'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE', message: 'Unauthorized to convert estimates.' });
    }

    try {
      const restaurantId = req.user.restaurant_id;
      const estimateId = req.params.id;

      const result = await OrderRepository.convertEstimateToSalesOrder(
        estimateId,
        restaurantId,
        req.user.id,
        req.user.name
      );

      await SuperAdminRepository.addAuditLog(
        restaurantId,
        req.user.id,
        'ESTIMATE_CONVERT',
        `Converted Estimate #${estimateId} to Sales Order #${result.salesOrderNumber}`,
        req.ip
      ).catch(() => {});

      return res.status(201).json({
        message: 'Estimate converted to Sales Order successfully.',
        ...result
      });
    } catch (err) {
      console.error('[OrderController.convertEstimateToSalesOrder error]:', err);
      return res.status(400).json({ error: err.message || 'Failed to convert estimate.' });
    }
  }

  /**
   * Get connected document timeline (Estimate -> SO -> Challans -> Invoices)
   */
  static async getOrderTimeline(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const timeline = await OrderRepository.getOrderTimeline(req.params.id, restaurantId);
      if (!timeline) {
        return res.status(404).json({ error: 'Order not found.' });
      }
      return res.json(timeline);
    } catch (err) {
      console.error('[OrderController.getOrderTimeline error]:', err);
      return res.status(500).json({ error: 'Failed to fetch order timeline.' });
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
      res.setHeader('Content-Disposition', `attachment; filename=order_history_${getISTDateString()}.xlsx`);
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
      res.setHeader('Content-Disposition', `attachment; filename=order_history_${getISTDateString()}.csv`);
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

  static async update(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const { 
        items, subtotal, tax_amount, discount_amount, total_amount, 
        customer_id, customer_name, customer_phone, notes, 
        delivery_date, billing_address, shipping_address, place_of_supply, 
        price_list, reference_number, additional_charges 
      } = req.body;

      const orderData = {
        subtotal,
        tax_amount,
        discount_amount,
        total_amount,
        customer_id,
        customer_name,
        customer_phone,
        notes,
        delivery_date,
        billing_address,
        shipping_address,
        place_of_supply,
        price_list,
        reference_number,
        additional_charges
      };

      const result = await OrderRepository.updateSalesOrder(orderId, restaurantId, orderData, items);
      await SuperAdminRepository.addAuditLog(restaurantId, req.user.id, 'ORDER_UPDATE', `Updated sales order (ID: ${orderId})`, req.ip);

      return res.json({ message: 'Sales order updated successfully.', ...result });
    } catch (err) {
      console.error('Update sales order error:', err);
      return res.status(400).json({ error: err.message || 'Failed to update sales order.' });
    }
  }

  static async sendVoucherEmail(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const orderId = req.params.id;
      const { recipient_email } = req.body;

      if (!recipient_email) {
        return res.status(400).json({ error: 'Recipient email is required.' });
      }

      const orderDetails = await OrderRepository.getById(orderId, restaurantId);
      if (!orderDetails || !orderDetails.order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      const { order, items } = orderDetails;
      const storeName = req.user.restaurant_name || 'Ariso Retail';

      const itemsRowsHtml = (items || []).map((it, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 12px;">${idx + 1}</td>
          <td style="padding: 8px 12px;">${it.name || it.item_name}</td>
          <td style="padding: 8px 12px; text-align: center;">${it.item_weight ? `${it.item_weight} ${it.weight_unit || 'KG'}` : `${it.quantity} ${it.weight_unit || 'PCS'}`}</td>
          <td style="padding: 8px 12px; text-align: right;">₹${parseFloat(it.price || it.unit_price).toFixed(2)}</td>
          <td style="padding: 8px 12px; text-align: right;">${parseFloat(it.discount_amount || 0) > 0 ? `₹${parseFloat(it.discount_amount).toFixed(2)}` : '-'}</td>
          <td style="padding: 8px 12px; text-align: right;">${parseFloat(it.gst_rate || 0)}%</td>
          <td style="padding: 8px 12px; text-align: right; font-weight: bold;">₹${((parseFloat(it.price || it.unit_price) * (it.item_weight ? parseFloat(it.item_weight) : it.quantity)) - parseFloat(it.discount_amount || 0) + parseFloat(it.tax_amount || 0)).toFixed(2)}</td>
        </tr>
      `).join('');

      let additionalCharges = [];
      try {
        additionalCharges = typeof order.additional_charges === 'string' ? JSON.parse(order.additional_charges) : (order.additional_charges || []);
      } catch (e) {
        additionalCharges = [];
      }

      const chargesHtml = (additionalCharges || []).map(ch => `
        <tr>
          <td colspan="6" style="padding: 6px 12px; text-align: right;">${ch.name}:</td>
          <td style="padding: 6px 12px; text-align: right; font-weight: 500;">₹${parseFloat(ch.amount || 0).toFixed(2)}</td>
        </tr>
      `).join('');

      const subject = `Sales Order Voucher - #${order.unique_order_number || order.id} from ${storeName}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; color: #1e293b;">
          <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 20px;">
            <div>
              <h2 style="margin: 0; color: #1e40af;">${storeName}</h2>
              <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">SALES ORDER VOUCHER</p>
            </div>
            <div style="text-align: right;">
              <p style="margin: 0; font-size: 16px; font-weight: bold;">Order #: ${order.unique_order_number || order.id}</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Date: ${new Date(order.created_at).toLocaleDateString()}</p>
              ${order.delivery_date ? `<p style="margin: 4px 0 0; font-size: 13px; color: #2563eb; font-weight: 600;">Delivery Date: ${new Date(order.delivery_date).toLocaleDateString()}</p>` : ''}
            </div>
          </div>

          <div style="background-color: #f8fafc; padding: 14px; border-radius: 6px; margin-bottom: 20px; font-size: 14px;">
            <p style="margin: 0 0 6px;"><b>Party / Customer:</b> ${order.customer_name || 'Walk-in Party'}</p>
            ${order.customer_phone ? `<p style="margin: 0 0 6px;"><b>Phone:</b> ${order.customer_phone}</p>` : ''}
            ${order.billing_address ? `<p style="margin: 0 0 6px;"><b>Billing Address:</b> ${order.billing_address}</p>` : ''}
            ${order.shipping_address ? `<p style="margin: 0 0 6px;"><b>Shipping Address:</b> ${order.shipping_address}</p>` : ''}
            ${order.reference_number ? `<p style="margin: 0 0 6px;"><b>Reference #:</b> ${order.reference_number}</p>` : ''}
          </div>

          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">
            <thead>
              <tr style="background-color: #f1f5f9; text-align: left;">
                <th style="padding: 8px 12px;">#</th>
                <th style="padding: 8px 12px;">Item</th>
                <th style="padding: 8px 12px; text-align: center;">Qty/Unit</th>
                <th style="padding: 8px 12px; text-align: right;">Price</th>
                <th style="padding: 8px 12px; text-align: right;">Disc</th>
                <th style="padding: 8px 12px; text-align: right;">Tax</th>
                <th style="padding: 8px 12px; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="6" style="padding: 8px 12px; text-align: right; font-weight: 500;">Subtotal:</td>
                <td style="padding: 8px 12px; text-align: right;">₹${parseFloat(order.subtotal || 0).toFixed(2)}</td>
              </tr>
              ${parseFloat(order.discount_amount || 0) > 0 ? `
              <tr>
                <td colspan="6" style="padding: 6px 12px; text-align: right; color: #16a34a;">Discount:</td>
                <td style="padding: 6px 12px; text-align: right; color: #16a34a;">-₹${parseFloat(order.discount_amount || 0).toFixed(2)}</td>
              </tr>` : ''}
              <tr>
                <td colspan="6" style="padding: 6px 12px; text-align: right;">Tax:</td>
                <td style="padding: 6px 12px; text-align: right;">₹${parseFloat(order.tax_amount || 0).toFixed(2)}</td>
              </tr>
              ${chargesHtml}
              <tr style="border-top: 2px solid #0f172a; font-size: 16px;">
                <td colspan="6" style="padding: 10px 12px; text-align: right; font-weight: bold;">Grand Total:</td>
                <td style="padding: 10px 12px; text-align: right; font-weight: bold; color: #2563eb;">₹${parseFloat(order.total_amount || 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 14px; font-size: 12px; color: #64748b; text-align: center;">
            <p style="margin: 0;">Thank you for your business! This is a system-generated Sales Order voucher.</p>
          </div>
        </div>
      `;

      const emailResult = await EmailService.sendMail({
        to: recipient_email,
        subject,
        html,
        restaurantId
      });

      return res.json({ message: 'Sales order voucher sent successfully via email.', ...emailResult });
    } catch (err) {
      console.error('Send sales order email error:', err);
      return res.status(500).json({ error: err.message || 'Failed to send sales order email.' });
    }
  }
}

module.exports = OrderController;
