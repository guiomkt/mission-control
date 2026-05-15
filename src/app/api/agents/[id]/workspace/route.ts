/**
 * Lista files editáveis do workspace de um agente.
 * GET /api/agents/[id]/workspace
 *
 * Retorna a whitelist intersectada com o que existe no workspace, com
 * size + lastModified pra cada arquivo. Útil pra UI mostrar quais
 * existem vs quais podem ser criados.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { listWorkspaceFiles } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idCheck = validateAgentId(id);
  if (
    !idCheck.ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const files = await listWorkspaceFiles(id);
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Falha ao listar workspace files",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
