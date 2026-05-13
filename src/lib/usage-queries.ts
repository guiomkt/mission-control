/**
 * Usage Queries — read aggregated cost/usage data from
 * `public.usage_snapshots_v1` in Supabase.
 *
 * All functions are now async (network call). PostgREST doesn't expose
 * SUM/GROUP BY in selects, so we pull the row range we need with a
 * date filter and aggregate in JS. That's fine because the rows-per-day
 * cardinality is small (per-agent × per-model × 24h = handful of
 * thousands at most for typical fleets).
 *
 * The `Database` parameter from the v1 API is dropped — Supabase
 * connection comes from the env. Callers that used to thread a Database
 * handle through their stack just call these helpers directly.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface CostSummary {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  projected: number;
}

export interface AgentCost {
  agent: string;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  percentOfTotal: number;
}

export interface ModelCost {
  model: string;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  percentOfTotal: number;
}

export interface DailyCost {
  date: string; // MM-DD
  cost: number;
  input: number;
  output: number;
}

export interface HourlyCost {
  hour: string; // HH:00
  cost: number;
}

type SnapshotRow = {
  date: string;
  hour: number;
  agent_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  timestamp_ms: number;
};

/**
 * Helper: pull all snapshots within a date window (inclusive ends).
 * 50k cap mirrors what the activities path uses — vastly more than any
 * realistic single-tenant deploy will produce.
 */
async function fetchSnapshots(
  startDate: string,
  endDate?: string,
  startTimestampMs?: number,
): Promise<SnapshotRow[]> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("usage_snapshots_v1")
    .select(
      "date, hour, agent_id, model, input_tokens, output_tokens, total_tokens, cost_usd, timestamp_ms",
    )
    .gte("date", startDate)
    .limit(50_000);
  if (endDate) query = query.lte("date", endDate);
  if (startTimestampMs !== undefined) {
    query = query.gte("timestamp_ms", startTimestampMs);
  }
  const { data, error } = await query;
  if (error) {
    console.error("[usage-queries] select failed:", error.message);
    return [];
  }
  return (data ?? []) as SnapshotRow[];
}

function sumCost(rows: SnapshotRow[]): number {
  return rows.reduce((acc, r) => acc + Number(r.cost_usd ?? 0), 0);
}

export async function getCostSummary(): Promise<CostSummary> {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const thisMonthStart = `${now.getFullYear()}-${String(
    now.getMonth() + 1,
  ).padStart(2, "0")}-01`;
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const lastMonthStartStr = lastMonthStart.toISOString().split("T")[0];
  const lastMonthEndStr = lastMonthEnd.toISOString().split("T")[0];

  // Single pull for both months' window — cheaper than four round-trips.
  const earliest = lastMonthStartStr;
  const rows = await fetchSnapshots(earliest);

  const todayRows = rows.filter((r) => r.date === today);
  const yRows = rows.filter((r) => r.date === yesterdayStr);
  const thisMonthRows = rows.filter((r) => r.date >= thisMonthStart);
  const lastMonthRows = rows.filter(
    (r) => r.date >= lastMonthStartStr && r.date <= lastMonthEndStr,
  );

  const thisMonthTotal = sumCost(thisMonthRows);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = now.getDate();
  const avgDailySpend = daysElapsed > 0 ? thisMonthTotal / daysElapsed : 0;
  const projected = avgDailySpend * daysInMonth;

  return {
    today: sumCost(todayRows),
    yesterday: sumCost(yRows),
    thisMonth: thisMonthTotal,
    lastMonth: sumCost(lastMonthRows),
    projected,
  };
}

function withCutoff(days: number): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString().split("T")[0];
}

export async function getCostByAgent(days: number = 30): Promise<AgentCost[]> {
  const rows = await fetchSnapshots(withCutoff(days));
  const grouped = new Map<
    string,
    { cost: number; tokens: number; inputTokens: number; outputTokens: number }
  >();
  for (const r of rows) {
    const cur = grouped.get(r.agent_id) ?? {
      cost: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    cur.cost += Number(r.cost_usd ?? 0);
    cur.tokens += r.total_tokens ?? 0;
    cur.inputTokens += r.input_tokens ?? 0;
    cur.outputTokens += r.output_tokens ?? 0;
    grouped.set(r.agent_id, cur);
  }
  const total = [...grouped.values()].reduce((a, b) => a + b.cost, 0);
  return [...grouped.entries()]
    .map(([agent, v]) => ({
      agent,
      ...v,
      percentOfTotal: total > 0 ? (v.cost / total) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

export async function getCostByModel(days: number = 30): Promise<ModelCost[]> {
  const rows = await fetchSnapshots(withCutoff(days));
  const grouped = new Map<
    string,
    { cost: number; tokens: number; inputTokens: number; outputTokens: number }
  >();
  for (const r of rows) {
    const cur = grouped.get(r.model) ?? {
      cost: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    cur.cost += Number(r.cost_usd ?? 0);
    cur.tokens += r.total_tokens ?? 0;
    cur.inputTokens += r.input_tokens ?? 0;
    cur.outputTokens += r.output_tokens ?? 0;
    grouped.set(r.model, cur);
  }
  const total = [...grouped.values()].reduce((a, b) => a + b.cost, 0);
  return [...grouped.entries()]
    .map(([model, v]) => ({
      model,
      ...v,
      percentOfTotal: total > 0 ? (v.cost / total) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

export async function getDailyCost(days: number = 30): Promise<DailyCost[]> {
  const rows = await fetchSnapshots(withCutoff(days));
  const grouped = new Map<string, { cost: number; input: number; output: number }>();
  for (const r of rows) {
    const cur = grouped.get(r.date) ?? { cost: 0, input: 0, output: 0 };
    cur.cost += Number(r.cost_usd ?? 0);
    cur.input += r.input_tokens ?? 0;
    cur.output += r.output_tokens ?? 0;
    grouped.set(r.date, cur);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date: date.slice(5), // YYYY-MM-DD → MM-DD
      cost: parseFloat(v.cost.toFixed(2)),
      input: v.input,
      output: v.output,
    }));
}

export async function getHourlyCost(): Promise<HourlyCost[]> {
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().split("T")[0];
  const rows = await fetchSnapshots(cutoffDate, undefined, cutoffMs);
  const grouped = new Map<number, number>();
  for (const r of rows) {
    grouped.set(r.hour, (grouped.get(r.hour) ?? 0) + Number(r.cost_usd ?? 0));
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, cost]) => ({
      hour: `${String(hour).padStart(2, "0")}:00`,
      cost: parseFloat(cost.toFixed(2)),
    }));
}
