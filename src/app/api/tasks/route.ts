/**
 * Tasks API — calendar / about consumers
 *
 * GET /api/tasks
 *   Returns the next ~30 scheduled task instances based on the supercronic
 *   crontab.txt. Used by:
 *     - WeeklyCalendar (groups by day/hour)
 *     - about/page.tsx (just counts entries as "cronJobs")
 *
 * The upstream tenacitOS expected this endpoint to come from `openclaw cron list`,
 * which doesn't apply here. We synthesise it from the supercronic schedule
 * so the UI shows real upcoming runs instead of an empty grid.
 */
import { NextResponse } from 'next/server';
import { listCrons } from '@/lib/openclaw-client';
import { getNextRuns, cronToHuman } from '@/lib/cron-parser';

export const dynamic = 'force-dynamic';

interface TaskInstance {
  id: string;
  name: string;
  schedule: string;
  description: string;
  nextRun: string; // ISO
}

const MAX_RUNS_PER_JOB = 30; // Comfortably covers a 7-day calendar view.

export async function GET() {
  try {
    const entries = await listCrons();
    const now = new Date();
    const out: TaskInstance[] = [];

    for (const entry of entries) {
      if (!entry.enabled) continue;

      const baseId = Buffer.from(`${entry.schedule}|${entry.command}`)
        .toString('base64url')
        .slice(0, 12);
      const baseName = entry.comment || entry.command.split(/\s+/)[0].split('/').pop() || 'cron';
      const human = cronToHuman(entry.schedule);

      const runs = getNextRuns(entry.schedule, MAX_RUNS_PER_JOB, now);
      for (let i = 0; i < runs.length; i++) {
        out.push({
          id: `${baseId}-${i}`,
          name: baseName,
          schedule: entry.schedule,
          description: human + ' — ' + entry.command,
          nextRun: runs[i].toISOString(),
        });
      }
    }

    out.sort((a, b) => a.nextRun.localeCompare(b.nextRun));
    return NextResponse.json(out);
  } catch (error) {
    console.error('[api/tasks] error', error);
    return NextResponse.json([], { status: 500 });
  }
}
