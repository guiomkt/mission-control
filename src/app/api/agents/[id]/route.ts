/**
 * Detail + delete de um agente.
 * GET    /api/agents/[id]      — combina config + status + bindings
 * DELETE /api/agents/[id]      — `openclaw agents delete <id> --force --json`
 *
 * Proteções no DELETE:
 *  - Bloqueia `id === "main"` (agente padrão do sistema)
 *  - Bloqueia se algum outro agente referencia este em `subagents.allowAgents`
 *  - Audit log completo
 *  - Executa sob `withConfigLock` pra serializar com outras mutations
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listAgents, listSessions } from "@/lib/openclaw-client";
import {
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import { validateAgentId, RESERVED_AGENT_IDS } from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import {
  agentDetailCache,
  getCachedConfig,
  readOpenClawConfig,
} from "@/lib/agent-detail-cache";

export const dynamic = "force-dynamic";

// ── GET (detail) ─────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idCheck = validateAgentId(id);
  // Pra GET aceitamos ids reservados também (precisamos mostrar o `main`).
  if (
    !idCheck.ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const [fsAgents, config, sessions] = await Promise.all([
      listAgents(),
      getCachedConfig(),
      listSessions(id).catch(() => []),
    ]);

    const fsAgent = fsAgents.find((a) => a.id === id);
    if (!fsAgent) {
      return NextResponse.json(
        { error: `Agente "${id}" não encontrado.` },
        { status: 404 },
      );
    }

    const entry = (config?.agents?.list ?? []).find((a) => a.id === id);
    const bindings = (config?.bindings ?? []).filter(
      (b) => b.agentId === id,
    );

    // Quem referencia este agente em allowAgents?
    const referencedBy = (config?.agents?.list ?? [])
      .filter((a) => a.id !== id && a.subagents?.allowAgents?.includes(id))
      .map((a) => ({
        id: a.id,
        name: a.identity?.name ?? a.name ?? a.id,
      }));

    // Pickers: outros agentes (pra SubagentsEditor) + canais disponíveis
    // (pra BindingsManager). Mantemos minimal pra não bloatear.
    const siblings = (config?.agents?.list ?? [])
      .filter((a) => a.id !== id)
      .map((a) => ({
        id: a.id,
        name: a.identity?.name ?? a.name ?? a.id,
        emoji: a.identity?.emoji ?? a.ui?.emoji,
      }));

    // Lê canais direto do `channels` top-level. Cada canal tem
    // `accounts` dict; pegamos só os nomes pra picker.
    const channelsRaw = (config as unknown as {
      channels?: Record<
        string,
        { accounts?: Record<string, unknown> | unknown[] }
      >;
    } | null)?.channels ?? {};
    const availableChannels = Object.entries(channelsRaw).map(([name, c]) => ({
      name,
      accounts: Array.isArray(c.accounts)
        ? c.accounts.filter((x): x is string => typeof x === "string")
        : c.accounts && typeof c.accounts === "object"
          ? Object.keys(c.accounts as Record<string, unknown>)
          : [],
    }));

    return NextResponse.json({
      id,
      name: entry?.identity?.name ?? entry?.name ?? fsAgent.name,
      identity: {
        name: entry?.identity?.name,
        emoji: entry?.identity?.emoji ?? entry?.ui?.emoji,
        theme: entry?.identity?.theme,
        avatar: entry?.identity?.avatar,
        color: entry?.ui?.color,
      },
      workspace: entry?.workspace ?? fsAgent.workspace,
      model: entry?.model?.primary ?? fsAgent.models[0] ?? null,
      fallbacks: entry?.model?.fallbacks ?? [],
      allowAgents: entry?.subagents?.allowAgents ?? [],
      heartbeat: entry?.heartbeat ?? null,
      bindings: bindings.map((b) => ({
        channel: b.match?.channel ?? null,
        accountId: b.match?.accountId ?? null,
      })),
      referencedBy,
      activeSessions: sessions.length,
      isMain: id === "main",
      siblings,
      availableChannels,
    });
  } catch (err) {
    console.error("[api/agents/[id] GET] error", err);
    return NextResponse.json(
      {
        error: "Failed to load agent detail",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Proteção 1: não permitir delete de IDs reservados (`main`).
  if (RESERVED_AGENT_IDS.has(id)) {
    await auditMutation(request, {
      action: "agent.delete",
      target: id,
      ok: false,
      meta: { blocked: "reserved" },
    });
    return NextResponse.json(
      {
        error: `Agente "${id}" é reservado do sistema e não pode ser deletado.`,
      },
      { status: 403 },
    );
  }

  // Validação básica do formato.
  const idCheck = validateAgentId(id);
  if (!idCheck.ok) {
    return NextResponse.json({ error: idCheck.reason }, { status: 400 });
  }

  try {
    // Proteção 2: bloquear se outros agentes ainda referenciam este.
    // Read direto (sem cache) — queremos estado fresco antes de deletar.
    const config = await readOpenClawConfig();
    const referencedBy = (config?.agents?.list ?? [])
      .filter((a) => a.id !== id && a.subagents?.allowAgents?.includes(id))
      .map((a) => a.id);

    if (referencedBy.length > 0) {
      await auditMutation(request, {
        action: "agent.delete",
        target: id,
        ok: false,
        meta: { blocked: "referenced_by", referencedBy },
      });
      return NextResponse.json(
        {
          error: `Outros agentes ainda referenciam "${id}" como subagent.`,
          detail: `Referenciado por: ${referencedBy.join(", ")}. Remova as referências antes de deletar.`,
          referencedBy,
        },
        { status: 409 },
      );
    }

    // Tudo limpo — executa delete via CLI sob lock.
    const result = await withConfigLock(() =>
      openclawExec(["agents", "delete", id, "--force", "--json"], {
        timeoutMs: 30_000,
      }),
    );

    await auditMutation(request, {
      action: "agent.delete",
      target: id,
      ok: true,
    });

    // Invalida cache pra refletir mudança imediata.
    agentDetailCache.invalidate();

    return NextResponse.json({
      success: true,
      stdout: result.stdout.trim(),
    });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.delete",
      target: id,
      ok: false,
    });
    if (err instanceof OpenClawExecError) {
      return NextResponse.json(
        {
          error: "openclaw agents delete falhou",
          detail: err.result.stderr || err.message,
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
