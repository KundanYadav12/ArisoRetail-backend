/**
 * Migration 073: Enterprise Database Scalability, Reliability & High-Performance Optimization
 * 
 * Objectives:
 * 1. Zero Data Loss & Duplicate Prevention:
 *    - Strict UNIQUE constraint on (restaurant_id, idempotency_key) for bulletproof retry/offline idempotency.
 *    - Strict UNIQUE constraint on (restaurant_id, unique_order_number) to prevent invoice number collisions.
 * 2. High-Performance Indexing for Lakhs to Crores of Records:
 *    - Orders: Composite indexes for POS listing, reports, customer receivables, and online storefront.
 *    - Menu Items: Covering indexes for fast category browsing, barcode/SKU scanning, and stock lookups.
 *    - Print Queue: Fast polling index to prevent full-table scans over large base64 payloads.
 *    - Audit Logs: Indexing by tenant, date, and user.
 *    - Held Receipts, Serial Numbers, Stock Transactions, Financial Ledger, and Cashier Shifts.
 * 3. Safe, Non-Destructive & Backward Compatible:
 *    - Verifies index existence before creation (idempotent).
 *    - Cleans empty string idempotency keys to NULL to preserve multi-row NULL uniqueness in MySQL.
 */

async function indexExists(connection, table, indexName) {
  const [rows] = await connection.query(
    'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [table, indexName]
  );
  return rows.length > 0;
}

async function safeAddIndex(connection, table, indexName, columnsSql, isUnique = false) {
  const exists = await indexExists(connection, table, indexName);
  if (!exists) {
    const typeStr = isUnique ? 'UNIQUE KEY' : 'INDEX';
    await connection.query(`ALTER TABLE ${table} ADD ${typeStr} ${indexName} (${columnsSql})`);
    console.log(`[Migration 073] Created ${isUnique ? 'UNIQUE ' : ''}index "${indexName}" on table "${table}".`);
  } else {
    console.log(`[Migration 073] Index "${indexName}" already exists on table "${table}".`);
  }
}

exports.up = async function(connection) {
  console.log('[Migration 073] Starting Enterprise Database Scalability & Reliability Migration...');

  // 1. Data Sanitization before adding unique constraints
  // Convert any empty string idempotency_keys to NULL (NULLs do not conflict in MySQL UNIQUE indexes)
  await connection.query(`
    UPDATE orders 
    SET idempotency_key = NULL 
    WHERE idempotency_key IS NOT NULL AND TRIM(idempotency_key) = ''
  `);

  // 2. ORDERS TABLE OPTIMIZATIONS
  // Strict Idempotency & Unique Numbering
  await safeAddIndex(connection, 'orders', 'uq_orders_rest_idem', 'restaurant_id, idempotency_key', true);
  await safeAddIndex(connection, 'orders', 'uq_orders_rest_uon', 'restaurant_id, unique_order_number', true);

  // High-performance query & pagination indexes
  await safeAddIndex(connection, 'orders', 'idx_orders_rest_type_id', 'restaurant_id, is_sales_order, is_estimate, id DESC');
  await safeAddIndex(connection, 'orders', 'idx_orders_rep_optimized', 'restaurant_id, order_status, is_sales_order, is_estimate, created_at');
  await safeAddIndex(connection, 'orders', 'idx_orders_online_perf', 'restaurant_id, is_online, online_order_status, created_at');
  await safeAddIndex(connection, 'orders', 'idx_orders_cust_due_perf', 'restaurant_id, customer_id, payment_status, due_date');

  // 3. ORDER ITEMS TABLE OPTIMIZATIONS
  await safeAddIndex(connection, 'order_items', 'idx_oi_menu_order', 'menu_item_id, order_id');
  await safeAddIndex(connection, 'order_items', 'idx_oi_barcode', 'barcode');

  // 4. MENU ITEMS TABLE OPTIMIZATIONS
  await safeAddIndex(connection, 'menu_items', 'idx_menu_rest_cat_name', 'restaurant_id, category_id, name');
  await safeAddIndex(connection, 'menu_items', 'idx_menu_rest_sku', 'restaurant_id, sku');
  await safeAddIndex(connection, 'menu_items', 'idx_menu_rest_avail_track', 'restaurant_id, is_available, track_inventory');

  // 5. PRINT QUEUE OPTIMIZATIONS
  await safeAddIndex(connection, 'print_queue', 'idx_pq_rest_status_retry', 'restaurant_id, status, retry_count, id');
  await safeAddIndex(connection, 'print_queue', 'idx_pq_rest_order', 'restaurant_id, order_id, print_type');
  await safeAddIndex(connection, 'print_queue', 'idx_pq_status_retry', 'status, retry_count, id');

  // 6. AUDIT LOGS OPTIMIZATIONS
  await safeAddIndex(connection, 'audit_logs', 'idx_audit_rest_id', 'restaurant_id, id DESC');
  await safeAddIndex(connection, 'audit_logs', 'idx_audit_created', 'created_at');
  await safeAddIndex(connection, 'audit_logs', 'idx_audit_user', 'user_id');

  // 7. HELD RECEIPTS OPTIMIZATIONS
  await safeAddIndex(connection, 'held_receipts', 'idx_held_rest_status', 'restaurant_id, status, id DESC');

  // 8. PRODUCT SERIAL NUMBERS OPTIMIZATIONS
  await safeAddIndex(connection, 'product_serial_numbers', 'idx_psn_rest_item_status', 'restaurant_id, menu_item_id, status');

  // 9. STOCK TRANSACTIONS (LEDGER) OPTIMIZATIONS
  await safeAddIndex(connection, 'stock_transactions', 'idx_tx_rest_item_date', 'restaurant_id, menu_item_id, created_at, id');

  // 10. FINANCIAL TRANSACTIONS (LEDGER) OPTIMIZATIONS
  await safeAddIndex(connection, 'financial_transactions', 'idx_ft_rest_date', 'restaurant_id, created_at, id');

  // 11. CUSTOMER & SUPPLIER LEDGER REFERENCE LOOKUPS
  await safeAddIndex(connection, 'customer_ledger', 'idx_cl_ref', 'restaurant_id, reference_type, reference_id');
  await safeAddIndex(connection, 'supplier_ledger', 'idx_sl_ref', 'restaurant_id, reference_type, reference_id');

  // 12. CASHIER SHIFTS & CUSTOMERS
  await safeAddIndex(connection, 'cashier_shifts', 'idx_cs_rest_cashier_status', 'restaurant_id, cashier_id, status');
  await safeAddIndex(connection, 'customers', 'idx_cust_receivables', 'restaurant_id, allow_credit, current_balance');

  console.log('[Migration 073] ✅ Successfully executed Enterprise Database Scalability & Reliability Suite.');
};

exports.down = async function(connection) {
  const dropIndexes = [
    { table: 'orders', name: 'uq_orders_rest_idem' },
    { table: 'orders', name: 'uq_orders_rest_uon' },
    { table: 'orders', name: 'idx_orders_rest_type_id' },
    { table: 'orders', name: 'idx_orders_rep_optimized' },
    { table: 'orders', name: 'idx_orders_online_perf' },
    { table: 'orders', name: 'idx_orders_cust_due_perf' },
    { table: 'order_items', name: 'idx_oi_menu_order' },
    { table: 'order_items', name: 'idx_oi_barcode' },
    { table: 'menu_items', name: 'idx_menu_rest_cat_name' },
    { table: 'menu_items', name: 'idx_menu_rest_sku' },
    { table: 'menu_items', name: 'idx_menu_rest_avail_track' },
    { table: 'print_queue', name: 'idx_pq_rest_status_retry' },
    { table: 'print_queue', name: 'idx_pq_rest_order' },
    { table: 'print_queue', name: 'idx_pq_status_retry' },
    { table: 'audit_logs', name: 'idx_audit_rest_id' },
    { table: 'audit_logs', name: 'idx_audit_created' },
    { table: 'audit_logs', name: 'idx_audit_user' },
    { table: 'held_receipts', name: 'idx_held_rest_status' },
    { table: 'product_serial_numbers', name: 'idx_psn_rest_item_status' },
    { table: 'stock_transactions', name: 'idx_tx_rest_item_date' },
    { table: 'financial_transactions', name: 'idx_ft_rest_date' },
    { table: 'customer_ledger', name: 'idx_cl_ref' },
    { table: 'supplier_ledger', name: 'idx_sl_ref' },
    { table: 'cashier_shifts', name: 'idx_cs_rest_cashier_status' },
    { table: 'customers', name: 'idx_cust_receivables' }
  ];

  for (const item of dropIndexes) {
    try {
      if (await indexExists(connection, item.table, item.name)) {
        await connection.query(`ALTER TABLE ${item.table} DROP INDEX ${item.name}`);
        console.log(`[Migration 073 Down] Dropped index "${item.name}" from table "${item.table}".`);
      }
    } catch (e) {
      console.warn(`[Migration 073 Down Warning] Failed to drop index "${item.name}":`, e.message);
    }
  }
};

