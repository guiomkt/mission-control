/**
 * Snapshot de profiles OAuth do gateway.
 * GET /api/openclaw/oauth/profiles
 *
 * Roda `openclaw models auth list` dentro do container kozw, faz strip
 * de ANSI, parseia as linhas `- key [provider/type; status]` e devolve
 * o resultado anotado (health, daysRemaining, catalogEntry).
 *
 * O dashboard chama esse endpoint no mesmo intervalo de polling de
 * 15s usado pelo /settings — cache 15s no servidor pra eliminar a
 * sobrecarga em caso de múltiplas abas abertas.
 */
import { NextResponse } from "next/server";
import { openclawExec, OpenClawExecError } from "@/lib/openclaw-exec";
import { buildSnapshot, OAUTH_PROVIDERS } from "@/lib/oauth-profile-parser";

export const dynamic = "force-dynamic";

interface CachedSnapshot {
  ts: number;
  payload: unknown;
}

const CACHE_TTL_MS = 15_000;
let cache: CachedSnapshot | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.payload);
  }

  try {
    // `models auth list` é read-only — sem lock necessário.
    const result = await openclawExec(["models", "auth", "list"], {
      timeoutMs: 10_000,
    });
    const snapshot = buildSnapshot(result.stdout + "\n" + result.stderr);
    const payload = {
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
    cache = { ts: now, payload };
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
