/**
 * Read/write de um arquivo do workspace de um agente.
 *
 * GET  /api/agents/[id]/workspace/[file]
 *   → { filename, content, mtimeMs, size } | 404
 *
 * PUT  /api/agents/[id]/workspace/[file]
 *   Body: { content: string, commitMessage?: string }
 *   → { success, bytesWritten, commitSha?, noChange }
 *
 * Validações:
 *  - filename precisa estar na whitelist (workspace-files.ts:EDITABLE_FILES).
 *  - content max 256 KB (cap em workspace-files.ts).
 *  - Sem null bytes.
 *
 * Persiste via container kozw como user `node` (UID 1000). Auto-commit
 * no git do workspace.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  isEditableFile,
  describeTarget,
  WorkspaceFileError,
  EDITABLE_FILES,
} from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

function checkParams(id: string, file: string) {
  if (
    !validateAgentId(id).ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return { ok: false as const, status: 400, error: "ID de agente inválido." };
  }
  if (!isEditableFile(file)) {
    return {
      ok: false as const,
      status: 400,
      error: `Filename não editável. Permitidos: ${EDITABLE_FILES.join(", ")}.`,
    };
  }
  return { ok: true as const };
}

// ── GET ──────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  const check = checkParams(id, file);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  try {
    const result = await readWorkspaceFile(id, file);
    if (!result) {
      return NextResponse.json(
        { error: `Arquivo "${file}" não existe no workspace de ${id}.` },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkspaceFileError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: "Falha ao ler arquivo",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ── PUT ──────────────────────────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  const check = checkParams(id, file);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let body: { content?: unknown; commitMessage?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  if (typeof body.content !== "string") {
    return NextResponse.json(
      { error: "content (string) é obrigatório." },
      { status: 400 },
    );
  }
  const commitMessage =
    typeof body.commitMessage === "string"
      ? body.commitMessage.slice(0, 200)
      : undefined;

  // Resolve operador pro audit log. (No futuro, vem do session cookie.)
  const operator = request.headers.get("x-mc-operator") ?? "panel";

  const target = describeTarget(id, file);

  try {
    const result = await writeWorkspaceFile(id, file, body.content, {
      commitMessage,
      author: operator,
    });
    await auditMutation(request, {
      action: "workspace.file.write",
      target,
      ok: true,
      meta: {
        bytes: result.bytesWritten,
        commitSha: result.commitSha,
        noChange: result.noChange,
      },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    await auditMutation(request, {
      action: "workspace.file.write",
      target,
      ok: false,
    });
    if (err instanceof WorkspaceFileError) {
      return NextResponse.json(
        {
          error: err.message,
          detail: err.stderr || err.stdout || undefined,
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: "Falha ao escrever arquivo",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
