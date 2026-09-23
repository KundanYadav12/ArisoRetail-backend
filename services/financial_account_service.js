const pool = require('../config/db');
const FinancialAccountRepository = require('../repositories/financial_account_repository');
const { getISTDateString } = require('../utils/date_utils');

class FinancialAccountService {
  /**
   * Create financial account with atomic opening balance entry
   */
  static async createAccount(restaurantId, accountData, userId = null, userName = 'Admin') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const opBal = parseFloat(accountData.opening_balance || 0);
      const opDate = accountData.opening_balance_date || getISTDateString();

      const accountId = await FinancialAccountRepository.create(
        restaurantId,
        { ...accountData, opening_balance: opBal, opening_balance_date: opDate },
        connection
      );

      // If opening balance is non-zero, record initial transaction
      if (opBal !== 0) {
        await FinancialAccountRepository.recordTransaction({
          restaurant_id: restaurantId,
          account_id: accountId,
          transaction_type: 'OPENING_BALANCE',
          reference_type: 'manual',
          reference_id: String(accountId),
          reference_number: `OP-${accountId}`,
          payment_mode: accountData.account_type === 'cash' ? 'cash' : 'bank_transfer',
          amount_in: opBal > 0 ? opBal : 0,
          amount_out: opBal < 0 ? Math.abs(opBal) : 0,
          balance_after: opBal,
          description: `Opening balance on ${opDate}`,
          user_id: userId,
          user_name: userName,
          idempotency_key: `opbal_${restaurantId}_${accountId}`
        }, connection);
      }

      await connection.commit();
      return FinancialAccountRepository.findById(accountId, restaurantId);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Resolve mapped account for a given payment mode
   */
  static async resolveAccountForPaymentMode(restaurantId, paymentMode, connection = null) {
    if (!paymentMode) {
      return FinancialAccountRepository.getDefaultAccount(restaurantId, 'cash', connection);
    }

    const rawMode = (paymentMode || '').toLowerCase().trim();
    const cleanMode = rawMode.replace(/[\s-]+/g, '_');

    // 1. Check explicit mapping table (both clean and raw)
    let mapped = await FinancialAccountRepository.getMappingForMode(restaurantId, cleanMode, connection);
    if (!mapped && rawMode !== cleanMode) {
      mapped = await FinancialAccountRepository.getMappingForMode(restaurantId, rawMode, connection);
    }
    if (mapped) {
      return FinancialAccountRepository.findById(mapped.account_id, restaurantId, connection);
    }

    // 2. Default mapping heuristics based on payment mode type
    if (cleanMode === 'cash') {
      return FinancialAccountRepository.getDefaultAccount(restaurantId, 'cash', connection);
    } else if (['upi', 'gpay', 'phonepe', 'paytm', 'card', 'credit_card', 'debit_card', 'bank_transfer', 'net_banking', 'neft', 'rtgs', 'cheque'].includes(cleanMode)) {
      const curAcc = await FinancialAccountRepository.getDefaultAccount(restaurantId, 'current', connection);
      if (curAcc) return curAcc;
      const bankAcc = await FinancialAccountRepository.getDefaultAccount(restaurantId, 'bank', connection);
      if (bankAcc) return bankAcc;
    }

    // 3. Fallback to any active account
    return FinancialAccountRepository.getDefaultAccount(restaurantId, 'cash', connection);
  }

  /**
   * Parse payment details into structured items [{ mode, amount }]
   */
  static normalizePaymentSplits(paymentMode, paymentDetails, totalAmount) {
    const splits = [];

    if (Array.isArray(paymentDetails) && paymentDetails.length > 0) {
      for (const p of paymentDetails) {
        const amt = parseFloat(p.amount || 0);
        if (amt > 0) {
          splits.push({
            mode: (p.mode || p.payment_mode || paymentMode || 'cash').toLowerCase().trim(),
            amount: amt
          });
        }
      }
    } else if (paymentDetails && typeof paymentDetails === 'object') {
      // Object format e.g. { cash: 500, upi: 1000 }
      for (const [key, val] of Object.entries(paymentDetails)) {
        const amt = parseFloat(val || 0);
        if (amt > 0 && key !== 'notes' && key !== 'reference') {
          splits.push({ mode: key.toLowerCase().trim(), amount: amt });
        }
      }
    }

    // If no splits parsed, use the main paymentMode and totalAmount
    if (splits.length === 0) {
      const safeTot = parseFloat(totalAmount || 0);
      if (safeTot > 0) {
        splits.push({
          mode: (paymentMode || 'cash').toLowerCase().trim(),
          amount: safeTot
        });
      }
    }

    return splits;
  }

  /**
   * Atomic and Idempotent POS Sale Financial Transaction Integration
   * Invoked within OrderRepository.create inside the DB transaction
   */
  static async recordSaleTransaction(connection, {
    restaurantId,
    orderId,
    orderNumber,
    paymentMode,
    paymentDetails = null,
    totalAmount = 0,
    customerName = null,
    customerId = null,
    userId = null,
    userName = 'Cashier'
  }) {
    if (!orderId || !restaurantId) return;

    const splits = this.normalizePaymentSplits(paymentMode, paymentDetails, totalAmount);
    if (splits.length === 0) return;

    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      const mode = split.mode;
      const amt = split.amount;

      // 1. Credit / Due sales are tracked in customer_ledger, NOT bank account inflows!
      if (mode === 'credit' || mode === 'due') {
        continue;
      }

      const idempotencyKey = `sale_${restaurantId}_order_${orderId}_${mode}_${i}`;

      // 2. Check for duplicate/retry idempotency
      const existingTx = await FinancialAccountRepository.findTransactionByIdempotency(
        restaurantId,
        idempotencyKey,
        connection
      );
      if (existingTx) {
        continue; // Already posted, skip
      }

      // 3. Resolve target financial account
      const targetAccount = await this.resolveAccountForPaymentMode(restaurantId, mode, connection);
      if (!targetAccount) {
        console.warn(`[FinancialAccountService] No financial account found for mode "${mode}" (restId: ${restaurantId}). Skipping financial entry.`);
        continue;
      }

      // 4. Lock account FOR UPDATE
      const lockedAcc = await FinancialAccountRepository.lockAccount(targetAccount.id, restaurantId, connection);
      if (!lockedAcc) continue;

      const prevBal = parseFloat(lockedAcc.current_balance || 0);
      const newBal = parseFloat((prevBal + amt).toFixed(2));

      // 5. Insert financial transaction
      await FinancialAccountRepository.recordTransaction({
        restaurant_id: restaurantId,
        account_id: targetAccount.id,
        transaction_type: 'SALE_RECEIPT',
        reference_type: 'order',
        reference_id: String(orderId),
        reference_number: orderNumber,
        payment_mode: mode,
        party_type: customerId ? 'customer' : null,
        party_id: customerId || null,
        party_name: customerName || null,
        amount_in: amt,
        amount_out: 0.00,
        balance_after: newBal,
        description: `Sale Receipt #${orderNumber} (${mode.toUpperCase()})`,
        user_id: userId,
        user_name: userName,
        idempotency_key: idempotencyKey
      }, connection);

      // 6. Update current balance on account
      await FinancialAccountRepository.updateBalance(targetAccount.id, restaurantId, newBal, connection);
    }
  }

  /**
   * Customer Payment Receipt (Outstanding clearance)
   */
  static async recordCustomerPaymentReceipt(connection, {
    restaurantId,
    customerId,
    customerName = null,
    amount,
    paymentMode = 'cash',
    referenceNumber = null,
    notes = null,
    userId = null,
    userName = 'Staff'
  }) {
    const parsedAmount = Math.abs(parseFloat(amount) || 0);
    if (parsedAmount <= 0) return;

    const targetAccount = await this.resolveAccountForPaymentMode(restaurantId, paymentMode, connection);
    if (!targetAccount) return;

    const lockedAcc = await FinancialAccountRepository.lockAccount(targetAccount.id, restaurantId, connection);
    if (!lockedAcc) return;

    const prevBal = parseFloat(lockedAcc.current_balance || 0);
    const newBal = parseFloat((prevBal + parsedAmount).toFixed(2));
    const idempotencyKey = `custpay_${restaurantId}_c${customerId}_${Date.now()}_${Math.floor(Math.random()*1000)}`;

    await FinancialAccountRepository.recordTransaction({
      restaurant_id: restaurantId,
      account_id: targetAccount.id,
      transaction_type: 'CUSTOMER_PAYMENT',
      reference_type: 'customer_payment',
      reference_id: String(customerId),
      reference_number: referenceNumber,
      payment_mode: paymentMode,
      party_type: 'customer',
      party_id: customerId,
      party_name: customerName,
      amount_in: parsedAmount,
      amount_out: 0.00,
      balance_after: newBal,
      description: notes || `Payment received from customer #${customerId}`,
      user_id: userId,
      user_name: userName,
      idempotency_key: idempotencyKey
    }, connection);

    await FinancialAccountRepository.updateBalance(targetAccount.id, restaurantId, newBal, connection);
  }

  /**
   * Supplier Payment Outflow
   */
  static async recordSupplierPayment(connection, {
    restaurantId,
    supplierId,
    supplierName = null,
    purchaseBillId = null,
    paymentNumber = null,
    paymentMode = 'bank_transfer',
    accountId = null,
    amount,
    userId = null,
    userName = 'Staff',
    notes = null
  }) {
    const payAmount = Math.abs(parseFloat(amount) || 0);
    if (payAmount <= 0) return;

    let targetAccount;
    if (accountId) {
      targetAccount = await FinancialAccountRepository.findById(accountId, restaurantId, connection);
    }
    if (!targetAccount) {
      targetAccount = await this.resolveAccountForPaymentMode(restaurantId, paymentMode, connection);
    }
    if (!targetAccount) return;

    const lockedAcc = await FinancialAccountRepository.lockAccount(targetAccount.id, restaurantId, connection);
    if (!lockedAcc) return;

    const prevBal = parseFloat(lockedAcc.current_balance || 0);
    const newBal = parseFloat((prevBal - payAmount).toFixed(2));
    const idempotencyKey = `supppay_${restaurantId}_p${paymentNumber || Date.now()}`;

    // Avoid double deduction if already processed
    const existing = await FinancialAccountRepository.findTransactionByIdempotency(restaurantId, idempotencyKey, connection);
    if (existing) return;

    await FinancialAccountRepository.recordTransaction({
      restaurant_id: restaurantId,
      account_id: targetAccount.id,
      transaction_type: 'SUPPLIER_PAYMENT',
      reference_type: 'supplier_payment',
      reference_id: purchaseBillId ? String(purchaseBillId) : null,
      reference_number: paymentNumber,
      payment_mode: paymentMode,
      party_type: 'supplier',
      party_id: supplierId,
      party_name: supplierName,
      amount_in: 0.00,
      amount_out: payAmount,
      balance_after: newBal,
      description: notes || `Supplier payment #${paymentNumber} to supplier #${supplierId}`,
      user_id: userId,
      user_name: userName,
      idempotency_key: idempotencyKey
    }, connection);

    await FinancialAccountRepository.updateBalance(targetAccount.id, restaurantId, newBal, connection);
  }

  /**
   * Inter-Account Contra Transfer (Cash <-> Bank, Bank <-> Bank)
   */
  static async recordTransfer(restaurantId, {
    fromAccountId,
    toAccountId,
    amount,
    transferDate,
    referenceNumber = null,
    notes = null,
    userId = null,
    userName = 'Admin'
  }) {
    const transferAmount = parseFloat(amount || 0);
    if (transferAmount <= 0) {
      throw new Error('Transfer amount must be greater than zero.');
    }
    if (parseInt(fromAccountId, 10) === parseInt(toAccountId, 10)) {
      throw new Error('From Account and To Account must be different.');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Deadlock prevention: Lock accounts in strictly ascending ID order
      const firstId = Math.min(fromAccountId, toAccountId);
      const secondId = Math.max(fromAccountId, toAccountId);

      const acc1 = await FinancialAccountRepository.lockAccount(firstId, restaurantId, connection);
      const acc2 = await FinancialAccountRepository.lockAccount(secondId, restaurantId, connection);

      if (!acc1 || !acc2) {
        throw new Error('One or both accounts not found or inactive.');
      }

      const fromAcc = (acc1.id === parseInt(fromAccountId, 10)) ? acc1 : acc2;
      const toAcc = (acc1.id === parseInt(toAccountId, 10)) ? acc1 : acc2;

      const transferNumber = await FinancialAccountRepository.getNextTransferNumber(restaurantId, connection);
      const tDate = transferDate || getISTDateString();

      // Record transfer master entry
      const transferId = await FinancialAccountRepository.recordTransfer({
        restaurant_id: restaurantId,
        transfer_number: transferNumber,
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: transferAmount,
        transfer_date: tDate,
        reference_number: referenceNumber,
        notes,
        created_by_user_id: userId,
        created_by_name: userName
      }, connection);

      // 1. Outflow from source account
      const fromPrev = parseFloat(fromAcc.current_balance || 0);
      const fromNew = parseFloat((fromPrev - transferAmount).toFixed(2));
      await FinancialAccountRepository.recordTransaction({
        restaurant_id: restaurantId,
        account_id: fromAccountId,
        transaction_type: 'ACCOUNT_TRANSFER',
        reference_type: 'transfer',
        reference_id: String(transferId),
        reference_number: transferNumber,
        payment_mode: 'transfer',
        party_type: 'bank',
        party_id: toAccountId,
        party_name: toAcc.account_name,
        amount_in: 0.00,
        amount_out: transferAmount,
        balance_after: fromNew,
        description: `Transfer to ${toAcc.account_name} (${transferNumber})`,
        user_id: userId,
        user_name: userName,
        idempotency_key: `trf_out_${transferNumber}`
      }, connection);
      await FinancialAccountRepository.updateBalance(fromAccountId, restaurantId, fromNew, connection);

      // 2. Inflow into destination account
      const toPrev = parseFloat(toAcc.current_balance || 0);
      const toNew = parseFloat((toPrev + transferAmount).toFixed(2));
      await FinancialAccountRepository.recordTransaction({
        restaurant_id: restaurantId,
        account_id: toAccountId,
        transaction_type: 'ACCOUNT_TRANSFER',
        reference_type: 'transfer',
        reference_id: String(transferId),
        reference_number: transferNumber,
        payment_mode: 'transfer',
        party_type: 'bank',
        party_id: fromAccountId,
        party_name: fromAcc.account_name,
        amount_in: transferAmount,
        amount_out: 0.00,
        balance_after: toNew,
        description: `Transfer from ${fromAcc.account_name} (${transferNumber})`,
        user_id: userId,
        user_name: userName,
        idempotency_key: `trf_in_${transferNumber}`
      }, connection);
      await FinancialAccountRepository.updateBalance(toAccountId, restaurantId, toNew, connection);

      await connection.commit();
      return {
        id: transferId,
        transfer_number: transferNumber,
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: transferAmount,
        from_balance_after: fromNew,
        to_balance_after: toNew
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Business Expense Outflow
   */
  static async recordExpense(restaurantId, {
    category,
    amount,
    accountId,
    paymentMode = 'cash',
    expenseDate,
    payee = null,
    referenceNumber = null,
    notes = null,
    userId = null,
    userName = 'Staff'
  }) {
    const expenseAmt = parseFloat(amount || 0);
    if (expenseAmt <= 0) {
      throw new Error('Expense amount must be greater than zero.');
    }
    if (!category) {
      throw new Error('Expense category is required.');
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let targetAccount;
      if (accountId) {
        targetAccount = await FinancialAccountRepository.findById(accountId, restaurantId, connection);
      }
      if (!targetAccount) {
        targetAccount = await this.resolveAccountForPaymentMode(restaurantId, paymentMode, connection);
      }
      if (!targetAccount) {
        throw new Error('No valid financial account found for expense payment.');
      }

      const lockedAcc = await FinancialAccountRepository.lockAccount(targetAccount.id, restaurantId, connection);
      if (!lockedAcc) throw new Error('Financial account is locked or unavailable.');

      const expenseNumber = await FinancialAccountRepository.getNextExpenseNumber(restaurantId, connection);
      const eDate = expenseDate || getISTDateString();

      const expenseId = await FinancialAccountRepository.recordExpense({
        restaurant_id: restaurantId,
        expense_number: expenseNumber,
        category,
        amount: expenseAmt,
        account_id: targetAccount.id,
        payment_mode: paymentMode,
        expense_date: eDate,
        payee,
        reference_number: referenceNumber,
        notes,
        created_by_user_id: userId,
        created_by_name: userName
      }, connection);

      const prevBal = parseFloat(lockedAcc.current_balance || 0);
      const newBal = parseFloat((prevBal - expenseAmt).toFixed(2));

      await FinancialAccountRepository.recordTransaction({
        restaurant_id: restaurantId,
        account_id: targetAccount.id,
        transaction_type: 'EXPENSE_PAYMENT',
        reference_type: 'expense',
        reference_id: String(expenseId),
        reference_number: expenseNumber,
        payment_mode: paymentMode,
        party_type: 'other',
        party_name: payee || category,
        amount_in: 0.00,
        amount_out: expenseAmt,
        balance_after: newBal,
        description: `Expense: ${category}${payee ? ` (Payee: ${payee})` : ''} - ${expenseNumber}`,
        user_id: userId,
        user_name: userName,
        idempotency_key: `exp_${expenseNumber}`
      }, connection);

      await FinancialAccountRepository.updateBalance(targetAccount.id, restaurantId, newBal, connection);

      await connection.commit();
      return {
        id: expenseId,
        expense_number: expenseNumber,
        category,
        amount: expenseAmt,
        account_id: targetAccount.id,
        balance_after: newBal
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Sales Return / Credit Note Refund Outflow
   */
  static async recordRefund(connection, {
    restaurantId,
    orderId,
    orderNumber,
    amount,
    paymentMode = 'cash',
    accountId = null,
    userId = null,
    userName = 'Staff',
    notes = null
  }) {
    const refundAmt = Math.abs(parseFloat(amount) || 0);
    if (refundAmt <= 0) return;

    let targetAccount;
    if (accountId) {
      targetAccount = await FinancialAccountRepository.findById(accountId, restaurantId, connection);
    }
    if (!targetAccount) {
      targetAccount = await this.resolveAccountForPaymentMode(restaurantId, paymentMode, connection);
    }
    if (!targetAccount) return;

    const lockedAcc = await FinancialAccountRepository.lockAccount(targetAccount.id, restaurantId, connection);
    if (!lockedAcc) return;

    const idempotencyKey = `refund_${restaurantId}_ord_${orderId}_${Date.now()}`;
    const prevBal = parseFloat(lockedAcc.current_balance || 0);
    const newBal = parseFloat((prevBal - refundAmt).toFixed(2));

    await FinancialAccountRepository.recordTransaction({
      restaurant_id: restaurantId,
      account_id: targetAccount.id,
      transaction_type: 'REFUND',
      reference_type: 'credit_note',
      reference_id: String(orderId),
      reference_number: orderNumber,
      payment_mode: paymentMode,
      party_type: 'customer',
      amount_in: 0.00,
      amount_out: refundAmt,
      balance_after: newBal,
      description: notes || `Refund for order #${orderNumber}`,
      user_id: userId,
      user_name: userName,
      idempotency_key: idempotencyKey
    }, connection);

    await FinancialAccountRepository.updateBalance(targetAccount.id, restaurantId, newBal, connection);
  }
}

module.exports = FinancialAccountService;
