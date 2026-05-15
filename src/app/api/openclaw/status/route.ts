/**
 * Status real-time dos channels do OpenClaw.
 * GET /api/openclaw/status
 *
 * Roda `openclaw channels status --json` dentro do container do gateway
 * e devolve o JSON parseado.
 *
 * Cache: TTL 30s fresh, maxAge 120s stale-while-revalidate. Single-flight
 * pra evitar stampede (ver openclaw-cache.ts — problema observado em prod
 * em 2026-05-15 quando /settings polling spawnava 4 execs concorrentes
 * cada qual consumindo ~300MB de RAM no kozw).
 */
import { NextResponse } from "next/server";
import { openclawExec, OpenClawExecError } from "@/lib/openclaw-exec";
import { SingleFlightCache } from "@/lib/openclaw-cache";

const cache = new SingleFlightCache<unknown>({
  ttlMs: 30_000,
  maxAgeMs: 120_000,
});

export async function GET() {
  try {
    const data = await cache.get(async () => {
      const result = await openclawExec(["channels", "status", "--json"], {
        timeoutMs: 10_000,
      });
      return JSON.parse(result.stdout);
    });
    return NextResponse.json(data);
  } catch (err) {
    const message =
      err instanceof OpenClawExecError
        ? err.message + (err.result.stderr ? `\n${err.result.stderr}` : "")
        : err instanceof Error
          ? err.message
          : String(err);
    return NextResponse.json(
      { error: "openclaw channels status failed", detail: message },
      { status: 502 },
    );
  }
}
