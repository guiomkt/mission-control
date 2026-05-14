/**
 * Lista os plugins habilitados no openclaw-kozw.
 * GET /api/openclaw/plugins
 *
 * Lê direto do `openclaw.json` (mountado read-only em /workspace) ao
 * invés de invocar a RPC — é mais barato e a estrutura `plugins` é
 * estável entre versões do OpenClaw.
 *
 * Cache 30s — `plugins.allow` muda raramente (operador SSH-ing pra
 * habilitar algo). O dashboard chama esse endpoint só no mount da
 * página, então mesmo sem cache seria barato.
 */
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const CONFIG_FILE = path.join(
  process.env.OPENCLAW_DIR || "/workspace",
  "openclaw.json",
);

interface Plugin {
  id: string;
  enabled: boolean;
  installed: boolean;
}

interface PluginsResponse {
  allow: string[];
  plugins: Plugin[];
}

interface CachedPlugins {
  ts: number;
  data: PluginsResponse;
}

const CACHE_TTL_MS = 30_000;
let cache: CachedPlugins | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf-8");
    const cfg = JSON.parse(raw) as {
      plugins?: {
        allow?: string[];
        entries?: Record<
          string,
          { enabled?: boolean; installed?: boolean }
        >;
      };
    };

    const allow = cfg.plugins?.allow ?? [];
    const entries = cfg.plugins?.entries ?? {};

    // Plugin é "ativo" se aparece em `allow` E tem entry com enabled.
    // Coletamos todos os IDs vistos em qualquer dos dois lados pra dar
    // uma visão completa (inclui também installable que tá em entries
    // mas não em allow).
    const allIds = new Set<string>([...allow, ...Object.keys(entries)]);
    const plugins: Plugin[] = [...allIds].sort().map((id) => ({
      id,
      enabled: allow.includes(id) && (entries[id]?.enabled ?? false),
      installed: entries[id]?.installed ?? true,
    }));

    const data: PluginsResponse = { allow, plugins };
    cache = { ts: now, data };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error: "failed to read openclaw.json",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
