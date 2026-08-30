const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

class PdfReceiptService {
  /**
   * Generates a receipt as a PDF buffer
   */
  static async generate(order, items, restaurant, settings = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        const is58mm = settings.paper_size === '58mm';
        const pageWidth = is58mm ? 164 : 226; // 58mm = 164pt, 80mm = 226pt
        const margin = 8;
        const usableWidth = pageWidth - 2 * margin;

        // Calculate dynamic height to fit content perfectly without page breaks
        let dynamicHeight = 120; // Header Branding details
        if (settings.show_logo !== 0 && settings.logo_url) {
          dynamicHeight += 50; // Logo space
        }
        dynamicHeight += 100; // Metadata (Bill #, Cashier, Date, Customer)
        dynamicHeight += 20; // Table Header
        dynamicHeight += items.length * 28; // Items rows (approx 28pt each)
        dynamicHeight += 120; // Subtotal, Tax, Discount, Total, Payment details
        if (settings.header_message) dynamicHeight += 30;
        if (settings.thank_you_message || settings.footer_message) dynamicHeight += 50;

        // Initialize document with single dynamic page size
        const doc = new PDFDocument({
          size: [pageWidth, dynamicHeight],
          margins: { top: margin, bottom: margin, left: margin, right: margin }
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });

        // 1. Logo
        if (settings.show_logo !== 0 && settings.logo_url) {
          try {
            let logoPath = settings.logo_url;
            if (logoPath.startsWith('/')) {
              logoPath = path.join(__dirname, '..', logoPath);
            }
            if (fs.existsSync(logoPath)) {
              doc.image(logoPath, {
                fit: [usableWidth, 40],
                align: 'center',
                valign: 'center'
              });
              doc.moveDown(0.3);
            }
          } catch (logoErr) {
            console.warn('[PDF Logo render error]:', logoErr.message);
            // Skip logo gracefully without failing document generation
          }
        }

        // 2. Header / Branding
        const storeName = (settings.restaurant_name || restaurant.name || 'RETAIL STORE').toUpperCase();
        doc.font('Helvetica-Bold')
           .fontSize(10)
           .text(storeName, { align: 'center', width: usableWidth });
        
        doc.font('Helvetica')
           .fontSize(7);

        if (settings.branch_name) {
          doc.text(settings.branch_name, { align: 'center', width: usableWidth });
        }
        const address = settings.address || restaurant.address;
        if (address) {
          doc.text(address, { align: 'center', width: usableWidth });
        }
        const phone = settings.phone || restaurant.phone;
        if (phone) {
          doc.text(`Ph: ${phone}`, { align: 'center', width: usableWidth });
        }
        const email = settings.email || restaurant.email;
        if (email) {
          doc.text(`Email: ${email}`, { align: 'center', width: usableWidth });
        }
        const website = settings.website;
        if (website) {
          doc.text(`Web: ${website}`, { align: 'center', width: usableWidth });
        }
        const gstNo = settings.gst_number || restaurant.gst_number;
        if (gstNo) {
          doc.text(`GSTIN: ${gstNo}`, { align: 'center', width: usableWidth });
        }
        const fssaiNo = settings.fssai_number;
        if (fssaiNo) {
          doc.text(`FSSAI: ${fssaiNo}`, { align: 'center', width: usableWidth });
        }
        
        doc.moveDown(0.5);
        doc.strokeColor('#cccccc')
           .lineWidth(0.5)
           .moveTo(margin, doc.y)
           .lineTo(pageWidth - margin, doc.y)
           .stroke();
        doc.moveDown(0.3);

        // 3. Metadata
        const orderNo = order.unique_order_number || order.id || 'N/A';
        const dateStr = order.created_at ? new Date(order.created_at).toLocaleString() : new Date().toLocaleString();
        
        doc.font('Helvetica-Bold').text(`Bill No: #${orderNo}`);
        doc.font('Helvetica');
        if (settings.show_cashier_name !== 0) {
          doc.text(`Cashier: ${order.cashier_name || 'Counter'}`);
        }
        doc.text(`Date: ${dateStr}`);
        const payMode = (order.payment_mode || 'CASH').toUpperCase();
        doc.text(`Payment: ${payMode}`);

        // Customer details
        if (settings.show_customer_details !== 0 && (order.customer_name || order.customer_phone)) {
          let customerStr = `Cust: ${order.customer_name || 'Walk-in'}`;
          if (order.customer_phone) customerStr += ` (${order.customer_phone})`;
          doc.text(customerStr);
          if (order.customer_address) doc.text(`Addr: ${order.customer_address}`);
        }

        doc.moveDown(0.5);
        doc.strokeColor('#cccccc')
           .moveTo(margin, doc.y)
           .lineTo(pageWidth - margin, doc.y)
           .stroke();
        doc.moveDown(0.3);

        // 4. Items Table
        doc.font('Helvetica-Bold')
           .text('Item', margin, doc.y, { width: usableWidth * 0.45, continued: true })
           .text('Qty', { width: usableWidth * 0.15, align: 'right', continued: true })
           .text('Rate', { width: usableWidth * 0.20, align: 'right', continued: true })
           .text('Total', { width: usableWidth * 0.20, align: 'right' });
        doc.moveDown(0.2);

        doc.font('Helvetica');
        items.forEach((item) => {
          const qty = item.quantity || 1;
          const rate = parseFloat(item.price || 0);
          const total = parseFloat(item.total_price || (qty * rate));
          
          doc.text(item.name, margin, doc.y, { width: usableWidth * 0.45, continued: true })
             .text(String(qty), { width: usableWidth * 0.15, align: 'right', continued: true })
             .text(rate.toFixed(2), { width: usableWidth * 0.20, align: 'right', continued: true })
             .text(total.toFixed(2), { width: usableWidth * 0.20, align: 'right' });
          doc.moveDown(0.15);
        });

        doc.moveDown(0.5);
        doc.strokeColor('#cccccc')
           .moveTo(margin, doc.y)
           .lineTo(pageWidth - margin, doc.y)
           .stroke();
        doc.moveDown(0.3);

        // 5. Totals
        const subtotal = parseFloat(order.subtotal || 0).toFixed(2);
        const tax = parseFloat(order.tax_amount || 0).toFixed(2);
        const discount = parseFloat(order.discount_amount || 0).toFixed(2);
        const grandTotal = parseFloat(order.total_amount || 0).toFixed(2);

        const drawTotalLine = (label, val, isBold = false) => {
          doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica')
             .text(label, margin, doc.y, { width: usableWidth * 0.6, continued: true })
             .text(val, { width: usableWidth * 0.4, align: 'right' });
          doc.moveDown(0.15);
        };

        drawTotalLine('Subtotal:', `Rs. ${subtotal}`);
        if (parseFloat(discount) > 0) {
          drawTotalLine('Discount:', `Rs. ${discount}`);
        }
        if (parseFloat(tax) > 0 && settings.show_tax_details !== 0) {
          drawTotalLine('GST/Tax:', `Rs. ${tax}`);
        }
        
        doc.moveDown(0.2);
        drawTotalLine('GRAND TOTAL:', `Rs. ${grandTotal}`, true);
        doc.moveDown(0.4);

        // 6. Footer Messages
        doc.font('Helvetica').fontSize(6);
        if (settings.thank_you_message) {
          doc.text(settings.thank_you_message, { align: 'center', width: usableWidth });
        }
        if (settings.footer_message) {
          doc.text(settings.footer_message, { align: 'center', width: usableWidth });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

module.exports = PdfReceiptService;
