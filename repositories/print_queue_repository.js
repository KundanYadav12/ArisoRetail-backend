const pool = require('../config/db');

class PrintQueueRepository {
  /**
   * Enqueue a new print job into the print_queue table with pre-formatted ESC/POS payload
   */
  /**
   * Enqueue a new print job into the print_queue table with pre-formatted ESC/POS payload & timestamps
   */
  static async enqueue(job) {
    const { restaurant_id, order_id, printer_id, print_type, payload_base64, backend_received_at, is_reprint } = job;
    const receivedTime = backend_received_at ? new Date(backend_received_at) : new Date();
    const type = print_type || 'RECEIPT';

    // Strict Idempotency: If this is an automatic job for an order (not a manual reprint), check if a job already exists
    if (order_id && !is_reprint && type !== 'REPRINT') {
      const [existing] = await pool.execute(
        'SELECT id FROM print_queue WHERE restaurant_id = ? AND order_id = ? AND print_type = ? AND status IN ("PENDING", "PRINTING", "SUCCESS", "COMPLETED") ORDER BY id DESC LIMIT 1',
        [restaurant_id, order_id, type]
      );
      if (existing.length > 0) {
        console.log(`[PRINT QUEUE DEDUPE] Suppressed duplicate print job for Order #${order_id} (Type: ${type}, Existing Job ID: ${existing[0].id})`);
        return existing[0].id;
      }
    }

    const [result] = await pool.execute(
      'INSERT INTO print_queue (restaurant_id, order_id, printer_id, payload_base64, print_type, status, retry_count, created_at, backend_received_at) ' +
      'VALUES (?, ?, ?, ?, ?, "PENDING", 0, NOW(), ?)',
      [
        restaurant_id, 
        order_id || null, 
        printer_id || null, 
        payload_base64 || null, 
        type,
        receivedTime
      ]
    );
    return result.insertId;
  }

  /**
   * Atomic Job Lock: Claims a pending job for processing so no other worker picks it up simultaneously.
   */
  static async claimJob(jobId) {
    const [result] = await pool.execute(
      'UPDATE print_queue SET status = "PRINTING", connection_started_at = NOW() WHERE id = ? AND status = "PENDING"',
      [jobId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Mark jobs as polled by Gateway Agent with gateway_polled_at timestamp
   */
  static async markJobsPolled(jobIds) {
    if (!jobIds || jobIds.length === 0) return;
    const placeholders = jobIds.map(() => '?').join(',');
    await pool.query(
      `UPDATE print_queue SET status = "PRINTING", gateway_polled_at = NOW() WHERE id IN (${placeholders}) AND status = "PENDING"`,
      jobIds
    );
  }

  /**
   * Update specific print job progress timestamps
   */
  static async updateJobTiming(jobId, timingData) {
    const { connected_at, data_sent_at, completed_at, total_duration_ms } = timingData;
    await pool.execute(
      `UPDATE print_queue SET 
        connected_at = COALESCE(?, connected_at),
        data_sent_at = COALESCE(?, data_sent_at),
        completed_at = COALESCE(?, completed_at),
        total_duration_ms = COALESCE(?, total_duration_ms)
       WHERE id = ?`,
      [
        connected_at ? new Date(connected_at) : null,
        data_sent_at ? new Date(data_sent_at) : null,
        completed_at ? new Date(completed_at) : null,
        total_duration_ms || null,
        jobId
      ]
    );
  }

  /**
   * Fetch pending print jobs specifically for a restaurant outlet (used by Local Print Agent)
   */
  static async getPendingJobsForRestaurant(restaurantId, limit = 20) {
    const parsedLimit = Math.max(1, parseInt(limit) || 20);
    const [rows] = await pool.query(
      `SELECT q.*, p.name as printer_name, p.ip_address, p.port, p.paper_width, p.role, p.type as printer_type, p.auto_cut, p.cash_drawer 
       FROM print_queue q 
       LEFT JOIN printers p ON q.printer_id = p.id 
       WHERE q.restaurant_id = ? AND q.status = "PENDING" AND q.retry_count < 3 
       ORDER BY q.id ASC LIMIT ${parsedLimit}`,
      [restaurantId]
    );
    return rows;
  }

  /**
   * Fetch all pending print jobs across all outlets
   */
  static async getPendingJobs(limit = 20) {
    const parsedLimit = Math.max(1, parseInt(limit) || 20);
    const [rows] = await pool.query(
      `SELECT q.*, p.name as printer_name, p.ip_address, p.port, p.paper_width, p.role, p.type as printer_type, p.auto_cut, p.cash_drawer 
       FROM print_queue q 
       LEFT JOIN printers p ON q.printer_id = p.id 
       WHERE q.status = "PENDING" AND q.retry_count < 3 
       ORDER BY q.id ASC LIMIT ${parsedLimit}`
    );
    return rows;
  }

  /**
   * Update print job status upon completion or failure
   */
  static async updateJobStatus(jobId, status, errorMessage = null) {
    const [result] = await pool.execute(
      'UPDATE print_queue SET status = ?, error_message = ?, printed_at = IF(? = "SUCCESS", NOW(), printed_at), completed_at = IF(? = "SUCCESS", NOW(), completed_at) WHERE id = ?',
      [status, errorMessage || null, status, status, jobId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Increment retry counter on failed attempt
   */
  static async incrementRetry(jobId, errorMessage) {
    const [result] = await pool.execute(
      'UPDATE print_queue SET retry_count = retry_count + 1, error_message = ?, status = IF(retry_count >= 3, "FAILED", "PENDING") WHERE id = ?',
      [errorMessage, jobId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Fetch print queue history for an order
   */
  static async getQueueForOrder(restaurantId, orderId) {
    const [rows] = await pool.execute(
      'SELECT q.*, p.name as printer_name FROM print_queue q LEFT JOIN printers p ON q.printer_id = p.id WHERE q.restaurant_id = ? AND q.order_id = ? ORDER BY q.id DESC',
      [restaurantId, orderId]
    );
    return rows;
  }
}

module.exports = PrintQueueRepository;
