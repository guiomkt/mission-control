import { listAgents, listSessions } from './openclaw-client';
import type { Activity } from './activities-db';

/**
 * Synthesize "activities" from the live OpenClaw state.
 *
 * The panel's own SQLite (`activities-db`) only records what the panel
 * itself does (login, download, etc.) — a fresh install therefore shows
 * an empty Dashboard. The real signal lives in the OpenClaw container's
 * sessions.json files: one record per chat / cron / subagent session,
 * with token counts and abortion state already tracked.
 *
 * We project those into the same `Activity` shape the UI consumes so
 * the Dashboard / Activity Feed / stats can blend "panel actions" with
 * "agent activity" without two separate widgets.
 *
 * Cost: O(agents × sessions). For the current deployment that's <100
 * total entries; cached at the request level (no separate memoisation).
 */

function inferType(key: string): string {
  // key shape: agent:<agentId>:main | cron:<id> | subagent:<id> | <channel>:<chatId>
  const parts = key.split(':');
  const kind = parts[2];
  if (kind === 'main') return 'message';
  if (kind === 'cron') return 'cron';
  if (kind === 'subagent') return 'command';
  return 'message';
}

function describe(agentId: string, key: string, channel: string | null): string {
  const parts = key.split(':');
  const kind = parts[2];
  if (kind === 'main') return `Main session — ${agentId}`;
  if (kind === 'cron') {
    const cronId = parts[3] ?? 'unknown';
    return `Cron run — ${agentId} · job \`${cronId.slice(0, 8)}\``;
  }
  if (kind === 'subagent') {
    return `Sub-agent — ${parts[3] ?? 'unknown'} on ${agentId}`;
  }
  if (channel) return `${channel} message — ${agentId}`;
  return `Session — ${agentId}`;
}

export interface GetOpenClawActivitiesOpts {
  /** Max entries to return. Default 200. */
  limit?: number;
  /** Restrict to one type (message / cron / command). */
  type?: string;
  /** Restrict to one agent id. */
  agent?: string;
  /** ISO date (inclusive) — sessions older than this dropped. */
  startDate?: string;
  /** ISO date (inclusive) — sessions newer than this dropped. */
  endDate?: string;
}

/**
 * Build the synthetic activity list. Runs across every agent in the
 * workspace and merges their sessions.json contents.
 */
export async function getOpenClawActivities(
  opts: GetOpenClawActivitiesOpts = {},
): Promise<Activity[]> {
  const agents = await listAgents();
  const all: Activity[] = [];

  for (const agent of agents) {
    if (opts.agent && agent.id !== opts.agent) continue;
    const sessions = await listSessions(agent.id);

    for (const s of sessions) {
      // Run-entries are duplicates of their parent cron session.
      if (s.key.includes(':run:')) continue;

      const timestamp = new Date(s.updatedAt || Date.now()).toISOString();
      const type = inferType(s.key);

      if (opts.type && opts.type !== 'all' && opts.type !== type) continue;
      if (opts.startDate && timestamp < opts.startDate) continue;
      if (opts.endDate && timestamp > opts.endDate) continue;

      all.push({
        id: `oc-${agent.id}-${s.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        timestamp,
        type,
        description: describe(agent.id, s.key, s.channel),
        status: s.aborted ? 'error' : 'success',
        duration_ms: null,
        tokens_used: s.totalTokens || null,
        agent: agent.id,
        metadata: {
          source: 'openclaw',
          sessionKey: s.key,
          model: s.model,
          contextTokens: s.contextTokens,
        },
      });
    }
  }

  all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return all.slice(0, opts.limit ?? 200);
}

/** Pre-aggregated counts for the dashboard cards. */
export interface OpenClawActivityStats {
  total: number;
  today: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  /** [{ day: 'YYYY-MM-DD', count: N }] for the past 365 days */
  heatmap: Array<{ day: string; count: number }>;
  /** Last 7 days, newest first */
  trend: Array<{ day: string; count: number; success: number; errors: number }>;
  /** Hour-of-day distribution over the past 30 days */
  hourly: Array<{ hour: string; count: number }>;
}

export async function getOpenClawActivityStats(): Promise<OpenClawActivityStats> {
  const activities = await getOpenClawActivities({ limit: 10_000 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const heatmapMap = new Map<string, number>();
  const trendMap = new Map<string, { count: number; success: number; errors: number }>();
  const hourlyMap = new Map<string, number>();
  let todayCount = 0;

  for (const a of activities) {
    byType[a.type] = (byType[a.type] ?? 0) + 1;
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    if (a.timestamp >= todayIso) todayCount++;

    const ts = new Date(a.timestamp);
    if (ts >= oneYearAgo) {
      const day = a.timestamp.slice(0, 10);
      heatmapMap.set(day, (heatmapMap.get(day) ?? 0) + 1);
    }
    if (ts >= sevenDaysAgo) {
      const day = a.timestamp.slice(0, 10);
      const cur = trendMap.get(day) ?? { count: 0, success: 0, errors: 0 };
      cur.count++;
      if (a.status === 'success') cur.success++;
      if (a.status === 'error') cur.errors++;
      trendMap.set(day, cur);
    }
    if (ts >= thirtyDaysAgo) {
      const hour = String(ts.getHours()).padStart(2, '0');
      hourlyMap.set(hour, (hourlyMap.get(hour) ?? 0) + 1);
    }
  }

  return {
    total: activities.length,
    today: todayCount,
    byType,
    byStatus,
    heatmap: [...heatmapMap.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    trend: [...trendMap.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => b.day.localeCompare(a.day)),
    hourly: [...hourlyMap.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => Number(b.count) - Number(a.count))
      .slice(0, 24),
  };
}
