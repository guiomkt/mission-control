import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveSafe } from '@/lib/paths';

/**
 * Read file content inline (for the preview modal).
 *
 * GET /api/files/content?path=<relative>
 *   Text-like files → JSON { content, mimeType, size }
 *   Image files    → binary with `Content-Disposition: inline` and the
 *                    correct image MIME (so <img src> works directly).
 *   Other binaries → 415 (use /api/files/download instead).
 *
 * Hardening:
 *  - resolveSafe() rejects traversal + symlink escape
 *  - Sensitive / executable / archive formats blocked
 *  - 1 MB ceiling for text content (avoid OOM on huge logs)
 */

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.mdx',
  '.txt', '.log', '.py', '.sh', '.yaml', '.yml', '.toml',
  '.css', '.html', '.sql', '.env.example', '.gitignore',
]);

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const BLOCKED_EXT = new Set([
  '.env', '.pem', '.key', '.p12', '.pfx',
  '.exe', '.dll', '.so', '.dylib',
  '.zip', '.tar', '.gz', '.tgz', '.7z',
]);

const MAX_TEXT_BYTES = 1_000_000; // 1 MB

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rel = searchParams.get('path') || '';
    if (!rel) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    }

    const full = resolveSafe('workspace', rel);
    if (!full) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 });
    }

    const basename = path.basename(full);
    const ext = path.extname(full).toLowerCase();
    if (BLOCKED_EXT.has(ext) || basename.startsWith('.env')) {
      return NextResponse.json(
        { error: 'File type not viewable' },
        { status: 403 },
      );
    }

    const stat = await fs.stat(full);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }

    // Image → binary inline
    if (IMAGE_MIME[ext]) {
      const data = await fs.readFile(full);
      return new NextResponse(data, {
        headers: {
          'Content-Type': IMAGE_MIME[ext],
          'Content-Disposition': `inline; filename="${basename}"`,
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    // Text-like → JSON payload
    if (TEXT_EXT.has(ext) || ext === '') {
      if (stat.size > MAX_TEXT_BYTES) {
        return NextResponse.json(
          { error: 'File too large to preview', size: stat.size, limit: MAX_TEXT_BYTES },
          { status: 413 },
        );
      }
      const content = await fs.readFile(full, 'utf-8');
      return NextResponse.json({
        path: rel,
        content,
        mimeType: ext === '.json' ? 'application/json' : 'text/plain',
        size: stat.size,
      });
    }

    return NextResponse.json(
      { error: 'Unsupported file type for inline view' },
      { status: 415 },
    );
  } catch (error) {
    console.error('[api/files/content] error', error);
    return NextResponse.json(
      { error: 'Failed to read file' },
      { status: 500 },
    );
  }
}
