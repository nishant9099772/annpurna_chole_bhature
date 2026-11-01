/**
 * Vector PDF POS Receipt Generator for ANNAPURNA CHOLE BHATURE
 * Generates crisp, high-fidelity restaurant POS receipts suitable for 80mm thermal rolls,
 * A4 printing, PDF download, and WhatsApp sharing.
 *
 * Includes:
 * - Restaurant branding: ANNAPURNA CHOLE BHATURE & Contact +91 8800896679
 * - Unique Order ID & Bill Number
 * - Bill Date & Time (IST)
 * - Customer Name (with " Ji") & Customer Mobile Number
 * - Items purchased, Quantity, Individual item price, Line total
 * - Subtotal, Discount Percentage (%), Discount Amount, Final Payable Amount
 * - Payment Method & Thank-You Message
 * - Zero text clipping or column overlap
 */

import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { Bill } from '../types/billing';
import { formatCustomerNameWithJi } from '../utils/customerFormat';

/**
 * Safely truncates text to fit within maxWidth points so columns never overlap.
 */
function fitTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string {
  const clean = (text || '').replace(/[^\x20-\x7E]/g, '').trim();
  if (font.widthOfTextAtSize(clean, fontSize) <= maxWidth) {
    return clean;
  }
  let truncated = clean;
  while (truncated.length > 3 && font.widthOfTextAtSize(`${truncated}...`, fontSize) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
}

export async function generateBillPdfBytes(bill: Bill): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const formattedCustomerName = formatCustomerNameWithJi(bill.customerName);

  // Standard POS / A4-friendly receipt width (420pt = ~148mm, scales cleanly to 80mm thermal & A4)
  const pageWidth = 420;
  const itemRowHeight = 24;
  const baseHeight = 610;
  const itemsBlockHeight = Math.max(bill.items.length * itemRowHeight, 48);
  const totalHeight = baseHeight + itemsBlockHeight;

  const page = pdfDoc.addPage([pageWidth, totalHeight]);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await pdfDoc.embedFont(StandardFonts.CourierBold);

  // Palette
  const brandNavy = rgb(0.09, 0.25, 0.68);      // Deep Royal POS Blue
  const darkInk = rgb(0.10, 0.12, 0.16);        // Primary text
  const slateMuted = rgb(0.42, 0.46, 0.52);     // Labels
  const borderGray = rgb(0.84, 0.86, 0.90);     // Dividers
  const headerTint = rgb(0.96, 0.98, 1.0);      // Header fill
  const zebraTint = rgb(0.98, 0.985, 0.995);    // Alternating row fill
  const emeraldPaid = rgb(0.05, 0.52, 0.26);    // Final payable & paid status
  const discountRed = rgb(0.78, 0.16, 0.18);    // Discount highlight

  const margin = 24;
  const contentWidth = pageWidth - margin * 2;
  let y = totalHeight;

  // 1. Top Accent Bar & Branding Header
  page.drawRectangle({
    x: 0,
    y: totalHeight - 104,
    width: pageWidth,
    height: 104,
    color: headerTint,
  });

  page.drawRectangle({
    x: 0,
    y: totalHeight - 7,
    width: pageWidth,
    height: 7,
    color: brandNavy,
  });

  y = totalHeight - 32;
  const brandTitle = 'ANNAPURNA CHOLE BHATURE';
  const brandW = fontBold.widthOfTextAtSize(brandTitle, 17);
  page.drawText(brandTitle, {
    x: (pageWidth - brandW) / 2,
    y,
    size: 17,
    font: fontBold,
    color: brandNavy,
  });

  y -= 16;
  const tagline = 'Authentic North Indian Cuisine  |  POS Tax Invoice & Receipt';
  const taglineW = fontRegular.widthOfTextAtSize(tagline, 8.5);
  page.drawText(tagline, {
    x: (pageWidth - taglineW) / 2,
    y,
    size: 8.5,
    font: fontRegular,
    color: slateMuted,
  });

  y -= 14;
  const contactLine = 'Contact / WhatsApp: +91 8800896679';
  const contactW = fontBold.widthOfTextAtSize(contactLine, 9);
  page.drawText(contactLine, {
    x: (pageWidth - contactW) / 2,
    y,
    size: 9,
    font: fontBold,
    color: darkInk,
  });

  y -= 20;
  // Order Type Pill Banner
  const isPack = bill.orderType === 'PACK';
  const orderBadgeText = isPack ? 'ORDER TYPE: PACK (TAKEAWAY)' : 'ORDER TYPE: DINE IN';
  const badgeW = fontBold.widthOfTextAtSize(orderBadgeText, 8) + 20;
  page.drawRectangle({
    x: (pageWidth - badgeW) / 2,
    y: y - 4,
    width: badgeW,
    height: 16,
    color: isPack ? rgb(0.90, 0.94, 1.0) : rgb(0.90, 0.98, 0.93),
    borderColor: isPack ? brandNavy : emeraldPaid,
    borderWidth: 0.8,
  });
  page.drawText(orderBadgeText, {
    x: (pageWidth - badgeW) / 2 + 10,
    y: y + 1,
    size: 8,
    font: fontBold,
    color: isPack ? brandNavy : emeraldPaid,
  });

  y = totalHeight - 116;

  // 2. Clean 2-Column Metadata Box (Zero Overlapping Guarantee)
  const metaBoxHeight = 104;
  page.drawRectangle({
    x: margin,
    y: y - metaBoxHeight,
    width: contentWidth,
    height: metaBoxHeight,
    color: rgb(1, 1, 1),
    borderColor: borderGray,
    borderWidth: 1,
  });

  // Vertical center divider inside metadata box
  const midX = pageWidth / 2;
  page.drawLine({
    start: { x: midX, y: y - 8 },
    end: { x: midX, y: y - metaBoxHeight + 8 },
    thickness: 0.75,
    color: borderGray,
  });

  const leftColX = margin + 12;
  const rightColX = midX + 12;
  const colMaxWidth = contentWidth / 2 - 20;

  // Left Column: Order ID, Bill Number, Date & Time
  page.drawText('UNIQUE ORDER ID', { x: leftColX, y: y - 16, size: 7, font: fontBold, color: slateMuted });
  page.drawText(
    fitTextToWidth(bill.orderId || bill.id, fontMono, 9.5, colMaxWidth),
    { x: leftColX, y: y - 28, size: 9.5, font: fontMono, color: brandNavy }
  );

  page.drawText('BILL NUMBER', { x: leftColX, y: y - 46, size: 7, font: fontBold, color: slateMuted });
  page.drawText(
    fitTextToWidth(bill.billNumber, fontBold, 9, colMaxWidth),
    { x: leftColX, y: y - 58, size: 9, font: fontBold, color: darkInk }
  );

  page.drawText('BILL DATE & TIME (IST)', { x: leftColX, y: y - 76, size: 7, font: fontBold, color: slateMuted });
  const dateTimeStr =
    bill.billDate && bill.billTime
      ? `${bill.billDate}  ${bill.billTime} IST`
      : bill.dateTimeKolkata;
  page.drawText(
    fitTextToWidth(dateTimeStr, fontRegular, 8.5, colMaxWidth),
    { x: leftColX, y: y - 88, size: 8.5, font: fontRegular, color: darkInk }
  );

  // Right Column: Customer Name, Mobile Number, Payment Method
  page.drawText('CUSTOMER NAME', { x: rightColX, y: y - 16, size: 7, font: fontBold, color: slateMuted });
  page.drawText(
    fitTextToWidth(formattedCustomerName, fontBold, 9.5, colMaxWidth),
    { x: rightColX, y: y - 28, size: 9.5, font: fontBold, color: darkInk }
  );

  page.drawText('CUSTOMER MOBILE', { x: rightColX, y: y - 46, size: 7, font: fontBold, color: slateMuted });
  const fullMobile = `${bill.countryCode || '+91'} ${bill.mobileNumber}`;
  page.drawText(
    fitTextToWidth(fullMobile, fontMono, 9, colMaxWidth),
    { x: rightColX, y: y - 58, size: 9, font: fontMono, color: darkInk }
  );

  page.drawText('PAYMENT METHOD & STATUS', { x: rightColX, y: y - 76, size: 7, font: fontBold, color: slateMuted });
  const paymentStr = `${bill.paymentMethod || 'Cash'}  •  ${(bill.paymentStatus || 'Paid').toUpperCase()}`;
  page.drawText(
    fitTextToWidth(paymentStr, fontBold, 8.5, colMaxWidth),
    { x: rightColX, y: y - 88, size: 8.5, font: fontBold, color: emeraldPaid }
  );

  y -= metaBoxHeight + 16;

  // 3. Itemized POS Table
  const col = {
    item: margin + 10,
    qtyCenter: margin + 205,
    rateRight: margin + 285,
    amountRight: pageWidth - margin - 10,
  };

  // Table Header Bar
  page.drawRectangle({
    x: margin,
    y: y - 20,
    width: contentWidth,
    height: 22,
    color: brandNavy,
  });

  const thY = y - 13;
  page.drawText('ITEM PURCHASED', { x: col.item, y: thY, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  const qtyHdrW = fontBold.widthOfTextAtSize('QTY', 8);
  page.drawText('QTY', { x: col.qtyCenter - qtyHdrW / 2, y: thY, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  const rateHdrW = fontBold.widthOfTextAtSize('UNIT PRICE', 8);
  page.drawText('UNIT PRICE', { x: col.rateRight - rateHdrW, y: thY, size: 8, font: fontBold, color: rgb(1, 1, 1) });
  const amtHdrW = fontBold.widthOfTextAtSize('AMOUNT', 8);
  page.drawText('AMOUNT', { x: col.amountRight - amtHdrW, y: thY, size: 8, font: fontBold, color: rgb(1, 1, 1) });

  y -= 20;

  bill.items.forEach((item, index) => {
    const rowTop = y;
    const rowBottom = y - itemRowHeight;

    if (index % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: rowBottom,
        width: contentWidth,
        height: itemRowHeight,
        color: zebraTint,
      });
    }

    const textY = rowBottom + 8;
    const safeItemName = fitTextToWidth(`${index + 1}. ${item.name}`, fontBold, 9, 175);
    page.drawText(safeItemName, { x: col.item, y: textY, size: 9, font: fontBold, color: darkInk });

    const qtyStr = String(item.quantity);
    const qtyW = fontBold.widthOfTextAtSize(qtyStr, 9);
    page.drawText(qtyStr, { x: col.qtyCenter - qtyW / 2, y: textY, size: 9, font: fontBold, color: darkInk });

    const rateStr = `Rs. ${item.unitPriceRupees.toFixed(2)}`;
    const rateW = fontRegular.widthOfTextAtSize(rateStr, 8.5);
    page.drawText(rateStr, { x: col.rateRight - rateW, y: textY, size: 8.5, font: fontRegular, color: darkInk });

    const lineStr = `Rs. ${item.lineTotalRupees.toFixed(2)}`;
    const lineW = fontBold.widthOfTextAtSize(lineStr, 9);
    page.drawText(lineStr, { x: col.amountRight - lineW, y: textY, size: 9, font: fontBold, color: darkInk });

    page.drawLine({
      start: { x: margin, y: rowBottom },
      end: { x: pageWidth - margin, y: rowBottom },
      thickness: 0.5,
      color: borderGray,
    });

    y = rowBottom;
  });

  // Outer border around items table
  const tableTotalHeight = 22 + bill.items.length * itemRowHeight;
  page.drawRectangle({
    x: margin,
    y,
    width: contentWidth,
    height: tableTotalHeight,
    borderColor: borderGray,
    borderWidth: 1,
  });

  y -= 16;

  // 4. Financial Summary Box (Always displays Subtotal, Discount %, Discount Amount, Final Payable Amount)
  const summaryBoxHeight = 112;
  page.drawRectangle({
    x: margin,
    y: y - summaryBoxHeight,
    width: contentWidth,
    height: summaryBoxHeight,
    color: headerTint,
    borderColor: brandNavy,
    borderWidth: 1.2,
  });

  const sumLeftX = margin + 14;
  const sumRightX = pageWidth - margin - 14;
  let sumY = y - 18;

  const totalItemsQty = bill.itemCount || bill.items.reduce((s, i) => s + i.quantity, 0);
  const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
  const discAmt =
    bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;

  // Row 1: Subtotal
  page.drawText(`Subtotal (${totalItemsQty} ${totalItemsQty === 1 ? 'item' : 'items'}):`, {
    x: sumLeftX,
    y: sumY,
    size: 9,
    font: fontRegular,
    color: darkInk,
  });
  const subVal = `Rs. ${bill.subtotalRupees.toFixed(2)}`;
  page.drawText(subVal, {
    x: sumRightX - fontBold.widthOfTextAtSize(subVal, 9),
    y: sumY,
    size: 9,
    font: fontBold,
    color: darkInk,
  });

  sumY -= 16;
  // Row 2: Discount Percentage
  page.drawText('Discount Percentage:', {
    x: sumLeftX,
    y: sumY,
    size: 8.5,
    font: fontRegular,
    color: slateMuted,
  });
  const pctVal = `${discPct}%`;
  page.drawText(pctVal, {
    x: sumRightX - fontBold.widthOfTextAtSize(pctVal, 8.5),
    y: sumY,
    size: 8.5,
    font: fontBold,
    color: discPct > 0 ? discountRed : slateMuted,
  });

  sumY -= 16;
  // Row 3: Discount Amount in Rupees
  page.drawText('Discount Amount (INR):', {
    x: sumLeftX,
    y: sumY,
    size: 8.5,
    font: fontRegular,
    color: slateMuted,
  });
  const discVal = `- Rs. ${discAmt.toFixed(2)}`;
  page.drawText(discVal, {
    x: sumRightX - fontBold.widthOfTextAtSize(discVal, 8.5),
    y: sumY,
    size: 8.5,
    font: fontBold,
    color: discAmt > 0 ? discountRed : slateMuted,
  });

  sumY -= 12;
  page.drawLine({
    start: { x: sumLeftX, y: sumY },
    end: { x: sumRightX, y: sumY },
    thickness: 1,
    color: borderGray,
  });

  sumY -= 24;
  // Row 4: Final Payable Amount (Prominent)
  page.drawText('FINAL PAYABLE AMOUNT', {
    x: sumLeftX,
    y: sumY + 2,
    size: 11,
    font: fontBold,
    color: brandNavy,
  });
  const finalVal = `Rs. ${bill.grandTotalRupees.toFixed(2)}`;
  const finalW = fontBold.widthOfTextAtSize(finalVal, 16);
  page.drawText(finalVal, {
    x: sumRightX - finalW,
    y: sumY,
    size: 16,
    font: fontBold,
    color: emeraldPaid,
  });

  y -= summaryBoxHeight + 22;

  // 5. Footer & Thank-You Section
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.75,
    color: borderGray,
  });

  y -= 18;
  const thankYou1 = 'Thank you for dining with ANNAPURNA CHOLE BHATURE!';
  const ty1W = fontBold.widthOfTextAtSize(thankYou1, 9.5);
  page.drawText(thankYou1, {
    x: (pageWidth - ty1W) / 2,
    y,
    size: 9.5,
    font: fontBold,
    color: darkInk,
  });

  y -= 14;
  const thankYou2 = 'We appreciate your patronage. Visit us again soon!';
  const ty2W = fontRegular.widthOfTextAtSize(thankYou2, 8);
  page.drawText(thankYou2, {
    x: (pageWidth - ty2W) / 2,
    y,
    size: 8,
    font: fontRegular,
    color: slateMuted,
  });

  y -= 14;
  const footerMeta = `Order ID: ${bill.orderId || bill.id}  |  WhatsApp & Support: +91 8800896679`;
  const fmW = fontRegular.widthOfTextAtSize(footerMeta, 7.5);
  page.drawText(footerMeta, {
    x: (pageWidth - fmW) / 2,
    y,
    size: 7.5,
    font: fontRegular,
    color: slateMuted,
  });

  return await pdfDoc.save();
}

export function createBillPdfBlobUrl(pdfBytes: Uint8Array): string {
  const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

export function createBillPdfFile(pdfBytes: Uint8Array, filename: string): File {
  return new File([pdfBytes as any], filename, { type: 'application/pdf' });
}
