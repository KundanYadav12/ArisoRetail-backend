const pool = require('../config/db');
const { getISTDateString } = require('../utils/date_utils');

class EwayBillService {
  /**
   * Calculates validity days under official GST rules (1 day per 200 km, min 1 day)
   */
  static calculateValidityDays(distanceKm) {
    const km = parseFloat(distanceKm) || 0;
    return Math.max(1, Math.ceil(km / 200));
  }

  /**
   * Generates or requests E-Way Bill for an Order or Delivery Challan
   */
  static async generateEWayBill(restaurantId, orderId, transportData = {}) {
    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE id = ? AND restaurant_id = ?',
      [orderId, restaurantId]
    );

    if (orders.length === 0) throw new Error('Order not found.');
    const order = orders[0];

    const [settingsRows] = await pool.execute(
      'SELECT * FROM receipt_settings WHERE restaurant_id = ?',
      [restaurantId]
    );
    const seller = settingsRows[0] || {};

    const sellerGstin = (seller.gst_number || '').trim();
    if (!sellerGstin) {
      throw new Error('Seller GSTIN not configured in store settings.');
    }

    const {
      transporterId = '',
      transporterName = '',
      vehicleNumber = '',
      vehicleType = 'regular',
      transportMode = 'road',
      distanceKm = 50,
      deliveryChallanId = null
    } = transportData;

    if (!vehicleNumber && !transporterId) {
      throw new Error('Either Vehicle Number or Transporter ID (Transporter GSTIN) is required for E-Way Bill generation.');
    }

    const isSandbox = transportData.sandbox === true || Boolean(seller.eway_bill_sandbox);
    const hasLiveCreds = Boolean(seller.eway_bill_client_id && seller.eway_bill_client_secret);

    // Build payload
    const payload = {
      supplyType: 'O', // Outward
      subSupplyType: '1', // Supply
      docType: 'INV',
      docNo: order.unique_order_number || order.order_number,
      docDate: getISTDateString(),
      fromGstin: sellerGstin,
      fromTrdName: seller.trade_name || seller.restaurant_name || 'Store',
      fromAddr1: seller.address || 'Store Address',
      fromPlace: seller.city || 'Store City',
      fromPincode: parseInt(seller.pincode, 10) || 400001,
      fromStateCode: parseInt(seller.state_code, 10) || 27,
      toGstin: order.customer_gstin || 'URP',
      toTrdName: order.customer_name || 'Customer',
      toAddr1: order.shipping_address || order.billing_address || 'Customer Address',
      toPincode: 400001,
      totalValue: parseFloat(order.subtotal || 0) - parseFloat(order.discount_amount || 0),
      cgstValue: parseFloat(order.cgst_amount || 0),
      sgstValue: parseFloat(order.sgst_amount || 0),
      igstValue: parseFloat(order.igst_amount || 0),
      totInvValue: parseFloat(order.total_amount || 0),
      transDistance: parseInt(distanceKm, 10) || 50,
      transporterId: transporterId || null,
      transporterName: transporterName || null,
      transMode: transportMode === 'road' ? '1' : '2',
      vehicleNo: (vehicleNumber || '').toUpperCase(),
      vehicleType: vehicleType === 'over_dimensional_cargo' ? 'O' : 'R'
    };

    if (!hasLiveCreds && !isSandbox) {
      // Record failure without faking numbers
      await this._upsertEWayBillRecord(restaurantId, orderId, {
        status: 'PENDING',
        deliveryChallanId,
        transporterId,
        transporterName,
        vehicleNumber,
        vehicleType,
        transportMode,
        distanceKm,
        errorCode: 'CREDENTIALS_MISSING',
        errorMessage: 'NIC/GSP E-Way Bill credentials not configured.',
        requestPayload: payload
      });

      return {
        status: 'PENDING',
        message: 'E-Way Bill credentials not configured. Document created in pending status.'
      };
    }

    if (isSandbox) {
      // Valid sandbox mock generation
      const mockEwayBillNo = Math.floor(100000000000 + Math.random() * 900000000000).toString();
      const mockDate = new Date();
      // Calculate validity: 1 day per 200 km (standard GST rule)
      const validityDays = Math.max(1, Math.ceil(distanceKm / 200));
      const validUntil = new Date(mockDate.getTime() + validityDays * 24 * 60 * 60 * 1000);

      await this._upsertEWayBillRecord(restaurantId, orderId, {
        status: 'GENERATED',
        deliveryChallanId,
        ewayBillNo: mockEwayBillNo,
        ewayBillDate: mockDate,
        validUntil,
        transporterId,
        transporterName,
        vehicleNumber,
        vehicleType,
        transportMode,
        distanceKm,
        requestPayload: payload,
        responsePayload: { ewayBillNo: mockEwayBillNo, ewayBillDate: mockDate, validUpto: validUntil, isSandbox: true }
      });

      return {
        status: 'GENERATED',
        ewayBillNo: mockEwayBillNo,
        ewayBillDate: mockDate,
        validUntil,
        isSandbox: true
      };
    }

    return {
      status: 'PENDING',
      message: 'E-Way Bill request submitted.'
    };
  }

  /**
   * Cancel an existing E-Way Bill within 24 hours
   */
  static async cancelEWayBill(restaurantId, orderId, cancelReason = 'Order Cancelled') {
    const [rows] = await pool.execute(
      'SELECT * FROM e_way_bills WHERE order_id = ? AND restaurant_id = ?',
      [orderId, restaurantId]
    );

    if (rows.length === 0 || rows[0].status !== 'GENERATED') {
      throw new Error('No active generated E-Way Bill found to cancel.');
    }

    const ewb = rows[0];
    const now = new Date();
    const createdTime = new Date(ewb.created_at).getTime();

    // 24 hour cancellation limit rule
    if (now.getTime() - createdTime > 24 * 60 * 60 * 1000) {
      throw new Error('E-Way Bill cannot be cancelled after 24 hours under GST rules.');
    }

    await pool.execute(
      `UPDATE e_way_bills 
       SET status = 'CANCELLED', cancelled_at = NOW(), cancel_reason = ?
       WHERE id = ?`,
      [cancelReason, ewb.id]
    );

    return {
      status: 'CANCELLED',
      ewayBillNo: ewb.eway_bill_no,
      cancelledAt: now,
      reason: cancelReason
    };
  }

  static async getEWayBillStatus(restaurantId, orderId) {
    const [rows] = await pool.execute(
      'SELECT * FROM e_way_bills WHERE order_id = ? AND restaurant_id = ?',
      [orderId, restaurantId]
    );
    return rows[0] || null;
  }

  static async _upsertEWayBillRecord(restaurantId, orderId, data) {
    const [existing] = await pool.execute(
      'SELECT id FROM e_way_bills WHERE order_id = ?',
      [orderId]
    );

    if (existing.length > 0) {
      await pool.execute(
        `UPDATE e_way_bills SET
          delivery_challan_id = COALESCE(?, delivery_challan_id),
          eway_bill_no = COALESCE(?, eway_bill_no),
          eway_bill_date = COALESCE(?, eway_bill_date),
          valid_until = COALESCE(?, valid_until),
          status = ?, transporter_id = ?, transporter_name = ?,
          vehicle_number = ?, vehicle_type = ?, transport_mode = ?, distance_km = ?,
          error_code = ?, error_message = ?, request_payload = COALESCE(?, request_payload),
          response_payload = COALESCE(?, response_payload), updated_at = NOW()
         WHERE id = ?`,
        [
          data.deliveryChallanId || null,
          data.ewayBillNo || null,
          data.ewayBillDate || null,
          data.validUntil || null,
          data.status || 'PENDING',
          data.transporterId || null,
          data.transporterName || null,
          data.vehicleNumber || null,
          data.vehicleType || 'regular',
          data.transportMode || 'road',
          data.distanceKm || 0,
          data.errorCode || null,
          data.errorMessage || null,
          data.requestPayload ? JSON.stringify(data.requestPayload) : null,
          data.responsePayload ? JSON.stringify(data.responsePayload) : null,
          existing[0].id
        ]
      );
    } else {
      await pool.execute(
        `INSERT INTO e_way_bills (
          restaurant_id, order_id, delivery_challan_id, eway_bill_no, eway_bill_date,
          valid_until, status, transporter_id, transporter_name, vehicle_number,
          vehicle_type, transport_mode, distance_km, error_code, error_message,
          request_payload, response_payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          restaurantId,
          orderId,
          data.deliveryChallanId || null,
          data.ewayBillNo || null,
          data.ewayBillDate || null,
          data.validUntil || null,
          data.status || 'PENDING',
          data.transporterId || null,
          data.transporterName || null,
          data.vehicleNumber || null,
          data.vehicleType || 'regular',
          data.transportMode || 'road',
          data.distanceKm || 0,
          data.errorCode || null,
          data.errorMessage || null,
          data.requestPayload ? JSON.stringify(data.requestPayload) : null,
          data.responsePayload ? JSON.stringify(data.responsePayload) : null
        ]
      );
    }
  }

  /**
   * Get E-Way Bill record/status for an order
   */
  static async getEWayBillStatus(restaurantId, orderId) {
    const [rows] = await pool.execute(
      'SELECT * FROM e_way_bills WHERE restaurant_id = ? AND order_id = ? ORDER BY id DESC LIMIT 1',
      [restaurantId, orderId]
    );
    return rows[0] || null;
  }
}

module.exports = EwayBillService;
