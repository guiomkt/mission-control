/**
 * Usage Collector — reads OpenClaw session data and records cost
 * snapshots into Supabase (`public.usage_snapshots_v1`).
 *
 * Replaces the previous SQLite-backed implementation. The interface
 * stays the same for callers: `collectUsage(...)` runs the full
 * pipeline; `calculateSnapshot(...)` is still pure-functional and used
 * by routes that want to display "current" costs without persisting.
 *
 * `dbPath` arguments from the v1 SQLite API are kept on `collectUsage`
 * for backwards compat with cron callers, but ignored — Supabase
 * connection comes from the env.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { calculateCost, normalizeModelId } from "./pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const execAsync = promisify(exec);

export interface SessionData {
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  updatedAt?: number;
  percentUsed: number;
}

export interface UsageSnapshot {
  timestamp: number;
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

interface OpenClawSessionRecord {
  key: string;
  sessionId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  updatedAt?: number;
  percentUsed?: number;
}

interface OpenClawAgentGroup {
  agentId: string;
  recent?: OpenClawSessionRecord[];
}

interface OpenClawStatus {
  sessions?: {
    byAgent?: OpenClawAgentGroup[];
  };
  [k: string]: unknown;
}

export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  try {
    const { stdout } = await execAsync("openclaw status --json");
    return JSON.parse(stdout) as OpenClawStatus;
  } catch (error) {
    console.error("Error getting OpenClaw status:", error);
    throw error;
  }
}

/** Extract session data from OpenClaw status payload. */
export function extractSessionData(status: OpenClawStatus): SessionData[] {
  const sessions: SessionData[] = [];
  if (!status.sessions?.byAgent) return sessions;

  for (const agentGroup of status.sessions.byAgent) {
    const agentId = agentGroup.agentId;
    for (const session of agentGroup.recent || []) {
      sessions.push({
        agentId,
        sessionKey: session.key,
        sessionId: session.sessionId,
        model: normalizeModelId(session.model || "unknown"),
        inputTokens: session.inputTokens || 0,
        outputTokens: session.outputTokens || 0,
        totalTokens: session.totalTokens || 0,
        updatedAt: session.updatedAt,
        percentUsed: session.percentUsed || 0,
      });
    }
  }
  return sessions;
}

/** Pure: turn session totals into cost snapshots bucketed by agent/model. */
export function calculateSnapshot(
  sessions: SessionData[],
  timestamp: number,
): UsageSnapshot[] {
  const snapshots: UsageSnapshot[] = [];
  const date = new Date(timestamp);
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  const hour = date.getUTCHours();

  const grouped = new Map<string, SessionData[]>();
  for (const session of sessions) {
    const key = `${session.agentId}:${session.model}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(session);
  }

  for (const [key, group] of grouped.entries()) {
    const [agentId, model] = key.split(":");
    const inputTokens = group.reduce((sum, s) => sum + s.inputTokens, 0);
    const outputTokens = group.reduce((sum, s) => sum + s.outputTokens, 0);
    const totalTokens = group.reduce((sum, s) => sum + s.totalTokens, 0);
    const cost = calculateCost(model, inputTokens, outputTokens);
    snapshots.push({
      timestamp,
      date: dateStr,
      hour,
      agentId,
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
    });
  }
  return snapshots;
}

/**
 * Persist a snapshot into `usage_snapshots_v1`. Uses upsert on the
 * (agent_id, model, date, hour) unique index so re-running the
 * collector inside the same hour just refreshes the totals — same
 * idempotency the v1 SQLite path provided with its DELETE + INSERT.
 */
export async function saveSnapshot(snapshot: UsageSnapshot): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const row = {
    timestamp_ms: snapshot.timestamp,
    date: snapshot.date,
    hour: snapshot.hour,
    agent_id: snapshot.agentId,
    model: snapshot.model,
    input_tokens: snapshot.inputTokens,
    output_tokens: snapshot.outputTokens,
    total_tokens: snapshot.totalTokens,
    cost_usd: snapshot.cost,
  };
  const { error } = await supabase
    .from("usage_snapshots_v1")
    .upsert(row, { onConflict: "agent_id,model,date,hour" });
  if (error) {
    console.error("[usage-collector] upsert failed:", error.message);
  }
}

/**
 * Capture a point-in-time snapshot of session totals and persist it.
 * The `dbPath` argument is preserved for the cron caller's existing
 * signature but ignored — Supabase replaces the SQLite file.
 */
export async function collectUsage(_dbPath?: string): Promise<void> {
  const status = await getOpenClawStatus();
  const sessions = extractSessionData(status);
  const timestamp = Date.now();
  const snapshots = calculateSnapshot(sessions, timestamp);

  for (const snapshot of snapshots) {
    await saveSnapshot(snapshot);
  }

  const date = new Date(timestamp).toISOString().split("T")[0];
  const hour = new Date(timestamp).getUTCHours();
  console.log(
    `Collected ${snapshots.length} usage snapshots for ${date} ${hour}:00 UTC`,
  );
}
