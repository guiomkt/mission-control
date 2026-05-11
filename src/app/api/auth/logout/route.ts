import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { revokeSession, verifySession, SESSION_COOKIE } from "@/lib/session";
import { auditMutation } from "@/lib/audit-log";

export async function POST(request: NextRequest) {
  // Revoke the JWT's jti so the token can't be reused even if the cookie leaks.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const claims = await verifySession(token);
    if (claims?.jti) revokeSession(claims.jti);
  }

  await auditMutation(request, { action: "logout", ok: true });

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
