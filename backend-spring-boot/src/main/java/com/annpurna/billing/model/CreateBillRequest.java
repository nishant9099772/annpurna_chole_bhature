package com.annpurna.billing.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.Data;
import java.util.List;

@Data
public class CreateBillRequest {
    @NotBlank(message = "Order type is required (DINE_IN or PACK)")
    private String orderType;

    @NotBlank(message = "Customer name is required")
    private String customerName;

    private String countryCode = "+91";

    @NotBlank(message = "Customer mobile number is required")
    private String mobileNumber;

    @NotEmpty(message = "At least one item must be included in the bill")
    private List<ItemEntry> items;

    private String googleAccessToken;
    private String customSpreadsheetId;

    @Data
    public static class ItemEntry {
        @NotBlank(message = "Item key is required")
        private String itemKey;

        private int quantity;
        private Double coldDrinkUnitPriceRupees;
    }
}
