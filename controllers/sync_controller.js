const OrderRepository = require('../repositories/order_repository');
const CategoryRepository = require('../repositories/category_repository');
const MenuRepository = require('../repositories/menu_repository');
const PrinterRepository = require('../repositories/printer_repository');
const ReceiptRepository = require('../repositories/receipt_repository');
const UserRepository = require('../repositories/user_repository');
const pool = require('../config/db');

class SyncController {
  /**
   * Upward Sync: Ingest batch mutations from Local Gateway into Cloud MySQL
   */
  static async ingestUpwardSync(req, res) {
    const { mutations } = req.body;
    const restaurantId = req.user.restaurant_id;

    if (!mutations || !Array.isArray(mutations)) {
      return res.status(400).json({ error: 'mutations array is required.' });
    }

    const acks = [];

    for (const m of mutations) {
      const { mutation_id, action_type, payload } = m;

      try {
        // 1. Idempotency Check: Prevent duplicate order processing if mutation was already received
        const [existing] = await pool.execute(
          'SELECT id FROM orders WHERE notes LIKE ? AND restaurant_id = ?',
          [`%[LocalRef:${payload.local_order_id}]%`, restaurantId]
        );

        if (existing.length > 0) {
          acks.push({
            mutation_id,
            status: 'DUPLICATE',
            local_order_id: payload.local_order_id,
            cloud_order_id: existing[0].id
          });
          continue;
        }

        if (action_type === 'CREATE_ORDER') {
          const notesWithRef = `${payload.notes || ''} [LocalRef:${payload.local_order_id}]`.trim();

          const createdOrder = await OrderRepository.createOrder({
            restaurantId,
            items: payload.items,
            paymentMode: payload.payment_mode || 'cash',
            subtotal: payload.subtotal,
            taxAmount: payload.tax_amount,
            discountAmount: payload.discount_amount || 0,
            totalAmount: payload.total_amount,
            tableNumberOrTakeaway: payload.table_number_or_takeaway,
            cashierId: req.user.id,
            cashierName: req.user.username,
            notes: notesWithRef
          });

          acks.push({
            mutation_id,
            status: 'SUCCESS',
            local_order_id: payload.local_order_id,
            cloud_order_id: createdOrder.id
          });
        } else {
          acks.push({ mutation_id, status: 'SUCCESS' });
        }
      } catch (err) {
        console.error(`[SyncController Upward Error] Mutation ${mutation_id}:`, err.message);
        acks.push({ mutation_id, status: 'FAILED', error: err.message });
      }
    }

    return res.json({ message: 'Upward sync batch processed successfully.', acks });
  }

  /**
   * Downward Sync: Serve latest menu, categories, printers, receipt settings & users to Local Gateway
   */
  static async serveDownwardSync(req, res) {
    const restaurantId = req.user.restaurant_id;

    try {
      const categories = await CategoryRepository.getAll(restaurantId);
      const menuItems = await MenuRepository.getAll(restaurantId);
      const printers = await PrinterRepository.getAll(restaurantId);
      const receiptSettings = await ReceiptRepository.getByRestaurantId(restaurantId);
      const users = await UserRepository.getUsersByRestaurant(restaurantId);

      return res.json({
        categories,
        menu_items: menuItems,
        printers,
        receipt_settings: receiptSettings,
        users,
        timestamp: new Date()
      });
    } catch (err) {
      console.error('[SyncController Downward Error]', err);
      return res.status(500).json({ error: 'Failed to generate downward sync payload.' });
    }
  }
}

module.exports = SyncController;
