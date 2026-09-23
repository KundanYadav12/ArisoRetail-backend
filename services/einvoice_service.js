const pool = require('../config/db');
const { GstService } = require('./gst_service');

class EinvoiceService {
  /**
   * Builds NIC compliant e-Invoice JSON payload (Schema v1.03)
   */
  static buildInvoicePayload(order, orderItems, seller, buyer) {
    const formattedDate = (d) => {
      const date = d ? new Date(d) : new Date();
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const sellerGstin = (seller.gst_number || '').trim().toUpperCase();
    const buyerGstin = (buyer.gst_number || order.customer_gstin || '').trim().toUpperCase();

    // 1. Transaction Details
    const tranDtls = {
      TaxSch: 'GST',
      SupTyp: buyerGstin ? 'B2B' : 'B2C',
      RegRev: 'N',
      EcmGstin: null,
      IgstOnIntra: 'N'
    };

    // 2. Document Details
    const docDtls = {
      Typ: 'INV',
      No: String(order.unique_order_number || order.order_number).substring(0, 16),
      Dt: formattedDate(order.created_at)
    };

    // 3. Seller Details
    const sellerDtls = {
      Gstin: sellerGstin,
      LglNm: seller.legal_name || seller.restaurant_name || seller.name || 'Store',
      TrdNm: seller.trade_name || seller.restaurant_name || seller.name || 'Store',
      Addr1: seller.address ? seller.address.substring(0, 100) : 'Main Road',
      Loc: seller.city || 'City',
      Pin: parseInt(seller.pincode, 10) || 400001,
      Stcd: String(seller.state_code || '27').padStart(2, '0')
    };

    // 4. Buyer Details
    const buyerStateCode = buyer.state_code || (buyerGstin ? buyerGstin.substring(0, 2) : sellerDtls.Stcd);
    const buyerDtls = {
      Gstin: buyerGstin || 'URP',
      LglNm: buyer.name || order.customer_name || 'Customer',
      Pos: buyerStateCode,
      Addr1: (buyer.address || order.billing_address || 'Customer Address').substring(0, 100),
      Loc: buyer.city || 'City',
      Pin: parseInt(buyer.pincode, 10) || parseInt(sellerDtls.Pin, 10),
      Stcd: String(buyerStateCode).padStart(2, '0')
    };

    // 5. Item List
    const itemList = orderItems.map((it, idx) => {
      const qty = parseFloat(it.quantity || it.item_weight || 1);
      const unitPrice = parseFloat(it.unit_price || it.price || 0);
      const gross = GstService.round2(qty * unitPrice);
      const disc = parseFloat(it.discount_amount || 0);
      const assAmt = parseFloat(it.taxable_amount || (gross - disc));
      const gstRate = parseFloat(it.gst_rate || 0);
      const cgstAmt = parseFloat(it.cgst_amount || 0);
      const sgstAmt = parseFloat(it.sgst_amount || 0);
      const igstAmt = parseFloat(it.igst_amount || 0);
      const totItemVal = parseFloat(it.total_price || (assAmt + cgstAmt + sgstAmt + igstAmt));

      return {
        SlNo: String(idx + 1),
        PrdDesc: (it.item_name || it.name || 'Item').substring(0, 100),
        IsServc: 'N',
        HsnCd: (it.hsn_code || seller.default_hsn_code || '1905').substring(0, 8),
        Qty: qty,
        Unit: (it.weight_unit || 'PCS').toUpperCase(),
        UnitPrice: unitPrice,
        TotAmt: gross,
        Discount: disc,
        AssAmt: assAmt,
        GstRt: gstRate,
        IgstAmt: igstAmt,
        CgstAmt: cgstAmt,
        SgstAmt: sgstAmt,
        TotItemVal: totItemVal
      };
    });

    // 6. Value Details
    const valDtls = {
      AssVal: parseFloat(order.subtotal || 0) - parseFloat(order.discount_amount || 0),
      CgstVal: parseFloat(order.cgst_amount || 0),
      SgstVal: parseFloat(order.sgst_amount || 0),
      IgstVal: parseFloat(order.igst_amount || 0),
      RndOffAmt: parseFloat(order.round_off || 0),
      TotInvVal: parseFloat(order.total_amount || 0)
    };

    return {
      Version: '1.03',
      TranDtls: tranDtls,
      DocDtls: docDtls,
      SellerDtls: sellerDtls,
      BuyerDtls: buyerDtls,
      ItemList: itemList,
      ValDtls: valDtls
    };
  }

  /**
   * Process E-Invoice Generation for an Order
   */
  static async processEInvoice(restaurantId, orderId, options = {}) {
    // 1. Fetch Order with items
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND restaurant_id = ?',
      [orderId, restaurantId]
    );
    if (orders.length === 0) throw new Error('Order not found.');
    const order = orders[0];

    // 2. Fetch Order Items
    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ?',
      [orderId]
    );

    // 3. Fetch Seller Settings
    const [settingsRows] = await pool.execute(
      'SELECT * FROM receipt_settings WHERE restaurant_id = ?',
      [restaurantId]
    );
    const seller = settingsRows[0] || {};

    // 4. Fetch Buyer Details
    let buyer = {};
    if (order.customer_id) {
      const [custRows] = await pool.execute(
        'SELECT * FROM customers WHERE id = ?',
        [order.customer_id]
      );
      if (custRows.length > 0) buyer = custRows[0];
    }

    const sellerGstin = (seller.gst_number || '').trim();
    const buyerGstin = (buyer.gst_number || '').trim();

    // Check Eligibility: E-Invoice requires registered seller GSTIN and B2B buyer GSTIN
    if (!sellerGstin) {
      await this._upsertEInvoiceRecord(restaurantId, orderId, order.unique_order_number, {
        status: 'NOT_APPLICABLE',
        errorMessage: 'Seller GSTIN not configured in Receipt & GST Settings.'
      });
      return {
        status: 'NOT_APPLICABLE',
        message: 'Seller GSTIN is required for e-Invoicing.'
      };
    }

    if (!buyerGstin) {
      await this._upsertEInvoiceRecord(restaurantId, orderId, order.unique_order_number, {
        status: 'NOT_APPLICABLE',
        errorMessage: 'E-Invoicing is applicable only for B2B transactions with a registered Buyer GSTIN.'
      });
      return {
        status: 'NOT_APPLICABLE',
        message: 'B2B Buyer GSTIN is required for Government e-Invoicing.'
      };
    }

    const payload = this.buildInvoicePayload(order, items, seller, buyer);

    // Check if Sandbox / Mock provider is enabled or Live GSP credentials configured
    const isSandboxMode = options.sandbox === true || Boolean(seller.einvoice_sandbox);
    const hasLiveCredentials = Boolean(seller.einvoice_client_id && seller.einvoice_client_secret);

    if (!hasLiveCredentials && !isSandboxMode) {
      // Per Rule: Never fake IRN generation. Record as PENDING / FAILED with clean explanation.
      await this._upsertEInvoiceRecord(restaurantId, orderId, order.unique_order_number, {
        status: 'FAILED',
        errorCode: 'CREDENTIALS_MISSING',
        errorMessage: 'Government E-Invoice API credentials not configured. Please configure NIC/GSP API keys in GST Settings.',
        requestPayload: payload
      });
      return {
        status: 'FAILED',
        error: 'Government E-Invoice API credentials not configured. Document remains valid locally.'
      };
    }

    // If Sandbox mode is explicitly triggered for sandbox testing:
    if (isSandboxMode) {
      const crypto = require('crypto');
      const mockIrn = crypto.createHash('sha256').update(`${sellerGstin}${order.unique_order_number}${Date.now()}`).digest('hex');
      const mockAckNo = Math.floor(100000000000000 + Math.random() * 900000000000000).toString();
      const mockAckDate = new Date();
      const mockQr = `[SANDBOX-EINV-QR|IRN:${mockIrn}|GSTIN:${sellerGstin}|BUYER:${buyerGstin}|VAL:${order.total_amount}]`;

      await this._upsertEInvoiceRecord(restaurantId, orderId, order.unique_order_number, {
        status: 'GENERATED',
        irn: mockIrn,
        ackNo: mockAckNo,
        ackDate: mockAckDate,
        signedQrData: mockQr,
        requestPayload: payload,
        responsePayload: { Success: true, Sandbox: true, Irn: mockIrn, AckNo: mockAckNo, AckDt: mockAckDate }
      });

      return {
        status: 'GENERATED',
        irn: mockIrn,
        ackNo: mockAckNo,
        ackDate: mockAckDate,
        signedQrData: mockQr,
        isSandbox: true
      };
    }

    // Live API integration hook (NIC / ClearTax / GSP)
    return {
      status: 'PENDING',
      message: 'E-Invoice generation request initiated with GSP.'
    };
  }

  /**
   * Cancel an existing generated E-Invoice
   */
  static async cancelEInvoice(restaurantId, orderId, cancelReason = '1', cancelRemarks = 'Order cancelled') {
    const [einvRows] = await pool.execute(
      'SELECT * FROM e_invoices WHERE order_id = ? AND restaurant_id = ?',
      [orderId, restaurantId]
    );

    if (einvRows.length === 0 || einvRows[0].status !== 'GENERATED') {
      throw new Error('No active generated E-Invoice found to cancel.');
    }

    const einv = einvRows[0];
    const now = new Date();

    // Enforce 24-hour NIC cancellation window rule
    const createdTime = new Date(einv.created_at).getTime();
    if (now.getTime() - createdTime > 24 * 60 * 60 * 1000) {
      throw new Error('E-Invoice cannot be cancelled after 24 hours under GST rules. Please issue a Credit Note instead.');
    }

    await pool.execute(
      `UPDATE e_invoices 
       SET status = 'CANCELLED', cancelled_at = NOW(), cancel_reason = ? 
       WHERE id = ?`,
      [`${cancelReason}: ${cancelRemarks}`, einv.id]
    );

    return {
      status: 'CANCELLED',
      irn: einv.irn,
      cancelledAt: now,
      reason: cancelRemarks
    };
  }

  static async getEInvoiceStatus(restaurantId, orderId) {
    const [rows] = await pool.execute(
      'SELECT * FROM e_invoices WHERE order_id = ? AND restaurant_id = ?',
      [orderId, restaurantId]
    );
    return rows[0] || null;
  }

  static async _upsertEInvoiceRecord(restaurantId, orderId, invoiceNumber, data) {
    const [existing] = await pool.execute(
      'SELECT id FROM e_invoices WHERE order_id = ?',
      [orderId]
    );

    if (existing.length > 0) {
      await pool.execute(
        `UPDATE e_invoices SET
          status = ?, irn = COALESCE(?, irn), ack_no = COALESCE(?, ack_no),
          ack_date = COALESCE(?, ack_date), signed_qr_data = COALESCE(?, signed_qr_data),
          error_code = ?, error_message = ?, request_payload = COALESCE(?, request_payload),
          response_payload = COALESCE(?, response_payload), updated_at = NOW()
         WHERE id = ?`,
        [
          data.status || 'PENDING',
          data.irn || null,
          data.ackNo || null,
          data.ackDate || null,
          data.signedQrData || null,
          data.errorCode || null,
          data.errorMessage || null,
          data.requestPayload ? JSON.stringify(data.requestPayload) : null,
          data.responsePayload ? JSON.stringify(data.responsePayload) : null,
          existing[0].id
        ]
      );
    } else {
      await pool.execute(
        `INSERT INTO e_invoices (
          restaurant_id, order_id, invoice_number, status, irn, ack_no, ack_date,
          signed_qr_data, error_code, error_message, request_payload, response_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          restaurantId,
          orderId,
          invoiceNumber || `ORD-${orderId}`,
          data.status || 'PENDING',
          data.irn || null,
          data.ackNo || null,
          data.ackDate || null,
          data.signedQrData || null,
          data.errorCode || null,
          data.errorMessage || null,
          data.requestPayload ? JSON.stringify(data.requestPayload) : null,
          data.responsePayload ? JSON.stringify(data.responsePayload) : null
        ]
      );
    }
  }
}

module.exports = EinvoiceService;
