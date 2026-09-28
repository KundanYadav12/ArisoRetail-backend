/**
 * Centralized Permission Definitions & Default Roles Configuration
 * Aligned with Ariso Retail RBAC architecture.
 */

const DEFAULT_WAREHOUSE_MANAGER_PERMISSIONS = [
  'inventory',
  'warehouse_dashboard',
  'inventory_catalog',
  'warehouses',
  'rack_management',
  'stock_transfer',
  'stock_receiving',
  'stock_count',
  'stock_adjustment',
  'stock_requests',
  'stock_ledger',
  'warehouse_reports',
  'suppliers',
  'item_sales_report',
  'sales_orders',
  'customers'
];

const ROLE_DEFAULT_PERMISSIONS = {
  admin: [
    'all',
    'pos_billing', 'order_history', 'sales_orders', 'customers',
    'menu_items', 'categories', 'inventory', 'warehouse_dashboard', 'inventory_catalog',
    'warehouses', 'rack_management', 'stock_transfer', 'stock_receiving', 'stock_count',
    'stock_adjustment', 'stock_requests', 'stock_ledger', 'warehouse_reports',
    'reports', 'item_sales_report', 'bank_accounts', 'expenses', 'day_end',
    'payment_reconciliation', 'suppliers', 'printers', 'gst', 'settings', 'profile', 'staff'
  ],
  manager: [
    'pos_billing', 'order_history', 'sales_orders', 'customers',
    'menu_items', 'categories', 'inventory', 'warehouse_dashboard', 'inventory_catalog',
    'warehouses', 'rack_management', 'stock_transfer', 'stock_receiving', 'stock_count',
    'stock_adjustment', 'stock_requests', 'stock_ledger', 'warehouse_reports',
    'reports', 'item_sales_report', 'bank_accounts', 'expenses', 'day_end',
    'payment_reconciliation', 'suppliers', 'printers', 'gst', 'settings'
  ],
  cashier: [
    'pos_billing', 'order_history', 'day_end', 'customers'
  ],
  salesman: [
    'pos_billing', 'sales_orders', 'customers', 'inventory', 'order_history'
  ],
  warehouse_manager: DEFAULT_WAREHOUSE_MANAGER_PERMISSIONS
};

const ALL_SYSTEM_PERMISSIONS = [
  // 1. SALES & POS
  {
    key: 'pos_billing',
    label: 'POS Billing & Checkout',
    category: 'Sales & POS',
    description: 'Counter POS terminal, cart billing, customer checkout, and cash drawer'
  },
  {
    key: 'order_history',
    label: 'Order History & Receipts',
    category: 'Sales & POS',
    description: 'View past receipts, reprints, kitchen status, and invoice history'
  },
  {
    key: 'sales_orders',
    label: 'Sales Orders & Estimates',
    category: 'Sales & POS',
    description: 'Create and manage commercial sales orders, estimates, and delivery challans'
  },
  {
    key: 'customers',
    label: 'Customers & Parties Directory',
    category: 'Sales & POS',
    description: 'Customer contact directory, party ledger statements, and credit balances'
  },

  // 2. CATALOG & STORE ADMINISTRATION
  {
    key: 'menu_items',
    label: 'Menu Items & Products',
    category: 'Catalog & Store Setup',
    description: 'Manage products, selling prices, tax slabs, barcode labels, and food items'
  },
  {
    key: 'categories',
    label: 'Categories Management',
    category: 'Catalog & Store Setup',
    description: 'Manage product categories, hierarchies, and display groupings'
  },
  {
    key: 'printers',
    label: 'Printers & Print Routing',
    category: 'Catalog & Store Setup',
    description: 'Configure network printers, thermal ESC/POS, and kitchen routing'
  },
  {
    key: 'gst',
    label: 'GST & Compliance Suite',
    category: 'Catalog & Store Setup',
    description: 'GSTR-1, GSTR-3B tax summaries, HSN/SAC breakdowns, and tax rates'
  },
  {
    key: 'settings',
    label: 'Receipt & GST Settings',
    category: 'Catalog & Store Setup',
    description: 'Store invoice headers, footer notes, terms, round-off, and numbering sequences'
  },
  {
    key: 'profile',
    label: 'Retail Store Profile',
    category: 'Catalog & Store Setup',
    description: 'Store business address, GSTIN, phone, currency, and company details'
  },
  {
    key: 'staff',
    label: 'Staff & Cashiers Management',
    category: 'Catalog & Store Setup',
    description: 'Manage staff user accounts, assigned stores/godowns, and access control'
  },

  // 3. REPORTS & BUSINESS INTELLIGENCE
  {
    key: 'reports',
    label: 'Reports & Business Intelligence',
    category: 'Reports & Analytics',
    description: 'Sales summaries, category breakdown, tax reports, and business KPIs'
  },
  {
    key: 'item_sales_report',
    label: 'Item Sales Report & Analytics',
    category: 'Reports & Analytics',
    description: 'Item-wise velocity, revenue contribution, and product sales insights'
  },

  // 4. INVENTORY & WAREHOUSES
  {
    key: 'inventory',
    label: 'Inventory & Warehouses (Core)',
    category: 'Inventory & Warehouse Operations',
    description: 'Main inventory portal, stock management, and multi-location tracking'
  },
  {
    key: 'warehouse_dashboard',
    label: 'Warehouse Dashboard & Metrics',
    category: 'Inventory & Warehouse Operations',
    description: 'Executive inventory valuation, low stock alerts, and warehouse KPIs'
  },
  {
    key: 'inventory_catalog',
    label: 'Stock Catalog & Levels',
    category: 'Inventory & Warehouse Operations',
    description: 'View and search stock levels, SKU items, categories, and barcode numbers'
  },
  {
    key: 'warehouses',
    label: 'Warehouses & Godowns List',
    category: 'Inventory & Warehouse Operations',
    description: 'View warehouses/godowns, locations, and localized stock numbers'
  },
  {
    key: 'rack_management',
    label: 'Rack / Bin Management',
    category: 'Inventory & Warehouse Operations',
    description: 'Manage warehouse racks, shelves, bins, and exact item location mappings'
  },
  {
    key: 'stock_transfer',
    label: 'Stock Transfer',
    category: 'Inventory & Warehouse Operations',
    description: 'Create and dispatch stock transfers between warehouses and branches'
  },
  {
    key: 'stock_receiving',
    label: 'Stock Receiving & GRN',
    category: 'Inventory & Warehouse Operations',
    description: 'Receive incoming stock transfers and process Goods Received Notes (GRN)'
  },
  {
    key: 'stock_count',
    label: 'Stock Counting & Audit Sessions',
    category: 'Inventory & Warehouse Operations',
    description: 'Create stock counting sessions, assign counting devices, and verify physical counts'
  },
  {
    key: 'stock_adjustment',
    label: 'Stock Adjustment',
    category: 'Inventory & Warehouse Operations',
    description: 'Perform stock corrections, write-offs, and quantity adjustments with audit reasons'
  },
  {
    key: 'stock_requests',
    label: 'Stock Requests & Indents',
    category: 'Inventory & Warehouse Operations',
    description: 'Request stock replenishment and approve or reject internal indents'
  },
  {
    key: 'stock_ledger',
    label: 'Stock Ledger & Movement History',
    category: 'Inventory & Warehouse Operations',
    description: 'Audit complete stock transaction history, batch inflows, and outflows'
  },
  {
    key: 'warehouse_reports',
    label: 'Warehouse Reports',
    category: 'Inventory & Warehouse Operations',
    description: 'Generate item sales trends, stock spreadsheets, and export stock reports'
  },
  {
    key: 'suppliers',
    label: 'Supplier / Vendor Directory',
    category: 'Inventory & Warehouse Operations',
    description: 'View registered suppliers, contacts, and purchase documents'
  },
  {
    key: 'serial_numbers',
    label: 'Serial Number Tracking & Barcodes',
    category: 'Inventory & Warehouse Operations',
    description: 'Track 8-digit product serial numbers, view manufacturer purchase & customer sale history, and print thermal barcode labels (Super Admin Controlled)'
  },

  // 5. FINANCE & BANKING
  {
    key: 'bank_accounts',
    label: 'Bank & Financial Accounts',
    category: 'Finance & Banking',
    description: 'Manage bank accounts, cash registers, and fund transfers'
  },
  {
    key: 'expenses',
    label: 'Expense Management',
    category: 'Finance & Banking',
    description: 'Record operating expenses, vouchers, and category budgets'
  },
  {
    key: 'day_end',
    label: 'Day End & Cash Closing',
    category: 'Finance & Banking',
    description: 'Register day end shift settlement and cash denomination closing'
  },
  {
    key: 'payment_reconciliation',
    label: 'Payment Reconciliation',
    category: 'Finance & Banking',
    description: 'UPI, Card, and Cash gateway settlement audit'
  }
];

module.exports = {
  DEFAULT_WAREHOUSE_MANAGER_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  ALL_SYSTEM_PERMISSIONS
};
