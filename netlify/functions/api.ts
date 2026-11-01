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
    const method = (event.httpMethod || 'GET').toUpperCase();

    const headers: Record<string, string> = {};
    if (event.headers) {
      for (const [k, v] of Object.entries(event.headers)) {
        if (typeof v === 'string' && k.toLowerCase() !== 'host' && k.toLowerCase() !== 'content-length') {
          headers[k] = v;
        }
      }
    }

    let body: Buffer | string | undefined = undefined;
    if (method !== 'GET' && method !== 'HEAD' && event.body) {
      body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    }

    const response = await fetch(targetUrl, {
      method,
      headers,
      body: body as any,
    });

    const resHeaders: Record<string, string> = {};
    response.headers.forEach((val, key) => {
      resHeaders[key] = val;
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

    const text = await response.text();
    return {
      statusCode: response.status,
      headers: resHeaders,
      body: text,
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Serverless function execution error' }),
    };
  }
}
