package com.annpurna.billing.service;

import com.annpurna.billing.model.Bill;
import com.annpurna.billing.model.BillItem;
import com.annpurna.billing.model.CreateBillRequest;
import org.springframework.stereotype.Service;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class BillService {

    // Authoritative prices in paise (1 INR = 100 Paise)
    public static final Map<String, Long> FIXED_PRICES_PAISE = Map.of(
            "CHOLE_BHATURE", 8000L,
            "LASSI", 4000L,
            "CHOLE", 4000L,
            "BHATURE", 2500L
    );

    public static final Map<String, String> ITEM_NAMES = Map.of(
            "CHOLE_BHATURE", "Chole Bhature",
            "LASSI", "Lassi",
            "CHOLE", "Chole",
            "BHATURE", "Bhature",
            "COLD_DRINK", "Cold Drink"
    );

    private final Map<String, Bill> billStore = new ConcurrentHashMap<>();
    private final AtomicInteger sequenceNumber = new AtomicInteger(1);
    private static final ZoneId KOLKATA_ZONE = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("dd MMM yyyy, hh:mm:ss a 'IST'");

    public Bill processAndCreateBill(CreateBillRequest request) {
        // 1. Validate order type
        String rawOrderType = request.getOrderType() != null ? request.getOrderType().trim().toUpperCase() : "";
        if (!"DINE_IN".equals(rawOrderType) && !"PACK".equals(rawOrderType)) {
            throw new IllegalArgumentException("Order type is required and must be either DINE_IN or PACK");
        }
        String orderTypeLabel = "PACK".equals(rawOrderType) ? "Pack" : "Dine In";

        // 2. Validate customer name
        String trimmedName = request.getCustomerName() != null ? request.getCustomerName().trim() : "";
        if (trimmedName.length() < 2) {
            throw new IllegalArgumentException("Customer name must be at least 2 characters long");
        }

        // 2. Validate mobile number
        String cleanMobile = request.getMobileNumber() != null ? request.getMobileNumber().replaceAll("\\D", "") : "";
        if (cleanMobile.length() < 7 || cleanMobile.length() > 15) {
            throw new IllegalArgumentException("Customer mobile number must be between 7 and 15 digits");
        }

        // 3. Validate items
        if (request.getItems() == null || request.getItems().isEmpty()) {
            throw new IllegalArgumentException("At least one menu item is required");
        }

        long grandTotalPaise = 0L;
        List<BillItem> validatedItems = new ArrayList<>();

        for (CreateBillRequest.ItemEntry entry : request.getItems()) {
            String key = entry.getItemKey();
            int qty = entry.getQuantity();

            if (qty <= 0) {
                throw new IllegalArgumentException("Quantity must be a positive whole number for item: " + key);
            }

            long unitPricePaise;
            String itemName = ITEM_NAMES.getOrDefault(key, key);

            if ("COLD_DRINK".equalsIgnoreCase(key)) {
                Double mrp = entry.getColdDrinkUnitPriceRupees();
                if (mrp == null || mrp <= 0) {
                    throw new IllegalArgumentException("Cold drink requires a valid positive MRP price");
                }
                unitPricePaise = Math.round(mrp * 100);
            } else if (FIXED_PRICES_PAISE.containsKey(key)) {
                unitPricePaise = FIXED_PRICES_PAISE.get(key);
            } else {
                throw new IllegalArgumentException("Unrecognized menu item key: " + key);
            }

            long lineTotalPaise = unitPricePaise * qty;
            grandTotalPaise += lineTotalPaise;

            validatedItems.add(BillItem.builder()
                    .id(UUID.randomUUID().toString())
                    .itemKey(key)
                    .name(itemName)
                    .quantity(qty)
                    .unitPricePaise(unitPricePaise)
                    .unitPriceRupees(unitPricePaise / 100.0)
                    .lineTotalPaise(lineTotalPaise)
                    .lineTotalRupees(lineTotalPaise / 100.0)
                    .build());
        }

        // 4. Time and Unique Bill Number in Asia/Kolkata
        ZonedDateTime nowKolkata = ZonedDateTime.now(KOLKATA_ZONE);
        String dateTimeKolkata = nowKolkata.format(FORMATTER);

        String datePrefix = nowKolkata.format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        String billNumber = String.format("ACB-%s-%04d", datePrefix, sequenceNumber.getAndIncrement());
        String billId = "BILL-" + UUID.randomUUID();

        Bill bill = Bill.builder()
                .id(billId)
                .billNumber(billNumber)
                .orderType(rawOrderType)
                .orderTypeLabel(orderTypeLabel)
                .customerName(trimmedName)
                .countryCode(request.getCountryCode() != null ? request.getCountryCode().trim() : "+91")
                .mobileNumber(cleanMobile)
                .items(validatedItems)
                .grandTotalPaise(grandTotalPaise)
                .grandTotalRupees(grandTotalPaise / 100.0)
                .dateTimeKolkata(dateTimeKolkata)
                .timestamp(System.currentTimeMillis())
                .savedToSheets(false)
                .build();

        billStore.put(bill.getId(), bill);
        return bill;
    }

    public Optional<Bill> getBillById(String id) {
        return Optional.ofNullable(billStore.get(id));
    }

    public List<Bill> getAllBills() {
        List<Bill> list = new ArrayList<>(billStore.values());
        list.sort((a, b) -> Long.compare(b.getTimestamp(), a.getTimestamp()));
        return list;
    }

    public void updateBill(Bill bill) {
        billStore.put(bill.getId(), bill);
    }
}
