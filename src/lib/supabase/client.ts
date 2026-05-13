/**
 * Browser-side Supabase client.
 *
 * Imported from React client components (`"use client"`) when we need to
 * call Supabase Auth directly (e.g. `signInWithPassword`, `signOut`,
 * `onAuthStateChange`). It reads the public env vars exposed by Next at
 * build time — never the service-role key.
 *
 * For API routes / server components / middleware use `./server` or
 * `./middleware` instead so cookies are wired correctly.
 */
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env vars missing: set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY. They're injected at build time.",
    );
  }
  return createBrowserClient(url, anonKey);
}
