/**
 * Cache compartilhado pro `GET /api/agents/[id]/skills` — `openclaw
 * skills list --agent X --json` leva ~3s, então uma rajada de polling
 * pode estourar CPU do kozw.
 *
 * SingleFlightCache é mono-key; aqui mantemos um cache por agentId num
 * Map pra evitar mistura de dados entre agentes.
 */
import { SingleFlightCache } from "@/lib/openclaw-cache";
import type { SkillsListResult } from "@/lib/agent-skills-manager";

const cacheByAgent = new Map<string, SingleFlightCache<SkillsListResult>>();

export function getSkillsCache(
  agentId: string,
): SingleFlightCache<SkillsListResult> {
  let cache = cacheByAgent.get(agentId);
  if (!cache) {
    cache = new SingleFlightCache<SkillsListResult>({
      ttlMs: 60_000,
      maxAgeMs: 5 * 60_000,
    });
    cacheByAgent.set(agentId, cache);
  }
  return cache;
}

export function invalidateSkillsCacheForAgent(agentId: string) {
  cacheByAgent.get(agentId)?.invalidate();
}
