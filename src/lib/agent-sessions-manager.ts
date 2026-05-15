/**
 * Sessions per-agent — list, read transcript, delete, aggregate usage.
 *
 * Layout (no painel, mounted RO em /workspace):
 *   /workspace/agents/<id>/sessions/sessions.json   ← index rico
 *   /workspace/agents/<id>/sessions/<uuid>.jsonl    ← transcript completo
 *   /workspace/agents/<id>/sessions/<uuid>.trajectory.jsonl  ← tool trace (opcional)
 *
 * Layout no kozw (RW): /data/.openclaw/agents/<id>/sessions/...
 *
 * Decisões:
 *  - Read = filesystem direto (mount RO). Streamed line-by-line pra
 *    arquivos grandes (alguns são 2MB+).
 *  - List = parse de sessions.json. Mais rico que `openclaw sessions
 *    --json` (que filtra/agrega) e mais barato (sem CLI spawn).
 *  - Delete = soft (rename pra `.deleted.<ts>` + remove entry no
 *    sessions.json), mesmo pattern do openclaw cleanup interno. Via
 *    docker exec --user node no kozw.
 *  - Usage = aggregate em memória, capa de 1000 sessions (mais que isso
 *    a UI já vai paginar).
 */
import { promises as fs } from "fs";
import { spawn } from "child_process";
import path from "path";
import { OPENCLAW_DIR } from "@/lib/paths";

const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";
const MAX_TRANSCRIPT_LINES = 10_000;
const MAX_USAGE_SESSIONS = 1_000;

// Session IDs são UUIDs do gateway. Validação rigorosa pra evitar
// path traversal.
const SESSION_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_REGEX.test(value);
}

export class SessionsError extends Error {
  constructor(
    message: string,
    public readonly stdout: string = "",
    public readonly stderr: string = "",
  ) {
    super(message);
    this.name = "SessionsError";
  }
}

// ── Paths ────────────────────────────────────────────────────────────────

function panelSessionsDir(agentId: string): string {
  return path.join(OPENCLAW_DIR, "agents", agentId, "sessions");
}

function panelSessionsIndex(agentId: string): string {
  return path.join(panelSessionsDir(agentId), "sessions.json");
}

function kozwSessionsDir(agentId: string): string {
  return `/data/.openclaw/agents/${agentId}/sessions`;
}

// ── Types (shape derivado do sessions.json real) ────────────────────────

export interface RawSessionEntry {
  key?: string;
  sessionId?: string;
  sessionFile?: string;
  updatedAt?: number;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  status?: string;
  abortedLastRun?: boolean;
  // Tokens + cost
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  estimatedCostUsd?: number;
  // Model
  model?: string;
  modelProvider?: string;
  // Channel
  channel?: string;
  chatType?: string;
  groupId?: string;
  subject?: string;
  displayName?: string;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  deliveryContext?: {
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: number;
  };
  // Misc
  kind?: string;
  origin?: { label?: string; provider?: string; chatType?: string };
}

export interface SessionListItem {
  key: string;
  sessionId: string;
  agentId: string;
  /** Timestamps em ms. */
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  ageMs: number;
  status?: string;
  aborted: boolean;
  // Tokens
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  cacheRead: number;
  cacheWrite: number;
  estimatedCostUsd: number;
  // Model
  model: string | null;
  modelProvider: string | null;
  // Channel
  channel: string | null;
  chatType: string | null;
  subject: string | null;
  displayName: string | null;
  kind: string | null;
}

function normalize(
  agentId: string,
  key: string,
  raw: RawSessionEntry,
  now: number,
): SessionListItem {
  const updatedAt = raw.updatedAt ?? 0;
  return {
    key,
    sessionId: raw.sessionId ?? key,
    agentId,
    updatedAt,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    runtimeMs: raw.runtimeMs,
    ageMs: updatedAt ? now - updatedAt : 0,
    status: raw.status,
    aborted: !!raw.abortedLastRun,
    inputTokens: raw.inputTokens ?? 0,
    outputTokens: raw.outputTokens ?? 0,
    totalTokens: raw.totalTokens ?? 0,
    contextTokens: raw.contextTokens ?? 0,
    cacheRead: raw.cacheRead ?? 0,
    cacheWrite: raw.cacheWrite ?? 0,
    estimatedCostUsd: raw.estimatedCostUsd ?? 0,
    model: raw.model ?? null,
    modelProvider: raw.modelProvider ?? null,
    channel: raw.channel ?? raw.deliveryContext?.channel ?? raw.lastChannel ?? null,
    chatType: raw.chatType ?? raw.origin?.chatType ?? null,
    subject: raw.subject ?? null,
    displayName: raw.displayName ?? null,
    kind: raw.kind ?? null,
  };
}

async function readIndex(agentId: string): Promise<Record<string, RawSessionEntry>> {
  try {
    const raw = await fs.readFile(panelSessionsIndex(agentId), "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, RawSessionEntry>)
      : {};
  } catch {
    return {};
  }
}

// ── List ─────────────────────────────────────────────────────────────────

export interface ListFilters {
  limit?: number;
  before?: number;
  channel?: string;
  kind?: string;
}

export interface ListResult {
  total: number;
  filtered: number;
  hasMore: boolean;
  items: SessionListItem[];
}

export async function listAgentSessions(
  agentId: string,
  filters: ListFilters = {},
): Promise<ListResult> {
  const index = await readIndex(agentId);
  const now = Date.now();
  const all = Object.entries(index).map(([key, raw]) =>
    normalize(agentId, key, raw, now),
  );
  const total = all.length;

  let filtered = all;
  if (filters.channel) {
    filtered = filtered.filter((s) => s.channel === filters.channel);
  }
  if (filters.kind) {
    filtered = filtered.filter((s) => s.kind === filters.kind);
  }
  if (filters.before) {
    filtered = filtered.filter((s) => s.updatedAt < filters.before!);
  }

  filtered.sort((a, b) => b.updatedAt - a.updatedAt);

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const slice = filtered.slice(0, limit);

  return {
    total,
    filtered: filtered.length,
    hasMore: filtered.length > limit,
    items: slice,
  };
}

// ── Detail (transcript) ──────────────────────────────────────────────────

export interface TranscriptLine {
  lineNumber: number;
  /** Conteúdo bruto da linha (JSONL parseado se válido, senão string). */
  data: unknown;
  raw?: string;
}

export interface DetailResult {
  entry: SessionListItem | null;
  /** Bytes + line count da transcript file. */
  transcriptBytes: number;
  transcriptLines: number;
  /** Linhas carregadas. */
  lines: TranscriptLine[];
  /** True se truncou (mais linhas além do solicitado). */
  truncated: boolean;
}

async function findTranscriptFile(
  agentId: string,
  sessionId: string,
  hintPath?: string,
): Promise<string | null> {
  // Sessions.json às vezes guarda o `sessionFile` absoluto, com sufixo
  // como `-topic-4.jsonl`. Tentamos:
  //   1. O caminho hint, se vier
  //   2. <sessionId>.jsonl (caso comum)
  //   3. Glob por <sessionId>*.jsonl
  const dir = panelSessionsDir(agentId);
  if (hintPath) {
    // O hint é um path no kozw (/data/...) — converte pro mount do painel.
    const relative = hintPath.replace(
      /^\/data\/\.openclaw\//,
      "",
    );
    const candidate = path.join(OPENCLAW_DIR, relative);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continua
    }
  }
  const direct = path.join(dir, `${sessionId}.jsonl`);
  try {
    await fs.access(direct);
    return direct;
  } catch {
    // glob
  }
  try {
    const entries = await fs.readdir(dir);
    const match = entries.find(
      (n) => n.startsWith(sessionId) && n.endsWith(".jsonl") && !n.includes(".deleted."),
    );
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

export interface DetailOptions {
  offset?: number;
  lines?: number;
}

export async function readSessionDetail(
  agentId: string,
  sessionId: string,
  options: DetailOptions = {},
): Promise<DetailResult> {
  if (!isValidSessionId(sessionId)) {
    throw new SessionsError(`invalid sessionId: ${sessionId}`);
  }

  const index = await readIndex(agentId);
  const matchedKey = Object.keys(index).find(
    (k) => (index[k].sessionId ?? k) === sessionId || k === sessionId,
  );
  const rawEntry = matchedKey ? index[matchedKey] : null;
  const entry = rawEntry
    ? normalize(agentId, matchedKey!, rawEntry, Date.now())
    : null;

  const transcriptPath = await findTranscriptFile(
    agentId,
    sessionId,
    rawEntry?.sessionFile,
  );

  if (!transcriptPath) {
    return {
      entry,
      transcriptBytes: 0,
      transcriptLines: 0,
      lines: [],
      truncated: false,
    };
  }

  const stat = await fs.stat(transcriptPath);
  const transcriptBytes = stat.size;

  // Leitura completa pra pegar contagem de linhas. Cap rígido em
  // MAX_TRANSCRIPT_LINES — se passar disso, paginamos.
  // (Streaming line-by-line evitaria carregar tudo, mas o operador
  // tipicamente lê a sessão inteira, então fs.readFile é mais simples.)
  const raw = await fs.readFile(transcriptPath, "utf-8");
  const allLines = raw.split("\n").filter((l) => l.length > 0);
  const transcriptLines = allLines.length;

  const offset = Math.max(options.offset ?? 0, 0);
  const wanted = Math.min(
    Math.max(options.lines ?? MAX_TRANSCRIPT_LINES, 1),
    MAX_TRANSCRIPT_LINES,
  );

  const slice = allLines.slice(offset, offset + wanted);
  const lines: TranscriptLine[] = slice.map((line, idx) => {
    try {
      return {
        lineNumber: offset + idx,
        data: JSON.parse(line),
      };
    } catch {
      return {
        lineNumber: offset + idx,
        data: null,
        raw: line,
      };
    }
  });

  return {
    entry,
    transcriptBytes,
    transcriptLines,
    lines,
    truncated: offset + slice.length < transcriptLines,
  };
}

// ── Delete (soft) ────────────────────────────────────────────────────────

export interface DeleteResult {
  sessionId: string;
  agentId: string;
  /** "removed" | "not_present" */
  status: "removed" | "not_present";
  renamedTo?: string;
  rawOutput: string;
}

function dockerExec(
  args: string[],
  options: { timeoutMs?: number; stdin?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, {
      stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(
        new SessionsError(
          `docker timed out after ${timeoutMs}ms`,
          stdout,
          stderr,
        ),
      );
    }, timeoutMs);
    proc.stdout!.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SessionsError(`spawn failed: ${err.message}`, stdout, stderr));
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (options.stdin !== undefined) {
      proc.stdin!.write(options.stdin);
      proc.stdin!.end();
    }
  });
}

/**
 * Soft-delete: rename JSONL pra .deleted.<ts> + remove entry no
 * sessions.json. Idempotente: se não existe, retorna "not_present".
 */
export async function deleteSession(
  agentId: string,
  sessionId: string,
): Promise<DeleteResult> {
  if (!isValidSessionId(sessionId)) {
    throw new SessionsError(`invalid sessionId: ${sessionId}`);
  }
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(agentId) && agentId !== "main") {
    throw new SessionsError(`invalid agentId: ${agentId}`);
  }

  const dir = kozwSessionsDir(agentId);
  const py = `
import json, os, sys, time

agent_id = sys.argv[1]
session_id = sys.argv[2]
ws_dir = sys.argv[3]
index_file = os.path.join(ws_dir, 'sessions.json')

# 1. Encontra o arquivo .jsonl (pode ter sufixos como "-topic-4")
found = None
if os.path.isdir(ws_dir):
    for name in os.listdir(ws_dir):
        if name.startswith(session_id) and name.endswith('.jsonl') and '.deleted.' not in name:
            found = os.path.join(ws_dir, name)
            break

# 2. Remove entries no sessions.json que tem esse sessionId
removed_keys = []
if os.path.exists(index_file):
    with open(index_file) as f:
        idx = json.load(f)
    if isinstance(idx, dict):
        for key in list(idx.keys()):
            entry = idx[key]
            sid = entry.get('sessionId') if isinstance(entry, dict) else None
            if sid == session_id or key == session_id:
                removed_keys.append(key)
                del idx[key]
        if removed_keys:
            with open(index_file, 'w') as f:
                json.dump(idx, f, indent=2)

if not found and not removed_keys:
    print(json.dumps({'status': 'not_present'}))
    sys.exit(0)

# 3. Rename JSONL pra .deleted.<ts>
renamed_to = None
if found:
    ts = time.strftime('%Y-%m-%dT%H-%M-%S.%f', time.gmtime())[:23] + 'Z'
    target = found + '.deleted.' + ts
    os.rename(found, target)
    renamed_to = os.path.basename(target)

print(json.dumps({
  'status': 'removed',
  'removedKeys': removed_keys,
  'renamedTo': renamed_to
}))
`;

  const result = await dockerExec(
    [
      "exec",
      "--user",
      "node",
      "-i",
      KOZW_CONTAINER,
      "python3",
      "-c",
      py,
      agentId,
      sessionId,
      dir,
    ],
    { timeoutMs: 20_000 },
  );

  if (result.code !== 0) {
    throw new SessionsError(
      `session delete failed (exit ${result.code})`,
      result.stdout,
      result.stderr,
    );
  }

  let parsed: { status: string; renamedTo?: string; removedKeys?: string[] };
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    throw new SessionsError(
      "could not parse delete output",
      result.stdout,
      result.stderr,
    );
  }

  return {
    sessionId,
    agentId,
    status: parsed.status as DeleteResult["status"],
    renamedTo: parsed.renamedTo,
    rawOutput: result.stdout.trim(),
  };
}

// ── Usage analytics ──────────────────────────────────────────────────────

export interface UsageStats {
  count: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  errorCount: number;
  errorRate: number;
  /** Stats por model. */
  byModel: Array<{
    model: string;
    count: number;
    cost: number;
    tokens: number;
  }>;
  /** Stats por channel. */
  byChannel: Array<{
    channel: string;
    count: number;
    cost: number;
  }>;
  /** Stats por kind (cron / direct / heartbeat). */
  byKind: Array<{
    kind: string;
    count: number;
    cost: number;
  }>;
  /** Mais antigo / mais recente. */
  oldestUpdatedAt: number | null;
  latestUpdatedAt: number | null;
  /** Sessions desde quando? (cap em MAX_USAGE_SESSIONS) */
  windowSize: number;
  capped: boolean;
}

export async function computeUsage(agentId: string): Promise<UsageStats> {
  const index = await readIndex(agentId);
  const entries = Object.entries(index);

  const sortedKeys = entries
    .map(([k, v]) => ({ k, ts: v.updatedAt ?? 0 }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_USAGE_SESSIONS)
    .map((x) => x.k);

  const sampled = sortedKeys.map((k) => index[k]);
  const capped = entries.length > MAX_USAGE_SESSIONS;

  const stats: UsageStats = {
    count: sampled.length,
    totalCost: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    errorCount: 0,
    errorRate: 0,
    byModel: [],
    byChannel: [],
    byKind: [],
    oldestUpdatedAt: null,
    latestUpdatedAt: null,
    windowSize: sampled.length,
    capped,
  };

  const modelMap = new Map<string, { count: number; cost: number; tokens: number }>();
  const channelMap = new Map<string, { count: number; cost: number }>();
  const kindMap = new Map<string, { count: number; cost: number }>();

  for (const e of sampled) {
    const cost = e.estimatedCostUsd ?? 0;
    const tokens = e.totalTokens ?? 0;
    stats.totalCost += cost;
    stats.totalTokens += tokens;
    stats.totalInputTokens += e.inputTokens ?? 0;
    stats.totalOutputTokens += e.outputTokens ?? 0;
    stats.totalCacheRead += e.cacheRead ?? 0;
    stats.totalCacheWrite += e.cacheWrite ?? 0;
    if (e.abortedLastRun) stats.errorCount += 1;
    const updated = e.updatedAt ?? 0;
    if (updated > 0) {
      stats.latestUpdatedAt = Math.max(stats.latestUpdatedAt ?? 0, updated);
      stats.oldestUpdatedAt =
        stats.oldestUpdatedAt === null
          ? updated
          : Math.min(stats.oldestUpdatedAt, updated);
    }

    const model = e.model ?? "—";
    const m = modelMap.get(model) ?? { count: 0, cost: 0, tokens: 0 };
    m.count += 1;
    m.cost += cost;
    m.tokens += tokens;
    modelMap.set(model, m);

    const channel = e.channel ?? e.deliveryContext?.channel ?? e.lastChannel ?? "—";
    const c = channelMap.get(channel) ?? { count: 0, cost: 0 };
    c.count += 1;
    c.cost += cost;
    channelMap.set(channel, c);

    const kind = e.kind ?? "—";
    const k = kindMap.get(kind) ?? { count: 0, cost: 0 };
    k.count += 1;
    k.cost += cost;
    kindMap.set(kind, k);
  }

  stats.errorRate = sampled.length ? stats.errorCount / sampled.length : 0;
  stats.byModel = [...modelMap.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost);
  stats.byChannel = [...channelMap.entries()]
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.count - a.count);
  stats.byKind = [...kindMap.entries()]
    .map(([kind, v]) => ({ kind, ...v }))
    .sort((a, b) => b.count - a.count);

  return stats;
}
