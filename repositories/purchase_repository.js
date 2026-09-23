const pool = require('../config/db');
const StockMovementService = require('../services/stock_movement_service');
const { GstService } = require('../services/gst_service');
const { getISTDateString } = require('../utils/date_utils');

class PurchaseRepository {
  /**
   * Fetch all Purchase Orders
   */
  static async getPOs(restaurantId, filters = {}) {
    const { status, supplier_id, warehouse_id, date_from, date_to, search } = filters;

    let query = `
      SELECT 
        po.*,
        s.name as supplier_name,
        s.company_name as supplier_company,
        w.name as warehouse_name,
        w.code as warehouse_code,
        COUNT(poi.id) as total_items,
        COALESCE(SUM(poi.quantity), 0) as total_quantity
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN warehouses w ON po.warehouse_id = w.id
      LEFT JOIN purchase_order_items poi ON po.id = poi.purchase_order_id
      WHERE po.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (status && status !== 'all') {
      query += ' AND po.status = ?';
      params.push(status);
    }

    if (supplier_id) {
      query += ' AND po.supplier_id = ?';
      params.push(supplier_id);
    }

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND po.warehouse_id = ?';
      params.push(warehouse_id);
    }

    if (date_from) {
      query += ' AND po.order_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      query += ' AND po.order_date <= ?';
      params.push(date_to);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (po.po_number LIKE ? OR s.name LIKE ? OR s.company_name LIKE ?)';
      params.push(s, s, s);
    }

    query += ' GROUP BY po.id ORDER BY po.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get PO by ID with line items
   */
  static async getPOById(id, restaurantId) {
    const [headerRows] = await pool.execute(`
      SELECT 
        po.*,
        s.name as supplier_name,
        s.company_name as supplier_company,
        s.mobile as supplier_mobile,
        s.gst_number as supplier_gst,
        w.name as warehouse_name,
        w.code as warehouse_code
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN warehouses w ON po.warehouse_id = w.id
      WHERE po.id = ? AND po.restaurant_id = ?
    `, [id, restaurantId]);

    if (headerRows.length === 0) return null;

    const po = headerRows[0];

    const [items] = await pool.execute(`
      SELECT 
        poi.*,
        mi.sku,
        mi.item_code
      FROM purchase_order_items poi
      JOIN menu_items mi ON poi.menu_item_id = mi.id
      WHERE poi.purchase_order_id = ?
      ORDER BY poi.id ASC
    `, [id]);

    po.items = items;
    return po;
  }

  /**
   * Create a Purchase Order
   * CRITICAL: Creating a PO NEVER increases inventory.
   */
  static async createPO(restaurantId, userId, userName, data) {
    const {
      supplier_id,
      warehouse_id,
      order_date,
      expected_delivery_date,
      notes,
      items
    } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Purchase order must contain at least one item.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const effectiveDate = order_date || getISTDateString();
      const today = effectiveDate.replace(/-/g, '');
      const prefix = `PO-${today}-`;

      const [seqRows] = await connection.execute(
        'SELECT po_number FROM purchase_orders WHERE restaurant_id = ? AND po_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].po_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const poNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      let subtotal = 0;
      let totalTax = 0;
      let totalDiscount = 0;

      for (const it of items) {
        const qty = parseFloat(it.quantity) || 0;
        const rate = parseFloat(it.rate) || 0;
        const taxRate = parseFloat(it.tax_rate) || 0;
        const disc = parseFloat(it.discount_amount) || 0;

        const lineSubtotal = qty * rate;
        const lineTax = (lineSubtotal - disc) * (taxRate / 100);
        subtotal += lineSubtotal;
        totalDiscount += disc;
        totalTax += lineTax;
      }

      const totalAmount = Math.max(0, subtotal - totalDiscount + totalTax);

      const [result] = await connection.execute(`
        INSERT INTO purchase_orders (
          restaurant_id, po_number, supplier_id, warehouse_id,
          order_date, expected_delivery_date, subtotal, tax_amount,
          discount_amount, total_amount, status, created_by_user_id,
          created_by_name, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NOW())
      `, [
        restaurantId, poNumber, supplier_id, warehouse_id,
        effectiveDate,
        expected_delivery_date || null, subtotal, totalTax,
        totalDiscount, totalAmount, userId, userName || 'Staff',
        notes || null
      ]);

      const poId = result.insertId;

      for (const it of items) {
        const qty = parseFloat(it.quantity) || 0;
        const rate = parseFloat(it.rate) || 0;
        const taxRate = parseFloat(it.tax_rate) || 0;
        const disc = parseFloat(it.discount_amount) || 0;
        const lineSubtotal = qty * rate;
        const lineTax = (lineSubtotal - disc) * (taxRate / 100);
        const lineTotal = lineSubtotal - disc + lineTax;

        await connection.execute(`
          INSERT INTO purchase_order_items (
            purchase_order_id, menu_item_id, item_name, unit,
            quantity, received_qty, rate, tax_rate, tax_amount,
            discount_amount, total_amount
          ) VALUES (?, ?, ?, ?, ?, 0.000, ?, ?, ?, ?, ?)
        `, [
          poId, it.menu_item_id || it.id, it.item_name || it.name,
          it.unit || 'pcs', qty, rate, taxRate, lineTax, disc, lineTotal
        ]);
      }

      await connection.commit();
      return this.getPOById(poId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Fetch all Purchase Bills (Goods Received)
   */
  static async getBills(restaurantId, filters = {}) {
    const { supplier_id, warehouse_id, payment_status, date_from, date_to, search, purchase_order_id } = filters;

    let query = `
      SELECT 
        pb.*,
        s.name as supplier_name,
        s.company_name as supplier_company,
        w.name as warehouse_name,
        w.code as warehouse_code,
        po.po_number,
        COUNT(pbi.id) as total_items,
        COALESCE(SUM(pbi.quantity), 0) as total_quantity
      FROM purchase_bills pb
      LEFT JOIN suppliers s ON pb.supplier_id = s.id
      LEFT JOIN warehouses w ON pb.warehouse_id = w.id
      LEFT JOIN purchase_orders po ON pb.purchase_order_id = po.id
      LEFT JOIN purchase_bill_items pbi ON pb.id = pbi.purchase_bill_id
      WHERE pb.restaurant_id = ?
    `;

    const params = [restaurantId];

    if (purchase_order_id) {
      query += ' AND pb.purchase_order_id = ?';
      params.push(purchase_order_id);
    }

    if (payment_status && payment_status !== 'all') {
      query += ' AND pb.payment_status = ?';
      params.push(payment_status);
    }

    if (supplier_id) {
      query += ' AND pb.supplier_id = ?';
      params.push(supplier_id);
    }

    if (warehouse_id && warehouse_id !== 'all') {
      query += ' AND pb.warehouse_id = ?';
      params.push(warehouse_id);
    }

    if (date_from) {
      query += ' AND pb.bill_date >= ?';
      params.push(date_from);
    }

    if (date_to) {
      query += ' AND pb.bill_date <= ?';
      params.push(date_to);
    }

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (pb.bill_number LIKE ? OR pb.internal_bill_number LIKE ? OR s.name LIKE ?)';
      params.push(s, s, s);
    }

    query += ' GROUP BY pb.id ORDER BY pb.created_at DESC';

    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get Purchase Bill by ID with items
   */
  static async getBillById(id, restaurantId) {
    const [headerRows] = await pool.execute(`
      SELECT 
        pb.*,
        s.name as supplier_name,
        s.company_name as supplier_company,
        s.mobile as supplier_mobile,
        s.gst_number as supplier_gst,
        w.name as warehouse_name,
        w.code as warehouse_code,
        po.po_number
      FROM purchase_bills pb
      LEFT JOIN suppliers s ON pb.supplier_id = s.id
      LEFT JOIN warehouses w ON pb.warehouse_id = w.id
      LEFT JOIN purchase_orders po ON pb.purchase_order_id = po.id
      WHERE pb.id = ? AND pb.restaurant_id = ?
    `, [id, restaurantId]);

    if (headerRows.length === 0) return null;

    const bill = headerRows[0];

    const [items] = await pool.execute(`
      SELECT 
        pbi.*,
        mi.sku,
        mi.item_code
      FROM purchase_bill_items pbi
      JOIN menu_items mi ON pbi.menu_item_id = mi.id
      WHERE pbi.purchase_bill_id = ?
      ORDER BY pbi.id ASC
    `, [id]);

    bill.items = items;
    return bill;
  }

  /**
   * Create a Purchase Bill (Goods Received Note)
   * ATOMICALLY INCREASES INVENTORY in the target warehouse and updates supplier balance.
   */
  static async createBill(restaurantId, userId, userName, data) {
    const {
      bill_number,
      purchase_order_id = null,
      supplier_id,
      warehouse_id,
      bill_date,
      due_date,
      paid_amount = 0.00,
      payment_mode = null,
      additional_charges = 0.00,
      notes,
      items
    } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Purchase bill must contain at least one item.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const effectiveDate = bill_date || getISTDateString();
      const today = effectiveDate.replace(/-/g, '');
      const prefix = `PB-${today}-`;

      const [seqRows] = await connection.execute(
        'SELECT internal_bill_number FROM purchase_bills WHERE restaurant_id = ? AND internal_bill_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].internal_bill_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const internalBillNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      const [settingsRows] = await connection.execute(
        'SELECT state, state_code FROM receipt_settings WHERE restaurant_id = ?',
        [restaurantId]
      );
      const storeStateCode = settingsRows[0]?.state_code || '27';
      const storeState = settingsRows[0]?.state || 'Maharashtra';

      const [suppRows] = await connection.execute(
        'SELECT gst_number, state, company_name FROM suppliers WHERE id = ?',
        [supplier_id]
      );
      const supplier = suppRows[0] || {};
      const supplierGstin = supplier.gst_number || null;
      const supplierState = supplier.state || null;

      const posRes = GstService.resolvePlaceOfSupply({
        storeStateCode,
        storeState,
        customerGstin: supplierGstin,
        customerState: supplierState
      });
      const billTaxType = posRes.taxType;
      const billPlaceOfSupply = supplierState || storeState;

      let subtotal = 0;
      let totalTax = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalDiscount = 0;

      const processedItems = [];

      for (const it of items) {
        const qty = parseFloat(it.quantity) || 0;
        const rate = parseFloat(it.rate) || 0;
        const taxRate = parseFloat(it.tax_rate) || 0;
        const disc = parseFloat(it.discount_amount) || 0;

        const lineCalc = GstService.calculateLineItemTax({
          price: rate,
          quantity: qty,
          discountAmount: disc,
          gstRate: taxRate,
          gstMode: 'excluded',
          taxType: billTaxType,
          hsnCode: it.hsn_code || null
        });

        subtotal += (qty * rate);
        totalDiscount += disc;
        totalTax += lineCalc.totalTax;
        totalCgst += lineCalc.cgstAmount;
        totalSgst += lineCalc.sgstAmount;
        totalIgst += lineCalc.igstAmount;

        processedItems.push({
          ...it,
          qty,
          rate,
          taxRate,
          disc,
          lineCalc
        });
      }

      subtotal = GstService.round2(subtotal);
      totalDiscount = GstService.round2(totalDiscount);
      totalTax = GstService.round2(totalTax);
      totalCgst = GstService.round2(totalCgst);
      totalSgst = GstService.round2(totalSgst);
      totalIgst = GstService.round2(totalIgst);

      const addCharges = parseFloat(additional_charges) || 0.00;
      const totalAmount = Math.max(0, subtotal - totalDiscount + totalTax + addCharges);
      const paid = parseFloat(paid_amount) || 0.00;

      let paymentStatus = 'unpaid';
      if (paid >= totalAmount) paymentStatus = 'paid';
      else if (paid > 0) paymentStatus = 'partially_paid';

      const [result] = await connection.execute(`
        INSERT INTO purchase_bills (
          restaurant_id, bill_number, internal_bill_number, purchase_order_id,
          supplier_id, warehouse_id, bill_date, due_date,
          subtotal, tax_amount, discount_amount, additional_charges,
          total_amount, paid_amount, payment_status, payment_mode,
          status, created_by_user_id, created_by_name, notes, created_at,
          tax_type, cgst_amount, sgst_amount, igst_amount, place_of_supply, supplier_gstin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)
      `, [
        restaurantId, bill_number || internalBillNumber, internalBillNumber,
        purchase_order_id || null, supplier_id, warehouse_id,
        bill_date || getISTDateString(),
        due_date || null, subtotal, totalTax, totalDiscount, addCharges,
        totalAmount, paid, paymentStatus, payment_mode || null,
        userId, userName || 'Staff', notes || null,
        billTaxType, totalCgst, totalSgst, totalIgst, billPlaceOfSupply, supplierGstin
      ]);

      const billId = result.insertId;

      for (const it of processedItems) {
        const menuItemId = it.menu_item_id || it.id;
        const lc = it.lineCalc;

        const rackId = it.rack_id || null;

        await connection.execute(`
          INSERT INTO purchase_bill_items (
            purchase_bill_id, menu_item_id, item_name, unit,
            quantity, rate, tax_rate, tax_amount, discount_amount,
            total_amount, batch_number, expiry_date,
            hsn_code, taxable_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, rack_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          billId, menuItemId, it.item_name || it.name,
          it.unit || 'pcs', it.qty, it.rate, it.taxRate, lc.totalTax, it.disc, lc.lineTotal,
          it.batch_number || null, it.expiry_date || null,
          lc.hsnCode, lc.taxableAmount, lc.cgstRate, lc.cgstAmount, lc.sgstRate, lc.sgstAmount, lc.igstRate, lc.igstAmount,
          rackId
        ]);

        // ATOMIC INVENTORY INCREASE: Record PURCHASE in stock ledger & warehouse_stocks (and rack)
        await StockMovementService.recordMovement(connection, {
          restaurantId,
          warehouseId: warehouse_id,
          rackId,
          menuItemId,
          type: 'PURCHASE',
          quantity: qty,
          unitCost: rate,
          referenceType: 'purchase_bill',
          referenceId: billId,
          referenceNumber: internalBillNumber,
          userId,
          userName,
          notes: `Purchase Bill #${bill_number || internalBillNumber}`
        });

        // Update purchase price and cost price on menu_items
        await connection.execute(`
          UPDATE menu_items 
          SET purchase_price = ?, cost_price = ?, updated_at = NOW() 
          WHERE id = ? AND restaurant_id = ?
        `, [rate, rate, menuItemId, restaurantId]);
      }

      // Update supplier outstanding balance
      const outstandingIncrease = totalAmount - paid;
      await connection.execute(`
        UPDATE suppliers 
        SET current_balance = current_balance + ?, updated_at = NOW() 
        WHERE id = ? AND restaurant_id = ?
      `, [outstandingIncrease, supplier_id, restaurantId]);

      // If linked to PO, mark PO received
      if (purchase_order_id) {
        await connection.execute(`
          UPDATE purchase_orders 
          SET status = 'received', updated_at = NOW() 
          WHERE id = ? AND restaurant_id = ?
        `, [purchase_order_id, restaurantId]);
      }

      await connection.commit();
      return this.getBillById(billId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Create Purchase Return
   * Deducts inventory from warehouse and decreases supplier balance.
   */
  static async createReturn(restaurantId, userId, userName, data) {
    const {
      purchase_bill_id = null,
      supplier_id,
      warehouse_id,
      return_date,
      reason,
      items
    } = data;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Purchase return must contain at least one item.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const effectiveDate = return_date || getISTDateString();
      const today = effectiveDate.replace(/-/g, '');
      const prefix = `PR-${today}-`;

      const [seqRows] = await connection.execute(
        'SELECT return_number FROM purchase_returns WHERE restaurant_id = ? AND return_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );

      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].return_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const returnNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      let totalAmount = 0;
      for (const it of items) {
        totalAmount += (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0);
      }

      const [result] = await connection.execute(`
        INSERT INTO purchase_returns (
          restaurant_id, return_number, purchase_bill_id, supplier_id,
          warehouse_id, return_date, total_amount, reason,
          created_by_user_id, created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, returnNumber, purchase_bill_id || null, supplier_id,
        warehouse_id, effectiveDate,
        totalAmount, reason || null, userId, userName || 'Staff'
      ]);

      const returnId = result.insertId;

      for (const it of items) {
        const menuItemId = it.menu_item_id || it.id;
        const qty = parseFloat(it.quantity) || 0;
        const rate = parseFloat(it.rate) || 0;
        const lineTotal = qty * rate;

        await connection.execute(`
          INSERT INTO purchase_return_items (
            purchase_return_id, menu_item_id, item_name, unit,
            quantity, rate, total_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          returnId, menuItemId, it.item_name || it.name,
          it.unit || 'pcs', qty, rate, lineTotal
        ]);

        // DEDUCT FROM INVENTORY: Record PURCHASE_RETURN in stock ledger
        await StockMovementService.recordMovement(connection, {
          restaurantId,
          warehouseId: warehouse_id,
          menuItemId,
          type: 'PURCHASE_RETURN',
          quantity: -qty,
          unitCost: rate,
          referenceType: 'purchase_return',
          referenceId: returnId,
          referenceNumber: returnNumber,
          userId,
          userName,
          notes: `Purchase Return (${returnNumber}) - ${reason || 'Return to vendor'}`
        });
      }

      // Decrement supplier outstanding balance
      await connection.execute(`
        UPDATE suppliers 
        SET current_balance = GREATEST(0, current_balance - ?), updated_at = NOW() 
        WHERE id = ? AND restaurant_id = ?
      `, [totalAmount, supplier_id, restaurantId]);

      // Fetch updated supplier balance
      const [suppRows] = await connection.execute(
        'SELECT current_balance FROM suppliers WHERE id = ? AND restaurant_id = ?',
        [supplier_id, restaurantId]
      );
      const newBal = parseFloat(suppRows[0]?.current_balance || 0);

      // Record in supplier_ledger as PURCHASE_RETURN
      await connection.execute(`
        INSERT INTO supplier_ledger (
          restaurant_id, supplier_id, transaction_type,
          amount, balance_after, reference_type, reference_id, reference_number,
          user_id, user_name, notes, created_at
        ) VALUES (?, ?, 'PURCHASE_RETURN', ?, ?, 'purchase_return', ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, supplier_id,
        -totalAmount, newBal,
        returnId, returnNumber,
        userId || null, userName || 'Staff',
        reason ? `${reason} (Return: ${returnNumber})` : `Purchase return #${returnNumber}`
      ]);

      // If linked to a purchase bill, decrease bill payable
      if (purchase_bill_id) {
        const [billRows] = await connection.execute(
          'SELECT total_amount, paid_amount FROM purchase_bills WHERE id = ? AND restaurant_id = ?',
          [purchase_bill_id, restaurantId]
        );
        if (billRows.length > 0) {
          const bTot = parseFloat(billRows[0].total_amount || 0);
          const bPaid = parseFloat(billRows[0].paid_amount || 0);
          const newTot = Math.max(0, bTot - totalAmount);
          const newStatus = bPaid >= newTot ? 'paid' : (bPaid > 0 ? 'partially_paid' : 'unpaid');
          await connection.execute(`
            UPDATE purchase_bills 
            SET total_amount = ?, payment_status = ?, updated_at = NOW()
            WHERE id = ? AND restaurant_id = ?
          `, [newTot, newStatus, purchase_bill_id, restaurantId]);
        }
      }

      await connection.commit();
      return { id: returnId, return_number: returnNumber, total_amount: totalAmount };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // PURCHASE ORDER — APPROVE / CANCEL / UPDATE
  // ===========================================================================

  /**
   * Approve a Purchase Order (pending → approved).
   */
  static async approvePO(id, restaurantId, userId, userName) {
    const [rows] = await pool.execute(
      'SELECT id, status FROM purchase_orders WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    if (rows.length === 0) throw new Error('Purchase Order not found.');
    if (rows[0].status === 'cancelled') throw new Error('Cannot approve a cancelled Purchase Order.');
    if (rows[0].status === 'received') throw new Error('Purchase Order is already fully received.');

    await pool.execute(`
      UPDATE purchase_orders
      SET status = 'approved',
          approved_by_user_id = ?,
          approved_by_name = ?,
          approved_at = NOW(),
          updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [userId, userName, id, restaurantId]);

    return this.getPOById(id, restaurantId);
  }

  /**
   * Cancel a Purchase Order.
   * Not allowed if any GRN exists against this PO.
   */
  static async cancelPO(id, restaurantId, userId, userName, reason) {
    const [rows] = await pool.execute(
      'SELECT id, status FROM purchase_orders WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    if (rows.length === 0) throw new Error('Purchase Order not found.');
    if (rows[0].status === 'cancelled') throw new Error('Purchase Order is already cancelled.');

    // Block if any GRN exists
    const [grnRows] = await pool.execute(
      "SELECT id FROM goods_received_notes WHERE purchase_order_id = ? AND status != 'cancelled' LIMIT 1",
      [id]
    );
    if (grnRows.length > 0) {
      throw new Error('Cannot cancel a Purchase Order that has Goods Received Notes (GRNs) against it. Cancel the GRNs first.');
    }

    await pool.execute(`
      UPDATE purchase_orders
      SET status = 'cancelled',
          cancelled_by_user_id = ?,
          cancelled_by_name = ?,
          cancelled_at = NOW(),
          cancel_reason = ?,
          updated_at = NOW()
      WHERE id = ? AND restaurant_id = ?
    `, [userId, userName, reason || null, id, restaurantId]);

    return this.getPOById(id, restaurantId);
  }

  /**
   * Update a Purchase Order (only allowed in draft / pending status).
   */
  static async updatePO(id, restaurantId, userId, userName, data) {
    const [rows] = await pool.execute(
      'SELECT id, status FROM purchase_orders WHERE id = ? AND restaurant_id = ?',
      [id, restaurantId]
    );
    if (rows.length === 0) throw new Error('Purchase Order not found.');
    if (!['draft', 'pending'].includes(rows[0].status)) {
      throw new Error(`Cannot edit a Purchase Order in "${rows[0].status}" status. Only draft/pending orders can be edited.`);
    }

    const { expected_delivery_date, notes, reference_number, items } = data;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(`
        UPDATE purchase_orders
        SET expected_delivery_date = COALESCE(?, expected_delivery_date),
            notes = COALESCE(?, notes),
            reference_number = COALESCE(?, reference_number),
            updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [expected_delivery_date || null, notes || null, reference_number || null, id, restaurantId]);

      if (items && Array.isArray(items) && items.length > 0) {
        await connection.execute('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [id]);

        let subtotal = 0, totalTax = 0, totalDiscount = 0;
        for (const it of items) {
          const qty = parseFloat(it.quantity) || 0;
          const rate = parseFloat(it.rate) || 0;
          const taxRate = parseFloat(it.tax_rate) || 0;
          const disc = parseFloat(it.discount_amount) || 0;
          const lineSubtotal = qty * rate;
          const lineTax = (lineSubtotal - disc) * (taxRate / 100);
          const lineTotal = lineSubtotal - disc + lineTax;
          subtotal += lineSubtotal;
          totalDiscount += disc;
          totalTax += lineTax;

          await connection.execute(`
            INSERT INTO purchase_order_items (
              purchase_order_id, menu_item_id, item_name, unit,
              quantity, received_qty, billed_qty, rate, tax_rate, tax_amount,
              discount_amount, total_amount
            ) VALUES (?, ?, ?, ?, ?, 0.000, 0.000, ?, ?, ?, ?, ?)
          `, [id, it.menu_item_id || it.id, it.item_name || it.name,
              it.unit || 'pcs', qty, rate, taxRate, lineTax, disc, lineTotal]);
        }
        const totalAmount = Math.max(0, subtotal - totalDiscount + totalTax);
        await connection.execute(`
          UPDATE purchase_orders SET subtotal = ?, tax_amount = ?, discount_amount = ?, total_amount = ? WHERE id = ?
        `, [subtotal, totalTax, totalDiscount, totalAmount, id]);
      }

      await connection.commit();
      return this.getPOById(id, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // GOODS RECEIVED NOTES (GRN)
  // ===========================================================================

  /**
   * List GRNs for a restaurant with optional filters.
   */
  static async getGRNs(restaurantId, filters = {}) {
    const { purchase_order_id, status, supplier_id, warehouse_id, date_from, date_to, search } = filters;

    let query = `
      SELECT
        grn.*,
        s.name AS supplier_name,
        s.company_name AS supplier_company,
        w.name AS warehouse_name,
        po.po_number
      FROM goods_received_notes grn
      LEFT JOIN suppliers s ON grn.supplier_id = s.id
      LEFT JOIN warehouses w ON grn.warehouse_id = w.id
      LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
      WHERE grn.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (purchase_order_id) { query += ' AND grn.purchase_order_id = ?'; params.push(purchase_order_id); }
    if (status && status !== 'all') { query += ' AND grn.status = ?'; params.push(status); }
    if (supplier_id) { query += ' AND grn.supplier_id = ?'; params.push(supplier_id); }
    if (warehouse_id && warehouse_id !== 'all') { query += ' AND grn.warehouse_id = ?'; params.push(warehouse_id); }
    if (date_from) { query += ' AND grn.grn_date >= ?'; params.push(date_from); }
    if (date_to) { query += ' AND grn.grn_date <= ?'; params.push(date_to); }
    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (grn.grn_number LIKE ? OR s.name LIKE ? OR po.po_number LIKE ?)';
      params.push(s, s, s);
    }

    query += ' ORDER BY grn.created_at DESC';
    const [rows] = await pool.execute(query, params);
    return rows;
  }

  /**
   * Get a single GRN by ID with line items.
   */
  static async getGRNById(id, restaurantId) {
    const [headerRows] = await pool.execute(`
      SELECT
        grn.*,
        s.name AS supplier_name,
        s.company_name AS supplier_company,
        s.mobile AS supplier_mobile,
        s.gst_number AS supplier_gst,
        w.name AS warehouse_name,
        w.code AS warehouse_code,
        po.po_number,
        po.status AS po_status
      FROM goods_received_notes grn
      LEFT JOIN suppliers s ON grn.supplier_id = s.id
      LEFT JOIN warehouses w ON grn.warehouse_id = w.id
      LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
      WHERE grn.id = ? AND grn.restaurant_id = ?
    `, [id, restaurantId]);

    if (headerRows.length === 0) return null;

    const grn = headerRows[0];
    const [items] = await pool.execute(`
      SELECT
        gi.*,
        mi.sku, mi.item_code
      FROM goods_received_note_items gi
      LEFT JOIN menu_items mi ON gi.menu_item_id = mi.id
      WHERE gi.grn_id = ?
      ORDER BY gi.id ASC
    `, [id]);

    grn.items = items;
    return grn;
  }

  /**
   * Create a Goods Received Note (GRN).
   *
   * CRITICAL BUSINESS RULES:
   * 1. PO must be in approved / partially_received status (not cancelled, not yet received beyond ordered).
   * 2. accepted_qty per item must not cause total_received > ordered.
   * 3. Stock increases by accepted_qty via StockMovementService (PURCHASE transaction type).
   * 4. purchase_order_items.received_qty is updated.
   * 5. PO status updates to partially_received or received.
   */
  static async createGRN(restaurantId, userId, userName, data) {
    const {
      purchase_order_id,
      grn_date,
      vehicle_number = null,
      driver_name = null,
      invoice_number = null,
      notes = null,
      items
    } = data;

    if (!purchase_order_id) throw new Error('purchase_order_id is required.');
    if (!items || !Array.isArray(items) || items.length === 0) throw new Error('GRN must contain at least one item.');

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Lock PO row
      const [poRows] = await connection.execute(
        'SELECT id, status, warehouse_id, supplier_id, restaurant_id FROM purchase_orders WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [purchase_order_id, restaurantId]
      );
      if (poRows.length === 0) throw new Error('Purchase Order not found.');

      const po = poRows[0];
      if (po.status === 'cancelled') throw new Error('Cannot receive goods against a cancelled Purchase Order.');
      if (po.status === 'received') throw new Error('Purchase Order is already fully received.');
      if (po.status === 'pending' || po.status === 'draft') throw new Error('Purchase Order must be approved before receiving goods.');

      const warehouseId = po.warehouse_id;
      const supplierId = po.supplier_id;

      // Generate GRN number
      const grnDate = grn_date || getISTDateString();
      const today = grnDate.replace(/-/g, '');
      const prefix = `GRN-${today}-`;
      const [seqRows] = await connection.execute(
        'SELECT grn_number FROM goods_received_notes WHERE restaurant_id = ? AND grn_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );
      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].grn_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const grnNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      // Validate item quantities against PO
      let totalOrderedQty = 0, totalReceivedQty = 0, totalAcceptedQty = 0;
      let totalRejectedQty = 0, totalDamagedQty = 0;

      for (const item of items) {
        const menuItemId = item.menu_item_id || item.id;
        const [poItemRows] = await connection.execute(
          'SELECT id, quantity, received_qty, billed_qty FROM purchase_order_items WHERE purchase_order_id = ? AND menu_item_id = ? FOR UPDATE',
          [purchase_order_id, menuItemId]
        );
        if (poItemRows.length === 0) throw new Error(`Item ID ${menuItemId} is not on this Purchase Order.`);

        const poItem = poItemRows[0];
        const orderedQty = parseFloat(poItem.quantity);
        const previouslyReceived = parseFloat(poItem.received_qty || 0);
        const newReceived = parseFloat(item.received_qty || 0);
        const acceptedQty = parseFloat(item.accepted_qty || newReceived);
        const rejectedQty = parseFloat(item.rejected_qty || 0);
        const damagedQty = parseFloat(item.damaged_qty || 0);

        if (acceptedQty < 0 || rejectedQty < 0 || damagedQty < 0) throw new Error('Quantities cannot be negative.');
        if (previouslyReceived + newReceived > orderedQty + 0.001) {
          throw new Error(`Over-receiving not allowed for item ID ${menuItemId}. Ordered: ${orderedQty}, Already received: ${previouslyReceived}, Now receiving: ${newReceived}.`);
        }

        item._poItemId = poItem.id;
        item._orderedQty = orderedQty;
        item._previouslyReceived = previouslyReceived;
        item._acceptedQty = acceptedQty;
        item._rejectedQty = rejectedQty;
        item._damagedQty = damagedQty;
        item._newReceived = newReceived;
        item._warehouseId = warehouseId;
        item._menuItemId = menuItemId;

        totalOrderedQty += orderedQty;
        totalReceivedQty += newReceived;
        totalAcceptedQty += acceptedQty;
        totalRejectedQty += rejectedQty;
        totalDamagedQty += damagedQty;
      }

      // Insert GRN header
      const [grnResult] = await connection.execute(`
        INSERT INTO goods_received_notes (
          restaurant_id, grn_number, purchase_order_id, supplier_id,
          warehouse_id, grn_date, status,
          total_ordered_qty, total_received_qty, total_accepted_qty,
          total_rejected_qty, total_damaged_qty,
          vehicle_number, driver_name, invoice_number, notes,
          created_by_user_id, created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, grnNumber, purchase_order_id, supplierId,
        warehouseId, grnDate,
        totalOrderedQty, totalReceivedQty, totalAcceptedQty,
        totalRejectedQty, totalDamagedQty,
        vehicle_number, driver_name, invoice_number, notes,
        userId || null, userName || 'Staff'
      ]);
      const grnId = grnResult.insertId;

      // Insert GRN items, update PO item received_qty, update inventory
      for (const item of items) {
        const itemRackId = item.rack_id || null;

        await connection.execute(`
          INSERT INTO goods_received_note_items (
            grn_id, purchase_order_item_id, menu_item_id, item_name, unit,
            ordered_qty, previously_received_qty, received_qty,
            accepted_qty, rejected_qty, damaged_qty,
            rate, tax_rate, batch_number, expiry_date, notes, rack_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          grnId, item._poItemId, item._menuItemId,
          item.item_name || item.name || `Item #${item._menuItemId}`,
          item.unit || 'pcs',
          item._orderedQty, item._previouslyReceived, item._newReceived,
          item._acceptedQty, item._rejectedQty, item._damagedQty,
          parseFloat(item.rate || 0), parseFloat(item.tax_rate || 0),
          item.batch_number || null, item.expiry_date || null, item.notes || null,
          itemRackId
        ]);

        // Update PO item received_qty
        await connection.execute(`
          UPDATE purchase_order_items
          SET received_qty = received_qty + ?
          WHERE id = ? AND purchase_order_id = ?
        `, [item._newReceived, item._poItemId, purchase_order_id]);

        // INVENTORY INCREASE: only accepted_qty goes into stock (and rack)
        if (item._acceptedQty > 0) {
          await StockMovementService.recordMovement(connection, {
            restaurantId,
            warehouseId,
            rackId: itemRackId,
            menuItemId: item._menuItemId,
            type: 'PURCHASE',
            quantity: item._acceptedQty,
            unitCost: parseFloat(item.rate || 0),
            referenceType: 'goods_received_note',
            referenceId: grnId,
            referenceNumber: grnNumber,
            userId: userId || null,
            userName: userName || 'Staff',
            notes: `GRN ${grnNumber} — Goods Received from supplier`
          });

          // Update cost price on the menu item
          await connection.execute(`
            UPDATE menu_items SET purchase_price = ?, cost_price = ?, updated_at = NOW()
            WHERE id = ? AND restaurant_id = ?
          `, [parseFloat(item.rate || 0), parseFloat(item.rate || 0), item._menuItemId, restaurantId]);
        }
      }

      // Recalculate PO status
      const [allPoItems] = await connection.execute(
        'SELECT quantity, received_qty FROM purchase_order_items WHERE purchase_order_id = ?',
        [purchase_order_id]
      );
      let allReceived = true, anyReceived = false;
      for (const poItem of allPoItems) {
        const ordered = parseFloat(poItem.quantity);
        const received = parseFloat(poItem.received_qty || 0);
        if (received > 0) anyReceived = true;
        if (received < ordered - 0.001) allReceived = false;
      }
      const newPoStatus = allReceived ? 'received' : (anyReceived ? 'partially_received' : po.status);
      await connection.execute(
        'UPDATE purchase_orders SET status = ?, updated_at = NOW() WHERE id = ? AND restaurant_id = ?',
        [newPoStatus, purchase_order_id, restaurantId]
      );

      await connection.commit();
      return this.getGRNById(grnId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Convert a GRN to a Purchase Bill.
   * - Uses accepted_qty from GRN as billed quantity.
   * - Updates purchase_order_items.billed_qty.
   * - Creates supplier_ledger entry (PURCHASE_BILL).
   * - Updates suppliers.current_balance.
   * - Updates PO billing status.
   */
  static async convertGRNToBill(grnId, restaurantId, userId, userName, data) {
    const {
      bill_number = null,
      bill_date,
      due_date = null,
      paid_amount = 0,
      payment_mode = null,
      additional_charges = 0,
      notes = null
    } = data;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Fetch GRN with items
      const [grnRows] = await connection.execute(`
        SELECT grn.*, s.current_balance as supplier_balance
        FROM goods_received_notes grn
        LEFT JOIN suppliers s ON grn.supplier_id = s.id
        WHERE grn.id = ? AND grn.restaurant_id = ? FOR UPDATE
      `, [grnId, restaurantId]);

      if (grnRows.length === 0) throw new Error('GRN not found.');
      const grn = grnRows[0];
      if (grn.status === 'cancelled') throw new Error('Cannot bill a cancelled GRN.');

      // Check if a bill already exists for this GRN
      const [existingBill] = await connection.execute(
        'SELECT id FROM purchase_bills WHERE grn_id = ? AND restaurant_id = ?',
        [grnId, restaurantId]
      );
      if (existingBill.length > 0) throw new Error('A Purchase Bill already exists for this GRN.');

      const [grnItems] = await connection.execute(
        'SELECT * FROM goods_received_note_items WHERE grn_id = ?',
        [grnId]
      );

      // Fetch store and supplier tax information
      const [settingsRows] = await connection.execute(
        'SELECT state, state_code FROM receipt_settings WHERE restaurant_id = ?',
        [restaurantId]
      );
      const storeStateCode = settingsRows[0]?.state_code || '27';
      const storeState = settingsRows[0]?.state || 'Maharashtra';

      const [suppRows] = await connection.execute(
        'SELECT gst_number, state FROM suppliers WHERE id = ?',
        [grn.supplier_id]
      );
      const supplier = suppRows[0] || {};
      const supplierGstin = supplier.gst_number || null;
      const supplierState = supplier.state || null;

      const posRes = GstService.resolvePlaceOfSupply({
        storeStateCode,
        storeState,
        customerGstin: supplierGstin,
        customerState: supplierState
      });
      const billTaxType = posRes.taxType;
      const billPlaceOfSupply = supplierState || storeState;

      // Calculate bill totals from GRN items (using accepted_qty)
      let subtotal = 0, totalTax = 0, totalCgst = 0, totalSgst = 0, totalIgst = 0;
      const processedItems = [];

      for (const item of grnItems) {
        const qty = parseFloat(item.accepted_qty);
        const rate = parseFloat(item.rate);
        const taxRate = parseFloat(item.tax_rate || 0);

        const lineCalc = GstService.calculateLineItemTax({
          price: rate,
          quantity: qty,
          discountAmount: 0,
          gstRate: taxRate,
          gstMode: 'excluded',
          taxType: billTaxType,
          hsnCode: item.hsn_code || null
        });

        subtotal += (qty * rate);
        totalTax += lineCalc.totalTax;
        totalCgst += lineCalc.cgstAmount;
        totalSgst += lineCalc.sgstAmount;
        totalIgst += lineCalc.igstAmount;

        processedItems.push({
          ...item,
          qty,
          rate,
          taxRate,
          lineCalc
        });
      }

      subtotal = GstService.round2(subtotal);
      totalTax = GstService.round2(totalTax);
      totalCgst = GstService.round2(totalCgst);
      totalSgst = GstService.round2(totalSgst);
      totalIgst = GstService.round2(totalIgst);

      const addCharges = parseFloat(additional_charges) || 0;
      const totalAmount = Math.max(0, subtotal + totalTax + addCharges);
      const paid = Math.min(parseFloat(paid_amount) || 0, totalAmount);

      let paymentStatus = 'unpaid';
      if (paid >= totalAmount) paymentStatus = 'paid';
      else if (paid > 0) paymentStatus = 'partially_paid';

      // Generate bill number
      const billDate = bill_date || getISTDateString();
      const today = billDate.replace(/-/g, '');
      const prefix = `PB-${today}-`;
      const [seqRows] = await connection.execute(
        'SELECT internal_bill_number FROM purchase_bills WHERE restaurant_id = ? AND internal_bill_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [restaurantId, `${prefix}%`]
      );
      let seqNum = 1;
      if (seqRows.length > 0) {
        const lastNum = parseInt(seqRows[0].internal_bill_number.split('-')[2], 10);
        if (!isNaN(lastNum)) seqNum = lastNum + 1;
      }
      const internalBillNumber = `${prefix}${String(seqNum).padStart(4, '0')}`;

      // Insert Purchase Bill (with complete GST profile)
      const [billResult] = await connection.execute(`
        INSERT INTO purchase_bills (
          restaurant_id, bill_number, internal_bill_number, purchase_order_id, grn_id,
          supplier_id, warehouse_id, bill_date, due_date,
          subtotal, tax_amount, discount_amount, additional_charges,
          total_amount, paid_amount, payment_status, payment_mode,
          status, created_by_user_id, created_by_name, notes, created_at,
          tax_type, cgst_amount, sgst_amount, igst_amount, place_of_supply, supplier_gstin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, 'received', ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)
      `, [
        restaurantId,
        bill_number || internalBillNumber, internalBillNumber,
        grn.purchase_order_id, grnId,
        grn.supplier_id, grn.warehouse_id,
        billDate, due_date || null,
        subtotal, totalTax, addCharges,
        totalAmount, paid, paymentStatus, payment_mode || null,
        userId || null, userName || 'Staff', notes || `GRN ${grn.grn_number}`,
        billTaxType, totalCgst, totalSgst, totalIgst, billPlaceOfSupply, supplierGstin
      ]);
      const billId = billResult.insertId;

      // Insert bill items with line snapshots & update PO item billed_qty
      for (const item of processedItems) {
        const lc = item.lineCalc;

        await connection.execute(`
          INSERT INTO purchase_bill_items (
            purchase_bill_id, menu_item_id, item_name, unit,
            quantity, rate, tax_rate, tax_amount, discount_amount,
            total_amount, batch_number, expiry_date,
            hsn_code, taxable_amount, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          billId, item.menu_item_id, item.item_name, item.unit || 'pcs',
          item.qty, item.rate, item.taxRate, lc.totalTax, lc.lineTotal,
          item.batch_number || null, item.expiry_date || null,
          lc.hsnCode, lc.taxableAmount, lc.cgstRate, lc.cgstAmount, lc.sgstRate, lc.sgstAmount, lc.igstRate, lc.igstAmount
        ]);

        // Track billed_qty on the PO item
        await connection.execute(`
          UPDATE purchase_order_items
          SET billed_qty = billed_qty + ?
          WHERE purchase_order_id = ? AND menu_item_id = ?
        `, [qty, grn.purchase_order_id, item.menu_item_id]);
      }

      // Create supplier_ledger entry (PURCHASE_BILL increases payable)
      const outstanding = totalAmount - paid;
      const prevBalance = parseFloat(grn.supplier_balance || 0);
      const newBalance = prevBalance + outstanding;

      const [slResult] = await connection.execute(`
        INSERT INTO supplier_ledger (
          restaurant_id, supplier_id, transaction_type,
          amount, balance_after, reference_type, reference_id, reference_number,
          user_id, user_name, notes, created_at
        ) VALUES (?, ?, 'PURCHASE_BILL', ?, ?, 'purchase_bill', ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId, grn.supplier_id,
        outstanding, newBalance,
        billId, internalBillNumber,
        userId || null, userName || 'Staff',
        `Purchase Bill ${internalBillNumber} against GRN ${grn.grn_number}`
      ]);

      // Update bill with supplier_ledger_id
      await connection.execute(
        'UPDATE purchase_bills SET supplier_ledger_id = ? WHERE id = ?',
        [slResult.insertId, billId]
      );

      // Update supplier balance
      await connection.execute(`
        UPDATE suppliers SET current_balance = ?, updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [newBalance, grn.supplier_id, restaurantId]);

      // If paid upfront, record payment entry
      if (paid > 0) {
        const paymentDate = billDate;
        const todayPay = paymentDate.replace(/-/g, '');
        const prefixPay = `SP-${todayPay}-`;
        const [seqPay] = await connection.execute(
          'SELECT payment_number FROM supplier_payments WHERE restaurant_id = ? AND payment_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
          [restaurantId, `${prefixPay}%`]
        );
        let seqNumPay = 1;
        if (seqPay.length > 0) {
          const ln = parseInt(seqPay[0].payment_number.split('-')[2], 10);
          if (!isNaN(ln)) seqNumPay = ln + 1;
        }
        const payNumber = `${prefixPay}${String(seqNumPay).padStart(4, '0')}`;

        await connection.execute(`
          INSERT INTO supplier_payments (
            restaurant_id, payment_number, supplier_id, purchase_bill_id,
            payment_date, amount, payment_mode, notes,
            created_by_user_id, created_by_name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId, payNumber, grn.supplier_id, billId,
          paymentDate, paid, payment_mode || 'Bank Transfer',
          `Upfront payment on bill ${internalBillNumber}`,
          userId || null, userName || 'Staff'
        ]);

        // Ledger entry for payment
        await connection.execute(`
          INSERT INTO supplier_ledger (
            restaurant_id, supplier_id, transaction_type,
            amount, balance_after, reference_type, reference_id, reference_number,
            payment_mode, user_id, user_name, notes, created_at
          ) VALUES (?, ?, 'PAYMENT', ?, ?, 'supplier_payment', ?, ?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId, grn.supplier_id,
          -paid, newBalance - paid,
          billId, payNumber,
          payment_mode || 'Bank Transfer',
          userId || null, userName || 'Staff',
          `Payment against bill ${internalBillNumber}`
        ]);

        // Update supplier balance again for payment
        await connection.execute(`
          UPDATE suppliers SET current_balance = GREATEST(0, current_balance - ?), updated_at = NOW()
          WHERE id = ? AND restaurant_id = ?
        `, [paid, grn.supplier_id, restaurantId]);

        try {
          const FinancialAccountService = require('../services/financial_account_service');
          await FinancialAccountService.recordSupplierPayment(connection, {
            restaurantId,
            supplierId: grn.supplier_id,
            supplierName: grn.supplier_name || null,
            purchaseBillId: billId,
            paymentNumber: payNumber,
            paymentMode: payment_mode || 'Bank Transfer',
            amount: paid,
            userId,
            userName,
            notes: `Upfront payment on bill ${internalBillNumber}`
          });
        } catch (finErr) {
          console.warn('[Financial Account Supplier Payment Notice]:', finErr.message);
        }
      }

      await connection.commit();
      return this.getBillById(billId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // SUPPLIER PAYMENTS
  // ===========================================================================

  /**
   * Record a supplier payment (against bills or general/advance).
   * Fully unified with SupplierPayableRepository multi-allocation engine.
   */
  static async recordSupplierPayment(restaurantId, userId, userName, data) {
    const SupplierPayableRepository = require('./supplier_payable_repository');
    let allocations = data.allocations || [];
    if (allocations.length === 0 && data.purchase_bill_id) {
      allocations = [{
        purchase_bill_id: data.purchase_bill_id,
        allocated_amount: parseFloat(data.amount)
      }];
    }
    return SupplierPayableRepository.recordSupplierPaymentWithAllocations(
      restaurantId,
      userId,
      userName,
      { ...data, allocations }
    );
  }

  /**
   * Get supplier payments list.
   */
  static async getSupplierPayments(restaurantId, filters = {}) {
    const { supplier_id, purchase_bill_id } = filters;
    let query = `
      SELECT 
        sp.*, 
        s.name AS supplier_name,
        s.supplier_code,
        pb.internal_bill_number AS bill_number,
        fa.account_name,
        fa.bank_name,
        (SELECT COUNT(*) FROM supplier_payment_allocations spa WHERE spa.supplier_payment_id = sp.id) AS allocated_bills_count
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN purchase_bills pb ON sp.purchase_bill_id = pb.id
      LEFT JOIN financial_accounts fa ON sp.account_id = fa.id
      WHERE sp.restaurant_id = ?
    `;
    const params = [restaurantId];
    if (supplier_id) { query += ' AND sp.supplier_id = ?'; params.push(supplier_id); }
    if (purchase_bill_id) { query += ' AND sp.purchase_bill_id = ?'; params.push(purchase_bill_id); }
    query += ' ORDER BY sp.created_at DESC';
    const [rows] = await pool.execute(query, params);
    return rows;
  }

  // ===========================================================================
  // SUPPLIER LEDGER
  // ===========================================================================

  /**
   * Get supplier ledger journal with running balance.
   */
  static async getSupplierLedger(supplierId, restaurantId, filters = {}) {
    const { date_from, date_to } = filters;

    let query = `
      SELECT sl.*, s.name AS supplier_name, s.current_balance
      FROM supplier_ledger sl
      LEFT JOIN suppliers s ON sl.supplier_id = s.id
      WHERE sl.restaurant_id = ? AND sl.supplier_id = ?
    `;
    const params = [restaurantId, supplierId];

    if (date_from) { query += ' AND sl.created_at >= ?'; params.push(date_from); }
    if (date_to) { query += ' AND sl.created_at <= ?'; params.push(date_to); }

    query += ' ORDER BY sl.created_at ASC';

    const [rows] = await pool.execute(query, params);

    // Fetch supplier summary
    const [suppRows] = await pool.execute(
      'SELECT name, company_name, mobile, current_balance, opening_balance FROM suppliers WHERE id = ? AND restaurant_id = ?',
      [supplierId, restaurantId]
    );

    return {
      supplier: suppRows[0] || null,
      ledger: rows,
      current_balance: suppRows[0]?.current_balance || 0
    };
  }

  // ===========================================================================
  // PURCHASE RETURNS — GET LIST
  // ===========================================================================

  /**
   * Fetch all purchase returns (previously missing from API).
   */
  static async getReturns(restaurantId, filters = {}) {
    const { supplier_id, date_from, date_to, search } = filters;

    let query = `
      SELECT
        pr.*,
        s.name AS supplier_name,
        s.company_name AS supplier_company,
        w.name AS warehouse_name,
        pb.internal_bill_number AS bill_number
      FROM purchase_returns pr
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN warehouses w ON pr.warehouse_id = w.id
      LEFT JOIN purchase_bills pb ON pr.purchase_bill_id = pb.id
      WHERE pr.restaurant_id = ?
    `;
    const params = [restaurantId];

    if (supplier_id) { query += ' AND pr.supplier_id = ?'; params.push(supplier_id); }
    if (date_from) { query += ' AND pr.return_date >= ?'; params.push(date_from); }
    if (date_to) { query += ' AND pr.return_date <= ?'; params.push(date_to); }
    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      query += ' AND (pr.return_number LIKE ? OR s.name LIKE ?)';
      params.push(s, s);
    }

    query += ' ORDER BY pr.created_at DESC';
    const [rows] = await pool.execute(query, params);
    return rows;
  }
}

module.exports = PurchaseRepository;

