/**
 * Server-side Supabase clients.
 *
 * Three flavors:
 *   - `createSupabaseRouteClient(request)` — for Next.js Route Handlers
 *     (`src/app/api/.../route.ts`). Reads cookies from the incoming
 *     NextRequest and writes Set-Cookie via the response object.
 *   - `createSupabaseServerClient()` — for Server Components / Server
 *     Actions. Uses Next's `cookies()` helper from `next/headers`.
 *   - `createSupabaseAdminClient()` — uses the SERVICE_ROLE_KEY and
 *     bypasses RLS. Use only when you genuinely need elevated access
 *     (the activity feed writes, the audit log reads, the usage
 *     collector). Never expose to the browser.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

function requireEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars missing on the server. Set NEXT_PUBLIC_SUPABASE_URL " +
        "and NEXT_PUBLIC_SUPABASE_ANON_KEY in the runtime environment.",
    );
  }
  return { url, anonKey };
}

/**
 * Client for use inside Next.js Route Handlers (the
 * `src/app/api/<route>/route.ts` files).
 *
 * The Supabase SDK needs both READ access to incoming cookies and WRITE
 * access to outgoing Set-Cookie headers (so it can refresh tokens
 * transparently). Pass the request in to read; we return a `response`
 * object so the handler can attach Set-Cookie headers when needed.
 */
export function createSupabaseRouteClient(request: NextRequest, response: NextResponse) {
  const { url, anonKey } = requireEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * Client for Server Components and Server Actions. Reads cookies via
 * `next/headers`. Cannot set cookies (Server Components can't mutate
 * response headers); auth refresh happens via the middleware path
 * instead.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = requireEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return store.get(name)?.value;
      },
      // Server Components can't write cookies — these are no-ops. The
      // middleware client handles token refresh on the request boundary.
      set() {},
      remove() {},
    },
  });
}

/**
 * Service-role client. Bypasses RLS — use only on the server, never in
 * a context that returns its session/output to an untrusted caller.
 *
 * Examples of legitimate use:
 *   - Writing to `activities_v1` from inside an API route after we've
 *     already authenticated the request.
 *   - Bulk reads for analytics / dashboard summaries.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin env missing. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY (the latter is backend-only).",
    );
  }
  return createClient(url, serviceKey, {
    auth: {
      // No session for the admin client — it's stateless.
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
