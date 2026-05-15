/**
 * Cost-class status do default + fallback model do agente principal.
 * GET /api/openclaw/models/cost-status
 *
 * Lê DIRETO do filesystem (`${OPENCLAW_DIR}/openclaw.json`, montado RO no
 * painel) — não invoca o CLI do openclaw.
 *
 * Motivação: a versão anterior chamava `openclaw models status`, que leva
 * ~27s pra rodar (boot fresh do gateway + load de auth profiles + lookup
 * de usage tracking). Com timeout de 10s no exec → 502 Bad Gateway
 * intermitente em produção (incident 2026-05-15). Tudo o que precisamos
 * está no JSON estático:
 *   - agents.defaults.model.primary  (default)
 *   - agents.defaults.model.fallbacks[] (fallback chain)
 *   - agents.defaults.models[modelId].alias (aliases humanizados)
 *
 * Leitura de fs é <10ms — 1000× mais rápida e sem dependência do kozw.
 *
 * Classificação cost-class por prefix do model id:
 *  - openai-codex/*    → OAuth (ChatGPT Plus)
 *  - minimax-portal/*  → OAuth (Kimi/Moonshot Pro)
 *  - anthropic/*       → OAuth (Claude Pro via sk-ant-oat01-* tokens)
 *  - openai/*, google/*, deepseek/*, moonshot/*, perplexity/* → PAID
 */
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { SingleFlightCache } from "@/lib/openclaw-cache";

export const dynamic = "force-dynamic";

const CONFIG_FILE = path.join(
  process.env.OPENCLAW_DIR || "/workspace",
  "openclaw.json",
);

const OAUTH_PROVIDERS = new Set([
  "openai-codex",
  "minimax-portal",
  "anthropic",
]);

const PAID_PROVIDERS = new Set([
  "openai",
  "google",
  "deepseek",
  "moonshot",
  "perplexity",
]);

type CostClass = "oauth" | "paid" | "unknown";

function classifyModel(modelId: string): CostClass {
  const provider = modelId.split("/")[0];
  if (OAUTH_PROVIDERS.has(provider)) return "oauth";
  if (PAID_PROVIDERS.has(provider)) return "paid";
  return "unknown";
}

// Shape parcial — só o que consumimos. Resto do openclaw.json é ignorado.
interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: unknown;
      };
      models?: Record<string, unknown>;
    };
  };
}

interface CostStatusPayload {
  defaultModel: string | null;
  defaultCostClass: CostClass;
  fallbacks: Array<{ model: string; costClass: CostClass }>;
  aliasesPointingToPaid: Array<{ name: string; target: string }>;
  severity: "ok" | "warn" | "alert";
  checkedAt: string;
}

function buildCostStatus(d: OpenClawConfig): CostStatusPayload {
  const modelCfg = d.agents?.defaults?.model ?? {};
  const defaultModel: string | null =
    typeof modelCfg.primary === "string" ? modelCfg.primary : null;
  const fallbacks: string[] = Array.isArray(modelCfg.fallbacks)
    ? (modelCfg.fallbacks as unknown[]).filter(
        (s): s is string => typeof s === "string",
      )
    : [];

  // Aliases: agents.defaults.models[modelId].alias
  const modelsMap = d.agents?.defaults?.models ?? {};
  const aliases: Array<{ name: string; target: string; costClass: CostClass }> =
    [];
  for (const [modelId, cfg] of Object.entries(modelsMap)) {
    if (cfg && typeof cfg === "object" && "alias" in cfg) {
      const aliasVal = (cfg as { alias?: unknown }).alias;
      if (typeof aliasVal === "string") {
        aliases.push({
          name: aliasVal,
          target: modelId,
          costClass: classifyModel(modelId),
        });
      }
    }
  }

  const defaultCost: CostClass = defaultModel
    ? classifyModel(defaultModel)
    : "unknown";
  const fallbackCosts = fallbacks.map((m) => ({
    model: m,
    costClass: classifyModel(m),
  }));

  const defaultIsPaid = defaultCost === "paid";
  const anyFallbackPaid = fallbackCosts.some((f) => f.costClass === "paid");
  const aliasesPointingToPaid = aliases.filter((a) => a.costClass === "paid");

  let severity: "ok" | "warn" | "alert";
  if (defaultIsPaid) severity = "alert";
  else if (anyFallbackPaid || aliasesPointingToPaid.length > 0)
    severity = "warn";
  else severity = "ok";

  return {
    defaultModel,
    defaultCostClass: defaultCost,
    fallbacks: fallbackCosts,
    aliasesPointingToPaid: aliasesPointingToPaid.map((a) => ({
      name: a.name,
      target: a.target,
    })),
    severity,
    checkedAt: new Date().toISOString(),
  };
}

// Cache curto — leitura de fs é barata mas evita re-read em rajadas
// de tabs/refresh. Single-flight previne race conditions teóricas.
const cache = new SingleFlightCache<CostStatusPayload>({
  ttlMs: 10_000,
  maxAgeMs: 60_000,
});

export async function GET() {
  try {
    const payload = await cache.get(async () => {
      const raw = await fs.readFile(CONFIG_FILE, "utf-8");
      const cfg = JSON.parse(raw) as OpenClawConfig;
      return buildCostStatus(cfg);
    });
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Falha ao ler ${CONFIG_FILE}`,
        detail: message,
      },
      { status: 502 },
    );
  }
}
