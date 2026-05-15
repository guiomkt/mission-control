/**
 * Cache compartilhado pro `GET /api/agents/[id]` — extraído pra que as
 * rotas de mutação (bindings, subagents, heartbeat) consigam invalidar
 * após escrever sem precisar de uma viagem ao backend.
 *
 * TTL curto (5s fresh / 30s stale-while-revalidate). O cache lê o
 * `openclaw.json` direto do filesystem (mountado /workspace), então não
 * é caro re-popular — mas evita uma rajada de leituras quando a UI
 * polla.
 */
import { promises as fs } from "fs";
import path from "path";
import { OPENCLAW_DIR } from "@/lib/paths";
import { SingleFlightCache } from "@/lib/openclaw-cache";

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

export interface OpenClawConfig {
  agents?: {
    list?: AgentConfigEntry[];
    defaults?: { model?: { primary?: string } | string };
  };
  bindings?: Array<{
    agentId?: string;
    match?: { channel?: string; accountId?: string };
  }>;
}

export async function readOpenClawConfig(): Promise<OpenClawConfig | null> {
  try {
    const raw = await fs.readFile(
      path.join(OPENCLAW_DIR, "openclaw.json"),
      "utf-8",
    );
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return null;
  }
}

export const agentDetailCache = new SingleFlightCache<OpenClawConfig | null>({
  ttlMs: 5_000,
  maxAgeMs: 30_000,
});

/** Atalho — sempre passa por `readOpenClawConfig` sob cache. */
export function getCachedConfig() {
  return agentDetailCache.get(() => readOpenClawConfig());
}
