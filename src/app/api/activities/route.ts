import { NextRequest, NextResponse } from 'next/server';
import { logActivity, getActivities, type Activity } from '@/lib/activities-db';
import { getOpenClawActivities } from '@/lib/openclaw-activities';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const type = searchParams.get('type') || undefined;
    const status = searchParams.get('status') || undefined;
    const agent = searchParams.get('agent') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const sort = (searchParams.get('sort') || 'newest') as 'newest' | 'oldest';
    const format = searchParams.get('format') || 'json';
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), format === 'csv' ? 10000 : 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Two activity sources, merged for the dashboard:
    //   1. SQLite (panel-side audit: login, download, ...)
    //   2. OpenClaw sessions (synthesised across agents).
    // The SQLite alone is empty on a fresh install, which made the panel
    // look broken; sessions give us the actual agent activity.
    const pageCeiling = Math.max(limit + offset, 200);
    // Post-Supabase migration the panel-side audit lives in
     // `public.activities_v1`; the openclaw side stays on the local
     // filesystem (sessions.json) so both still need to be merged.
    const [panel, openclaw] = await Promise.all([
      getActivities({
        type, status, agent, startDate, endDate, sort,
        limit: pageCeiling, offset: 0,
      }),
      getOpenClawActivities({
        limit: pageCeiling,
        type,
        agent,
        startDate,
        endDate,
      }),
    ]);

    const merged: Activity[] = [...panel.activities, ...openclaw];
    const filtered = status && status !== 'all'
      ? merged.filter((a) => a.status === status)
      : merged;

    filtered.sort((a, b) =>
      sort === 'oldest'
        ? a.timestamp.localeCompare(b.timestamp)
        : b.timestamp.localeCompare(a.timestamp),
    );

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    if (format === 'csv') {
      const header = 'id,timestamp,type,description,status,duration_ms,tokens_used,agent\n';
      const rows = page.map((a) => [
        a.id, a.timestamp, a.type,
        `"${(a.description || '').replace(/"/g, '""')}"`,
        a.status, a.duration_ms ?? '', a.tokens_used ?? '',
        a.agent ?? '',
      ].join(',')).join('\n');
      const csv = header + rows;
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="activities-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      activities: page,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('Failed to get activities:', error);
    return NextResponse.json({ error: 'Failed to get activities' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.type || !body.description || !body.status) {
      return NextResponse.json(
        { error: 'Missing required fields: type, description, status' },
        { status: 400 }
      );
    }

    const validStatuses = ['success', 'error', 'pending', 'running'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const activity = await logActivity(body.type, body.description, body.status, {
      duration_ms: body.duration_ms ?? null,
      tokens_used: body.tokens_used ?? null,
      agent: body.agent ?? null,
      metadata: body.metadata ?? null,
    });

    return NextResponse.json(activity, { status: 201 });
  } catch (error) {
    console.error('Failed to save activity:', error);
    return NextResponse.json({ error: 'Failed to save activity' }, { status: 500 });
  }
}
