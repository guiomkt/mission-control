/**
 * Parser puro do output de `openclaw models auth list`.
 *
 * Formato observado (depois de strip de ANSI):
 *   - anthropic:manual [anthropic/token]
 *   - anthropic:oauth [anthropic/token; cooldown until 2026-03-12T15:02:03.267Z]
 *   - minimax-portal:default [minimax-portal/oauth; expires 2027-03-07T03:49:11.772Z]
 *   - nexos:default [nexos/api_key]
 *   - openai-codex:rafamriedel@gmail.com (rafamriedel@gmail.com) [openai-codex/oauth; expires 2026-05-24T10:00:04.338Z]
 *
 * Não toca em I/O — só transforma string → estrutura. Mantém o módulo
 * trivialmente testável (sem mocks).
 */

/** Catálogo de providers OAuth que reconhecemos. */
export const OAUTH_PROVIDERS = [
  {
    id: "anthropic",
    label: "Claude Pro/Max",
    brand: "Anthropic",
    reconnectMethod: "oauth",
  },
  {
    id: "openai-codex",
    label: "ChatGPT Plus / Pro",
    brand: "OpenAI",
    reconnectMethod: "oauth",
  },
  {
    id: "google",
    label: "Gemini Advanced",
    brand: "Google",
    reconnectMethod: "oauth",
  },
  {
    id: "minimax-portal",
    label: "Kimi / Moonshot Pro",
    brand: "Minimax",
    reconnectMethod: "oauth",
  },
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]["id"];

export interface ParsedAuthProfile {
  /** Profile key, e.g. "anthropic:oauth" or "openai-codex:user@example.com". */
  key: string;
  /** Optional human label parsed from "(...)", e.g. an email. */
  label?: string;
  /** Provider id like "anthropic", "openai-codex". */
  providerId: string;
  /** Auth type: oauth, token, api_key, etc. */
  type: "oauth" | "token" | "api_key" | "other";
  /** ISO datetime if profile has an explicit expiry. */
  expiresAt?: string;
  /** ISO datetime if provider is in cooldown after repeated failures. */
  cooldownUntil?: string;
  /** Free-form status detail string from the bracket. */
  statusDetail?: string;
}

/**
 * Remove sequências ANSI/control que o CLI da OpenClaw usa pra colorir
 * e posicionar cursor. Cobre as variantes que apareceram em testes:
 *   - CSI sequences: ESC [ ... letter
 *   - OSC sequences: ESC ] ... BEL / ESC \
 *   - Erase / cursor positioning
 *
 * Mantém só caracteres imprimíveis + \n, \r, \t.
 */
export function stripAnsi(input: string): string {
  // CSI: ESC [ ... final-byte (qualquer ASCII 0x40-0x7E)
  const csi = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  // OSC: ESC ] ... BEL ou ESC \
  const osc = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
  // Outros singletons (ESC + 1 char)
  const other = /\x1b[NOPX^_`a-zA-Z=>]/g;

  return input
    .replace(csi, "")
    .replace(osc, "")
    .replace(other, "")
    // ASCII control chars exceto whitespace comum
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/**
 * Parseia uma linha individual. Retorna null se a linha não bate com o
 * formato `- <key>[ (<label>)] [<provider>/<type>[; <status>]]`.
 */
export function parseProfileLine(line: string): ParsedAuthProfile | null {
  // Trim leading bullet/whitespace
  const trimmed = line.replace(/^\s*-\s+/, "").trim();
  if (!trimmed) return null;

  // Regex anchored to the bracket — tudo antes do `[` é key (+ opcional `(label)`)
  // tudo dentro do `[` é metadata `provider/type[; status]`.
  // Grupos posicionais (named groups exigem ES2018+ no TS target).
  //   1: key
  //   2: label (opcional)
  //   3: provider id
  //   4: type
  //   5: status detail (opcional)
  const match = trimmed.match(
    /^([^\s[(]+)(?:\s*\(([^)]+)\))?\s*\[([^/\]]+)\/([^;\]]+)(?:;\s*([^\]]+))?\]\s*$/,
  );
  if (!match) return null;

  const [, key, label, provider, type, status] = match;

  const out: ParsedAuthProfile = {
    key: key.trim(),
    providerId: provider.trim(),
    type: normalizeType(type.trim()),
  };
  if (label) out.label = label.trim();

  if (status) {
    out.statusDetail = status.trim();
    const expiresMatch = status.match(
      /expires?\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/i,
    );
    if (expiresMatch) out.expiresAt = expiresMatch[1];

    const cooldownMatch = status.match(
      /cooldown\s+until\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/i,
    );
    if (cooldownMatch) out.cooldownUntil = cooldownMatch[1];
  }

  return out;
}

function normalizeType(raw: string): ParsedAuthProfile["type"] {
  const v = raw.toLowerCase();
  if (v === "oauth") return "oauth";
  if (v === "token") return "token";
  if (v === "api_key" || v === "apikey") return "api_key";
  return "other";
}

/**
 * Parseia o output inteiro de `openclaw models auth list`. Ignora
 * warnings de config, header de "Profiles:" e qualquer linha que não
 * comece com `- `.
 */
export function parseAuthList(rawOutput: string): ParsedAuthProfile[] {
  const clean = stripAnsi(rawOutput);
  const results: ParsedAuthProfile[] = [];
  for (const line of clean.split(/\r?\n/)) {
    // Linhas de profile sempre começam com "- " depois do "Profiles:" header
    if (!/^\s*-\s+\S/.test(line)) continue;
    const parsed = parseProfileLine(line);
    if (parsed) results.push(parsed);
  }
  return results;
}

// ── Status derivado ──────────────────────────────────────────────────────

export type ProfileHealth =
  | "active"
  | "expiring-soon" // <14 dias
  | "expiring-urgent" // <3 dias
  | "expired"
  | "cooldown"
  | "no-expiry"; // tokens/api_key sem prazo

export interface AnnotatedProfile extends ParsedAuthProfile {
  health: ProfileHealth;
  /** Dias restantes (negativo = já expirou). null se não tem expiry. */
  daysRemaining: number | null;
  /** Provider catálogo, se reconhecido. */
  catalogEntry?: (typeof OAUTH_PROVIDERS)[number];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function annotateProfile(
  profile: ParsedAuthProfile,
  now: Date = new Date(),
): AnnotatedProfile {
  const nowMs = now.getTime();
  const catalogEntry = OAUTH_PROVIDERS.find(
    (p) => p.id === profile.providerId,
  );

  let health: ProfileHealth = "no-expiry";
  let daysRemaining: number | null = null;

  if (profile.cooldownUntil) {
    const cd = new Date(profile.cooldownUntil).getTime();
    if (cd > nowMs) {
      health = "cooldown";
      daysRemaining = Math.ceil((cd - nowMs) / DAY_MS);
    }
  }

  if (profile.expiresAt) {
    const exp = new Date(profile.expiresAt).getTime();
    daysRemaining = Math.ceil((exp - nowMs) / DAY_MS);
    if (daysRemaining < 0) {
      health = "expired";
    } else if (daysRemaining <= 3) {
      health = "expiring-urgent";
    } else if (daysRemaining <= 14) {
      health = "expiring-soon";
    } else if (health !== "cooldown") {
      health = "active";
    }
  } else if (profile.type !== "oauth" && health !== "cooldown") {
    health = "no-expiry";
  }

  return { ...profile, health, daysRemaining, catalogEntry };
}

/**
 * Constrói o snapshot final pra UI: catalogados (OAuth conhecidos)
 * com profile se conectado, e providers sem profile listados como
 * "não conectado".
 */
export interface OAuthSnapshotProvider {
  catalogEntry: (typeof OAUTH_PROVIDERS)[number];
  /** Todos os profiles ligados a esse provider (pode ser 0+, raramente >1). */
  profiles: AnnotatedProfile[];
}

export interface OAuthSnapshot {
  /** Apenas providers OAuth do nosso catálogo. */
  providers: OAuthSnapshotProvider[];
  /** Profiles que apareceram no `list` mas não estão no catálogo (raros). */
  otherProfiles: AnnotatedProfile[];
}

export function buildSnapshot(
  rawOutput: string,
  now: Date = new Date(),
): OAuthSnapshot {
  const parsed = parseAuthList(rawOutput);
  const annotated = parsed.map((p) => annotateProfile(p, now));

  const providers: OAuthSnapshotProvider[] = OAUTH_PROVIDERS.map((entry) => ({
    catalogEntry: entry,
    profiles: annotated.filter((p) => p.providerId === entry.id),
  }));

  const knownIds = new Set<string>(OAUTH_PROVIDERS.map((p) => p.id));
  const otherProfiles = annotated.filter((p) => !knownIds.has(p.providerId));

  return { providers, otherProfiles };
}

/**
 * Gera o comando de reconect/connect pra um provider. Mantemos a linha
 * exata que o operador pode colar no terminal local.
 */
export function buildReconnectCommand(
  providerId: string,
  method = "oauth",
): string {
  // Aspas escapadas — o comando vai aparecer em UI tipo:
  //   ssh hostinger 'docker exec -it openclaw-kozw-openclaw-1 openclaw models auth login --provider anthropic --method oauth'
  return `ssh hostinger 'docker exec -it openclaw-kozw-openclaw-1 openclaw models auth login --provider ${providerId} --method ${method}'`;
}
