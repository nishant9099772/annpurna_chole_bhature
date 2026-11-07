/**
 * Netlify Serverless Function Entry Point (/.netlify/functions/api)
 * Bridges Netlify Functions (v1 Lambda event) to the pure production Express API in src/server/apiApp.ts.
 */
import http from 'http';
import { AddressInfo } from 'net';

// Ensure apiApp knows it is running inside a Netlify serverless environment
process.env.NETLIFY = 'true';

import { app } from '../../src/server/apiApp';

let serverPromise: Promise<number> | null = null;

function getLocalServerPort(): Promise<number> {
  if (!serverPromise) {
    serverPromise = new Promise((resolve, reject) => {
      const srv = http.createServer(app);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address() as AddressInfo;
        resolve(addr.port);
      });
      srv.on('error', reject);
    });
  }
  return serverPromise;
}

function normalizeNetlifyEventPath(event: any): string {
  const headers = event?.headers || {};
  const headerOrigPath =
    headers['x-nf-original-pathname'] ||
    headers['X-Nf-Original-Pathname'] ||
    headers['x-forwarded-uri'] ||
    headers['X-Forwarded-Uri'] ||
    '';

  let rawUrlPath = '';
  if (typeof event?.rawUrl === 'string' && event.rawUrl.trim()) {
    try {
      const parsed = new URL(event.rawUrl);
      rawUrlPath = parsed.pathname || '';
    } catch {
      rawUrlPath = '';
    }
  }

  let candidate = String(event?.path || '').trim();
  if (
    (!candidate ||
      candidate === '/' ||
      candidate === '/api' ||
      candidate === '/api/' ||
      candidate === '/.netlify/functions/api' ||
      candidate === '/.netlify/functions/api/') &&
    (rawUrlPath || headerOrigPath)
  ) {
    candidate = rawUrlPath || headerOrigPath;
  }

  if (!candidate) {
    candidate = '/';
  }

  // Strip query string if accidentally attached to path
  const qIdx = candidate.indexOf('?');
  if (qIdx !== -1) {
    candidate = candidate.slice(0, qIdx);
  }

  // Collapse consecutive slashes
  candidate = candidate.replace(/\/{2,}/g, '/');

  // Strip any leading /.netlify/functions/api prefix (even if repeated)
  while (candidate.startsWith('/.netlify/functions/api')) {
    candidate = candidate.slice('/.netlify/functions/api'.length) || '/';
  }

  // Collapse duplicate /api/api/... prefixes
  while (candidate.startsWith('/api/api/') || candidate === '/api/api') {
    candidate = '/api' + candidate.slice('/api/api'.length);
  }

  // Ensure canonical /api/... prefix
  if (!candidate.startsWith('/api/') && candidate !== '/api') {
    candidate = '/api' + (candidate.startsWith('/') ? candidate : `/${candidate}`);
  }

  return candidate;
}

export async function handler(event: any) {
  const reqOrigin = event?.headers?.origin || event?.headers?.Origin || '*';
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': reqOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Accept, X-Google-Token, X-Requested-With, Origin',
    'Access-Control-Expose-Headers': 'Content-Type',
  };

  const method = (
    event?.httpMethod ||
    event?.requestContext?.http?.method ||
    'GET'
  ).toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ ok: true }),
    };
  }

  try {
    const port = await getLocalServerPort();

    const rawPath = normalizeNetlifyEventPath(event);

    const qs = event.rawQuery
      ? `?${event.rawQuery}`
      : event.queryStringParameters && Object.keys(event.queryStringParameters).length > 0
      ? `?${new URLSearchParams(event.queryStringParameters).toString()}`
      : '';

    const targetUrl = `http://127.0.0.1:${port}${rawPath}${qs}`;

    const blockedRequestHeaders = new Set([
      'host',
      'content-length',
      'content-encoding',
      'transfer-encoding',
      'connection',
      'accept-encoding',
    ]);

    const headers: Record<string, string> = {};
    if (event.headers) {
      for (const [k, v] of Object.entries(event.headers)) {
        if (typeof v === 'string' && !blockedRequestHeaders.has(k.toLowerCase())) {
          headers[k] = v;
        }
      }
    }

    let body: string | Buffer | undefined = undefined;
    if (method !== 'GET' && method !== 'HEAD' && event.body !== undefined && event.body !== null) {
      if (typeof event.body === 'object' && !Buffer.isBuffer(event.body)) {
        body = JSON.stringify(event.body);
      } else if (event.isBase64Encoded && typeof event.body === 'string') {
        body = Buffer.from(event.body, 'base64').toString('utf-8');
      } else {
        body = String(event.body);
      }

      const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
      if (!hasContentType) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(targetUrl, {
      method,
      headers,
      body: body as any,
    });

    const blockedResponseHeaders = new Set([
      'transfer-encoding',
      'connection',
      'keep-alive',
      'content-length',
      'content-encoding',
      'access-control-allow-origin',
      'access-control-allow-methods',
      'access-control-allow-headers',
      'access-control-expose-headers',
      'access-control-allow-credentials',
      'content-type',
    ]);

    const resHeaders: Record<string, string> = {
      ...corsHeaders,
    };
    response.headers.forEach((val, key) => {
      if (!blockedResponseHeaders.has(key.toLowerCase())) {
        resHeaders[key] = val;
      }
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      const arrayBuf = await response.arrayBuffer();
      return {
        statusCode: response.status,
        headers: resHeaders,
        body: Buffer.from(arrayBuf).toString('base64'),
        isBase64Encoded: true,
      };
    }

    resHeaders['Content-Type'] = 'application/json; charset=utf-8';
    const text = await response.text();
    return {
      statusCode: response.status,
      headers: resHeaders,
      body: text,
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ error: err.message || 'Serverless function execution error' }),
    };
  }
}
