const InventoryRepository = require('../repositories/inventory_repository');
const WarehouseRepository = require('../repositories/warehouse_repository');
const SupplierRepository = require('../repositories/supplier_repository');
const StockRequestRepository = require('../repositories/stock_request_repository');
const StockTransferRepository = require('../repositories/stock_transfer_repository');
const PurchaseRepository = require('../repositories/purchase_repository');
const StockAdjustmentRepository = require('../repositories/stock_adjustment_repository');
const StockLedgerRepository = require('../repositories/stock_ledger_repository');
const { generateExcelWorkbook } = require('../utils/excel_helper');
const { getISTDateString, formatLocalDate } = require('../utils/date_utils');

class InventoryController {
  /* =========================================================================
     1. STOCK REPORTS & EXPORTS (PRESERVED & MULTI-WAREHOUSE AWARE)
     ========================================================================= */

  static async getStockReport(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { warehouse_id, category_id, search, status } = req.query;

      if (warehouse_id && warehouse_id !== 'all') {
        const report = await WarehouseRepository.getWarehouseStock(warehouse_id, restaurantId, {
          categoryId: category_id,
          search,
          status
        });
        return res.json(report);
      }

      const report = await InventoryRepository.getStockReport(restaurantId, {
        categoryId: category_id,
        search,
        status
      });
      return res.json(report);
    } catch (err) {
      console.error('Fetch stock report error:', err);
      return res.status(500).json({ error: 'Failed to retrieve stock report: ' + err.message });
    }
  }

  static async adjustStock(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const { menuItemId, adjustmentType, quantity, unit, lowStockThreshold, reason } = req.body;

      if (!menuItemId || !adjustmentType || quantity === undefined) {
        return res.status(400).json({ error: 'Item ID, adjustment type, and quantity are required.' });
      }

      const result = await InventoryRepository.adjustStock(restaurantId, {
        menuItemId,
        userId: req.user.id,
        userName: req.user.name || req.user.username,
        adjustmentType,
        quantity,
        unit,
        lowStockThreshold,
        reason
      });

      return res.json({
        message: 'Stock updated successfully.',
        stock: result
      });
    } catch (err) {
      console.error('Adjust stock error:', err);
      return res.status(500).json({ error: 'Failed to adjust stock: ' + err.message });
    }
  }

  static async getStockLogs(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const logs = await InventoryRepository.getStockLogs(restaurantId, req.query.menu_item_id, req.query.limit);
      return res.json(logs);
    } catch (err) {
      console.error('Fetch stock logs error:', err);
      return res.status(500).json({ error: 'Failed to retrieve stock logs.' });
    }
  }

  static async exportStockExcel(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const report = await InventoryRepository.getStockReport(restaurantId, {
        categoryId: req.query.category_id,
        search: req.query.search,
        status: req.query.status
      });

      const columns = [
        { header: 'Item Name', key: 'name', width: 25 },
        { header: 'Category', key: 'category_name', width: 18 },
        { header: 'SKU', key: 'sku', width: 14 },
        { header: 'Current Stock', key: 'current_stock', width: 14 },
        { header: 'Unit', key: 'unit', width: 10 },
        { header: 'Low Stock Threshold', key: 'low_stock_threshold', width: 20 },
        { header: 'Stock Status', key: 'stock_status', width: 16 },
        { header: 'Last Updated', key: 'updated_at', width: 20 }
      ];

      const rows = (report.items || []).map(item => ({
        name: item.name || '',
        category_name: item.category_name || '',
        sku: item.sku || '',
        current_stock: item.current_stock || 0,
        unit: item.unit || 'pcs',
        low_stock_threshold: item.low_stock_threshold || 10,
        stock_status: (item.stock_status || '').toUpperCase(),
        updated_at: item.updated_at ? new Date(item.updated_at).toISOString().slice(0, 19).replace('T', ' ') : 'N/A'
      }));

      const buffer = await generateExcelWorkbook({
        sheetName: 'Stock Inventory',
        columns,
        data: rows
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=stock_report_${getISTDateString()}.xlsx`);
      return res.send(buffer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate stock Excel export.' });
    }
  }

  static async exportStockCSV(req, res) {
    try {
      const restaurantId = req.user.restaurant_id;
      const report = await InventoryRepository.getStockReport(restaurantId, {
        categoryId: req.query.category_id,
        search: req.query.search,
        status: req.query.status
      });

      let csv = 'Item Name,Category,SKU,Current Stock,Unit,Low Stock Threshold,Stock Status,Last Updated\r\n';
      
      (report.items || []).forEach(item => {
        const lastUpdated = item.updated_at ? new Date(item.updated_at).toISOString().slice(0, 19).replace('T', ' ') : 'N/A';
        const cleanName = `"${(item.name || '').replace(/"/g, '""')}"`;
        const cleanCat = `"${(item.category_name || '').replace(/"/g, '""')}"`;
        const cleanSku = `"${(item.sku || '').replace(/"/g, '""')}"`;

        csv += `${cleanName},${cleanCat},${cleanSku},${item.current_stock || 0},${item.unit || 'pcs'},${item.low_stock_threshold || 10},${(item.stock_status || '').toUpperCase()},${lastUpdated}\r\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=stock_report_${getISTDateString()}.csv`);
      return res.send(csv);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to generate stock CSV export.' });
    }
  }

  /* =========================================================================
     2. WAREHOUSES & OUTLETS
     ========================================================================= */

  static async getWarehouses(req, res) {
    try {
      const warehouses = await WarehouseRepository.getAll(req.user.restaurant_id, req.query.status);
      return res.json(warehouses);
    } catch (err) {
      console.error('Get warehouses error:', err);
      return res.status(500).json({ error: 'Failed to retrieve warehouses.' });
    }
  }

  static async getWarehouseById(req, res) {
    try {
      const warehouse = await WarehouseRepository.getById(req.params.id, req.user.restaurant_id);
      if (!warehouse) return res.status(404).json({ error: 'Warehouse not found.' });
      return res.json(warehouse);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createWarehouse(req, res) {
    try {
      const { name, code } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Warehouse name is required.' });

      const warehouse = await WarehouseRepository.create(req.user.restaurant_id, req.body);
      return res.status(201).json({ message: 'Warehouse created successfully.', warehouse });
    } catch (err) {
      console.error('Create warehouse error:', err);
      return res.status(500).json({ error: 'Failed to create warehouse: ' + err.message });
    }
  }

  static async updateWarehouse(req, res) {
    try {
      const warehouse = await WarehouseRepository.update(req.params.id, req.user.restaurant_id, req.body);
      return res.json({ message: 'Warehouse updated successfully.', warehouse });
    } catch (err) {
      console.error('Update warehouse error:', err);
      return res.status(500).json({ error: 'Failed to update warehouse: ' + err.message });
    }
  }

  static async getWarehouseStock(req, res) {
    try {
      const stock = await WarehouseRepository.getWarehouseStock(req.params.id, req.user.restaurant_id, req.query);
      return res.json(stock);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  /* =========================================================================
     3. SUPPLIERS
     ========================================================================= */

  static async getSuppliers(req, res) {
    try {
      const suppliers = await SupplierRepository.getAll(req.user.restaurant_id, req.query);
      return res.json(suppliers);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve suppliers: ' + err.message });
    }
  }

  static async getSupplierById(req, res) {
    try {
      const supplier = await SupplierRepository.getById(req.params.id, req.user.restaurant_id);
      if (!supplier) return res.status(404).json({ error: 'Supplier not found.' });
      return res.json(supplier);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createSupplier(req, res) {
    try {
      const { name, mobile } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Supplier name is required.' });
      if (!mobile || !mobile.trim()) return res.status(400).json({ error: 'Supplier mobile number is required.' });

      const supplier = await SupplierRepository.create(req.user.restaurant_id, req.body);
      return res.status(201).json({ message: 'Supplier created successfully.', supplier });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create supplier: ' + err.message });
    }
  }

  static async updateSupplier(req, res) {
    try {
      const supplier = await SupplierRepository.update(req.params.id, req.user.restaurant_id, req.body);
      return res.json({ message: 'Supplier updated successfully.', supplier });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update supplier: ' + err.message });
    }
  }

  static async deleteSupplier(req, res) {
    try {
      const result = await SupplierRepository.delete(req.params.id, req.user.restaurant_id);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async getSupplierBills(req, res) {
    try {
      const bills = await SupplierRepository.getBills(req.params.id, req.user.restaurant_id);
      return res.json(bills);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  /* =========================================================================
     4. STOCK REQUESTS & APPROVALS
     ========================================================================= */

  static async getStockRequests(req, res) {
    try {
      const requests = await StockRequestRepository.getAll(req.user.restaurant_id, req.query);
      return res.json(requests);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve stock requests: ' + err.message });
    }
  }

  static async getStockRequestById(req, res) {
    try {
      const request = await StockRequestRepository.getById(req.params.id, req.user.restaurant_id);
      if (!request) return res.status(404).json({ error: 'Stock request not found.' });
      return res.json(request);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createStockRequest(req, res) {
    try {
      const request = await StockRequestRepository.create(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Stock request submitted successfully.', request });
    } catch (err) {
      console.error('Create stock request error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async approveStockRequest(req, res) {
    try {
      const request = await StockRequestRepository.approve(
        req.params.id,
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.json({ message: `Stock request ${request.status} successfully.`, request });
    } catch (err) {
      console.error('Approve stock request error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async rejectStockRequest(req, res) {
    try {
      const request = await StockRequestRepository.reject(
        req.params.id,
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body.reason
      );
      return res.json({ message: 'Stock request rejected.', request });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  /* =========================================================================
     5. STOCK TRANSFERS & RECEIVING
     ========================================================================= */

  static async getStockTransfers(req, res) {
    try {
      const transfers = await StockTransferRepository.getAll(req.user.restaurant_id, req.query);
      return res.json(transfers);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve stock transfers: ' + err.message });
    }
  }

  static async getStockTransferById(req, res) {
    try {
      const transfer = await StockTransferRepository.getById(req.params.id, req.user.restaurant_id);
      if (!transfer) return res.status(404).json({ error: 'Stock transfer not found.' });
      return res.json(transfer);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createStockTransfer(req, res) {
    try {
      const transfer = await StockTransferRepository.create(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Stock transfer initiated successfully.', transfer });
    } catch (err) {
      console.error('Create stock transfer error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async receiveStockTransfer(req, res) {
    try {
      const transfer = await StockTransferRepository.receive(
        req.params.id,
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.json({ message: 'Stock received into destination warehouse successfully.', transfer });
    } catch (err) {
      console.error('Receive stock transfer error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  /* =========================================================================
     6. PURCHASES (POs, GRNs, BILLS, RETURNS, PAYMENTS, LEDGER)
     ========================================================================= */

  static async getPurchaseOrders(req, res) {
    try {
      const orders = await PurchaseRepository.getPOs(req.user.restaurant_id, req.query);
      return res.json(orders);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve purchase orders: ' + err.message });
    }
  }

  static async getPurchaseOrderById(req, res) {
    try {
      const order = await PurchaseRepository.getPOById(req.params.id, req.user.restaurant_id);
      if (!order) return res.status(404).json({ error: 'Purchase order not found.' });

      // Also attach related GRNs and Bills for the detail view
      const grns = await PurchaseRepository.getGRNs(req.user.restaurant_id, { purchase_order_id: req.params.id });
      const bills = await PurchaseRepository.getBills(req.user.restaurant_id, { purchase_order_id_filter: req.params.id });
      order.grns = grns;
      order.related_bills = bills;
      return res.json(order);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createPurchaseOrder(req, res) {
    try {
      const po = await PurchaseRepository.createPO(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Purchase Order created successfully.', purchase_order: po });
    } catch (err) {
      console.error('Create purchase order error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async updatePurchaseOrder(req, res) {
    try {
      const po = await PurchaseRepository.updatePO(
        req.params.id,
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.json({ message: 'Purchase Order updated.', purchase_order: po });
    } catch (err) {
      console.error('Update purchase order error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async approvePurchaseOrder(req, res) {
    try {
      const po = await PurchaseRepository.approvePO(
        req.params.id,
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username
      );
      return res.json({ message: 'Purchase Order approved successfully.', purchase_order: po });
    } catch (err) {
      console.error('Approve PO error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async cancelPurchaseOrder(req, res) {
    try {
      const po = await PurchaseRepository.cancelPO(
        req.params.id,
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body.reason
      );
      return res.json({ message: 'Purchase Order cancelled.', purchase_order: po });
    } catch (err) {
      console.error('Cancel PO error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  // GRN — Goods Received Notes
  static async getGRNs(req, res) {
    try {
      const grns = await PurchaseRepository.getGRNs(req.user.restaurant_id, req.query);
      return res.json(grns);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve GRNs: ' + err.message });
    }
  }

  static async getGRNById(req, res) {
    try {
      const grn = await PurchaseRepository.getGRNById(req.params.id, req.user.restaurant_id);
      if (!grn) return res.status(404).json({ error: 'GRN not found.' });
      return res.json(grn);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createGRN(req, res) {
    try {
      const grn = await PurchaseRepository.createGRN(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'GRN created. Stock updated in warehouse.', grn });
    } catch (err) {
      console.error('Create GRN error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async convertGRNToBill(req, res) {
    try {
      const bill = await PurchaseRepository.convertGRNToBill(
        req.params.id,
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Purchase Bill created from GRN. Supplier outstanding updated.', bill });
    } catch (err) {
      console.error('Convert GRN to Bill error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  // Purchase Bills
  static async getPurchaseBills(req, res) {
    try {
      const bills = await PurchaseRepository.getBills(req.user.restaurant_id, req.query);
      return res.json(bills);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve purchase bills: ' + err.message });
    }
  }

  static async getPurchaseBillById(req, res) {
    try {
      const bill = await PurchaseRepository.getBillById(req.params.id, req.user.restaurant_id);
      if (!bill) return res.status(404).json({ error: 'Purchase bill not found.' });

      // Attach payments
      const payments = await PurchaseRepository.getSupplierPayments(req.user.restaurant_id, { purchase_bill_id: req.params.id });
      bill.payments = payments;
      return res.json(bill);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createPurchaseBill(req, res) {
    try {
      const bill = await PurchaseRepository.createBill(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Purchase Bill created and warehouse stock updated.', bill });
    } catch (err) {
      console.error('Create purchase bill error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  // Purchase Returns
  static async getPurchaseReturns(req, res) {
    try {
      const returns = await PurchaseRepository.getReturns(req.user.restaurant_id, req.query);
      return res.json(returns);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve purchase returns: ' + err.message });
    }
  }

  static async createPurchaseReturn(req, res) {
    try {
      const ret = await PurchaseRepository.createReturn(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Purchase Return recorded and stock reduced.', purchase_return: ret });
    } catch (err) {
      console.error('Create purchase return error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  // Supplier Payments
  static async recordSupplierPayment(req, res) {
    try {
      const payment = await PurchaseRepository.recordSupplierPayment(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Supplier payment recorded successfully.', payment });
    } catch (err) {
      console.error('Record supplier payment error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  static async getSupplierPayments(req, res) {
    try {
      const payments = await PurchaseRepository.getSupplierPayments(req.user.restaurant_id, req.query);
      return res.json(payments);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve supplier payments: ' + err.message });
    }
  }

  // Supplier Ledger
  static async getSupplierLedger(req, res) {
    try {
      const ledger = await PurchaseRepository.getSupplierLedger(
        req.params.id,
        req.user.restaurant_id,
        req.query
      );
      return res.json(ledger);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve supplier ledger: ' + err.message });
    }
  }


  /* =========================================================================
     7. STOCK ADJUSTMENTS
     ========================================================================= */

  static async getAdjustments(req, res) {
    try {
      const adjustments = await StockAdjustmentRepository.getAll(req.user.restaurant_id, req.query);
      return res.json(adjustments);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to retrieve adjustments: ' + err.message });
    }
  }

  static async getAdjustmentById(req, res) {
    try {
      const adjustment = await StockAdjustmentRepository.getById(req.params.id, req.user.restaurant_id);
      if (!adjustment) return res.status(404).json({ error: 'Stock adjustment not found.' });
      return res.json(adjustment);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  static async createAdjustment(req, res) {
    try {
      const adjustment = await StockAdjustmentRepository.create(
        req.user.restaurant_id,
        req.user.id,
        req.user.name || req.user.username,
        req.body
      );
      return res.status(201).json({ message: 'Stock adjustment recorded successfully.', adjustment });
    } catch (err) {
      console.error('Create adjustment error:', err);
      return res.status(400).json({ error: err.message });
    }
  }

  /* =========================================================================
     8. STOCK LEDGER & DASHBOARD METRICS
     ========================================================================= */

  static async getLedger(req, res) {
    try {
      const ledger = await StockLedgerRepository.getLedger(req.user.restaurant_id, req.query);
      return res.json(ledger);
    } catch (err) {
      console.error('Get ledger error:', err);
      return res.status(500).json({ error: 'Failed to retrieve stock ledger: ' + err.message });
    }
  }

  static async getDashboardMetrics(req, res) {
    try {
      const metrics = await StockLedgerRepository.getDashboardMetrics(req.user.restaurant_id, req.query.warehouse_id);
      return res.json(metrics);
    } catch (err) {
      console.error('Get dashboard metrics error:', err);
      return res.status(500).json({ error: 'Failed to retrieve dashboard metrics: ' + err.message });
    }
  }
}

module.exports = InventoryController;
