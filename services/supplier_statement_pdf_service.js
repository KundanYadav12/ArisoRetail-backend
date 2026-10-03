/**
 * SupplierStatementPDFService
 * Generates an executive A4 PDF for Supplier Statement of Account using PDFKit.
 * Includes: branding header, supplier profile, active filter metadata,
 * 5 summary KPI cards, and detailed transaction ledger table (with empty state).
 */
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const SupplierPayableRepository = require('../repositories/supplier_payable_repository');

function fmt(n) {
  return parseFloat(n || 0).toFixed(2);
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d).split('T')[0];
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function fetchBranding(restaurantId) {
  const [rows] = await pool.execute(
    `SELECT restaurant_name, branch_name, address, phone, email, gst_number
     FROM receipt_settings WHERE restaurant_id = ?`,
    [restaurantId]
  );
  return rows[0] || {};
}

/**
 * Generate Supplier Statement PDF Buffer
 */
async function generateSupplierStatementPDF(supplierId, restaurantId, filters = {}) {
  const [branding, ledgerData] = await Promise.all([
    fetchBranding(restaurantId),
    SupplierPayableRepository.getDetailedLedger(supplierId, restaurantId, filters)
  ]);

  if (!ledgerData || !ledgerData.supplier) {
    throw new Error('Supplier statement not found.');
  }

  const supp = ledgerData.supplier;
  const summary = ledgerData.summary;
  const entries = ledgerData.ledger || [];

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 36, bottom: 36, left: 36, right: 36 },
      autoFirstPage: true,
      bufferPages: true
    });

    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ml = 36;
    const pw = doc.page.width - ml * 2; // usable width: 523pt
    let y = 36;

    // Palette
    const PRIMARY = '#0284c7';
    const DARK    = '#0f172a';
    const MID     = '#475569';
    const MUTED   = '#64748b';
    const LIGHT   = '#f8fafc';
    const BORDER  = '#cbd5e1';
    const DEBIT   = '#dc2626';
    const CREDIT  = '#16a34a';

    // ─────────────────────────────────────────────────────────────
    // HEADER BLOCK
    // ─────────────────────────────────────────────────────────────
    doc.rect(ml, y, pw, 70).fillAndStroke(LIGHT, BORDER);

    // Business Name & Store details
    doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(14)
       .text(branding.restaurant_name || 'ARISO RETAIL STORE', ml + 12, y + 10, { width: pw * 0.58 });

    const contactParts = [branding.branch_name, branding.address, branding.phone, branding.email].filter(Boolean);
    doc.fillColor(MID).font('Helvetica').fontSize(8)
       .text(contactParts.join(' • '), ml + 12, y + 28, { width: pw * 0.58 });

    if (branding.gst_number) {
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8)
         .text(`GSTIN: ${branding.gst_number}`, ml + 12, y + 50);
    }

    // Title Badge (Right side)
    const titleW = 190;
    const titleX = ml + pw - titleW - 10;
    doc.rect(titleX, y + 10, titleW, 24).fill(DARK);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
       .text('STATEMENT OF ACCOUNT', titleX, y + 16, { width: titleW, align: 'center' });

    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
       .text(`Generated: ${fmtDate(new Date())}`, titleX, y + 38, { width: titleW, align: 'right' });

    const periodStr = `${filters.date_from ? fmtDate(filters.date_from) : 'Inception'} to ${filters.date_to ? fmtDate(filters.date_to) : 'Present'}`;
    doc.fillColor(MID).font('Helvetica-Bold').fontSize(7.5)
       .text(`Period: ${periodStr}`, titleX, y + 49, { width: titleW, align: 'right' });

    y += 78;

    // ─────────────────────────────────────────────────────────────
    // SUPPLIER INFO BAR
    // ─────────────────────────────────────────────────────────────
    doc.rect(ml, y, pw, 46).fillAndStroke('#f1f5f9', BORDER);

    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5)
       .text('SUPPLIER / VENDOR DETAILS', ml + 10, y + 8);

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
       .text(`${supp.name} ${supp.company_name ? `(${supp.company_name})` : ''}`, ml + 10, y + 18, { width: pw * 0.6 });

    const suppDetails = [
      `Code: ${supp.supplier_code}`,
      supp.mobile ? `Mobile: ${supp.mobile}` : null,
      supp.email ? `Email: ${supp.email}` : null,
      supp.gst_number ? `GSTIN: ${supp.gst_number}` : null
    ].filter(Boolean).join('  |  ');

    doc.fillColor(MID).font('Helvetica').fontSize(8)
       .text(suppDetails, ml + 10, y + 32, { width: pw - 20 });

    y += 52;

    // ─────────────────────────────────────────────────────────────
    // 5 SUMMARY KPI CARDS
    // ─────────────────────────────────────────────────────────────
    const cardGap = 6;
    const cardW = (pw - cardGap * 4) / 5;
    const cardH = 46;

    const cards = [
      { label: 'OPENING BALANCE', value: `Rs. ${fmt(summary.opening_balance)}`, color: DARK, border: BORDER, bg: '#ffffff' },
      { label: 'TOTAL INVOICED', value: `+Rs. ${fmt(summary.total_debit)}`, color: DEBIT, border: '#fca5a5', bg: '#fef2f2' },
      { label: 'TOTAL SETTLED', value: `-Rs. ${fmt(summary.total_credit)}`, color: CREDIT, border: '#86efac', bg: '#f0fdf4' },
      { label: 'CLOSING BALANCE', value: `Rs. ${fmt(summary.closing_balance)}`, color: summary.closing_balance > 0 ? DEBIT : CREDIT, border: summary.closing_balance > 0 ? '#fca5a5' : '#86efac', bg: summary.closing_balance > 0 ? '#fff1f2' : '#f0fdf4' },
      { label: 'AVAILABLE ADVANCE', value: `Rs. ${fmt(summary.advance_balance)}`, color: '#059669', border: '#86efac', bg: '#f0fdf4' }
    ];

    cards.forEach((c, idx) => {
      const cx = ml + idx * (cardW + cardGap);
      doc.rect(cx, y, cardW, cardH).fillAndStroke(c.bg, c.border);

      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6.5)
         .text(c.label, cx + 4, y + 8, { width: cardW - 8, align: 'center' });

      doc.fillColor(c.color).font('Helvetica-Bold').fontSize(9.5)
         .text(c.value, cx + 4, y + 24, { width: cardW - 8, align: 'center' });
    });

    y += 54;

    // ─────────────────────────────────────────────────────────────
    // TRANSACTIONS TABLE
    // ─────────────────────────────────────────────────────────────
    const cols = [
      { label: 'Date',          w: 62,  align: 'left' },
      { label: 'Type',          w: 78,  align: 'left' },
      { label: 'Reference',     w: 70,  align: 'left' },
      { label: 'Mode',          w: 52,  align: 'left' },
      { label: 'Notes',         w: 96,  align: 'left' },
      { label: 'Debit (+)',     w: 55,  align: 'right' },
      { label: 'Credit (-)',    w: 55,  align: 'right' },
      { label: 'Balance',       w: 55,  align: 'right' }
    ];

    function drawTableHeader(curY) {
      doc.rect(ml, curY, pw, 18).fillAndStroke(DARK, DARK);
      let curX = ml;
      cols.forEach(col => {
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5)
           .text(col.label, curX + 3, curY + 5, { width: col.w - 6, align: col.align });
        curX += col.w;
      });
      return curY + 18;
    }

    y = drawTableHeader(y);

    if (entries.length === 0) {
      // Empty state box
      doc.rect(ml, y, pw, 45).fillAndStroke(LIGHT, BORDER);
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
         .text('No transactions recorded for this supplier matching the selected filters.', ml + 10, y + 16, { width: pw - 20, align: 'center' });
      y += 50;
    } else {
      entries.forEach((row, idx) => {
        const rowH = 17;
        // Page break check
        if (y + rowH > doc.page.height - 45) {
          doc.addPage();
          y = 36;
          y = drawTableHeader(y);
        }

        const bg = idx % 2 === 1 ? '#f8fafc' : '#ffffff';
        doc.rect(ml, y, pw, rowH).fillAndStroke(bg, '#e2e8f0');

        let curX = ml;
        const debitVal = parseFloat(row.debit || 0);
        const creditVal = parseFloat(row.credit || 0);
        const balVal = parseFloat(row.balance_after || 0);

        // Date
        doc.fillColor(DARK).font('Helvetica').fontSize(7)
           .text(fmtDate(row.created_at), curX + 3, y + 4, { width: cols[0].w - 6, align: 'left' });
        curX += cols[0].w;

        // Type
        const typeStr = (row.transaction_type || '').replace(/_/g, ' ');
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7)
           .text(typeStr, curX + 3, y + 4, { width: cols[1].w - 6, align: 'left' });
        curX += cols[1].w;

        // Reference
        doc.fillColor(MID).font('Helvetica').fontSize(7)
           .text(row.reference_number || '—', curX + 3, y + 4, { width: cols[2].w - 6, align: 'left' });
        curX += cols[2].w;

        // Mode
        doc.fillColor(MUTED).font('Helvetica').fontSize(7)
           .text(row.payment_mode || '—', curX + 3, y + 4, { width: cols[3].w - 6, align: 'left' });
        curX += cols[3].w;

        // Notes
        const cleanNotes = (row.notes || '—').replace(/\r?\n/g, ' ');
        doc.fillColor(MUTED).font('Helvetica').fontSize(6.5)
           .text(cleanNotes, curX + 3, y + 4, { width: cols[4].w - 6, height: rowH - 2, ellipsis: true });
        curX += cols[4].w;

        // Debit
        if (debitVal > 0) {
          doc.fillColor(DEBIT).font('Helvetica-Bold').fontSize(7)
             .text(`+${fmt(debitVal)}`, curX + 2, y + 4, { width: cols[5].w - 4, align: 'right' });
        } else {
          doc.fillColor(MUTED).font('Helvetica').fontSize(7)
             .text('—', curX + 2, y + 4, { width: cols[5].w - 4, align: 'right' });
        }
        curX += cols[5].w;

        // Credit
        if (creditVal > 0) {
          doc.fillColor(CREDIT).font('Helvetica-Bold').fontSize(7)
             .text(`-${fmt(creditVal)}`, curX + 2, y + 4, { width: cols[6].w - 4, align: 'right' });
        } else {
          doc.fillColor(MUTED).font('Helvetica').fontSize(7)
             .text('—', curX + 2, y + 4, { width: cols[6].w - 4, align: 'right' });
        }
        curX += cols[6].w;

        // Balance
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(7)
           .text(`Rs. ${fmt(balVal)}`, curX + 2, y + 4, { width: cols[7].w - 4, align: 'right' });

        y += rowH;
      });
    }

    // ─────────────────────────────────────────────────────────────
    // FOOTER (Applied to all pages)
    // ─────────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 28;

      doc.rect(ml, footerY - 5, pw, 0.5).fill(BORDER);

      doc.fillColor(MUTED).font('Helvetica').fontSize(7)
         .text('Ariso Retail POS • Confidential Supplier Statement of Account', ml, footerY, { width: pw * 0.7 });

      doc.fillColor(MUTED).font('Helvetica').fontSize(7)
         .text(`Page ${i + 1} of ${range.count}`, ml + pw * 0.7, footerY, { width: pw * 0.3, align: 'right' });
    }

    doc.end();
  });
}

/**
 * Generate Supplier Statement Excel Buffer (.xlsx)
 */
async function generateSupplierStatementExcel(supplierId, restaurantId, filters = {}) {
  const ledgerData = await SupplierPayableRepository.getDetailedLedger(supplierId, restaurantId, filters);
  if (!ledgerData || !ledgerData.supplier) {
    throw new Error('Supplier statement not found.');
  }

  const entries = ledgerData.ledger || [];

  const columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Transaction Type', key: 'type', width: 22 },
    { header: 'Reference', key: 'ref', width: 18 },
    { header: 'Payment Mode', key: 'mode', width: 16 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Debit (+) (Rs)', key: 'debit', width: 16 },
    { header: 'Credit (-) (Rs)', key: 'credit', width: 16 },
    { header: 'Balance After (Rs)', key: 'balance', width: 18 }
  ];

  let rows;
  if (entries.length === 0) {
    rows = [{
      date: '—',
      type: 'No transactions recorded for this supplier matching the selected filters.',
      ref: '—',
      mode: '—',
      notes: '—',
      debit: '0.00',
      credit: '0.00',
      balance: parseFloat(ledgerData.summary.closing_balance || 0).toFixed(2)
    }];
  } else {
    rows = entries.map(e => ({
      date: fmtDate(e.created_at),
      type: (e.transaction_type || '').replace(/_/g, ' '),
      ref: e.reference_number || '—',
      mode: e.payment_mode || '—',
      notes: e.notes || '—',
      debit: parseFloat(e.debit || 0) ? parseFloat(e.debit).toFixed(2) : '0.00',
      credit: parseFloat(e.credit || 0) ? parseFloat(e.credit).toFixed(2) : '0.00',
      balance: parseFloat(e.balance_after || 0).toFixed(2)
    }));
  }

  const { generateExcelWorkbook } = require('../utils/excel_helper');
  return await generateExcelWorkbook({
    sheetName: 'Statement of Account',
    columns,
    data: rows
  });
}

module.exports = {
  generateSupplierStatementPDF,
  generateSupplierStatementExcel,
  fetchBranding
};
