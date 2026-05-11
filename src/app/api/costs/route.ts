/**
 * Costs API
 * GET /api/costs?timeframe=30d
 *
 * The original tenacitOS implementation reads from a SQLite usage tracker
 * populated by `scripts/collect-usage.sh` (which shells out to
 * `openclaw status --json`). That CLI doesn't exist on our panel side, so
 * the SQLite stays empty and every card showed $0.
 *
 * V1 fix mirrors the dashboard rewrite: synthesise costs directly from
 * the OpenClaw sessions.json the panel already reads (see
 * lib/openclaw-costs.ts).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getOpenClawCosts } from '@/lib/openclaw-costs';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const timeframe = request.nextUrl.searchParams.get('timeframe') || '30d';
  const days = Math.max(1, parseInt(timeframe.replace(/\D/g, ''), 10) || 30);

  try {
    const costs = await getOpenClawCosts(days);
    return NextResponse.json(costs);
  } catch (error) {
    console.error('[api/costs] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cost data' },
      { status: 500 },
    );
  }
}
