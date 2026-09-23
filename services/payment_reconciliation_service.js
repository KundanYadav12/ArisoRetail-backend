const PaymentReconciliationRepository = require('../repositories/payment_reconciliation_repository');

class PaymentReconciliationService {
  /**
   * Get Overview: Summary metrics + active settlements + unreconciled count
   */
  static async getOverview(restaurantId, filters = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');
    const summary = await PaymentReconciliationRepository.getSummaryMetrics(restaurantId, filters);
    const settlements = await PaymentReconciliationRepository.findAllSettlements(restaurantId, {
      ...filters,
      limit: 10,
      offset: 0
    });
    return {
      summary,
      recent_settlements: settlements.settlements,
      total_settlements: settlements.total
    };
  }

  /**
   * Get Unreconciled POS Payments awaiting settlement
   */
  static async getUnreconciledPayments(restaurantId, filters = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');
    return PaymentReconciliationRepository.getUnreconciledPayments(restaurantId, filters);
  }

  /**
   * Get All Settlements with pagination & filtering
   */
  static async getSettlements(restaurantId, filters = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');
    return PaymentReconciliationRepository.findAllSettlements(restaurantId, filters);
  }

  /**
   * Get Settlement by ID with matched details
   */
  static async getSettlementById(restaurantId, id) {
    if (!restaurantId || !id) throw new Error('Restaurant ID and Settlement ID are required.');
    const settlement = await PaymentReconciliationRepository.findSettlementById(id, restaurantId);
    if (!settlement) {
      throw new Error(`Settlement #${id} not found.`);
    }
    return settlement;
  }

  /**
   * Record a new Settlement Batch
   */
  static async recordSettlement(restaurantId, settlementData, user = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');

    const {
      account_id,
      payment_mode,
      gross_amount,
      settlement_date
    } = settlementData;

    if (!account_id) throw new Error('Financial account is required.');
    if (!payment_mode) throw new Error('Payment mode is required.');
    if (!gross_amount || parseFloat(gross_amount) <= 0) {
      throw new Error('Gross settlement amount must be greater than zero.');
    }

    const settlement = await PaymentReconciliationRepository.createSettlement(
      restaurantId,
      settlementData,
      user
    );

    // If auto_match requested on create, trigger auto matching
    if (settlementData.auto_match) {
      await PaymentReconciliationRepository.runAutoMatching(restaurantId, settlement.id, user);
      return PaymentReconciliationRepository.findSettlementById(settlement.id, restaurantId);
    }

    return settlement;
  }

  /**
   * Match Settlement to POS Payments
   */
  static async matchSettlement(restaurantId, matchData, user = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');
    const { settlementId, matches, varianceReason } = matchData;

    if (!settlementId) throw new Error('Settlement ID is required.');
    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      throw new Error('At least one payment must be selected for matching.');
    }

    // Role check
    const role = (user.role || '').toLowerCase();
    if (role === 'cashier') {
      throw new Error('Unauthorized: Cashiers cannot execute payment reconciliation.');
    }

    // Check if any match has variance without reason
    for (const m of matches) {
      const exp = parseFloat(m.expected_amount || 0);
      const set = parseFloat(m.settled_amount || 0);
      const isPartial = Boolean(m.is_partial);
      const diff = Math.abs(set - exp);
      if (diff > 0.01 && !isPartial && !m.variance_reason && !varianceReason) {
        throw new Error(`A variance of ₹${(set - exp).toFixed(2)} was detected. A variance reason is mandatory before reconciling.`);
      }
    }

    return PaymentReconciliationRepository.matchSettlement(restaurantId, matchData, user);
  }

  /**
   * Run Auto-Matching Engine
   */
  static async runAutoMatching(restaurantId, settlementId = null, user = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');
    return PaymentReconciliationRepository.runAutoMatching(restaurantId, settlementId, user);
  }

  /**
   * Create Audited Financial Adjustment
   */
  static async createAdjustment(restaurantId, adjustmentData, user = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');

    const role = (user.role || '').toLowerCase();
    if (!['admin', 'manager', 'owner', 'super_admin'].includes(role)) {
      throw new Error('Unauthorized: Only Admin or Manager can create financial adjustments.');
    }

    const { account_id, adjustment_type, amount, reason } = adjustmentData;
    if (!account_id || !adjustment_type || !amount || !reason) {
      throw new Error('Account, adjustment type, amount, and reason are required.');
    }

    return PaymentReconciliationRepository.createAdjustment(restaurantId, adjustmentData, user);
  }

  /**
   * Unmatch / Reverse Settlement Item
   */
  static async unmatchItem(restaurantId, settlementItemId, user = {}) {
    if (!restaurantId) throw new Error('Restaurant ID is required.');

    const role = (user.role || '').toLowerCase();
    if (!['admin', 'manager', 'owner', 'super_admin'].includes(role)) {
      throw new Error('Unauthorized: Only Admin or Manager can reverse or unmatch reconciliations.');
    }

    return PaymentReconciliationRepository.unmatchSettlementItem(restaurantId, settlementItemId, user);
  }
}

module.exports = PaymentReconciliationService;
