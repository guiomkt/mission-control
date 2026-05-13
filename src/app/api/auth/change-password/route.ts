/**
 * Change password — proxies to `supabase.auth.updateUser({ password })`.
 *
 * The Supabase SDK already requires the caller to be authenticated (it
 * uses the auth cookie our middleware threads through), so we don't
 * need a separate `currentPassword` check here — if the JWT is valid,
 * the user is who they claim to be. If we ever want stronger reauth
 * (e.g. confirm-by-email before changing), Supabase Auth exposes the
 * "reauthenticate" endpoint for that — out of scope for v1.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/server";
import { auditMutation } from "@/lib/audit-log";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (newPassword.length < 8) {
    return NextResponse.json(
      { success: false, error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ success: true });
  const supabase = createSupabaseRouteClient(request, response);
  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    await auditMutation(request, { action: "password_change", ok: false });
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 },
    );
  }

  await auditMutation(request, { action: "password_change", ok: true });
  return response;
}
