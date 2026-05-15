/**
 * Cost-class status do default + fallback model do agente principal.
 * GET /api/openclaw/models/cost-status
 *
 * Le `openclaw models status`, parseia as linhas Default + Fallbacks, e
 * classifica cada modelo como OAuth (subscription) ou Paid (API key
 * pay-per-token). UI usa pra destacar com vermelho se algo silenciosamente
 * mudar pra paid.
 *
 * Classificação:
 *  - openai-codex/*    → OAuth (ChatGPT Plus)
 *  - minimax-portal/*  → OAuth (Kimi/Moonshot Pro)
 *  - anthropic/*       → OAuth (Claude Pro via sk-ant-oat01-* tokens)
 *  - openai/*          → PAID (OPENAI_API_KEY)
 *  - google/*          → PAID (GEMINI_API_KEY)
 *  - deepseek/*        → PAID (DEEPSEEK_API_KEY)
 *  - moonshot/*        → PAID (MOONSHOT_API_KEY — distinct from minimax-portal!)
 *  - perplexity/*      → PAID
 *  - github-copilot/*  → SUBSCRIPTION (paid but bounded)
 *
 * Cache 15s no servidor pra ficar barato no polling.
 */
import { NextResponse } from "next/server";
import { openclawExec, OpenClawExecError } from "@/lib/openclaw-exec";
import { stripAnsi } from "@/lib/oauth-profile-parser";

export const dynamic = "force-dynamic";

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
    const result = await openclawExec(["models", "status"], {
      timeoutMs: 10_000,
    });
    const clean = stripAnsi(result.stdout + "\n" + result.stderr);

    // Parse heurístico das linhas Default e Fallbacks.
    //   Default       : openai-codex/gpt-5.4
    //   Fallbacks (1) : minimax-portal/MiniMax-M2.7
    //   Aliases (9)   : ChatGPT 5.4 -> openai/gpt-5.4, ...
    const defaultMatch = clean.match(/Default\s*:\s*(\S+)/i);
    const fallbacksMatch = clean.match(/Fallbacks\s*\(\d+\)\s*:\s*([^\n]+)/i);
    const aliasesMatch = clean.match(/Aliases\s*\(\d+\)\s*:\s*([^\n]+)/i);

    const defaultModel = defaultMatch?.[1] ?? null;
    const fallbacks = fallbacksMatch
      ? fallbacksMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && s !== "-")
      : [];

    // Aliases parsing: "ChatGPT 5.4 -> openai/gpt-5.4"
    const aliases: Array<{ name: string; target: string; costClass: CostClass }> = [];
    if (aliasesMatch) {
      for (const part of aliasesMatch[1].split(",")) {
        const m = part.trim().match(/^(.+?)\s*->\s*(\S+)$/);
        if (m) {
          const name = m[1].trim();
          const target = m[2].trim();
          aliases.push({ name, target, costClass: classifyModel(target) });
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

    // Alert flags
    const defaultIsPaid = defaultCost === "paid";
    const anyFallbackPaid = fallbackCosts.some((f) => f.costClass === "paid");
    const aliasesPointingToPaid = aliases.filter((a) => a.costClass === "paid");

    // Severity: red if default is paid, yellow if only fallback or aliases paid
    let severity: "ok" | "warn" | "alert";
    if (defaultIsPaid) {
      severity = "alert";
    } else if (anyFallbackPaid || aliasesPointingToPaid.length > 0) {
      severity = "warn";
    } else {
      severity = "ok";
    }

    const payload = {
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
      { error: "openclaw models status failed", detail: message },
      { status: 502 },
    );
  }
}
