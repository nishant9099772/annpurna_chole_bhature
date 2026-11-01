/**
 * Vector PDF Receipt Generator for Annpurna Chole Bhature
 * Generates crisp, high-fidelity customer receipts using pdf-lib.
 * Includes Order ID, Bill Number, Order Type, Item breakdown, Subtotal, Discount, Grand Total, and Payment Method.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Bill } from '../types/billing';

export async function generateBillPdfBytes(bill: Bill): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  // Receipt dimensions: 400pt wide
  const baseHeight = 580;
  const itemHeight = Math.max(bill.items.length * 28, 60);
  const totalHeight = baseHeight + itemHeight;
  const pageWidth = 400;

  const page = pdfDoc.addPage([pageWidth, totalHeight]);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Professional color palette: Classic Navy / Royal Blue accent
  const primaryBlue = rgb(0.12, 0.35, 0.85); // Professional SaaS Blue #1E59D9
  const darkCharcoal = rgb(0.12, 0.15, 0.18);
  const mutedGray = rgb(0.45, 0.48, 0.52);
  const lineGray = rgb(0.88, 0.88, 0.90);
  const lightBg = rgb(0.97, 0.98, 1.0);
  const highlightGreen = rgb(0.08, 0.58, 0.28);
  const packBadgeColor = rgb(0.15, 0.45, 0.88);

  let y = totalHeight - 35;

  // Background header band
  page.drawRectangle({
    x: 0,
    y: totalHeight - 90,
    width: pageWidth,
    height: 90,
    color: lightBg,
  });

  // Top accent line
  page.drawRectangle({
    x: 0,
    y: totalHeight - 6,
    width: pageWidth,
    height: 6,
    color: primaryBlue,
  });

  // Brand Name
  const brandTitle = 'ANNPURNA CHOLE BHATURE';
  const brandWidth = fontBold.widthOfTextAtSize(brandTitle, 17);
  page.drawText(brandTitle, {
    x: (pageWidth - brandWidth) / 2,
    y,
    size: 17,
    font: fontBold,
    color: primaryBlue,
  });

  y -= 18;
  const subTitle = 'Customer Bill & Tax Invoice Receipt';
  const subWidth = fontRegular.widthOfTextAtSize(subTitle, 9.5);
  page.drawText(subTitle, {
    x: (pageWidth - subWidth) / 2,
    y,
    size: 9.5,
    font: fontRegular,
    color: mutedGray,
  });

  y -= 25;

  // Horizontal divider
  page.drawLine({
    start: { x: 20, y },
    end: { x: pageWidth - 20, y },
    thickness: 1,
    color: lineGray,
  });

  y -= 18;

  // Bill Meta Card (Order ID, Bill No, Date, Order Type, Customer, Payment)
  page.drawRectangle({
    x: 20,
    y: y - 76,
    width: pageWidth - 40,
    height: 86,
    borderColor: lineGray,
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  // Left col: Order ID & Bill number
  page.drawText('ORDER ID', { x: 30, y: y - 6, size: 7.5, font: fontBold, color: mutedGray });
  page.drawText(bill.orderId || bill.id, { x: 30, y: y - 18, size: 9, font: fontBold, color: primaryBlue });

  page.drawText('BILL NUMBER', { x: 30, y: y - 32, size: 7.5, font: fontBold, color: mutedGray });
  page.drawText(bill.billNumber, { x: 30, y: y - 44, size: 9, font: fontBold, color: darkCharcoal });

  page.drawText('DATE & TIME (IST)', { x: 30, y: y - 58, size: 7.5, font: fontRegular, color: mutedGray });
  page.drawText(bill.dateTimeKolkata, { x: 30, y: y - 68, size: 7.5, font: fontRegular, color: darkCharcoal });

  // Center col: Order Type Badge & Payment Method
  const centerColX = pageWidth / 2 - 25;
  page.drawText('ORDER TYPE', { x: centerColX, y: y - 6, size: 7.5, font: fontBold, color: mutedGray });
  const isPack = bill.orderType === 'PACK';
  const orderTypeStr = isPack ? 'PACK (TAKEAWAY)' : 'DINE IN';
  page.drawText(orderTypeStr, {
    x: centerColX,
    y: y - 18,
    size: 9,
    font: fontBold,
    color: isPack ? packBadgeColor : highlightGreen,
  });

  page.drawText('PAYMENT METHOD', { x: centerColX, y: y - 32, size: 7.5, font: fontBold, color: mutedGray });
  page.drawText(bill.paymentMethod || 'Cash', { x: centerColX, y: y - 44, size: 9, font: fontBold, color: darkCharcoal });

  // Right col: Customer Info
  const rightColX = pageWidth / 2 + 75;
  page.drawText('CUSTOMER NAME', { x: rightColX, y: y - 6, size: 7.5, font: fontBold, color: mutedGray });
  page.drawText(bill.customerName, { x: rightColX, y: y - 18, size: 9, font: fontBold, color: darkCharcoal });

  page.drawText('MOBILE NUMBER', { x: rightColX, y: y - 32, size: 7.5, font: fontRegular, color: mutedGray });
  const fullPhone = `${bill.countryCode} ${bill.mobileNumber}`;
  page.drawText(fullPhone, { x: rightColX, y: y - 44, size: 8.5, font: fontRegular, color: darkCharcoal });

  y -= 98;

  // Table Header
  const colX = {
    item: 24,
    qty: 230,
    rate: 290,
    total: pageWidth - 28,
  };

  page.drawRectangle({
    x: 20,
    y: y - 6,
    width: pageWidth - 40,
    height: 22,
    color: rgb(0.95, 0.96, 0.98),
  });

  page.drawText('ITEM DESCRIPTION', { x: colX.item, y: y, size: 8.5, font: fontBold, color: darkCharcoal });
  page.drawText('QTY', { x: colX.qty - 10, y: y, size: 8.5, font: fontBold, color: darkCharcoal });
  page.drawText('RATE', { x: colX.rate - 10, y: y, size: 8.5, font: fontBold, color: darkCharcoal });
  const totalHeaderWidth = fontBold.widthOfTextAtSize('AMOUNT', 8.5);
  page.drawText('AMOUNT', { x: colX.total - totalHeaderWidth, y: y, size: 8.5, font: fontBold, color: darkCharcoal });

  y -= 14;

  // Table Rows
  bill.items.forEach((item, index) => {
    y -= 22;

    if (index % 2 === 1) {
      page.drawRectangle({
        x: 20,
        y: y - 4,
        width: pageWidth - 40,
        height: 20,
        color: rgb(0.985, 0.985, 0.99),
      });
    }

    // Item name
    page.drawText(item.name, { x: colX.item, y: y + 2, size: 9, font: fontBold, color: darkCharcoal });

    // Quantity
    page.drawText(`${item.quantity}`, { x: colX.qty - 5, y: y + 2, size: 9, font: fontRegular, color: darkCharcoal });

    // Rate
    const rateText = `Rs. ${item.unitPriceRupees.toFixed(2)}`;
    page.drawText(rateText, { x: colX.rate - 10, y: y + 2, size: 9, font: fontRegular, color: darkCharcoal });

    // Line Total
    const amountText = `Rs. ${item.lineTotalRupees.toFixed(2)}`;
    const amtWidth = fontBold.widthOfTextAtSize(amountText, 9.5);
    page.drawText(amountText, { x: colX.total - amtWidth, y: y + 2, size: 9.5, font: fontBold, color: darkCharcoal });

    // Row divider
    page.drawLine({
      start: { x: 20, y: y - 3 },
      end: { x: pageWidth - 20, y: y - 3 },
      thickness: 0.5,
      color: rgb(0.92, 0.92, 0.94),
    });
  });

  y -= 25;

  // Totals breakdown: Subtotal, Discount, Grand Total
  const hasDiscount = (bill.discountRupees || 0) > 0;
  const totalsBoxHeight = hasDiscount ? 66 : 50;

  page.drawRectangle({
    x: pageWidth / 2 - 15,
    y: y - totalsBoxHeight,
    width: pageWidth / 2 - 5,
    height: totalsBoxHeight + 8,
    color: lightBg,
    borderColor: primaryBlue,
    borderWidth: 1.2,
  });

  let currentTotalsY = y - 4;

  if (hasDiscount) {
    // Subtotal
    page.drawText('Subtotal:', { x: pageWidth / 2 - 5, y: currentTotalsY, size: 8.5, font: fontRegular, color: mutedGray });
    const subStr = `Rs. ${bill.subtotalRupees.toFixed(2)}`;
    const subW = fontRegular.widthOfTextAtSize(subStr, 8.5);
    page.drawText(subStr, { x: pageWidth - 28 - subW, y: currentTotalsY, size: 8.5, font: fontRegular, color: darkCharcoal });
    currentTotalsY -= 16;

    // Discount with percentage
    const discountLabel = bill.discountPercent ? `Discount (${bill.discountPercent}%):` : 'Discount:';
    page.drawText(discountLabel, { x: pageWidth / 2 - 5, y: currentTotalsY, size: 8.5, font: fontRegular, color: rgb(0.8, 0.2, 0.2) });
    const discAmount = bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : (bill.discountRupees || 0);
    const discStr = `- Rs. ${discAmount.toFixed(2)}`;
    const discW = fontRegular.widthOfTextAtSize(discStr, 8.5);
    page.drawText(discStr, { x: pageWidth - 28 - discW, y: currentTotalsY, size: 8.5, font: fontRegular, color: rgb(0.8, 0.2, 0.2) });
    currentTotalsY -= 18;
  }

  // Final Grand Total
  page.drawText('FINAL TOTAL', {
    x: pageWidth / 2 - 5,
    y: currentTotalsY - 2,
    size: 10,
    font: fontBold,
    color: primaryBlue,
  });

  const grandTotalText = `Rs. ${bill.grandTotalRupees.toFixed(2)}`;
  const grandTotalWidth = fontBold.widthOfTextAtSize(grandTotalText, 15);
  page.drawText(grandTotalText, {
    x: pageWidth - 28 - grandTotalWidth,
    y: currentTotalsY - 4,
    size: 15,
    font: fontBold,
    color: highlightGreen,
  });

  y -= totalsBoxHeight + 35;

  // Status notes
  page.drawText(`PAYMENT: ${bill.paymentMethod || 'Cash'}  |  STATUS: COMPLETED & PAID`, {
    x: 24,
    y,
    size: 8,
    font: fontBold,
    color: highlightGreen,
  });

  if (bill.savedToSheets) {
    page.drawText('RECORDED IN GOOGLE SHEETS', {
      x: 24,
      y: y - 12,
      size: 7.5,
      font: fontRegular,
      color: mutedGray,
    });
  }

  // Footer business notes
  const footerNote = 'Thank you for your visit! For queries or feedback, contact +91 8800896679.';
  const footerWidth = fontRegular.widthOfTextAtSize(footerNote, 7.5);
  page.drawText(footerNote, {
    x: (pageWidth - footerWidth) / 2,
    y: 20,
    size: 7.5,
    font: fontRegular,
    color: mutedGray,
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

