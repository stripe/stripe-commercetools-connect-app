'use strict';

/**
 * Minimal, zero-dependency JWT mock server for local development.
 *
 * Replaces the unmaintained `jwt-mock-server` npm package, whose JWKS published
 * its public keys with `key_ops: ["sign"]` — a spec violation (RFC 7517) that
 * jose@6 (pulled in by @commercetools/connect-payments-sdk 1.2.2 via jwks-rsa@4)
 * rejects, breaking JWT verification in the processor.
 *
 * Endpoints (mounted under /jwt to match the original):
 *   GET  /jwt/.well-known/jwks.json  -> JWKS with well-formed public keys (use: "sig")
 *   POST /jwt/token                  -> signs the JSON body + iat/exp, returns { token }
 *   GET  /jwt/token                  -> signs the query params (or default claims) + iat/exp
 *   GET  /jwt/  and  /jwt/shutdown   -> { hello: "world!" }  (parity, no-ops)
 *
 * Built on Node's native `crypto` + `http` — no dependencies, no network at start.
 */

const http = require('http');
const crypto = require('crypto');

const PORT = Number.parseInt(process.env.PORT || '9000', 10);
const TOKEN_EXPIRY = Number.parseInt(process.env.TOKEN_EXPIRY || '3600', 10);
const DEFAULT_CLAIMS = { username: 'test@test.com', userId: 1, authorities: ['AUTH_1'] };
const KEY_COUNT = 2; // mirror the original mock, which exposed two keys

const base64url = (input) => Buffer.from(input).toString('base64url');

// RFC 7638 JWK thumbprint (stable kid) for an RSA public JWK.
const rsaThumbprint = (jwk) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n }))
    .digest('base64url');

// Generate the signing keys once at startup.
const keys = Array.from({ length: KEY_COUNT }, () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }); // { kty, n, e }
  const kid = rsaThumbprint(jwk);
  return {
    privateKey,
    kid,
    // Well-formed public JWK for verification: use "sig", alg RS256, NO key_ops:["sign"].
    publicJwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, use: 'sig', alg: 'RS256' },
  };
});

const signToken = (claims) => {
  const key = keys[0];
  const header = { alg: 'RS256', typ: 'JWT', kid: key.kid };
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...claims, iat: now, exp: now + TOKEN_EXPIRY };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), key.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
};

const sendJson = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(body));
};

const readJsonBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return sendJson(res, 204, {});

  if (req.method === 'GET' && path === '/jwt/.well-known/jwks.json') {
    return sendJson(res, 200, { keys: keys.map((k) => k.publicJwk) });
  }

  if (path === '/jwt/token') {
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { token: signToken(body) });
    }
    if (req.method === 'GET') {
      const query = Object.fromEntries(url.searchParams.entries());
      const claims = Object.keys(query).length > 0 ? query : DEFAULT_CLAIMS;
      return sendJson(res, 200, { token: signToken(claims) });
    }
  }

  if (req.method === 'GET' && (path === '/jwt' || path === '/jwt/' || path === '/jwt/shutdown')) {
    return sendJson(res, 200, { hello: 'world!' });
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`jwt-server (native mock) listening on http://0.0.0.0:${PORT}/jwt`);
});
