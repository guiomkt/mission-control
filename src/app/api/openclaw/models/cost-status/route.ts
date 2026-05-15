/**
 * Cost-class status do default + fallback model do agente principal.
 * GET /api/openclaw/models/cost-status
 *
 * Le `openclaw models status`, parseia as linhas Default + Fallbacks, e
 * classifica cada modelo como OAuth (subscription) ou Paid (API key
 * pay-per-token).
 *
 * Cache: TTL 60s fresh, maxAge 300s stale-while-revalidate. Single-flight
 * pra evitar stampede (ver openclaw-cache.ts).
 *
 * Classificação:
 *  - openai-codex/*    → OAuth (ChatGPT Plus)
 *  - minimax-portal/*  → OAuth (Kimi/Moonshot Pro)
 *  - anthropic/*       → OAuth (Claude Pro via sk-ant-oat01-* tokens)
 *  - openai/*          → PAID (OPENAI_API_KEY)
 *  - google/*          → PAID (GEMINI_API_KEY)
 *  - deepseek/*, moonshot/*, perplexity/* → PAID
 */
import { NextResponse } from "next/server";
import { openclawExec, OpenClawExecError } from "@/lib/openclaw-exec";
import { stripAnsi } from "@/lib/oauth-profile-parser";
import { SingleFlightCache } from "@/lib/openclaw-cache";

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

const cache = new SingleFlightCache<unknown>({
  ttlMs: 60_000,
  maxAgeMs: 300_000,
});

export async function GET() {
  try {
    const payload = await cache.get(async () => {
      const result = await openclawExec(["models", "status"], {
        timeoutMs: 10_000,
      });
      const clean = stripAnsi(result.stdout + "\n" + result.stderr);

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

      const aliases: Array<{
        name: string;
        target: string;
        costClass: CostClass;
      }> = [];
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

      const defaultIsPaid = defaultCost === "paid";
      const anyFallbackPaid = fallbackCosts.some((f) => f.costClass === "paid");
      const aliasesPointingToPaid = aliases.filter(
        (a) => a.costClass === "paid",
      );

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
      { error: "openclaw models status failed", detail: message },
      { status: 502 },
    );
  }
}
