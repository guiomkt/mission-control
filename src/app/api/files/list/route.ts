import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  OPENCLAW_WORKSPACE,
  resolveSafe,
  resolveSafeInWorkspace,
  resolveWorkspaceRoot,
} from '@/lib/paths';

/**
 * Read-only directory listing across the configured OpenClaw workspaces.
 *
 * GET /api/files/list                                → main workspace root
 * GET /api/files/list?path=memory                    → main workspace subdir
 * GET /api/files/list?workspace=workspace-copywriter → that agent's workspace root
 *
 * Workspace selection: the workspace ID must match the whitelist regex
 * (workspace, workspace-<slug>). Anything else is rejected with 403.
 *
 * Hidden files (dotfiles, _underscore) are filtered out.
 */

interface FileEntry {
  name: string;
  type: 'file' | 'folder';
  size: number;
  modified: string;
}

const HIDDEN_PREFIXES = ['.', '_'];

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function resolveTarget(workspaceId: string | null, rel: string): string | null {
  // Default workspace (main) uses the legacy resolveSafe path.
  if (!workspaceId || workspaceId === 'workspace') {
    if (!rel) return OPENCLAW_WORKSPACE;
    return resolveSafe('workspace', rel);
  }
  // Named workspace — validate id, resolve, then optionally descend.
  if (!rel) return resolveWorkspaceRoot(workspaceId);
  return resolveSafeInWorkspace(workspaceId, rel);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace');
    const rel = searchParams.get('path') || '';

    const dir = resolveTarget(workspaceId, rel);
    if (!dir) {
      return NextResponse.json(
        { error: 'Invalid workspace or path' },
        { status: 403 },
      );
    }

    if (!(await fileExists(dir))) {
      return NextResponse.json({ items: [] });
    }

    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: 'Not a directory' },
        { status: 400 },
      );
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });

    const items: FileEntry[] = [];
    for (const entry of entries) {
      if (HIDDEN_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
        continue;
      }
      try {
        const entryStat = await fs.stat(path.join(dir, entry.name));
        items.push({
          name: entry.name,
          type: entry.isDirectory() ? 'folder' : 'file',
          size: entryStat.size,
          modified: entryStat.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error('[api/files/list] error', error);
    return NextResponse.json(
      { error: 'Failed to list directory' },
      { status: 500 },
    );
  }
}
