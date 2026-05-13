/**
 * Activity feed — Supabase-backed implementation.
 *
 * Drop-in replacement for the previous SQLite version. The exported types
 * are identical so existing callers compile unchanged; the read/write
 * functions are now async (Supabase is a network call) so every caller
 * must `await` them — that's the only behavioral break versus v1.
 *
 * Schema: see `public.activities_v1` in the Supabase project. We use the
 * service-role client here so RLS doesn't get in our way — the activity
 * log is server-only data; nothing leaks to the browser without going
 * through `/api/activities` which already authenticates.
 */
import { randomUUID } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type ActivityType =
  | "file"
  | "search"
  | "message"
  | "command"
  | "security"
  | "build"
  | "task"
  | "cron"
  | "memory"
  | "cron_run"
  | "file_read"
  | "file_write"
  | "web_search"
  | "message_sent"
  | "tool_call"
  | "agent_action";

export type ActivityStatus = "success" | "error" | "pending" | "running";

export interface Activity {
  id: string;
  timestamp: string;
  type: string;
  description: string;
  status: string;
  duration_ms: number | null;
  tokens_used: number | null;
  agent: string | null;
  metadata: Record<string, unknown> | null;
}

const TABLE = "activities_v1";

// Aliases used by `getActivities` so legacy type filters still match new
// granular event types (cron_run → cron, file_read/file_write → file …).
// Kept identical to the v1 SQLite behavior so the UI filters don't change.
const TYPE_ALIASES: Record<string, string[]> = {
  cron: ["cron", "cron_run"],
  file: ["file", "file_read", "file_write"],
  search: ["search", "web_search"],
  message: ["message", "message_sent"],
  task: ["task", "tool_call", "agent_action"],
};

export async function logActivity(
  type: string,
  description: string,
  status: string,
  opts?: {
    duration_ms?: number | null;
    tokens_used?: number | null;
    agent?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<Activity> {
  const supabase = createSupabaseAdminClient();
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const row = {
    id,
    timestamp,
    type,
    description,
    status,
    duration_ms: opts?.duration_ms ?? null,
    tokens_used: opts?.tokens_used ?? null,
    agent: opts?.agent ?? null,
    metadata: opts?.metadata ?? null,
  };
  const { error } = await supabase.from(TABLE).insert(row);
  if (error) {
    // Best-effort: don't break the request path. The v1 SQLite behavior
    // would throw here — Supabase's transient network errors are a real
    // failure mode in a way SQLite's never were, so we trade strictness
    // for resilience and log the error to stderr.
    console.error("[activities] insert failed:", error.message);
  }
  // 30-day retention prune — fire-and-forget so it doesn't slow the
  // hot path. Same cadence as v1 (every insert), Postgres handles the
  // periodic load fine.
  pruneOlderThan30Days(supabase).catch((err) =>
    console.error("[activities] prune failed:", err),
  );
  return {
    id,
    timestamp,
    type,
    description,
    status,
    duration_ms: opts?.duration_ms ?? null,
    tokens_used: opts?.tokens_used ?? null,
    agent: opts?.agent ?? null,
    metadata: opts?.metadata ?? null,
  };
}

async function pruneOlderThan30Days(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from(TABLE).delete().lt("timestamp", cutoff);
}

export async function updateActivity(
  id: string,
  status: string,
  opts?: { duration_ms?: number; tokens_used?: number },
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { status };
  if (opts?.duration_ms !== undefined) patch.duration_ms = opts.duration_ms;
  if (opts?.tokens_used !== undefined) patch.tokens_used = opts.tokens_used;
  const { error } = await supabase.from(TABLE).update(patch).eq("id", id);
  if (error) {
    console.error("[activities] update failed:", error.message);
  }
}

export interface GetActivitiesOptions {
  type?: string;
  status?: string;
  agent?: string;
  startDate?: string;
  endDate?: string;
  sort?: "newest" | "oldest";
  limit?: number;
  offset?: number;
}

export interface ActivitiesResult {
  activities: Activity[];
  total: number;
}

function rowToActivity(row: Record<string, unknown>): Activity {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    type: row.type as string,
    description: row.description as string,
    status: row.status as string,
    duration_ms: (row.duration_ms as number | null) ?? null,
    tokens_used: (row.tokens_used as number | null) ?? null,
    agent: (row.agent as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

export async function getActivities(
  opts: GetActivitiesOptions = {},
): Promise<ActivitiesResult> {
  const supabase = createSupabaseAdminClient();
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  const order = opts.sort === "oldest" ? "asc" : "desc";

  let query = supabase
    .from(TABLE)
    .select("*", { count: "exact" })
    .order("timestamp", { ascending: order === "asc" })
    .range(offset, offset + limit - 1);

  if (opts.type && opts.type !== "all") {
    const requested = opts.type
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const expanded =
      requested.length === 1 ? (TYPE_ALIASES[requested[0]] ?? requested) : requested;
    query = query.in("type", expanded);
  }
  if (opts.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }
  if (opts.agent) {
    query = query.eq("agent", opts.agent);
  }
  if (opts.startDate) {
    query = query.gte("timestamp", opts.startDate);
  }
  if (opts.endDate) {
    // Inclusive-end semantics matching the v1 `datetime(?, '+1 day')`
    // behavior — endDate is interpreted as "the whole day", so we shift
    // the boundary forward by 24h and use `<`.
    const inclusiveEnd = new Date(opts.endDate);
    inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() + 1);
    query = query.lt("timestamp", inclusiveEnd.toISOString());
  }

  const { data, error, count } = await query;
  if (error) {
    console.error("[activities] select failed:", error.message);
    return { activities: [], total: 0 };
  }
  return {
    activities: (data ?? []).map((row) => rowToActivity(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

export async function getActivityStats(): Promise<{
  total: number;
  today: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}> {
  const supabase = createSupabaseAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Three lightweight aggregates. Postgres handles GROUP BY natively;
  // PostgREST returns the grouped rows via `select` with the `count`
  // computed by us in JS because PostgREST aggregates require RPC.
  const [totalResp, todayResp, allRowsResp] = await Promise.all([
    supabase.from(TABLE).select("id", { count: "exact", head: true }),
    supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .gte("timestamp", todayStart.toISOString()),
    // For byType/byStatus we still need rows; cap at 10k to avoid
    // pulling the world. In practice the 30-day retention keeps the
    // table well under that.
    supabase.from(TABLE).select("type, status").limit(10_000),
  ]);

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of (allRowsResp.data ?? []) as Array<{
    type?: string;
    status?: string;
  }>) {
    if (row.type) byType[row.type] = (byType[row.type] ?? 0) + 1;
    if (row.status) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }

  return {
    total: totalResp.count ?? 0,
    today: todayResp.count ?? 0,
    byType,
    byStatus,
  };
}
