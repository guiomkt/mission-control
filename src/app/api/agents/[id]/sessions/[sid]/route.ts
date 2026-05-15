/**
 * Detail + delete de uma session.
 *
 * GET    /api/agents/[id]/sessions/[sid]?offset=0&lines=500
 *   → { entry, transcriptBytes, transcriptLines, lines, truncated }
 *
 * DELETE /api/agents/[id]/sessions/[sid]
 *   → { success, status, renamedTo? }
 *   Soft-delete: rename .jsonl pra .deleted.<ts> + remove do sessions.json.
 *
 * Read = filesystem (mount RO).
 * Delete = docker exec --user node, sob withConfigLock.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { withConfigLock } from "@/lib/openclaw-exec";
import { auditMutation } from "@/lib/audit-log";
import {
  readSessionDetail,
  deleteSession,
  isValidSessionId,
  SessionsError,
} from "@/lib/agent-sessions-manager";

export const dynamic = "force-dynamic";

function checkParams(id: string, sid: string) {
  if (
    !validateAgentId(id).ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return { ok: false as const, status: 400, error: "ID de agente inválido." };
  }
  if (!isValidSessionId(sid)) {
    return { ok: false as const, status: 400, error: "sessionId inválido (UUID esperado)." };
  }
  return { ok: true as const };
}

// ── GET ──────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const check = checkParams(id, sid);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const url = new URL(request.url);
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const linesRaw = Number.parseInt(url.searchParams.get("lines") ?? "500", 10);

  try {
    const result = await readSessionDetail(id, sid, {
      offset: Number.isFinite(offsetRaw) ? offsetRaw : 0,
      lines: Number.isFinite(linesRaw) ? linesRaw : 500,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SessionsError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: "Falha ao ler session",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id, sid } = await params;
  const check = checkParams(id, sid);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  try {
    const result = await withConfigLock(() => deleteSession(id, sid));
    await auditMutation(request, {
      action: "agent.session.delete",
      target: `${id}/${sid}`,
      ok: true,
      meta: { status: result.status, renamedTo: result.renamedTo },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.session.delete",
      target: `${id}/${sid}`,
      ok: false,
    });
    if (err instanceof SessionsError) {
      return NextResponse.json(
        { error: err.message, detail: err.stderr || err.stdout || undefined },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: "unexpected error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
