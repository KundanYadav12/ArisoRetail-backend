/**
 * PhonePe Payment Gateway Integration Service
 * 
 * Supports:
 * - PhonePe Standard Checkout (/pg/v1/pay)
 * - Cryptographic SHA256 X-VERIFY calculation & verification with Salt Key & Salt Index
 * - Server-side transaction status check (/pg/v1/status/{merchantId}/{transactionId})
 * - Server-side refund initiation (/pg/v1/refund)
 * - Callback & Webhook authenticity verification
 * - Sandbox and Production modes
 */

const crypto = require('crypto');

class PhonePeService {
  /**
   * Get API Base URL depending on environment mode
   */
  static getBaseUrl(mode = 'sandbox') {
    return mode === 'production'
      ? 'https://api.phonepe.com/apis/hermes'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
  }

  /**
   * Calculate PhonePe X-VERIFY checksum header
   * Format: SHA256(data + saltKey) + "###" + saltIndex
   */
  static calculateXVerify(data, saltKey, saltIndex = 1) {
    if (!saltKey) throw new Error('PhonePe Salt Key is required.');
    const hash = crypto.createHash('sha256').update(data + saltKey).digest('hex');
    return `${hash}###${saltIndex}`;
  }

  /**
   * Verify PhonePe Callback / Webhook X-VERIFY header
   */
  static verifyCallback(responseBase64, saltKey, saltIndex, receivedXVerify) {
    if (!saltKey || !receivedXVerify) return false;
    try {
      const expected = this.calculateXVerify(responseBase64, saltKey, saltIndex);
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'utf-8'),
        Buffer.from(receivedXVerify, 'utf-8')
      );
    } catch (err) {
      console.error('[PhonePeService.verifyCallback Error]:', err.message);
      return false;
    }
  }

  /**
   * Initiate PhonePe Payment
   */
  static async initiatePayment({
    merchantId,
    saltKey,
    saltIndex = 1,
    transactionId,
    amountInRupees,
    customerPhone,
    customerName,
    redirectUrl,
    callbackUrl,
    mode = 'sandbox'
  }) {
    if (!merchantId || !saltKey) {
      throw new Error('PhonePe Merchant ID and Salt Key are required.');
    }

    const amountInPaise = Math.round(parseFloat(amountInRupees) * 100);
    if (isNaN(amountInPaise) || amountInPaise <= 0) {
      throw new Error('Invalid order amount for PhonePe checkout.');
    }

    const cleanPhone = (customerPhone || '9999999999').replace(/\D/g, '').slice(-10);
    const cleanTxnId = String(transactionId).slice(0, 35);
    const baseUrl = this.getBaseUrl(mode);

    const payload = {
      merchantId: merchantId.trim(),
      merchantTransactionId: cleanTxnId,
      merchantUserId: `MUID-${cleanPhone || Date.now()}`,
      amount: amountInPaise,
      redirectUrl: redirectUrl,
      redirectMode: 'POST',
      callbackUrl: callbackUrl,
      mobileNumber: cleanPhone,
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const endpoint = '/pg/v1/pay';
    const xVerify = this.calculateXVerify(base64Payload + endpoint, saltKey, saltIndex);

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': xVerify
        },
        body: JSON.stringify({ request: base64Payload })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorMsg = data.message || `PhonePe error: ${data.code || 'Initiation failed'}`;
        throw new Error(errorMsg);
      }

      const redirectInfo = data.data?.instrumentResponse?.redirectInfo;
      const paymentUrl = redirectInfo?.url;

      if (!paymentUrl) {
        throw new Error('PhonePe did not return a valid payment redirection URL.');
      }

      return {
        gateway: 'phonepe',
        merchantId: merchantId.trim(),
        transactionId: cleanTxnId,
        amount: parseFloat(amountInRupees).toFixed(2),
        paymentUrl,
        isSandbox: mode !== 'production'
      };
    } catch (err) {
      console.error('[PhonePeService.initiatePayment Error]:', err.message);
      throw err;
    }
  }

  /**
   * Check Transaction Status server-side
   */
  static async checkStatus({ merchantId, saltKey, saltIndex = 1, transactionId, mode = 'sandbox' }) {
    if (!merchantId || !saltKey || !transactionId) {
      throw new Error('PhonePe Merchant ID, Salt Key, and Transaction ID are required.');
    }

    const baseUrl = this.getBaseUrl(mode);
    const endpoint = `/pg/v1/status/${encodeURIComponent(merchantId.trim())}/${encodeURIComponent(transactionId.trim())}`;
    const xVerify = this.calculateXVerify(endpoint, saltKey, saltIndex);

    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-VERIFY': xVerify,
          'X-MERCHANT-ID': merchantId.trim()
        }
      });

      const data = await response.json();
      const isSuccess = data.success && data.code === 'PAYMENT_SUCCESS';

      return {
        verified: isSuccess,
        code: data.code,
        message: data.message,
        transactionId: data.data?.merchantTransactionId,
        providerReferenceId: data.data?.transactionId,
        amount: data.data?.amount ? (data.data.amount / 100).toFixed(2) : '0.00',
        paymentState: data.data?.state,
        responseCode: data.data?.responseCode,
        paymentInstrument: data.data?.paymentInstrument,
        raw: data
      };
    } catch (err) {
      console.error('[PhonePeService.checkStatus Error]:', err.message);
      throw err;
    }
  }

  /**
   * Initiate PhonePe Refund
   */
  static async initiateRefund({
    merchantId,
    saltKey,
    saltIndex = 1,
    originalTransactionId,
    refundTransactionId,
    amountInRupees,
    mode = 'sandbox'
  }) {
    if (!merchantId || !saltKey || !originalTransactionId) {
      throw new Error('Merchant ID, Salt Key, and Original Transaction ID are required.');
    }

    const baseUrl = this.getBaseUrl(mode);
    const endpoint = '/pg/v1/refund';
    const amountInPaise = Math.round(parseFloat(amountInRupees) * 100);

    const payload = {
      merchantId: merchantId.trim(),
      merchantTransactionId: String(refundTransactionId || `REF-${Date.now()}`).slice(0, 35),
      originalTransactionId: String(originalTransactionId).slice(0, 35),
      amount: amountInPaise,
      callbackUrl: `https://api.arisopos.in/api/store/payment/callback/phonepe/refund`
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const xVerify = this.calculateXVerify(base64Payload + endpoint, saltKey, saltIndex);

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify
      },
      body: JSON.stringify({ request: base64Payload })
    });

    const data = await response.json();
    return data;
  }
}

module.exports = PhonePeService;
