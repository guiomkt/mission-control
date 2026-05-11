import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { OPENCLAW_DIR, OPENCLAW_WORKSPACE } from "@/lib/paths";
import { listAgents, listSessions } from "@/lib/openclaw-client";

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
