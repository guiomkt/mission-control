import { promises as fs } from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Append-only audit log for mutating operations.
 *
 * Format: JSONL (one JSON object per line). Each entry captures who did
 * what, when, from where, and whether it succeeded. Writes are best-effort
 * — a logging failure must never block the operation. Logs append; never
 * rewrite.
 *
 * Configure path via AUDIT_LOG_PATH. Default keeps the log inside the app's
 * data dir, which we mount as a writable volume in production.
 *
 * The "who" used to be hardcoded as "operator" (single-password flow).
 * After the Supabase Auth migration we read the user's email out of the
 * Supabase session — falling back to "anonymous" when there's no session
 * (e.g. failed login attempts) so we still log the attempt.
 */

const DEFAULT_PATH =
  process.env.AUDIT_LOG_PATH || path.join(process.cwd(), "data", "audit.log");

let initialized = false;

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

export interface AuditEntry {
  ts: string;
  action: string;
  target?: string;
  ok: boolean;
  ip?: string;
  user?: string;
  meta?: Record<string, unknown>;
}

async function writeEntry(entry: AuditEntry): Promise<void> {
  const target = DEFAULT_PATH;
  try {
    if (!initialized) {
      await ensureDir(target);
      initialized = true;
    }
    await fs.appendFile(target, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    // Logging must never break the request path. Surface only to stderr.
    console.error("[audit] write failed:", err);
  }
}

function extractIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function extractUser(request: NextRequest): Promise<string> {
  // We use a throwaway response object because we only want to READ the
  // session here — the audit log never mutates cookies. `getUser()`
  // is preferable to `getSession()` because it goes through Supabase's
  // verification flow rather than trusting the local cookie blindly.
  try {
    const throwaway = NextResponse.next();
    const supabase = createSupabaseRouteClient(request, throwaway);
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? data.user?.id ?? "anonymous";
  } catch {
    return "anonymous";
  }
}

/**
 * Record a mutation. Call this immediately after the operation completes
 * (whether it succeeded or failed) with `ok: true|false` set accordingly.
 */
export async function auditMutation(
  request: NextRequest,
  params: {
    action: string;
    target?: string;
    ok: boolean;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    action: params.action,
    target: params.target,
    ok: params.ok,
    ip: extractIp(request),
    user: await extractUser(request),
    meta: params.meta,
  };
  await writeEntry(entry);
}

/** Lower-level variant for code paths without a request (e.g. cron triggers). */
export async function auditEvent(
  action: string,
  ok: boolean,
  meta?: Record<string, unknown>,
): Promise<void> {
  await writeEntry({
    ts: new Date().toISOString(),
    action,
    ok,
    meta,
  });
}
