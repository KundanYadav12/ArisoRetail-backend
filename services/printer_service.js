const net = require('net');
const PrinterRepository = require('../repositories/printer_repository');
const PrintQueueRepository = require('../repositories/print_queue_repository');
const OrderRepository = require('../repositories/order_repository');
const SuperAdminRepository = require('../repositories/superadmin_repository');
const ReceiptRepository = require('../repositories/receipt_repository');
const DeviceRepository = require('../repositories/device_repository');

// Low-level ESC/POS Commands
const ESC = '\x1B';
const GS = '\x1D';
const CMD_INIT = ESC + '@';
const CMD_ALIGN_LEFT = ESC + 'a\x00';
const CMD_ALIGN_CENTER = ESC + 'a\x01';
const CMD_ALIGN_RIGHT = ESC + 'a\x02';
const CMD_FONT_NORMAL = GS + '!\x00';
const CMD_FONT_DOUBLE = GS + '!\x11';
const CMD_BOLD_ON = ESC + 'E\x01';
const CMD_BOLD_OFF = ESC + 'E\x00';
const CMD_CUT = GS + 'V\x41\x03'; // Auto paper cut
const CMD_CASH_DRAWER = ESC + 'p\x00\x19\xFA'; // Cash drawer kick pulse

class PrinterService {
  /**
   * Sends a raw in-memory Buffer payload directly to a network thermal printer TCP socket
   */
  static sendToPrinterSocket(ip, port, buffer) {
    const tConnectionStarted = Date.now();
    return new Promise((resolve, reject) => {
      const isMock = !ip || ip === '127.0.0.1' || ip.startsWith('192.168.99') || ip === 'localhost';

      if (isMock) {
        // Development / Mock Virtual Printer Mode (In-memory execution, no physical socket & NO disk text files created)
        const tConnected = Date.now();
        const tSent = Date.now() + 5;
        const tCompleted = Date.now() + 8;
        console.log(`[Dynamic Printer Engine - In-Memory Execution] Simulated socket print stream to ${ip || 'virtual'}:${port || 9100} (${buffer.length} bytes payload)`);
        return resolve({
          success: true,
          method: 'virtual_in_memory',
          timing: {
            tConnectionStarted,
            tConnected,
            tSent,
            tCompleted,
            durationMs: tCompleted - tConnectionStarted
          }
        });
      }

      const client = new net.Socket();
      client.setTimeout(2500); // Tight 2.5 second TCP connection timeout

      let tConnected = null;
      let tSent = null;

      client.connect(port || 9100, ip, () => {
        tConnected = Date.now();
        client.write(buffer, () => {
          tSent = Date.now();
          client.end();
          const tCompleted = Date.now();
          resolve({
            success: true,
            method: 'tcp_socket',
            timing: {
              tConnectionStarted,
              tConnected,
              tSent,
              tCompleted,
              durationMs: tCompleted - tConnectionStarted
            }
          });
        });
      });

      client.on('error', (err) => {
        client.destroy();
        reject(Object.assign(err, { tConnectionStarted, tFailed: Date.now() }));
      });

      client.on('timeout', () => {
        client.destroy();
        const err = new Error(`TCP Socket timeout connecting to thermal printer at ${ip}:${port}`);
        reject(Object.assign(err, { tConnectionStarted, tFailed: Date.now() }));
      });
    });
  }
  /**
   * Format line width dynamically according to printer paper width (58mm = 32 cols, 80mm = 48 cols)
   */
  static getWidthCols(paperWidth) {
    return paperWidth === '58' || paperWidth === 58 ? 32 : 48;
  }

  /**
   * Helper to safely format two columns (left-aligned label, right-aligned value)
   * guaranteed to fit exact width without wrapping or clipping the right value.
   */
  static formatTwoColumns(leftText, rightText, lineWidth) {
    const left = String(leftText || '');
    const right = String(rightText || '');
    const rightLen = right.length;
    
    if (rightLen >= lineWidth) {
      return right.substring(0, lineWidth);
    }

    const maxLeftLen = lineWidth - rightLen - 1; // leave at least 1 space
    const truncatedLeft = left.length > maxLeftLen ? left.substring(0, maxLeftLen) : left;
    const padLength = lineWidth - rightLen;

    return truncatedLeft.padEnd(padLength, ' ') + right;
  }

  /**
   * Build dynamic in-memory ESC/POS payload for Order Receipt
   */
  static buildReceiptPayload(order, items, restaurant, printer, receiptSettings = null) {
    const s = receiptSettings || {};
    const paperWidth = s.paper_size === '58mm' ? '58' : (printer ? printer.paper_width : '80');
    const cols = this.getWidthCols(paperWidth);
    const is58mm = cols === 32;
    const divider = '-'.repeat(cols) + '\n';
    const doubleDivider = '='.repeat(cols) + '\n';

    let cmds = '';
    cmds += CMD_INIT;
    
    // Align header
    const alignCmd = s.header_alignment === 'left' ? CMD_ALIGN_LEFT : (s.header_alignment === 'right' ? CMD_ALIGN_RIGHT : CMD_ALIGN_CENTER);
    cmds += alignCmd;

    const restName = s.restaurant_name || restaurant.name || 'RESTAURANT POS';
    cmds += CMD_BOLD_ON;
    if (!is58mm) {
      cmds += CMD_FONT_DOUBLE;
    }
    cmds += restName.toUpperCase() + '\n' + CMD_FONT_NORMAL + CMD_BOLD_OFF;

    if (s.branch_name) cmds += `${s.branch_name}\n`;
    const addr = s.address !== undefined ? s.address : restaurant.address;
    if (addr) cmds += addr + '\n';
    
    const phone = s.phone !== undefined ? s.phone : restaurant.phone;
    if (phone) cmds += 'Ph: ' + phone + '\n';
    if (s.whatsapp) cmds += 'WA: ' + s.whatsapp + '\n';
    if (s.email) cmds += 'Email: ' + s.email + '\n';
    if (s.website) cmds += 'Web: ' + s.website + '\n';

    const gst = s.gst_number !== undefined ? s.gst_number : restaurant.gst_number;
    if (gst) cmds += 'GSTIN: ' + gst + '\n';
    if (s.fssai_number) cmds += 'FSSAI Lic No: ' + s.fssai_number + '\n';

    if (s.header_message) cmds += `\n* ${s.header_message} *\n`;
    cmds += doubleDivider;

    // Order Metadata
    cmds += CMD_ALIGN_LEFT;
    cmds += `Bill No : #${order.unique_order_number}\n`;
    if (s.show_cashier_name !== 0) {
      cmds += `Cashier : ${order.cashier_name || 'Staff'}\n`;
    }
    cmds += `Date    : ${new Date(order.created_at || Date.now()).toLocaleString()}\n`;
    
    if (s.show_payment_details !== 0) {
      cmds += `Payment : ${order.payment_mode ? order.payment_mode.toUpperCase() : 'CASH'} | ${order.table_number_or_takeaway || 'Takeaway'}\n`;
    }

    if (s.show_customer_details !== 0 && order.notes) {
      cmds += `Customer: ${order.notes}\n`;
    }

    if (order.reprint_count && order.reprint_count > 0) {
      cmds += CMD_BOLD_ON + `*** REPRINT (${order.reprint_count}) ***\n` + CMD_BOLD_OFF;
    }
    cmds += divider;

    // Items List
    if (is58mm) {
      cmds += CMD_BOLD_ON + `ITEM NAME         QTY/WT    AMOUNT\n` + CMD_BOLD_OFF;
      cmds += divider;
      items.forEach(item => {
        const isWeight = !!item.is_weight_based;
        const rawName = item.name || '';
        let name = '';
        if (rawName.length <= 32) {
          name = rawName;
        } else {
          const firstLine = rawName.substring(0, 32);
          const secondLine = rawName.substring(32, 64);
          name = `${firstLine}\n${secondLine}`;
        }
        const price = parseFloat(item.price || item.unit_price || 0);
        const total = parseFloat(item.total_price || (price * (item.quantity || item.item_weight || 1))).toFixed(2);
        
        let qtyWtStr = '';
        if (isWeight) {
          const wt = parseFloat(item.item_weight || item.quantity || 1).toFixed(3);
          const unit = (item.weight_unit === 'pcs' || item.base_unit === 'pcs') ? 'kg' : (item.weight_unit || item.base_unit || 'kg');
          qtyWtStr = `${wt}${unit}@Rs.${price.toFixed(2)}/${unit}`;
        } else {
          const qty = parseInt(item.quantity || 1, 10);
          const unit = item.base_unit || 'pcs';
          qtyWtStr = `${qty}${unit}@Rs.${price.toFixed(2)}`;
        }

        cmds += `${name}\n  ${qtyWtStr.padEnd(18, ' ')} Rs.${total.padStart(8, ' ')}\n`;
        if (item.notes) cmds += `  * ${item.notes}\n`;
      });
    } else {
      cmds += CMD_BOLD_ON + `ITEM NAME               QTY/WT     RATE       TOTAL\n` + CMD_BOLD_OFF;
      cmds += divider;
      items.forEach(item => {
        const isWeight = !!item.is_weight_based;
        const name = (item.name || '').substring(0, 22).padEnd(22, ' ');
        const price = parseFloat(item.price || item.unit_price || 0);
        const total = parseFloat(item.total_price || (price * (item.quantity || item.item_weight || 1))).toFixed(2);

        let qtyWtStr = '';
        let rateStr = '';
        if (isWeight) {
          const wt = parseFloat(item.item_weight || item.quantity || 1).toFixed(3);
          const unit = (item.weight_unit === 'pcs' || item.base_unit === 'pcs') ? 'kg' : (item.weight_unit || item.base_unit || 'kg');
          qtyWtStr = `${wt} ${unit}`;
          rateStr = `Rs.${price.toFixed(2)}/${unit}`;
        } else {
          const qty = parseInt(item.quantity || 1, 10);
          const unit = item.base_unit || 'pcs';
          qtyWtStr = `${qty} ${unit}`;
          rateStr = `Rs.${price.toFixed(2)}`;
        }

        cmds += `${name} ${qtyWtStr.padEnd(10, ' ')} ${rateStr.padEnd(10, ' ')} Rs.${total.padStart(8, ' ')}\n`;
        if (s.show_tax_details !== 0 && item.gst_rate !== undefined && item.gst_rate !== null) {
          const itemGst = parseFloat(item.gst_rate);
          const itemTax = parseFloat(item.tax_amount || 0).toFixed(2);
          const itemDisc = parseFloat(item.discount_amount || 0).toFixed(2);
          cmds += `  [GST: ${itemGst}% | Tax: Rs.${itemTax}${itemDisc > 0 ? ` | Disc: -Rs.${itemDisc}` : ''}]\n`;
        }
        if (item.notes) cmds += `  * Notes: ${item.notes}\n`;
      });
    }

    cmds += divider;

    // Financial Totals
    const subtotalVal = isNaN(parseFloat(order.subtotal)) ? 0 : parseFloat(order.subtotal);
    const discountVal = isNaN(parseFloat(order.discount_amount)) ? 0 : parseFloat(order.discount_amount);
    
    let taxVal = parseFloat(
      order.tax_amount ?? order.taxAmount ?? order.tax ?? order.gst_amount ?? order.gstAmount ?? 0
    );
    if (taxVal === 0 && subtotalVal > 0 && (s.gst_enabled === 1 || s.gst_enabled === true || s.gst_enabled === 'true')) {
      const rate = parseFloat(s.gst_percentage || s.gst_rate || order.tax_rate || 5);
      taxVal = parseFloat((subtotalVal * (rate / 100)).toFixed(2));
    }

    const totalVal = isNaN(parseFloat(order.total_amount)) ? 0 : parseFloat(order.total_amount);

    cmds += PrinterService.formatTwoColumns('Subtotal:', `Rs. ${subtotalVal.toFixed(2)}`, cols) + '\n';
    if (discountVal > 0) {
      const discLabel = order.discount_type === 'percentage' ? `Discount (${order.discount_value}%):` : 'Discount:';
      cmds += PrinterService.formatTwoColumns(discLabel, `-Rs. ${discountVal.toFixed(2)}`, cols) + '\n';
    }
    
    if (s.show_tax_details !== 0 && taxVal > 0) {
      if (order.tax_type === 'inter') {
        cmds += PrinterService.formatTwoColumns('IGST Tax:', `Rs. ${taxVal.toFixed(2)}`, cols) + '\n';
      } else {
        const halfTax = (taxVal / 2).toFixed(2);
        cmds += PrinterService.formatTwoColumns('CGST Tax:', `Rs. ${halfTax}`, cols) + '\n';
        cmds += PrinterService.formatTwoColumns('SGST Tax:', `Rs. ${halfTax}`, cols) + '\n';
        cmds += PrinterService.formatTwoColumns('Total Tax:', `Rs. ${taxVal.toFixed(2)}`, cols) + '\n';
      }
    }

    cmds += divider;
    cmds += CMD_BOLD_ON;
    if (!is58mm) {
      cmds += CMD_FONT_DOUBLE;
    }
    cmds += PrinterService.formatTwoColumns('TOTAL:', `Rs. ${totalVal.toFixed(2)}`, cols) + '\n' + CMD_FONT_NORMAL + CMD_BOLD_OFF;
    cmds += doubleDivider;

    // GST Slabs Summary
    if (s.show_tax_details !== 0 && items && items.length > 0) {
      cmds += '\n-- GST TAX SLABS SUMMARY --\n';
      const gstGroups = {};
      items.forEach(item => {
        const rate = parseFloat(item.gst_rate !== undefined && item.gst_rate !== null ? item.gst_rate : 5);
        if (!gstGroups[rate]) {
          gstGroups[rate] = { taxable: 0, tax: 0 };
        }
        
        const price = parseFloat(item.price || item.unit_price || 0);
        const qty = parseFloat(item.item_weight || item.quantity || 1);
        const disc = parseFloat(item.discount_amount || 0);
        const tax = parseFloat(item.tax_amount || 0);
        
        let taxable = price * qty - disc;
        if (s.gst_mode === 'included') {
          taxable = taxable - tax;
        }
        
        gstGroups[rate].taxable += taxable;
        gstGroups[rate].tax += tax;
      });
      
      cmds += 'Rate   TaxableAmt    TaxAmt    Total\n';
      Object.keys(gstGroups).sort((a,b) => parseFloat(a) - parseFloat(b)).forEach(rate => {
        const group = gstGroups[rate];
        const rStr = `${rate}%`.padEnd(6, ' ');
        const txblStr = `Rs.${group.taxable.toFixed(2)}`.padEnd(13, ' ');
        const taxStr = `Rs.${group.tax.toFixed(2)}`.padEnd(10, ' ');
        const totStr = `Rs.${(group.taxable + group.tax).toFixed(2)}`;
        cmds += `${rStr}${txblStr}${taxStr}${totStr}\n`;
      });
      cmds += doubleDivider;
    }

    // Footer
    cmds += CMD_ALIGN_CENTER;
    const thankYou = s.thank_you_message || 'Thank You! Visit Again.';
    cmds += thankYou + '\n';
    if (s.footer_message) cmds += `${s.footer_message}\n`;
    if (s.terms_conditions) cmds += `T&C: ${s.terms_conditions}\n`;
    cmds += '\n\n';

    // Auto Cut & Cash Drawer Kick
    if (!printer || printer.auto_cut !== 0) {
      cmds += CMD_CUT;
    }
    if (printer && printer.cash_drawer === 1 && (order.payment_mode === 'cash' || order.payment_mode === 'CASH')) {
      cmds += CMD_CASH_DRAWER;
    }

    return Buffer.from(cmds, printer && printer.character_encoding === 'PC437' ? 'ascii' : 'utf-8');
  }

  /**
   * Build dynamic in-memory ESC/POS payload for Kitchen Order Ticket (KOT)
   * Note: KOT never displays prices or payment information.
   */
  static buildKOTPayload(order, items, printer, kotSettings = null) {
    const s = kotSettings || {};
    const paperWidth = s.paper_size === '58mm' ? '58' : (printer ? printer.paper_width : '80');
    const cols = this.getWidthCols(paperWidth);
    const divider = '-'.repeat(cols) + '\n';
    const doubleDivider = '='.repeat(cols) + '\n';

    let cmds = '';
    cmds += CMD_INIT;
    
    // Header
    const kotTitle = s.kot_header || 'KITCHEN ORDER TICKET';
    cmds += CMD_ALIGN_CENTER + CMD_BOLD_ON;
    if (cols === 48) {
      cmds += CMD_FONT_DOUBLE;
    }
    cmds += kotTitle.toUpperCase() + '\n';
    if (cols === 48) {
      cmds += CMD_FONT_NORMAL;
    }
    cmds += CMD_BOLD_OFF;
    if (s.kitchen_name) cmds += `[ ${s.kitchen_name.toUpperCase()} ]\n`;
    cmds += `Order #${order.unique_order_number} | ${order.table_number_or_takeaway || 'Takeaway'}\n`;
    
    if (s.show_kot_time !== 0) {
      cmds += `Time: ${new Date(order.created_at || Date.now()).toLocaleTimeString()}\n`;
    }
    cmds += doubleDivider;

    // Items
    cmds += CMD_ALIGN_LEFT + CMD_BOLD_ON;
    items.forEach(item => {
      const prefix = `${item.quantity || 1} x `;
      const maxNameLen = cols - prefix.length;
      const name = (item.name || '').toUpperCase();
      
      let formattedName = '';
      if (name.length <= maxNameLen) {
        formattedName = name;
      } else {
        const firstLine = name.substring(0, maxNameLen);
        const secondLine = name.substring(maxNameLen, maxNameLen * 2);
        formattedName = `${firstLine}\n${' '.repeat(prefix.length)}${secondLine}`;
      }
      cmds += `${prefix}${formattedName}\n`;
      if (item.notes) {
        cmds += `   >>> NOTE: ${item.notes.toUpperCase()}\n`;
      }
    });
    cmds += CMD_BOLD_OFF + divider;

    if (s.show_kot_order_notes !== 0 && order.notes) {
      cmds += CMD_BOLD_ON + `ORDER NOTE: ${order.notes.toUpperCase()}\n` + CMD_BOLD_OFF + divider;
    }

    const kotNote = s.kot_footer_note || 'Prepare with priority';
    cmds += CMD_ALIGN_CENTER + `* ${kotNote} *\n`;
    cmds += `[ KOT END ]\n\n\n`;

    if (!printer || printer.auto_cut !== 0) {
      cmds += CMD_CUT;
    }

    return Buffer.from(cmds, 'utf-8');
  }

  static async enqueueOrderPrintJobs(restaurantId, orderId, printActions = null) {
    const tEnqueueStart = Date.now();
    try {
      let finalActions = [];

      if (Array.isArray(printActions)) {
        finalActions = printActions;
      } else {
        // Resolve print settings configuration
        const settings = await ReceiptRepository.getByRestaurantId(restaurantId);
        
        // Find order status to see which stage we are at (Stage 1 = pending/confirmed, Stage 2 = completed)
        const orderRes = await OrderRepository.getById(orderId, restaurantId);
        const status = orderRes?.order?.order_status || 'completed';

        const stageMode = (status === 'completed') ? settings.print_stage2_mode : settings.print_stage1_mode;
        
        if (stageMode === 'print_kot_only') {
          finalActions = ['KOT'];
        } else if (stageMode === 'print_receipt_only') {
          finalActions = ['RECEIPT'];
        } else if (stageMode === 'print_kot_receipt') {
          finalActions = ['KOT', 'RECEIPT'];
        } else {
          finalActions = []; // save_only or show_popup (and no explicit override was passed)
        }
      }

      // Fetch order details for payload generation
      const orderRes = await OrderRepository.getById(orderId, restaurantId);
      const order = orderRes ? (orderRes.order || orderRes) : null;
      const items = orderRes && orderRes.items ? orderRes.items : (await OrderRepository.getOrderItems(orderId));
      const restaurant = await SuperAdminRepository.getRestaurantById(restaurantId);
      const receiptSettings = await ReceiptRepository.getByRestaurantId(restaurantId);

      const createdJobIds = [];

      if (finalActions.includes('RECEIPT') && order && restaurant) {
        const receiptPrinter = await PrinterRepository.getDefaultReceiptPrinter(restaurantId);
        const receiptBuffer = this.buildReceiptPayload(order, items, restaurant, receiptPrinter, receiptSettings);
        
        const jobId = await PrintQueueRepository.enqueue({
          restaurant_id: restaurantId,
          order_id: orderId,
          printer_id: receiptPrinter ? receiptPrinter.id : null,
          print_type: 'RECEIPT',
          payload_base64: receiptBuffer ? receiptBuffer.toString('base64') : null,
          backend_received_at: tEnqueueStart
        });
        createdJobIds.push(jobId);
      }

      if (finalActions.includes('KOT') && order && restaurant) {
        const kotPrinter = await PrinterRepository.getDefaultKOTPrinter(restaurantId);
        const kotBuffer = this.buildKOTPayload(order, items, kotPrinter, receiptSettings);

        const jobId = await PrintQueueRepository.enqueue({
          restaurant_id: restaurantId,
          order_id: orderId,
          printer_id: kotPrinter ? kotPrinter.id : null,
          print_type: 'KOT',
          payload_base64: kotBuffer ? kotBuffer.toString('base64') : null,
          backend_received_at: tEnqueueStart
        });
        createdJobIds.push(jobId);
      }

      console.log(`[Printer Engine] Enqueued ${createdJobIds.length} print job(s) for Order #${order?.unique_order_number || orderId} in ${Date.now() - tEnqueueStart}ms (Job IDs: ${createdJobIds.join(', ') || 'None'})`);

      // FAST PATH EXECUTION: Trigger queue processor immediately without waiting 1s for setInterval!
      if (createdJobIds.length > 0) {
        setImmediate(() => {
          this.processPendingQueue().catch(err => console.error('[Fast Path Queue Error]', err));
        });
      }
    } catch (err) {
      console.error('[Printer Queue Enqueue Error]', err);
    }
  }

  /**
   * Process a single print job asynchronously (Parallel Non-Blocking Job Engine)
   */
  static async processSingleJob(job) {
    const tJobStart = Date.now();
    
    try {
      // Prevent cloud backend from socket printing when Desktop Print Gateway is active for the outlet
      const hasGateway = await DeviceRepository.hasActiveGatewayDevice(job.restaurant_id);
      if (hasGateway) {
        // Job is reserved for Desktop Print Gateway polling via /api/agent/print-jobs/poll
        return;
      }

      // Atomically claim job to ensure no duplicate worker execution
      const claimed = await PrintQueueRepository.claimJob(job.id);
      if (!claimed) return; // Another worker or poller tick already claimed this job!

      // Only attempt direct socket printing if IP is non-private or virtual mock
      const targetIp = job.ip_address || '';
      const isPrivateLanIp = targetIp.startsWith('192.168.') || targetIp.startsWith('10.') || targetIp.startsWith('172.');
      if (process.env.NODE_ENV === 'production' && isPrivateLanIp) {
        // Cloud backend cannot reach local LAN IP directly; leave in queue for gateway agent
        return;
      }

      const orderRes = await OrderRepository.getById(job.order_id, job.restaurant_id);
      const order = orderRes ? (orderRes.order || orderRes) : null;
      const items = orderRes && orderRes.items ? orderRes.items : (await OrderRepository.getOrderItems(job.order_id));
      const restaurant = await SuperAdminRepository.getRestaurantById(job.restaurant_id);
      const receiptSettings = await ReceiptRepository.getByRestaurantId(job.restaurant_id);

      if (!order || !restaurant) {
        await PrintQueueRepository.updateJobStatus(job.id, 'FAILED', 'Order or Restaurant data not found in DB.');
        return;
      }

      // Build in-memory Buffer payload
      let bufferPayload;
      if (job.print_type === 'KOT') {
        bufferPayload = this.buildKOTPayload(order, items, job, receiptSettings);
      } else {
        bufferPayload = this.buildReceiptPayload(order, items, restaurant, job, receiptSettings);
      }

      // Send to thermal printer socket
      const printResult = await this.sendToPrinterSocket(job.ip_address || '127.0.0.1', job.port || 9100, bufferPayload);
      
      const tCompleted = Date.now();
      const totalDurationMs = tCompleted - tJobStart;

      await PrintQueueRepository.updateJobTiming(job.id, {
        connected_at: printResult.timing?.tConnected,
        data_sent_at: printResult.timing?.tSent,
        completed_at: tCompleted,
        total_duration_ms: totalDurationMs
      });

      await PrintQueueRepository.updateJobStatus(job.id, 'SUCCESS');

      const backendTime = job.backend_received_at ? new Date(job.backend_received_at).toISOString() : 'N/A';
      const createdTime = job.created_at ? new Date(job.created_at).toISOString() : 'N/A';
      const connDelay = printResult.timing?.tConnected ? `+${printResult.timing.tConnected - printResult.timing.tConnectionStarted}ms` : 'N/A';
      const sendDelay = printResult.timing?.tSent ? `+${printResult.timing.tSent - printResult.timing.tConnected}ms` : 'N/A';

      console.log(`[PRINT TIMELINE] Job #${job.id} (${job.print_type}) | Rest #${job.restaurant_id} | Printer: ${job.printer_name || 'Thermal'} (${job.ip_address || '127.0.0.1'}:${job.port || 9100})
  • Backend Received : ${backendTime}
  • Job Created      : ${createdTime}
  • Socket Connection: ${connDelay}
  • Print Data Sent  : ${sendDelay}
  • Print Completed  : ${totalDurationMs}ms (SUCCESS)`);
    } catch (jobErr) {
      const totalDurationMs = Date.now() - tJobStart;
      console.error(`[PRINT TIMELINE] Job #${job.id} (${job.print_type}) FAILED after ${totalDurationMs}ms:`, jobErr.message);
      
      await PrintQueueRepository.updateJobTiming(job.id, {
        completed_at: Date.now(),
        total_duration_ms: totalDurationMs
      });

      if ((job.retry_count || 0) >= 2) {
        await PrintQueueRepository.updateJobStatus(job.id, 'FAILED', jobErr.message);
      } else {
        await PrintQueueRepository.incrementRetry(job.id, jobErr.message);
      }
    }
  }

  /**
   * Continuous Database Print Queue Processor (Parallel Non-Blocking Job Engine)
   */
  static async processPendingQueue() {
    try {
      const pendingJobs = await PrintQueueRepository.getPendingJobs(20);
      if (!pendingJobs || pendingJobs.length === 0) return;

      // Process all pending jobs IN PARALLEL per printer/tenant so one failed job never blocks others!
      await Promise.allSettled(pendingJobs.map(job => this.processSingleJob(job)));
    } catch (err) {
      console.error('[Process Pending Queue Error]', err);
    }
  }

  /**
   * Dynamic In-Memory Order Reprint
   */
  static async reprintOrder(restaurantId, orderId, printType = 'RECEIPT') {
    await OrderRepository.incrementReprintCount(orderId, restaurantId);
    await this.enqueueOrderPrintJobs(restaurantId, orderId, [printType]);
    return { message: 'Reprint job enqueued successfully.' };
  }
}

// Continuous background print queue poller safety tick (every 1 second)
setInterval(() => {
  PrinterService.processPendingQueue().catch(err => console.error('[Poller Error]', err));
}, 1000);

module.exports = PrinterService;
