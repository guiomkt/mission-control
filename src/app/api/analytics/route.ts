import { NextResponse } from "next/server";
import { format, subDays } from "date-fns";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

interface AnalyticsData {
  byDay: { date: string; count: number }[];
  byType: { type: string; count: number }[];
  byHour: { hour: number; day: number; count: number }[];
  successRate: number;
}

/**
 * Aggregate analytics for the past 7 days (counts) + lifetime hour/day
 * heatmap. Reads from `public.activities_v1` via the admin client.
 *
 * v1 used to fall back to a SQLite file and then a `data/activities.json`
 * seed file when the DB was empty. After the Supabase migration the
 * single source of truth is the table — if it's empty we just return
 * zeros, which is the honest answer.
 */
export async function GET(): Promise<NextResponse<AnalyticsData>> {
  const supabase = createSupabaseAdminClient();

  // We cap the pull at 50k rows to keep aggregation tractable. The
  // table is bounded by the 30-day retention prune in `logActivity`, so
  // in practice we're nowhere near this limit.
  const { data, error } = await supabase
    .from("activities_v1")
    .select("type, status, timestamp")
    .order("timestamp", { ascending: false })
    .limit(50_000);

  if (error) {
    console.error("[analytics] supabase select failed:", error.message);
  }
  const activities: Array<{ type: string; status: string; timestamp: string }> =
    (data ?? []) as Array<{ type: string; status: string; timestamp: string }>;

  // Last 7 days activity count.
  const today = new Date();
  const byDay: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = subDays(today, i);
    const dateStr = format(date, "yyyy-MM-dd");
    const displayDate = format(date, "MMM d");
    const count = activities.filter((a) => a.timestamp.startsWith(dateStr)).length;
    byDay.push({ date: displayDate, count });
  }

  // Activity by type — normalise legacy granular types into a small
  // bucket set so the chart doesn't show 15 bars with 1 entry each.
  const typeMap = new Map<string, number>();
  activities.forEach((a) => {
    const normalized =
      a.type === "cron_run"
        ? "cron"
        : a.type === "file_read" || a.type === "file_write"
        ? "file"
        : a.type === "web_search"
        ? "search"
        : a.type === "message_sent"
        ? "message"
        : a.type === "tool_call" || a.type === "agent_action"
        ? "task"
        : a.type;
    typeMap.set(normalized, (typeMap.get(normalized) || 0) + 1);
  });
  const byType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Hour/day heatmap.
  const hourDayMap = new Map<string, number>();
  activities.forEach((a) => {
    try {
      const d = new Date(a.timestamp);
      const hour = d.getHours();
      const day = d.getDay();
      const key = `${hour}-${day}`;
      hourDayMap.set(key, (hourDayMap.get(key) || 0) + 1);
    } catch {
      // skip rows with unparseable timestamps
    }
  });

  const byHour: { hour: number; day: number; count: number }[] = [];
  hourDayMap.forEach((count, key) => {
    const [hour, day] = key.split("-").map(Number);
    byHour.push({ hour, day, count });
  });

  // Success rate.
  const successCount = activities.filter((a) => a.status === "success").length;
  const successRate =
    activities.length > 0 ? (successCount / activities.length) * 100 : 0;

  return NextResponse.json({ byDay, byType, byHour, successRate });
}
