/**
 * Mission Control v1 — Next.js middleware (Supabase Auth).
 *
 * Replaces the previous "verify our own HMAC-signed JWT cookie" flow
 * with Supabase Auth. The middleware does three things on every request:
 *
 *   1. Forwards `sb-*` session cookies through `updateSupabaseSession`,
 *      which automatically refreshes expired access tokens (writing
 *      Set-Cookie headers back when it does).
 *   2. Whitelists the public routes (`/login`, `/auth/*`, `/api/auth/*`,
 *      `/api/health`) so the panel can serve them without auth.
 *   3. Redirects unauthenticated requests to `/login?from=<original>`,
 *      or returns a 401 JSON body for `/api/*` routes (so fetch callers
 *      don't get HTML).
 */
import { NextResponse, type NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = new Set([
  "/login",
  "/auth/callback",
  "/auth/reset",
  "/forgot-password",
]);
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/health"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { response, supabaseUser } = await updateSupabaseSession(request);
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return response;
  }

  if (!supabaseUser) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Authentication required" },
        { status: 401 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match every path except static assets and files with extensions.
     * We need middleware to run on every page so Supabase can refresh
     * tokens even on routes that don't otherwise care about auth.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
