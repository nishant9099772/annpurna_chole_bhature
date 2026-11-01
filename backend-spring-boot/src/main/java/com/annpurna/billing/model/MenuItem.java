package com.annpurna.billing.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class MenuItem {
    private String key;
    private String name;
    private String subtitle;
    private Long unitPricePaise;
    private Double unitPriceRupees;
    private String category;
}
