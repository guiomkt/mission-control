/**
 * Lista paginada de sessions de um agente.
 *
 * GET /api/agents/[id]/sessions?limit=50&before=<ts>&channel=X&kind=Y
 *   → { total, filtered, hasMore, items: [...] }
 *
 * Lê direto de `agents/<id>/sessions/sessions.json` (mounted RO). Sem
 * CLI spawn — leitura é barata.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { listAgentSessions } from "@/lib/agent-sessions-manager";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (
    !validateAgentId(id).ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const beforeRaw = url.searchParams.get("before");
  const channel = url.searchParams.get("channel") ?? undefined;
  const kind = url.searchParams.get("kind") ?? undefined;

  try {
    const result = await listAgentSessions(id, {
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
      before: beforeRaw ? Number.parseInt(beforeRaw, 10) : undefined,
      channel,
      kind,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Falha ao listar sessions",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
