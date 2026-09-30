/**
 * Ariso Retail — Real-Time Push Service (SSE)
 * Broadcasts change events to all connected clients of the same restaurant.
 * Uses native Node.js HTTP / Express SSE — no extra libraries needed.
 */

// Map<restaurantId, Set<res>> — tracks all open SSE connections per tenant
const clients = new Map();

/**
 * Register a new SSE client connection.
 * @param {number|string} restaurantId
 * @param {object} res - Express response object
 */
function addClient(restaurantId, res) {
  const key = String(restaurantId);
  if (!clients.has(key)) {
    clients.set(key, new Set());
  }
  clients.get(key).add(res);
}

/**
 * Remove an SSE client (called on connection close).
 * @param {number|string} restaurantId
 * @param {object} res - Express response object
 */
function removeClient(restaurantId, res) {
  const key = String(restaurantId);
  if (clients.has(key)) {
    clients.get(key).delete(res);
    if (clients.get(key).size === 0) {
      clients.delete(key);
    }
  }
}

/**
 * Broadcast a named event + JSON payload to all connected clients of a restaurant.
 * @param {number|string} restaurantId
 * @param {string} event  - Event name (e.g. 'menu_updated', 'stock_updated')
 * @param {object} data   - Payload object
 */
function broadcast(restaurantId, event, data = {}) {
  const key = String(restaurantId);
  const bucket = clients.get(key);
  if (!bucket || bucket.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`;

  bucket.forEach((res) => {
    try {
      res.write(payload);
    } catch (_) {
      bucket.delete(res);
    }
  });
}

/**
 * Convenience helpers — call these after any DB mutation to notify connected UIs.
 */
const notify = {
  menuUpdated:      (restaurantId, extra = {}) => broadcast(restaurantId, 'menu_updated', extra),
  categoryUpdated:  (restaurantId, extra = {}) => broadcast(restaurantId, 'category_updated', extra),
  stockUpdated:     (restaurantId, extra = {}) => broadcast(restaurantId, 'stock_updated', extra),
  orderUpdated:     (restaurantId, extra = {}) => broadcast(restaurantId, 'order_updated', extra),
  inventoryUpdated: (restaurantId, extra = {}) => broadcast(restaurantId, 'inventory_updated', extra),
  profileUpdated:   (restaurantId, extra = {}) => broadcast(restaurantId, 'profile_updated', extra),
  priceUpdated:     (restaurantId, extra = {}) => broadcast(restaurantId, 'price_updated', extra),
  settingsUpdated:  (restaurantId, extra = {}) => broadcast(restaurantId, 'settings_updated', extra),
};

module.exports = { addClient, removeClient, broadcast, notify };
