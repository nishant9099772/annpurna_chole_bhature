package com.annpurna.billing.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Bill {
    private String id;
    private String billNumber;
    private String orderType;       // "DINE_IN" or "PACK"
    private String orderTypeLabel;  // "Dine In" or "Pack"
    private String customerName;
    private String countryCode;
    private String mobileNumber;
    private List<BillItem> items;
    private long grandTotalPaise;
    private double grandTotalRupees;
    private String dateTimeKolkata;
    private long timestamp;
    private boolean savedToSheets;
    private String spreadsheetId;
    private String spreadsheetUrl;
}
