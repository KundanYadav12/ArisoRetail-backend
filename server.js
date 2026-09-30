process.env.TZ = 'Asia/Kolkata';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth_routes');
const categoryRoutes = require('./routes/category_routes');
const menuRoutes = require('./routes/menu_routes');
const orderRoutes = require('./routes/order_routes');
const printerRoutes = require('./routes/printer_routes');
const reportRoutes = require('./routes/report_routes');
const superAdminRoutes = require('./routes/superadmin_routes');
const receiptRoutes = require('./routes/receipt_routes');
const inventoryRoutes = require('./routes/inventory_routes');
const agentRoutes = require('./routes/agent_routes');
const syncRoutes = require('./routes/sync_routes');
const profileRoutes = require('./routes/profile_routes');
const cashierRoutes = require('./routes/cashier_routes');
const superbillRoutes = require('./routes/superbill_routes');
const customerRoutes = require('./routes/customer_routes');
const deliveryChallanRoutes = require('./routes/delivery_challan_routes');
const gstRoutes = require('./routes/gst_routes');
const financeRoutes = require('./routes/financial_account_routes');
const expenseRoutes = require('./routes/expense_routes');
const dayEndRoutes = require('./routes/day_end_routes');
const paymentReconciliationRoutes = require('./routes/payment_reconciliation_routes');
const heldReceiptRoutes = require('./routes/held_receipt_routes');
const customerReceivableRoutes = require('./routes/customer_receivable_routes');
const serialNumberRoutes = require('./routes/serial_number_routes');

const { apiLimiter, authLimiter } = require('./middlewares/rate_limiter_middleware');
const { addClient, removeClient } = require('./services/realtime_service');
const { authenticateToken } = require('./middlewares/auth_middleware');

const app = express();
const PORT = process.env.PORT || 5004;

// Configure Express for Production Reverse Proxy / Nginx
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// Security Middlewares
// Dynamic Multi-Domain CORS Configuration (Supports retail.arisotechnologies.com, arisoretail.duckdns.org & Localhost)
const defaultAllowedOrigins = [
  'https://retail.arisotechnologies.com',
  'http://retail.arisotechnologies.com',
  'https://arisoretail.duckdns.org',
  'http://arisoretail.duckdns.org',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5005',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5005',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006'
];

const envAllowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envAllowedOrigins]));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    if (
      origin.endsWith('.arisotechnologies.com') ||
      origin.endsWith('.duckdns.org') ||
      origin.endsWith('.arisoretail.duckdns.org')
    ) {
      return callback(null, true);
    }

    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Token', 'X-Requested-With', 'Accept', 'Origin']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Apply Authentication Rate Limiter to Login and OTP Endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/send-otp', authLimiter);

// Apply Multi-Tenant Isolated Rate Limiter to API Routes
app.use('/api/', apiLimiter);

// Serve uploads directory static files
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Serve virtual printers directory static files
const virtualPrintersDir = process.env.MOCK_PRINTER_PATH || path.join(__dirname, 'virtual_printers');
if (!fs.existsSync(virtualPrintersDir)) {
  fs.mkdirSync(virtualPrintersDir, { recursive: true });
}
app.use('/virtual_printers', express.static(virtualPrintersDir));

// API Route Bindings
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/printers', printerRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/settings/receipt', receiptRoutes);
app.use('/api/settings/profile', profileRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/cashier', cashierRoutes);
app.use('/api/superbill', superbillRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/delivery-challans', deliveryChallanRoutes);
app.use('/api/gst', gstRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/day-end', dayEndRoutes);
app.use('/api/payment-reconciliation', paymentReconciliationRoutes);
app.use('/api/held-receipts', heldReceiptRoutes);
app.use('/api/receivables', customerReceivableRoutes);
app.use('/api/serial-numbers', serialNumberRoutes);

const ThemeController = require('./controllers/theme_controller');
app.get('/api/theme/config', ThemeController.getTheme);

// ── Real-Time Server-Sent Events (SSE) ────────────────────────────────────────
// GET /api/events — authenticated streaming endpoint.
// Each tab/device opens one long-lived connection; the server pushes named events
// whenever data changes (menu, categories, stock, orders, etc.).
app.get('/api/events', authenticateToken, (req, res) => {
  const restaurantId = req.user && req.user.restaurant_id;
  if (!restaurantId) return res.status(403).end();

  // SSE headers
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'   // disable nginx proxy buffering
  });
  res.flushHeaders();

  // Initial handshake — tells the client the connection is alive
  res.write(`event: connected\ndata: ${JSON.stringify({ restaurantId, ts: Date.now() })}\n\n`);

  // Keep-alive ping every 25 s (prevents proxies from closing the connection)
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  addClient(restaurantId, res);

  req.on('close', () => {
    clearInterval(keepAlive);
    removeClient(restaurantId, res);
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Global Error Middleware]', err);
  let status = err.status || 500;
  if (err.code === 'LIMIT_FILE_SIZE' || err.name === 'MulterError') {
    status = 400;
  }
  return res.status(status).json({
    error: err.message || 'An unexpected error occurred on the server.'
  });
});

const runMigrations = require('./migrations/runner');

// Start Server
app.listen(PORT, '0.0.0.0', async () => {
  try {
    await runMigrations();
  } catch (err) {
    console.error('[Migration Startup Error]', err.message);
  }
  console.log(`==================================================`);
  console.log(`   Ariso Retail POS Backend API Running (LAN & Local)`);
  console.log(`   Local URL: http://localhost:${PORT}`);
  console.log(`   Network LAN Binding: http://0.0.0.0:${PORT}`);
  console.log(`==================================================`);
});
