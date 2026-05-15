/**
 * Snapshot de profiles OAuth do gateway.
 * GET /api/openclaw/oauth/profiles
 *
 * Roda `openclaw models auth list` dentro do container kozw, faz strip
 * de ANSI, parseia as linhas `- key [provider/type; status]` e devolve
 * o resultado anotado (health, daysRemaining, catalogEntry).
 *
 * Cache: TTL 60s fresh, maxAge 300s stale-while-revalidate. Single-flight
 * pra evitar stampede de docker exec spawn (ver openclaw-cache.ts).
 */
import { NextResponse } from "next/server";
import { openclawExec, OpenClawExecError } from "@/lib/openclaw-exec";
import { buildSnapshot, OAUTH_PROVIDERS } from "@/lib/oauth-profile-parser";
import { SingleFlightCache } from "@/lib/openclaw-cache";

export const dynamic = "force-dynamic";

const cache = new SingleFlightCache<unknown>({
  ttlMs: 60_000,
  maxAgeMs: 300_000,
});

export async function GET() {
  try {
    const payload = await cache.get(async () => {
      const result = await openclawExec(["models", "auth", "list"], {
        timeoutMs: 10_000,
      });
      const snapshot = buildSnapshot(result.stdout + "\n" + result.stderr);
      return {
        providers: snapshot.providers.map((p) => ({
          id: p.catalogEntry.id,
          label: p.catalogEntry.label,
          brand: p.catalogEntry.brand,
          reconnectMethod: p.catalogEntry.reconnectMethod,
          profiles: p.profiles.map((prof) => ({
            key: prof.key,
            label: prof.label,
            type: prof.type,
            expiresAt: prof.expiresAt,
            cooldownUntil: prof.cooldownUntil,
            health: prof.health,
            daysRemaining: prof.daysRemaining,
            statusDetail: prof.statusDetail,
          })),
        })),
        otherProfiles: snapshot.otherProfiles.map((p) => ({
          key: p.key,
          providerId: p.providerId,
          type: p.type,
          expiresAt: p.expiresAt,
          cooldownUntil: p.cooldownUntil,
          health: p.health,
          daysRemaining: p.daysRemaining,
        })),
        catalog: OAUTH_PROVIDERS,
      };
    });
    return NextResponse.json(payload);
  } catch (err) {
    const message =
      err instanceof OpenClawExecError
        ? err.message + (err.result.stderr ? `\n${err.result.stderr}` : "")
        : err instanceof Error
          ? err.message
          : String(err);
    return NextResponse.json(
      { error: "openclaw models auth list failed", detail: message },
      { status: 502 },
    );
  }
}
