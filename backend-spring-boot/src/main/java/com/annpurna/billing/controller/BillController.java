package com.annpurna.billing.controller;

import com.annpurna.billing.model.Bill;
import com.annpurna.billing.model.CreateBillRequest;
import com.annpurna.billing.service.BillService;
import com.annpurna.billing.service.GoogleSheetsService;
import com.annpurna.billing.service.PdfGenerationService;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/bills")
public class BillController {

    private final BillService billService;
    private final GoogleSheetsService sheetsService;
    private final PdfGenerationService pdfService;

    public BillController(BillService billService, GoogleSheetsService sheetsService, PdfGenerationService pdfService) {
        this.billService = billService;
        this.sheetsService = sheetsService;
        this.pdfService = pdfService;
    }

    private void checkAuth(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing or invalid admin authorization header");
        }
        String token = authHeader.substring(7);
        if (!AuthController.isValidToken(token)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid admin token");
        }
    }

    @PostMapping
    public ResponseEntity<?> createBill(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @Valid @RequestBody CreateBillRequest request) {
        checkAuth(authHeader);

        try {
            Bill bill = billService.processAndCreateBill(request);

            // If Google Access Token is provided, write to Sheets immediately
            if (request.getGoogleAccessToken() != null && !request.getGoogleAccessToken().isBlank()) {
                try {
                    sheetsService.saveBillToGoogleSheets(bill, request.getGoogleAccessToken(), request.getCustomSpreadsheetId());
                    billService.updateBill(bill);
                } catch (Exception e) {
                    return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                            "error", "Failed to save bill to Google Sheets: " + e.getMessage(),
                            "billDraft", bill
                    ));
                }
            }

            return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                    "success", true,
                    "message", "Bill created successfully",
                    "bill", bill
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<List<Bill>> getAllBills(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        checkAuth(authHeader);
        return ResponseEntity.ok(billService.getAllBills());
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getBillById(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @PathVariable String id) {
        checkAuth(authHeader);
        return billService.getBillById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/pdf")
    public ResponseEntity<byte[]> getBillPdf(
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            @PathVariable String id) {
        checkAuth(authHeader);

        Bill bill = billService.getBillById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Bill not found"));

        try {
            byte[] pdfBytes = pdfService.generateBillPdf(bill);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDisposition(ContentDisposition.inline()
                    .filename("Annpurna-Bill-" + bill.getBillNumber() + ".pdf")
                    .build());

            return new ResponseEntity<>(pdfBytes, headers, HttpStatus.OK);
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "PDF generation failed: " + e.getMessage());
        }
    }
}
