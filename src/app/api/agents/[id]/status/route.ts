import { NextResponse } from "next/server";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { OPENCLAW_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

interface ConfigAgent {
  id: string;
  name?: string;
  workspace?: string;
  model?: { primary?: string };
  subagents?: { allowAgents?: string[] };
}

interface OpenClawConfig {
  agents?: {
    list?: ConfigAgent[];
    defaults?: { model?: { primary?: string } | string };
  };
  channels?: {
    telegram?: {
      accounts?: Record<string, { dmPolicy?: string; botToken?: string }>;
    };
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Read openclaw config
    const configPath = join(OPENCLAW_DIR, "openclaw.json");
    const config: OpenClawConfig = JSON.parse(readFileSync(configPath, "utf-8"));

    // Find agent
    const agent = config.agents?.list?.find((a) => a.id === id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Get memory files
    const workspace = agent.workspace || join(OPENCLAW_DIR, "workspace");
    const memoryPath = join(workspace, "memory");
    let recentFiles: Array<{ date: string; size: number; modified: string }> =
      [];

    try {
      const files = readdirSync(memoryPath).filter((f) =>
        f.match(/^\d{4}-\d{2}-\d{2}\.md$/)
      );
      recentFiles = files
        .map((file) => {
          const stat = statSync(join(memoryPath, file));
          return {
            date: file.replace(".md", ""),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 7);
    } catch (e) {
      // Memory directory doesn't exist
    }

    // Get session info (from OpenClaw API if available)
    // For now, we return mock data
    const sessions: Array<unknown> = [];

    // Get telegram account info
    const telegramAccount = config.channels?.telegram?.accounts?.[id];

    const defaultsModel = config.agents?.defaults?.model;
    const fallbackPrimary =
      typeof defaultsModel === "string"
        ? defaultsModel
        : defaultsModel?.primary;

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        model: agent.model?.primary || fallbackPrimary,
        workspace,
        dmPolicy: telegramAccount?.dmPolicy,
        allowAgents: agent.subagents?.allowAgents || [],
        telegramConfigured: !!telegramAccount?.botToken,
      },
      memory: {
        recentFiles,
      },
      sessions,
    });
  } catch (error) {
    console.error("Error getting agent status:", error);
    return NextResponse.json(
      { error: "Failed to get agent status" },
      { status: 500 }
    );
  }
}
