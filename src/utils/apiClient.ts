/**
 * Centralized API Client, Response Parser & Capacitor Android Networking Layer
 *
 * Solves two critical issues in Capacitor Android APKs:
 * 1. Android WebView / CapacitorHttp bridges may normalize, omit, or alter `Content-Type`
 *    headers on HTTP 200 responses, causing header-only checks (`contentType.includes('application/json')`)
 *    to falsely reject valid HTTP 200 JSON responses with `(HTTP 200)` errors.
 * 2. In a Capacitor Android APK, `window.location.origin` is `https://localhost` (or `capacitor://localhost`).
 *    Relative `fetch('/api/...')` calls hit Capacitor's local `WebViewLocalServer`, which serves the SPA
 *    `index.html` fallback with `HTTP 200 OK` (`text/html`). This module routes `/api/*` calls to the
 *    configured remote API base URL (if provided) and automatically falls back to the embedded
 *    production API engine (`capacitorLocalApi.ts`) when `/api/*` returns an HTML SPA fallback in the APK.
 */

import { handleCapacitorLocalApiRequest } from './capacitorLocalApi';

export const API_BASE_URL_STORAGE_KEY = 'annpurna_api_base_url';

/**
 * Normalizes a configured API base URL (strips quotes, trailing slashes, and accidental `/api` suffix).
 */
export function normalizeApiBaseUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/^["']+|["']+$/g, '').trim();
  if (!cleaned || cleaned === 'MY_APP_URL' || cleaned === 'undefined' || cleaned === 'null') {
    return '';
  }
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  if (cleaned.toLowerCase().endsWith('/api')) {
    cleaned = cleaned.slice(0, -4);
  }
  if (cleaned.toLowerCase().endsWith('/.netlify/functions/api')) {
    cleaned = cleaned.slice(0, -'/.netlify/functions/api'.length);
  }
  return cleaned;
}

/**
 * Detects whether the app is running inside a Capacitor native container or Android WebView.
 */
export function isCapacitorOrAndroidWebView(): boolean {
  if (typeof window === 'undefined') return false;

  const win = window as any;
  if (win.Capacitor) {
    if (typeof win.Capacitor.isNativePlatform === 'function') {
      if (win.Capacitor.isNativePlatform()) return true;
    }
    if (
      win.Capacitor.platform === 'android' ||
      win.Capacitor.platform === 'ios' ||
      win.Capacitor.isNative
    ) {
      return true;
    }
  }

  const protocol = window.location?.protocol || '';
  if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') {
    return true;
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isAndroidUa = /Android/i.test(ua) && (/; wv\)/i.test(ua) || /Version\/\d+\.\d+/i.test(ua));
  if (isAndroidUa) {
    return true;
  }

  // Capacitor 5+ Android default scheme is https://localhost with no port
  const hostname = window.location?.hostname || '';
  const port = window.location?.port || '';
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && protocol === 'https:' && !port) {
    return true;
  }

  return false;
}

/**
 * Returns the active remote API base URL if configured via localStorage or Vite environment variables.
 */
export function getConfiguredApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_URL_STORAGE_KEY));
      if (saved) return saved;
    } catch {
      // ignore storage errors
    }
  }

  const envMeta = (import.meta as any)?.env || {};
  const envUrl = normalizeApiBaseUrl(
    envMeta.VITE_API_BASE_URL || envMeta.VITE_BACKEND_URL || envMeta.VITE_NETLIFY_URL || ''
  );
  if (envUrl) return envUrl;

  return '';
}

/**
 * Saves or clears a custom remote API base URL in localStorage.
 */
export function setConfiguredApiBaseUrl(url: string): string {
  const normalized = normalizeApiBaseUrl(url);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (normalized) {
        window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }
  return normalized;
}

/**
 * Resolves an `/api/...` path against the configured remote API base URL if applicable.
 */
export function resolveApiUrl(pathOrUrl: string): string {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  if (pathOrUrl.startsWith('/api')) {
    const baseUrl = getConfiguredApiBaseUrl();
    if (baseUrl) {
      return `${baseUrl}${pathOrUrl}`;
    }
  }
  return pathOrUrl;
}

/**
 * Checks whether a raw response text looks like an HTML document (e.g. SPA `index.html` fallback).
 */
export function isHtmlPayload(text: string): boolean {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return false;
  return /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
}

export interface ParsedApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
  isHtml: boolean;
}

/**
 * Resiliently parses a `fetch` Response object across standard browsers and Capacitor Android WebViews.
 *
 * - Always attempts `JSON.parse()` on the response body regardless of whether `Content-Type` header
 *   was omitted, lowercased, or altered by Android WebView / `CapacitorHttp`.
 * - Never treats a valid HTTP 200 JSON response as an error.
 * - Accurately flags unexpected HTML responses (`isHtml: true`).
 */
export async function parseApiJsonResponse<T = any>(
  response: Response
): Promise<ParsedApiResponse<T>> {
  const status = typeof response.status === 'number' ? response.status : 200;
  const ok = Boolean(response.ok ?? (status >= 200 && status < 300));

  let rawText = '';
  let parsedData: any = null;

  // Handle non-standard Capacitor bridges that attach `.data` directly on the response
  const anyRes = response as any;
  if (anyRes && anyRes.data !== undefined && typeof anyRes.data === 'object' && anyRes.data !== null) {
    return {
      ok,
      status,
      data: anyRes.data as T,
      rawText: JSON.stringify(anyRes.data),
      isHtml: false,
    };
  }

  try {
    // Clone if possible so body stream isn't locked if inspected elsewhere
    const target = typeof response.clone === 'function' ? response.clone() : response;
    rawText = await target.text();
  } catch {
    try {
      parsedData = await response.json();
      return {
        ok,
        status,
        data: parsedData as T,
        rawText: JSON.stringify(parsedData),
        isHtml: false,
      };
    } catch {
      rawText = '';
    }
  }

  const trimmed = (rawText || '').replace(/^\uFEFF/, '').trim();
  const htmlDetected = isHtmlPayload(trimmed);

  if (trimmed && !htmlDetected) {
    try {
      parsedData = JSON.parse(trimmed);
    } catch {
      // Sometimes proxies wrap JSON or add trailing characters; try extracting outer JSON object/array
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsedData = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
        } catch {
          parsedData = null;
        }
      }
    }
  }

  return {
    ok,
    status,
    data: parsedData as T | null,
    rawText,
    isHtml: htmlDetected,
  };
}

let fetchInterceptorInstalled = false;

/**
 * Installs a transparent global `window.fetch` wrapper for `/api/*` requests.
 *
 * - Automatically prepends the configured remote API base URL when running in Capacitor.
 * - Ensures `Accept: application/json` header is included on API calls.
 * - If a `/api/*` request hits Capacitor's local Android WebView (`https://localhost`) and returns
 *   the SPA `index.html` with HTTP 200 (or fails with a connection error when no remote server is set),
 *   automatically executes the request via the embedded Capacitor local API engine (`capacitorLocalApi.ts`).
 */
export function installCapacitorApiFetchInterceptor(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (fetchInterceptorInstalled) return;
  fetchInterceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let rawUrl = '';
    if (typeof input === 'string') {
      rawUrl = input;
    } else if (input instanceof URL) {
      rawUrl = input.toString();
    } else if (input && typeof (input as Request).url === 'string') {
      rawUrl = (input as Request).url;
    }

    // Check if this is an internal `/api/` request
    const isRelativeApi = rawUrl.startsWith('/api/') || rawUrl === '/api';
    let apiPathWithQuery = '';
    if (isRelativeApi) {
      apiPathWithQuery = rawUrl;
    } else if (/^https?:\/\//i.test(rawUrl)) {
      try {
        const u = new URL(rawUrl);
        if (u.pathname.startsWith('/api/') || u.pathname === '/api') {
          apiPathWithQuery = `${u.pathname}${u.search}`;
        }
      } catch {
        // ignore
      }
    }

    if (!apiPathWithQuery) {
      return originalFetch(input, init);
    }

    const resolvedUrl = isRelativeApi ? resolveApiUrl(apiPathWithQuery) : rawUrl;

    // Ensure Accept: application/json is present without mutating caller's headers
    const mergedHeaders = new Headers(init?.headers || {});
    if (!mergedHeaders.has('Accept')) {
      mergedHeaders.set('Accept', 'application/json');
    }

    const updatedInit: RequestInit = {
      ...init,
      headers: mergedHeaders,
    };

    try {
      const response = await originalFetch(resolvedUrl, updatedInit);
      const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();

      // If PDF endpoint returned a PDF, return directly
      if (contentType.includes('application/pdf')) {
        return response;
      }

      // Inspect a clone of the response to check if Capacitor's local WebView server
      // returned `index.html` (HTTP 200 text/html) for an `/api/*` route
      if (typeof response.clone === 'function') {
        const clonedText = await response
          .clone()
          .text()
          .catch(() => '');
        if (isHtmlPayload(clonedText)) {
          // Capacitor WebView returned index.html with HTTP 200 for `/api/*`!
          // Route through the embedded local API engine so the Android APK works seamlessly.
          return handleCapacitorLocalApiRequest(apiPathWithQuery, init);
        }
      }

      return response;
    } catch (networkErr) {
      // If running inside Capacitor / Android WebView (or localhost without a backend server),
      // handle the `/api/*` request locally rather than failing the Android APK.
      if (isCapacitorOrAndroidWebView() || !getConfiguredApiBaseUrl()) {
        return handleCapacitorLocalApiRequest(apiPathWithQuery, init);
      }
      throw networkErr;
    }
  };
}
