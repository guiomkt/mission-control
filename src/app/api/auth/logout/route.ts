import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { auditMutation } from "@/lib/audit-log";

/**
 * Sign out — Supabase Auth invalidates the session server-side and the
 * SDK clears the cookies via the response's `set` callbacks. We still
 * call this from the Sidebar's logout button.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  const supabase = createSupabaseRouteClient(request, response);
  await supabase.auth.signOut();
  await auditMutation(request, { action: "logout", ok: true });
  return response;
}
