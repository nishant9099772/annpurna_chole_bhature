/**
 * Dedicated Restaurant POS Receipt HTML Generator & Printer Utility
 * Supports both:
 * - 80mm Thermal POS Receipt Printers (@page { size: 80mm auto; margin: 0; })
 * - A4 Standard Printers (@page { size: A4 portrait; margin: 12mm; })
 * Uses native Indian Rupee (₹) symbol, clean tabular alignment, and iframe printing
 * so no content is ever cut off or misaligned.
 */

import { Bill } from '../types/billing';
import { formatCustomerNameWithJi } from './customerFormat';

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generatePosReceiptHtml(bill: Bill, mode: '80mm' | 'A4' = '80mm'): string {
  const customerName = escapeHtml(formatCustomerNameWithJi(bill.customerName));
  const orderId = escapeHtml(bill.orderId || bill.id);
  const billNo = escapeHtml(bill.billNumber);
  const orderType = bill.orderType === 'PACK' ? 'PACK (TAKEAWAY)' : 'DINE IN';
  const mobile = escapeHtml(`${bill.countryCode || '+91'} ${bill.mobileNumber}`);
  const dateTime = escapeHtml(
    bill.billDate && bill.billTime ? `${bill.billDate}, ${bill.billTime} IST` : bill.dateTimeKolkata
  );
  const paymentMethod = escapeHtml(bill.paymentMethod || 'Cash');
  const paymentStatus = escapeHtml(bill.paymentStatus || 'Paid');

  const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
  const discAmt =
    bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;
  const totalQty = bill.itemCount || bill.items.reduce((s, i) => s + i.quantity, 0);

  const isThermal = mode === '80mm';

  const rowsHtml = bill.items
    .map(
      (item, idx) => `
      <tr>
        <td class="col-item">${idx + 1}. ${escapeHtml(item.name)}</td>
        <td class="col-qty">${item.quantity}</td>
        <td class="col-rate">₹${item.unitPriceRupees.toFixed(2)}</td>
        <td class="col-amt">₹${item.lineTotalRupees.toFixed(2)}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ANNAPURNA CHOLE BHATURE - Bill ${orderId}</title>
  <style>
    @page {
      size: ${isThermal ? '80mm auto' : 'A4 portrait'};
      margin: ${isThermal ? '2mm' : '12mm'};
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      display: flex;
      justify-content: center;
      padding: ${isThermal ? '4px' : '16px'};
    }
    .receipt-container {
      width: ${isThermal ? '74mm' : '100%'};
      max-width: ${isThermal ? '74mm' : '520px'};
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: ${isThermal ? '10px 8px' : '24px'};
    }
    .brand-header {
      text-align: center;
      border-bottom: 1.5px dashed #64748b;
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .brand-title {
      font-size: ${isThermal ? '15px' : '22px'};
      font-weight: 900;
      letter-spacing: 0.03em;
      color: #1e3a8a;
    }
    .brand-sub {
      font-size: ${isThermal ? '10px' : '12px'};
      color: #475569;
      margin-top: 2px;
    }
    .brand-contact {
      font-size: ${isThermal ? '10.5px' : '12.5px'};
      font-weight: 700;
      color: #0f172a;
      margin-top: 3px;
    }
    .order-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 2px 8px;
      font-size: ${isThermal ? '10px' : '11px'};
      font-weight: 800;
      border-radius: 4px;
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #93c5fd;
    }
    .meta-grid {
      width: 100%;
      font-size: ${isThermal ? '10.5px' : '12.5px'};
      margin-bottom: 10px;
      border-bottom: 1.5px dashed #64748b;
      padding-bottom: 8px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 3px;
      gap: 8px;
    }
    .meta-label {
      color: #475569;
      font-weight: 600;
      white-space: nowrap;
    }
    .meta-value {
      font-weight: 700;
      text-align: right;
      font-variant-numeric: tabular-nums;
      word-break: break-word;
    }
    table.items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: ${isThermal ? '10.5px' : '13px'};
      margin-bottom: 10px;
    }
    table.items-table th {
      border-bottom: 1.5px solid #0f172a;
      padding: 4px 2px;
      font-weight: 800;
      font-size: ${isThermal ? '9.5px' : '11.5px'};
      text-transform: uppercase;
      color: #0f172a;
    }
    table.items-table td {
      padding: 5px 2px;
      border-bottom: 1px dotted #cbd5e1;
      font-variant-numeric: tabular-nums;
    }
    .col-item { text-align: left; font-weight: 600; }
    .col-qty { text-align: center; width: 14%; }
    .col-rate { text-align: right; width: 25%; }
    .col-amt { text-align: right; width: 27%; font-weight: 700; }
    .totals-section {
      border-top: 1.5px solid #0f172a;
      padding-top: 8px;
      font-size: ${isThermal ? '11px' : '13px'};
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-variant-numeric: tabular-nums;
    }
    .discount-row {
      color: #b91c1c;
      font-weight: 600;
    }
    .grand-total-box {
      margin-top: 6px;
      padding: 8px;
      background: #f0fdf4;
      border: 1.5px solid #16a34a;
      border-radius: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grand-total-label {
      font-size: ${isThermal ? '11.5px' : '14px'};
      font-weight: 900;
      color: #0f172a;
    }
    .grand-total-amount {
      font-size: ${isThermal ? '15px' : '20px'};
      font-weight: 900;
      color: #15803d;
      font-variant-numeric: tabular-nums;
    }
    .footer {
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1.5px dashed #64748b;
      text-align: center;
      font-size: ${isThermal ? '9.5px' : '11.5px'};
      color: #334155;
      line-height: 1.45;
    }
    .footer-bold {
      font-weight: 800;
      color: #0f172a;
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="brand-header">
      <div class="brand-title">ANNAPURNA CHOLE BHATURE</div>
      <div class="brand-sub">POS Tax Invoice &amp; Customer Receipt</div>
      <div class="brand-contact">Contact / WhatsApp: +91 8800896679</div>
      <div class="order-badge">${orderType}</div>
    </div>

    <div class="meta-grid">
      <div class="meta-row">
        <span class="meta-label">Order ID:</span>
        <span class="meta-value">${orderId}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Bill No:</span>
        <span class="meta-value">${billNo}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Date &amp; Time:</span>
        <span class="meta-value">${dateTime}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Customer:</span>
        <span class="meta-value">${customerName}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Mobile:</span>
        <span class="meta-value">${mobile}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">Payment:</span>
        <span class="meta-value">${paymentMethod} (${paymentStatus})</span>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th class="col-item">Item</th>
          <th class="col-qty">Qty</th>
          <th class="col-rate">Price</th>
          <th class="col-amt">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="totals-section">
      <div class="total-row">
        <span>Subtotal (${totalQty} ${totalQty === 1 ? 'item' : 'items'}):</span>
        <strong>₹${bill.subtotalRupees.toFixed(2)}</strong>
      </div>
      <div class="total-row">
        <span>Discount Percentage:</span>
        <strong>${discPct}%</strong>
      </div>
      <div class="total-row discount-row">
        <span>Discount Amount:</span>
        <span>- ₹${discAmt.toFixed(2)}</span>
      </div>

      <div class="grand-total-box">
        <span class="grand-total-label">FINAL PAYABLE</span>
        <span class="grand-total-amount">₹${bill.grandTotalRupees.toFixed(2)}</span>
      </div>
    </div>

    <div class="footer">
      <div class="footer-bold">Thank you for visiting ANNAPURNA CHOLE BHATURE!</div>
      <div>We hope you enjoyed your meal. Please visit again!</div>
      <div>For feedback or orders: +91 8800896679</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Triggers a clean browser print dialog for either 80mm thermal or A4 receipt format
 * using an invisible iframe (works inside iframes and mobile browsers without popup blockers).
 */
export function printPosReceipt(bill: Bill, mode: '80mm' | 'A4' = '80mm'): void {
  const html = generatePosReceiptHtml(bill, mode);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }, 250);
  }
}
