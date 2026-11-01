package com.annpurna.billing.service;

import com.annpurna.billing.model.Bill;
import com.annpurna.billing.model.BillItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Service
public class GoogleSheetsService {

    private static final Logger log = LoggerFactory.getLogger(GoogleSheetsService.class);
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${app.google.sheets.spreadsheet-id:}")
    private String defaultSpreadsheetId;

    public void saveBillToGoogleSheets(Bill bill, String accessToken, String optionalSpreadsheetId) {
        String rawSpreadsheetId = (optionalSpreadsheetId != null && !optionalSpreadsheetId.isBlank())
                ? optionalSpreadsheetId
                : defaultSpreadsheetId;

        String spreadsheetId = extractSpreadsheetId(rawSpreadsheetId);

        if (spreadsheetId == null || spreadsheetId.isBlank()) {
            throw new IllegalStateException("Google Sheet ID is not configured. Please provide GOOGLE_SHEET_ID.");
        }

        if (accessToken == null || accessToken.isBlank()) {
            throw new IllegalArgumentException("Google OAuth access token is required to write to Sheets");
        }

        HttpHeaders headers = new HttpHeaders();
        headers.setBearerAuth(accessToken);
        headers.setContentType(MediaType.APPLICATION_JSON);

        // 1. Ensure structure (Bills and Bill Items tabs)
        ensureTabsExist(spreadsheetId, headers);

        // 2. Append to Bills tab
        // [Bill Number, Order Type, Date & Time (IST), Customer Name, Mobile Number, Grand Total, Bill ID]
        List<Object> billRow = List.of(
                bill.getBillNumber(),
                bill.getOrderTypeLabel() != null ? bill.getOrderTypeLabel() : "Dine In",
                bill.getDateTimeKolkata(),
                bill.getCustomerName(),
                bill.getCountryCode() + " " + bill.getMobileNumber(),
                bill.getGrandTotalRupees(),
                bill.getId()
        );

        Map<String, Object> billBody = Map.of("values", List.of(billRow));
        String billsUrl = String.format("https://sheets.googleapis.com/v4/spreadsheets/%s/values/Bills!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", spreadsheetId);

        ResponseEntity<String> billResponse = restTemplate.postForEntity(billsUrl, new HttpEntity<>(billBody, headers), String.class);
        if (!billResponse.getStatusCode().is2xxSuccessful()) {
            throw new RuntimeException("Failed to append row to Bills tab: " + billResponse.getBody());
        }

        // 3. Append to Bill Items tab
        List<List<Object>> itemRows = new ArrayList<>();
        for (BillItem item : bill.getItems()) {
            itemRows.add(List.of(
                    bill.getBillNumber(),
                    bill.getOrderTypeLabel() != null ? bill.getOrderTypeLabel() : "Dine In",
                    item.getName(),
                    item.getQuantity(),
                    item.getUnitPriceRupees(),
                    item.getLineTotalRupees(),
                    bill.getId()
            ));
        }

        Map<String, Object> itemsBody = Map.of("values", itemRows);
        String itemsUrl = String.format("https://sheets.googleapis.com/v4/spreadsheets/%s/values/'Bill Items'!A:F:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS", spreadsheetId);

        ResponseEntity<String> itemsResponse = restTemplate.postForEntity(itemsUrl, new HttpEntity<>(itemsBody, headers), String.class);
        if (!itemsResponse.getStatusCode().is2xxSuccessful()) {
            throw new RuntimeException("Failed to append rows to Bill Items tab: " + itemsResponse.getBody());
        }

        bill.setSavedToSheets(true);
        bill.setSpreadsheetId(spreadsheetId);
        bill.setSpreadsheetUrl("https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit");
        log.info("Bill {} successfully appended to Google Sheets ID: {}", bill.getBillNumber(), spreadsheetId);
    }

    private void ensureTabsExist(String spreadsheetId, HttpHeaders headers) {
        try {
            String checkUrl = "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId;
            ResponseEntity<Map> response = restTemplate.exchange(checkUrl, HttpMethod.GET, new HttpEntity<>(headers), Map.class);
            Map body = response.getBody();
            if (body == null) return;

            List<Map<String, Object>> sheets = (List<Map<String, Object>>) body.get("sheets");
            boolean hasBills = false;
            boolean hasItems = false;

            if (sheets != null) {
                for (Map<String, Object> sheet : sheets) {
                    Map<String, Object> props = (Map<String, Object>) sheet.get("properties");
                    if (props != null) {
                        String title = (String) props.get("title");
                        if ("Bills".equals(title)) hasBills = true;
                        if ("Bill Items".equals(title)) hasItems = true;
                    }
                }
            }

            List<Map<String, Object>> requests = new ArrayList<>();
            if (!hasBills) {
                requests.add(Map.of("addSheet", Map.of("properties", Map.of("title", "Bills"))));
            }
            if (!hasItems) {
                requests.add(Map.of("addSheet", Map.of("properties", Map.of("title", "Bill Items"))));
            }

            if (!requests.isEmpty()) {
                String updateUrl = "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + ":batchUpdate";
                restTemplate.postForEntity(updateUrl, new HttpEntity<>(Map.of("requests", requests), headers), String.class);
            }
        } catch (Exception e) {
            log.warn("Warning while ensuring spreadsheet structure: {}", e.getMessage());
        }
    }

    private String extractSpreadsheetId(String inputOrUrl) {
        if (inputOrUrl == null || inputOrUrl.isBlank()) return "";
        String trimmed = inputOrUrl.trim();
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("/spreadsheets/d/([a-zA-Z0-9-_]+)");
        java.util.regex.Matcher matcher = pattern.matcher(trimmed);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return trimmed.split("\\?")[0].split("#")[0].replaceAll("^/+|/+$", "");
    }
}
