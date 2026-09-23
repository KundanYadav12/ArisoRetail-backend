const pool = require('../config/db');
const ExcelJS = require('exceljs');
const { getISTDateString, formatLocalDate } = require('../utils/date_utils');

class ReportsEngine {
  /**
   * Resolve Date Range with support for Indian Financial Year (1 April - 31 March)
   */
  static resolveDateRange(preset, queryFrom, queryTo) {
    const pad = (n) => String(n).padStart(2, '0');
    const formatYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const now = new Date();

    if (preset === 'custom' && queryFrom && queryTo) {
      let from = queryFrom.trim();
      let to = queryTo.trim();
      if (from.length === 10) from = `${from} 00:00:00`;
      if (to.length === 10) to = `${to} 23:59:59`;
      return { from, to, label: `${from.slice(0, 10)} to ${to.slice(0, 10)}` };
    }

    let fromDate = new Date();
    let toDate = new Date();
    let label = '';

    switch (preset) {
      case 'today': {
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        label = `Today (${formatYmd(fromDate)})`;
        break;
      }
      case 'yesterday': {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        fromDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0);
        toDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
        label = `Yesterday (${formatYmd(fromDate)})`;
        break;
      }
      case 'this_week': {
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
        fromDate = new Date(d.setDate(diff));
        fromDate.setHours(0, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        label = 'This Week';
        break;
      }
      case 'last_week': {
        const d = new Date(now);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
        fromDate = new Date(d.setDate(diff));
        fromDate.setHours(0, 0, 0, 0);
        const endLastWeek = new Date(fromDate);
        endLastWeek.setDate(endLastWeek.getDate() + 6);
        endLastWeek.setHours(23, 59, 59, 999);
        toDate = endLastWeek;
        label = 'Last Week';
        break;
      }
      case 'this_month':
      case 'month': {
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        label = 'This Month';
        break;
      }
      case 'last_month': {
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        label = 'Last Month';
        break;
      }
      case 'this_quarter':
      case 'quarter': {
        const currentQ = Math.floor(now.getMonth() / 3);
        fromDate = new Date(now.getFullYear(), currentQ * 3, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), (currentQ + 1) * 3, 0, 23, 59, 59);
        label = `Q${currentQ + 1} (${now.getFullYear()})`;
        break;
      }
      case 'this_fy':
      case 'fy':
      case 'year': {
        // Indian Financial Year: 1 April -> 31 March
        const currentMonth = now.getMonth(); // 0-indexed (3 = April)
        const currentYear = now.getFullYear();
        const fyStartYear = currentMonth >= 3 ? currentYear : currentYear - 1;
        fromDate = new Date(fyStartYear, 3, 1, 0, 0, 0); // April 1
        toDate = new Date(fyStartYear + 1, 2, 31, 23, 59, 59); // March 31
        label = `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
        break;
      }
      default: {
        // Default to last 30 days
        fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 30);
        fromDate.setHours(0, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        label = 'Last 30 Days';
      }
    }

    const from = `${formatYmd(fromDate)} 00:00:00`;
    const to = `${formatYmd(toDate)} 23:59:59`;
    return { from, to, label };
  }

  /**
   * Reports Catalog Definition
   */
  static getCatalog() {
    return [
      // 1. SALES
      {
        id: 'sales_daily',
        title: 'Daily Sales (DSR)',
        category: 'sales',
        description: 'Comprehensive daily revenue, tax collections, discounts, and bill averages.',
        columns: [
          { key: 'date', header: 'Date', width: 14 },
          { key: 'bills_count', header: 'Bills Count', width: 12, align: 'right' },
          { key: 'gross_sales', header: 'Gross Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'discounts', header: 'Discounts (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'returns', header: 'Returns (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'net_sales', header: 'Net Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'taxable_sales', header: 'Taxable (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'gst', header: 'GST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'grand_total', header: 'Grand Total (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'avg_bill_value', header: 'Avg Bill (₹)', width: 14, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'sales_register',
        title: 'Sales Register',
        category: 'sales',
        description: 'Complete audit log of all completed sales invoices with row drill-down.',
        columns: [
          { key: 'invoice_number', header: 'Invoice #', width: 18, isLink: true },
          { key: 'date', header: 'Date & Time', width: 18 },
          { key: 'customer_name', header: 'Customer', width: 22 },
          { key: 'salesman_name', header: 'Salesman', width: 18 },
          { key: 'items_count', header: 'Items', width: 10, align: 'right' },
          { key: 'taxable_value', header: 'Taxable (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'gst', header: 'GST (₹)', width: 12, align: 'right', isCurrency: true },
          { key: 'discount', header: 'Discount (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_amount', header: 'Total (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'payment_mode', header: 'Payment Mode', width: 14 },
          { key: 'payment_status', header: 'Payment Status', width: 14 },
          { key: 'status', header: 'Status', width: 12 }
        ]
      },
      {
        id: 'sales_item_wise',
        title: 'Item-wise Sales',
        category: 'sales',
        description: 'Product quantity sales, revenue, average selling price, and discounts.',
        columns: [
          { key: 'item_name', header: 'Item Name', width: 25 },
          { key: 'sku', header: 'SKU', width: 14 },
          { key: 'category_name', header: 'Category', width: 18 },
          { key: 'qty_sold', header: 'Qty Sold', width: 12, align: 'right' },
          { key: 'gross_sales', header: 'Gross Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'discount', header: 'Discount (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'gst', header: 'GST (₹)', width: 12, align: 'right', isCurrency: true },
          { key: 'net_sales', header: 'Net Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'avg_price', header: 'Avg Price (₹)', width: 14, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'sales_category_wise',
        title: 'Category-wise Sales',
        category: 'sales',
        description: 'Revenue, quantity, and bills breakdown by product category.',
        columns: [
          { key: 'category_name', header: 'Category', width: 22 },
          { key: 'total_quantity', header: 'Total Qty', width: 14, align: 'right' },
          { key: 'gross_sales', header: 'Gross Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'discount', header: 'Discount (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'gst', header: 'GST (₹)', width: 12, align: 'right', isCurrency: true },
          { key: 'net_sales', header: 'Net Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'bills_count', header: 'Bills Count', width: 12, align: 'right' }
        ]
      },
      {
        id: 'sales_hour_wise',
        title: 'Hour-wise Sales',
        category: 'sales',
        description: 'Peak billing analysis by hour of day (10-11, 11-12, etc.).',
        columns: [
          { key: 'hour_slot', header: 'Time Window', width: 18 },
          { key: 'bills_count', header: 'Orders Count', width: 14, align: 'right' },
          { key: 'total_sales', header: 'Total Sales (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'avg_bill', header: 'Avg Bill (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'sales_payment_wise',
        title: 'Payment-wise Sales',
        category: 'sales',
        description: 'Collections split across Cash, UPI, Cards, Bank, Credit, and Wallets.',
        columns: [
          { key: 'payment_mode', header: 'Payment Method', width: 20 },
          { key: 'transaction_count', header: 'Transactions', width: 14, align: 'right' },
          { key: 'total_amount', header: 'Total Amount (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'percentage', header: 'Share (%)', width: 12, align: 'right' }
        ]
      },
      {
        id: 'sales_salesman_wise',
        title: 'Salesman-wise Sales',
        category: 'sales',
        description: 'Staff order performance, sales volume, discounts given, and bill averages.',
        columns: [
          { key: 'salesman_name', header: 'Salesman / Cashier', width: 22 },
          { key: 'bills_count', header: 'Bills Issued', width: 14, align: 'right' },
          { key: 'gross_sales', header: 'Gross Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'discounts', header: 'Discounts (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'net_sales', header: 'Net Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'avg_bill', header: 'Avg Bill (₹)', width: 14, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'sales_customer_wise',
        title: 'Customer-wise Sales',
        category: 'sales',
        description: 'Customer order frequency, sales total, returns, and outstanding balance.',
        columns: [
          { key: 'customer_name', header: 'Customer', width: 22, isLink: true },
          { key: 'phone', header: 'Phone', width: 16 },
          { key: 'bills_count', header: 'Orders', width: 10, align: 'right' },
          { key: 'total_sales', header: 'Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'total_returns', header: 'Returns (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'outstanding', header: 'Outstanding (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'sales_discounts',
        title: 'Discount Report',
        category: 'sales',
        description: 'Item and bill discounts granted across orders and staff.',
        columns: [
          { key: 'invoice_number', header: 'Invoice #', width: 18, isLink: true },
          { key: 'date', header: 'Date', width: 14 },
          { key: 'customer_name', header: 'Customer', width: 20 },
          { key: 'salesman_name', header: 'Salesman', width: 18 },
          { key: 'subtotal', header: 'Gross (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'discount_amount', header: 'Discount (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'net_amount', header: 'Net (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'sales_cancelled_void',
        title: 'Cancelled / Void Sales',
        category: 'sales',
        description: 'Audit log of cancelled or voided orders with cancellation reasons.',
        columns: [
          { key: 'order_number', header: 'Order #', width: 18 },
          { key: 'date', header: 'Created Date', width: 18 },
          { key: 'customer_name', header: 'Customer', width: 20 },
          { key: 'cashier_name', header: 'User', width: 18 },
          { key: 'total_amount', header: 'Amount (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'reason', header: 'Reason / Notes', width: 25 },
          { key: 'cancelled_at', header: 'Cancelled At', width: 18 }
        ]
      },
      {
        id: 'sales_returns',
        title: 'Sales Return (Credit Notes)',
        category: 'sales',
        description: 'Goods returned by customers and statutory credit notes with tax reversal.',
        columns: [
          { key: 'credit_note_number', header: 'Credit Note #', width: 20 },
          { key: 'original_invoice', header: 'Original Invoice', width: 18, isLink: true },
          { key: 'credit_note_date', header: 'Date', width: 14 },
          { key: 'customer_name', header: 'Customer', width: 22 },
          { key: 'subtotal', header: 'Taxable (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_tax', header: 'Tax Reversed (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'total_amount', header: 'Total Refund (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'reason', header: 'Reason', width: 20 }
        ]
      },
      {
        id: 'sales_revenue',
        title: 'Revenue Report',
        category: 'sales',
        description: 'Strict business income report separating gross revenue, discounts, returns, and GST.',
        columns: [
          { key: 'period', header: 'Period', width: 16 },
          { key: 'gross_sales', header: 'Gross Value (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'discounts', header: 'Discounts (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'returns', header: 'Returns (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'net_revenue', header: 'Net Revenue (Excl. GST) (₹)', width: 24, align: 'right', isCurrency: true },
          { key: 'gst_collected', header: 'GST Liability (₹)', width: 18, align: 'right', isCurrency: true }
        ]
      },

      // 2. PURCHASE
      {
        id: 'purchase_register',
        title: 'Purchase Register',
        category: 'purchase',
        description: 'Complete log of inward purchase bills from suppliers with tax and warehouse tracking.',
        columns: [
          { key: 'bill_number', header: 'Bill #', width: 18 },
          { key: 'bill_date', header: 'Date', width: 14 },
          { key: 'supplier_name', header: 'Supplier', width: 22 },
          { key: 'taxable_amount', header: 'Taxable (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'gst_amount', header: 'GST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_amount', header: 'Total (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'paid_amount', header: 'Paid (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'status', header: 'Bill Status', width: 14 },
          { key: 'payment_status', header: 'Payment Status', width: 14 }
        ]
      },
      {
        id: 'purchase_supplier_wise',
        title: 'Supplier-wise Purchase',
        category: 'purchase',
        description: 'Purchases, inward GST, and outstanding dues grouped by supplier.',
        columns: [
          { key: 'supplier_name', header: 'Supplier', width: 25 },
          { key: 'bills_count', header: 'Bills Count', width: 12, align: 'right' },
          { key: 'purchase_value', header: 'Purchase Value (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'gst_total', header: 'GST / ITC (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'outstanding_balance', header: 'Outstanding (₹)', width: 18, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'purchase_item_wise',
        title: 'Item-wise Purchase',
        category: 'purchase',
        description: 'Item procurement quantities, average purchase rate, and supplier sources.',
        columns: [
          { key: 'item_name', header: 'Item Name', width: 25 },
          { key: 'supplier_name', header: 'Supplier', width: 22 },
          { key: 'quantity', header: 'Purchased Qty', width: 14, align: 'right' },
          { key: 'rate', header: 'Purchase Rate (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'taxable_value', header: 'Taxable (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'total_tax', header: 'Tax (₹)', width: 12, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'purchase_orders',
        title: 'Purchase Orders',
        category: 'purchase',
        description: 'PO statuses, expected delivery, ordered vs received quantities, and order values.',
        columns: [
          { key: 'po_number', header: 'PO #', width: 18 },
          { key: 'po_date', header: 'Date', width: 14 },
          { key: 'supplier_name', header: 'Supplier', width: 22 },
          { key: 'status', header: 'Status', width: 14 },
          { key: 'total_amount', header: 'Total Value (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'purchase_returns',
        title: 'Purchase Return (Debit Notes)',
        category: 'purchase',
        description: 'Inward goods returned to suppliers with statutory debit notes.',
        columns: [
          { key: 'return_number', header: 'Return #', width: 18 },
          { key: 'return_date', header: 'Date', width: 14 },
          { key: 'supplier_name', header: 'Supplier', width: 22 },
          { key: 'total_amount', header: 'Amount (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'reason', header: 'Reason', width: 25 }
        ]
      },

      // 3. INVENTORY
      {
        id: 'inventory_current_stock',
        title: 'Current Stock',
        category: 'inventory',
        description: 'Live warehouse stock balances, unit costs, total stock valuation, and stock statuses.',
        columns: [
          { key: 'item_name', header: 'Item Name', width: 25 },
          { key: 'sku', header: 'SKU', width: 14 },
          { key: 'category_name', header: 'Category', width: 18 },
          { key: 'warehouse_name', header: 'Warehouse', width: 18 },
          { key: 'current_stock', header: 'Current Stock', width: 14, align: 'right' },
          { key: 'unit', header: 'Unit', width: 10 },
          { key: 'cost_price', header: 'Avg Cost (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'stock_value', header: 'Stock Value (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'min_stock', header: 'Min Stock', width: 12, align: 'right' },
          { key: 'stock_status', header: 'Status', width: 14 }
        ]
      },
      {
        id: 'inventory_stock_ledger',
        title: 'Stock Ledger (Movements)',
        category: 'inventory',
        description: 'Auditable stock ledger tracking every transaction (SALE, PURCHASE, RETURN, ADJUSTMENT).',
        columns: [
          { key: 'created_at', header: 'Date & Time', width: 18 },
          { key: 'item_name', header: 'Item Name', width: 22 },
          { key: 'warehouse_name', header: 'Warehouse', width: 16 },
          { key: 'transaction_type', header: 'Transaction Type', width: 18 },
          { key: 'reference_number', header: 'Reference', width: 18 },
          { key: 'previous_stock', header: 'Opening', width: 12, align: 'right' },
          { key: 'qty_in', header: 'IN', width: 10, align: 'right' },
          { key: 'qty_out', header: 'OUT', width: 10, align: 'right' },
          { key: 'new_stock', header: 'Closing', width: 12, align: 'right' },
          { key: 'user_name', header: 'User', width: 16 }
        ]
      },
      {
        id: 'inventory_stock_valuation',
        title: 'Stock Valuation',
        category: 'inventory',
        description: 'Inventory valuation by warehouse and category using authoritative cost prices.',
        columns: [
          { key: 'item_name', header: 'Product', width: 25 },
          { key: 'category_name', header: 'Category', width: 18 },
          { key: 'warehouse_name', header: 'Warehouse', width: 18 },
          { key: 'quantity', header: 'Stock Qty', width: 14, align: 'right' },
          { key: 'unit_cost', header: 'Unit Cost (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_value', header: 'Total Value (₹)', width: 18, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'inventory_low_stock',
        title: 'Low Stock Report',
        category: 'inventory',
        description: 'Products that have fallen below minimum threshold with suggested reorder quantities.',
        columns: [
          { key: 'item_name', header: 'Product', width: 25 },
          { key: 'sku', header: 'SKU', width: 14 },
          { key: 'category_name', header: 'Category', width: 18 },
          { key: 'current_stock', header: 'Current Stock', width: 14, align: 'right' },
          { key: 'min_stock', header: 'Min Level', width: 12, align: 'right' },
          { key: 'reorder_level', header: 'Reorder Level', width: 14, align: 'right' },
          { key: 'suggested_reorder', header: 'Suggested Reorder', width: 16, align: 'right' }
        ]
      },
      {
        id: 'inventory_out_of_stock',
        title: 'Out of Stock Report',
        category: 'inventory',
        description: 'All active catalog items currently depleted to zero inventory.',
        columns: [
          { key: 'item_name', header: 'Product', width: 25 },
          { key: 'sku', header: 'SKU', width: 14 },
          { key: 'category_name', header: 'Category', width: 18 },
          { key: 'current_stock', header: 'Stock Qty', width: 12, align: 'right' },
          { key: 'min_stock', header: 'Min Level', width: 12, align: 'right' }
        ]
      },
      {
        id: 'inventory_adjustments',
        title: 'Stock Adjustment Report',
        category: 'inventory',
        description: 'Physical inventory corrections and manual adjustments with reasons and timestamps.',
        columns: [
          { key: 'created_at', header: 'Date', width: 18 },
          { key: 'item_name', header: 'Product', width: 22 },
          { key: 'warehouse_name', header: 'Warehouse', width: 16 },
          { key: 'previous_stock', header: 'Before Qty', width: 12, align: 'right' },
          { key: 'adjustment_qty', header: 'Adjustment Qty', width: 14, align: 'right' },
          { key: 'new_stock', header: 'After Qty', width: 12, align: 'right' },
          { key: 'reason', header: 'Reason / Notes', width: 22 },
          { key: 'user_name', header: 'Adjusted By', width: 16 }
        ]
      },

      // 4. GST / TAX
      {
        id: 'gst_summary',
        title: 'GST Summary',
        category: 'gst',
        description: 'High-level CA summary of Outward Sales Tax, Inward Purchase ITC, and Net GST Liability.',
        columns: [
          { key: 'tax_head', header: 'Tax Head', width: 22 },
          { key: 'taxable_value', header: 'Taxable Amount (₹)', width: 20, align: 'right', isCurrency: true },
          { key: 'cgst', header: 'CGST (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'sgst', header: 'SGST (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'igst', header: 'IGST (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'total_tax', header: 'Total GST (₹)', width: 18, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'gst_rate_wise',
        title: 'GST Rate-wise Report',
        category: 'gst',
        description: 'Sales aggregated across statutory GST slabs (0%, 5%, 12%, 18%, 28%).',
        columns: [
          { key: 'gst_rate', header: 'GST Slab', width: 14 },
          { key: 'invoices_count', header: 'Invoices', width: 12, align: 'right' },
          { key: 'taxable_amount', header: 'Taxable Value (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'cgst_amount', header: 'CGST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'sgst_amount', header: 'SGST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'igst_amount', header: 'IGST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_tax', header: 'Total Tax (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },
      {
        id: 'gst_hsn_wise',
        title: 'HSN-wise Summary',
        category: 'gst',
        description: 'Table 12 HSN outward supplies summary with UOM, quantities, and tax splits.',
        columns: [
          { key: 'hsn_code', header: 'HSN Code', width: 14 },
          { key: 'description', header: 'Description', width: 25 },
          { key: 'uom', header: 'UOM', width: 10 },
          { key: 'total_quantity', header: 'Quantity', width: 14, align: 'right' },
          { key: 'taxable_value', header: 'Taxable Value (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'gst_rate', header: 'Rate (%)', width: 10, align: 'right' },
          { key: 'total_cgst', header: 'CGST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_sgst', header: 'SGST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_igst', header: 'IGST (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_tax', header: 'Total Tax (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },

      // 5. PAYMENT
      {
        id: 'payment_collection',
        title: 'Payment Collection Register',
        category: 'payment',
        description: 'Individual settlement transactions logged by cashier, mode, and date.',
        columns: [
          { key: 'created_at', header: 'Date & Time', width: 18 },
          { key: 'invoice_number', header: 'Invoice #', width: 18, isLink: true },
          { key: 'customer_name', header: 'Customer', width: 20 },
          { key: 'payment_mode', header: 'Payment Mode', width: 16 },
          { key: 'amount', header: 'Amount (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'cashier_name', header: 'Collected By', width: 18 }
        ]
      },
      {
        id: 'payment_cash_reconciliation',
        title: 'Cash Reconciliation',
        category: 'payment',
        description: 'Shift-level cash drawer reconciliation comparing starting cash, collections, and drops.',
        columns: [
          { key: 'shift_id', header: 'Shift #', width: 12 },
          { key: 'cashier_name', header: 'Cashier', width: 18 },
          { key: 'login_time', header: 'Shift Start', width: 16 },
          { key: 'logout_time', header: 'Shift End', width: 16 },
          { key: 'starting_cash', header: 'Starting Cash (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'cash_collected', header: 'Cash Collected (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'expected_cash', header: 'Expected Cash (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'status', header: 'Shift Status', width: 14 }
        ]
      },

      // 6. CUSTOMER / PARTY
      {
        id: 'customer_outstanding',
        title: 'Customer Outstanding & Aging',
        category: 'customer',
        description: 'Customer credit ledger balances, unpaid amounts, and aging brackets.',
        columns: [
          { key: 'customer_name', header: 'Customer', width: 25, isLink: true },
          { key: 'phone', header: 'Phone', width: 16 },
          { key: 'gst_number', header: 'GSTIN', width: 18 },
          { key: 'total_invoiced', header: 'Total Invoiced (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'total_paid', header: 'Total Paid (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'balance_due', header: 'Outstanding Due (₹)', width: 18, align: 'right', isCurrency: true }
        ]
      },

      // 7. SUPPLIER
      {
        id: 'supplier_outstanding',
        title: 'Supplier Outstanding Payables',
        category: 'supplier',
        description: 'Vendor payable balances, total billed, amounts paid, and pending balance.',
        columns: [
          { key: 'supplier_name', header: 'Supplier', width: 25 },
          { key: 'phone', header: 'Contact', width: 16 },
          { key: 'gstin', header: 'GSTIN', width: 18 },
          { key: 'total_purchases', header: 'Total Billed (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'total_paid', header: 'Total Paid (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'balance_due', header: 'Payable Due (₹)', width: 18, align: 'right', isCurrency: true }
        ]
      },

      // 8. STAFF
      {
        id: 'staff_performance',
        title: 'Staff Performance Report',
        category: 'staff',
        description: 'Sales volumes, total bills generated, and discounts granted per staff user.',
        columns: [
          { key: 'user_name', header: 'Staff User', width: 22 },
          { key: 'role', header: 'Role', width: 14 },
          { key: 'bills_count', header: 'Bills Count', width: 12, align: 'right' },
          { key: 'total_sales', header: 'Total Sales (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'total_discounts', header: 'Discounts Given (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'avg_bill', header: 'Average Bill (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },

      // 9. BRANCH & WAREHOUSE
      {
        id: 'branch_performance',
        title: 'Branch / Store Performance',
        category: 'branch',
        description: 'Cross-store sales, invoices, and active register totals.',
        columns: [
          { key: 'branch_name', header: 'Store / Branch', width: 25 },
          { key: 'state', header: 'State', width: 16 },
          { key: 'bills_count', header: 'Bills Count', width: 14, align: 'right' },
          { key: 'total_sales', header: 'Total Sales (₹)', width: 18, align: 'right', isCurrency: true },
          { key: 'total_tax', header: 'Tax Collected (₹)', width: 16, align: 'right', isCurrency: true }
        ]
      },

      // 10. BUSINESS INTELLIGENCE
      {
        id: 'bi_profit_loss',
        title: 'Gross Profit & Margin (P&L)',
        category: 'bi',
        description: 'Net sales minus Cost of Goods Sold (COGS) to report gross profit and gross margin %.',
        columns: [
          { key: 'item_name', header: 'Product Name', width: 25 },
          { key: 'category_name', header: 'Category', width: 18 },
          { key: 'qty_sold', header: 'Qty Sold', width: 12, align: 'right' },
          { key: 'net_sales', header: 'Net Sales (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'cogs', header: 'Cost of Goods (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'gross_profit', header: 'Gross Profit (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'margin_pct', header: 'Margin %', width: 12, align: 'right' }
        ]
      },

      // 11. EXPENSES
      {
        id: 'expense_register',
        title: 'Expense Register',
        category: 'expense',
        description: 'Complete audit log of business expenses, tax breakdowns, and payment accounts.',
        columns: [
          { key: 'expense_number', header: 'Expense #', width: 18 },
          { key: 'expense_date', header: 'Date', width: 14 },
          { key: 'category_name', header: 'Category', width: 18 },
          { key: 'payee', header: 'Payee / Party', width: 20 },
          { key: 'payment_mode', header: 'Payment Mode', width: 14 },
          { key: 'account_name', header: 'Paid From Account', width: 20 },
          { key: 'taxable_amount', header: 'Taxable (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'tax_amount', header: 'Tax (₹)', width: 12, align: 'right', isCurrency: true },
          { key: 'total_amount', header: 'Total (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'status', header: 'Status', width: 12 }
        ]
      },
      {
        id: 'expense_category_wise',
        title: 'Category-wise Expenses',
        category: 'expense',
        description: 'Expenditure grouped by category/head with GST tax deduction analysis.',
        columns: [
          { key: 'category_name', header: 'Expense Head', width: 25 },
          { key: 'count', header: 'Entries Count', width: 14, align: 'right' },
          { key: 'taxable_amount', header: 'Taxable (₹)', width: 16, align: 'right', isCurrency: true },
          { key: 'tax_amount', header: 'GST Tax (₹)', width: 14, align: 'right', isCurrency: true },
          { key: 'total_amount', header: 'Total Spent (₹)', width: 18, align: 'right', isCurrency: true }
        ]
      }
    ];
  }

  /**
   * Run Authoritative Report Query
   */
  static async runReport(restaurantId, reportId, options = {}, user = {}) {
    const {
      preset = 'month',
      dateFrom = '',
      dateTo = '',
      page = 1,
      limit = 50,
      sortBy = '',
      sortOrder = 'DESC',
      search = '',
      branchId = null,
      warehouseId = null,
      categoryId = null,
      salesmanId = null,
      paymentMode = null
    } = options;

    const { from, to, label } = this.resolveDateRange(preset, dateFrom, dateTo);
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.min(500, Math.max(1, parseInt(limit) || 50));
    const offset = (parsedPage - 1) * parsedLimit;

    // Enforce Tenant Scoping: Superadmin can optionally filter by restaurantId, otherwise bound to user.restaurant_id
    const effectiveRestId = (user.role === 'super_admin' || user.role === 'superadmin') && branchId ? branchId : restaurantId;

    let rows = [];
    let totalCount = 0;
    let summary = {};

    switch (reportId) {
      // -------------------------------------------------------------
      // 1. SALES DAILY
      // -------------------------------------------------------------
      case 'sales_daily': {
        const [rawRows] = await pool.execute(`
          SELECT 
            DATE(o.created_at) as date,
            COUNT(o.id) as bills_count,
            COALESCE(SUM(o.subtotal), 0) as gross_sales,
            COALESCE(SUM(o.discount_amount), 0) as discounts,
            COALESCE(SUM(o.subtotal - o.discount_amount), 0) as taxable_sales,
            COALESCE(SUM(o.tax_amount), 0) as gst,
            COALESCE(SUM(o.total_amount), 0) as grand_total,
            COALESCE(AVG(o.total_amount), 0) as avg_bill_value
          FROM orders o
          WHERE o.restaurant_id = ?
            AND o.created_at >= ?
            AND o.created_at <= ?
            AND o.order_status = 'completed'
            AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL)
            AND (o.is_estimate = 0 OR o.is_estimate IS NULL)
          GROUP BY o.restaurant_id, DATE(o.created_at)
          ORDER BY date DESC
        `, [effectiveRestId, from, to]);

        const [returnRows] = await pool.execute(`
          SELECT 
            DATE(credit_note_date) as date,
            COALESCE(SUM(total_amount), 0) as returns
          FROM credit_notes
          WHERE restaurant_id = ?
            AND credit_note_date >= ?
            AND credit_note_date <= ?
            AND status = 'active'
          GROUP BY DATE(credit_note_date)
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        const returnMap = {};
        for (const ret of returnRows) {
          const dStr = formatLocalDate(ret.date);
          returnMap[dStr] = parseFloat(ret.returns || 0);
        }

        totalCount = rawRows.length;
        const paged = rawRows.slice(offset, offset + parsedLimit).map(r => {
          const dStr = formatLocalDate(r.date);
          const returns = returnMap[dStr] || 0;
          const gross = parseFloat(r.gross_sales || 0);
          const disc = parseFloat(r.discounts || 0);
          const net = Math.max(0, gross - disc - returns);
          const gst = parseFloat(r.gst || 0);
          const grand = Math.max(0, parseFloat(r.grand_total || 0) - returns);
          return {
            ...r,
            date: dStr,
            returns,
            gross_sales: gross,
            discounts: disc,
            net_sales: net,
            taxable_sales: net,
            gst,
            grand_total: grand,
            avg_bill_value: parseFloat(r.avg_bill_value || 0)
          };
        });
        rows = paged;

        // Aggregate summary
        summary = rawRows.reduce((acc, r) => {
          const dStr = formatLocalDate(r.date);
          const ret = returnMap[dStr] || 0;
          const gross = parseFloat(r.gross_sales || 0);
          const disc = parseFloat(r.discounts || 0);
          const net = Math.max(0, gross - disc - ret);
          const gst = parseFloat(r.gst || 0);
          const grand = Math.max(0, parseFloat(r.grand_total || 0) - ret);
          acc.totalBills += parseInt(r.bills_count || 0);
          acc.grossSales += gross;
          acc.discounts += disc;
          acc.returns += ret;
          acc.netSales += net;
          acc.taxableSales += net;
          acc.gst += gst;
          acc.grandTotal += grand;
          return acc;
        }, { totalBills: 0, grossSales: 0, discounts: 0, returns: 0, netSales: 0, taxableSales: 0, gst: 0, grandTotal: 0 });
        summary.avgBillValue = summary.totalBills > 0 ? summary.grandTotal / summary.totalBills : 0;
        break;
      }

      // -------------------------------------------------------------
      // 2. SALES REGISTER
      // -------------------------------------------------------------
      case 'sales_register': {
        let whereClause = `WHERE o.restaurant_id = ? AND o.created_at >= ? AND o.created_at <= ? AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL) AND (o.is_estimate = 0 OR o.is_estimate IS NULL)`;
        const params = [effectiveRestId, from, to];

        if (paymentMode && paymentMode !== 'all') {
          whereClause += ` AND o.payment_mode = ?`;
          params.push(paymentMode);
        }
        if (salesmanId && salesmanId !== 'all') {
          whereClause += ` AND (o.salesman_id = ? OR o.cashier_id = ?)`;
          params.push(salesmanId, salesmanId);
        }
        if (search && search.trim()) {
          whereClause += ` AND (o.unique_order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)`;
          params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
        }

        const [cntRows] = await pool.execute(`SELECT COUNT(o.id) as cnt, SUM(o.subtotal) as gross, SUM(o.discount_amount) as disc, SUM(o.tax_amount) as tax, SUM(o.total_amount) as total FROM orders o ${whereClause}`, params);
        totalCount = cntRows[0]?.cnt || 0;
        const regGross = parseFloat(cntRows[0]?.gross || 0);
        const regDisc = parseFloat(cntRows[0]?.disc || 0);
        const regGst = parseFloat(cntRows[0]?.tax || 0);
        const regTotal = parseFloat(cntRows[0]?.total || 0);
        summary = {
          totalOrders: totalCount,
          grossSales: regGross,
          discounts: regDisc,
          netSales: Math.max(0, regGross - regDisc),
          gstCollected: regGst,
          grandTotal: regTotal
        };

        const [dataRows] = await pool.execute(`
          SELECT 
            o.id as order_id,
            o.unique_order_number as invoice_number,
            DATE_FORMAT(o.created_at, '%Y-%m-%d %H:%i') as date,
            COALESCE(o.customer_name, 'Walking Customer') as customer_name,
            COALESCE(o.salesman_name, o.cashier_name, 'Admin') as salesman_name,
            (SELECT COUNT(oi.id) FROM order_items oi WHERE oi.order_id = o.id) as items_count,
            (o.subtotal - o.discount_amount) as taxable_value,
            o.tax_amount as gst,
            o.discount_amount as discount,
            o.total_amount,
            COALESCE(o.payment_mode, 'cash') as payment_mode,
            COALESCE(o.payment_status, 'completed') as payment_status,
            o.order_status as status
          FROM orders o
          ${whereClause}
          ORDER BY o.id DESC
          LIMIT ${parsedLimit} OFFSET ${offset}
        `, params);

        rows = dataRows;
        break;
      }

      // -------------------------------------------------------------
      // 3. ITEM-WISE SALES
      // -------------------------------------------------------------
      case 'sales_item_wise': {
        let whereClause = `WHERE o.restaurant_id = ? AND o.created_at >= ? AND o.created_at <= ? AND o.order_status = 'completed' AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL) AND (o.is_estimate = 0 OR o.is_estimate IS NULL)`;
        const params = [effectiveRestId, from, to];

        if (categoryId && categoryId !== 'all') {
          whereClause += ` AND mi.category_id = ?`;
          params.push(categoryId);
        }
        if (search && search.trim()) {
          whereClause += ` AND (oi.name LIKE ? OR mi.sku LIKE ?)`;
          params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }

        const [aggRows] = await pool.execute(`
          SELECT 
            oi.name as item_name,
            COALESCE(mi.sku, '-') as sku,
            COALESCE(c.name, 'General') as category_name,
            SUM(oi.quantity) as qty_sold,
            SUM(oi.price * oi.quantity) as gross_sales,
            SUM(oi.discount_amount) as discount,
            SUM(oi.tax_amount) as gst,
            SUM((oi.price * oi.quantity) - oi.discount_amount) as net_sales,
            AVG(oi.price) as avg_price
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
          LEFT JOIN categories c ON mi.category_id = c.id
          ${whereClause}
          GROUP BY oi.menu_item_id, oi.name, mi.sku, c.name
          ORDER BY qty_sold DESC
        `, params);

        totalCount = aggRows.length;
        rows = aggRows.slice(offset, offset + parsedLimit);
        summary = aggRows.reduce((acc, r) => {
          acc.totalQty += parseFloat(r.qty_sold || 0);
          acc.grossSales += parseFloat(r.gross_sales || 0);
          acc.discounts += parseFloat(r.discount || 0);
          acc.gst += parseFloat(r.gst || 0);
          acc.netSales += parseFloat(r.net_sales || 0);
          return acc;
        }, { totalQty: 0, grossSales: 0, discounts: 0, gst: 0, netSales: 0 });
        break;
      }

      // -------------------------------------------------------------
      // 4. CATEGORY-WISE SALES
      // -------------------------------------------------------------
      case 'sales_category_wise': {
        const [aggRows] = await pool.execute(`
          SELECT 
            COALESCE(c.name, 'Uncategorized') as category_name,
            SUM(oi.quantity) as total_quantity,
            SUM(oi.price * oi.quantity) as gross_sales,
            SUM(oi.discount_amount) as discount,
            SUM(oi.tax_amount) as gst,
            SUM((oi.price * oi.quantity) - oi.discount_amount) as net_sales,
            COUNT(DISTINCT o.id) as bills_count
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
          LEFT JOIN categories c ON mi.category_id = c.id
          WHERE o.restaurant_id = ?
            AND o.created_at >= ?
            AND o.created_at <= ?
            AND o.order_status = 'completed'
            AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL)
            AND (o.is_estimate = 0 OR o.is_estimate IS NULL)
          GROUP BY COALESCE(c.name, 'Uncategorized')
          ORDER BY gross_sales DESC
        `, [effectiveRestId, from, to]);

        totalCount = aggRows.length;
        rows = aggRows.slice(offset, offset + parsedLimit);
        summary = aggRows.reduce((acc, r) => {
          acc.totalQuantity += parseFloat(r.total_quantity || 0);
          acc.grossSales += parseFloat(r.gross_sales || 0);
          acc.netSales += parseFloat(r.net_sales || 0);
          acc.gst += parseFloat(r.gst || 0);
          return acc;
        }, { totalQuantity: 0, grossSales: 0, netSales: 0, gst: 0 });
        break;
      }

      // -------------------------------------------------------------
      // 5. HOUR-WISE SALES
      // -------------------------------------------------------------
      case 'sales_hour_wise': {
        const [rawRows] = await pool.execute(`
          SELECT 
            HOUR(created_at) as hour_num,
            COUNT(id) as bills_count,
            COALESCE(SUM(total_amount), 0) as total_sales,
            COALESCE(AVG(total_amount), 0) as avg_bill
          FROM orders
          WHERE restaurant_id = ?
            AND created_at >= ?
            AND created_at <= ?
            AND order_status = 'completed'
            AND (is_sales_order = 0 OR is_sales_order IS NULL)
            AND (is_estimate = 0 OR is_estimate IS NULL)
          GROUP BY HOUR(created_at)
          ORDER BY hour_num ASC
        `, [effectiveRestId, from, to]);

        totalCount = rawRows.length;
        rows = rawRows.map(r => {
          const h = parseInt(r.hour_num);
          const nextH = (h + 1) % 24;
          const formatHour = (val) => {
            const period = val >= 12 ? 'PM' : 'AM';
            const display = val % 12 === 0 ? 12 : val % 12;
            return `${display}:00 ${period}`;
          };
          return {
            ...r,
            hour_slot: `${formatHour(h)} - ${formatHour(nextH)}`,
            total_sales: parseFloat(r.total_sales || 0),
            avg_bill: parseFloat(r.avg_bill || 0)
          };
        });
        break;
      }

      // -------------------------------------------------------------
      // 6. PAYMENT-WISE SALES
      // -------------------------------------------------------------
      case 'sales_payment_wise': {
        const [rawRows] = await pool.execute(`
          SELECT 
            LOWER(COALESCE(payment_mode, 'cash')) as payment_mode,
            COUNT(id) as transaction_count,
            COALESCE(SUM(total_amount), 0) as total_amount
          FROM orders
          WHERE restaurant_id = ?
            AND created_at >= ?
            AND created_at <= ?
            AND order_status = 'completed'
            AND (is_sales_order = 0 OR is_sales_order IS NULL)
            AND (is_estimate = 0 OR is_estimate IS NULL)
          GROUP BY LOWER(COALESCE(payment_mode, 'cash'))
          ORDER BY total_amount DESC
        `, [effectiveRestId, from, to]);

        const grandTotal = rawRows.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);
        totalCount = rawRows.length;
        rows = rawRows.map(r => ({
          payment_mode: r.payment_mode.toUpperCase(),
          transaction_count: parseInt(r.transaction_count || 0),
          total_amount: parseFloat(r.total_amount || 0),
          percentage: grandTotal > 0 ? ((parseFloat(r.total_amount || 0) / grandTotal) * 100).toFixed(1) + '%' : '0%'
        }));
        summary = { grandTotal, totalTransactions: rawRows.reduce((sum, r) => sum + parseInt(r.transaction_count || 0), 0) };
        break;
      }

      // -------------------------------------------------------------
      // 7. SALESMAN-WISE SALES
      // -------------------------------------------------------------
      case 'sales_salesman_wise': {
        const [rawRows] = await pool.execute(`
          SELECT 
            COALESCE(salesman_name, cashier_name, 'Admin') as salesman_name,
            COUNT(id) as bills_count,
            COALESCE(SUM(subtotal), 0) as gross_sales,
            COALESCE(SUM(discount_amount), 0) as discounts,
            COALESCE(SUM(total_amount), 0) as net_sales,
            COALESCE(AVG(total_amount), 0) as avg_bill
          FROM orders
          WHERE restaurant_id = ?
            AND created_at >= ?
            AND created_at <= ?
            AND order_status = 'completed'
            AND (is_sales_order = 0 OR is_sales_order IS NULL)
            AND (is_estimate = 0 OR is_estimate IS NULL)
          GROUP BY COALESCE(salesman_name, cashier_name, 'Admin')
          ORDER BY net_sales DESC
        `, [effectiveRestId, from, to]);

        totalCount = rawRows.length;
        rows = rawRows.slice(offset, offset + parsedLimit);
        summary = rawRows.reduce((acc, r) => {
          acc.totalBills += parseInt(r.bills_count || 0);
          acc.netSales += parseFloat(r.net_sales || 0);
          acc.discounts += parseFloat(r.discounts || 0);
          return acc;
        }, { totalBills: 0, netSales: 0, discounts: 0 });
        break;
      }

      // -------------------------------------------------------------
      // 8. CUSTOMER-WISE SALES
      // -------------------------------------------------------------
      case 'sales_customer_wise': {
        const [rawRows] = await pool.execute(`
          SELECT 
            COALESCE(c.name, o.customer_name, 'Walking Consumer') as customer_name,
            COALESCE(c.phone, o.customer_phone, '-') as phone,
            COUNT(o.id) as bills_count,
            COALESCE(SUM(o.total_amount), 0) as total_sales,
            0.00 as total_returns,
            COALESCE(MAX(c.current_balance), 0) as outstanding
          FROM orders o
          LEFT JOIN customers c ON o.customer_id = c.id
          WHERE o.restaurant_id = ?
            AND o.created_at >= ?
            AND o.created_at <= ?
            AND o.order_status = 'completed'
            AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL)
            AND (o.is_estimate = 0 OR o.is_estimate IS NULL)
          GROUP BY COALESCE(c.name, o.customer_name, 'Walking Consumer'), COALESCE(c.phone, o.customer_phone, '-')
          ORDER BY total_sales DESC
        `, [effectiveRestId, from, to]);

        totalCount = rawRows.length;
        rows = rawRows.slice(offset, offset + parsedLimit);
        summary = {
          totalCustomers: totalCount,
          totalSales: rawRows.reduce((s, r) => s + parseFloat(r.total_sales || 0), 0)
        };
        break;
      }

      // -------------------------------------------------------------
      // 9. REVENUE REPORT
      // -------------------------------------------------------------
      case 'sales_revenue': {
        const [salesRows] = await pool.execute(`
          SELECT 
            DATE_FORMAT(created_at, '%Y-%m') as period,
            COALESCE(SUM(subtotal), 0) as gross_sales,
            COALESCE(SUM(discount_amount), 0) as discounts,
            COALESCE(SUM(tax_amount), 0) as gst_collected,
            COALESCE(SUM(subtotal - discount_amount), 0) as net_revenue
          FROM orders
          WHERE restaurant_id = ?
            AND created_at >= ?
            AND created_at <= ?
            AND order_status = 'completed'
            AND (is_sales_order = 0 OR is_sales_order IS NULL)
            AND (is_estimate = 0 OR is_estimate IS NULL)
          GROUP BY DATE_FORMAT(created_at, '%Y-%m')
          ORDER BY period DESC
        `, [effectiveRestId, from, to]);

        const [returnRows] = await pool.execute(`
          SELECT 
            DATE_FORMAT(credit_note_date, '%Y-%m') as period,
            COALESCE(SUM(total_amount), 0) as returns
          FROM credit_notes
          WHERE restaurant_id = ?
            AND credit_note_date >= ?
            AND credit_note_date <= ?
            AND status = 'active'
          GROUP BY DATE_FORMAT(credit_note_date, '%Y-%m')
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        const returnMap = {};
        for (const ret of returnRows) {
          returnMap[ret.period] = parseFloat(ret.returns || 0);
        }

        totalCount = salesRows.length;
        rows = salesRows.map(r => {
          const rets = returnMap[r.period] || 0;
          return {
            period: r.period,
            gross_sales: parseFloat(r.gross_sales || 0),
            discounts: parseFloat(r.discounts || 0),
            returns: rets,
            net_revenue: Math.max(0, parseFloat(r.net_revenue || 0) - rets),
            gst_collected: parseFloat(r.gst_collected || 0)
          };
        });

        summary = rows.reduce((acc, r) => {
          acc.grossRevenue += r.gross_sales;
          acc.discounts += r.discounts;
          acc.returns += r.returns;
          acc.netRevenue += r.net_revenue;
          acc.gstLiability += r.gst_collected;
          return acc;
        }, { grossRevenue: 0, discounts: 0, returns: 0, netRevenue: 0, gstLiability: 0 });
        break;
      }

      // -------------------------------------------------------------
      // 10. CURRENT STOCK
      // -------------------------------------------------------------
      case 'inventory_current_stock': {
        let whereClause = `WHERE mi.restaurant_id = ?`;
        const params = [effectiveRestId];

        if (categoryId && categoryId !== 'all') {
          whereClause += ` AND mi.category_id = ?`;
          params.push(categoryId);
        }
        if (search && search.trim()) {
          whereClause += ` AND (mi.name LIKE ? OR mi.sku LIKE ?)`;
          params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }

        const [stockRows] = await pool.execute(`
          SELECT 
            mi.name as item_name,
            COALESCE(mi.sku, '-') as sku,
            COALESCE(c.name, 'General') as category_name,
            COALESCE(w.name, 'Primary Warehouse') as warehouse_name,
            COALESCE(ws.current_stock, mi.current_stock, 0) as current_stock,
            COALESCE(mi.base_unit, 'PCS') as unit,
            COALESCE(mi.cost_price, mi.purchase_price, 0) as cost_price,
            (COALESCE(ws.current_stock, mi.current_stock, 0) * COALESCE(mi.cost_price, mi.purchase_price, 0)) as stock_value,
            COALESCE(mi.min_stock, mi.low_stock_threshold, 0) as min_stock
          FROM menu_items mi
          LEFT JOIN categories c ON mi.category_id = c.id
          LEFT JOIN warehouse_stocks ws ON ws.menu_item_id = mi.id
          LEFT JOIN warehouses w ON ws.warehouse_id = w.id
          ${whereClause}
          ORDER BY current_stock ASC
        `, params);

        totalCount = stockRows.length;
        rows = stockRows.slice(offset, offset + parsedLimit).map(r => {
          const cur = parseFloat(r.current_stock || 0);
          const min = parseFloat(r.min_stock || 0);
          let stock_status = 'Normal';
          if (cur <= 0) stock_status = 'Out of Stock';
          else if (min > 0 && cur <= min) stock_status = 'Low Stock';
          else if (min > 0 && cur >= min * 5) stock_status = 'Over Stock';

          return {
            ...r,
            current_stock: cur,
            cost_price: parseFloat(r.cost_price || 0),
            stock_value: parseFloat(r.stock_value || 0),
            stock_status
          };
        });

        summary = {
          totalSkus: totalCount,
          totalStockValue: stockRows.reduce((sum, r) => sum + (parseFloat(r.current_stock || 0) * parseFloat(r.cost_price || 0)), 0),
          lowStockCount: stockRows.filter(r => parseFloat(r.current_stock || 0) > 0 && parseFloat(r.current_stock || 0) <= parseFloat(r.min_stock || 0)).length,
          outOfStockCount: stockRows.filter(r => parseFloat(r.current_stock || 0) <= 0).length
        };
        break;
      }

      // -------------------------------------------------------------
      // 11. STOCK LEDGER
      // -------------------------------------------------------------
      case 'inventory_stock_ledger': {
        let whereClause = `WHERE st.restaurant_id = ? AND st.created_at >= ? AND st.created_at <= ?`;
        const params = [effectiveRestId, from, to];

        if (warehouseId && warehouseId !== 'all') {
          whereClause += ` AND st.warehouse_id = ?`;
          params.push(warehouseId);
        }
        if (search && search.trim()) {
          whereClause += ` AND (mi.name LIKE ? OR st.reference_number LIKE ?)`;
          params.push(`%${search.trim()}%`, `%${search.trim()}%`);
        }

        const [cnt] = await pool.execute(`
          SELECT COUNT(st.id) as cnt 
          FROM stock_transactions st 
          JOIN menu_items mi ON st.menu_item_id = mi.id 
          ${whereClause}
        `, params);
        totalCount = cnt[0]?.cnt || 0;

        const [ledgerRows] = await pool.execute(`
          SELECT 
            DATE_FORMAT(st.created_at, '%Y-%m-%d %H:%i') as created_at,
            mi.name as item_name,
            COALESCE(w.name, 'Main Warehouse') as warehouse_name,
            st.transaction_type,
            COALESCE(st.reference_number, '-') as reference_number,
            st.previous_stock,
            CASE WHEN st.quantity > 0 THEN st.quantity ELSE 0 END as qty_in,
            CASE WHEN st.quantity < 0 THEN ABS(st.quantity) ELSE 0 END as qty_out,
            st.new_stock,
            COALESCE(st.user_name, 'System') as user_name
          FROM stock_transactions st
          JOIN menu_items mi ON st.menu_item_id = mi.id
          LEFT JOIN warehouses w ON st.warehouse_id = w.id
          ${whereClause}
          ORDER BY st.id DESC
          LIMIT ${parsedLimit} OFFSET ${offset}
        `, params);

        rows = ledgerRows;
        summary = { totalMovements: totalCount };
        break;
      }

      // -------------------------------------------------------------
      // 12. PURCHASE REGISTER
      // -------------------------------------------------------------
      case 'purchase_register': {
        const [cnt] = await pool.execute(`
          SELECT COUNT(id) as cnt, SUM(subtotal) as taxable, SUM(tax_amount) as tax, SUM(total_amount) as total 
          FROM purchase_bills 
          WHERE restaurant_id = ? AND bill_date >= ? AND bill_date <= ?
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        totalCount = cnt[0]?.cnt || 0;
        summary = {
          totalBills: totalCount,
          taxableAmount: parseFloat(cnt[0]?.taxable || 0),
          gstAmount: parseFloat(cnt[0]?.tax || 0),
          totalAmount: parseFloat(cnt[0]?.total || 0)
        };

        const [bills] = await pool.execute(`
          SELECT 
            pb.bill_number,
            pb.bill_date,
            COALESCE(s.name, 'Supplier') as supplier_name,
            (pb.subtotal - pb.discount_amount) as taxable_amount,
            pb.tax_amount as gst_amount,
            pb.total_amount,
            pb.paid_amount,
            pb.status,
            pb.payment_status
          FROM purchase_bills pb
          LEFT JOIN suppliers s ON pb.supplier_id = s.id
          WHERE pb.restaurant_id = ?
            AND pb.bill_date >= ?
            AND pb.bill_date <= ?
          ORDER BY pb.id DESC
          LIMIT ${parsedLimit} OFFSET ${offset}
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        rows = bills;
        break;
      }

      // -------------------------------------------------------------
      // 13. GST SUMMARY
      // -------------------------------------------------------------
      case 'gst_summary': {
        const [salesRows] = await pool.execute(`
          SELECT 
            COALESCE(SUM(subtotal - discount_amount), 0) as taxable_sales,
            COALESCE(SUM(cgst_amount), 0) as cgst,
            COALESCE(SUM(sgst_amount), 0) as sgst,
            COALESCE(SUM(igst_amount), 0) as igst,
            COALESCE(SUM(tax_amount), 0) as total_tax
          FROM orders
          WHERE restaurant_id = ?
            AND created_at >= ?
            AND created_at <= ?
            AND order_status = 'completed'
            AND (is_sales_order = 0 OR is_sales_order IS NULL)
            AND (is_estimate = 0 OR is_estimate IS NULL)
        `, [effectiveRestId, from, to]);

        const [purchaseRows] = await pool.execute(`
          SELECT 
            COALESCE(SUM(subtotal - discount_amount), 0) as taxable_purchases,
            COALESCE(SUM(cgst_amount), 0) as cgst,
            COALESCE(SUM(sgst_amount), 0) as sgst,
            COALESCE(SUM(igst_amount), 0) as igst,
            COALESCE(SUM(tax_amount), 0) as total_tax
          FROM purchase_bills
          WHERE restaurant_id = ?
            AND bill_date >= ?
            AND bill_date <= ?
            AND status = 'received'
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        const [cnRows] = await pool.execute(`
          SELECT 
            COALESCE(SUM(subtotal), 0) as taxable_returns,
            COALESCE(SUM(cgst_amount), 0) as cgst,
            COALESCE(SUM(sgst_amount), 0) as sgst,
            COALESCE(SUM(igst_amount), 0) as igst,
            COALESCE(SUM(total_tax), 0) as total_tax
          FROM credit_notes
          WHERE restaurant_id = ?
            AND credit_note_date >= ?
            AND credit_note_date <= ?
            AND status = 'active'
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        const s = salesRows[0] || {};
        const p = purchaseRows[0] || {};
        const c = cnRows[0] || {};

        rows = [
          {
            tax_head: 'Outward Supplies (Sales Tax)',
            taxable_value: parseFloat(s.taxable_sales || 0),
            cgst: parseFloat(s.cgst || 0),
            sgst: parseFloat(s.sgst || 0),
            igst: parseFloat(s.igst || 0),
            total_tax: parseFloat(s.total_tax || 0)
          },
          {
            tax_head: 'Less: Sales Returns (Credit Notes)',
            taxable_value: -parseFloat(c.taxable_returns || 0),
            cgst: -parseFloat(c.cgst || 0),
            sgst: -parseFloat(c.sgst || 0),
            igst: -parseFloat(c.igst || 0),
            total_tax: -parseFloat(c.total_tax || 0)
          },
          {
            tax_head: 'Inward Supplies (Input Tax Credit / ITC)',
            taxable_value: parseFloat(p.taxable_purchases || 0),
            cgst: parseFloat(p.cgst || 0),
            sgst: parseFloat(p.sgst || 0),
            igst: parseFloat(p.igst || 0),
            total_tax: parseFloat(p.total_tax || 0)
          }
        ];
        totalCount = rows.length;

        const netPayable = Math.max(0, (parseFloat(s.total_tax || 0) - parseFloat(c.total_tax || 0)) - parseFloat(p.total_tax || 0));
        summary = {
          netOutputGst: parseFloat(s.total_tax || 0) - parseFloat(c.total_tax || 0),
          inputTaxCredit: parseFloat(p.total_tax || 0),
          netGstPayable: netPayable
        };
        break;
      }

      // -------------------------------------------------------------
      // 14. GROSS PROFIT & LOSS (BI)
      // -------------------------------------------------------------
      case 'bi_profit_loss': {
        const [plRows] = await pool.execute(`
          SELECT 
            oi.name as item_name,
            COALESCE(c.name, 'General') as category_name,
            SUM(oi.quantity) as qty_sold,
            SUM((oi.price * oi.quantity) - oi.discount_amount) as net_sales,
            SUM(oi.quantity * COALESCE(mi.cost_price, 0)) as cogs,
            (SUM((oi.price * oi.quantity) - oi.discount_amount) - SUM(oi.quantity * COALESCE(mi.cost_price, 0))) as gross_profit
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
          LEFT JOIN categories c ON mi.category_id = c.id
          WHERE o.restaurant_id = ?
            AND o.created_at >= ?
            AND o.created_at <= ?
            AND o.order_status = 'completed'
          GROUP BY oi.menu_item_id, oi.name, c.name
          ORDER BY gross_profit DESC
        `, [effectiveRestId, from, to]);

        totalCount = plRows.length;
        rows = plRows.slice(offset, offset + parsedLimit).map(r => {
          const sales = parseFloat(r.net_sales || 0);
          const profit = parseFloat(r.gross_profit || 0);
          const margin = sales > 0 ? ((profit / sales) * 100).toFixed(1) + '%' : '0%';
          return {
            ...r,
            qty_sold: parseFloat(r.qty_sold || 0),
            net_sales: sales,
            cogs: parseFloat(r.cogs || 0),
            gross_profit: profit,
            margin_pct: margin
          };
        });

        const totalSales = plRows.reduce((sum, r) => sum + parseFloat(r.net_sales || 0), 0);
        const totalCogs = plRows.reduce((sum, r) => sum + parseFloat(r.cogs || 0), 0);
        const totalProfit = totalSales - totalCogs;

        // Query operating expenses for P&L net profit
        const [expRows] = await pool.execute(`
          SELECT COALESCE(SUM(total_amount), 0) AS total_expenses
          FROM expenses
          WHERE restaurant_id = ? AND expense_date >= ? AND expense_date <= ? AND status != 'CANCELLED'
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);
        const totalOperatingExpenses = parseFloat(expRows[0]?.total_expenses || 0);
        const netProfit = totalProfit - totalOperatingExpenses;

        summary = {
          netRevenue: totalSales,
          costOfGoodsSold: totalCogs,
          grossProfit: totalProfit,
          operatingExpenses: totalOperatingExpenses,
          netProfit: netProfit,
          overallMargin: totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(1) + '%' : '0%'
        };
        break;
      }

      // -------------------------------------------------------------
      // 11. EXPENSES
      // -------------------------------------------------------------
      case 'expense_register': {
        const [expRows] = await pool.execute(`
          SELECT 
            e.expense_number,
            DATE_FORMAT(e.expense_date, '%Y-%m-%d') as expense_date,
            COALESCE(ec.name, e.category, 'General') as category_name,
            COALESCE(e.payee, e.employee_name, s.name, '—') as payee,
            UPPER(e.payment_mode) as payment_mode,
            COALESCE(fa.account_name, 'Cash Account') as account_name,
            e.taxable_amount,
            e.tax_amount,
            e.total_amount,
            e.status
          FROM expenses e
          LEFT JOIN expense_categories ec ON e.category_id = ec.id
          LEFT JOIN financial_accounts fa ON e.account_id = fa.id
          LEFT JOIN suppliers s ON e.supplier_id = s.id
          WHERE e.restaurant_id = ?
            AND e.expense_date >= ?
            AND e.expense_date <= ?
          ORDER BY e.expense_date DESC, e.id DESC
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        totalCount = expRows.length;
        rows = expRows.slice(offset, offset + parsedLimit).map(r => ({
          ...r,
          taxable_amount: parseFloat(r.taxable_amount || 0),
          tax_amount: parseFloat(r.tax_amount || 0),
          total_amount: parseFloat(r.total_amount || 0)
        }));

        const totalSpent = expRows.filter(r => r.status !== 'CANCELLED').reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);
        const totalTax = expRows.filter(r => r.status !== 'CANCELLED').reduce((sum, r) => sum + parseFloat(r.tax_amount || 0), 0);
        summary = {
          totalEntries: totalCount,
          totalExpenses: totalSpent,
          totalTax: totalTax
        };
        break;
      }

      case 'expense_category_wise': {
        const [catRows] = await pool.execute(`
          SELECT 
            COALESCE(ec.name, e.category, 'General') as category_name,
            COUNT(e.id) as count,
            COALESCE(SUM(e.taxable_amount), 0) as taxable_amount,
            COALESCE(SUM(e.tax_amount), 0) as tax_amount,
            COALESCE(SUM(e.total_amount), 0) as total_amount
          FROM expenses e
          LEFT JOIN expense_categories ec ON e.category_id = ec.id
          WHERE e.restaurant_id = ?
            AND e.expense_date >= ?
            AND e.expense_date <= ?
            AND e.status != 'CANCELLED'
          GROUP BY category_name
          ORDER BY total_amount DESC
        `, [effectiveRestId, from.slice(0, 10), to.slice(0, 10)]);

        totalCount = catRows.length;
        rows = catRows.slice(offset, offset + parsedLimit).map(r => ({
          ...r,
          count: parseInt(r.count || 0, 10),
          taxable_amount: parseFloat(r.taxable_amount || 0),
          tax_amount: parseFloat(r.tax_amount || 0),
          total_amount: parseFloat(r.total_amount || 0)
        }));

        const totalSpent = catRows.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0);
        const totalTax = catRows.reduce((sum, r) => sum + parseFloat(r.tax_amount || 0), 0);
        summary = {
          categoriesCount: totalCount,
          totalExpenses: totalSpent,
          totalTax: totalTax
        };
        break;
      }

      // -------------------------------------------------------------
      // DEFAULT FALLBACK: Generic safe query
      // -------------------------------------------------------------
      default: {
        const [defaultOrders] = await pool.execute(`
          SELECT 
            unique_order_number as invoice_number,
            created_at as date,
            customer_name,
            total_amount
          FROM orders
          WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ?
          ORDER BY id DESC LIMIT 50
        `, [effectiveRestId, from, to]);
        rows = defaultOrders;
        totalCount = defaultOrders.length;
        summary = { message: 'Loaded default transaction set' };
      }
    }

    return {
      reportId,
      dateRange: { from, to, label, preset },
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        totalCount,
        totalPages: Math.ceil(totalCount / parsedLimit) || 1
      },
      summary,
      rows
    };
  }

  /**
   * Export Report to Excel (.xlsx) or CSV
   */
  static async exportReport(restaurantId, reportId, format = 'excel', options = {}, user = {}) {
    // Fetch all rows for export (max 5000 rows for safe memory usage)
    const exportOpts = { ...options, page: 1, limit: 5000 };
    const reportResult = await this.runReport(restaurantId, reportId, exportOpts, user);

    const catalog = this.getCatalog();
    const def = catalog.find(c => c.id === reportId) || {
      title: reportId.replace(/_/g, ' ').toUpperCase(),
      columns: Object.keys(reportResult.rows[0] || {}).map(k => ({ key: k, header: k, width: 16 }))
    };

    if (format === 'csv') {
      const headers = def.columns.map(c => `"${c.header}"`).join(',');
      const lines = reportResult.rows.map(row => {
        return def.columns.map(c => {
          const val = row[c.key] !== undefined && row[c.key] !== null ? String(row[c.key]).replace(/"/g, '""') : '';
          return `"${val}"`;
        }).join(',');
      });
      return {
        contentType: 'text/csv',
        filename: `${reportId}_${getISTDateString()}.csv`,
        buffer: Buffer.from([headers, ...lines].join('\n'))
      };
    }

    // Generate Styled ExcelJS Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Ariso Retail Reports Engine';
    workbook.created = new Date();

    const ws = workbook.addWorksheet(def.title.slice(0, 31));

    // 1. Report Title Header Banner
    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `ARISO RETAIL — ${def.title.toUpperCase()}`;
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // 2. Metadata Block
    ws.getCell('A2').value = `Period: ${reportResult.dateRange.label} (${reportResult.dateRange.from.slice(0, 10)} to ${reportResult.dateRange.to.slice(0, 10)})`;
    ws.getCell('A2').font = { italic: true, size: 10, color: { argb: '475569' } };
    ws.getRow(2).height = 20;

    // 3. Columns Setup
    const headerRowIdx = 4;
    const headerRow = ws.getRow(headerRowIdx);
    def.columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
      ws.getColumn(idx + 1).width = Math.max(col.width || 16, 12);
    });
    headerRow.height = 24;

    // 4. Data Rows with Zebra Striping
    reportResult.rows.forEach((item, rIdx) => {
      const row = ws.getRow(headerRowIdx + 1 + rIdx);
      def.columns.forEach((col, cIdx) => {
        const cell = row.getCell(cIdx + 1);
        let val = item[col.key];
        if (col.isCurrency && val !== undefined && val !== null) {
          val = parseFloat(val);
        }
        cell.value = val !== undefined && val !== null ? val : '-';
        cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
      });
      row.height = 20;

      if (rIdx % 2 === 1) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${reportId}_${reportResult.dateRange.from.slice(0, 10)}_to_${reportResult.dateRange.to.slice(0, 10)}.xlsx`,
      buffer
    };
  }

  /**
   * Central Business Intelligence Dashboard Metrics
   */
  static async getBiDashboard(restaurantId, queryFrom, queryTo) {
    const todayStr = getISTDateString();
    const todayPattern = `${todayStr}%`;

    // 1. Today's quick numbers
    const [todayRows] = await pool.execute(`
      SELECT 
        COUNT(id) as today_bills,
        COALESCE(SUM(total_amount), 0) as today_sales,
        COALESCE(SUM(discount_amount), 0) as today_discounts,
        COALESCE(SUM(tax_amount), 0) as today_tax
      FROM orders
      WHERE restaurant_id = ? AND created_at LIKE ? AND order_status = 'completed' AND (is_sales_order = 0 OR is_sales_order IS NULL) AND (is_estimate = 0 OR is_estimate IS NULL)
    `, [restaurantId, todayPattern]);

    // 2. Month-to-date numbers
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()} 23:59:59`;

    const [monthRows] = await pool.execute(`
      SELECT 
        COUNT(id) as month_bills,
        COALESCE(SUM(total_amount), 0) as month_sales,
        COALESCE(SUM(subtotal - discount_amount), 0) as month_revenue,
        COALESCE(AVG(total_amount), 0) as avg_bill
      FROM orders
      WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status = 'completed' AND (is_sales_order = 0 OR is_sales_order IS NULL) AND (is_estimate = 0 OR is_estimate IS NULL)
    `, [restaurantId, monthStart, monthEnd]);

    // 3. Top 5 Items
    const [topItems] = await pool.execute(`
      SELECT oi.name, SUM(oi.quantity) as qty_sold, SUM(oi.price * oi.quantity) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.restaurant_id = ? AND o.created_at >= ? AND o.created_at <= ? AND o.order_status = 'completed' AND (o.is_sales_order = 0 OR o.is_sales_order IS NULL) AND (o.is_estimate = 0 OR o.is_estimate IS NULL)
      GROUP BY oi.menu_item_id, oi.name
      ORDER BY qty_sold DESC
      LIMIT 5
    `, [restaurantId, monthStart, monthEnd]);

    // 4. Low stock count
    const [lowStock] = await pool.execute(`
      SELECT COUNT(id) as low_count 
      FROM menu_items 
      WHERE restaurant_id = ? AND min_stock > 0 AND current_stock <= min_stock
    `, [restaurantId]);

    // 5. Payment mode split
    const [payments] = await pool.execute(`
      SELECT LOWER(COALESCE(payment_mode, 'cash')) as mode, COUNT(id) as cnt, SUM(total_amount) as amt
      FROM orders
      WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status = 'completed' AND (is_sales_order = 0 OR is_sales_order IS NULL) AND (is_estimate = 0 OR is_estimate IS NULL)
      GROUP BY LOWER(COALESCE(payment_mode, 'cash'))
    `, [restaurantId, monthStart, monthEnd]);

    return {
      today: {
        bills: parseInt(todayRows[0]?.today_bills || 0),
        sales: parseFloat(todayRows[0]?.today_sales || 0),
        discounts: parseFloat(todayRows[0]?.today_discounts || 0),
        tax: parseFloat(todayRows[0]?.today_tax || 0)
      },
      monthToDate: {
        bills: parseInt(monthRows[0]?.month_bills || 0),
        sales: parseFloat(monthRows[0]?.month_sales || 0),
        revenue: parseFloat(monthRows[0]?.month_revenue || 0),
        avgBill: parseFloat(monthRows[0]?.avg_bill || 0)
      },
      topSellingItems: topItems,
      lowStockCount: parseInt(lowStock[0]?.low_count || 0),
      paymentSplit: payments
    };
  }

  /**
   * Daily Sales Closing (DSR) end-of-day summary
   */
  static async getDailySalesClosing(restaurantId, targetDate = '') {
    const dStr = targetDate && targetDate.trim().length === 10 ? targetDate.trim() : getISTDateString();
    const dateFrom = `${dStr} 00:00:00`;
    const dateTo = `${dStr} 23:59:59`;

    const [orderSum] = await pool.execute(`
      SELECT 
        COUNT(id) as total_bills,
        COALESCE(SUM(subtotal), 0) as gross_sales,
        COALESCE(SUM(discount_amount), 0) as discounts,
        COALESCE(SUM(tax_amount), 0) as gst,
        COALESCE(SUM(total_amount), 0) as grand_total,
        COALESCE(AVG(total_amount), 0) as avg_bill
      FROM orders
      WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status = 'completed' AND (is_sales_order = 0 OR is_sales_order IS NULL) AND (is_estimate = 0 OR is_estimate IS NULL)
    `, [restaurantId, dateFrom, dateTo]);

    const [cancelledSum] = await pool.execute(`
      SELECT COUNT(id) as void_count, COALESCE(SUM(total_amount), 0) as void_amount
      FROM orders
      WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status = 'cancelled'
    `, [restaurantId, dateFrom, dateTo]);

    const [returnsSum] = await pool.execute(`
      SELECT COUNT(id) as return_count, COALESCE(SUM(total_amount), 0) as return_amount
      FROM credit_notes
      WHERE restaurant_id = ? AND credit_note_date = ? AND status = 'active'
    `, [restaurantId, dStr]);

    const [paymentSplit] = await pool.execute(`
      SELECT LOWER(COALESCE(payment_mode, 'cash')) as mode, COUNT(id) as cnt, SUM(total_amount) as total
      FROM orders
      WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status = 'completed' AND (is_sales_order = 0 OR is_sales_order IS NULL) AND (is_estimate = 0 OR is_estimate IS NULL)
      GROUP BY LOWER(COALESCE(payment_mode, 'cash'))
    `, [restaurantId, dateFrom, dateTo]);

    const gross = parseFloat(orderSum[0]?.gross_sales || 0);
    const discounts = parseFloat(orderSum[0]?.discounts || 0);
    const returns = parseFloat(returnsSum[0]?.return_amount || 0);
    const gst = parseFloat(orderSum[0]?.gst || 0);
    const grandTotal = parseFloat(orderSum[0]?.grand_total || 0);
    const netSales = Math.max(0, gross - discounts - returns);

    return {
      date: dStr,
      metrics: {
        totalBills: parseInt(orderSum[0]?.total_bills || 0),
        grossSales: gross,
        discounts: discounts,
        returns: returns,
        netSales: netSales,
        taxableSales: netSales,
        gstCollected: gst,
        grandTotal: grandTotal,
        avgBill: parseFloat(orderSum[0]?.avg_bill || 0),
        voidBillsCount: parseInt(cancelledSum[0]?.void_count || 0),
        voidBillsAmount: parseFloat(cancelledSum[0]?.void_amount || 0)
      },
      payments: paymentSplit
    };
  }

  /**
   * Yearly Financial Rollup (Month-by-month for 1 April - 31 March)
   */
  static async getYearlySalesRollup(restaurantId, year = null) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const baseYear = year ? parseInt(year) : (currentMonth >= 3 ? now.getFullYear() : now.getFullYear() - 1);

    const fromDate = `${baseYear}-04-01 00:00:00`;
    const toDate = `${baseYear + 1}-03-31 23:59:59`;

    const [months] = await pool.execute(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month_key,
        COUNT(id) as bills_count,
        COALESCE(SUM(subtotal), 0) as gross_sales,
        COALESCE(SUM(discount_amount), 0) as discounts,
        COALESCE(SUM(tax_amount), 0) as gst,
        COALESCE(SUM(total_amount), 0) as grand_total,
        COALESCE(SUM(subtotal - discount_amount), 0) as net_revenue
      FROM orders
      WHERE restaurant_id = ? AND created_at >= ? AND created_at <= ? AND order_status = 'completed'
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY month_key ASC
    `, [restaurantId, fromDate, toDate]);

    return {
      financialYear: `${baseYear}-${String(baseYear + 1).slice(-2)}`,
      dateRange: { from: fromDate, to: toDate },
      months
    };
  }

  /**
   * Run Dynamic Custom Report with Controlled Parameters (No raw arbitrary SQL)
   */
  static async runCustomReport(restaurantId, config = {}) {
    const {
      dataSource = 'sales',
      selectedFields = ['unique_order_number', 'created_at', 'total_amount'],
      dateFrom = '',
      dateTo = '',
      groupBy = '',
      sortBy = 'id',
      sortOrder = 'DESC',
      limit = 100
    } = config;

    const { from, to } = this.resolveDateRange('custom', dateFrom, dateTo);

    // Whitelist allowed fields per dataSource to prevent any SQL injection
    const fieldWhitelist = {
      sales: {
        id: 'o.id',
        order_number: 'o.unique_order_number',
        date: 'o.created_at',
        customer: 'o.customer_name',
        salesman: 'o.salesman_name',
        payment_mode: 'o.payment_mode',
        subtotal: 'o.subtotal',
        tax: 'o.tax_amount',
        discount: 'o.discount_amount',
        total: 'o.total_amount'
      },
      purchase: {
        id: 'pb.id',
        bill_number: 'pb.bill_number',
        date: 'pb.bill_date',
        supplier: 's.name',
        taxable: 'pb.subtotal',
        tax: 'pb.tax_amount',
        total: 'pb.total_amount',
        paid: 'pb.paid_amount'
      },
      inventory: {
        id: 'mi.id',
        name: 'mi.name',
        sku: 'mi.sku',
        category: 'c.name',
        stock: 'mi.stock_quantity',
        cost: 'mi.cost_price',
        min_stock: 'mi.min_stock_level'
      }
    };

    const allowed = fieldWhitelist[dataSource] || fieldWhitelist.sales;
    const selectCols = [];

    for (const key of selectedFields) {
      if (allowed[key]) {
        selectCols.push(`${allowed[key]} as ${key}`);
      }
    }

    if (selectCols.length === 0) {
      selectCols.push('o.id', 'o.unique_order_number as order_number', 'o.total_amount as total');
    }

    let sql = '';
    const params = [restaurantId];

    if (dataSource === 'purchase') {
      sql = `
        SELECT ${selectCols.join(', ')}
        FROM purchase_bills pb
        LEFT JOIN suppliers s ON pb.supplier_id = s.id
        WHERE pb.restaurant_id = ? AND pb.bill_date >= ? AND pb.bill_date <= ?
        ORDER BY pb.id DESC LIMIT ${Math.min(500, parseInt(limit) || 100)}
      `;
      params.push(from.slice(0, 10), to.slice(0, 10));
    } else if (dataSource === 'inventory') {
      sql = `
        SELECT ${selectCols.join(', ')}
        FROM menu_items mi
        LEFT JOIN categories c ON mi.category_id = c.id
        WHERE mi.restaurant_id = ?
        ORDER BY mi.id DESC LIMIT ${Math.min(500, parseInt(limit) || 100)}
      `;
    } else {
      sql = `
        SELECT ${selectCols.join(', ')}
        FROM orders o
        WHERE o.restaurant_id = ? AND o.created_at >= ? AND o.created_at <= ? AND o.order_status = 'completed'
        ORDER BY o.id DESC LIMIT ${Math.min(500, parseInt(limit) || 100)}
      `;
      params.push(from, to);
    }

    const [rows] = await pool.execute(sql, params);
    return {
      dataSource,
      selectedFields,
      rowCount: rows.length,
      rows
    };
  }
}

module.exports = ReportsEngine;
