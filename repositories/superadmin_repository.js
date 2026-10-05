const pool = require('../config/db');

class SuperAdminRepository {
  static async getAllRestaurants() {
    // Auto-disable expired tenants:
    // Once today's date passes the tenant's Expiry Date, automatically:
    // - Change that tenant's Status from ACTIVE to EXPIRED
    // - Move Serial Numbers Tracking toggle automatically to OFF position (0)
    // Tenants with no Expiry Date (NULL) are exempt.
    try {
      await pool.execute(`
        UPDATE restaurants 
        SET subscription_status = 'expired', 
            feature_serial_numbers = 0,
            updated_at = NOW() 
        WHERE subscription_expires_at IS NOT NULL 
          AND subscription_expires_at < NOW() 
          AND (subscription_status != 'expired' OR feature_serial_numbers != 0)
      `);
    } catch (e) {
      console.warn('[getAllRestaurants] Auto-expiry sync warning:', e.message);
    }

    const [rows] = await pool.execute(
      'SELECT r.*, ' +
      'd.name as distributor_name, ' +
      'l.license_code, ' +
      'COALESCE(r.subscription_start_date, l.activated_at, r.created_at) as subscription_start_date, ' +
      'l.current_year_pricing, ' +
      'l.next_year_pricing, ' +
      '(SELECT COUNT(*) FROM users u WHERE u.restaurant_id = r.id) as userCount, ' +
      '(SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id) as orderCount, ' +
      '(SELECT COALESCE(SUM(total_amount), 0) FROM orders o WHERE o.restaurant_id = r.id AND o.order_status != "cancelled") as totalRevenue ' +
      'FROM restaurants r ' +
      'LEFT JOIN licenses l ON l.restaurant_id = r.id ' +
      'LEFT JOIN distributors d ON l.distributor_id = d.id ' +
      'ORDER BY r.id DESC'
    );
    return rows;
  }

  static async getRestaurantById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM restaurants WHERE id = ?',
      [id]
    );
    return rows[0];
  }

  static async getAllSubscriptionPlans() {
    const [rows] = await pool.execute(
      'SELECT * FROM subscription_plans ORDER BY id ASC'
    );
    return rows;
  }

  static async createRestaurant(restaurant) {
    const {
      name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile,
      gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit,
      subscription_status, duration_months, feature_superbill, barcode_scanner_enabled,
      feature_serial_numbers, reconciliation_enabled, subscription_start_date, subscription_expires_at
    } = restaurant;

    const months = parseInt(duration_months || 12);
    
    const [result] = await pool.execute(
      'INSERT INTO restaurants (name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile, gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit, subscription_status, feature_superbill, barcode_scanner_enabled, feature_serial_numbers, reconciliation_enabled, subscription_start_date, subscription_expires_at, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), COALESCE(?, DATE_ADD(NOW(), INTERVAL ? MONTH)), NOW())',
      [
        name, domain || null, logo_url || null, address || null, phone || null,
        email || owner_email || null, owner_name || null, owner_email || null, owner_mobile || null,
        gst_number || null, subscription_plan_id || 1, max_user_limit || 5, max_manager_limit || 2,
        max_cashier_limit || 3, subscription_status || 'trial',
        feature_superbill ? 1 : 0, barcode_scanner_enabled ? 1 : 0,
        feature_serial_numbers !== undefined ? (feature_serial_numbers ? 1 : 0) : 1,
        reconciliation_enabled !== undefined ? (reconciliation_enabled ? 1 : 0) : 0,
        subscription_start_date || null, subscription_expires_at || null, months
      ]
    );
    return result.insertId;
  }

  static async updateRestaurant(id, restaurant) {
    const {
      name, domain, logo_url, address, phone, email, owner_name, owner_email, owner_mobile,
      gst_number, subscription_plan_id, max_user_limit, max_manager_limit, max_cashier_limit,
      subscription_status, subscription_start_date, subscription_expires_at, feature_superbill, barcode_scanner_enabled,
      feature_serial_numbers, reconciliation_enabled
    } = restaurant;

    // Check expiry logic:
    // If expiry date is in the past, auto-disable: status = 'expired', feature_serial_numbers = 0
    let finalStatus = subscription_status || 'trial';
    let finalSerialNumbers = feature_serial_numbers !== undefined ? (feature_serial_numbers ? 1 : 0) : 1;
    let finalReconciliation = reconciliation_enabled !== undefined ? (reconciliation_enabled ? 1 : 0) : null;

    if (subscription_expires_at) {
      const expDate = new Date(subscription_expires_at);
      if (!isNaN(expDate.getTime())) {
        if (expDate < new Date()) {
          finalStatus = 'expired';
          finalSerialNumbers = 0;
        } else if (finalStatus === 'expired') {
          // If extending an expired subscription to the future, restore to active
          finalStatus = 'active';
        }
      }
    }

    const [result] = await pool.execute(
      'UPDATE restaurants SET name = ?, domain = ?, logo_url = ?, address = ?, phone = ?, email = ?, owner_name = ?, owner_email = ?, owner_mobile = ?, gst_number = ?, subscription_plan_id = ?, max_user_limit = ?, max_manager_limit = ?, max_cashier_limit = ?, subscription_status = ?, subscription_start_date = ?, subscription_expires_at = ?, feature_superbill = ?, barcode_scanner_enabled = ?, feature_serial_numbers = ?, reconciliation_enabled = COALESCE(?, reconciliation_enabled), updated_at = NOW() WHERE id = ?',
      [
        name, domain || null, logo_url || null, address || null, phone || null,
        email || null, owner_name || null, owner_email || null, owner_mobile || null,
        gst_number || null, subscription_plan_id || 1, max_user_limit || 5, max_manager_limit || 2,
        max_cashier_limit || 3, finalStatus, subscription_start_date || null, subscription_expires_at || null,
        feature_superbill !== undefined ? (feature_superbill ? 1 : 0) : 0,
        barcode_scanner_enabled !== undefined ? (barcode_scanner_enabled ? 1 : 0) : 0,
        finalSerialNumbers,
        finalReconciliation,
        id
      ]
    );

    // If a linked license exists, synchronize activated_at with subscription_start_date
    if (subscription_start_date) {
      try {
        await pool.execute(
          'UPDATE licenses SET activated_at = ?, updated_at = NOW() WHERE restaurant_id = ?',
          [subscription_start_date, id]
        );
      } catch (licErr) {
        console.warn('[updateRestaurant] License sync warning:', licErr.message);
      }
    }

    return result.affectedRows > 0;
  }

  static async toggleSuperBillPermission(id, enabled) {
    const [result] = await pool.execute(
      'UPDATE restaurants SET feature_superbill = ?, updated_at = NOW() WHERE id = ?',
      [enabled ? 1 : 0, id]
    );
    return result.affectedRows > 0;
  }

  static async toggleBarcodeScannerPermission(id, enabled) {
    const [result] = await pool.execute(
      'UPDATE restaurants SET barcode_scanner_enabled = ?, updated_at = NOW() WHERE id = ?',
      [enabled ? 1 : 0, id]
    );
    return result.affectedRows > 0;
  }

  static async toggleSerialNumbersPermission(id, enabled) {
    const [result] = await pool.execute(
      'UPDATE restaurants SET feature_serial_numbers = ?, updated_at = NOW() WHERE id = ?',
      [enabled ? 1 : 0, id]
    );
    return result.affectedRows > 0;
  }

  static async toggleReconciliationPermission(id, enabled) {
    const [result] = await pool.execute(
      'UPDATE restaurants SET reconciliation_enabled = ?, updated_at = NOW() WHERE id = ?',
      [enabled ? 1 : 0, id]
    );
    return result.affectedRows > 0;
  }

  static async renewSubscription(id, durationMonths, customExpiryDate = null) {
    let query;
    let params;

    if (customExpiryDate) {
      query = 'UPDATE restaurants SET subscription_expires_at = ?, subscription_status = "active", updated_at = NOW() WHERE id = ?';
      params = [customExpiryDate, id];
    } else {
      const months = parseInt(durationMonths || 12);
      query = 'UPDATE restaurants SET subscription_expires_at = IF(subscription_expires_at > NOW(), DATE_ADD(subscription_expires_at, INTERVAL ? MONTH), DATE_ADD(NOW(), INTERVAL ? MONTH)), subscription_status = "active", updated_at = NOW() WHERE id = ?';
      params = [months, months, id];
    }

    const [result] = await pool.execute(query, params);
    return result.affectedRows > 0;
  }

  static async setSubscriptionStatus(id, status) {
    const [result] = await pool.execute(
      'UPDATE restaurants SET subscription_status = ?, updated_at = NOW() WHERE id = ?',
      [status, id]
    );
    return result.affectedRows > 0;
  }

  static async getPlatformStats() {
    const [tenantCounts] = await pool.execute(
      'SELECT subscription_status, COUNT(*) as count FROM restaurants GROUP BY subscription_status'
    );

    const [platformAgg] = await pool.execute(
      'SELECT COUNT(id) as totalRestaurants, ' +
      '(SELECT COUNT(*) FROM orders WHERE order_status != "cancelled") as totalOrders, ' +
      '(SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE order_status != "cancelled") as totalRevenue, ' +
      '(SELECT COUNT(*) FROM users) as totalUsers ' +
      'FROM restaurants'
    );

    const statusSummary = { active: 0, expired: 0, trial: 0, suspended: 0 };
    tenantCounts.forEach(row => {
      if (statusSummary[row.subscription_status] !== undefined) {
        statusSummary[row.subscription_status] = row.count;
      }
    });

    return {
      totalRestaurants: platformAgg[0]?.totalRestaurants || 0,
      totalOrders: platformAgg[0]?.totalOrders || 0,
      totalRevenue: parseFloat(platformAgg[0]?.totalRevenue || 0),
      totalUsers: platformAgg[0]?.totalUsers || 0,
      subscriptions: statusSummary
    };
  }

  static async getGlobalAuditLogs(limit = 100, offset = 0) {
    const parsedLimit = Math.max(1, parseInt(limit) || 100);
    const parsedOffset = Math.max(0, parseInt(offset) || 0);
    const [rows] = await pool.query(
      `SELECT a.*, 
              r.name as current_restaurant_name, 
              r.logo_url as current_restaurant_logo,
              u.username as user_username, 
              u.name as fallback_user_name, 
              u.role as fallback_user_role 
       FROM audit_logs a 
       LEFT JOIN restaurants r ON a.restaurant_id = r.id 
       LEFT JOIN users u ON a.user_id = u.id 
       ORDER BY a.id DESC LIMIT ${parsedLimit} OFFSET ${parsedOffset}`
    );
    return rows;
  }

  static async deleteRestaurant(id) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Fetch restaurant details before deletion to preserve required licence registration metadata
      const [restRows] = await connection.execute('SELECT * FROM restaurants WHERE id = ?', [id]);
      if (restRows.length === 0) {
        await connection.rollback();
        return false;
      }
      const restaurant = restRows[0];

      // 2. Licence History Preservation
      // Check if this tenant is associated with any Licence ID
      const [licRows] = await connection.execute('SELECT * FROM licenses WHERE restaurant_id = ?', [id]);
      
      for (const lic of licRows) {
        // Check if an existing registration record exists in license_registration_history
        const [histRows] = await connection.execute(
          'SELECT id FROM license_registration_history WHERE license_id = ? OR license_code = ?',
          [lic.id, lic.license_code]
        );

        if (histRows.length > 0) {
          await connection.execute(
            `UPDATE license_registration_history 
             SET registration_status = 'Inactive', 
                 unregistered_at = NOW(),
                 account_name = COALESCE(account_name, ?),
                 person_name = COALESCE(person_name, ?),
                 email = COALESCE(email, ?),
                 phone = COALESCE(phone, ?)
             WHERE license_id = ? OR license_code = ?`,
            [
              restaurant.name,
              restaurant.owner_name,
              restaurant.owner_email || restaurant.email || 'deleted@tenant.local',
              restaurant.owner_mobile || restaurant.phone || null,
              lic.id,
              lic.license_code
            ]
          );
        } else {
          await connection.execute(
            `INSERT INTO license_registration_history 
               (license_id, license_code, account_name, person_name, email, phone, registration_status, registered_at, unregistered_at)
             VALUES (?, ?, ?, ?, ?, ?, 'Inactive', ?, NOW())`,
            [
              lic.id,
              lic.license_code,
              restaurant.name,
              restaurant.owner_name,
              restaurant.owner_email || restaurant.email || 'deleted@tenant.local',
              restaurant.owner_mobile || restaurant.phone || null,
              lic.activated_at || restaurant.created_at || new Date()
            ]
          );
        }

        // Set licence status to 'inactive' and detach foreign key restaurant_id
        await connection.execute(
          'UPDATE licenses SET status = "inactive", restaurant_id = NULL, updated_at = NOW() WHERE id = ?',
          [lic.id]
        );
      }

      // If owner email is present, mark any remaining active registrations for that email as Inactive
      const ownerEmail = (restaurant.owner_email || restaurant.email || '').trim().toLowerCase();
      if (ownerEmail) {
        await connection.execute(
          'UPDATE license_registration_history SET registration_status = "Inactive", unregistered_at = NOW() WHERE LOWER(email) = ? AND registration_status = "Active"',
          [ownerEmail]
        );
      }

      // 3. Complete Tenant Data Wipe Across All Modules
      // Strictly scoped to WHERE restaurant_id = ? (or child IN (... WHERE restaurant_id = ?))

      // A. Invoicing, Challans & Credit Notes
      await connection.execute('DELETE FROM credit_note_items WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM credit_notes WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM delivery_challan_items WHERE delivery_challan_id IN (SELECT id FROM delivery_challans WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM delivery_challans WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM e_invoices WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM e_way_bills WHERE restaurant_id = ?', [id]);

      // B. POS Receipts, Settlements & Orders
      await connection.execute('DELETE FROM held_receipts WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM settlement_items WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM payment_settlements WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM orders WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM order_sequences WHERE restaurant_id = ?', [id]);

      // C. Purchases, Bills, Returns & GRN
      await connection.execute('DELETE FROM goods_received_note_items WHERE grn_id IN (SELECT id FROM goods_received_notes WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM goods_received_notes WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM purchase_return_items WHERE purchase_return_id IN (SELECT id FROM purchase_returns WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM purchase_returns WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM purchase_bill_items WHERE purchase_bill_id IN (SELECT id FROM purchase_bills WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM purchase_bills WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM purchase_order_items WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM purchase_orders WHERE restaurant_id = ?', [id]);

      // D. Product Serial Numbers & Rack Stock
      await connection.execute('DELETE FROM product_serial_numbers WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM product_rack_stocks WHERE restaurant_id = ?', [id]);

      // E. Stock Adjustments, Counts, Requests, Transfers & Logs
      await connection.execute('DELETE FROM stock_counting_devices WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM stock_counting_assignments WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM stock_count_sessions WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM stock_adjustment_items WHERE stock_adjustment_id IN (SELECT id FROM stock_adjustments WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM stock_adjustments WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM stock_request_items WHERE stock_request_id IN (SELECT id FROM stock_requests WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM stock_requests WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM stock_transfer_items WHERE stock_transfer_id IN (SELECT id FROM stock_transfers WHERE restaurant_id = ?)', [id]);
      await connection.execute('DELETE FROM stock_transfers WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM stock_transactions WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM stock_logs WHERE restaurant_id = ?', [id]);

      // F. Warehouses & Racks
      await connection.execute('DELETE FROM warehouse_stocks WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM warehouse_racks WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM warehouses WHERE restaurant_id = ?', [id]);

      // G. Products, Catalog & Categories
      await connection.execute('DELETE FROM menu_items WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM categories WHERE restaurant_id = ?', [id]);

      // H. Customers, Receivables & Ledger
      await connection.execute('DELETE FROM customer_payment_allocations WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM customer_payments WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM customer_ledger WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM customers WHERE restaurant_id = ?', [id]);

      // I. Suppliers, Payables & Ledger
      await connection.execute('DELETE FROM supplier_payment_allocations WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM supplier_payments WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM supplier_ledger WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM suppliers WHERE restaurant_id = ?', [id]);

      // J. Banking, Financial Accounts, Transactions & Expenses
      await connection.execute('DELETE FROM account_transfers WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM payment_account_mappings WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM financial_transactions WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM financial_accounts WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM expense_claims WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM expenses WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM expense_categories WHERE restaurant_id = ?', [id]);

      // K. Day End, Cash Reconciliation, Shifts & Dining Tables
      await connection.execute('DELETE FROM reconciliation_adjustments WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM day_end_payment_reconciliations WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM day_ends WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM business_days WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM cash_counts WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM cash_movements WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM cashier_shifts WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM tables WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM table_types WHERE restaurant_id = ?', [id]);

      // L. Printing, Devices, Hardware & Settings
      await connection.execute('DELETE FROM print_queue WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM printer_settings WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM printers WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM receipt_settings WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM additional_charge_presets WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM restaurant_devices WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM saved_reports WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM email_logs WHERE restaurant_id = ?', [id]);

      // M. Operational Subscriptions & Tenant Audit Logs
      await connection.execute('DELETE FROM subscription_history WHERE restaurant_id = ?', [id]);
      await connection.execute('DELETE FROM audit_logs WHERE restaurant_id = ?', [id]);

      // N. Users / Staff belonging to this restaurant
      await connection.execute('DELETE FROM users WHERE restaurant_id = ?', [id]);

      // O. The restaurant/tenant record itself
      const [result] = await connection.execute('DELETE FROM restaurants WHERE id = ?', [id]);

      await connection.commit();
      return result.affectedRows > 0;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async addAuditLog(restaurantId, userId, action, description, ipAddress, extraDetails = {}) {
    try {
      const { user_name, user_role, prev_name, new_name, prev_logo, new_logo, metadata } = extraDetails;
      
      let finalUserName = user_name || null;
      let finalUserRole = user_role || null;

      if (userId && (!finalUserName || !finalUserRole)) {
        try {
          const [uRows] = await pool.query('SELECT name, role FROM users WHERE id = ?', [userId]);
          if (uRows.length > 0) {
            finalUserName = finalUserName || uRows[0].name;
            finalUserRole = finalUserRole || uRows[0].role;
          }
        } catch (e) {}
      }

      await pool.execute(
        'INSERT INTO audit_logs (restaurant_id, user_id, action, description, ip_address, user_name, user_role, prev_name, new_name, prev_logo, new_logo, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          restaurantId || null,
          userId || null,
          action || 'ACTION',
          description || null,
          ipAddress || null,
          finalUserName,
          finalUserRole,
          prev_name || null,
          new_name || null,
          prev_logo || null,
          new_logo || null,
          metadata ? JSON.stringify(metadata) : null
        ]
      );
    } catch (err) {
      console.warn('[Audit Log Warning]', err.message);
    }
  }
}

module.exports = SuperAdminRepository;
