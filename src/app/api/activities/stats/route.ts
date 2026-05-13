/**
 * Activity Stats API
 * GET /api/activities/stats
 *
 * Returns the dashboard's headline numbers plus heatmap/trend/hourly
 * arrays. Aggregates two sources:
 *
 *   1. Panel-side audit — `public.activities_v1` in Supabase
 *      (was SQLite in v1).
 *   2. OpenClaw sessions — derived view via getOpenClawActivityStats().
 *
 * A fresh deploy has an empty panel-side audit, which would leave the
 * dashboard at zero on every card. Merging the OpenClaw source restores
 * meaningful counts (sessions per agent, today's runs, weekly trend …).
 */
import { NextResponse } from "next/server";
import { getActivityStats } from "@/lib/activities-db";
import { getOpenClawActivityStats } from "@/lib/openclaw-activities";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type DailyRow = { day: string; count: number };
type TrendRow = { day: string; count: number; success: number; errors: number };
type HourRow = { hour: string; count: number };

/**
 * Aggregate the panel-side series (heatmap/trend/hourly) out of
 * `activities_v1`. PostgREST doesn't expose `GROUP BY` directly, so
 * we pull the raw rows (with a time-window filter that keeps the
 * result tractable) and aggregate in JS. For the 1-year heatmap we
 * cap at 50k rows, which is ample for typical use.
 */
async function readPanelSeries(): Promise<{
  heatmap: DailyRow[];
  trend: TrendRow[];
  hourly: HourRow[];
}> {
  const supabase = createSupabaseAdminClient();
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("activities_v1")
    .select("timestamp, status")
    .gte("timestamp", oneYearAgo)
    .limit(50_000);

  if (error || !data) {
    if (error) console.error("[activities/stats] supabase select failed:", error.message);
    return { heatmap: [], trend: [], hourly: [] };
  }

  const heatmapMap = new Map<string, number>();
  const trendMap = new Map<
    string,
    { count: number; success: number; errors: number }
  >();
  const hourlyMap = new Map<string, number>();

  for (const row of data as Array<{ timestamp: string; status: string }>) {
    const ts = new Date(row.timestamp);
    if (Number.isNaN(ts.getTime())) continue;
    const dayKey = ts.toISOString().slice(0, 10);
    heatmapMap.set(dayKey, (heatmapMap.get(dayKey) ?? 0) + 1);

    if (row.timestamp >= sevenDaysAgo) {
      const cur = trendMap.get(dayKey) ?? { count: 0, success: 0, errors: 0 };
      cur.count += 1;
      if (row.status === "success") cur.success += 1;
      if (row.status === "error") cur.errors += 1;
      trendMap.set(dayKey, cur);
    }

    if (row.timestamp >= thirtyDaysAgo) {
      const hour = String(ts.getUTCHours()).padStart(2, "0");
      hourlyMap.set(hour, (hourlyMap.get(hour) ?? 0) + 1);
    }
  }

  return {
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

function mergeByKey<T extends Record<string, number | string>>(
  a: T[],
  b: T[],
  key: keyof T,
  numericKeys: (keyof T)[],
): T[] {
  const merged = new Map<string, T>();
  for (const row of [...a, ...b]) {
    const k = String(row[key]);
    const existing = merged.get(k);
    if (!existing) {
      merged.set(k, { ...row });
      continue;
    }
    const next = { ...existing };
    for (const nk of numericKeys) {
      (next as Record<string, number>)[nk as string] =
        ((existing as Record<string, number>)[nk as string] ?? 0) +
        ((row as Record<string, number>)[nk as string] ?? 0);
    }
    merged.set(k, next);
  }
  return [...merged.values()];
}

export async function GET() {
  try {
    const [panelBase, panelSeries, openclaw] = await Promise.all([
      getActivityStats(),
      readPanelSeries(),
      getOpenClawActivityStats(),
    ]);

    const total = panelBase.total + openclaw.total;
    const today = panelBase.today + openclaw.today;

    const byType: Record<string, number> = { ...panelBase.byType };
    for (const [k, v] of Object.entries(openclaw.byType))
      byType[k] = (byType[k] ?? 0) + v;

    const byStatus: Record<string, number> = { ...panelBase.byStatus };
    for (const [k, v] of Object.entries(openclaw.byStatus))
      byStatus[k] = (byStatus[k] ?? 0) + v;

    const heatmap = mergeByKey(
      panelSeries.heatmap,
      openclaw.heatmap,
      "day",
      ["count"],
    ).sort((a, b) => a.day.localeCompare(b.day));

    const trend = mergeByKey(panelSeries.trend, openclaw.trend, "day", [
      "count",
      "success",
      "errors",
    ]).sort((a, b) => b.day.localeCompare(a.day));

    const hourly = mergeByKey(panelSeries.hourly, openclaw.hourly, "hour", [
      "count",
    ]);
    hourly.sort((a, b) => Number(b.count) - Number(a.count));

    return NextResponse.json({
      total,
      today,
      byType,
      byStatus,
      heatmap,
      trend,
      hourly,
    });
  } catch (error) {
    console.error("[activities/stats] Error:", error);
    return NextResponse.json({ error: "Failed to get stats" }, { status: 500 });
  }
}
