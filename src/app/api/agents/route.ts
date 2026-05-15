import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { OPENCLAW_DIR, OPENCLAW_WORKSPACE } from "@/lib/paths";
import { listAgents, listSessions } from "@/lib/openclaw-client";
import {
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import {
  validateAgentId,
  validateAgentName,
  normalizeAgentEmoji,
  normalizeAgentTheme,
  workspacePathFor,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

interface Agent {
  id: string;
  name: string;
  emoji: string;
  color: string;
  model: string;
  workspace: string;
  dmPolicy?: string;
  allowAgents?: string[];
  allowAgentsDetails?: Array<{
    id: string;
    name: string;
    emoji: string;
    color: string;
  }>;
  botToken?: "configured" | undefined;
  status: "online" | "offline";
  lastActivity?: string;
  activeSessions: number;
}

const DEFAULT_AGENT_CONFIG: Record<string, { emoji: string; color: string; name?: string }> = {
  main: {
    emoji: process.env.NEXT_PUBLIC_AGENT_EMOJI || "🦞",
    color: "#ff6b35",
    name: process.env.NEXT_PUBLIC_AGENT_NAME || "Mission Control",
  },
};

interface AgentConfigEntry {
  id: string;
  name?: string;
  workspace?: string;
  ui?: { emoji?: string; color?: string };
  subagents?: { allowAgents?: string[] };
  model?: { primary?: string };
}

interface OpenClawConfig {
  agents?: {
    list?: AgentConfigEntry[];
    defaults?: { model?: { primary?: string } | string };
  };
  channels?: {
    telegram?: {
      dmPolicy?: string;
      accounts?: Record<string, { dmPolicy?: string; botToken?: string }>;
    };
  };
}

function getDisplayInfo(
  agentId: string,
  entry: AgentConfigEntry | undefined,
): { emoji: string; color: string; name: string } {
  const defaults = DEFAULT_AGENT_CONFIG[agentId];
  return {
    emoji: entry?.ui?.emoji ?? defaults?.emoji ?? "🤖",
    color: entry?.ui?.color ?? defaults?.color ?? "#666666",
    name: entry?.name ?? defaults?.name ?? agentId,
  };
}

async function readConfig(): Promise<OpenClawConfig | null> {
  try {
    const raw = await fs.readFile(path.join(OPENCLAW_DIR, "openclaw.json"), "utf-8");
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return null;
  }
}

/**
 * Check if an agent has recent activity by looking for today's memory file.
 * Returns the mtime if found, undefined otherwise.
 */
async function lastActivityFromMemory(): Promise<Date | undefined> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const stat = await fs.stat(path.join(OPENCLAW_WORKSPACE, "memory", `${today}.md`));
    return stat.mtime;
  } catch {
    return undefined;
  }
}

export async function GET() {
  try {
    // Filesystem-discovered agents (truth source per Phase 2).
    const fsAgents = await listAgents();
    const config = await readConfig();

    // Build a lookup of canonical config entries by id (if config exists).
    const configById = new Map<string, AgentConfigEntry>();
    for (const a of config?.agents?.list ?? []) {
      configById.set(a.id, a);
    }

    // Activity is computed once per request (cheap memory-file stat).
    const lastMemoryMtime = await lastActivityFromMemory();
    const now = Date.now();

    const agents: Agent[] = await Promise.all(
      fsAgents.map(async (a) => {
        const entry = configById.get(a.id);
        const display = getDisplayInfo(a.id, entry);

        const telegramAccount = config?.channels?.telegram?.accounts?.[a.id];
        const sessions = await listSessions(a.id);

        // "online" if today's memory was touched in the last 5 minutes AND this
        // is the main agent (the only one writing memory). Other agents stay
        // offline unless we extend the heuristic later.
        let status: "online" | "offline" = "offline";
        let lastActivity: string | undefined;
        if (a.id === "main" && lastMemoryMtime) {
          lastActivity = lastMemoryMtime.toISOString();
          status =
            now - lastMemoryMtime.getTime() < 5 * 60 * 1000 ? "online" : "offline";
        }

        const allowAgents = entry?.subagents?.allowAgents ?? [];
        const allowAgentsDetails = allowAgents.map((subId) => {
          const subEntry = configById.get(subId);
          const subDisplay = getDisplayInfo(subId, subEntry);
          return {
            id: subId,
            name: subEntry?.name || subDisplay.name,
            emoji: subDisplay.emoji,
            color: subDisplay.color,
          };
        });

        const fallbackModel = (() => {
          const dm = config?.agents?.defaults?.model;
          if (typeof dm === "string") return dm;
          return dm?.primary ?? "";
        })();

        return {
          id: a.id,
          name: entry?.name || display.name,
          emoji: display.emoji,
          color: display.color,
          model: entry?.model?.primary ?? fallbackModel ?? (a.models[0] ?? ""),
          workspace: entry?.workspace || a.workspace,
          dmPolicy:
            telegramAccount?.dmPolicy ||
            config?.channels?.telegram?.dmPolicy ||
            "pairing",
          allowAgents,
          allowAgentsDetails,
          botToken: telegramAccount?.botToken ? "configured" : undefined,
          status,
          lastActivity,
          activeSessions: sessions.length,
        };
      }),
    );

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("[api/agents] error", error);
    return NextResponse.json(
      { error: "Failed to load agents" },
      { status: 500 },
    );
  }
}

/**
 * Criar um novo agente isolado.
 * POST /api/agents
 * Body: {
 *   id: string,             // slug (regex [a-z][a-z0-9-]{0,39})
 *   name?: string,          // display name (opcional, set-identity depois)
 *   emoji?: string,
 *   theme?: string,
 *   model?: string,         // model id (default: openai-codex/gpt-5.4)
 * }
 *
 * Executa em 2 passos com `withConfigLock`:
 *   1. `openclaw agents add <id> --workspace ... --model ... --non-interactive --json`
 *   2. (best-effort) `openclaw agents set-identity --agent <id> --name ... --emoji ... --theme ...`
 *
 * Se passo 2 falha, o agente já foi criado — operador pode editar identidade
 * pela UI depois. Audit log captura ambos os outcomes.
 */
export async function POST(request: NextRequest) {
  let body: {
    id?: unknown;
    name?: unknown;
    emoji?: unknown;
    theme?: unknown;
    model?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  // Validações sincronas
  const idCheck = validateAgentId(body.id);
  if (!idCheck.ok) {
    return NextResponse.json({ error: idCheck.reason }, { status: 400 });
  }
  const id = body.id as string;

  const nameCheck = validateAgentName(body.name);
  if (!nameCheck.ok) {
    return NextResponse.json({ error: nameCheck.reason }, { status: 400 });
  }
  const friendlyName =
    typeof body.name === "string" ? body.name.trim() : undefined;
  const emoji = normalizeAgentEmoji(body.emoji);
  const theme = normalizeAgentTheme(body.theme);
  const model =
    typeof body.model === "string" && body.model.length > 0
      ? body.model.trim()
      : "openai-codex/gpt-5.4";

  // Checa colisão com agente existente — fs-discovery é a fonte da verdade.
  try {
    const existing = await listAgents();
    if (existing.some((a) => a.id === id)) {
      return NextResponse.json(
        { error: `Já existe um agente com id "${id}".` },
        { status: 409 },
      );
    }
  } catch (err) {
    console.error("[api/agents POST] listAgents failed", err);
    // Continua mesmo se listAgents falha — `agents add` vai rejeitar duplicates.
  }

  const workspace = workspacePathFor(id);

  // Executa create + set-identity sob o mesmo lock pra evitar interleave.
  let createdViaCli = false;
  let identityOk = false;
  let identityWarning: string | undefined;

  try {
    await withConfigLock(async () => {
      // Step 1: create
      await openclawExec(
        [
          "agents",
          "add",
          id,
          "--workspace",
          workspace,
          "--model",
          model,
          "--non-interactive",
          "--json",
        ],
        { timeoutMs: 30_000 },
      );
      createdViaCli = true;

      // Step 2: set-identity (best-effort)
      if (friendlyName || emoji || theme) {
        const identityArgs = ["agents", "set-identity", "--agent", id, "--json"];
        if (friendlyName) identityArgs.push("--name", friendlyName);
        if (emoji) identityArgs.push("--emoji", emoji);
        if (theme) identityArgs.push("--theme", theme);
        try {
          await openclawExec(identityArgs, { timeoutMs: 15_000 });
          identityOk = true;
        } catch (idErr) {
          identityWarning =
            idErr instanceof OpenClawExecError
              ? idErr.result.stderr || idErr.message
              : idErr instanceof Error
                ? idErr.message
                : String(idErr);
        }
      } else {
        identityOk = true; // nothing to set
      }
    });

    await auditMutation(request, {
      action: "agent.create",
      target: id,
      ok: true,
      meta: {
        model,
        workspace,
        identityOk,
        identityWarning,
      },
    });

    return NextResponse.json(
      {
        success: true,
        agent: { id, name: friendlyName ?? id, emoji, theme, model, workspace },
        identityOk,
        identityWarning,
      },
      { status: 201 },
    );
  } catch (err) {
    await auditMutation(request, {
      action: "agent.create",
      target: id,
      ok: false,
      meta: { createdViaCli, identityOk },
    });
    if (err instanceof OpenClawExecError) {
      // Se "add" rejeita por id duplicado, devolve 409.
      const stderrLower = (err.result.stderr || "").toLowerCase();
      if (
        stderrLower.includes("already") ||
        stderrLower.includes("exists") ||
        stderrLower.includes("duplicate")
      ) {
        return NextResponse.json(
          { error: `Agente "${id}" já existe.` },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          error: "openclaw agents add falhou",
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
