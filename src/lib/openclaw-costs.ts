/**
 * Cost projection from live OpenClaw session data.
 *
 * Same pattern as `openclaw-activities.ts`: the SQLite collector
 * (scripts/collect-usage.sh → `openclaw status --json`) doesn't work in our
 * deployment because we have no CLI on the panel side. Instead we read the
 * sessions.json files directly and apply `pricing.ts` to derive costs.
 *
 * Caveat: sessions.json only records *cumulative* tokens per session, not
 * per-day events. We attribute each session's cost to its `updatedAt` day —
 * which means daily/hourly numbers represent "sessions last touched on that
 * day", not "tokens spent during that day". For day-vs-day deltas this is
 * close enough; for an exact spend ledger we'd need per-message events
 * (Phase 4 idea).
 */

import { listAgents, listSessions } from './openclaw-client';
import { calculateCost, normalizeModelId, getModelName } from './pricing';

export interface CostsResponse {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  projected: number;
  budget: number;
  byAgent: Array<{ agent: string; cost: number; tokens: number }>;
  byModel: Array<{ model: string; cost: number; tokens: number }>;
  daily: Array<{ date: string; cost: number; input: number; output: number }>;
  hourly: Array<{ hour: string; cost: number }>;
  /** Number of sessions used to compute the figures (operator transparency). */
  sessionsCounted: number;
}

interface Bucket {
  cost: number;
  input: number;
  output: number;
}

const BUDGET_DEFAULT = Number(process.env.MC_BUDGET_USD || 100);

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function startOfDayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonthMs(monthOffset = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() + monthOffset);
  return d.getTime();
}

/**
 * Build a single `CostsResponse` for a given lookback window (in days). The
 * window controls the `daily`/`hourly` series; totals (today/month/etc.) are
 * always computed from the full dataset.
 */
export async function getOpenClawCosts(daysWindow = 30): Promise<CostsResponse> {
  const agents = await listAgents();

  const todayStart = startOfDayMs();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const monthStart = startOfMonthMs();
  const lastMonthStart = startOfMonthMs(-1);
  const windowStart = todayStart - daysWindow * 24 * 60 * 60 * 1000;
  const hourlyWindowStart = todayStart - 30 * 24 * 60 * 60 * 1000;

  let today = 0;
  let yesterday = 0;
  let thisMonth = 0;
  let lastMonth = 0;
  let sessionsCounted = 0;

  const byAgent = new Map<string, { cost: number; tokens: number }>();
  const byModel = new Map<string, { cost: number; tokens: number }>();
  const daily = new Map<string, Bucket>();
  const hourly = new Map<string, number>();

  for (const agent of agents) {
    const sessions = await listSessions(agent.id);
    for (const s of sessions) {
      if (!s.model) continue;
      const tokens = s.inputTokens + s.outputTokens;
      if (tokens === 0) continue;

      const normalized = normalizeModelId(s.model);
      const cost = calculateCost(normalized, s.inputTokens, s.outputTokens);
      if (cost === 0) continue;

      const ts = s.updatedAt || Date.now();
      sessionsCounted++;

      // Coarse buckets
      if (ts >= todayStart) today += cost;
      else if (ts >= yesterdayStart) yesterday += cost;
      if (ts >= monthStart) thisMonth += cost;
      else if (ts >= lastMonthStart) lastMonth += cost;

      // Grouped totals
      const a = byAgent.get(agent.id) || { cost: 0, tokens: 0 };
      a.cost += cost;
      a.tokens += tokens;
      byAgent.set(agent.id, a);

      const modelName = getModelName(normalized);
      const m = byModel.get(modelName) || { cost: 0, tokens: 0 };
      m.cost += cost;
      m.tokens += tokens;
      byModel.set(modelName, m);

      // Time series (window-bounded)
      if (ts >= windowStart) {
        const day = isoDay(ts);
        const b = daily.get(day) || { cost: 0, input: 0, output: 0 };
        b.cost += cost;
        b.input += s.inputTokens;
        b.output += s.outputTokens;
        daily.set(day, b);
      }
      if (ts >= hourlyWindowStart) {
        const hour = String(new Date(ts).getHours()).padStart(2, '0');
        hourly.set(hour, (hourly.get(hour) ?? 0) + cost);
      }
    }
  }

  // Project current-month spend to end of month assuming linear pace so far.
  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = daysElapsed > 0 ? (thisMonth / daysElapsed) * daysInMonth : 0;

  return {
    today: round(today),
    yesterday: round(yesterday),
    thisMonth: round(thisMonth),
    lastMonth: round(lastMonth),
    projected: round(projected),
    budget: BUDGET_DEFAULT,
    byAgent: [...byAgent.entries()]
      .map(([agent, v]) => ({ agent, cost: round(v.cost), tokens: v.tokens }))
      .sort((a, b) => b.cost - a.cost),
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, cost: round(v.cost), tokens: v.tokens }))
      .sort((a, b) => b.cost - a.cost),
    daily: [...daily.entries()]
      .map(([date, b]) => ({ date, cost: round(b.cost), input: b.input, output: b.output }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    hourly: [...hourly.entries()]
      .map(([hour, cost]) => ({ hour, cost: round(cost) }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
    sessionsCounted,
  };
}

/** Two-decimal rounding for display; keeps JSON small and stable. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
