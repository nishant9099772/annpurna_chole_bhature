package com.annpurna.billing.service;

import com.annpurna.billing.model.Bill;
import com.annpurna.billing.model.BillItem;
import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import org.springframework.stereotype.Service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;

@Service
public class PdfGenerationService {

    public byte[] generateBillPdf(Bill bill) throws DocumentException {
        // Receipt size: 80mm roll or compact A6 format (400 x 600 pt)
        Rectangle pageSize = new Rectangle(400, 580);
        Document document = new Document(pageSize, 20, 20, 25, 25);
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        PdfWriter.getInstance(document, out);
        document.open();

        Color primaryAmber = new Color(217, 107, 13);
        Color darkCharcoal = new Color(30, 41, 59);
        Color lightGray = new Color(241, 245, 249);
        Color textMuted = new Color(100, 116, 139);

        // 1. Header Title
        Font titleFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 16, primaryAmber);
        Paragraph title = new Paragraph("ANNPURNA CHOLE BHATURE", titleFont);
        title.setAlignment(Element.ALIGN_CENTER);
        document.add(title);

        Font subtitleFont = FontFactory.getFont(FontFactory.HELVETICA, 8.5f, textMuted);
        Paragraph subtitle = new Paragraph("Customer Bill & Receipt", subtitleFont);
        subtitle.setAlignment(Element.ALIGN_CENTER);
        document.add(subtitle);

        Paragraph divider = new Paragraph("----------------------------------------------------------------", subtitleFont);
        divider.setAlignment(Element.ALIGN_CENTER);
        document.add(divider);

        // 2. Bill Meta Information Table
        PdfPTable metaTable = new PdfPTable(2);
        metaTable.setWidthPercentage(100);
        metaTable.setSpacingBefore(6f);
        metaTable.setSpacingAfter(10f);

        Font metaLabelFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 8, textMuted);
        Font metaValFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9.5f, darkCharcoal);

        PdfPCell c1 = new PdfPCell();
        c1.setBorder(Rectangle.NO_BORDER);
        c1.addElement(new Paragraph("BILL NO: " + bill.getBillNumber(), metaValFont));
        String orderLabel = bill.getOrderTypeLabel() != null ? bill.getOrderTypeLabel() : "Dine In";
        c1.addElement(new Paragraph("ORDER TYPE: " + orderLabel.toUpperCase(), metaValFont));
        c1.addElement(new Paragraph("DATE (IST): " + bill.getDateTimeKolkata(), metaLabelFont));
        metaTable.addCell(c1);

        PdfPCell c2 = new PdfPCell();
        c2.setBorder(Rectangle.NO_BORDER);
        c2.setHorizontalAlignment(Element.ALIGN_RIGHT);
        c2.addElement(new Paragraph("CUSTOMER: " + bill.getCustomerName(), metaValFont));
        c2.addElement(new Paragraph("PHONE: " + bill.getCountryCode() + " " + bill.getMobileNumber(), metaLabelFont));
        metaTable.addCell(c2);

        document.add(metaTable);

        // 3. Itemized Table
        PdfPTable table = new PdfPTable(4);
        table.setWidthPercentage(100);
        table.setWidths(new float[]{45f, 15f, 20f, 20f});
        table.setHeaderRows(1);

        Font headerFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 8.5f, Color.WHITE);
        String[] headers = {"ITEM", "QTY", "RATE", "TOTAL"};
        for (String h : headers) {
            PdfPCell cell = new PdfPCell(new Phrase(h, headerFont));
            cell.setBackgroundColor(primaryAmber);
            cell.setHorizontalAlignment(Element.ALIGN_CENTER);
            cell.setPadding(5f);
            table.addCell(cell);
        }

        Font itemFont = FontFactory.getFont(FontFactory.HELVETICA, 8.5f, darkCharcoal);
        Font itemBoldFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 8.5f, darkCharcoal);

        for (BillItem item : bill.getItems()) {
            PdfPCell nameCell = new PdfPCell(new Phrase(item.getName(), itemBoldFont));
            nameCell.setPadding(4f);
            table.addCell(nameCell);

            PdfPCell qtyCell = new PdfPCell(new Phrase(String.valueOf(item.getQuantity()), itemFont));
            qtyCell.setHorizontalAlignment(Element.ALIGN_CENTER);
            qtyCell.setPadding(4f);
            table.addCell(qtyCell);

            PdfPCell rateCell = new PdfPCell(new Phrase(String.format("Rs %.2f", item.getUnitPriceRupees()), itemFont));
            rateCell.setHorizontalAlignment(Element.ALIGN_RIGHT);
            rateCell.setPadding(4f);
            table.addCell(rateCell);

            PdfPCell totalCell = new PdfPCell(new Phrase(String.format("Rs %.2f", item.getLineTotalRupees()), itemBoldFont));
            totalCell.setHorizontalAlignment(Element.ALIGN_RIGHT);
            totalCell.setPadding(4f);
            table.addCell(totalCell);
        }

        document.add(table);

        // 4. Grand Total Section
        Paragraph grandTotalPara = new Paragraph();
        grandTotalPara.setSpacingBefore(12f);
        grandTotalPara.setAlignment(Element.ALIGN_RIGHT);

        Font grandTotalLabelFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 10f, textMuted);
        Font grandTotalAmountFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 15f, new Color(16, 120, 60));

        grandTotalPara.add(new Phrase("GRAND TOTAL: ", grandTotalLabelFont));
        grandTotalPara.add(new Phrase(String.format("Rs %.2f\n", bill.getGrandTotalRupees()), grandTotalAmountFont));
        document.add(grandTotalPara);

        // 5. Footer & Thank you
        Paragraph footer = new Paragraph();
        footer.setSpacingBefore(18f);
        footer.setAlignment(Element.ALIGN_CENTER);

        Font thankFont = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9f, primaryAmber);
        footer.add(new Phrase("Thank you for choosing Annpurna Chole Bhature!\n", thankFont));

        Font visitFont = FontFactory.getFont(FontFactory.HELVETICA, 8f, textMuted);
        footer.add(new Phrase("Please visit us again.\n", visitFont));
        document.add(footer);

        document.close();
        return out.toByteArray();
    }
}
