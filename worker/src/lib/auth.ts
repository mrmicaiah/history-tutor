import { AuthError } from './errors';
import { log } from './logger';
import { sha256Hex } from './hash';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../config';

/**
 * PIN gate + signed-session cookie helpers.
 *
 * Threat model: single user, low-value secret. The PIN is hashed with SHA-256
 * (no salt — single-user, no rainbow-table risk worth defending against, and
 * we pin the rate limiter to 5 attempts per 5 minutes per IP). Session
 * cookies are HMAC-SHA256-signed JSON payloads carrying only an `exp` field.
 *
 * What this module is NOT:
 *   - a general-purpose JWT library (we don't need the JOSE format)
 *   - account/recovery logic (single user, no recovery flow)
 */

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hex string has non-hex chars');
    out[i] = byte;
  }
  return out;
}

/** Length-safe constant-time string comparison. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---------------------------------------------------------------------------
// Crypto primitives
// ---------------------------------------------------------------------------

async function hmacSha256(secretHex: string, message: string): Promise<string> {
  const keyBytes = hexToBytes(secretHex);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return bytesToBase64Url(new Uint8Array(sig));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Constant-time PIN check against the stored SHA-256 hex digest. */
export async function verifyPin(pin: string, expectedHashHex: string): Promise<boolean> {
  const actualHashHex = await sha256Hex(pin);
  return constantTimeEqual(actualHashHex.toLowerCase(), expectedHashHex.toLowerCase());
}

/**
 * Build a `Set-Cookie` header value carrying a signed session.
 *
 * Payload is JSON `{ exp: <ms-since-epoch> }`; signature is HMAC-SHA256 of
 * the base64url-encoded payload using `SESSION_SECRET`.
 *
 * `cookieDomain` is appended as `Domain=<value>` when set — required when
 * the Pages frontend and the Worker live on different subdomains of the
 * same registered domain (e.g. `tutor.example.com` + `api.tutor.example.com`
 * with `Domain=.tutor.example.com`). When unset, no `Domain=` attribute is
 * emitted (host-only cookie, the right default for `*.workers.dev`).
 */
export async function createSessionCookie(
  secretHex: string,
  cookieDomain?: string,
  nowMs = Date.now(),
): Promise<string> {
  const payloadJson = JSON.stringify({ exp: nowMs + SESSION_TTL_MS });
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(secretHex, payloadB64);
  const value = `${payloadB64}.${sig}`;
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  const domainAttr = cookieDomain !== undefined && cookieDomain.length > 0
    ? `; Domain=${cookieDomain}`
    : '';
  return `${SESSION_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/${domainAttr}; Max-Age=${maxAgeSeconds}`;
}

/**
 * Verify the `htsess` cookie on a request. Returns true iff the signature
 * matches and the embedded `exp` is in the future.
 */
export async function verifySession(
  cookieHeader: string | null,
  secretHex: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!cookieHeader) return false;
  const value = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (value === null) return false;

  const parts = value.split('.');
  if (parts.length !== 2) return false;
  const payloadB64 = parts[0]!;
  const sig = parts[1]!;

  const expectedSig = await hmacSha256(secretHex, payloadB64);
  if (!constantTimeEqual(expectedSig, sig)) return false;

  let payload: { exp?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as { exp?: unknown };
  } catch {
    return false;
  }
  if (typeof payload.exp !== 'number') return false;
  return nowMs < payload.exp;
}

/** Throws AuthError if the request lacks a valid session cookie. */
export async function requireAuth(
  request: Request,
  env: { SESSION_SECRET: string },
): Promise<void> {
  const ok = await verifySession(request.headers.get('Cookie'), env.SESSION_SECRET);
  if (!ok) throw new AuthError('valid session required');
}

/**
 * Read a cookie's value from a `Cookie:` header. Returns null if not present.
 * Handles whitespace and `=` characters in the value via lastIndexOf.
 */
function readCookie(header: string, name: string): string | null {
  for (const piece of header.split(';')) {
    const trimmed = piece.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

/**
 * Read the client IP from `CF-Connecting-IP`. Cloudflare always sets this on
 * Worker requests; if it's missing we log a warning (indicates a misrouted
 * request) and fall back to "unknown" so the rate limiter still has a key.
 */
export function getClientIp(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip === null || ip.length === 0) {
    log.warn('cf_connecting_ip_missing');
    return 'unknown';
  }
  return ip;
}
