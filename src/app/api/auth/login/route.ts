import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { auditMutation } from "@/lib/audit-log";

/**
 * Login endpoint — email + password against Supabase Auth.
 *
 * Migrated from the v1 "constant-time compare against ADMIN_PASSWORD" flow.
 * Supabase Auth handles hashing, rate limiting on its side, refresh tokens
 * and email verification. We keep an extra per-IP throttle here so we don't
 * hammer Supabase from a single misbehaving client (still useful for
 * misconfigured automation, not for distributed brute-force).
 *
 * Cookies: Supabase writes `sb-<project-ref>-auth-token` (httpOnly,
 * sameSite=lax). We don't touch them directly — the SDK does it via the
 * `set` callback we wired up in `createSupabaseRouteClient`.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

interface AttemptRecord {
  count: number;
  windowStart: number;
  lockedUntil?: number;
}

const attempts = new Map<string, AttemptRecord>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, retryAfterMs: record.lockedUntil - now };
  }

  if (now - record.windowStart > WINDOW_MS) {
    attempts.delete(ip);
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    attempts.set(ip, record);
    return { allowed: false, retryAfterMs: LOCKOUT_MS };
  }

  return { allowed: true };
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
  } else {
    record.count += 1;
    attempts.set(ip, record);
  }
}

function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  const { allowed, retryAfterMs } = checkRateLimit(ip);
  if (!allowed) {
    const retryAfterSec = Math.ceil((retryAfterMs ?? LOCKOUT_MS) / 1000);
    return NextResponse.json(
      { success: false, error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    recordFailure(ip);
    return NextResponse.json(
      { success: false, error: "Email and password are required" },
      { status: 400 },
    );
  }

  // We create the response up front because the Supabase client writes
  // the auth cookies into it as a side effect of signInWithPassword.
  const response = NextResponse.json({ success: true });
  const supabase = createSupabaseRouteClient(request, response);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    recordFailure(ip);
    await auditMutation(request, { action: "login", ok: false, meta: { email } });
    return NextResponse.json(
      { success: false, error: error.message || "Invalid credentials" },
      { status: 401 },
    );
  }

  clearAttempts(ip);
  await auditMutation(request, { action: "login", ok: true, meta: { email } });
  return response;
}
