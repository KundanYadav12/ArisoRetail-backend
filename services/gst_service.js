/**
 * Central Authoritative GST Engine for Ariso Retail
 * 
 * Provides unified, single-source-of-truth GST calculations across:
 *  - POS Checkout & Cart
 *  - Sales Invoices
 *  - Sales Orders & Estimates
 *  - Purchase Orders & Bills
 *  - Sales Returns & Credit Notes
 *  - Purchase Returns & Debit Notes
 *  - GSTR-1, GSTR-2 & HSN Reports
 */

// Master map of Indian State Codes (GST standard)
const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction'
};

class GstService {
  /**
   * Helper: Round number to specific decimals (default 2)
   */
  static round2(val) {
    const num = parseFloat(val) || 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  static round4(val) {
    const num = parseFloat(val) || 0;
    return Math.round((num + Number.EPSILON) * 10000) / 10000;
  }

  /**
   * Validate Indian GSTIN format
   */
  static validateGstin(gstin) {
    if (!gstin || typeof gstin !== 'string') {
      return { isValid: false, reason: 'GSTIN is required' };
    }
    const clean = gstin.trim().toUpperCase();
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstinRegex.test(clean)) {
      return { isValid: false, reason: 'Invalid 15-character GSTIN format' };
    }
    const stateCode = clean.substring(0, 2);
    const stateName = GST_STATE_CODES[stateCode] || 'Unknown State';
    const pan = clean.substring(2, 12);
    return {
      isValid: true,
      gstin: clean,
      stateCode,
      stateName,
      pan
    };
  }

  /**
   * Determine Place of Supply and whether transaction is Intra-State or Inter-State
   */
  static resolvePlaceOfSupply({
    storeStateCode = '27',
    storeState = 'Maharashtra',
    customerGstin = null,
    customerStateCode = null,
    customerState = null,
    manualTaxType = null
  }) {
    if (manualTaxType === 'inter' || manualTaxType === 'intra') {
      return {
        taxType: manualTaxType,
        isInterState: manualTaxType === 'inter',
        placeOfSupply: customerState || storeState
      };
    }

    let resolvedBuyerStateCode = customerStateCode ? String(customerStateCode).padStart(2, '0') : null;

    if (customerGstin) {
      const gstinVal = this.validateGstin(customerGstin);
      if (gstinVal.isValid) {
        resolvedBuyerStateCode = gstinVal.stateCode;
      }
    }

    const cleanStoreCode = String(storeStateCode || '27').padStart(2, '0');

    if (resolvedBuyerStateCode && resolvedBuyerStateCode !== cleanStoreCode) {
      return {
        taxType: 'inter',
        isInterState: true,
        buyerStateCode: resolvedBuyerStateCode,
        placeOfSupply: GST_STATE_CODES[resolvedBuyerStateCode] || customerState || 'Out of State'
      };
    }

    return {
      taxType: 'intra',
      isInterState: false,
      buyerStateCode: cleanStoreCode,
      placeOfSupply: storeState || 'Intra-State'
    };
  }

  /**
   * Calculate line-level item tax details
   */
  static calculateLineItemTax({
    price,
    quantity = 1,
    discountAmount = 0,
    gstRate = 0,
    gstMode = 'excluded', // 'excluded' | 'included'
    taxType = 'intra',    // 'intra' | 'inter'
    isTaxExempt = false,
    hsnCode = null
  }) {
    const qty = parseFloat(quantity) || 1;
    const unitPrice = parseFloat(price) || 0;
    const grossAmount = this.round2(unitPrice * qty);
    const lineDiscount = Math.min(this.round2(parseFloat(discountAmount) || 0), grossAmount);
    const amountAfterDiscount = Math.max(0, this.round2(grossAmount - lineDiscount));

    let effectiveGstRate = parseFloat(gstRate) || 0;
    if (isTaxExempt) effectiveGstRate = 0;

    let taxableAmount = 0;
    let totalTax = 0;

    if (isTaxExempt || effectiveGstRate <= 0) {
      taxableAmount = amountAfterDiscount;
      totalTax = 0;
    } else if (gstMode === 'included') {
      taxableAmount = this.round2(amountAfterDiscount / (1 + (effectiveGstRate / 100)));
      totalTax = this.round2(amountAfterDiscount - taxableAmount);
    } else {
      taxableAmount = amountAfterDiscount;
      totalTax = this.round2(taxableAmount * (effectiveGstRate / 100));
    }

    let cgstRate = 0;
    let cgstAmount = 0;
    let sgstRate = 0;
    let sgstAmount = 0;
    let igstRate = 0;
    let igstAmount = 0;

    if (totalTax > 0) {
      if (taxType === 'inter') {
        igstRate = effectiveGstRate;
        igstAmount = totalTax;
      } else {
        const halfRate = this.round2(effectiveGstRate / 2);
        const halfTax = this.round2(totalTax / 2);
        cgstRate = halfRate;
        cgstAmount = halfTax;
        sgstRate = halfRate;
        // Balance out odd cent discrepancy if totalTax is odd
        sgstAmount = this.round2(totalTax - halfTax);
      }
    }

    const lineTotal = gstMode === 'included'
      ? amountAfterDiscount
      : this.round2(taxableAmount + totalTax);

    return {
      hsnCode: hsnCode || null,
      unitPrice,
      quantity: qty,
      grossAmount,
      discountAmount: lineDiscount,
      taxableAmount,
      gstRate: effectiveGstRate,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      totalTax,
      lineTotal,
      isTaxExempt: Boolean(isTaxExempt)
    };
  }

  /**
   * Authoritative Multi-item Document Tax Calculation
   * Distributes header discounts proportionally and calculates slab summaries
   */
  static calculateDocumentTax({
    items = [],
    orderDiscountType = 'amount', // 'amount' | 'percentage'
    orderDiscountValue = 0,
    gstMode = 'excluded',         // 'excluded' | 'included'
    taxType = 'intra',            // 'intra' | 'inter'
    additionalCharges = 0,
    isComposition = false,
    storeStateCode = '27',
    customerGstin = null
  }) {
    // 1. Calculate raw subtotal from items
    let rawSubtotal = 0;
    for (const it of items) {
      const p = parseFloat(it.price || it.unit_price || 0);
      const q = parseFloat(it.quantity || it.item_weight || 1);
      rawSubtotal += (p * q);
    }
    rawSubtotal = this.round2(rawSubtotal);

    // 2. Calculate overall header discount
    let totalDiscount = 0;
    const numDiscVal = parseFloat(orderDiscountValue || 0);
    if (orderDiscountType === 'percentage') {
      totalDiscount = this.round2((rawSubtotal * numDiscVal) / 100);
    } else {
      totalDiscount = Math.min(numDiscVal, rawSubtotal);
    }

    // 3. Resolve tax type if customer GSTIN provided
    let effectiveTaxType = taxType;
    if (customerGstin) {
      const resolved = this.resolvePlaceOfSupply({ storeStateCode, customerGstin, manualTaxType: taxType });
      effectiveTaxType = resolved.taxType;
    }

    // 4. Calculate each line item with proportional discount share
    const processedItems = [];
    const slabMap = {}; // Group by gstRate

    let calculatedTaxable = 0;
    let calculatedCgst = 0;
    let calculatedSgst = 0;
    let calculatedIgst = 0;
    let calculatedTotalTax = 0;

    for (const it of items) {
      const p = parseFloat(it.price || it.unit_price || 0);
      const q = parseFloat(it.quantity || it.item_weight || 1);
      const lineGross = this.round2(p * q);

      // Proportional discount distribution
      let itemDiscount = 0;
      if (it.discount_amount !== undefined && it.discount_amount !== null && parseFloat(it.discount_amount) > 0) {
        itemDiscount = parseFloat(it.discount_amount);
      } else if (rawSubtotal > 0 && totalDiscount > 0) {
        itemDiscount = this.round2((lineGross / rawSubtotal) * totalDiscount);
      }

      const itemGstRate = isComposition ? 0 : (parseFloat(it.gst_rate !== undefined ? it.gst_rate : 5));
      const isExempt = isComposition || Boolean(it.is_tax_exempt);

      const lineCalc = this.calculateLineItemTax({
        price: p,
        quantity: q,
        discountAmount: itemDiscount,
        gstRate: itemGstRate,
        gstMode,
        taxType: effectiveTaxType,
        isTaxExempt: isExempt,
        hsnCode: it.hsn_code || it.hsnCode || null
      });

      processedItems.push({
        ...it,
        ...lineCalc
      });

      calculatedTaxable += lineCalc.taxableAmount;
      calculatedCgst += lineCalc.cgstAmount;
      calculatedSgst += lineCalc.sgstAmount;
      calculatedIgst += lineCalc.igstAmount;
      calculatedTotalTax += lineCalc.totalTax;

      // Slab aggregation
      const slabKey = `${lineCalc.gstRate}%`;
      if (!slabMap[slabKey]) {
        slabMap[slabKey] = {
          rate: lineCalc.gstRate,
          taxableAmount: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          totalTax: 0
        };
      }
      slabMap[slabKey].taxableAmount = this.round2(slabMap[slabKey].taxableAmount + lineCalc.taxableAmount);
      slabMap[slabKey].cgstAmount = this.round2(slabMap[slabKey].cgstAmount + lineCalc.cgstAmount);
      slabMap[slabKey].sgstAmount = this.round2(slabMap[slabKey].sgstAmount + lineCalc.sgstAmount);
      slabMap[slabKey].igstAmount = this.round2(slabMap[slabKey].igstAmount + lineCalc.igstAmount);
      slabMap[slabKey].totalTax = this.round2(slabMap[slabKey].totalTax + lineCalc.totalTax);
    }

    const finalTaxable = this.round2(calculatedTaxable);
    const finalCgst = this.round2(calculatedCgst);
    const finalSgst = this.round2(calculatedSgst);
    const finalIgst = this.round2(calculatedIgst);
    const finalTotalTax = this.round2(calculatedTotalTax);

    const addCharges = this.round2(parseFloat(additionalCharges) || 0);

    let rawGrandTotal = 0;
    if (gstMode === 'included') {
      rawGrandTotal = this.round2(Math.max(0, rawSubtotal - totalDiscount) + addCharges);
    } else {
      rawGrandTotal = this.round2(finalTaxable + finalTotalTax + addCharges);
    }

    const roundedGrandTotal = Math.round(rawGrandTotal);
    const roundOff = this.round2(roundedGrandTotal - rawGrandTotal);

    const slabs = Object.values(slabMap).sort((a, b) => a.rate - b.rate);

    return {
      subtotal: rawSubtotal,
      discountAmount: totalDiscount,
      taxableAmount: finalTaxable,
      cgstAmount: finalCgst,
      sgstAmount: finalSgst,
      igstAmount: finalIgst,
      totalTax: finalTotalTax,
      additionalCharges: addCharges,
      roundOff,
      grandTotal: roundedGrandTotal,
      rawGrandTotal,
      taxType: effectiveTaxType,
      gstMode,
      items: processedItems,
      slabs,
      taxInvoiceType: isComposition ? 'BILL_OF_SUPPLY' : (finalTotalTax > 0 ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY')
    };
  }
}

module.exports = {
  GstService,
  GST_STATE_CODES
};
