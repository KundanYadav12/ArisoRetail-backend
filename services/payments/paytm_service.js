/**
 * Paytm Payment Gateway Integration Service
 * 
 * Supports:
 * - Paytm Initiate Transaction API (Token & Show Payment Page)
 * - Cryptographic HMAC SHA256 Checksum generation & verification
 * - Server-side transaction status verification (/v3/order/status)
 * - Refund initiation (/refund/apply)
 * - Isolated per-merchant MID & Merchant Key credentials
 */

const crypto = require('crypto');

class PaytmService {
  /**
   * Get API Base URL depending on environment mode
   */
  static getBaseUrl(mode = 'sandbox') {
    return mode === 'production'
      ? 'https://securegw.paytm.in'
      : 'https://securegw-stage.paytm.in';
  }

  /**
   * Calculate Paytm Checksum using HMAC-SHA256 on sorted key-value pairs
   */
  static generateChecksum(params, merchantKey) {
    if (!merchantKey) throw new Error('Paytm Merchant Key is required for signature generation.');
    const sortedKeys = Object.keys(params)
      .filter(k => k !== 'CHECKSUMHASH' && k !== 'checksum' && params[k] !== undefined && params[k] !== null && String(params[k]).trim() !== '')
      .sort();
    const dataString = sortedKeys.map(k => String(params[k]).trim()).join('|');
    return crypto.createHmac('sha256', merchantKey).update(dataString).digest('hex');
  }

  /**
   * Verify Paytm Checksum securely
   */
  static verifyChecksum(params, merchantKey, receivedChecksum) {
    if (!merchantKey || !receivedChecksum) return false;
    try {
      const calculatedChecksum = this.generateChecksum(params, merchantKey);
      if (calculatedChecksum.length !== receivedChecksum.length) return false;
      return crypto.timingSafeEqual(
        Buffer.from(calculatedChecksum, 'utf-8'),
        Buffer.from(receivedChecksum, 'utf-8')
      );
    } catch (err) {
      console.error('[PaytmService.verifyChecksum Error]:', err.message);
      return false;
    }
  }

  /**
   * Initiate Paytm Transaction
   */
  static async initiateTransaction({
    mid,
    merchantKey,
    orderId,
    amountInRupees,
    customerId,
    callbackUrl,
    mode = 'sandbox',
    website = 'DEFAULT'
  }) {
    if (!mid || !merchantKey) {
      throw new Error('Paytm Merchant ID and Merchant Key are required.');
    }

    const amountFormatted = parseFloat(amountInRupees).toFixed(2);
    if (isNaN(amountFormatted) || parseFloat(amountFormatted) <= 0) {
      throw new Error('Invalid order amount for Paytm checkout.');
    }

    const baseUrl = this.getBaseUrl(mode);
    const cleanOrderId = String(orderId).slice(0, 50);

    const body = {
      requestType: 'Payment',
      mid: mid.trim(),
      websiteName: mode === 'production' ? (website || 'DEFAULT') : 'WEBSTAGING',
      orderId: cleanOrderId,
      callbackUrl: callbackUrl,
      txnAmount: {
        value: amountFormatted,
        currency: 'INR'
      },
      userInfo: {
        custId: customerId ? String(customerId).slice(0, 50) : `CUST-${Date.now()}`
      }
    };

    // Generate Signature for body payload
    const bodyString = JSON.stringify(body);
    const signature = crypto.createHmac('sha256', merchantKey).update(bodyString).digest('base64');

    const payload = {
      head: {
        signature: signature
      },
      body: body
    };

    try {
      const response = await fetch(`${baseUrl}/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(mid)}&orderId=${encodeURIComponent(cleanOrderId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      const resBody = data.body || {};
      const resInfo = resBody.resultInfo || {};

      if (resInfo.resultStatus !== 'S') {
        throw new Error(resInfo.resultMsg || 'Paytm transaction initialization failed.');
      }

      const txnToken = resBody.txnToken;
      if (!txnToken) {
        throw new Error('Paytm did not return a valid transaction token.');
      }

      return {
        gateway: 'paytm',
        mid: mid.trim(),
        orderId: cleanOrderId,
        txnToken: txnToken,
        amount: amountFormatted,
        callbackUrl,
        isSandbox: mode !== 'production',
        paymentUrl: `${baseUrl}/theia/api/v1/showPaymentPage?mid=${encodeURIComponent(mid)}&orderId=${encodeURIComponent(cleanOrderId)}&txnToken=${encodeURIComponent(txnToken)}`
      };
    } catch (err) {
      console.error('[PaytmService.initiateTransaction Error]:', err.message);
      throw err;
    }
  }

  /**
   * Verify Paytm Transaction Status server-side
   */
  static async checkTransactionStatus({ mid, merchantKey, orderId, mode = 'sandbox' }) {
    if (!mid || !merchantKey || !orderId) {
      throw new Error('Paytm MID, Merchant Key, and Order ID are required.');
    }

    const baseUrl = this.getBaseUrl(mode);
    const body = {
      mid: mid.trim(),
      orderId: String(orderId).trim()
    };

    const signature = crypto.createHmac('sha256', merchantKey).update(JSON.stringify(body)).digest('base64');

    const payload = {
      head: { signature },
      body
    };

    try {
      const response = await fetch(`${baseUrl}/v3/order/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      const resBody = data.body || {};

      const isSuccess = resBody.resultInfo?.resultStatus === 'TXN_SUCCESS';
      return {
        verified: isSuccess,
        status: resBody.resultInfo?.resultStatus,
        statusCode: resBody.resultInfo?.resultCode,
        statusMessage: resBody.resultInfo?.resultMsg,
        txnId: resBody.txnId,
        orderId: resBody.orderId,
        amount: resBody.txnAmount,
        bankTxnId: resBody.bankTxnId,
        paymentMode: resBody.paymentMode,
        raw: resBody
      };
    } catch (err) {
      console.error('[PaytmService.checkTransactionStatus Error]:', err.message);
      throw err;
    }
  }

  /**
   * Initiate Paytm Refund
   */
  static async initiateRefund({ mid, merchantKey, orderId, txnId, refundAmount, refId, mode = 'sandbox' }) {
    if (!mid || !merchantKey || !orderId || !txnId) {
      throw new Error('MID, Key, Order ID, and Transaction ID are required for Paytm refund.');
    }

    const baseUrl = this.getBaseUrl(mode);
    const body = {
      mid: mid.trim(),
      txnType: 'REFUND',
      orderId: String(orderId).trim(),
      txnId: String(txnId).trim(),
      refId: String(refId || `REF-${Date.now()}`),
      refundAmount: parseFloat(refundAmount).toFixed(2)
    };

    const signature = crypto.createHmac('sha256', merchantKey).update(JSON.stringify(body)).digest('base64');
    const payload = {
      head: { signature },
      body
    };

    const response = await fetch(`${baseUrl}/refund/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    return data.body || {};
  }
}

module.exports = PaytmService;
