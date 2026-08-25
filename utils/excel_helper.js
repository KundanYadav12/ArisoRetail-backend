const ExcelJS = require('exceljs');

/**
 * Utility helper to generate styled Excel (.xlsx) files as Buffer
 */
async function generateExcelWorkbook({ sheetName = 'Report', columns, data }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Restaurant POS System';
  workbook.lastModifiedBy = 'Restaurant POS System';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName);

  // Set columns header
  worksheet.columns = columns.map(col => ({
    header: col.header,
    key: col.key,
    width: col.width || 18
  }));

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '1E293B' } // Dark slate header
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  // Add data rows
  data.forEach((item, index) => {
    const row = worksheet.addRow(item);
    row.height = 20;
    row.alignment = { vertical: 'middle' };
    
    // Zebra striping
    if (index % 2 === 1) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'F8FAFC' }
      };
    }
  });

  // Auto-fit column widths based on content
  worksheet.columns.forEach(column => {
    let maxLen = column.header ? column.header.toString().length : 12;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const valStr = cell.value !== undefined && cell.value !== null ? cell.value.toString() : '';
      if (valStr.length > maxLen) {
        maxLen = valStr.length;
      }
    });
    column.width = Math.min(Math.max(maxLen + 4, 12), 45);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Utility helper to generate CA-Ready GST Slab Excel Workbook
 */
async function generateGstSlabExcelWorkbook({ restaurantInfo, slabs, invoices, dateFrom, dateTo, paymentMode }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Restaurant POS System';
  workbook.lastModifiedBy = 'Restaurant POS System';
  workbook.created = new Date();

  const restName = restaurantInfo.restaurant_name || 'Restaurant POS';
  const branchName = restaurantInfo.branch_name || 'Main Branch';
  const gstin = restaurantInfo.gst_number || 'N/A (Unregistered)';
  const address = restaurantInfo.address || 'N/A';

  // ==========================================
  // SHEET 1: GST SLAB SUMMARY (CA FILING)
  // ==========================================
  const ws1 = workbook.addWorksheet('GST Slab Summary');

  // Title Banner
  ws1.mergeCells('A1:K1');
  const titleCell = ws1.getCell('A1');
  titleCell.value = 'CA-READY GST SLAB SUMMARY REPORT (GSTR-1 B2C)';
  titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(1).height = 32;

  // Metadata Block
  ws1.getCell('A3').value = 'Restaurant Name:';
  ws1.getCell('B3').value = `${restName} (${branchName})`;
  ws1.getCell('A4').value = 'GSTIN / Tax ID:';
  ws1.getCell('B4').value = gstin;
  ws1.getCell('A5').value = 'Address:';
  ws1.getCell('B5').value = address;

  ws1.getCell('F3').value = 'Report Period:';
  ws1.getCell('G3').value = `${dateFrom.slice(0, 10)} to ${dateTo.slice(0, 10)}`;
  ws1.getCell('F4').value = 'Payment Mode Filter:';
  ws1.getCell('G4').value = (paymentMode || 'all').toUpperCase();
  ws1.getCell('F5').value = 'Generated On:';
  ws1.getCell('G5').value = new Date().toLocaleString();

  ['A3', 'A4', 'A5', 'F3', 'F4', 'F5'].forEach(cell => {
    ws1.getCell(cell).font = { bold: true, color: { argb: '475569' } };
  });

  // Table Headers (Row 7)
  const headers1 = [
    'GST Slab', 'Taxable Amount (₹)', 'CGST Rate', 'CGST Amount (₹)',
    'SGST Rate', 'SGST Amount (₹)', 'IGST Rate', 'IGST Amount (₹)',
    'Total Tax Collected (₹)', 'Total Invoice Value (₹)', 'Number of Invoices'
  ];

  ws1.getRow(7).values = headers1;
  const headerRow1 = ws1.getRow(7);
  headerRow1.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
  headerRow1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E293B' } };
  headerRow1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  headerRow1.height = 28;

  // Populate Standard GST Slabs (0%, 5%, 12%, 18%, 28%)
  const standardRates = [0, 5, 12, 18, 28];
  let totTaxable = 0, totCgst = 0, totSgst = 0, totIgst = 0, totTax = 0, totInvoiceVal = 0, totInvoices = 0;

  let currentRowIdx = 8;
  standardRates.forEach((rate) => {
    const found = (slabs || []).find(s => Math.round(parseFloat(s.gst_rate)) === rate) || {};
    const taxable = parseFloat(found.taxable_amount || 0);
    const totalGst = parseFloat(found.total_gst || 0);
    const cgstRate = found.cgst_rate !== undefined ? parseFloat(found.cgst_rate) : rate / 2;
    const cgstAmt = found.cgst_amount !== undefined ? parseFloat(found.cgst_amount) : totalGst / 2;
    const sgstRate = found.sgst_rate !== undefined ? parseFloat(found.sgst_rate) : rate / 2;
    const sgstAmt = found.sgst_amount !== undefined ? parseFloat(found.sgst_amount) : totalGst / 2;
    const igstRate = found.igst_rate !== undefined ? parseFloat(found.igst_rate) : 0;
    const igstAmt = found.igst_amount !== undefined ? parseFloat(found.igst_amount) : 0;
    const totalInvoiceVal = taxable + totalGst;
    const invCount = parseInt(found.invoice_count || 0);

    totTaxable += taxable;
    totCgst += cgstAmt;
    totSgst += sgstAmt;
    totIgst += igstAmt;
    totTax += totalGst;
    totInvoiceVal += totalInvoiceVal;
    totInvoices += invCount;

    const row = ws1.getRow(currentRowIdx);
    row.values = [
      `${rate}% GST`,
      taxable,
      `${cgstRate}%`,
      cgstAmt,
      `${sgstRate}%`,
      sgstAmt,
      `${igstRate}%`,
      igstAmt,
      totalGst,
      totalInvoiceVal,
      invCount
    ];

    row.height = 22;
    row.alignment = { vertical: 'middle' };

    // Apply number formatting
    [2, 4, 6, 8, 9, 10].forEach(colIdx => {
      row.getCell(colIdx).numFmt = '₹#,##0.00';
    });

    if (currentRowIdx % 2 === 1) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    }

    currentRowIdx++;
  });

  // Grand Total Row
  const totalRow = ws1.getRow(currentRowIdx);
  totalRow.values = [
    'TOTAL SUMMARY',
    totTaxable,
    '-',
    totCgst,
    '-',
    totSgst,
    '-',
    totIgst,
    totTax,
    totInvoiceVal,
    totInvoices
  ];

  totalRow.font = { bold: true, color: { argb: '0F172A' } };
  totalRow.height = 26;
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };
  totalRow.alignment = { vertical: 'middle' };

  [2, 4, 6, 8, 9, 10].forEach(colIdx => {
    totalRow.getCell(colIdx).numFmt = '₹#,##0.00';
  });

  // Auto-fit Columns for Sheet 1
  ws1.columns.forEach(col => { col.width = 18; });
  ws1.getColumn(1).width = 14;
  ws1.getColumn(2).width = 20;
  ws1.getColumn(9).width = 22;
  ws1.getColumn(10).width = 22;

  // ==========================================
  // SHEET 2: ITEMISED INVOICE AUDIT TRAIL
  // ==========================================
  const ws2 = workbook.addWorksheet('Invoice Audit Register');

  const headers2 = [
    'Invoice Number', 'Date & Time', 'Customer Name', 'Customer Phone',
    'Order Type', 'Payment Mode', 'Subtotal (₹)', 'Tax Amount (₹)',
    'Discount (₹)', 'Total Bill Amount (₹)'
  ];

  ws2.getRow(1).values = headers2;
  const headerRow2 = ws2.getRow(1);
  headerRow2.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
  headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  headerRow2.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow2.height = 26;

  (invoices || []).forEach((inv, idx) => {
    const r = ws2.addRow([
      inv.unique_order_number || `ORD-${inv.id}`,
      inv.created_at ? new Date(inv.created_at).toLocaleString() : '',
      inv.customer_name || 'Walk-in Customer',
      inv.customer_phone || 'N/A',
      inv.table_number_or_takeaway || 'Takeaway',
      (inv.payment_mode || 'cash').toUpperCase(),
      parseFloat(inv.subtotal || 0),
      parseFloat(inv.tax_amount || 0),
      parseFloat(inv.discount_amount || 0),
      parseFloat(inv.total_amount || 0)
    ]);

    r.height = 20;
    r.alignment = { vertical: 'middle' };
    [7, 8, 9, 10].forEach(c => { r.getCell(c).numFmt = '₹#,##0.00'; });

    if (idx % 2 === 1) {
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
    }
  });

  ws2.columns.forEach(col => { col.width = 18; });
  ws2.getColumn(1).width = 22;
  ws2.getColumn(2).width = 20;
  ws2.getColumn(3).width = 22;

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = {
  generateExcelWorkbook,
  generateGstSlabExcelWorkbook
};

