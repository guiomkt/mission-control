/**
 * Status real-time dos channels do OpenClaw.
 * GET /api/openclaw/status
 *
 * Roda `openclaw channels status --json` dentro do container do gateway
 * e devolve o JSON parseado. Cache de 5s no servidor pra não martelar
 * o RPC quando vários abas estão abertas — o dashboard tipicamente faz
 * polling pra esse endpoint a cada 10-15s.
 */
import { NextResponse } from "next/server";
import { openclawExec, OpenClawExecError } from "@/lib/openclaw-exec";

interface CachedStatus {
  ts: number;
  data: unknown;
}

const CACHE_TTL_MS = 5_000;
let cache: CachedStatus | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  try {
    const result = await openclawExec(
      ["channels", "status", "--json"],
      { timeoutMs: 10_000 },
    );
    const data = JSON.parse(result.stdout);
    cache = { ts: now, data };
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
