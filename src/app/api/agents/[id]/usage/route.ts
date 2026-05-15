/**
 * Usage analytics agregadas pra um agente.
 *
 * GET /api/agents/[id]/usage
 *   → { count, totalCost, totalTokens, errorRate, byModel, byChannel, byKind, ... }
 *
 * Agrega in-memory a partir de sessions.json. Cap de 1000 sessions pra
 * evitar load excessivo — se passar disso, a UI mostra o aviso `capped`.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { computeUsage } from "@/lib/agent-sessions-manager";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
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

  try {
    const stats = await computeUsage(id);
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Falha ao computar usage",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
