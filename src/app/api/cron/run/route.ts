import { NextRequest, NextResponse } from "next/server";
import { auditMutation } from "@/lib/audit-log";

/**
 * POST /api/cron/run  → 501 in V1.
 *
 * The original tenacitOS implementation shelled out to `openclaw cron run`,
 * which requires the dashboard to share a process namespace with the
 * gateway. Our deployment isolates the panel in its own container, so we
 * cannot trigger jobs from here. Tracked for Phase 3 (via a control queue
 * or a thin authenticated webhook on the gateway side).
 *
 * The attempt is recorded so operators can correlate "tried to fire job X"
 * with the gateway-side cron timeline.
 */
export async function POST(request: NextRequest) {
  let id = "<unknown>";
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id : "<unknown>";
  } catch {
    // ignore malformed body — we still audit the attempt.
  }

  await auditMutation(request, {
    action: "cron.run",
    target: id,
    ok: false,
    meta: { reason: "not-implemented" },
  });

  return NextResponse.json(
    {
      error: "Not implemented in V1",
      detail:
        "Triggering crons requires a control channel into the gateway " +
        "container, which is not in V1 scope. Use `openclaw cron run <id>` " +
        "inside the gateway container until Phase 3 ships.",
    },
    { status: 501 },
  );
}
