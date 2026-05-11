import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

/**
 * Signed session tokens for Mission Control.
 *
 * Replaces the prior model (raw AUTH_SECRET stored as cookie value) with an
 * HMAC-signed JWT. Tampering invalidates the token; an attacker who reads
 * the cookie cannot mint new ones without the server's SESSION_SECRET.
 *
 * The token carries:
 *   - sub: stable operator identifier (always "operator" for the V1 single-user setup)
 *   - iat: issued at (seconds)
 *   - exp: expiry
 *   - jti: random ID used for logout revocation
 *
 * Revocation: jti added to an in-memory set on logout. Restart clears the
 * set — acceptable for a single-instance deploy. For multi-instance, swap
 * for a shared store (Redis, Supabase).
 */

const COOKIE_NAME = 'mc_session';
const ALG = 'HS256';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const revoked = new Set<string>();

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET must be set to at least 16 characters. ' +
        'Generate one with: openssl rand -base64 48',
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims extends JWTPayload {
  sub: string;
  jti: string;
}

export async function issueSession(sub = 'operator'): Promise<string> {
  const jti = crypto.randomUUID();
  return await new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: [ALG],
    });
    if (typeof payload.jti !== 'string' || typeof payload.sub !== 'string') {
      return null;
    }
    if (revoked.has(payload.jti)) {
      return null;
    }
    return payload as SessionClaims;
  } catch {
    return null;
  }
}

/** Revoke a token by its jti. Survives until restart. */
export function revokeSession(jti: string): void {
  revoked.add(jti);
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
