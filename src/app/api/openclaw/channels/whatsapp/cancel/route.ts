/**
 * Cancela um pairing em andamento.
 * POST /api/openclaw/channels/whatsapp/cancel
 * Body: { pairingId: string }
 *
 * Útil quando o operador fecha o modal antes do CLI terminar — sem
 * isso o `openclaw channels login` ficaria pendurado consumindo
 * recursos até o TTL do store.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { removePairing } from "@/lib/openclaw-pairing-store";
import { auditMutation } from "@/lib/audit-log";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    pairingId?: unknown;
  };
  const pairingId =
    typeof body.pairingId === "string" ? body.pairingId : null;
  if (!pairingId) {
    return NextResponse.json({ error: "Missing pairingId" }, { status: 400 });
  }
  removePairing(pairingId);
  await auditMutation(request, {
    action: "channel.login.cancel",
    target: pairingId,
    ok: true,
  });
  return NextResponse.json({ success: true });
}
