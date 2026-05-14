import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';

import {
  OPENCLAW_WORKSPACE,
  WORKSPACE_IDENTITY,
} from '@/lib/paths';

const WORKSPACE_PATH = OPENCLAW_WORKSPACE;
const IDENTITY_PATH = WORKSPACE_IDENTITY;

function parseIdentityMd(): { name: string; creature: string; emoji: string } {
  try {
    const content = fs.readFileSync(IDENTITY_PATH, 'utf-8');
    const nameMatch = content.match(/\*\*Name:\*\*\s*(.+)/);
    const creatureMatch = content.match(/\*\*Creature:\*\*\s*(.+)/);
    const emojiMatch = content.match(/\*\*Emoji:\*\*\s*(.+)/);

    return {
      name: nameMatch?.[1]?.trim() || 'Unknown',
      creature: creatureMatch?.[1]?.trim() || 'AI Agent',
      emoji: emojiMatch?.[1]?.match(/./u)?.[0] || '🤖',
    };
  } catch {
    return { name: 'OpenClaw Agent', creature: 'AI Agent', emoji: '🤖' };
  }
}

// `getIntegrationStatus` removida — substituída por /api/openclaw/status
// que lê o estado real (running/connected/lastError) via
// `openclaw channels status --json` em vez de inferir do filesystem.

export async function GET() {
  const identity = parseIdentityMd();
  const uptime = process.uptime();
  const nodeVersion = process.version;
  const model = process.env.OPENCLAW_MODEL || process.env.DEFAULT_MODEL || 'anthropic/claude-sonnet-4';
  
  const systemInfo = {
    agent: {
      name: identity.name,
      creature: identity.creature,
      emoji: identity.emoji,
    },
    system: {
      uptime: Math.floor(uptime),
      uptimeFormatted: formatUptime(uptime),
      nodeVersion,
      model,
      workspacePath: WORKSPACE_PATH,
      platform: os.platform(),
      hostname: os.hostname(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
      },
    },
    timestamp: new Date().toISOString(),
  };
  
  return NextResponse.json(systemInfo);
}

/**
 * The upstream POST handler did two things that don't apply in V1:
 *
 *   - `change_password` rewrote `.env.local` with a new `AUTH_PASSWORD`.
 *     V1 auth is JWT-based; the credential lives in `ADMIN_PASSWORD` as a
 *     docker-compose env var, so a file rewrite has no effect after the
 *     container restarts. Rotation is now a deploy concern.
 *
 *   - `clear_activity_log` truncated `data/activities.json`, but V1's
 *     audit log is in `data/activities.db` (SQLite) and also synthesises
 *     entries from sessions.json — neither of which a single file truncate
 *     would touch.
 *
 * Both actions are removed from the UI (see components/QuickActions.tsx).
 * This stub stays so callers that still POST get a clear 410 instead of a
 * silent broken success.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Action removed in V1',
      detail:
        'Password rotation and audit truncation are now deploy-side concerns. ' +
        'See deploy/README.md for the new flow.',
    },
    { status: 410 },
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${Math.floor(seconds)}s`);
  
  return parts.join(' ');
}
