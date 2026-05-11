import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';

import {
  OPENCLAW_WORKSPACE,
  OPENCLAW_CONFIG,
  WORKSPACE_IDENTITY,
  WORKSPACE_TOOLS,
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

interface OpenClawConfig {
  channels?: {
    telegram?: {
      enabled?: boolean;
      accounts?: Record<string, unknown>;
    };
  };
  plugins?: {
    entries?: Record<string, { enabled?: boolean }>;
  };
}

/**
 * Detect external integration status by inspecting the live OpenClaw config.
 *
 * Earlier iterations read from `~/.openclaw/openclaw.json` (the upstream
 * tenacitOS layout). In our deployment the config lives at
 * `OPENCLAW_DIR/openclaw.json` (mounted from the host). Probing the wrong
 * path made everything show "Not Configured" even though Telegram and GOG
 * are active.
 */
function getIntegrationStatus() {
  let config: OpenClawConfig | null = null;
  try {
    config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8')) as OpenClawConfig;
  } catch {
    config = null;
  }

  const integrations: Array<{
    id: string;
    name: string;
    status: 'connected' | 'disconnected' | 'configured' | 'not_configured';
    icon: string;
    lastActivity: string | null;
    detail: string | null;
  }> = [];

  // Telegram — channels.telegram.enabled + accounts count
  const telegram = config?.channels?.telegram;
  const telegramEnabled = !!telegram?.enabled;
  const telegramAccounts = telegram?.accounts ? Object.keys(telegram.accounts).length : 0;
  integrations.push({
    id: 'telegram',
    name: 'Telegram',
    status: telegramEnabled ? 'connected' : 'disconnected',
    icon: 'MessageCircle',
    lastActivity: telegramEnabled ? new Date().toISOString() : null,
    detail: telegramEnabled
      ? `${telegramAccounts} bot${telegramAccounts === 1 ? '' : 's'} configured`
      : null,
  });

  // Twitter (bird CLI) — `bird` + `auth_token` mentioned in TOOLS.md
  let twitterConfigured = false;
  try {
    const toolsContent = fs.readFileSync(WORKSPACE_TOOLS, 'utf-8');
    twitterConfigured = toolsContent.includes('bird') && toolsContent.includes('auth_token');
  } catch {}
  integrations.push({
    id: 'twitter',
    name: 'Twitter (bird CLI)',
    status: twitterConfigured ? 'configured' : 'not_configured',
    icon: 'Twitter',
    lastActivity: null,
    detail: null,
  });

  // Google (GOG / google-gemini-cli-auth) — enabled plugin entry
  const googlePlugin = config?.plugins?.entries?.['google-gemini-cli-auth'];
  const googleConfigured = !!googlePlugin?.enabled;
  integrations.push({
    id: 'google',
    name: 'Google (GOG)',
    status: googleConfigured ? 'configured' : 'not_configured',
    icon: 'Mail',
    lastActivity: null,
    detail: googleConfigured ? 'google-gemini-cli-auth plugin enabled' : null,
  });

  return integrations;
}

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
    integrations: getIntegrationStatus(),
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
