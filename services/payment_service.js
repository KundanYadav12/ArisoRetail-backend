/**
 * Merchant Isolated Payment Service (Razorpay, Paytm & PhonePe)
 * 
 * Supports:
 * - Server-side order creation using merchant's isolated API keys
 * - Cryptographic HMAC SHA256 signature and checksum verification
 * - Webhook / Callback signature verification
 * - Server-side status checks & refund initiation
 * - Zero hardcoding or leaking of keys
 */

const crypto = require('crypto');
const PaytmService = require('./payments/paytm_service');
const PhonePeService = require('./payments/phonepe_service');

class PaymentService {
  /* =========================================================================
   * 1. RAZORPAY INTEGRATION
   * ========================================================================= */

  /**
   * Create Razorpay Order with Merchant Credentials
   */
  static async createRazorpayOrder({ keyId, keySecret, amountInRupees, currency = 'INR', receipt, notes = {} }) {
    if (!keyId || !keySecret) {
      throw new Error('Merchant Razorpay Key ID and Key Secret are required to initiate online payment.');
    }

    const amountInPaise = Math.round(parseFloat(amountInRupees) * 100);
    if (isNaN(amountInPaise) || amountInPaise <= 0) {
      throw new Error('Invalid order payment amount.');
    }

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const payload = {
      amount: amountInPaise,
      currency: currency.toUpperCase(),
      receipt: String(receipt || Date.now()).slice(0, 40),
      notes: {
        ...notes,
        platform: 'Ariso Retail'
      }
    };

    try {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        const errorDesc = data.error?.description || data.error?.message || 'Razorpay order creation failed.';
        throw new Error(`Razorpay Error: ${errorDesc}`);
      }

      return {
        id: data.id,
        entity: data.entity,
        amount: data.amount,
        amount_paid: data.amount_paid,
        amount_due: data.amount_due,
        currency: data.currency,
        receipt: data.receipt,
        status: data.status
      };
    } catch (err) {
      console.error('[PaymentService.createRazorpayOrder Error]:', err.message);
      throw err;
    }
  }

  /**
   * Verify Razorpay Payment Signature
   */
  static verifyRazorpaySignature({ keySecret, razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    if (!keySecret) {
      return { verified: false, error: 'Merchant Key Secret missing.' };
    }
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return { verified: false, error: 'Payment details incomplete (order ID, payment ID, and signature required).' };
    }

    try {
      const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(payload)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf-8'),
        Buffer.from(razorpaySignature, 'utf-8')
      );

      return {
        verified: isValid,
        error: isValid ? null : 'Payment signature mismatch. Tampered or invalid payment callback.'
      };
    } catch (err) {
      return { verified: false, error: `Signature verification error: ${err.message}` };
    }
  }

  /**
   * Verify Signed Webhook
   */
  static verifyWebhookSignature({ webhookSecret, rawBody, webhookSignature }) {
    if (!webhookSecret || !webhookSignature) {
      return false;
    }
    try {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf-8'),
        Buffer.from(webhookSignature, 'utf-8')
      );
    } catch (err) {
      console.error('[PaymentService.verifyWebhookSignature Error]:', err.message);
      return false;
    }
  }

  /**
   * Initiate Razorpay Refund for Rejected / Cancelled Paid Orders
   */
  static async initiateRefund({ keyId, keySecret, paymentId, amountInRupees, notes = {} }) {
    if (!keyId || !keySecret || !paymentId) {
      throw new Error('Key ID, Key Secret, and Payment ID are required to issue a refund.');
    }

    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const payload = {
      notes: {
        ...notes,
        reason: 'Merchant cancelled/rejected online order'
      }
    };

    if (amountInRupees && parseFloat(amountInRupees) > 0) {
      payload.amount = Math.round(parseFloat(amountInRupees) * 100);
    }

    try {
      const response = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.description || 'Refund request failed.');
      }

      return data;
    } catch (err) {
      console.error('[PaymentService.initiateRefund Error]:', err.message);
      throw err;
    }
  }

  /* =========================================================================
   * 2. PAYTM INTEGRATION
   * ========================================================================= */

  static async createPaytmTransaction(params) {
    return await PaytmService.initiateTransaction(params);
  }

  static async checkPaytmStatus(params) {
    return await PaytmService.checkTransactionStatus(params);
  }

  static verifyPaytmChecksum(params, merchantKey, receivedChecksum) {
    return PaytmService.verifyChecksum(params, merchantKey, receivedChecksum);
  }

  /* =========================================================================
   * 3. PHONEPE INTEGRATION
   * ========================================================================= */

  static async createPhonePePayment(params) {
    return await PhonePeService.initiatePayment(params);
  }

  static async checkPhonePeStatus(params) {
    return await PhonePeService.checkStatus(params);
  }

  static verifyPhonePeCallback(responseBase64, saltKey, saltIndex, receivedXVerify) {
    return PhonePeService.verifyCallback(responseBase64, saltKey, saltIndex, receivedXVerify);
  }

  /* =========================================================================
   * 4. UNIFIED REFUND DISPATCHER
   * ========================================================================= */

  static async initiateUnifiedRefund({ gateway, merchantSettings, order, amountInRupees }) {
    const gw = (gateway || order.payment_gateway || 'razorpay').toLowerCase();

    if (gw === 'razorpay') {
      return await this.initiateRefund({
        keyId: merchantSettings.razorpay_key_id,
        keySecret: merchantSettings.razorpay_key_secret,
        paymentId: order.gateway_payment_id,
        amountInRupees: amountInRupees || order.total_amount
      });
    }

    if (gw === 'paytm') {
      return await PaytmService.initiateRefund({
        mid: merchantSettings.paytm_mid,
        merchantKey: merchantSettings.paytm_merchant_key,
        orderId: order.unique_order_number || order.id,
        txnId: order.gateway_payment_id,
        refundAmount: amountInRupees || order.total_amount,
        mode: merchantSettings.paytm_mode
      });
    }

    if (gw === 'phonepe') {
      return await PhonePeService.initiateRefund({
        merchantId: merchantSettings.phonepe_merchant_id,
        saltKey: merchantSettings.phonepe_salt_key,
        saltIndex: merchantSettings.phonepe_salt_index,
        originalTransactionId: order.unique_order_number || order.id,
        amountInRupees: amountInRupees || order.total_amount,
        mode: merchantSettings.phonepe_mode
      });
    }

    throw new Error(`Unsupported payment gateway "${gateway}" for automated refund.`);
  }
}

module.exports = PaymentService;
