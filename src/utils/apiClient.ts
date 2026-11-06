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

import { handleCapacitorLocalApiRequest } from './capacitorLocalApi';

export const API_BASE_URL_STORAGE_KEY = 'annpurna_api_base_url';
export const DEFAULT_PRODUCTION_API_BASE_URL = 'https://annpurnacholebhature.netlify.app';

const STANDARD_API_TIMEOUT_MS = 12_000;
const SHEETS_SYNC_TIMEOUT_MS = 20_000;

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
    cleaned === 'https://localhost'
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

/**
 * Authoritative production API base URL resolved directly from `import.meta.env.VITE_API_BASE_URL`
 * (`.env.production`: `VITE_API_BASE_URL=https://annpurnacholebhature.netlify.app`).
 */
export const API_BASE_URL: string =
  normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL) || DEFAULT_PRODUCTION_API_BASE_URL;

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
 * Detects whether the browser is running on the local Express development/preview server
 * (e.g. `localhost:3000` or `*.run.app`), as opposed to Capacitor Android or Netlify production.
 */
function isLocalExpressDevOrPreviewHost(): boolean {
  if (typeof window === 'undefined') return false;
  if (isCapacitorOrAndroidWebView()) return false;
  const hostname = (window.location?.hostname || '').toLowerCase();
  const port = window.location?.port || '';
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && port !== '') {
    return true;
  }
  if (hostname.endsWith('.run.app')) {
    return true;
  }
  return false;
}

/**
 * Returns the active production Netlify API base URL (`import.meta.env.VITE_API_BASE_URL` or custom override).
 */
export function getConfiguredApiBaseUrl(): string {
  const envBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const saved = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_URL_STORAGE_KEY));
      if (saved) return saved;
    } catch {
      // ignore storage errors
    }
  }

  if (envBaseUrl) return envBaseUrl;
  return API_BASE_URL;
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
 * Resolves any `/api/...` endpoint to the full backend URL.
 * - On Netlify & Android Capacitor APK: Always uses `import.meta.env.VITE_API_BASE_URL` (`https://annpurnacholebhature.netlify.app`).
 * - On local Express dev/preview (`localhost:3000` / `*.run.app`): Uses `window.location.origin` unless a custom URL override is saved.
 */
export function resolveApiUrl(pathOrUrl: string): string {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;

  if (isLocalExpressDevOrPreviewHost()) {
    const customOverride =
      typeof window !== 'undefined' && window.localStorage
        ? normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_URL_STORAGE_KEY))
        : '';
    if (!customOverride && typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${cleanPath}`;
    }
  }

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

let fetchInterceptorInstalled = false;

/**
 * Installs a global `window.fetch` wrapper for all backend API requests.
 *
 * - Ensures any `/api/*` request is always resolved to the full production Netlify URL
 *   (`import.meta.env.VITE_API_BASE_URL` = `https://annpurnacholebhature.netlify.app`) in production & Android APK.
 * - Enforces an `AbortController` timeout on every API call so Android WebView requests never hang forever.
 * - Uses `credentials: 'omit'` and `mode: 'cors'` on cross-origin requests so Bearer token auth
 *   works across Capacitor (`https://localhost`) -> Netlify (`https://annpurnacholebhature.netlify.app`) without CORS failures.
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

    const isCrossOrigin =
      /^https?:\/\//i.test(resolvedUrl) &&
      typeof window !== 'undefined' &&
      !resolvedUrl.startsWith(window.location.origin);

    const mergedHeaders = new Headers(init?.headers || {});
    if (!mergedHeaders.has('Accept')) {
      mergedHeaders.set('Accept', 'application/json');
    }

    const isSheetsHeavyRoute =
      apiPathWithQuery.includes('/batch-sync-sheets') ||
      apiPathWithQuery.includes('/retry-sheets') ||
      apiPathWithQuery.includes('/hydrate') ||
      (apiPathWithQuery.startsWith('/api/bills') && (init?.method || 'GET').toUpperCase() === 'POST');

    const timeoutMs = isSheetsHeavyRoute ? SHEETS_SYNC_TIMEOUT_MS : STANDARD_API_TIMEOUT_MS;
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
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const updatedInit: RequestInit = {
      ...init,
      headers: mergedHeaders,
      signal: controller.signal,
      ...(isCrossOrigin ? { mode: 'cors', credentials: 'omit' } : {}),
    };

    try {
      const response = await originalFetch(resolvedUrl, updatedInit);
      const contentType = (response.headers?.get?.('content-type') || '').toLowerCase();

      if (contentType.includes('application/pdf')) {
        return response;
      }

      if (typeof response.clone === 'function') {
        const clonedText = await response
          .clone()
          .text()
          .catch(() => '');
        if (isHtmlPayload(clonedText)) {
          if (
            configuredBaseUrl &&
            (apiPathWithQuery.includes('/retry-sheets') ||
              apiPathWithQuery.includes('/batch-sync-sheets'))
          ) {
            return new Response(
              JSON.stringify({
                success: false,
                error: `Backend URL (${configuredBaseUrl}) returned an HTML page instead of the Netlify API. Verify your Netlify deployment.`,
              }),
              { status: 502, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return handleCapacitorLocalApiRequest(apiPathWithQuery, init);
        }
      }

      // If inside Capacitor and the remote Netlify server has not yet been redeployed with /api/orders,
      // fall back to the local Capacitor API engine for 404 on /api/orders
      if (inCapacitor && response.status === 404 && apiPathWithQuery.startsWith('/api/orders')) {
        return handleCapacitorLocalApiRequest(apiPathWithQuery, init);
      }

      return response;
    } catch (networkErr: any) {
      const isTimeout = networkErr?.name === 'AbortError';

      // When running inside a local dev/preview server (e.g. localhost:3000 or *.run.app) and not Capacitor,
      // allow fallback to the local Express backend if the remote production server is unreachable
      if (!inCapacitor && isCrossOrigin && typeof window !== 'undefined') {
        try {
          const localDevRes = await originalFetch(`${window.location.origin}${apiPathWithQuery}`, {
            ...init,
            headers: mergedHeaders,
          });
          return localDevRes;
        } catch {
          // continue to standard fallback
        }
      }

      // For explicit Google Sheets retry/batch-sync actions, surface the exact timeout/connection error
      if (
        configuredBaseUrl &&
        (apiPathWithQuery.includes('/retry-sheets') ||
          apiPathWithQuery.includes('/batch-sync-sheets'))
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error: isTimeout
              ? `Google Sheets sync timed out after ${Math.round(timeoutMs / 1000)}s contacting ${configuredBaseUrl}. Please check your internet connection and retry.`
              : `Could not reach Netlify backend (${configuredBaseUrl}): ${networkErr?.message || 'Network error'}.`,
          }),
          { status: 504, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // For offline resilience in Capacitor Android APK, fall back to local persistent engine if offline
      if (inCapacitor) {
        return handleCapacitorLocalApiRequest(apiPathWithQuery, init);
      }
      throw networkErr;
    } finally {
      clearTimeout(timeoutId);
      if (callerSignal) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  };
}
