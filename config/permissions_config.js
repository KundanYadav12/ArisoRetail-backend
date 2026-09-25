/**
 * Centralized Permission Definitions & Default Roles Configuration
 * Aligned with Ariso Retail RBAC architecture.
 */

const DEFAULT_WAREHOUSE_MANAGER_PERMISSIONS = [
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
  'suppliers'
];

const ALL_SYSTEM_PERMISSIONS = [
  // WAREHOUSE OPERATIONS (Enabled by default for Warehouse Manager)
  {
    key: 'warehouse_dashboard',
    label: 'Warehouse Dashboard & Metrics',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'View executive inventory valuation, low stock alerts, and warehouse KPIs'
  },
  {
    key: 'inventory_catalog',
    label: 'Inventory Catalog & Product Stock',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'View and search stock levels, SKU items, categories, and barcode numbers'
  },
  {
    key: 'warehouses',
    label: 'Warehouses & Godowns List',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'View warehouses/godowns, locations, and localized stock numbers'
  },
  {
    key: 'rack_management',
    label: 'Rack / Bin Management',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Manage warehouse racks, shelves, bins, and exact item location mappings'
  },
  {
    key: 'stock_transfer',
    label: 'Stock Transfer',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Create and dispatch stock transfers between warehouses and branches'
  },
  {
    key: 'stock_receiving',
    label: 'Stock Receiving & Inward Goods',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Receive incoming stock transfers and process Goods Received Notes (GRN)'
  },
  {
    key: 'stock_count',
    label: 'Stock Count & Audit Sessions',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Create stock counting sessions, assign counting devices, and verify physical counts'
  },
  {
    key: 'stock_adjustment',
    label: 'Stock Adjustment',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Perform stock corrections, write-offs, and quantity adjustments with audit reasons'
  },
  {
    key: 'stock_requests',
    label: 'Stock Requests & Indents',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Request stock replenishment and approve or reject internal indents'
  },
  {
    key: 'stock_ledger',
    label: 'Stock Ledger & Movement History',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Audit complete stock transaction history, batch inflows, and outflows'
  },
  {
    key: 'warehouse_reports',
    label: 'Warehouse & Item Sales Reports',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'Generate item sales trends, stock spreadsheets, and export stock reports'
  },
  {
    key: 'suppliers',
    label: 'Supplier / Vendor Directory',
    category: 'Warehouse Operations',
    defaultWarehouseManager: true,
    description: 'View registered suppliers, contacts, and purchase documents'
  },

  // OTHER SYSTEM MODULES (Disabled by default for Warehouse Manager)
  {
    key: 'pos_billing',
    label: 'POS Billing & Checkout',
    category: 'Sales & POS',
    defaultWarehouseManager: false,
    description: 'Counter POS terminal, cart billing, customer checkout, and cash drawer'
  },
  {
    key: 'sales_orders',
    label: 'Sales Orders Management',
    category: 'Sales & POS',
    defaultWarehouseManager: false,
    description: 'Create and manage commercial sales orders and estimates'
  },
  {
    key: 'customers',
    label: 'Customers & Parties',
    category: 'Sales & POS',
    defaultWarehouseManager: false,
    description: 'Customer directory, contact database, and party balances'
  },
  {
    key: 'expenses',
    label: 'Expense Management',
    category: 'Finance & Banking',
    defaultWarehouseManager: false,
    description: 'Record operating expenses, vouchers, and category budgets'
  },
  {
    key: 'bank_accounts',
    label: 'Bank Accounts & Financial Accounts',
    category: 'Finance & Banking',
    defaultWarehouseManager: false,
    description: 'Manage bank accounts, cash registers, and fund transfers'
  },
  {
    key: 'receivables',
    label: 'Customer Receivables & Udhar',
    category: 'Finance & Banking',
    defaultWarehouseManager: false,
    description: 'Customer credit limits, outstanding dues, and payment collections'
  },
  {
    key: 'payables',
    label: 'Supplier Payables & Advances',
    category: 'Finance & Banking',
    defaultWarehouseManager: false,
    description: 'Supplier balance tracking, purchase bills, and disbursement recording'
  },
  {
    key: 'reconciliation',
    label: 'Payment Reconciliation',
    category: 'Finance & Banking',
    defaultWarehouseManager: false,
    description: 'UPI, Card, and Cash gateway settlement audit'
  },
  {
    key: 'day_end',
    label: 'Day End & Cash Closing',
    category: 'Finance & Banking',
    defaultWarehouseManager: false,
    description: 'Register day end shift settlement and cash denomination closing'
  }
];

module.exports = {
  DEFAULT_WAREHOUSE_MANAGER_PERMISSIONS,
  ALL_SYSTEM_PERMISSIONS
};
