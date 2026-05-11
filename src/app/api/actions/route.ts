/**
 * Quick Actions API — disabled in V1.
 *
 * Upstream tenacitOS exposed POST /api/actions to execute named shell
 * pipelines from the panel: `restart-gateway` (systemctl), `clear-temp`
 * (find + rm), `heartbeat` (systemctl + pm2), `usage-stats` (top/du/free),
 * `git-status` (git CLI), `npm-audit`. Every one of these is a PRD R2
 * violation: shell access into the host. We don't ship that in V1.
 *
 * The page UI still renders, but invoking any action returns 501 and the
 * attempt is recorded in the audit log.
 */
import { NextRequest, NextResponse } from "next/server";
import { auditMutation } from "@/lib/audit-log";

export async function POST(request: NextRequest) {
  let action = "<unknown>";
  try {
    const body = await request.json();
    if (typeof body?.action === "string") action = body.action;
  } catch {
    /* malformed body — we still audit the attempt */
  }

  await auditMutation(request, {
    action: `actions.${action}`,
    ok: false,
    meta: { reason: "not-implemented" },
  });

  return NextResponse.json(
    {
      error: "Not implemented in V1",
      detail:
        "Quick actions (restart-gateway, clear-temp, heartbeat, etc.) run " +
        "host-level shell commands. They were intentionally cut from this " +
        "build. Re-introduce them in V1.1 as specific gateway-side endpoints, " +
        "not generic shell execution.",
    },
    { status: 501 },
  );
}
