/**
 * Activity Stats API
 * GET /api/activities/stats
 *
 * Returns the dashboard's headline numbers plus heatmap/trend/hourly arrays.
 * Aggregates two sources:
 *
 *   1. SQLite (panel's own audit) — getActivityStats() + ad-hoc heatmap queries
 *   2. OpenClaw sessions — derived view via getOpenClawActivityStats()
 *
 * A fresh deploy has an empty SQLite, which would leave the dashboard at
 * zero on every card. Merging the OpenClaw source restores meaningful
 * counts (sessions per agent, today's runs, weekly trend, etc.).
 */
import { NextResponse } from 'next/server';
import { getActivityStats } from '@/lib/activities-db';
import { getOpenClawActivityStats } from '@/lib/openclaw-activities';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

type DailyRow = { day: string; count: number };
type TrendRow = { day: string; count: number; success: number; errors: number };
type HourRow = { hour: string; count: number };

function readSqliteSeries(): { heatmap: DailyRow[]; trend: TrendRow[]; hourly: HourRow[] } {
  const DB_PATH = path.join(process.cwd(), 'data', 'activities.db');
  // SQLite file may not exist on first boot; skip gracefully.
  if (!fs.existsSync(DB_PATH)) {
    return { heatmap: [], trend: [], hourly: [] };
  }

  const db = new Database(DB_PATH);
  try {
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const heatmap = db.prepare(`
      SELECT DATE(timestamp) as day, COUNT(*) as count
      FROM activities
      WHERE timestamp >= ?
      GROUP BY DATE(timestamp)
      ORDER BY day
    `).all(cutoff) as DailyRow[];

    const trend = db.prepare(`
      SELECT DATE(timestamp) as day, COUNT(*) as count,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
      FROM activities
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY DATE(timestamp)
      ORDER BY day DESC
    `).all() as TrendRow[];

    const hourly = db.prepare(`
      SELECT strftime('%H', timestamp) as hour, COUNT(*) as count
      FROM activities
      WHERE timestamp >= datetime('now', '-30 days')
      GROUP BY hour
      ORDER BY count DESC
      LIMIT 24
    `).all() as HourRow[];

    return { heatmap, trend, hourly };
  } finally {
    db.close();
  }
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
    const [sqliteBase, sqliteSeries, openclaw] = await Promise.all([
      Promise.resolve(getActivityStats()),
      Promise.resolve(readSqliteSeries()),
      getOpenClawActivityStats(),
    ]);

    // Sum scalars across both sources.
    const total = sqliteBase.total + openclaw.total;
    const today = sqliteBase.today + openclaw.today;

    const byType: Record<string, number> = { ...sqliteBase.byType };
    for (const [k, v] of Object.entries(openclaw.byType)) byType[k] = (byType[k] ?? 0) + v;

    const byStatus: Record<string, number> = { ...sqliteBase.byStatus };
    for (const [k, v] of Object.entries(openclaw.byStatus)) byStatus[k] = (byStatus[k] ?? 0) + v;

    const heatmap = mergeByKey(sqliteSeries.heatmap, openclaw.heatmap, 'day', ['count'])
      .sort((a, b) => a.day.localeCompare(b.day));

    const trend = mergeByKey(sqliteSeries.trend, openclaw.trend, 'day', ['count', 'success', 'errors'])
      .sort((a, b) => b.day.localeCompare(a.day));

    const hourly = mergeByKey(sqliteSeries.hourly, openclaw.hourly, 'hour', ['count']);
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
    console.error('[activities/stats] Error:', error);
    return NextResponse.json({ error: 'Failed to get stats' }, { status: 500 });
  }
}
