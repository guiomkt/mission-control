/**
 * Sessions API (V1 — file-based, no shell exec).
 *
 * GET /api/sessions          → list all sessions for the main agent
 * GET /api/sessions?id=<uuid>→ messages from one session (JSONL)
 *
 * Reads `OPENCLAW_DIR/agents/main/sessions/sessions.json` for the index and
 * `OPENCLAW_DIR/agents/main/sessions/<uuid>.jsonl` for individual transcripts.
 * Both files live on the read-only volume the panel container mounts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { OPENCLAW_DIR } from '@/lib/paths';
import { listSessions as listAgentSessions } from '@/lib/openclaw-client';

export const dynamic = 'force-dynamic';

interface ParsedSession {
  id: string;
  key: string;
  type: 'main' | 'cron' | 'subagent' | 'direct' | 'unknown';
  typeLabel: string;
  typeEmoji: string;
  sessionId: string | null;
  cronJobId?: string;
  subagentId?: string;
  updatedAt: number;
  ageMs: number;
  model: string;
  modelProvider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  contextUsedPercent: number | null;
  aborted: boolean;
}

function parseSessionKey(key: string): {
  type: ParsedSession['type'];
  typeLabel: string;
  typeEmoji: string;
  cronJobId?: string;
  subagentId?: string;
  isRunEntry: boolean;
} {
  const parts = key.split(':');

  if (parts.includes('run')) {
    return { type: 'unknown', typeLabel: 'Run Entry', typeEmoji: '🔁', isRunEntry: true };
  }
  if (parts[2] === 'main') {
    return { type: 'main', typeLabel: 'Main Session', typeEmoji: '🦞', isRunEntry: false };
  }
  if (parts[2] === 'cron') {
    return {
      type: 'cron',
      typeLabel: 'Cron Job',
      typeEmoji: '🕐',
      cronJobId: parts[3],
      isRunEntry: false,
    };
  }
  if (parts[2] === 'subagent') {
    return {
      type: 'subagent',
      typeLabel: 'Sub-agent',
      typeEmoji: '🤖',
      subagentId: parts[3],
      isRunEntry: false,
    };
  }
  return {
    type: 'direct',
    typeLabel: parts[2] ? `${parts[2][0].toUpperCase()}${parts[2].slice(1)} Chat` : 'Direct Chat',
    typeEmoji: '💬',
    isRunEntry: false,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('id');
  const agent = searchParams.get('agent') || 'main';

  if (sessionId) {
    return getSessionMessages(agent, sessionId);
  }

  return listSessionsResponse(agent);
}

async function listSessionsResponse(agentId: string): Promise<NextResponse> {
  try {
    const raw = await listAgentSessions(agentId);

    const sessions: ParsedSession[] = raw.reduce<ParsedSession[]>((acc, r) => {
      const parsed = parseSessionKey(r.key);
      if (parsed.isRunEntry || parsed.type === 'unknown') return acc;

      const contextUsedPercent =
        r.contextTokens > 0
          ? Math.round((r.totalTokens / r.contextTokens) * 100)
          : null;

      acc.push({
        id: r.key,
        key: r.key,
        type: parsed.type,
        typeLabel: parsed.typeLabel,
        typeEmoji: parsed.typeEmoji,
        sessionId: r.id || null,
        cronJobId: parsed.cronJobId,
        subagentId: parsed.subagentId,
        updatedAt: r.updatedAt,
        ageMs: r.ageMs,
        model: r.model ?? 'unknown',
        modelProvider: r.model?.split('/')[0] ?? 'unknown',
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        contextTokens: r.contextTokens,
        contextUsedPercent,
        aborted: r.aborted,
      });
      return acc;
    }, []);

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ sessions, total: sessions.length });
  } catch (error) {
    console.error('[api/sessions] list error', error);
    return NextResponse.json(
      { error: 'Failed to list sessions', sessions: [] },
      { status: 500 },
    );
  }
}

interface JsonlLine {
  type: string;
  id?: string;
  timestamp?: string;
  message?: {
    role: string;
    content:
      | string
      | Array<{ type: string; text?: string | unknown; name?: string; input?: unknown; id?: string }>;
    timestamp?: number;
  };
  provider?: string;
  modelId?: string;
  customType?: string;
  data?: unknown;
}

async function getSessionMessages(
  agentId: string,
  sessionId: string,
): Promise<NextResponse> {
  // UUID-like only — defense in depth even though `agent` is also constrained below.
  if (!/^[a-f0-9-]{36}$/.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    return NextResponse.json({ error: 'Invalid agent ID' }, { status: 400 });
  }

  const filePath = path.join(
    OPENCLAW_DIR,
    'agents',
    agentId,
    'sessions',
    `${sessionId}.jsonl`,
  );

  // Confirm the resolved path is still under OPENCLAW_DIR/agents/<id>/sessions.
  // Symlink escape doesn't matter much here (workspace is read-only) but the
  // explicit prefix check makes the intent obvious for future readers.
  const sessionsDir = path.join(OPENCLAW_DIR, 'agents', agentId, 'sessions');
  if (!filePath.startsWith(sessionsDir + path.sep)) {
    return NextResponse.json({ error: 'Invalid session path' }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return NextResponse.json(
      { error: 'Session not found', messages: [] },
      { status: 404 },
    );
  }

  interface ParsedMessage {
    id: string;
    type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'model_change' | 'system';
    role?: string;
    content: string;
    timestamp: string;
    model?: string;
    toolName?: string;
  }

  const messages: ParsedMessage[] = [];
  let currentModel = '';

  for (const line of raw.trim().split('\n').filter(Boolean)) {
    let obj: JsonlLine;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'model_change' && obj.modelId) {
      currentModel = obj.modelId;
    }

    if (obj.type !== 'message' || !obj.message) continue;

    const msg = obj.message;
    const role = msg.role;
    const timestamp = obj.timestamp || new Date().toISOString();

    if (typeof msg.content === 'string') {
      messages.push({
        id: obj.id || Math.random().toString(),
        type: role === 'user' ? 'user' : 'assistant',
        role,
        content: msg.content,
        timestamp,
        model: currentModel || undefined,
      });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          messages.push({
            id: (obj.id || '') + '-text',
            type: role === 'user' ? 'user' : 'assistant',
            role,
            content: block.text,
            timestamp,
            model: currentModel || undefined,
          });
        } else if (block.type === 'tool_use' && block.name) {
          messages.push({
            id: block.id || (obj.id || '') + '-tool',
            type: 'tool_use',
            role,
            content: `${block.name}(${
              block.input ? JSON.stringify(block.input).slice(0, 200) : ''
            })`,
            timestamp,
            toolName: block.name,
            model: currentModel || undefined,
          });
        } else if (block.type === 'tool_result') {
          const resultContent = Array.isArray(block.text)
            ? (block.text as Array<{ text?: string }>).map((b) => b.text || '').join('\n')
            : (typeof block.text === 'string' ? block.text : '');
          messages.push({
            id: (obj.id || '') + '-result',
            type: 'tool_result',
            role,
            content: resultContent.slice(0, 500),
            timestamp,
            model: currentModel || undefined,
          });
        }
      }
    }
  }

  return NextResponse.json({ sessionId, messages, total: messages.length });
}
