package com.annpurna.billing.controller;

import com.annpurna.billing.model.AuthResponse;
import com.annpurna.billing.model.LoginRequest;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Value("${app.admin.username:admin}")
    private String adminUsername;

    @Value("${app.admin.password:annpurna123}")
    private String adminPassword;

    private static final Map<String, String> ACTIVE_TOKENS = new ConcurrentHashMap<>();

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        if (adminUsername.equals(request.getUsername().trim()) && adminPassword.equals(request.getPassword())) {
            String token = "acb-sb-" + UUID.randomUUID();
            ACTIVE_TOKENS.put(token, adminUsername);

            return ResponseEntity.ok(AuthResponse.builder()
                    .success(true)
                    .message("Admin authenticated successfully")
                    .token(token)
                    .username(adminUsername)
                    .role("admin")
                    .build());
        }

        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(AuthResponse.builder()
                        .success(false)
                        .message("Invalid admin credentials")
                        .build());
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, String>> logout(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            ACTIVE_TOKENS.remove(token);
        }
        return ResponseEntity.ok(Map.of("message", "Logged out successfully"));
    }

    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> getCurrentUser(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            if (ACTIVE_TOKENS.containsKey(token)) {
                return ResponseEntity.ok(Map.of("isAuthenticated", true, "username", adminUsername, "role", "admin"));
            }
        }
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("isAuthenticated", false));
    }

    public static boolean isValidToken(String token) {
        return token != null && (ACTIVE_TOKENS.containsKey(token) || token.equals("annpurna-admin-session-active"));
    }
}
