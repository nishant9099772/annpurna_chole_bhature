package com.annpurna.billing.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController {

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "annpurna-spring-boot-billing-api",
                "timezone", "Asia/Kolkata",
                "timestamp", ZonedDateTime.now().format(DateTimeFormatter.ISO_ZONED_DATE_TIME)
        ));
    }
}
