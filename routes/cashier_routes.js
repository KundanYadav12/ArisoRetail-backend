const express = require('express');
const { authenticateToken } = require('../middlewares/auth_middleware');
const pool = require('../config/db');

const router = express.Router();

/**
 * Helper to ensure cash_movements table exists in MySQL
 */
async function ensureCashMovementsTable() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        restaurant_id INT NOT NULL,
        user_id INT NOT NULL,
        shift_id INT DEFAULT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        movement_type ENUM('in', 'out') NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.warn('[cashier_routes] Table check warning:', err.message);
  }
}

/**
 * POST /api/cashier/starting-cash
 * Set or update opening starting cash float for the active shift.
 */
router.post('/starting-cash', authenticateToken, async (req, res) => {
  await ensureCashMovementsTable();
  const { starting_cash } = req.body;
  const userId = req.user?.id;
  const restaurantId = req.user?.restaurant_id;

  if (starting_cash === undefined || isNaN(parseFloat(starting_cash)) || parseFloat(starting_cash) < 0) {
    return res.status(400).json({ error: 'A valid non-negative starting cash amount is required.' });
  }

  if (!userId || !restaurantId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const startingVal = parseFloat(starting_cash);

  try {
    // Check if open shift exists for user
    const [shifts] = await pool.execute(
      'SELECT id FROM cashier_shifts WHERE restaurant_id = ? AND cashier_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [restaurantId, userId]
    );

    if (shifts.length > 0) {
      // Update existing open shift starting cash
      await pool.execute(
        'UPDATE cashier_shifts SET starting_cash = ? WHERE id = ?',
        [startingVal, shifts[0].id]
      );
    } else {
      // Create new open shift with starting cash
      await pool.execute(
        'INSERT INTO cashier_shifts (restaurant_id, cashier_id, device, starting_cash, status, login_time) VALUES (?, ?, "Mobile POS", ?, "open", NOW())',
        [restaurantId, userId, startingVal]
      );
    }

    return res.json({
      success: true,
      message: `Starting cash updated to ₹${startingVal.toFixed(2)}.`,
      starting_cash: startingVal
    });
  } catch (err) {
    console.error('[cashier/starting-cash error]', err);
    return res.status(500).json({ error: 'Failed to update starting cash.' });
  }
});

/**
 * POST /api/cashier/cash-movement
 * Record a cash-in or cash-out entry for the user's shift.
 */
router.post('/cash-movement', authenticateToken, async (req, res) => {
  await ensureCashMovementsTable();
  const { amount, movement_type, reason } = req.body;
  const userId = req.user?.id;
  const restaurantId = req.user?.restaurant_id;

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'A valid positive cash amount is required.' });
  }

  const type = (movement_type || '').toLowerCase();
  if (!['in', 'out'].includes(type)) {
    return res.status(400).json({ error: 'movement_type must be "in" or "out".' });
  }

  if (!userId || !restaurantId) {
    return res.status(401).json({ error: 'User authentication required.' });
  }

  try {
    // 1. Get active shift for this user in this restaurant
    const [shifts] = await pool.execute(
      'SELECT id, starting_cash FROM cashier_shifts WHERE restaurant_id = ? AND cashier_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [restaurantId, userId]
    );
    const shift = shifts[0] || null;
    const shiftId = shift ? shift.id : null;

    // 2. Insert cash movement record into MySQL
    const [result] = await pool.execute(
      'INSERT INTO cash_movements (restaurant_id, user_id, shift_id, amount, movement_type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [restaurantId, userId, shiftId, parseFloat(amount), type, reason || '']
    );

    const movementId = result.insertId;

    return res.status(201).json({
      success: true,
      message: `Cash ${type === 'in' ? 'In' : 'Out'} of ₹${parseFloat(amount).toFixed(2)} recorded successfully.`,
      movement: {
        id: movementId,
        restaurant_id: restaurantId,
        user_id: userId,
        shift_id: shiftId,
        amount: parseFloat(amount),
        movement_type: type,
        reason: reason || '',
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[cashier/cash-movement error]', err);
    return res.status(500).json({ error: err.message || 'Failed to record cash movement.' });
  }
});

/**
 * GET /api/cashier/shift-summary
 * Fetch running totals (starting cash, cash in, cash out, cash sales, drawer cash) for active shift.
 */
router.get('/shift-summary', authenticateToken, async (req, res) => {
  await ensureCashMovementsTable();
  const userId = req.user?.id;
  const restaurantId = req.user?.restaurant_id;

  if (!userId || !restaurantId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    // 1. Fetch active shift info
    const [shifts] = await pool.execute(
      'SELECT * FROM cashier_shifts WHERE restaurant_id = ? AND cashier_id = ? AND status = "open" ORDER BY id DESC LIMIT 1',
      [restaurantId, userId]
    );

    const shift = shifts[0] || null;
    // NO HARDCODED 1000 DEFAULT — defaults to 0 if starting_cash not specified!
    const startingCash = parseFloat(shift?.starting_cash || 0);
    const shiftId = shift ? shift.id : null;

    // 2. Sum Cash In & Cash Out entries for current user today
    const today = new Date().toISOString().slice(0, 10);
    const datePattern = `${today}%`;

    const [movementsRow] = await pool.execute(
      'SELECT ' +
      'COALESCE(SUM(CASE WHEN movement_type = "in" THEN amount ELSE 0 END), 0) as totalCashIn, ' +
      'COALESCE(SUM(CASE WHEN movement_type = "out" THEN amount ELSE 0 END), 0) as totalCashOut ' +
      'FROM cash_movements WHERE restaurant_id = ? AND user_id = ? AND created_at LIKE ?',
      [restaurantId, userId, datePattern]
    );

    const totalCashIn = parseFloat(movementsRow[0]?.totalCashIn || 0);
    const totalCashOut = parseFloat(movementsRow[0]?.totalCashOut || 0);

    // 3. Sum sales by payment mode for current user today
    const [salesRow] = await pool.execute(
      'SELECT ' +
      'COALESCE(SUM(CASE WHEN LOWER(payment_mode) = "cash" THEN total_amount ELSE 0 END), 0) as cashSales, ' +
      'COALESCE(SUM(CASE WHEN LOWER(payment_mode) IN ("upi", "gpay", "phonepe", "paytm") THEN total_amount ELSE 0 END), 0) as upiSales, ' +
      'COALESCE(SUM(CASE WHEN LOWER(payment_mode) IN ("card", "credit", "debit") THEN total_amount ELSE 0 END), 0) as cardSales, ' +
      'COALESCE(SUM(total_amount), 0) as totalSales, ' +
      'COUNT(id) as totalOrders ' +
      'FROM orders WHERE restaurant_id = ? AND (cashier_id = ? OR cashier_id IS NULL) AND created_at LIKE ? AND (order_status != "cancelled" OR order_status IS NULL)',
      [restaurantId, userId, datePattern]
    );

    const cashSales = parseFloat(salesRow[0]?.cashSales || 0);
    const upiSales = parseFloat(salesRow[0]?.upiSales || 0);
    const cardSales = parseFloat(salesRow[0]?.cardSales || 0);
    const totalSales = parseFloat(salesRow[0]?.totalSales || 0);
    const totalOrders = parseInt(salesRow[0]?.totalOrders || 0, 10);

    // Drawer Cash = Starting Cash + Cash In - Cash Out + Cash Sales
    const drawerCash = startingCash + totalCashIn - totalCashOut + cashSales;

    return res.json({
      status: shift ? 'OPEN' : 'OPEN (UNSET)',
      shift_id: shiftId,
      starting_cash: startingCash,
      total_cash_in: totalCashIn,
      total_cash_out: totalCashOut,
      cash_sales: cashSales,
      upi_sales: upiSales,
      card_sales: cardSales,
      total_sales: totalSales,
      total_orders: totalOrders,
      drawer_cash: drawerCash
    });
  } catch (err) {
    console.error('[cashier/shift-summary error]', err);
    return res.status(500).json({ error: 'Failed to fetch shift summary.' });
  }
});

module.exports = router;
