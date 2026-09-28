/**
 * PurchaseBillPDFService
 * Generates a professional A4 PDF for a Purchase Bill using PDFKit.
 * Includes: header branding, meta, parties, GST-split items table,
 * totals block, amount-in-words, bank details, notes, and footer.
 */
const PDFDocument = require('pdfkit');
const pool = require('../config/db');

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  return parseFloat(n || 0).toFixed(2);
}

function fmtDate(d) {
  if (!d) return 'N/A';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d).split('T')[0];
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Converts a number to Indian words (handles up to crores).
 */
function numberToWords(num) {
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven',
    'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
    'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty',
    'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertHundreds(n) {
    let str = '';
    if (n >= 100) { str += units[Math.floor(n / 100)] + ' Hundred '; n %= 100; }
    if (n >= 20) { str += tens[Math.floor(n / 10)] + ' '; n %= 10; }
    if (n > 0) str += units[n] + ' ';
    return str.trim();
  }

  const n = Math.round(num);
  if (n === 0) return 'Zero';
  if (n < 0) return 'Minus ' + numberToWords(-n);

  let result = '';
  if (n >= 10000000) { result += convertHundreds(Math.floor(n / 10000000)) + ' Crore '; }
  const rem1 = n % 10000000;
  if (rem1 >= 100000) { result += convertHundreds(Math.floor(rem1 / 100000)) + ' Lakh '; }
  const rem2 = rem1 % 100000;
  if (rem2 >= 1000) { result += convertHundreds(Math.floor(rem2 / 1000)) + ' Thousand '; }
  const rem3 = rem2 % 1000;
  result += convertHundreds(rem3);
  return result.trim();
}

function amountInWords(total) {
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);
  let words = numberToWords(rupees) + ' Rupees';
  if (paise > 0) words += ' and ' + numberToWords(paise) + ' Paise';
  return words + ' Only';
}

// ── Branding fetch ──────────────────────────────────────────────────────────

async function fetchBranding(restaurantId) {
  const [rows] = await pool.execute(
    `SELECT restaurant_name, branch_name, address, phone, email,
            gst_number, logo_url, state, state_code, legal_name, trade_name,
            terms_conditions, footer_message
     FROM receipt_settings WHERE restaurant_id = ?`,
    [restaurantId]
  );
  return rows[0] || {};
}

// ── Bill fetch with all fields ─────────────────────────────────────────────

async function fetchFullBill(billId, restaurantId) {
  const [headerRows] = await pool.execute(`
    SELECT
      pb.*,
      s.name        AS supplier_name,
      s.company_name AS supplier_company,
      s.mobile      AS supplier_mobile,
      s.email       AS supplier_email,
      s.address     AS supplier_address,
      s.city        AS supplier_city,
      s.state       AS supplier_state,
      s.gst_number  AS supplier_gst,
      w.name        AS warehouse_name,
      w.code        AS warehouse_code,
      w.address     AS warehouse_address,
      po.po_number
    FROM purchase_bills pb
    LEFT JOIN suppliers  s  ON pb.supplier_id   = s.id
    LEFT JOIN warehouses w  ON pb.warehouse_id  = w.id
    LEFT JOIN purchase_orders po ON pb.purchase_order_id = po.id
    WHERE pb.id = ? AND pb.restaurant_id = ?
  `, [billId, restaurantId]);

  if (!headerRows.length) return null;
  const bill = headerRows[0];

  const [items] = await pool.execute(`
    SELECT pbi.*,
           mi.sku, mi.item_code, mi.hsn_code AS mi_hsn
    FROM purchase_bill_items pbi
    JOIN menu_items mi ON pbi.menu_item_id = mi.id
    WHERE pbi.purchase_bill_id = ?
    ORDER BY pbi.id ASC
  `, [billId]);

  bill.items = items;
  return bill;
}

// ── Core PDF builder ────────────────────────────────────────────────────────

async function generatePurchaseBillPDF(billId, restaurantId) {
  const [branding, bill] = await Promise.all([
    fetchBranding(restaurantId),
    fetchFullBill(billId, restaurantId)
  ]);

  if (!bill) throw new Error('Purchase bill not found.');

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 36, bottom: 36, left: 40, right: 40 },
      autoFirstPage: true,
      bufferPages: true
    });

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pw = doc.page.width - 80;   // usable width (40 margins each side)
    const ml = 40;
    let y = 36;

    // ── colours / fonts
    const ORANGE   = '#EA580C';
    const DARK     = '#0F172A';
    const MID      = '#475569';
    const LIGHT_BG = '#F8FAFC';
    const BORDER   = '#CBD5E1';

    // ─────────────────────────────────────────────────────────────
    // HEADER
    // ─────────────────────────────────────────────────────────────
    doc.rect(ml, y, pw, 72).fillAndStroke(LIGHT_BG, BORDER);

    // Business name & address (left)
    doc.fillColor(ORANGE)
       .font('Helvetica-Bold').fontSize(15)
       .text(branding.restaurant_name || 'Business', ml + 10, y + 10, { width: pw * 0.6 });
    doc.fillColor(MID).font('Helvetica').fontSize(8)
       .text([branding.branch_name, branding.address, branding.phone, branding.email]
              .filter(Boolean).join(' | '), ml + 10, y + 30, { width: pw * 0.6 });
    if (branding.gst_number) {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8)
         .text('GSTIN: ' + branding.gst_number, ml + 10, y + 45);
    }

    // "PURCHASE BILL" badge (right)
    const badgeX = ml + pw * 0.7;
    doc.rect(badgeX, y + 8, pw * 0.28, 28).fill(ORANGE);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13)
       .text('PURCHASE BILL', badgeX + 4, y + 15, { width: pw * 0.28, align: 'center' });

    y += 80;

    // ─────────────────────────────────────────────────────────────
    // META ROW  (Bill #, Vendor Inv #, Date, Due, PO, Status)
    // ─────────────────────────────────────────────────────────────
    const metaItems = [
      { label: 'Internal Ref', value: bill.internal_bill_number },
      { label: 'Vendor Invoice #', value: bill.bill_number },
      { label: 'Bill Date', value: fmtDate(bill.bill_date) },
      { label: 'Due Date', value: fmtDate(bill.due_date) },
      { label: 'PO #', value: bill.po_number || '—' },
      { label: 'Place of Supply', value: bill.place_of_supply || '—' }
    ];

    const metaColW = pw / metaItems.length;
    doc.rect(ml, y, pw, 38).fillAndStroke(DARK, DARK);
    metaItems.forEach((m, i) => {
      const x = ml + i * metaColW + 4;
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(6.5)
         .text(m.label.toUpperCase(), x, y + 5, { width: metaColW - 8 });
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
         .text(m.value, x, y + 16, { width: metaColW - 8 });
    });

    y += 46;

    // ─────────────────────────────────────────────────────────────
    // PARTIES  (Bill From  /  Ship To)
    // ─────────────────────────────────────────────────────────────
    const partyH = 70;
    const colW   = (pw - 8) / 2;

    // Bill From
    doc.rect(ml, y, colW, partyH).fillAndStroke('#FFF7ED', BORDER);
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(8)
       .text('BILL FROM (VENDOR)', ml + 8, y + 6);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
       .text(bill.supplier_company || bill.supplier_name || '—', ml + 8, y + 18, { width: colW - 16 });
    doc.fillColor(MID).font('Helvetica').fontSize(7.5)
       .text([bill.supplier_address, bill.supplier_city, bill.supplier_state]
              .filter(Boolean).join(', '), ml + 8, y + 30, { width: colW - 16 });
    if (bill.supplier_gst) {
      doc.fillColor(DARK).font('Helvetica').fontSize(7.5)
         .text('GSTIN: ' + bill.supplier_gst, ml + 8, y + 50);
    }
    if (bill.supplier_mobile) {
      doc.fillColor(MID).fontSize(7.5)
         .text('Ph: ' + bill.supplier_mobile, ml + 8, y + 59);
    }

    // Ship To
    const shipX = ml + colW + 8;
    doc.rect(shipX, y, colW, partyH).fillAndStroke('#F0FDF4', BORDER);
    doc.fillColor('#16A34A').font('Helvetica-Bold').fontSize(8)
       .text('RECEIVING WAREHOUSE', shipX + 8, y + 6);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
       .text(bill.warehouse_name || '—', shipX + 8, y + 18, { width: colW - 16 });
    if (bill.warehouse_code) {
      doc.fillColor(MID).font('Helvetica').fontSize(7.5)
         .text('Code: ' + bill.warehouse_code, shipX + 8, y + 30);
    }
    if (bill.warehouse_address) {
      doc.fillColor(MID).fontSize(7.5)
         .text(bill.warehouse_address, shipX + 8, y + 42, { width: colW - 16 });
    }

    y += partyH + 10;

    // ─────────────────────────────────────────────────────────────
    // ITEMS TABLE
    // ─────────────────────────────────────────────────────────────
    const taxType = (bill.tax_type || 'intra').toLowerCase();
    const isIGST  = taxType === 'inter';

    // Column definitions
    const cols = isIGST
      ? [
          { label: '#',          w: 22,   align: 'center' },
          { label: 'Item',       w: 160,  align: 'left'   },
          { label: 'HSN',        w: 48,   align: 'center' },
          { label: 'Qty',        w: 38,   align: 'right'  },
          { label: 'Unit',       w: 32,   align: 'center' },
          { label: 'Rate (₹)',   w: 60,   align: 'right'  },
          { label: 'IGST %',     w: 40,   align: 'right'  },
          { label: 'IGST (₹)',   w: 55,   align: 'right'  },
          { label: 'Amount (₹)', w: 65,   align: 'right'  }
        ]
      : [
          { label: '#',          w: 22,   align: 'center' },
          { label: 'Item',       w: 140,  align: 'left'   },
          { label: 'HSN',        w: 45,   align: 'center' },
          { label: 'Qty',        w: 35,   align: 'right'  },
          { label: 'Unit',       w: 30,   align: 'center' },
          { label: 'Rate (₹)',   w: 55,   align: 'right'  },
          { label: 'CGST %',     w: 38,   align: 'right'  },
          { label: 'CGST (₹)',   w: 50,   align: 'right'  },
          { label: 'SGST %',     w: 38,   align: 'right'  },
          { label: 'SGST (₹)',   w: 50,   align: 'right'  },
          { label: 'Amount (₹)', w: 57,   align: 'right'  }
        ];

    // Scale cols to fit pw exactly
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const scale  = pw / totalW;
    cols.forEach(c => { c.w = Math.floor(c.w * scale); });
    // Adjust last col for rounding
    const usedW = cols.reduce((s, c) => s + c.w, 0);
    cols[cols.length - 1].w += pw - usedW;

    const rowH = 18;
    const headH = 20;

    // Header row
    doc.rect(ml, y, pw, headH).fill(DARK);
    let cx = ml;
    cols.forEach(col => {
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7)
         .text(col.label, cx + 2, y + 6, { width: col.w - 4, align: col.align });
      cx += col.w;
    });
    y += headH;

    // Data rows
    let totalQty = 0;
    const items = bill.items || [];

    items.forEach((it, idx) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      doc.rect(ml, y, pw, rowH).fillAndStroke(bg, BORDER);

      const qty    = parseFloat(it.quantity || 0);
      const rate   = parseFloat(it.rate || 0);
      const hsn    = it.hsn_code || it.mi_hsn || '—';
      const cgstR  = parseFloat(it.cgst_rate || 0);
      const sgstR  = parseFloat(it.sgst_rate || 0);
      const igstR  = parseFloat(it.igst_rate || 0);
      const cgstA  = parseFloat(it.cgst_amount || 0);
      const sgstA  = parseFloat(it.sgst_amount || 0);
      const igstA  = parseFloat(it.igst_amount || 0);
      const total  = parseFloat(it.total_amount || 0);
      totalQty += qty;

      const rowVals = isIGST
        ? [
            String(idx + 1),
            it.item_name + (it.batch_number ? `\nBatch: ${it.batch_number}` : ''),
            hsn,
            fmt(qty),
            it.unit || 'pcs',
            fmt(rate),
            `${igstR}%`,
            fmt(igstA),
            fmt(total)
          ]
        : [
            String(idx + 1),
            it.item_name + (it.batch_number ? `\nBatch: ${it.batch_number}` : ''),
            hsn,
            fmt(qty),
            it.unit || 'pcs',
            fmt(rate),
            `${cgstR}%`,
            fmt(cgstA),
            `${sgstR}%`,
            fmt(sgstA),
            fmt(total)
          ];

      cx = ml;
      cols.forEach((col, ci) => {
        doc.fillColor(DARK).font('Helvetica').fontSize(7.5)
           .text(rowVals[ci] || '', cx + 2, y + 4, { width: col.w - 4, align: col.align, lineBreak: false });
        cx += col.w;
      });

      y += rowH;

      // Page overflow guard
      if (y > doc.page.height - 160) {
        doc.addPage();
        y = 36;
      }
    });

    // Subtotal row
    doc.rect(ml, y, pw, rowH).fillAndStroke('#EFF6FF', BORDER);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7.5)
       .text('SUBTOTAL', ml + 2, y + 4, { width: pw * 0.5 });
    const subColIdx = cols.length - 1;
    let sx = ml;
    cols.forEach((col, ci) => {
      if (ci === subColIdx) {
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7.5)
           .text('₹' + fmt(bill.subtotal), sx + 2, y + 4, { width: col.w - 4, align: 'right' });
      } else if (ci === cols.findIndex(c => c.label.startsWith('Qty'))) {
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7.5)
           .text(fmt(totalQty), sx + 2, y + 4, { width: col.w - 4, align: 'right' });
      }
      sx += col.w;
    });
    y += rowH + 10;

    // ─────────────────────────────────────────────────────────────
    // TOTALS BLOCK  (right side) + AMOUNT IN WORDS (left)
    // ─────────────────────────────────────────────────────────────
    const totalsW = 230;
    const totalsX = ml + pw - totalsW;
    const wordsW  = pw - totalsW - 10;

    // Amount in words
    const grandTotal = parseFloat(bill.total_amount || 0);
    doc.rect(ml, y, wordsW, 70).fillAndStroke('#FFFBEB', BORDER);
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(7.5)
       .text('AMOUNT IN WORDS', ml + 6, y + 6);
    doc.fillColor(DARK).font('Helvetica').fontSize(8)
       .text(amountInWords(grandTotal), ml + 6, y + 18, { width: wordsW - 12 });

    // Totals table
    const totalsRows = [];
    const subtotal = parseFloat(bill.subtotal || 0);
    const disc     = parseFloat(bill.discount_amount || 0);
    const addChg   = parseFloat(bill.additional_charges || 0);
    const taxable  = subtotal - disc;
    const paid     = parseFloat(bill.paid_amount || 0);
    const balance  = Math.max(0, grandTotal - paid);

    totalsRows.push({ label: 'Subtotal',           value: '₹' + fmt(subtotal)  });
    if (disc > 0)   totalsRows.push({ label: 'Discount',  value: '- ₹' + fmt(disc) });
    if (addChg > 0) totalsRows.push({ label: 'Additional Charges', value: '+ ₹' + fmt(addChg) });
    totalsRows.push({ label: 'Taxable Amount',      value: '₹' + fmt(taxable)  });

    if (isIGST) {
      totalsRows.push({ label: 'IGST',              value: '₹' + fmt(bill.igst_amount || 0) });
    } else {
      totalsRows.push({ label: 'CGST',              value: '₹' + fmt(bill.cgst_amount || 0) });
      totalsRows.push({ label: 'SGST',              value: '₹' + fmt(bill.sgst_amount || 0) });
    }

    totalsRows.push({ label: 'Grand Total',         value: '₹' + fmt(grandTotal), bold: true });
    totalsRows.push({ label: 'Amount Paid',         value: '₹' + fmt(paid)        });
    totalsRows.push({ label: 'Balance Due',         value: '₹' + fmt(balance),    bold: balance > 0 });

    const totRowH = 18;
    totalsRows.forEach((row, ri) => {
      const ry  = y + ri * totRowH;
      const bgC = row.bold ? (row.label === 'Grand Total' ? DARK : '#FFF7ED') : '#FFFFFF';
      const fc  = row.bold ? (row.label === 'Grand Total' ? '#FFFFFF' : ORANGE) : MID;
      doc.rect(totalsX, ry, totalsW, totRowH).fillAndStroke(bgC, BORDER);
      doc.fillColor(fc).font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
         .text(row.label, totalsX + 6, ry + 4, { width: totalsW * 0.55 });
      doc.text(row.value, totalsX + totalsW * 0.55, ry + 4, { width: totalsW * 0.4, align: 'right' });
    });

    y += Math.max(70, totalsRows.length * totRowH) + 14;

    // Page overflow guard
    if (y > doc.page.height - 130) {
      doc.addPage();
      y = 36;
    }

    // ─────────────────────────────────────────────────────────────
    // PAYMENT STATUS BADGE
    // ─────────────────────────────────────────────────────────────
    const ps = (bill.payment_status || 'unpaid').toUpperCase();
    const badgeColor = ps === 'PAID' ? '#16A34A' : ps === 'PARTIALLY_PAID' ? '#D97706' : '#DC2626';
    doc.rect(ml, y, 130, 22).fill(badgeColor);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
       .text('STATUS: ' + ps, ml + 6, y + 6, { width: 118 });
    if (bill.payment_mode) {
      doc.fillColor(MID).font('Helvetica').fontSize(8)
         .text('Mode: ' + bill.payment_mode, ml + 140, y + 7);
    }
    y += 32;

    // ─────────────────────────────────────────────────────────────
    // NOTES
    // ─────────────────────────────────────────────────────────────
    if (bill.notes) {
      doc.rect(ml, y, pw, 26).fillAndStroke('#F1F5F9', BORDER);
      doc.fillColor(MID).font('Helvetica-Bold').fontSize(7.5)
         .text('NOTES:', ml + 6, y + 5);
      doc.fillColor(DARK).font('Helvetica').fontSize(7.5)
         .text(bill.notes, ml + 48, y + 5, { width: pw - 60, lineBreak: false });
      y += 32;
    }

    // ─────────────────────────────────────────────────────────────
    // BANK DETAILS  +  T&C  +  SIGNATURE
    // ─────────────────────────────────────────────────────────────
    const footerH = 70;
    if (y + footerH > doc.page.height - 50) {
      doc.addPage();
      y = 36;
    }

    const thirdW = (pw - 16) / 3;

    // Bank details
    doc.rect(ml, y, thirdW, footerH).fillAndStroke('#F8FAFC', BORDER);
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(7.5)
       .text('BANK DETAILS', ml + 6, y + 6);
    const bankLines = [
      branding.bank_name || '',
      branding.terms_conditions || ''
    ].join('\n');
    doc.fillColor(MID).font('Helvetica').fontSize(7)
       .text(bankLines || 'Contact us for bank details.', ml + 6, y + 18, { width: thirdW - 12 });

    // T&C
    const tcX = ml + thirdW + 8;
    doc.rect(tcX, y, thirdW, footerH).fillAndStroke('#F8FAFC', BORDER);
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(7.5)
       .text('TERMS & CONDITIONS', tcX + 6, y + 6);
    doc.fillColor(MID).font('Helvetica').fontSize(7)
       .text(branding.terms_conditions || 'Payment as per agreed terms.', tcX + 6, y + 18, { width: thirdW - 12 });

    // Signature
    const sigX = tcX + thirdW + 8;
    doc.rect(sigX, y, thirdW, footerH).fillAndStroke('#F8FAFC', BORDER);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7.5)
       .text('AUTHORISED SIGNATORY', sigX + 6, y + 6);
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(9)
       .text(branding.restaurant_name || '', sigX + 6, y + 45, { width: thirdW - 12 });

    y += footerH + 10;

    // ─────────────────────────────────────────────────────────────
    // FOOTER
    // ─────────────────────────────────────────────────────────────
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
       .text('This is a computer generated bill.', ml, y, { width: pw, align: 'center' });

    doc.end();
  });
}

module.exports = { generatePurchaseBillPDF, fetchFullBill, fetchBranding, amountInWords };
