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

export async function handler(event: any) {
  const reqOrigin = event?.headers?.origin || event?.headers?.Origin || '*';
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': reqOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Accept, X-Google-Token, X-Requested-With, Origin',
    'Access-Control-Expose-Headers': 'Content-Type',
  };

  const method = (event?.httpMethod || 'GET').toUpperCase();
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

    // Normalize path so /.netlify/functions/api/auth/login -> /api/auth/login
    let rawPath: string = event.path || '/';
    if (rawPath.startsWith('/.netlify/functions/api')) {
      rawPath = '/api' + rawPath.slice('/.netlify/functions/api'.length);
    } else if (!rawPath.startsWith('/api')) {
      rawPath = '/api' + (rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
    }

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
        body = event.body;
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
