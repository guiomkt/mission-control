/**
 * Lista o estado de cada provedor LLM gerenciável pelo painel.
 * GET /api/openclaw/providers
 *
 * Combina três fontes:
 *   1. Lista canônica (PROVIDERS) — o que o painel sabe gerenciar.
 *   2. `provider_keys` no Supabase — quais já estão gerenciados (com
 *      `lastFour` + `updatedAt`).
 *   3. Env real do container kozw — pra detectar chaves "legado" (existem
 *      no `.env` mas nunca passaram pelo painel) e marcá-las como tal.
 *
 * Response shape:
 *   [
 *     { id, label, envName, helpUrl, status: 'configured'|'legacy'|'missing',
 *       lastFour?, updatedAt? }
 *   ]
 */
import { NextResponse } from "next/server";
import { PROVIDERS, listProviderKeys } from "@/lib/provider-keys";
import { readEnvFromKozw } from "@/lib/kozw-env-sync";
import { SingleFlightCache } from "@/lib/openclaw-cache";

export const dynamic = "force-dynamic";

// Cache 60s + SWR 300s + single-flight pra evitar stampede do
// /settings polling (6 endpoints simultâneos).
const cache = new SingleFlightCache<unknown>({
  ttlMs: 60_000,
  maxAgeMs: 300_000,
});

export async function GET() {
  try {
    const payload = await cache.get(async () => {
      const managed = await listProviderKeys();
      const managedByProvider = new Map(managed.map((m) => [m.provider, m]));

      // Lê todas as envs em paralelo. `readEnvFromKozw` é uma chamada
      // a `docker inspect` por var — barata, mas paralelizar acelera UX.
      const envSnapshots = await Promise.all(
        PROVIDERS.map(async (p) => {
          const value = await readEnvFromKozw(p.envName);
          return { id: p.id, presentInContainer: value !== null, value };
        }),
      );
      const envByProvider = new Map(envSnapshots.map((s) => [s.id, s]));

      const items = PROVIDERS.map((p) => {
        const mgmt = managedByProvider.get(p.id);
        const env = envByProvider.get(p.id);

        let status: "configured" | "legacy" | "missing";
        let lastFour: string | undefined;
        let updatedAt: string | undefined;

        if (mgmt) {
          status = "configured";
          lastFour = mgmt.last_four;
          updatedAt = mgmt.updated_at;
        } else if (env?.presentInContainer) {
          status = "legacy";
          lastFour =
            env.value && env.value.length >= 4
              ? env.value.slice(-4)
              : env.value ?? undefined;
        } else {
          status = "missing";
        }

        return {
          id: p.id,
          label: p.label,
          envName: p.envName,
          helpUrl: p.helpUrl,
          status,
          lastFour,
          updatedAt,
        };
      });

      return { providers: items };
    });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to list providers", detail: message },
      { status: 500 },
    );
  }
}
