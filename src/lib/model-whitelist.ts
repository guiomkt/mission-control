/**
 * Whitelist de modelos OAuth-only que o painel aceita configurar.
 *
 * **Por quê:** o operador deixou explícito que não pode rodar IA via API
 * paga ("eu estou usando somente IA via OAUTH... nao posso de forma
 * alguma usar alguma IA via api paga"). O cost-class banner já monitora
 * mudanças runtime, mas a UI de model swap PRECISA filtrar no fonte
 * pra não oferecer modelos pagos como opção.
 *
 * Classificação:
 *  - **OAuth (safe)**: `openai-codex/*` (ChatGPT plus/team), `minimax-portal/*`,
 *    `anthropic/*` quando o token começa com `sk-ant-oat01-*` (Claude
 *     Code subscription).
 *  - **PAID (blocked)**: `openai/*` (direct API), `google/*`, `deepseek/*`,
 *    `moonshot/*`, `perplexity/*`, qualquer coisa que não case com OAuth.
 *
 * Se o ClawHub registrar um modelo OAuth novo, basta adicionar o prefix
 * aqui — sem precisar editar o caller.
 */

/** Prefixos de provider/slug que SÃO OAuth (não cobrados por token). */
const OAUTH_PROVIDER_PREFIXES = [
  "openai-codex/",
  "minimax-portal/",
] as const;

/**
 * Modelos OAuth com label legível. Ordem importa — primeiro = default
 * sugerido na UI.
 */
export const OAUTH_MODELS = [
  {
    value: "openai-codex/gpt-5.4",
    label: "ChatGPT 5.4 (OAuth) — recomendado",
    recommended: true,
  },
  { value: "openai-codex/gpt-5.4-pro", label: "ChatGPT 5.4 Pro (OAuth)" },
  { value: "openai-codex/gpt-5.2", label: "ChatGPT 5.2 (OAuth)" },
  {
    value: "openai-codex/gpt-5.1-codex-max",
    label: "ChatGPT 5.1 Codex Max (OAuth)",
  },
  {
    value: "minimax-portal/MiniMax-M2.7",
    label: "Minimax M2.7 (OAuth — fallback)",
  },
] as const;

export type OAuthModelValue = (typeof OAUTH_MODELS)[number]["value"];

export function isOAuthModel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return OAUTH_PROVIDER_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Validação que retorna mensagem amigável + safe flag.
 * Usado nos routes pra rejeitar com 400 quando tentam setar modelo pago.
 */
export function validateModelValue(value: unknown): {
  ok: boolean;
  reason?: string;
  pricingClass: "oauth" | "paid" | "unknown";
} {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      ok: false,
      reason: "model deve ser uma string não-vazia",
      pricingClass: "unknown",
    };
  }
  const trimmed = value.trim();
  if (isOAuthModel(trimmed)) {
    return { ok: true, pricingClass: "oauth" };
  }
  // Algo formato `provider/slug` que NÃO é OAuth = paid (ou unknown).
  if (/\//.test(trimmed)) {
    return {
      ok: false,
      reason: `Modelo "${trimmed}" não é OAuth. Use um dos modelos OAuth permitidos (ex: openai-codex/gpt-5.4).`,
      pricingClass: "paid",
    };
  }
  return {
    ok: false,
    reason: `Formato inválido — esperado "provider/slug" (ex: openai-codex/gpt-5.4).`,
    pricingClass: "unknown",
  };
}
