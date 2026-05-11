/**
 * Cron API (V1 — supercronic-based, read-only).
 *
 * The OpenClaw deployment we target runs `supercronic` over a plain
 * `crontab.txt` (no OpenClaw-native cron jobs are defined in production
 * — only shell-cron entries). We surface that file as the source of truth.
 *
 * Mutations (enable/disable/delete) are intentionally out of V1 scope:
 *  - the panel runs in a separate container with a read-only mount
 *  - changing schedules requires `openclaw cron` CLI (Phase 3+, via gateway)
 *
 * PUT/DELETE return 405 with an explanatory message. POST /api/cron/run
 * remains stubbed (audited as not-implemented) until Phase 3 adds a control
 * channel.
 */
import { NextResponse } from "next/server";
import { listCrons, type CronEntry } from "@/lib/openclaw-client";

export const dynamic = "force-dynamic";

interface CronJobView {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: { kind: "cron"; expr: string; tz: string };
  scheduleDisplay: string;
  timezone: string;
  description: string;
  payload: null;
  state: null;
  nextRun: null;
  lastRun: null;
}

function entryToView(entry: CronEntry, index: number): CronJobView {
  // Stable id derived from the schedule + command so the UI can key on it.
  const idBase = `${entry.schedule}|${entry.command}`;
  const id = `cron-${index}-${
    Buffer.from(idBase).toString("base64url").slice(0, 12)
  }`;

  // Friendly name: comment if available, else the script basename.
  const baseName = entry.command.split(/\s+/)[0].split("/").pop() || "(unnamed)";
  const name = entry.comment || baseName;

  return {
    id,
    agentId: "main",
    name,
    enabled: entry.enabled,
    schedule: { kind: "cron", expr: entry.schedule, tz: "America/Sao_Paulo" },
    scheduleDisplay: entry.schedule,
    timezone: "America/Sao_Paulo",
    description: entry.command.length > 140
      ? entry.command.slice(0, 137) + "..."
      : entry.command,
    payload: null,
    state: null,
    nextRun: null,
    lastRun: null,
  };
}

export async function GET() {
  try {
    const entries = await listCrons();
    const jobs = entries.map(entryToView);
    return NextResponse.json(jobs);
  } catch (error) {
    console.error("[api/cron] list error", error);
    return NextResponse.json(
      { error: "Failed to read cron schedule" },
      { status: 500 },
    );
  }
}

export async function PUT() {
  return NextResponse.json(
    {
      error: "Not implemented in V1",
      detail:
        "Cron mutation requires shell access into the gateway container, " +
        "which the panel does not have. Edit crontab.txt directly until Phase 3.",
    },
    { status: 405 },
  );
}

export async function DELETE() {
  return NextResponse.json(
    {
      error: "Not implemented in V1",
      detail:
        "Cron deletion requires shell access into the gateway container, " +
        "which the panel does not have. Edit crontab.txt directly until Phase 3.",
    },
    { status: 405 },
  );
}
