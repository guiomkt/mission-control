/**
 * Busca skills no ClawHub.
 *
 * GET /api/agents/[id]/skills/search?q=<query>&limit=<n>
 *   → { hits: [{ slug, displayName, summary, ... }] }
 *
 * Mesmo o resultado não dependendo do agente, mantemos a rota sob
 * `[id]` pra padrão consistente — a UI já tem agentId em contexto.
 * Cache global por query (5min) — searches são caras (~3s) e
 * tipicamente repetidas.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SingleFlightCache } from "@/lib/openclaw-cache";
import {
  searchSkills,
  SkillManagerError,
  type SearchHit,
} from "@/lib/agent-skills-manager";

export const dynamic = "force-dynamic";

// Um cache por query (sem ligação ao agentId — search é global no
// ClawHub).
const searchCache = new Map<string, SingleFlightCache<SearchHit[]>>();
function getCache(key: string): SingleFlightCache<SearchHit[]> {
  let c = searchCache.get(key);
  if (!c) {
    c = new SingleFlightCache<SearchHit[]>({
      ttlMs: 5 * 60_000,
      maxAgeMs: 30 * 60_000,
    });
    searchCache.set(key, c);
    // Evita crescimento ilimitado em memória.
    if (searchCache.size > 100) {
      const firstKey = searchCache.keys().next().value;
      if (firstKey) searchCache.delete(firstKey);
    }
  }
  return c;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

  // Query precisa ter algum sinal pra não devolver lista enorme.
  if (q.length > 200) {
    return NextResponse.json({ error: "query muito longa" }, { status: 400 });
  }

  try {
    const key = `${q.toLowerCase()}::${limit}`;
    const hits = await getCache(key).get(() => searchSkills(q, limit));
    return NextResponse.json({ query: q, limit, hits });
  } catch (err) {
    if (err instanceof SkillManagerError) {
      return NextResponse.json(
        { error: err.message, detail: err.stderr || err.stdout || undefined },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: "Falha ao buscar skills",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
