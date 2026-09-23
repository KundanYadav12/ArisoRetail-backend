const pool = require('../config/db');
const FinancialAccountService = require('../services/financial_account_service');
const { getISTDateString } = require('../utils/date_utils');

class SupplierPayableRepository {
  /**
   * Generates next payment number: SP-YYYYMMDD-0001
   */
  static async getNextPaymentNumber(connection, restaurantId, paymentDate = null) {
    const pDate = paymentDate || getISTDateString();
    const dateStr = pDate.replace(/-/g, '');
    const prefix = `SP-${dateStr}-`;

    const [rows] = await connection.execute(
      'SELECT payment_number FROM supplier_payments WHERE payment_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [`${prefix}%`]
    );

    let nextNum = 1;
    if (rows.length > 0 && rows[0].payment_number) {
      const parts = rows[0].payment_number.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) nextNum = lastSeq + 1;
    }

    return `${prefix}${String(nextNum).padStart(4, '0')}`;
  }

  /**
   * Supplier Outstanding Dashboard Query
   * Computes actual purchases, billed amount, paid amount, outstanding, overdue, and advance
   * with server-side filtering, sorting, and pagination.
   */
  static async getSupplierOutstandingDashboard(restaurantId, filters = {}) {
    const {
      search,
      status = 'all',
      page = 1,
      limit = 25,
      sort_by = 'highest_outstanding',
      sort_order = 'DESC'
    } = filters;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(200, parseInt(limit, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    // 1. Base aggregated CTE / subquery per supplier for this restaurant
    const queryParams = [restaurantId];
    let whereClauses = 'WHERE s.restaurant_id = ?';

    if (search && search.trim()) {
      const s = `%${search.trim()}%`;
      whereClauses += ' AND (s.name LIKE ? OR s.company_name LIKE ? OR s.supplier_code LIKE ? OR s.mobile LIKE ? OR s.gst_number LIKE ?)';
      queryParams.push(s, s, s, s, s);
    }

    // Core aggregation SQL
    const baseAggQuery = `
      SELECT 
        s.id,
        s.restaurant_id,
        s.supplier_code,
        s.name,
        s.company_name,
        s.mobile,
        s.email,
        s.gst_number,
        s.payment_terms,
        s.status AS supplier_status,
        COALESCE(s.opening_balance, 0.00) AS opening_balance,
        COALESCE(s.current_balance, 0.00) AS current_balance,
        COALESCE(s.advance_balance, 0.00) AS advance_balance,

        -- Purchase Bills Aggregation
        COUNT(DISTINCT pb.id) AS total_purchases,
        COALESCE(SUM(pb.total_amount), 0.00) AS total_billed_amount,
        COALESCE(SUM(pb.paid_amount), 0.00) AS total_bill_paid_amount,
        COALESCE(SUM(CASE WHEN pb.payment_status != 'paid' THEN (pb.total_amount - pb.paid_amount) ELSE 0 END), 0.00) AS bill_outstanding_amount,
        
        -- Overdue & Due Date Tracking
        COALESCE(SUM(CASE 
          WHEN pb.payment_status != 'paid' AND pb.due_date IS NOT NULL AND pb.due_date < CURDATE() 
          THEN (pb.total_amount - pb.paid_amount) 
          ELSE 0 
        END), 0.00) AS overdue_amount,
        
        COALESCE(SUM(CASE 
          WHEN pb.payment_status != 'paid' AND pb.due_date = CURDATE() 
          THEN (pb.total_amount - pb.paid_amount) 
          ELSE 0 
        END), 0.00) AS due_today_amount,
        
        COALESCE(SUM(CASE 
          WHEN pb.payment_status != 'paid' AND pb.due_date >= CURDATE() AND pb.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
          THEN (pb.total_amount - pb.paid_amount) 
          ELSE 0 
        END), 0.00) AS due_this_week_amount,
        
        COALESCE(SUM(CASE 
          WHEN pb.payment_status != 'paid' AND pb.due_date >= CURDATE() AND pb.due_date <= LAST_DAY(CURDATE())
          THEN (pb.total_amount - pb.paid_amount) 
          ELSE 0 
        END), 0.00) AS due_this_month_amount,

        MAX(pb.bill_date) AS last_purchase_date,

        -- Payments Aggregation
        COALESCE(pay.total_payments_recorded, 0.00) AS total_payments_amount,
        pay.last_payment_date
      FROM suppliers s
      LEFT JOIN purchase_bills pb ON s.id = pb.supplier_id AND pb.restaurant_id = s.restaurant_id AND pb.status != 'cancelled'
      LEFT JOIN (
        SELECT 
          supplier_id,
          COALESCE(SUM(amount), 0.00) AS total_payments_recorded,
          MAX(payment_date) AS last_payment_date
        FROM supplier_payments
        WHERE restaurant_id = ?
        GROUP BY supplier_id
      ) pay ON s.id = pay.supplier_id
      ${whereClauses}
      GROUP BY s.id
    `;

    // Wrap in outer query to compute final calculated outstanding, total paid, and status
    const wrappedQuery = `
      SELECT 
        agg.*,
        GREATEST(0, (agg.bill_outstanding_amount + agg.opening_balance)) AS outstanding_amount,
        (agg.total_bill_paid_amount + agg.advance_balance) AS total_paid,
        CASE
          WHEN agg.overdue_amount > 0 THEN 'Overdue'
          WHEN GREATEST(0, (agg.bill_outstanding_amount + agg.opening_balance)) > 0 AND agg.total_bill_paid_amount > 0 THEN 'Partially Paid'
          WHEN GREATEST(0, (agg.bill_outstanding_amount + agg.opening_balance)) > 0 THEN 'Outstanding'
          WHEN agg.advance_balance > 0 THEN 'Advance'
          ELSE 'Paid'
        END AS payable_status
      FROM (${baseAggQuery}) agg
    `;

    // Apply status filter on the computed status
    let finalQuery = wrappedQuery;
    const finalParams = [restaurantId, ...queryParams];

    let havingOrWhere = [];
    if (status && status !== 'all') {
      const st = status.toLowerCase();
      if (st === 'overdue') {
        havingOrWhere.push('agg.overdue_amount > 0');
      } else if (st === 'outstanding') {
        havingOrWhere.push('GREATEST(0, (agg.bill_outstanding_amount + agg.opening_balance)) > 0');
      } else if (st === 'partially_paid') {
        havingOrWhere.push('GREATEST(0, (agg.bill_outstanding_amount + agg.opening_balance)) > 0 AND agg.total_bill_paid_amount > 0');
      } else if (st === 'paid') {
        havingOrWhere.push('GREATEST(0, (agg.bill_outstanding_amount + agg.opening_balance)) = 0 AND agg.total_billed_amount > 0');
      } else if (st === 'advance') {
        havingOrWhere.push('agg.advance_balance > 0');
      } else if (st === 'due_today') {
        havingOrWhere.push('agg.due_today_amount > 0');
      } else if (st === 'due_week' || st === 'due_this_week') {
        havingOrWhere.push('agg.due_this_week_amount > 0');
      } else if (st === 'due_month' || st === 'due_this_month') {
        havingOrWhere.push('agg.due_this_month_amount > 0');
      }
    }

    if (havingOrWhere.length > 0) {
      finalQuery += ` WHERE ${havingOrWhere.join(' AND ')}`;
    }

    // Determine sorting
    let orderBy = 'outstanding_amount DESC, name ASC';
    const orderDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    switch (sort_by) {
      case 'highest_outstanding':
        orderBy = `outstanding_amount DESC, name ASC`;
        break;
      case 'lowest_outstanding':
        orderBy = `outstanding_amount ASC, name ASC`;
        break;
      case 'latest_txn':
        orderBy = `COALESCE(last_purchase_date, last_payment_date, '1970-01-01') DESC`;
        break;
      case 'oldest_txn':
        orderBy = `COALESCE(last_purchase_date, last_payment_date, '1970-01-01') ASC`;
        break;
      case 'name':
        orderBy = `name ${orderDirection}`;
        break;
      case 'overdue':
        orderBy = `overdue_amount DESC, name ASC`;
        break;
      default:
        orderBy = `outstanding_amount DESC, name ASC`;
    }

    // Total count query
    const countSql = `SELECT COUNT(*) as total_count FROM (${finalQuery}) count_wrapper`;
    const [countRows] = await pool.execute(countSql, finalParams);
    const totalCount = countRows[0]?.total_count || 0;

    // Paginated results
    const paginatedSql = `${finalQuery} ORDER BY ${orderBy} LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await pool.execute(paginatedSql, finalParams);

    // Format row numbers
    const suppliers = rows.map(r => ({
      id: r.id,
      supplier_code: r.supplier_code || `SUPP-${String(r.id).padStart(4, '0')}`,
      name: r.name,
      company_name: r.company_name,
      mobile: r.mobile,
      email: r.email,
      gst_number: r.gst_number,
      payment_terms: r.payment_terms || 'Net 30',
      supplier_status: r.supplier_status,
      opening_balance: parseFloat(r.opening_balance || 0),
      current_balance: parseFloat(r.current_balance || 0),
      advance_balance: parseFloat(r.advance_balance || 0),
      total_purchases: parseInt(r.total_purchases || 0, 10),
      total_billed_amount: parseFloat(r.total_billed_amount || 0),
      total_paid: parseFloat(r.total_paid || 0),
      outstanding_amount: parseFloat(r.outstanding_amount || 0),
      overdue_amount: parseFloat(r.overdue_amount || 0),
      advance_amount: parseFloat(r.advance_balance || 0),
      last_purchase_date: r.last_purchase_date,
      last_payment_date: r.last_payment_date,
      status: r.payable_status
    }));

    // Top summary KPI metrics across the entire restaurant tenant
    const [kpiRows] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT s.id) AS total_suppliers_count,
        COALESCE(SUM(s.advance_balance), 0.00) AS total_advances,
        COALESCE(SUM(GREATEST(0, s.current_balance)), 0.00) AS total_payables,
        COALESCE((
          SELECT SUM(sp.amount) 
          FROM supplier_payments sp 
          WHERE sp.restaurant_id = ?
        ), 0.00) AS total_paid_amount,
        COALESCE((
          SELECT SUM(pb.total_amount - pb.paid_amount)
          FROM purchase_bills pb
          WHERE pb.restaurant_id = ? 
            AND pb.payment_status != 'paid' 
            AND pb.due_date IS NOT NULL 
            AND pb.due_date < CURDATE()
            AND pb.status != 'cancelled'
        ), 0.00) AS total_overdue_amount,
        COALESCE((
          SELECT COUNT(DISTINCT pb.supplier_id)
          FROM purchase_bills pb
          WHERE pb.restaurant_id = ? 
            AND pb.payment_status != 'paid' 
            AND pb.due_date IS NOT NULL 
            AND pb.due_date < CURDATE()
            AND pb.status != 'cancelled'
        ), 0) AS overdue_suppliers_count
      FROM suppliers s
      WHERE s.restaurant_id = ? AND s.status != 'inactive'
    `, [restaurantId, restaurantId, restaurantId, restaurantId]);

    const kpis = kpiRows[0] || {};

    return {
      summary: {
        total_payables: parseFloat(kpis.total_payables || 0),
        total_overdue: parseFloat(kpis.total_overdue_amount || 0),
        total_paid: parseFloat(kpis.total_paid_amount || 0),
        total_advances: parseFloat(kpis.total_advances || 0),
        total_suppliers: parseInt(kpis.total_suppliers_count || 0, 10),
        overdue_suppliers_count: parseInt(kpis.overdue_suppliers_count || 0, 10)
      },
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalCount / limitNum)
      },
      suppliers
    };
  }

  /**
   * Fetch supplier details with unpaid / partially paid purchase bills
   * for payment allocation.
   */
  static async getSupplierPayableDetails(supplierId, restaurantId) {
    const [suppRows] = await pool.execute(
      'SELECT * FROM suppliers WHERE id = ? AND restaurant_id = ?',
      [supplierId, restaurantId]
    );
    if (suppRows.length === 0) return null;
    const supplier = suppRows[0];

    // Fetch unpaid/partially paid purchase bills
    const [bills] = await pool.execute(`
      SELECT 
        pb.id,
        pb.bill_number,
        pb.internal_bill_number,
        pb.bill_date,
        pb.due_date,
        pb.subtotal,
        pb.tax_amount,
        pb.total_amount,
        pb.paid_amount,
        (pb.total_amount - pb.paid_amount) AS outstanding_amount,
        pb.payment_status,
        w.name AS warehouse_name,
        CASE 
          WHEN pb.due_date IS NOT NULL AND pb.due_date < CURDATE() THEN 1 
          ELSE 0 
        END AS is_overdue,
        CASE 
          WHEN pb.due_date IS NOT NULL AND pb.due_date < CURDATE() THEN DATEDIFF(CURDATE(), pb.due_date) 
          ELSE 0 
        END AS days_overdue
      FROM purchase_bills pb
      LEFT JOIN warehouses w ON pb.warehouse_id = w.id
      WHERE pb.supplier_id = ? AND pb.restaurant_id = ? 
        AND pb.payment_status != 'paid'
        AND pb.status != 'cancelled'
      ORDER BY 
        CASE WHEN pb.due_date IS NOT NULL THEN pb.due_date ELSE pb.bill_date END ASC,
        pb.id ASC
    `, [supplierId, restaurantId]);

    // Fetch available advances for this supplier
    const [advances] = await pool.execute(`
      SELECT id, payment_number, payment_date, advance_amount, payment_mode, notes
      FROM supplier_payments
      WHERE supplier_id = ? AND restaurant_id = ? AND advance_amount > 0
      ORDER BY payment_date DESC
    `, [supplierId, restaurantId]);

    const totalBillOutstanding = bills.reduce((acc, b) => acc + parseFloat(b.outstanding_amount || 0), 0);
    const totalOverdue = bills.filter(b => b.is_overdue === 1).reduce((acc, b) => acc + parseFloat(b.outstanding_amount || 0), 0);

    return {
      supplier: {
        id: supplier.id,
        supplier_code: supplier.supplier_code || `SUPP-${String(supplier.id).padStart(4, '0')}`,
        name: supplier.name,
        company_name: supplier.company_name,
        mobile: supplier.mobile,
        email: supplier.email,
        address: supplier.address,
        gst_number: supplier.gst_number,
        payment_terms: supplier.payment_terms || 'Net 30',
        opening_balance: parseFloat(supplier.opening_balance || 0),
        current_balance: parseFloat(supplier.current_balance || 0),
        advance_balance: parseFloat(supplier.advance_balance || 0)
      },
      summary: {
        total_bills_pending: bills.length,
        total_outstanding: totalBillOutstanding,
        total_overdue: totalOverdue,
        available_advance: parseFloat(supplier.advance_balance || 0)
      },
      unpaid_bills: bills.map(b => ({
        id: b.id,
        bill_number: b.bill_number,
        internal_bill_number: b.internal_bill_number,
        bill_date: b.bill_date,
        due_date: b.due_date,
        total_amount: parseFloat(b.total_amount || 0),
        paid_amount: parseFloat(b.paid_amount || 0),
        outstanding_amount: parseFloat(b.outstanding_amount || 0),
        payment_status: b.payment_status,
        warehouse_name: b.warehouse_name,
        is_overdue: b.is_overdue === 1,
        days_overdue: parseInt(b.days_overdue || 0, 10)
      })),
      advances
    };
  }

  /**
   * Record Supplier Payment with Multi-Bill Allocation and Advance Tracking.
   * Concurrency-safe and atomic.
   */
  static async recordSupplierPaymentWithAllocations(restaurantId, userId, userName, data) {
    const {
      supplier_id,
      payment_date,
      amount,
      payment_mode = 'Bank Transfer',
      account_id = null,
      reference_number = null,
      notes = null,
      allocations = [] // [{ purchase_bill_id, allocated_amount }]
    } = data;

    if (!supplier_id) throw new Error('supplier_id is required.');
    const payAmount = parseFloat(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      throw new Error('Payment amount must be a positive number.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Lock supplier record
      const [suppRows] = await connection.execute(
        'SELECT id, name, current_balance, advance_balance FROM suppliers WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [supplier_id, restaurantId]
      );
      if (suppRows.length === 0) throw new Error('Supplier not found.');
      const supplier = suppRows[0];
      const prevBal = parseFloat(supplier.current_balance || 0);
      const prevAdv = parseFloat(supplier.advance_balance || 0);

      // 2. Validate allocations against bills
      let totalAllocated = 0;
      const validAllocations = [];

      if (Array.isArray(allocations) && allocations.length > 0) {
        for (const alloc of allocations) {
          const allocAmt = parseFloat(alloc.allocated_amount || 0);
          if (allocAmt <= 0) continue;

          // Lock bill record
          const [billRows] = await connection.execute(
            'SELECT id, total_amount, paid_amount, payment_status, internal_bill_number FROM purchase_bills WHERE id = ? AND supplier_id = ? AND restaurant_id = ? FOR UPDATE',
            [alloc.purchase_bill_id, supplier_id, restaurantId]
          );

          if (billRows.length === 0) {
            throw new Error(`Purchase bill #${alloc.purchase_bill_id} not found for this supplier.`);
          }

          const bill = billRows[0];
          const totalAmt = parseFloat(bill.total_amount || 0);
          const currentPaid = parseFloat(bill.paid_amount || 0);
          const billDue = Math.max(0, totalAmt - currentPaid);

          if (allocAmt > billDue + 0.01) { // 1 cent grace for floating point
            throw new Error(`Allocation of ₹${allocAmt.toFixed(2)} exceeds outstanding balance of ₹${billDue.toFixed(2)} on bill ${bill.internal_bill_number}.`);
          }

          totalAllocated += allocAmt;
          validAllocations.push({
            billId: bill.id,
            billNumber: bill.internal_bill_number,
            allocAmt,
            newPaid: currentPaid + allocAmt,
            totalAmt
          });
        }
      }

      totalAllocated = parseFloat(totalAllocated.toFixed(2));
      if (totalAllocated > payAmount + 0.01) {
        throw new Error(`Total allocated amount (₹${totalAllocated.toFixed(2)}) cannot exceed the payment amount (₹${payAmount.toFixed(2)}).`);
      }

      // Excess payment becomes supplier advance
      const advanceAmount = parseFloat(Math.max(0, payAmount - totalAllocated).toFixed(2));
      const isAdvance = validAllocations.length === 0 ? 1 : 0;

      // 3. Generate unique payment number
      const payNumber = await this.getNextPaymentNumber(connection, restaurantId, payment_date);
      const paymentDateVal = payment_date || getISTDateString();

      // 4. Primary linked bill (for backward compatibility if only 1 bill)
      const primaryBillId = validAllocations.length === 1 ? validAllocations[0].billId : null;

      // 5. Insert supplier_payments record
      const [payResult] = await connection.execute(`
        INSERT INTO supplier_payments (
          restaurant_id, payment_number, supplier_id, purchase_bill_id,
          account_id, payment_date, amount, advance_amount, is_advance,
          payment_mode, reference_number, notes, created_by_user_id,
          created_by_name, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `, [
        restaurantId,
        payNumber,
        supplier_id,
        primaryBillId,
        account_id || null,
        paymentDateVal,
        payAmount,
        advanceAmount,
        isAdvance,
        payment_mode || 'Bank Transfer',
        reference_number || null,
        notes || null,
        userId || null,
        userName || 'Staff'
      ]);

      const paymentId = payResult.insertId;

      // 6. Insert allocation records & update purchase bills
      for (const item of validAllocations) {
        await connection.execute(`
          INSERT INTO supplier_payment_allocations (
            restaurant_id, supplier_payment_id, purchase_bill_id,
            allocated_amount, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId,
          paymentId,
          item.billId,
          item.allocAmt,
          `Settlement from ${payNumber}`
        ]);

        const newPayStatus = item.newPaid >= item.totalAmt - 0.01 ? 'paid' : 'partially_paid';
        await connection.execute(`
          UPDATE purchase_bills 
          SET paid_amount = ?, payment_status = ?, updated_at = NOW()
          WHERE id = ? AND restaurant_id = ?
        `, [Math.min(item.totalAmt, item.newPaid), newPayStatus, item.billId, restaurantId]);
      }

      // 7. Update supplier current_balance & advance_balance
      const newBalance = parseFloat(Math.max(0, prevBal - totalAllocated).toFixed(2));
      const newAdvance = parseFloat((prevAdv + advanceAmount).toFixed(2));

      await connection.execute(`
        UPDATE suppliers 
        SET current_balance = ?, advance_balance = ?, updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [newBalance, newAdvance, supplier_id, restaurantId]);

      // 8. Supplier Ledger Entry
      if (totalAllocated > 0) {
        await connection.execute(`
          INSERT INTO supplier_ledger (
            restaurant_id, supplier_id, transaction_type,
            amount, balance_after, reference_type, reference_id, reference_number,
            payment_mode, user_id, user_name, notes, created_at
          ) VALUES (?, ?, 'PAYMENT', ?, ?, 'supplier_payment', ?, ?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId, supplier_id,
          -totalAllocated, newBalance,
          paymentId, payNumber,
          payment_mode, userId || null, userName || 'Staff',
          notes ? `${notes} (Bills settled)` : `Settled bills via ${payment_mode}`
        ]);
      }

      if (advanceAmount > 0) {
        await connection.execute(`
          INSERT INTO supplier_ledger (
            restaurant_id, supplier_id, transaction_type,
            amount, balance_after, reference_type, reference_id, reference_number,
            payment_mode, user_id, user_name, notes, created_at
          ) VALUES (?, ?, 'SUPPLIER_ADVANCE', ?, ?, 'supplier_payment', ?, ?, ?, ?, ?, ?, NOW())
        `, [
          restaurantId, supplier_id,
          -advanceAmount, newBalance,
          paymentId, payNumber,
          payment_mode, userId || null, userName || 'Staff',
          `Advance credit recorded (Advance balance: ₹${newAdvance.toFixed(2)})`
        ]);
      }

      // 9. Post deduction to Financial Account / Cash Account via FinancialAccountService
      try {
        await FinancialAccountService.recordSupplierPayment(connection, {
          restaurantId,
          supplierId: supplier_id,
          supplierName: supplier.name || null,
          purchaseBillId: primaryBillId,
          paymentNumber: payNumber,
          paymentMode: payment_mode,
          accountId: account_id || null,
          amount: payAmount,
          userId,
          userName,
          notes: notes || `Supplier payment #${payNumber} (${validAllocations.length} bills settled)`
        });
      } catch (finErr) {
        console.warn('[Supplier Payment Financial Account Link]:', finErr.message);
      }

      await connection.commit();

      return {
        id: paymentId,
        payment_number: payNumber,
        amount: payAmount,
        total_allocated: totalAllocated,
        advance_amount: advanceAmount,
        new_balance: newBalance,
        new_advance_balance: newAdvance,
        allocations_count: validAllocations.length
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Adjust available supplier advance against an unpaid/partially paid purchase bill
   */
  static async adjustSupplierAdvance(restaurantId, userId, userName, data) {
    const {
      supplier_id,
      purchase_bill_id,
      advance_amount,
      notes = null
    } = data;

    if (!supplier_id || !purchase_bill_id) {
      throw new Error('supplier_id and purchase_bill_id are required.');
    }
    const adjAmt = parseFloat(advance_amount);
    if (isNaN(adjAmt) || adjAmt <= 0) {
      throw new Error('Adjustment amount must be positive.');
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Lock supplier
      const [suppRows] = await connection.execute(
        'SELECT id, name, current_balance, advance_balance FROM suppliers WHERE id = ? AND restaurant_id = ? FOR UPDATE',
        [supplier_id, restaurantId]
      );
      if (suppRows.length === 0) throw new Error('Supplier not found.');
      const supplier = suppRows[0];
      const availAdv = parseFloat(supplier.advance_balance || 0);

      if (adjAmt > availAdv + 0.01) {
        throw new Error(`Adjustment amount ₹${adjAmt.toFixed(2)} exceeds available advance balance of ₹${availAdv.toFixed(2)}.`);
      }

      // 2. Lock purchase bill
      const [billRows] = await connection.execute(
        'SELECT id, internal_bill_number, total_amount, paid_amount, payment_status FROM purchase_bills WHERE id = ? AND supplier_id = ? AND restaurant_id = ? FOR UPDATE',
        [purchase_bill_id, supplier_id, restaurantId]
      );
      if (billRows.length === 0) throw new Error('Purchase bill not found for this supplier.');
      const bill = billRows[0];
      const billTotal = parseFloat(bill.total_amount || 0);
      const billPaid = parseFloat(bill.paid_amount || 0);
      const billDue = Math.max(0, billTotal - billPaid);

      if (adjAmt > billDue + 0.01) {
        throw new Error(`Adjustment amount ₹${adjAmt.toFixed(2)} exceeds bill outstanding of ₹${billDue.toFixed(2)}.`);
      }

      // 3. Update purchase bill paid_amount
      const newPaid = billPaid + adjAmt;
      const newStatus = newPaid >= billTotal - 0.01 ? 'paid' : 'partially_paid';

      await connection.execute(`
        UPDATE purchase_bills 
        SET paid_amount = ?, payment_status = ?, updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [Math.min(billTotal, newPaid), newStatus, purchase_bill_id, restaurantId]);

      // 4. Update supplier advance_balance & current_balance
      const newAdvBalance = parseFloat(Math.max(0, availAdv - adjAmt).toFixed(2));
      const prevBal = parseFloat(supplier.current_balance || 0);
      const newBal = parseFloat(Math.max(0, prevBal - adjAmt).toFixed(2));

      await connection.execute(`
        UPDATE suppliers 
        SET current_balance = ?, advance_balance = ?, updated_at = NOW()
        WHERE id = ? AND restaurant_id = ?
      `, [newBal, newAdvBalance, supplier_id, restaurantId]);

      // 5. Create supplier_ledger entry
      const refNum = `ADV-ADJ-${bill.internal_bill_number}`;
      await connection.execute(`
        INSERT INTO supplier_ledger (
          restaurant_id, supplier_id, transaction_type,
          amount, balance_after, reference_type, reference_id, reference_number,
          payment_mode, user_id, user_name, notes, created_at
        ) VALUES (?, ?, 'ADVANCE_ADJUSTMENT', ?, ?, 'purchase_bill', ?, ?, 'Advance', ?, ?, ?, NOW())
      `, [
        restaurantId, supplier_id,
        -adjAmt, newBal,
        purchase_bill_id, refNum,
        userId || null, userName || 'Staff',
        notes || `Advance of ₹${adjAmt.toFixed(2)} adjusted against bill ${bill.internal_bill_number}`
      ]);

      await connection.commit();

      return {
        success: true,
        purchase_bill_id,
        adjusted_amount: adjAmt,
        new_advance_balance: newAdvBalance,
        new_supplier_balance: newBal,
        bill_payment_status: newStatus
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Detailed Supplier Ledger Journal with accurate running balance
   */
  static async getDetailedLedger(supplierId, restaurantId, filters = {}) {
    const { date_from, date_to, transaction_type } = filters;

    const [suppRows] = await pool.execute(
      'SELECT id, supplier_code, name, company_name, mobile, email, gst_number, payment_terms, opening_balance, current_balance, advance_balance FROM suppliers WHERE id = ? AND restaurant_id = ?',
      [supplierId, restaurantId]
    );
    if (suppRows.length === 0) return null;
    const supplier = suppRows[0];
    const opBal = parseFloat(supplier.opening_balance || 0);

    let query = `
      SELECT sl.* 
      FROM supplier_ledger sl
      WHERE sl.restaurant_id = ? AND sl.supplier_id = ?
    `;
    const params = [restaurantId, supplierId];

    if (date_from) {
      query += ' AND sl.created_at >= ?';
      params.push(date_from);
    }
    if (date_to) {
      query += ' AND sl.created_at <= ?';
      params.push(date_to);
    }
    if (transaction_type && transaction_type !== 'all') {
      query += ' AND sl.transaction_type = ?';
      params.push(transaction_type);
    }

    query += ' ORDER BY sl.created_at ASC, sl.id ASC';

    const [rows] = await pool.execute(query, params);

    // Compute running balance & debit/credit breakdowns
    let runningBalance = opBal;
    let totalDebit = 0;   // Increases what we owe (Bills, opening balance)
    let totalCredit = 0;  // Decreases what we owe (Payments, returns, advance adjustments)

    const ledgerEntries = rows.map(entry => {
      const amt = parseFloat(entry.amount || 0);
      let debit = 0;
      let credit = 0;

      if (amt > 0) {
        debit = amt; // Purchase Bill increases payable
        totalDebit += debit;
        runningBalance += debit;
      } else {
        credit = Math.abs(amt); // Payment or Return reduces payable
        totalCredit += credit;
        runningBalance = Math.max(0, runningBalance - credit);
      }

      return {
        id: entry.id,
        created_at: entry.created_at,
        transaction_type: entry.transaction_type,
        reference_type: entry.reference_type,
        reference_id: entry.reference_id,
        reference_number: entry.reference_number,
        payment_mode: entry.payment_mode,
        notes: entry.notes,
        debit: debit > 0 ? debit : null,
        credit: credit > 0 ? credit : null,
        amount: amt,
        balance_after: parseFloat(entry.balance_after || runningBalance),
        user_name: entry.user_name
      };
    });

    return {
      supplier: {
        id: supplier.id,
        supplier_code: supplier.supplier_code || `SUPP-${String(supplier.id).padStart(4, '0')}`,
        name: supplier.name,
        company_name: supplier.company_name,
        mobile: supplier.mobile,
        email: supplier.email,
        gst_number: supplier.gst_number,
        payment_terms: supplier.payment_terms || 'Net 30',
        opening_balance: opBal,
        current_balance: parseFloat(supplier.current_balance || 0),
        advance_balance: parseFloat(supplier.advance_balance || 0)
      },
      summary: {
        opening_balance: opBal,
        total_debit: parseFloat(totalDebit.toFixed(2)),
        total_credit: parseFloat(totalCredit.toFixed(2)),
        closing_balance: parseFloat(supplier.current_balance || 0),
        advance_balance: parseFloat(supplier.advance_balance || 0)
      },
      ledger: ledgerEntries
    };
  }

  /**
   * Fetch single payment with its allocated bills breakdown
   */
  static async getPaymentById(paymentId, restaurantId) {
    const [headerRows] = await pool.execute(`
      SELECT 
        sp.*,
        s.name AS supplier_name,
        s.company_name AS supplier_company,
        s.supplier_code,
        fa.account_name,
        fa.bank_name
      FROM supplier_payments sp
      LEFT JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN financial_accounts fa ON sp.account_id = fa.id
      WHERE sp.id = ? AND sp.restaurant_id = ?
    `, [paymentId, restaurantId]);

    if (headerRows.length === 0) return null;
    const payment = headerRows[0];

    // Fetch allocated bills
    const [allocations] = await pool.execute(`
      SELECT 
        spa.*,
        pb.internal_bill_number,
        pb.bill_number,
        pb.bill_date,
        pb.total_amount AS bill_total,
        pb.paid_amount AS bill_paid,
        pb.payment_status AS bill_payment_status
      FROM supplier_payment_allocations spa
      JOIN purchase_bills pb ON spa.purchase_bill_id = pb.id
      WHERE spa.supplier_payment_id = ? AND spa.restaurant_id = ?
    `, [paymentId, restaurantId]);

    payment.allocations = allocations;
    return payment;
  }
}

module.exports = SupplierPayableRepository;
