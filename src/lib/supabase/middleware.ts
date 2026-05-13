/**
 * Supabase auth glue for Next.js middleware.
 *
 * Why a separate helper: middleware runs on the Edge runtime, before
 * Route Handlers and Server Components, and Supabase needs to read the
 * incoming `sb-*` cookies AND write refreshed Set-Cookie headers back
 * on the response. The pattern below is the one in Supabase's
 * `@supabase/ssr` docs — keep it close to the docs so future upgrades
 * stay mechanical.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSupabaseSession(request: NextRequest) {
  // Start with a passthrough response — the Supabase client mutates its
  // cookies as a side effect of any internal token refresh.
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Misconfigured deployment — fail closed but don't crash the request.
    return { response, supabaseUser: null };
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        // Mirror the cookie into BOTH the request (so downstream handlers
        // see the fresh value) and the response (so the browser stores
        // it). This is what the Supabase docs recommend.
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  // Crucial: calling `getUser()` here is what forces the token refresh
  // if it's expired. Without it, the access token can expire while the
  // user is still active.
  const { data } = await supabase.auth.getUser();
  return { response, supabaseUser: data.user };
}
