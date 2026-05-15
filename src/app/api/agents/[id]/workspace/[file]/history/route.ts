/**
 * Histórico do arquivo no git do workspace.
 *
 * GET /api/agents/[id]/workspace/[file]/history?limit=20
 *   → { commits: [{ sha, date, author, subject }, ...] }
 *
 * GET /api/agents/[id]/workspace/[file]/history?at=<sha>
 *   → { content: string }   (conteúdo do arquivo naquele commit, pra preview)
 *
 * Tudo read-only — NÃO faz checkout. Restore = operador edita o conteúdo
 * manualmente baseado no preview (mais seguro: nada se sobrescreve sem
 * passar pelo PUT padrão, que cria novo commit).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import {
  fileHistory,
  fileAtCommit,
  isEditableFile,
  EDITABLE_FILES,
  WorkspaceFileError,
} from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (
    !validateAgentId(id).ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  if (!isEditableFile(file)) {
    return NextResponse.json(
      { error: `Filename não suportado. Permitidos: ${EDITABLE_FILES.join(", ")}.` },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const at = url.searchParams.get("at");
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);

  try {
    // Modo 1: ?at=<sha> → conteúdo daquele commit.
    if (at) {
      const content = await fileAtCommit(id, file, at);
      if (content === null) {
        return NextResponse.json(
          { error: `Commit ${at} não tem ${file}.` },
          { status: 404 },
        );
      }
      return NextResponse.json({ content, sha: at });
    }

    // Modo 2: lista de commits.
    const commits = await fileHistory(id, file, isFinite(limit) ? limit : 20);
    return NextResponse.json({ commits });
  } catch (err) {
    if (err instanceof WorkspaceFileError) {
      return NextResponse.json(
        { error: err.message, detail: err.stderr || err.stdout || undefined },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "Falha ao ler histórico",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
