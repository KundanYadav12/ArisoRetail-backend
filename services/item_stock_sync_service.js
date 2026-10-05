const pool = require('../config/db');
const StockMovementService = require('./stock_movement_service');

/**
 * Helpers used by Add/Modify Item:
 *  - unique 8-digit barcode generation (same approach as serial numbers)
 *  - Opening Stock -> Inventory & Warehouse Management sync
 */
class ItemStockSyncService {
  /**
   * Generate an 8-digit numeric barcode that does not collide with any
   * existing barcode / sku / item_code / serial number.
   */
  static async generateUniqueBarcode(maxAttempts = 50) {
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = String(Math.floor(10000000 + Math.random() * 90000000));
      const [m] = await pool.execute(
        `SELECT id FROM menu_items WHERE barcode = ? OR sku = ? OR item_code = ? LIMIT 1`,
        [candidate, candidate, candidate]
      );
      if (m.length) continue;
      const [s] = await pool.execute(
        `SELECT id FROM product_serial_numbers WHERE serial_number = ? LIMIT 1`,
        [candidate]
      );
      if (s.length) continue;
      return candidate;
    }
    throw new Error('Unable to generate a unique barcode.');
  }

  /**
   * Sync opening stock into warehouse stock / Stock Catalog & Levels.
   * @param {number} restaurantId
   * @param {number} itemId
   * @param {number} previousOpening - opening stock before this save (0 for new items)
   * @param {number} newOpening - opening stock after this save
   * @param {object} opts { costPrice, startDate, user }
   * @returns {boolean} true if movement recorded
   */
  static async syncOpeningStock(restaurantId, itemId, previousOpening, newOpening, opts = {}) {
    const prev = parseFloat(previousOpening) || 0;
    const next = parseFloat(newOpening) || 0;
    const delta = next - prev;
    if (!delta) return false;

    const connection = await pool.getConnection();
    try {
      const [whRows] = await connection.execute(
        `SELECT id FROM warehouses WHERE restaurant_id = ? AND status = 'active'
         ORDER BY is_default DESC, id ASC LIMIT 1`,
        [restaurantId]
      );
      if (!whRows.length) {
        // No warehouse configured: fall back to item-level stock only.
        await connection.execute(
          `UPDATE menu_items SET current_stock = ? WHERE id = ? AND restaurant_id = ?`,
          [next, itemId, restaurantId]
        );
        return true;
      }
      const warehouseId = whRows[0].id;

      await connection.beginTransaction();

      // Seed legacy stock (item-level only) into the warehouse so aggregate recompute keeps it.
      const [[existing]] = await connection.execute(
        `SELECT COUNT(*) AS c FROM warehouse_stocks WHERE restaurant_id = ? AND menu_item_id = ?`,
        [restaurantId, itemId]
      );
      if (!existing.c) {
        const [[mi]] = await connection.execute(
          `SELECT current_stock FROM menu_items WHERE id = ? AND restaurant_id = ?`,
          [itemId, restaurantId]
        );
        let legacy = parseFloat(mi && mi.current_stock) || 0;
        // For brand-new items the repository seeds current_stock from opening stock; avoid double count.
        if (prev === 0 && legacy === next) legacy = 0;
        if (prev === 0 && legacy === 100 && next !== 100) legacy = 0;
        if (legacy) {
          await connection.execute(
            `INSERT INTO warehouse_stocks (restaurant_id, warehouse_id, menu_item_id, current_stock, reserved_stock)
             VALUES (?, ?, ?, ?, 0.000)
             ON DUPLICATE KEY UPDATE current_stock = VALUES(current_stock)`,
            [restaurantId, warehouseId, itemId, legacy]
          );
        }
      }

      const startNote = opts.startDate ? ` (Stock Availability Start Date: ${opts.startDate})` : '';
      await StockMovementService.recordMovement(connection, {
        restaurantId,
        warehouseId,
        menuItemId: itemId,
        type: delta > 0 ? 'OPENING_STOCK' : 'STOCK_CORRECTION',
        quantity: delta,
        unitCost: parseFloat(opts.costPrice) || 0,
        referenceType: 'menu_item',
        referenceId: itemId,
        referenceNumber: `OPEN-${itemId}`,
        userId: opts.user && opts.user.id || null,
        userName: opts.user && (opts.user.name || opts.user.username) || 'System',
        notes: (delta > 0 ? 'Opening stock from item form' : 'Opening stock adjusted from item form') + startNote
      });

      await connection.commit();
      return true;
    } catch (err) {
      try { await connection.rollback(); } catch (e) { /* ignore */ }
      console.warn('[ItemStockSync] Opening stock sync failed:', err.message);
      return false;
    } finally {
      connection.release();
    }
  }
}

module.exports = ItemStockSyncService;
