import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { logActivity } from '@/lib/activities-db';
import { resolveSafe, resolveSafeInWorkspace } from '@/lib/paths';

/**
 * Download a file from the OpenClaw workspace.
 *
 * GET /api/files/download?path=<relative>
 * GET /api/files/download?workspace=<id>&path=<relative>
 *
 * Hardening:
 *  - All path inputs go through resolveSafe / resolveSafeInWorkspace
 *    (rejects traversal + symlink escape, validates workspace id)
 *  - Sensitive / executable / archive formats blocked even within the workspace
 */

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.ts': 'text/plain',
    '.tsx': 'text/plain',
    '.js': 'text/javascript',
    '.jsx': 'text/javascript',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.py': 'text/plain',
    '.sh': 'text/plain',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.toml': 'text/plain',
    '.css': 'text/css',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

const BLOCKED_EXT = new Set([
  '.env', '.pem', '.key', '.p12', '.pfx',
  '.exe', '.dll', '.so', '.dylib',
  '.zip', '.tar', '.gz', '.tgz', '.7z',
]);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('path') || '';
    const workspaceId = searchParams.get('workspace');

    if (!filePath) {
      return NextResponse.json(
        { error: 'Missing path parameter' },
        { status: 400 },
      );
    }

    const fullPath =
      !workspaceId || workspaceId === 'workspace'
        ? resolveSafe('workspace', filePath)
        : resolveSafeInWorkspace(workspaceId, filePath);
    if (!fullPath) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    const basename = path.basename(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    if (BLOCKED_EXT.has(ext) || basename.startsWith('.env')) {
      return NextResponse.json(
        { error: 'File type not downloadable' },
        { status: 403 },
      );
    }

    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    const content = await fs.readFile(fullPath);

    // Fire-and-forget: the activity log is best-effort and we don't want to
    // block the file download on a Supabase round-trip.
    logActivity('file_read', `Downloaded file: ${filePath}`, 'success', {
      metadata: { filePath, size: stat.size },
    }).catch((err) => console.error('[files/download] audit failed:', err));

    return new NextResponse(content, {
      headers: {
        'Content-Type': getMimeType(basename),
        'Content-Disposition': `attachment; filename="${basename}"`,
        'Content-Length': stat.size.toString(),
      },
    });
  } catch (error) {
    console.error('[download] Error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
