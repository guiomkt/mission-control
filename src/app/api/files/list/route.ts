import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { OPENCLAW_WORKSPACE, resolveSafe } from '@/lib/paths';

/**
 * Read-only directory listing under OPENCLAW_WORKSPACE.
 *
 * GET /api/files/list?path=<relative>  → { items: FileEntry[] }
 *
 * Replaces the removed /api/browse endpoint with a sanitized, workspace-scoped
 * listing. Hidden files (dotfiles) are filtered out. No mutation methods.
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rel = searchParams.get('path') || '';

    // Empty path = workspace root. resolveSafe('workspace', '') returns the base.
    const dir = rel ? resolveSafe('workspace', rel) : OPENCLAW_WORKSPACE;
    if (!dir) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
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
      // Skip hidden and system files
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
        // Skip entries we can't stat (broken symlinks etc.)
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
