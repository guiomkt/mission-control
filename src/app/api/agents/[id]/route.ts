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
import { promises as fs } from "fs";
import path from "path";
import { OPENCLAW_DIR } from "@/lib/paths";
import { listAgents, listSessions } from "@/lib/openclaw-client";
import {
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import { validateAgentId, RESERVED_AGENT_IDS } from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import { SingleFlightCache } from "@/lib/openclaw-cache";

export const dynamic = "force-dynamic";

// ── Tipos da config ──────────────────────────────────────────────────────

interface AgentConfigEntry {
  id: string;
  name?: string;
  workspace?: string;
  ui?: { emoji?: string; color?: string };
  identity?: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  };
  subagents?: { allowAgents?: string[] };
  model?: { primary?: string; fallbacks?: string[] };
  heartbeat?: Record<string, unknown>;
}

interface OpenClawConfig {
  agents?: {
    list?: AgentConfigEntry[];
    defaults?: { model?: { primary?: string } | string };
  };
  bindings?: Array<{
    agentId?: string;
    match?: { channel?: string; accountId?: string };
  }>;
}

async function readConfig(): Promise<OpenClawConfig | null> {
  try {
    const raw = await fs.readFile(path.join(OPENCLAW_DIR, "openclaw.json"), "utf-8");
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return null;
  }
}

/** Cache curto pra evitar re-read do JSON em rajadas. */
const detailCache = new SingleFlightCache<OpenClawConfig | null>({
  ttlMs: 5_000,
  maxAgeMs: 30_000,
});

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
      detailCache.get(() => readConfig()),
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
    const config = await readConfig();
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
    detailCache.invalidate();

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
