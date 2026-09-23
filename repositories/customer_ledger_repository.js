const pool = require('../config/db');

class CustomerLedgerRepository {
  /**
   * Record a ledger entry and update customer current_balance atomically
   */
  static async recordEntry(restaurantId, entryData, existingConnection = null) {
    const connection = existingConnection || await pool.getConnection();
    const shouldManageTx = !existingConnection;

    try {
      if (shouldManageTx) await connection.beginTransaction();

      const {
        customerId,
        type, // 'INVOICE', 'PAYMENT', 'RETURN', 'OPENING_BALANCE'
        amount,
        referenceType,
        referenceId,
        referenceNumber,
        paymentMode,
        userId,
        userName,
        notes
      } = entryData;

      if (!customerId) throw new Error('Customer ID is required for ledger entry.');
      const parsedAmount = Math.abs(parseFloat(amount) || 0);

      // 1. Lock customer row to get current balance
      const [custRows] = await connection.execute(
        'SELECT id, name, current_balance FROM customers WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [customerId, restaurantId]
      );

      if (custRows.length === 0) {
        throw new Error(`Customer #${customerId} not found.`);
      }

      const prevBalance = parseFloat(custRows[0].current_balance || 0);
      let balanceChange = 0;

      // Positive balance represents amount owed by customer to the store
      if (type === 'INVOICE' || type === 'OPENING_BALANCE') {
        balanceChange = parsedAmount;
      } else if (type === 'PAYMENT' || type === 'RETURN') {
        balanceChange = -parsedAmount;
      }

      const newBalance = parseFloat((prevBalance + balanceChange).toFixed(2));

      // 2. Update customer balance
      await connection.execute(
        'UPDATE customers SET current_balance = ?, updated_at = NOW() WHERE id = ?',
        [newBalance, customerId]
      );

      // 3. Insert immutable ledger entry
      const [insertResult] = await connection.execute(
        `INSERT INTO customer_ledger (
          restaurant_id, customer_id, transaction_type, amount, balance_after,
          reference_type, reference_id, reference_number, payment_mode,
          user_id, user_name, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          restaurantId,
          customerId,
          type,
          parsedAmount,
          newBalance,
          referenceType || null,
          referenceId || null,
          referenceNumber || null,
          paymentMode || null,
          (!isNaN(parseInt(userId)) ? parseInt(userId) : null),
          userName || (typeof userId === 'string' && isNaN(parseInt(userId)) ? userId : 'System'),
          notes || null
        ]
      );

      if (type === 'PAYMENT' && referenceType !== 'order' && referenceType !== 'invoice') {
        try {
          const FinancialAccountService = require('../services/financial_account_service');
          await FinancialAccountService.recordCustomerPaymentReceipt(connection, {
            restaurantId,
            customerId,
            customerName: custRows[0]?.name || null,
            amount: parsedAmount,
            paymentMode,
            referenceNumber,
            notes,
            userId,
            userName
          });
        } catch (finErr) {
          console.warn('[Financial Account Customer Payment Notice]:', finErr.message);
        }
      }

      if (shouldManageTx) await connection.commit();

      return {
        id: insertResult.insertId,
        customerId,
        prevBalance,
        newBalance,
        amount: parsedAmount,
        type
      };
    } catch (err) {
      if (shouldManageTx) await connection.rollback();
      throw err;
    } finally {
      if (shouldManageTx) connection.release();
    }
  }

  /**
   * Get ledger history for a Party/Customer
   */
  static async getLedger(customerId, restaurantId, limit = 50, offset = 0) {
    const [rows] = await pool.execute(
      `SELECT * FROM customer_ledger 
       WHERE customer_id = ? AND restaurant_id = ? 
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [customerId, restaurantId, parseInt(limit), parseInt(offset)]
    );

    const [summaryRows] = await pool.execute(
      `SELECT 
         COALESCE(SUM(CASE WHEN transaction_type = 'INVOICE' THEN amount ELSE 0 END), 0) AS total_invoiced,
         COALESCE(SUM(CASE WHEN transaction_type = 'PAYMENT' THEN amount ELSE 0 END), 0) AS total_paid,
         COALESCE(SUM(CASE WHEN transaction_type = 'RETURN' THEN amount ELSE 0 END), 0) AS total_returned
       FROM customer_ledger
       WHERE customer_id = ? AND restaurant_id = ?`,
      [customerId, restaurantId]
    );

    const [custRows] = await pool.execute(
      'SELECT id, name, credit_limit, current_balance FROM customers WHERE id = ? AND restaurant_id = ?',
      [customerId, restaurantId]
    );

    return {
      ledger: rows,
      summary: summaryRows[0] || {},
      customer: custRows[0] || null
    };
  }

  /**
   * Record a payment receipt from customer
   */
  static async recordPayment(restaurantId, customerIdOrData, amount, paymentMode = 'cash', referenceNumber = null, notes = null, userId = null, userName = 'Staff') {
    let customerId, parsedAmount, mode, refNo, payNotes, uId, uName;
    if (typeof customerIdOrData === 'object' && customerIdOrData !== null) {
      customerId = customerIdOrData.customerId || customerIdOrData.customer_id;
      parsedAmount = customerIdOrData.amount;
      mode = customerIdOrData.paymentMode || customerIdOrData.payment_mode || 'cash';
      refNo = customerIdOrData.referenceNumber || customerIdOrData.reference_number;
      payNotes = customerIdOrData.notes;
      uId = customerIdOrData.userId || customerIdOrData.user_id;
      uName = customerIdOrData.userName || customerIdOrData.user_name;
    } else {
      customerId = customerIdOrData;
      parsedAmount = amount;
      mode = paymentMode || 'cash';
      refNo = referenceNumber;
      payNotes = notes;
      uId = userId;
      uName = userName;
    }

    return await this.recordEntry(restaurantId, {
      customerId,
      type: 'PAYMENT',
      amount: parsedAmount,
      referenceType: 'payment_receipt',
      referenceNumber: refNo,
      paymentMode: mode,
      userId: uId,
      userName: uName,
      notes: payNotes || `Payment received via ${mode}`
    });
  }
}

module.exports = CustomerLedgerRepository;
