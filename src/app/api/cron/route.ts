/**
 * Cron API (V1.1 — supercronic, with in-place mutations).
 *
 * Reads from `crontab.txt`. Pause/enable/delete edits the file directly
 * through `lib/cron-edit.ts`, which requires the file to be bind-mounted
 * read-write in compose. supercronic reloads on fsnotify.
 *
 * "Run Now" remains 501 — that needs a control channel into the gateway
 * container (Phase 3.5).
 */
import { NextRequest, NextResponse } from 'next/server';
import { listCrons, type CronEntry } from '@/lib/openclaw-client';
import { setCronEnabled, deleteCron } from '@/lib/cron-edit';
import { auditMutation } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

interface CronJobView {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: { kind: 'cron'; expr: string; tz: string };
  scheduleDisplay: string;
  timezone: string;
  description: string;
  payload: null;
  state: null;
  nextRun: null;
  lastRun: null;
}

function entryToView(entry: CronEntry): CronJobView {
  const baseName = entry.command.split(/\s+/)[0].split('/').pop() || '(unnamed)';
  const name = entry.comment || baseName;

  return {
    id: entry.id,
    agentId: 'main',
    name,
    enabled: entry.enabled,
    schedule: { kind: 'cron', expr: entry.schedule, tz: 'America/Sao_Paulo' },
    scheduleDisplay: entry.schedule,
    timezone: 'America/Sao_Paulo',
    description: entry.command.length > 140
      ? entry.command.slice(0, 137) + '...'
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
    return NextResponse.json(entries.map(entryToView));
  } catch (error) {
    console.error('[api/cron] list error', error);
    return NextResponse.json(
      { error: 'Failed to read cron schedule' },
      { status: 500 },
    );
  }
}

interface PutBody {
  id?: unknown;
  enabled?: unknown;
}

export async function PUT(request: NextRequest) {
  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.id !== 'string' || typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'Body must be { id: string, enabled: boolean }' },
      { status: 400 },
    );
  }

  try {
    const updated = await setCronEnabled(body.id, body.enabled);
    await auditMutation(request, {
      action: body.enabled ? 'cron.enable' : 'cron.disable',
      target: body.id,
      ok: true,
      meta: { schedule: updated.schedule },
    });
    return NextResponse.json(entryToView(updated));
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    await auditMutation(request, {
      action: body.enabled ? 'cron.enable' : 'cron.disable',
      target: body.id,
      ok: false,
      meta: { error: (err as Error).message },
    });
    if (status === 404) {
      return NextResponse.json({ error: 'Cron not found' }, { status: 404 });
    }
    console.error('[api/cron] toggle error', err);
    return NextResponse.json(
      { error: 'Failed to update cron entry' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id query param' }, { status: 400 });
  }

  try {
    const removed = await deleteCron(id);
    await auditMutation(request, {
      action: 'cron.delete',
      target: id,
      ok: true,
      meta: { schedule: removed.schedule, command: removed.command },
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const status = (err as Error & { status?: number }).status ?? 500;
    await auditMutation(request, {
      action: 'cron.delete',
      target: id,
      ok: false,
      meta: { error: (err as Error).message },
    });
    if (status === 404) {
      return NextResponse.json({ error: 'Cron not found' }, { status: 404 });
    }
    console.error('[api/cron] delete error', err);
    return NextResponse.json(
      { error: 'Failed to delete cron entry' },
      { status: 500 },
    );
  }
}
