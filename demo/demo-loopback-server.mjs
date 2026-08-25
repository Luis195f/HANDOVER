#!/usr/bin/env node

import http from 'node:http';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 19007;
const host = '127.0.0.1';
const origin = `http://${host}:${port}`;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid loopback port: ${String(args[portIndex + 1])}`);
}

const corsHeaders = {
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
};

function sendJson(response, status, payload, contentType = 'application/json') {
  response.writeHead(status, {
    ...corsHeaders,
    'content-type': `${contentType}; charset=utf-8`,
  });
  response.end(JSON.stringify(payload));
}

async function discardRequestBody(request) {
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 5 * 1024 * 1024) {
      throw new Error('request_too_large');
    }
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', origin);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (url.pathname === '/health') {
      sendJson(response, 200, { ok: true, mode: 'synthetic-loopback' });
      return;
    }

    if (url.pathname === '/.well-known/openid-configuration') {
      sendJson(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        revocation_endpoint: `${origin}/revoke`,
        userinfo_endpoint: `${origin}/userinfo`,
        end_session_endpoint: `${origin}/logout`,
      });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      await discardRequestBody(request);
    }

    if (url.pathname.startsWith('/fhir/')) {
      sendJson(
        response,
        200,
        { resourceType: 'Bundle', type: 'transaction-response', entry: [] },
        'application/fhir+json',
      );
      return;
    }

    sendJson(response, 200, { ok: true, mode: 'synthetic-loopback' });
  } catch (error) {
    const status = error instanceof Error && error.message === 'request_too_large' ? 413 : 400;
    sendJson(response, status, { ok: false, error: status === 413 ? 'request_too_large' : 'bad_request' });
  }
});

server.listen(port, host, () => {
  console.log(`[demo-loopback] READY ${origin}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

