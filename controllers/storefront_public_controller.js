const StorefrontRepository = require('../repositories/storefront_repository');
const PaymentService = require('../services/payment_service');
const { notify: rtNotify } = require('../services/realtime_service');
const EmailService = require('../services/email_service');

class StorefrontPublicController {
  /**
   * Helper to extract subdomain or custom domain from request params, query, or hostname
   */
  static extractSubdomain(req) {
    if (req.params.subdomain) {
      return req.params.subdomain.trim().toLowerCase();
    }
    if (req.query.subdomain) {
      return req.query.subdomain.trim().toLowerCase();
    }
    if (req.query.store) {
      return req.query.store.trim().toLowerCase();
    }

    const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const cleanHost = rawHost.split(',')[0].split(':')[0].trim().toLowerCase();

    // Check for *.arisopos.in or *.localhost
    if (cleanHost.endsWith('.arisopos.in')) {
      const sub = cleanHost.replace('.arisopos.in', '').trim();
      if (sub && sub !== 'www' && sub !== 'api') return sub;
    }
    if (cleanHost.endsWith('.localhost')) {
      const sub = cleanHost.replace('.localhost', '').trim();
      if (sub && sub !== 'www' && sub !== 'api') return sub;
    }

    // Custom domain support (e.g. parkashstore.com, www.parkashstore.com, nimal.in, sham.store)
    const reservedRoots = ['localhost', '127.0.0.1', 'arisopos.in', 'arisotechnologies.com'];
    if (!reservedRoots.includes(cleanHost) && cleanHost.includes('.')) {
      return cleanHost;
    }

    return null;
  }

  /**
   * GET /api/store/resolve/:subdomain
   * Public store profile
   */
  static async resolveStore(req, res) {
    try {
      const subdomain = req.params.subdomain || StorefrontPublicController.extractSubdomain(req);
      if (!subdomain) {
        return res.status(400).json({ error: 'Store identifier / subdomain is required.' });
      }

      const store = await StorefrontRepository.resolveStore(subdomain);
      if (!store) {
        return res.status(404).json({
          error: 'STORE_NOT_FOUND',
          message: `No active storefront found for "${subdomain}".`
        });
      }

      if (!store.online_store_enabled) {
        return res.status(403).json({
          error: 'STORE_OFFLINE',
          message: `The online store for "${store.name}" is currently disabled or offline.`
        });
      }

      return res.json({ store });
    } catch (err) {
      console.error('[StorefrontPublicController.resolveStore Error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to resolve store.' });
    }
  }

  /**
   * GET /api/store/:subdomain/catalog
   * Public categories & products
   */
  static async getCatalog(req, res) {
    try {
      const subdomain = req.params.subdomain || StorefrontPublicController.extractSubdomain(req);
      const store = await StorefrontRepository.resolveStore(subdomain);
      if (!store || !store.online_store_enabled) {
        return res.status(404).json({ error: 'Store not found or offline.' });
      }

      const { category_id, search, featured } = req.query;
      const catalog = await StorefrontRepository.getStoreCatalog(store.id, {
        categoryId: category_id,
        search,
        featuredOnly: featured === 'true' || featured === '1'
      });

      return res.json({
        store: {
          id: store.id,
          name: store.name,
          logo_url: store.logo_url,
          store_banner_url: store.store_banner_url,
          store_theme_color: store.store_theme_color,
          store_tagline: store.store_tagline,
          delivery_enabled: store.delivery_enabled,
          pickup_enabled: store.pickup_enabled,
          min_order_value: store.min_order_value,
          delivery_charge: store.delivery_charge,
          free_delivery_threshold: store.free_delivery_threshold,
          estimated_delivery_time: store.estimated_delivery_time,
          payment_methods: store.payment_methods
        },
        categories: catalog.categories,
        products: catalog.products
      });
    } catch (err) {
      console.error('[StorefrontPublicController.getCatalog Error]:', err);
      return res.status(500).json({ error: err.message || 'Failed to load catalog.' });
    }
  }

  /**
   * GET /api/store/:subdomain/product/:id
   */
  static async getProduct(req, res) {
    try {
      const subdomain = req.params.subdomain || StorefrontPublicController.extractSubdomain(req);
      const store = await StorefrontRepository.resolveStore(subdomain);
      if (!store || !store.online_store_enabled) {
        return res.status(404).json({ error: 'Store not found.' });
      }

      const productId = req.params.id;
      const product = await StorefrontRepository.getProductDetails(store.id, productId);
      if (!product) {
        return res.status(404).json({ error: 'Product not found or not available online.' });
      }

      return res.json({ product });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to load product.' });
    }
  }

  /**
   * POST /api/store/:subdomain/cart/validate
   * Server-side authoritative line item & price recalculation
   */
  static async validateCart(req, res) {
    try {
      const subdomain = req.params.subdomain || StorefrontPublicController.extractSubdomain(req);
      const store = await StorefrontRepository.resolveStore(subdomain);
      if (!store || !store.online_store_enabled) {
        return res.status(404).json({ error: 'Store not found or offline.' });
      }

      const { items, delivery_preference } = req.body;
      const validated = await StorefrontRepository.validateCart(store.id, items, delivery_preference);

      return res.json({
        valid: true,
        summary: validated
      });
    } catch (err) {
      return res.status(400).json({
        valid: false,
        error: err.message || 'Cart validation failed.'
      });
    }
  }

  /**
   * POST /api/store/:subdomain/checkout
   * Place an online order (COD or Razorpay Initiation)
   */
  static async checkout(req, res) {
    try {
      const subdomain = req.params.subdomain || StorefrontPublicController.extractSubdomain(req);
      const store = await StorefrontRepository.resolveStore(subdomain);
      if (!store || !store.online_store_enabled) {
        return res.status(404).json({ error: 'Store not found or offline.' });
      }

      const {
        customer_name,
        customer_phone,
        customer_email,
        delivery_address,
        delivery_city,
        delivery_state,
        delivery_pincode,
        delivery_instructions,
        delivery_preference = 'delivery',
        payment_mode = 'cod',
        items
      } = req.body;

      // Validation
      if (!customer_name || !customer_name.trim()) {
        return res.status(400).json({ error: 'Customer name is required.' });
      }
      if (!customer_phone || !customer_phone.trim()) {
        return res.status(400).json({ error: 'Mobile number is required.' });
      }
      const cleanPhone = customer_phone.replace(/\D/g, '');
      if (cleanPhone.length < 10) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
      }

      if (delivery_preference === 'delivery') {
        if (!delivery_address || !delivery_address.trim()) {
          return res.status(400).json({ error: 'Complete delivery address is required for delivery orders.' });
        }
        if (!delivery_pincode || !delivery_pincode.trim()) {
          return res.status(400).json({ error: 'PIN / Postal code is required.' });
        }
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Cart must contain at least one product.' });
      }

      // Check payment mode availability
      const paymentSettings = await StorefrontRepository.getMerchantPaymentSettings(store.id, true);

      if (payment_mode === 'razorpay') {
        if (!paymentSettings.razorpay_enabled || !paymentSettings.razorpay_key_id || !paymentSettings.razorpay_key_secret) {
          return res.status(400).json({ error: 'Online Razorpay payment is not currently enabled for this merchant.' });
        }
      } else if (payment_mode === 'paytm') {
        if (!paymentSettings.paytm_enabled || !paymentSettings.paytm_mid || !paymentSettings.paytm_merchant_key) {
          return res.status(400).json({ error: 'Paytm payment is not currently configured for this merchant.' });
        }
      } else if (payment_mode === 'phonepe') {
        if (!paymentSettings.phonepe_enabled || !paymentSettings.phonepe_merchant_id || !paymentSettings.phonepe_salt_key) {
          return res.status(400).json({ error: 'PhonePe payment is not currently configured for this merchant.' });
        }
      } else if (payment_mode === 'cod') {
        if (!paymentSettings.cod_enabled) {
          return res.status(400).json({ error: 'Cash on Delivery is not enabled for this store.' });
        }
      } else {
        return res.status(400).json({ error: 'Unsupported payment mode selected.' });
      }

      // 1. Authoritative Cart Validation
      const validated = await StorefrontRepository.validateCart(store.id, items, delivery_preference);
      if (!validated.meets_min_order) {
        return res.status(400).json({
          error: `Minimum order amount is ₹${validated.min_order_value.toFixed(2)}. Current subtotal: ₹${validated.subtotal.toFixed(2)}.`
        });
      }

      let razorpayOrderData = null;
      let paytmOrderData = null;
      let phonepeOrderData = null;
      let gatewayOrderId = null;

      // Determine client base URL for redirect / callback
      const reqHost = req.headers['x-forwarded-host'] || req.headers.host || '';
      const clientProtocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
      const clientBaseUrl = `${clientProtocol}://${reqHost}`;

      // A. Razorpay initiation
      if (payment_mode === 'razorpay') {
        try {
          razorpayOrderData = await PaymentService.createRazorpayOrder({
            keyId: paymentSettings.razorpay_key_id,
            keySecret: paymentSettings.razorpay_key_secret,
            amountInRupees: validated.total_amount,
            currency: 'INR',
            receipt: `ORD-${Date.now()}`,
            notes: {
              merchant_id: String(store.id),
              customer_name,
              customer_phone
            }
          });
          gatewayOrderId = razorpayOrderData.id;
        } catch (rzErr) {
          return res.status(502).json({
            error: 'PAYMENT_GATEWAY_ERROR',
            message: `Failed to initialize online payment with Razorpay: ${rzErr.message}`
          });
        }
      }

      // B. Paytm initiation
      if (payment_mode === 'paytm') {
        try {
          const tempOrderRef = `PTM-${store.id}-${Date.now()}`.slice(0, 45);
          const callbackUrl = `${clientBaseUrl}/api/store/payment/callback/paytm`;

          paytmOrderData = await PaymentService.createPaytmTransaction({
            mid: paymentSettings.paytm_mid,
            merchantKey: paymentSettings.paytm_merchant_key,
            orderId: tempOrderRef,
            amountInRupees: validated.total_amount,
            customerId: cleanPhone || `CUST-${Date.now()}`,
            callbackUrl,
            mode: paymentSettings.paytm_mode,
            website: paymentSettings.paytm_website
          });
          gatewayOrderId = paytmOrderData.orderId;
        } catch (ptErr) {
          return res.status(502).json({
            error: 'PAYMENT_GATEWAY_ERROR',
            message: `Failed to initialize Paytm payment: ${ptErr.message}`
          });
        }
      }

      // C. PhonePe initiation
      if (payment_mode === 'phonepe') {
        try {
          const tempTxnRef = `PPE-${store.id}-${Date.now()}`.slice(0, 35);
          const callbackUrl = `${clientBaseUrl}/api/store/payment/callback/phonepe`;
          const redirectUrl = `${clientBaseUrl}/api/store/payment/callback/phonepe`;

          phonepeOrderData = await PaymentService.createPhonePePayment({
            merchantId: paymentSettings.phonepe_merchant_id,
            saltKey: paymentSettings.phonepe_salt_key,
            saltIndex: paymentSettings.phonepe_salt_index,
            transactionId: tempTxnRef,
            amountInRupees: validated.total_amount,
            customerPhone: cleanPhone,
            customerName: customer_name,
            redirectUrl,
            callbackUrl,
            mode: paymentSettings.phonepe_mode
          });
          gatewayOrderId = phonepeOrderData.transactionId;
        } catch (ppErr) {
          return res.status(502).json({
            error: 'PAYMENT_GATEWAY_ERROR',
            message: `Failed to initialize PhonePe payment: ${ppErr.message}`
          });
        }
      }

      // 2. Create the Order in Database
      const order = await StorefrontRepository.createOnlineOrder(store.id, {
        customerName: customer_name.trim(),
        customerPhone: cleanPhone,
        customerEmail: customer_email ? customer_email.trim() : null,
        deliveryAddress: delivery_address ? delivery_address.trim() : 'Pickup from store',
        deliveryCity: delivery_city || null,
        deliveryState: delivery_state || null,
        deliveryPincode: delivery_pincode || null,
        deliveryInstructions: delivery_instructions || null,
        deliveryPreference: delivery_preference,
        paymentMode: payment_mode,
        paymentGateway: payment_mode === 'cod' ? 'cod' : payment_mode,
        items,
        gatewayOrderId: gatewayOrderId,
        initialPaymentStatus: 'pending'
      });

      // 3. Real-time alert to merchant dashboard via SSE
      try {
        rtNotify.orderUpdated(store.id, {
          action: 'online_order_placed',
          orderId: order.order_id,
          orderNumber: order.order_number,
          totalAmount: order.total_amount,
          customerName: customer_name.trim()
        });
      } catch (rtErr) {
        console.warn('[SSE Alert Notice]:', rtErr.message);
      }

      // 4. Send customer email confirmation if email provided
      if (customer_email && EmailService && typeof EmailService.sendCustomEmail === 'function') {
        try {
          const trackUrl = `${clientBaseUrl}/#/order-status/${order.order_number}?token=${order.order_access_token}`;
          EmailService.sendCustomEmail({
            to: customer_email,
            subject: `Order Placed Successfully: #${order.order_number} - ${store.name}`,
            html: `
              <h2>Thank you for your order!</h2>
              <p>Your order <strong>#${order.order_number}</strong> has been received by <strong>${store.name}</strong>.</p>
              <p>Total Amount: <strong>₹${order.total_amount.toFixed(2)}</strong></p>
              <p>Payment Method: <strong>${payment_mode.toUpperCase()}</strong></p>
              <p>Delivery Preference: <strong>${delivery_preference.toUpperCase()}</strong></p>
              <p>Track your order status: <a href="${trackUrl}">Click Here to Track</a></p>
            `
          }).catch(e => console.warn('[Email Confirmation Warning]:', e.message));
        } catch (_) {}
      }

      return res.status(201).json({
        message: 'Order placed successfully.',
        order: {
          id: order.order_id,
          order_number: order.order_number,
          order_access_token: order.order_access_token,
          total_amount: order.total_amount,
          payment_mode,
          payment_status: order.payment_status,
          status: order.online_order_status
        },
        razorpay: razorpayOrderData ? {
          order_id: razorpayOrderData.id,
          amount: razorpayOrderData.amount,
          currency: razorpayOrderData.currency,
          key_id: paymentSettings.razorpay_key_id
        } : null,
        paytm: paytmOrderData ? {
          order_id: paytmOrderData.orderId,
          mid: paytmOrderData.mid,
          txn_token: paytmOrderData.txnToken,
          amount: paytmOrderData.amount,
          payment_url: paytmOrderData.paymentUrl
        } : null,
        phonepe: phonepeOrderData ? {
          transaction_id: phonepeOrderData.transactionId,
          merchant_id: phonepeOrderData.merchantId,
          amount: phonepeOrderData.amount,
          payment_url: phonepeOrderData.paymentUrl
        } : null
      });

    } catch (err) {
      console.error('[StorefrontPublicController.checkout Error]:', err);
      return res.status(500).json({ error: err.message || 'Checkout failed.' });
    }
  }

  /**
   * POST /api/store/:subdomain/verify-payment
   * Server-side cryptographic payment verification (Razorpay, Paytm, PhonePe)
   */
  static async verifyPayment(req, res) {
    try {
      const subdomain = req.params.subdomain || StorefrontPublicController.extractSubdomain(req);
      const store = await StorefrontRepository.resolveStore(subdomain);
      if (!store) {
        return res.status(404).json({ error: 'Store not found.' });
      }

      const {
        gateway = 'razorpay',
        order_id,
        order_number,
        // Razorpay
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        // Paytm
        paytm_order_id,
        // PhonePe
        phonepe_transaction_id
      } = req.body;

      const paymentSettings = await StorefrontRepository.getMerchantPaymentSettings(store.id, true);
      const pool = require('../config/db');

      // 1. Razorpay verification
      if (gateway === 'razorpay') {
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
          return res.status(400).json({ error: 'Missing Razorpay signature verification parameters.' });
        }

        if (!paymentSettings.razorpay_key_secret) {
          return res.status(500).json({ error: 'Merchant Razorpay secret missing.' });
        }

        const verification = PaymentService.verifyRazorpaySignature({
          keySecret: paymentSettings.razorpay_key_secret,
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature
        });

        if (!verification.verified) {
          await StorefrontRepository.logPaymentEvent(store.id, {
            orderId: order_id || null,
            eventType: 'payment_verification_failed',
            gateway: 'razorpay',
            gatewayPaymentId: razorpay_payment_id,
            gatewayOrderId: razorpay_order_id,
            status: 'failed',
            errorMessage: verification.error
          });

          return res.status(400).json({
            verified: false,
            error: verification.error || 'Payment verification failed. Invalid cryptographic signature.'
          });
        }

        // Update database
        await pool.execute(`
          UPDATE orders 
          SET 
            payment_status = 'paid',
            online_order_status = 'confirmed',
            paid_amount = total_amount,
            gateway_payment_id = ?,
            gateway_signature = ?,
            payment_gateway = 'razorpay',
            updated_at = NOW()
          WHERE restaurant_id = ? AND (id = ? OR unique_order_number = ?)
        `, [razorpay_payment_id, razorpay_signature, store.id, order_id || -1, order_number || '']);

        await StorefrontRepository.logPaymentEvent(store.id, {
          orderId: order_id || null,
          eventType: 'payment_verified',
          gateway: 'razorpay',
          gatewayPaymentId: razorpay_payment_id,
          gatewayOrderId: razorpay_order_id,
          status: 'success'
        });

        try {
          rtNotify.orderUpdated(store.id, {
            action: 'payment_verified',
            orderId: order_id,
            orderNumber: order_number,
            paymentStatus: 'paid'
          });
        } catch (_) {}

        return res.json({
          verified: true,
          message: 'Razorpay payment verified and captured successfully.',
          payment_id: razorpay_payment_id
        });
      }

      // 2. Paytm verification
      if (gateway === 'paytm') {
        const ptmOrderId = paytm_order_id || order_number;
        if (!ptmOrderId) {
          return res.status(400).json({ error: 'Paytm Order ID is required.' });
        }

        const statusRes = await PaymentService.checkPaytmStatus({
          mid: paymentSettings.paytm_mid,
          merchantKey: paymentSettings.paytm_merchant_key,
          orderId: ptmOrderId,
          mode: paymentSettings.paytm_mode
        });

        if (!statusRes.verified) {
          return res.status(400).json({
            verified: false,
            error: statusRes.statusMessage || 'Paytm payment status is not successful.'
          });
        }

        await pool.execute(`
          UPDATE orders 
          SET 
            payment_status = 'paid',
            online_order_status = 'confirmed',
            paid_amount = total_amount,
            gateway_payment_id = ?,
            payment_gateway = 'paytm',
            updated_at = NOW()
          WHERE restaurant_id = ? AND (id = ? OR unique_order_number = ? OR gateway_order_id = ?)
        `, [statusRes.txnId, store.id, order_id || -1, order_number || '', ptmOrderId]);

        await StorefrontRepository.logPaymentEvent(store.id, {
          orderId: order_id || null,
          eventType: 'payment_verified',
          gateway: 'paytm',
          gatewayPaymentId: statusRes.txnId,
          gatewayOrderId: ptmOrderId,
          status: 'success'
        });

        try {
          rtNotify.orderUpdated(store.id, {
            action: 'payment_verified',
            orderId: order_id,
            orderNumber: order_number,
            paymentStatus: 'paid'
          });
        } catch (_) {}

        return res.json({
          verified: true,
          message: 'Paytm payment verified successfully.',
          payment_id: statusRes.txnId
        });
      }

      // 3. PhonePe verification
      if (gateway === 'phonepe') {
        const ppTxnId = phonepe_transaction_id || order_number;
        if (!ppTxnId) {
          return res.status(400).json({ error: 'PhonePe transaction ID is required.' });
        }

        const statusRes = await PaymentService.checkPhonePeStatus({
          merchantId: paymentSettings.phonepe_merchant_id,
          saltKey: paymentSettings.phonepe_salt_key,
          saltIndex: paymentSettings.phonepe_salt_index,
          transactionId: ppTxnId,
          mode: paymentSettings.phonepe_mode
        });

        if (!statusRes.verified) {
          return res.status(400).json({
            verified: false,
            error: statusRes.message || 'PhonePe payment status is not successful.'
          });
        }

        await pool.execute(`
          UPDATE orders 
          SET 
            payment_status = 'paid',
            online_order_status = 'confirmed',
            paid_amount = total_amount,
            gateway_payment_id = ?,
            payment_gateway = 'phonepe',
            updated_at = NOW()
          WHERE restaurant_id = ? AND (id = ? OR unique_order_number = ? OR gateway_order_id = ?)
        `, [statusRes.providerReferenceId || statusRes.transactionId, store.id, order_id || -1, order_number || '', ppTxnId]);

        await StorefrontRepository.logPaymentEvent(store.id, {
          orderId: order_id || null,
          eventType: 'payment_verified',
          gateway: 'phonepe',
          gatewayPaymentId: statusRes.providerReferenceId,
          gatewayOrderId: ppTxnId,
          status: 'success'
        });

        try {
          rtNotify.orderUpdated(store.id, {
            action: 'payment_verified',
            orderId: order_id,
            orderNumber: order_number,
            paymentStatus: 'paid'
          });
        } catch (_) {}

        return res.json({
          verified: true,
          message: 'PhonePe payment verified successfully.',
          payment_id: statusRes.providerReferenceId || statusRes.transactionId
        });
      }

      return res.status(400).json({ error: `Unsupported payment gateway "${gateway}".` });

    } catch (err) {
      console.error('[StorefrontPublicController.verifyPayment Error]:', err);
      return res.status(500).json({ error: err.message || 'Payment verification failed.' });
    }
  }

  /**
   * POST /api/store/payment/callback/paytm
   * Paytm Callback Handler
   */
  static async handlePaytmCallback(req, res) {
    try {
      const pool = require('../config/db');
      const orderId = req.body?.ORDERID || req.query?.ORDERID;
      const txnId = req.body?.TXNID || req.query?.TXNID;

      if (!orderId) {
        return res.status(400).send('Missing ORDERID in Paytm callback.');
      }

      // Find order in DB
      const [oRows] = await pool.execute(`
        SELECT id, restaurant_id, unique_order_number, order_access_token, total_amount, payment_status
        FROM orders 
        WHERE gateway_order_id = ? OR unique_order_number = ?
        LIMIT 1
      `, [orderId, orderId]);

      if (oRows.length === 0) {
        return res.status(404).send('Order not found.');
      }

      const order = oRows[0];
      const paymentSettings = await StorefrontRepository.getMerchantPaymentSettings(order.restaurant_id, true);

      // Verify status server-side
      const statusRes = await PaymentService.checkPaytmStatus({
        mid: paymentSettings.paytm_mid,
        merchantKey: paymentSettings.paytm_merchant_key,
        orderId,
        mode: paymentSettings.paytm_mode
      });

      const reqHost = req.headers['x-forwarded-host'] || req.headers.host || '';
      const clientProtocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
      const redirectBase = `${clientProtocol}://${reqHost}`;

      if (statusRes.verified) {
        await pool.execute(`
          UPDATE orders 
          SET 
            payment_status = 'paid',
            online_order_status = 'confirmed',
            paid_amount = total_amount,
            gateway_payment_id = ?,
            payment_gateway = 'paytm',
            updated_at = NOW()
          WHERE id = ?
        `, [statusRes.txnId || txnId, order.id]);

        await StorefrontRepository.logPaymentEvent(order.restaurant_id, {
          orderId: order.id,
          eventType: 'paytm_callback_success',
          gateway: 'paytm',
          gatewayPaymentId: statusRes.txnId || txnId,
          gatewayOrderId: orderId,
          status: 'success'
        });

        try {
          rtNotify.orderUpdated(order.restaurant_id, {
            action: 'payment_verified',
            orderId: order.id,
            orderNumber: order.unique_order_number,
            paymentStatus: 'paid'
          });
        } catch (_) {}

        return res.redirect(`${redirectBase}/#/order-status/${order.unique_order_number}?token=${order.order_access_token}&payment=success`);
      } else {
        await StorefrontRepository.logPaymentEvent(order.restaurant_id, {
          orderId: order.id,
          eventType: 'paytm_callback_failed',
          gateway: 'paytm',
          gatewayOrderId: orderId,
          status: 'failed',
          errorMessage: statusRes.statusMessage || 'Paytm payment failed or pending.'
        });

        return res.redirect(`${redirectBase}/#/order-status/${order.unique_order_number}?token=${order.order_access_token}&payment=failed`);
      }
    } catch (err) {
      console.error('[StorefrontPublicController.handlePaytmCallback Error]:', err);
      return res.status(500).send('Payment callback processing error');
    }
  }

  /**
   * POST & GET /api/store/payment/callback/phonepe
   * PhonePe Callback & Redirect Handler
   */
  static async handlePhonePeCallback(req, res) {
    try {
      const pool = require('../config/db');
      const txnId = req.body?.merchantTransactionId || req.query?.merchantTransactionId || req.body?.transactionId;

      if (!txnId) {
        return res.status(400).send('Missing transaction ID in PhonePe callback.');
      }

      // Find order in DB
      const [oRows] = await pool.execute(`
        SELECT id, restaurant_id, unique_order_number, order_access_token, total_amount, payment_status
        FROM orders 
        WHERE gateway_order_id = ? OR unique_order_number = ?
        LIMIT 1
      `, [txnId, txnId]);

      if (oRows.length === 0) {
        return res.status(404).send('Order not found.');
      }

      const order = oRows[0];
      const paymentSettings = await StorefrontRepository.getMerchantPaymentSettings(order.restaurant_id, true);

      // Verify status server-side
      const statusRes = await PaymentService.checkPhonePeStatus({
        merchantId: paymentSettings.phonepe_merchant_id,
        saltKey: paymentSettings.phonepe_salt_key,
        saltIndex: paymentSettings.phonepe_salt_index,
        transactionId: txnId,
        mode: paymentSettings.phonepe_mode
      });

      const reqHost = req.headers['x-forwarded-host'] || req.headers.host || '';
      const clientProtocol = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
      const redirectBase = `${clientProtocol}://${reqHost}`;

      if (statusRes.verified) {
        await pool.execute(`
          UPDATE orders 
          SET 
            payment_status = 'paid',
            online_order_status = 'confirmed',
            paid_amount = total_amount,
            gateway_payment_id = ?,
            payment_gateway = 'phonepe',
            updated_at = NOW()
          WHERE id = ?
        `, [statusRes.providerReferenceId || txnId, order.id]);

        await StorefrontRepository.logPaymentEvent(order.restaurant_id, {
          orderId: order.id,
          eventType: 'phonepe_callback_success',
          gateway: 'phonepe',
          gatewayPaymentId: statusRes.providerReferenceId,
          gatewayOrderId: txnId,
          status: 'success'
        });

        try {
          rtNotify.orderUpdated(order.restaurant_id, {
            action: 'payment_verified',
            orderId: order.id,
            orderNumber: order.unique_order_number,
            paymentStatus: 'paid'
          });
        } catch (_) {}

        return res.redirect(`${redirectBase}/#/order-status/${order.unique_order_number}?token=${order.order_access_token}&payment=success`);
      } else {
        await StorefrontRepository.logPaymentEvent(order.restaurant_id, {
          orderId: order.id,
          eventType: 'phonepe_callback_failed',
          gateway: 'phonepe',
          gatewayOrderId: txnId,
          status: 'failed',
          errorMessage: statusRes.message || 'PhonePe payment failed or pending.'
        });

        return res.redirect(`${redirectBase}/#/order-status/${order.unique_order_number}?token=${order.order_access_token}&payment=failed`);
      }
    } catch (err) {
      console.error('[StorefrontPublicController.handlePhonePeCallback Error]:', err);
      return res.status(500).send('Payment callback processing error');
    }
  }

  /**
   * GET /api/store/:subdomain/order-status/:orderNumber
   * Customer public order tracking
   */
  static async getOrderStatus(req, res) {
    try {
      const subdomain = req.params.subdomain || StorefrontPublicController.extractSubdomain(req);
      const { orderNumber } = req.params;
      const { token, phone } = req.query;

      const result = await StorefrontRepository.getCustomerOrderStatus(subdomain, orderNumber, { token, phone });

      if (!result) {
        return res.status(404).json({ error: 'Order not found or access unauthorized.' });
      }
      if (result.error) {
        return res.status(401).json({ error: result.error });
      }

      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to fetch order status.' });
    }
  }

  /**
   * POST /api/store/payment/webhook/:restaurant_id
   * Razorpay Webhook receiver
   */
  static async handleWebhook(req, res) {
    try {
      const restaurantId = parseInt(req.params.restaurant_id, 10);
      if (isNaN(restaurantId)) {
        return res.status(400).send('Invalid merchant ID');
      }

      const signature = req.headers['x-razorpay-signature'];
      const paymentSettings = await StorefrontRepository.getMerchantPaymentSettings(restaurantId, true);

      if (paymentSettings.razorpay_webhook_secret && signature) {
        const isValid = PaymentService.verifyWebhookSignature({
          webhookSecret: paymentSettings.razorpay_webhook_secret,
          rawBody: req.body,
          webhookSignature: signature
        });

        if (!isValid) {
          console.warn(`[Webhook Warning]: Invalid webhook signature for restaurant ID #${restaurantId}`);
          return res.status(400).send('Invalid webhook signature');
        }
      }

      const event = req.body?.event;
      const payload = req.body?.payload;

      await StorefrontRepository.logPaymentEvent(restaurantId, {
        eventType: event || 'unknown_webhook',
        gateway: 'razorpay',
        gatewayPaymentId: payload?.payment?.entity?.id || null,
        gatewayOrderId: payload?.order?.entity?.id || null,
        status: 'webhook_received',
        amount: payload?.payment?.entity?.amount ? payload.payment.entity.amount / 100 : 0,
        payload: req.body
      });

      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('[StorefrontPublicController.handleWebhook Error]:', err);
      return res.status(500).send('Webhook handler error');
    }
  }
}

module.exports = StorefrontPublicController;
