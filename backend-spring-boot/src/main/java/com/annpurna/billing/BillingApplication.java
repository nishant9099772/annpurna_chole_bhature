package com.annpurna.billing;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import java.util.TimeZone;
import jakarta.annotation.PostConstruct;

@SpringBootApplication
public class BillingApplication {

    @PostConstruct
    public void init() {
        // Set default timezone to Asia/Kolkata
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Kolkata"));
    }

    public static void main(String[] args) {
        SpringApplication.run(BillingApplication.class, args);
    }
}
