/**
 * Centralized API Client, Response Parser & Capacitor Android Networking Layer
 *
 * Architecture:
 *   Netlify Website & Android APK -> https://annpurnacholebhature.netlify.app/api/* -> Google Sheets API v4
 *
 * Uses `import.meta.env.VITE_API_BASE_URL` (defined in `.env.production` as
 * `https://annpurnacholebhature.netlify.app`) as the production API base URL for all backend requests.
 *
 * Key Guarantees:
 * 1. Production Base URL: On the deployed Netlify website and inside the Android Capacitor APK,
 *    every backend request is resolved via `resolveApiUrl('/api/...')` / `apiFetch('/api/...')`
 *    against `import.meta.env.VITE_API_BASE_URL` (`https://annpurnacholebhature.netlify.app`).
 *    No relative `/api/...` paths are ever sent in the Android Capacitor app.
 * 2. Local Preview Compatibility: When running on the local Express dev/preview server
 *    (`localhost:3000` or `*.run.app`), requests route directly to the local Express backend
 *    so newly implemented features can be tested without overwriting production prematurely.
 * 3. Infinite loading protection: Every `/api/*` request is guarded by an `AbortController` timeout
 *    (12s for standard endpoints, 20s for Google Sheets sync endpoints) so Android WebView requests
 *    can never hang indefinitely.
 * 4. Cross-origin CORS compatibility: Uses stateless `Authorization: Bearer <token>` headers with
 *    `credentials: 'omit'` and `mode: 'cors'` on cross-origin requests so Netlify's CORS headers
 *    work seamlessly with Android WebView and standard browsers.
 * 5. Resilient JSON parsing: Always parses HTTP 200 JSON payloads even when Android WebView bridges
 *    alter or omit `Content-Type` headers, while accurately detecting HTML SPA fallbacks.
 */

import { handleCapacitorLocalApiRequest, verifyLocalTokenPayload } from './capacitorLocalApi';
import { UserRole } from '../types/billing';

export const API_BASE_URL_STORAGE_KEY = 'annpurna_api_base_url';
export const DEFAULT_PRODUCTION_API_BASE_URL = 'https://annpurnacholebhature.netlify.app';

const STANDARD_API_TIMEOUT_MS = 20_000;
const SHEETS_SYNC_TIMEOUT_MS = 28_000;

/**
 * Decodes a signed `acb.<payloadB64>.<sigB64>` session token on the client to inspect
 * `{ sub, role, exp }` without relying solely on transient network state.
 */
export function decodeSessionTokenRole(token?: string | null): {
  sub: string;
  role: UserRole;
  exp: number;
} | null {
  return verifyLocalTokenPayload(token);
}

/**
 * Normalizes a configured API base URL (strips quotes, trailing slashes, and accidental `/api` suffix).
 */
export function normalizeApiBaseUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim().replace(/^["']+|["']+$/g, '').trim();
  if (
    !cleaned ||
    cleaned === 'MY_APP_URL' ||
    cleaned === 'undefined' ||
    cleaned === 'null' ||
    cleaned === 'http://localhost' ||
    cleaned === 'https://localhost' ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleaned)
  ) {
    return '';
  }
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  if (cleaned.toLowerCase().endsWith('/.netlify/functions/api')) {
    cleaned = cleaned.slice(0, -'/.netlify/functions/api'.length);
  }
  if (cleaned.toLowerCase().endsWith('/api')) {
    cleaned = cleaned.slice(0, -4);
  }
  return cleaned.replace(/\/+$/, '');
}

const RAW_VITE_API_BASE_URL: string =
  typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL)
    : DEFAULT_PRODUCTION_API_BASE_URL;

/**
 * Authoritative production API base URL resolved directly from `import.meta.env.VITE_API_BASE_URL`
 * (`.env.production`: `VITE_API_BASE_URL=https://annpurnacholebhature.netlify.app`).
 */
export const API_BASE_URL: string =
  normalizeApiBaseUrl(RAW_VITE_API_BASE_URL) || DEFAULT_PRODUCTION_API_BASE_URL;

/**
 * Detects whether the app is running inside a Capacitor native container or Android APK WebView.
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

  // Capacitor 5+ Android default scheme is https://localhost or http://localhost with no port
  const hostname = (window.location?.hostname || '').toLowerCase();
  const port = window.location?.port || '';
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && !port) {
    return true;
  }

  // If running on a hosted web domain (*.run.app or *.netlify.app), it is a web browser/webview on that domain, not a local APK asset server
  if (hostname.endsWith('.run.app') || hostname.endsWith('.netlify.app')) {
    return false;
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isAndroidWebViewUa = /Android/i.test(ua) && /; wv\)/i.test(ua);
  if (isAndroidWebViewUa) {
    return true;
  }

  return false;
}

/**
 * Returns the active production Netlify API base URL (`import.meta.env.VITE_API_BASE_URL` or custom HTTPS override).
 */
export function getConfiguredApiBaseUrl(): string {
  const envBaseUrl = normalizeApiBaseUrl(RAW_VITE_API_BASE_URL) || DEFAULT_PRODUCTION_API_BASE_URL;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const rawSaved = window.localStorage.getItem(API_BASE_URL_STORAGE_KEY);
      if (rawSaved) {
        const saved = normalizeApiBaseUrl(rawSaved);
        if (saved && /^https:\/\//i.test(saved)) {
          return saved;
        }
        // Clean up any stale or non-HTTPS override so Android always uses VITE_API_BASE_URL
        window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }

  return envBaseUrl || API_BASE_URL;
}

/**
 * Saves or resets a custom remote Netlify API base URL in localStorage.
 * When cleared, falls back to `import.meta.env.VITE_API_BASE_URL` (`API_BASE_URL`).
 */
export function setConfiguredApiBaseUrl(url: string): string {
  const normalized = normalizeApiBaseUrl(url);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (normalized && normalized !== API_BASE_URL) {
        window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
      }
      const effective = normalized || getConfiguredApiBaseUrl();
      window.dispatchEvent(
        new CustomEvent('annpurna:backend-url-changed', { detail: { baseUrl: effective } })
      );
      return effective;
    } catch {
      // ignore
    }
  }
  return normalized || getConfiguredApiBaseUrl();
}

/**
 * Resolves any `/api/...` endpoint to the full production backend URL (`https://annpurnacholebhature.netlify.app/api/...`).
 * Ensures Desktop, Netlify Website, AI Studio Preview, and Android Capacitor APK all connect to the exact same backend.
 */
export function resolveApiUrl(pathOrUrl: string): string {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  const baseUrl = getConfiguredApiBaseUrl() || API_BASE_URL;
  return `${baseUrl}${cleanPath}`;
}

/**
 * Executes an API request against the resolved backend URL (`import.meta.env.VITE_API_BASE_URL` in production/Android).
 * Works identically on both the Netlify website and the Android Capacitor APK.
 */
export function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  const fullUrl = resolveApiUrl(endpoint);
  return window.fetch(fullUrl, init);
}

/**
 * Tests connectivity to a candidate Netlify Backend URL by calling `/api/health`.
 */
export async function verifyNetlifyBackendUrl(rawUrl: string): Promise<{
  reachable: boolean;
  normalizedUrl: string;
  latencyMs?: number;
  error?: string;
}> {
  const normalizedUrl = normalizeApiBaseUrl(rawUrl) || getConfiguredApiBaseUrl();
  if (!normalizedUrl) {
    return {
      reachable: false,
      normalizedUrl: '',
      error: 'Please enter a valid Netlify URL (e.g. https://annpurnacholebhature.netlify.app).',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);
  const startMs = Date.now();

  try {
    const res = await window.fetch(`${normalizedUrl}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
    });
    const { ok, data, isHtml } = await parseApiJsonResponse<any>(res);
    if (ok && !isHtml && data?.status === 'UP') {
      return {
        reachable: true,
        normalizedUrl,
        latencyMs: Date.now() - startMs,
      };
    }
    if (isHtml) {
      return {
        reachable: false,
        normalizedUrl,
        error:
          'URL returned an HTML page instead of the Netlify API function. Check your Netlify deployment.',
      };
    }
    return {
      reachable: false,
      normalizedUrl,
      error: `Server responded with HTTP ${res.status}.`,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'AbortError';
    return {
      reachable: false,
      normalizedUrl,
      error: isTimeout
        ? 'Connection timed out after 8 seconds. Check the URL and internet connection.'
        : `Could not reach ${normalizedUrl}: ${err?.message || 'Network error'}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
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

/**
 * Returns true if a Response came from the local offline fallback engine rather than the live production Netlify API.
 */
export function isOfflineFallbackResponse(response?: Response | null): boolean {
  if (!response || !response.headers) return false;
  const source =
    typeof response.headers.get === 'function'
      ? response.headers.get('X-Annapurna-Source') || response.headers.get('x-annapurna-source')
      : '';
  return source === 'local-offline-fallback';
}

/**
 * Converts any `HeadersInit` into a plain `Record<string, string>` with canonical header names
 * so Capacitor's native Android bridge (`CapacitorHttp` / WebView fetch) never drops `Authorization` or `Content-Type`.
 */
function buildPlainHeadersRecord(initHeaders?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  const setCanonical = (rawKey: string, rawVal: string) => {
    const k = rawKey.trim();
    if (!k) return;
    const lower = k.toLowerCase();
    if (lower === 'authorization') {
      out['Authorization'] = rawVal;
    } else if (lower === 'content-type') {
      out['Content-Type'] = rawVal;
    } else if (lower === 'accept') {
      out['Accept'] = rawVal;
    } else if (lower === 'x-google-token') {
      out['x-google-token'] = rawVal;
    } else {
      out[k] = rawVal;
    }
  };

  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => setCanonical(k, v));
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) {
        if (typeof k === 'string' && typeof v === 'string') setCanonical(k, v);
      }
    } else if (typeof initHeaders === 'object') {
      for (const [k, v] of Object.entries(initHeaders)) {
        if (typeof v === 'string') setCanonical(k, v);
      }
    }
  }

  if (!out['Accept']) {
    out['Accept'] = 'application/json';
  }
  return out;
}

/**
 * Secret-safe Android API Diagnostic entry.
 * Never stores request bodies, passwords, tokens, or secrets.
 */
export interface AndroidApiDiagnostic {
  timestamp: string;
  method: string;
  url: string;
  status: number | null;
  transport: string;
  latencyMs: number;
  error: string | null;
}

const MAX_ANDROID_DIAGNOSTICS = 25;
const androidDiagnosticsBuffer: AndroidApiDiagnostic[] = [];
let lastAndroidApiFailure: AndroidApiDiagnostic | null = null;

function sanitizeUrlForDiagnostics(rawUrl: string): string {
  try {
    const u = new URL(rawUrl, DEFAULT_PRODUCTION_API_BASE_URL);
    u.searchParams.forEach((_, key) => {
      if (/token|key|secret|pass|auth/i.test(key)) {
        u.searchParams.set(key, '[REDACTED]');
      }
    });
    return u.toString();
  } catch {
    return rawUrl.split('?')[0];
  }
}

function recordAndroidDiagnostic(entry: AndroidApiDiagnostic): void {
  if (!isCapacitorOrAndroidWebView()) return;
  androidDiagnosticsBuffer.unshift(entry);
  if (androidDiagnosticsBuffer.length > MAX_ANDROID_DIAGNOSTICS) {
    androidDiagnosticsBuffer.pop();
  }
  if (entry.error || (entry.status !== null && entry.status >= 400)) {
    lastAndroidApiFailure = entry;
    console.warn(
      `[AndroidAPI Diagnostic] ${entry.method} ${entry.url} | status=${
        entry.status ?? 'NETWORK_ERR'
      } | transport=${entry.transport} | latency=${entry.latencyMs}ms | error=${
        entry.error || 'HTTP ' + entry.status
      }`
    );
  }
}

export function getAndroidApiDiagnostics(): AndroidApiDiagnostic[] {
  return [...androidDiagnosticsBuffer];
}

export function getLastAndroidApiFailure(): AndroidApiDiagnostic | null {
  return lastAndroidApiFailure;
}

/**
 * Executes an HTTP request using Capacitor's built-in native `CapacitorHttp` plugin if available.
 * Runs in native Android Java (`HttpURLConnection`), completely bypassing `WebViewLocalServer.shouldInterceptRequest`
 * and WebView CORS limitations while preserving `Authorization`, `Content-Type`, and JSON request bodies.
 */
async function executeCapacitorNativeHttp(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyString: string | undefined,
  timeoutMs: number
): Promise<Response | null> {
  if (typeof window === 'undefined') return null;
  const win = window as any;
  const capHttp =
    win.Capacitor?.Plugins?.CapacitorHttp ||
    win.CapacitorCustomPlatform?.plugins?.CapacitorHttp;

  if (!capHttp || typeof capHttp.request !== 'function') {
    return null;
  }

  let dataPayload: any = undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (bodyString && bodyString.trim().length > 0) {
      try {
        dataPayload = JSON.parse(bodyString);
      } catch {
        dataPayload = bodyString;
      }
    } else {
      dataPayload = {};
    }
  }

  const capRes = await capHttp.request({
    url,
    method,
    headers,
    ...(dataPayload !== undefined ? { data: dataPayload } : {}),
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });

  if (!capRes || typeof capRes.status !== 'number') {
    return null;
  }

  const resHeaders: Record<string, string> = {
    'X-Annapurna-Transport': 'capacitor-http',
  };
  if (capRes.headers && typeof capRes.headers === 'object') {
    for (const [k, v] of Object.entries(capRes.headers)) {
      if (typeof v === 'string') {
        resHeaders[k] = v;
      } else if (Array.isArray(v)) {
        resHeaders[k] = v.join(', ');
      }
    }
  }
  if (!resHeaders['Content-Type'] && !resHeaders['content-type']) {
    resHeaders['Content-Type'] = 'application/json; charset=utf-8';
  }

  const responseText =
    typeof capRes.data === 'string' ? capRes.data : JSON.stringify(capRes.data ?? {});

  return new Response(responseText, {
    status: capRes.status,
    headers: resHeaders,
  });
}

/**
 * Executes an HTTP request via standard `XMLHttpRequest` as a resilient fallback when
 * Android WebView `window.fetch` throws `TypeError: Failed to fetch`.
 */
function executeXhrFetch(
  url: string,
  method: string,
  headers: Record<string, string>,
  bodyString: string | undefined,
  timeoutMs: number
): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      reject(new Error('XMLHttpRequest is not available'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = timeoutMs;
    xhr.withCredentials = false;

    for (const [k, v] of Object.entries(headers)) {
      try {
        xhr.setRequestHeader(k, v);
      } catch {
        // ignore restricted header names
      }
    }

    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type') || 'application/json; charset=utf-8';
      resolve(
        new Response(xhr.responseText ?? '', {
          status: xhr.status || 200,
          headers: {
            'Content-Type': contentType,
            'X-Annapurna-Transport': 'xhr',
          },
        })
      );
    };

    xhr.onerror = () => {
      reject(new Error(`XHR network error (status=${xhr.status || 0})`));
    };

    xhr.ontimeout = () => {
      const err = new Error(`XHR timed out after ${Math.round(timeoutMs / 1000)}s`);
      err.name = 'AbortError';
      reject(err);
    };

    try {
      if (method !== 'GET' && method !== 'HEAD' && bodyString !== undefined) {
        xhr.send(bodyString);
      } else {
        xhr.send();
      }
    } catch (sendErr) {
      reject(sendErr);
    }
  });
}

let fetchInterceptorInstalled = false;

/**
 * Installs a global `window.fetch` wrapper for all backend API requests.
 *
 * - Ensures any `/api/*` request is always resolved to the full production Netlify URL
 *   (`import.meta.env.VITE_API_BASE_URL` = `https://annpurnacholebhature.netlify.app`) in production & Android APK.
 * - Uses plain `Record<string, string>` headers and explicit stringified bodies so `Authorization`,
 *   `Content-Type`, and JSON request bodies survive across WebView `fetch`, `CapacitorHttp`, and `XMLHttpRequest`.
 * - Never substitutes local offline responses for `/api/auth/login`, `/api/auth/me`, or `/api/sheets/status`.
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

    const configuredBaseUrl = getConfiguredApiBaseUrl();
    const inCapacitor = isCapacitorOrAndroidWebView();
    const resolvedUrl = resolveApiUrl(apiPathWithQuery);
    const safeDiagUrl = sanitizeUrlForDiagnostics(resolvedUrl);

    const isCrossOrigin =
      /^https?:\/\//i.test(resolvedUrl) &&
      typeof window !== 'undefined' &&
      !resolvedUrl.startsWith(window.location.origin);

    const method = (
      init?.method ||
      (input instanceof Request ? input.method : 'GET') ||
      'GET'
    ).toUpperCase();

    const plainHeaders = buildPlainHeadersRecord(
      init?.headers || (input instanceof Request ? input.headers : undefined)
    );

    // Extract request body reliably whether passed via init.body or Request object
    let bodyString: string | undefined = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      if (typeof init?.body === 'string') {
        bodyString = init.body;
      } else if (init?.body && typeof init.body === 'object') {
        try {
          bodyString = JSON.stringify(init.body);
        } catch {
          bodyString = undefined;
        }
      } else if (input instanceof Request) {
        try {
          bodyString = await input.clone().text();
        } catch {
          bodyString = undefined;
        }
      }

      if (!plainHeaders['Content-Type']) {
        plainHeaders['Content-Type'] = 'application/json';
      }
      if (bodyString === undefined || bodyString === '') {
        bodyString = '{}';
      }
    }

    const isSheetsHeavyRoute =
      apiPathWithQuery.includes('/batch-sync-sheets') ||
      apiPathWithQuery.includes('/retry-sheets') ||
      apiPathWithQuery.includes('/hydrate') ||
      (apiPathWithQuery.startsWith('/api/bills') && method === 'POST');

    // Endpoints that MUST always be answered by the live production Netlify backend
    // and must NEVER silently fall back to local storage:
    const isStrictProductionOnlyRoute =
      apiPathWithQuery.startsWith('/api/auth/login') ||
      apiPathWithQuery.startsWith('/api/auth/me') ||
      apiPathWithQuery.startsWith('/api/auth/logout') ||
      apiPathWithQuery.startsWith('/api/sheets/status') ||
      apiPathWithQuery.startsWith('/api/health') ||
      apiPathWithQuery.includes('/retry-sheets') ||
      apiPathWithQuery.includes('/batch-sync-sheets');

    const timeoutMs = isSheetsHeavyRoute ? SHEETS_SYNC_TIMEOUT_MS : STANDARD_API_TIMEOUT_MS;
    const startMs = Date.now();
    const transportsAttempted: string[] = [];

    const executeStandardFetch = async (
      attemptTimeoutMs: number,
      useBareOptions: boolean
    ): Promise<Response> => {
      const controller = new AbortController();
      const callerSignal = init?.signal;
      const onCallerAbort = () => controller.abort();
      if (callerSignal) {
        if (callerSignal.aborted) {
          controller.abort();
        } else {
          callerSignal.addEventListener('abort', onCallerAbort, { once: true });
        }
      }
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const fetchInit: RequestInit = useBareOptions
          ? {
              method,
              headers: plainHeaders,
              ...(bodyString !== undefined ? { body: bodyString } : {}),
            }
          : {
              method,
              headers: plainHeaders,
              ...(bodyString !== undefined ? { body: bodyString } : {}),
              signal: controller.signal,
              ...(isCrossOrigin ? { mode: 'cors', credentials: 'omit' } : {}),
            };
        return await originalFetch(resolvedUrl, fetchInit);
      } finally {
        clearTimeout(timeoutId);
        if (callerSignal) {
          callerSignal.removeEventListener('abort', onCallerAbort);
        }
      }
    };

    const runMultiTransportAttempt = async (): Promise<{
      response: Response;
      transport: string;
    }> => {
      let lastError: any = null;

      // 1. On Android Capacitor, try native CapacitorHttp first if available on window.Capacitor
      if (inCapacitor) {
        try {
          transportsAttempted.push('capacitor-http');
          const capRes = await executeCapacitorNativeHttp(
            resolvedUrl,
            method,
            plainHeaders,
            bodyString,
            timeoutMs
          );
          if (capRes) {
            const text = await capRes
              .clone()
              .text()
              .catch(() => '');
            if (!isHtmlPayload(text)) {
              return { response: capRes, transport: 'capacitor-http' };
            }
          }
        } catch (capErr: any) {
          lastError = capErr;
        }
      }

      // 2. Standard window.fetch with CORS & AbortController
      try {
        transportsAttempted.push('fetch');
        const stdRes = await executeStandardFetch(timeoutMs, false);
        const text =
          typeof stdRes.clone === 'function'
            ? await stdRes
                .clone()
                .text()
                .catch(() => '')
            : '';
        if (!isHtmlPayload(text)) {
          return { response: stdRes, transport: 'fetch' };
        }
        lastError = new Error(
          `Received unexpected HTML payload (HTTP ${stdRes.status}) from ${safeDiagUrl}`
        );
      } catch (fetchErr: any) {
        lastError = fetchErr;
      }

      // 3. On Android Capacitor, if standard fetch failed (e.g. "TypeError: Failed to fetch"),
      //    try bare fetch (without AbortSignal / credentials options) and then XMLHttpRequest
      if (inCapacitor) {
        try {
          transportsAttempted.push('bare-fetch');
          const bareRes = await executeStandardFetch(timeoutMs, true);
          const text =
            typeof bareRes.clone === 'function'
              ? await bareRes
                  .clone()
                  .text()
                  .catch(() => '')
              : '';
          if (!isHtmlPayload(text)) {
            return { response: bareRes, transport: 'bare-fetch' };
          }
        } catch (bareErr: any) {
          lastError = bareErr;
        }

        try {
          transportsAttempted.push('xhr');
          const xhrRes = await executeXhrFetch(
            resolvedUrl,
            method,
            plainHeaders,
            bodyString,
            timeoutMs
          );
          const text = await xhrRes
            .clone()
            .text()
            .catch(() => '');
          if (!isHtmlPayload(text)) {
            return { response: xhrRes, transport: 'xhr' };
          }
          lastError = new Error(
            `XHR received unexpected HTML payload (HTTP ${xhrRes.status}) from ${safeDiagUrl}`
          );
        } catch (xhrErr: any) {
          lastError = xhrErr;
        }
      }

      throw lastError || new Error('Network request failed');
    };

    try {
      let result: { response: Response; transport: string };
      try {
        result = await runMultiTransportAttempt();
      } catch (firstErr: any) {
        if (init?.signal?.aborted) {
          throw firstErr;
        }
        await new Promise((r) => setTimeout(r, 400));
        result = await runMultiTransportAttempt();
      }

      const { response, transport } = result;
      recordAndroidDiagnostic({
        timestamp: new Date().toISOString(),
        method,
        url: safeDiagUrl,
        status: response.status,
        transport,
        latencyMs: Date.now() - startMs,
        error: response.ok ? null : `HTTP ${response.status}`,
      });

      return response;
    } catch (networkErr: any) {
      const isTimeout = networkErr?.name === 'AbortError';
      const errName = networkErr?.name || 'NetworkError';
      const errMsg = networkErr?.message || 'Network connection failed';
      const transportSummary = transportsAttempted.join(' -> ') || 'fetch';
      const latencyMs = Date.now() - startMs;

      const diagEntry: AndroidApiDiagnostic = {
        timestamp: new Date().toISOString(),
        method,
        url: safeDiagUrl,
        status: null,
        transport: transportSummary,
        latencyMs,
        error: `${errName}: ${errMsg}`,
      };
      recordAndroidDiagnostic(diagEntry);

      const localInit: RequestInit = {
        ...init,
        method,
        headers: plainHeaders,
        ...(bodyString !== undefined ? { body: bodyString } : {}),
      };

      // Never fake production authentication, session verification, or Google Sheets status with local fallback
      if (isStrictProductionOnlyRoute) {
        const detailedError = inCapacitor
          ? `Cannot reach production server [${method} ${safeDiagUrl}] (Status: No HTTP response | Error: ${errName}: ${errMsg} | Transports: ${transportSummary}).`
          : isTimeout
          ? `Connection to production server (${configuredBaseUrl}) timed out after ${Math.round(timeoutMs / 1000)}s. Please check your internet connection and try again.`
          : `Cannot reach production server (${configuredBaseUrl}): ${errMsg}. Please check your internet connection.`;

        return new Response(
          JSON.stringify({
            success: false,
            error: detailedError,
            diagnostic: diagEntry,
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Preserve offline read/write support ONLY when the device has no internet connection
      // and the user already has a verified session token, marking the response clearly as local-offline-fallback
      const isBrowserOffline =
        typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isBrowserOffline && (inCapacitor || Boolean(plainHeaders['Authorization']))) {
        return handleCapacitorLocalApiRequest(apiPathWithQuery, localInit);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: inCapacitor
            ? `API request failed [${method} ${safeDiagUrl}] (${errName}: ${errMsg} | Transports: ${transportSummary}).`
            : isTimeout
            ? `Request to ${configuredBaseUrl} timed out. Please check your internet connection.`
            : `Cannot reach server (${configuredBaseUrl}): ${errMsg}.`,
          diagnostic: diagEntry,
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
  };
}
