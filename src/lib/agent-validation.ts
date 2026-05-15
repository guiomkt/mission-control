/**
 * Validação de inputs pra agentes — separado pra ser facilmente testável
 * e reutilizável entre endpoints (POST, PUT, DELETE) e formulários.
 *
 * O id de agente é o "slug" usado em URL, filesystem e CLI. Tem que:
 *  - Começar com letra (não dígito nem hífen)
 *  - Conter só [a-z0-9-]
 *  - 1 a 40 chars (mais que isso fica feio em paths)
 *  - Não ser um reservado ("main" só lê, "defaults" colide com config global)
 */

const ID_REGEX = /^[a-z][a-z0-9-]{0,39}$/;

/** Ids reservados do OpenClaw que o operador não deve poder criar/sobrescrever. */
export const RESERVED_AGENT_IDS = new Set<string>([
  "main", // o agente padrão; sempre existe e não pode ser apagado
  "defaults", // colide com agents.defaults na config
]);

export interface AgentIdValidation {
  ok: boolean;
  /** Mensagem em PT-BR amigável pra UI exibir se ok=false. */
  reason?: string;
}

export function validateAgentId(id: unknown): AgentIdValidation {
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "ID é obrigatório." };
  }
  if (!ID_REGEX.test(id)) {
    return {
      ok: false,
      reason:
        "ID deve começar com letra minúscula e conter só letras minúsculas, dígitos e hífen (max 40 chars).",
    };
  }
  if (RESERVED_AGENT_IDS.has(id)) {
    return {
      ok: false,
      reason: `"${id}" é um ID reservado do OpenClaw — escolha outro.`,
    };
  }
  return { ok: true };
}

/** Sanidade no nome amigável (mostrado na UI). Apenas trim + length cap. */
export function validateAgentName(name: unknown): AgentIdValidation {
  if (name === undefined || name === null) return { ok: true };
  if (typeof name !== "string") {
    return { ok: false, reason: "Nome deve ser texto." };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: true };
  if (trimmed.length > 80) {
    return { ok: false, reason: "Nome muito longo (max 80 chars)." };
  }
  return { ok: true };
}

/** Emoji é simplesmente o primeiro grapheme — não tentamos validar profundamente. */
export function normalizeAgentEmoji(emoji: unknown): string | undefined {
  if (typeof emoji !== "string") return undefined;
  const trimmed = emoji.trim();
  if (trimmed.length === 0) return undefined;
  // Cap em 8 chars pra cobrir até emojis ZWJ-sequence longos.
  return trimmed.slice(0, 8);
}

/** Theme é livre — provavelmente um nome de cor ou paleta. Cap em 40 chars. */
export function normalizeAgentTheme(theme: unknown): string | undefined {
  if (typeof theme !== "string") return undefined;
  const trimmed = theme.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 40) return undefined;
  return trimmed;
}

/**
 * Convenção de workspace path. O `main` tem workspace `/data/.openclaw/workspace`
 * sem sufixo (legacy). Novos agentes seguem `workspace-<id>`.
 */
export function workspacePathFor(id: string): string {
  if (id === "main") return "/data/.openclaw/workspace";
  return `/data/.openclaw/workspace-${id}`;
}
