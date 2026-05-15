/**
 * Subagents permitidos (allowAgents) de um agente.
 *
 * PATCH /api/agents/[id]/subagents
 * Body: { allowAgents: string[] }
 *  - Substitui o conjunto inteiro.
 *  - Passar `[]` (vazio) remove a chave `subagents` do agente.
 *
 * Validações:
 *  - Cada id no array deve ser um agente que existe no `agents.list[]`.
 *  - Não permitir self-reference (`id` na própria lista).
 *  - Não permitir `defaults` no array (não é um agente real).
 *
 * Mutação direta em `openclaw.json` via `mutateAgentEntry` — sem CLI
 * (não existe). Sob `withConfigLock`. Não reinicia o kozw.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import {
  agentDetailCache,
  readOpenClawConfig,
} from "@/lib/agent-detail-cache";
import {
  mutateAgentEntry,
  AgentConfigWriterError,
} from "@/lib/agent-config-writer";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Aceita `main` como caller (main pode ter subagents) mas valida formato.
  const idCheck = validateAgentId(id);
  if (!idCheck.ok && id !== "main") {
    return NextResponse.json({ error: idCheck.reason }, { status: 400 });
  }
  if (RESERVED_AGENT_IDS.has(id) && id !== "main") {
    return NextResponse.json(
      { error: `Agente "${id}" é reservado.` },
      { status: 403 },
    );
  }

  let body: { allowAgents?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.allowAgents)) {
    return NextResponse.json(
      { error: "allowAgents deve ser um array de strings." },
      { status: 400 },
    );
  }

  // Normaliza, dedup, valida cada entry.
  const requested = body.allowAgents.filter(
    (v): v is string => typeof v === "string",
  );
  const dedup = Array.from(new Set(requested));

  if (dedup.includes(id)) {
    return NextResponse.json(
      { error: "Agente não pode ser subagent de si mesmo." },
      { status: 400 },
    );
  }
  if (dedup.some((x) => RESERVED_AGENT_IDS.has(x) && x !== "main")) {
    return NextResponse.json(
      { error: "allowAgents não pode conter IDs reservados." },
      { status: 400 },
    );
  }
  for (const sub of dedup) {
    if (sub !== "main" && !validateAgentId(sub).ok) {
      return NextResponse.json(
        { error: `ID inválido em allowAgents: "${sub}".` },
        { status: 400 },
      );
    }
  }

  // Cross-check: todos os subagents listados precisam existir.
  const config = await readOpenClawConfig();
  const existingIds = new Set(
    (config?.agents?.list ?? []).map((a) => a.id),
  );
  const missing = dedup.filter((x) => !existingIds.has(x));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "Subagents inexistentes na config.",
        detail: `Não existem: ${missing.join(", ")}.`,
        missing,
      },
      { status: 400 },
    );
  }

  // Garante que o agente caller exista.
  if (!existingIds.has(id)) {
    return NextResponse.json(
      { error: `Agente "${id}" não encontrado.` },
      { status: 404 },
    );
  }

  // Lista vazia → remove a chave inteira.
  const mutationValue =
    dedup.length === 0 ? null : { allowAgents: dedup };

  try {
    const result = await mutateAgentEntry(id, { subagents: mutationValue });

    if (result.status === "agent_not_found") {
      return NextResponse.json(
        { error: `Agente "${id}" sumiu da config durante a mutação.` },
        { status: 404 },
      );
    }

    agentDetailCache.invalidate();
    await auditMutation(request, {
      action: "agent.subagents.update",
      target: id,
      ok: true,
      meta: { allowAgents: dedup, status: result.status },
    });
    return NextResponse.json({
      success: true,
      status: result.status,
      allowAgents: dedup,
      backupTimestamp: result.backupTimestamp,
    });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.subagents.update",
      target: id,
      ok: false,
      meta: { allowAgents: dedup },
    });
    if (err instanceof AgentConfigWriterError) {
      return NextResponse.json(
        {
          error: "Falha ao escrever openclaw.json",
          detail: err.stderr || err.message,
        },
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
