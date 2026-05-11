import { promises as fs } from 'fs';
import path from 'path';
import { OPENCLAW_DIR, OPENCLAW_WORKSPACE } from './paths';

/**
 * OpenClaw integration layer (Phase 2 — read-only file-based).
 *
 * The OpenClaw gateway is a WebSocket server with a token-authenticated SPA,
 * not a REST API. The CLI (`openclaw cron list --json` etc.) only runs inside
 * the gateway container. The tenacitOS upstream calls those CLIs via
 * `child_process.execSync` from the dashboard process, which only works when
 * the dashboard runs colocated with the gateway *and* with shell access — a
 * model we explicitly rejected in the PRD (R1/R2).
 *
 * The hardened panel runs in its own container with `OPENCLAW_DIR` mounted
 * **read-only**. This module reads the same files the gateway writes:
 *
 *   /data/.openclaw/
 *     openclaw.json                          ← global config
 *     crontab.txt                            ← supercronic schedule
 *     agents/<id>/agent/{auth,models}.json   ← per-agent config
 *     agents/<id>/sessions/sessions.json     ← active sessions index
 *     agents/<id>/sessions/<uuid>.jsonl      ← session message log
 *     workspace/                             ← curated markdown
 *
 * For health-style checks we fall back to the gateway HTTP endpoint, which
 * does respond to `/gateway/health` even though the rest of the surface is
 * the SPA.
 */

// ── Config ──────────────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || '';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');
const CONFIG_FILE = path.join(OPENCLAW_DIR, 'openclaw.json');
const CRONTAB_FILE = path.join(OPENCLAW_DIR, 'crontab.txt');

// ── Types ───────────────────────────────────────────────────────────────────

export interface OpenClawHealth {
  reachable: boolean;
  via: 'gateway-http' | 'filesystem' | 'none';
  detail?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  workspace: string;
  models: string[];
  hasAuth: boolean;
}

export interface SessionSummary {
  id: string;
  key: string;
  agentId: string;
  channel: string | null;
  updatedAt: number;
  ageMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  model: string | null;
  aborted: boolean;
}

export interface CronEntry {
  schedule: string;
  command: string;
  comment?: string;
  enabled: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// ── Health ──────────────────────────────────────────────────────────────────

/**
 * Lightweight health probe.
 *
 * Tries the gateway HTTP first if configured; falls back to checking that
 * the OPENCLAW_DIR is mounted and openclaw.json is readable.
 */
export async function getHealth(): Promise<OpenClawHealth> {
  if (GATEWAY_URL) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/gateway/health`, {
        headers: GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {},
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      // The gateway serves a SPA on /gateway/* but returns 200 only when up.
      if (res.ok) {
        return { reachable: true, via: 'gateway-http', detail: `HTTP ${res.status}` };
      }
      return { reachable: false, via: 'gateway-http', detail: `HTTP ${res.status}` };
    } catch (err) {
      // Fall through to filesystem check.
      console.error('[openclaw] gateway http probe failed:', err);
    }
  }

  if (await dirExists(OPENCLAW_DIR)) {
    const cfg = await readJson<unknown>(CONFIG_FILE);
    if (cfg) return { reachable: true, via: 'filesystem' };
    return { reachable: false, via: 'filesystem', detail: 'openclaw.json missing/unreadable' };
  }

  return { reachable: false, via: 'none', detail: `OPENCLAW_DIR=${OPENCLAW_DIR} not accessible` };
}

// ── Agents ──────────────────────────────────────────────────────────────────

/**
 * List agents by scanning `OPENCLAW_DIR/agents/<id>/`.
 */
export async function listAgents(): Promise<AgentSummary[]> {
  if (!(await dirExists(AGENTS_DIR))) return [];

  const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
  const config = await readJson<Record<string, unknown>>(CONFIG_FILE);
  const result: AgentSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const agentDir = path.join(AGENTS_DIR, id, 'agent');
    const models = await readJson<{ aliases?: Record<string, unknown> }>(
      path.join(agentDir, 'models.json'),
    );
    const auth = await readJson<unknown>(path.join(agentDir, 'auth.json')); // may be null

    // Pull display name from openclaw.json's agents.list if present.
    const listed = ((config?.agents as { list?: Array<{ id: string; name?: string }> })?.list ?? []).find(
      (a) => a.id === id,
    );

    result.push({
      id,
      name: listed?.name || id,
      workspace: path.join(OPENCLAW_WORKSPACE),
      models: Object.keys(models?.aliases ?? {}),
      hasAuth: !!auth,
    });
  }

  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

// ── Sessions ────────────────────────────────────────────────────────────────

interface RawSessionRecord {
  sessionId?: string;
  updatedAt?: number;
  abortedLastRun?: boolean;
  deliveryContext?: { channel?: string };
  lastChannel?: string;
  // Token counters are not always present; default to 0.
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  model?: string;
  modelProvider?: string;
}

/**
 * List sessions for one agent (default: "main") by parsing the
 * `sessions.json` index file.
 */
export async function listSessions(agentId = 'main'): Promise<SessionSummary[]> {
  const file = path.join(AGENTS_DIR, agentId, 'sessions', 'sessions.json');
  const raw = await readJson<Record<string, RawSessionRecord>>(file);
  if (!raw) return [];

  const now = Date.now();
  const out: SessionSummary[] = [];

  for (const [key, rec] of Object.entries(raw)) {
    const updatedAt = rec.updatedAt ?? 0;
    out.push({
      id: rec.sessionId ?? key,
      key,
      agentId,
      channel: rec.deliveryContext?.channel ?? rec.lastChannel ?? null,
      updatedAt,
      ageMs: updatedAt ? now - updatedAt : 0,
      inputTokens: rec.inputTokens ?? 0,
      outputTokens: rec.outputTokens ?? 0,
      totalTokens: rec.totalTokens ?? 0,
      contextTokens: rec.contextTokens ?? 0,
      model: rec.model ?? null,
      aborted: !!rec.abortedLastRun,
    });
  }

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

// ── Cron (supercronic) ──────────────────────────────────────────────────────

/**
 * Parse the supercronic crontab.txt the OpenClaw container ships with.
 *
 * Lines starting with `#` are comments (preserved as the "comment" for the
 * next entry). A bare schedule + command is treated as an enabled job; a
 * commented-out schedule is treated as a disabled job whose body we still
 * surface so operators can see what's paused.
 */
export async function listCrons(): Promise<CronEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(CRONTAB_FILE, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n');
  const out: CronEntry[] = [];
  let pendingComment = '';

  const schedRe = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingComment = '';
      continue;
    }

    if (trimmed.startsWith('#')) {
      // Heuristic: if a comment LOOKS like a disabled schedule line, surface it.
      const body = trimmed.replace(/^#\s*/, '');
      const match = body.match(schedRe);
      if (match) {
        out.push({
          schedule: match[1],
          command: match[2],
          comment: pendingComment || undefined,
          enabled: false,
        });
        pendingComment = '';
      } else {
        pendingComment = body;
      }
      continue;
    }

    const match = trimmed.match(schedRe);
    if (match) {
      out.push({
        schedule: match[1],
        command: match[2],
        comment: pendingComment || undefined,
        enabled: true,
      });
      pendingComment = '';
    }
  }

  return out;
}

// ── Channels (from openclaw.json) ───────────────────────────────────────────

export interface ChannelSummary {
  name: string;
  enabled: boolean;
  dmPolicy?: string;
  allowFromCount?: number;
}

export async function listChannels(): Promise<ChannelSummary[]> {
  const config = await readJson<{
    channels?: Record<
      string,
      { enabled?: boolean; dmPolicy?: string; allowFrom?: unknown[] }
    >;
  }>(CONFIG_FILE);
  if (!config?.channels) return [];
  return Object.entries(config.channels).map(([name, c]) => ({
    name,
    enabled: !!c.enabled,
    dmPolicy: c.dmPolicy,
    allowFromCount: Array.isArray(c.allowFrom) ? c.allowFrom.length : undefined,
  }));
}
