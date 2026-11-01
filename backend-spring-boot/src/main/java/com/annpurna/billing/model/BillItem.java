package com.annpurna.billing.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BillItem {
    private String id;
    private String itemKey;
    private String name;
    private int quantity;
    private long unitPricePaise;
    private double unitPriceRupees;
    private long lineTotalPaise;
    private double lineTotalRupees;
}
