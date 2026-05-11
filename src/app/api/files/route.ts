import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { OPENCLAW_WORKSPACE, resolveSafe } from '@/lib/paths';

/**
 * Read-only browser for the OpenClaw workspace's curated markdown.
 *
 * GET /api/files                  → returns the file tree
 * GET /api/files?path=MEMORY.md   → returns { path, content }
 *
 * Hardening (V1):
 *  - PUT removed; mutations no longer go through this endpoint
 *  - Workspace switching removed; always reads OPENCLAW_WORKSPACE
 *  - Path normalization + .md allowlist + memory/* gate
 *  - All concrete fs access funnelled through resolveSafe()
 */

const ROOT_FILES = [
  'MEMORY.md',
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'IDENTITY.md',
];
const MEMORY_DIR = 'memory';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function getFileTree(workspacePath: string): Promise<FileNode[]> {
  const tree: FileNode[] = [];

  for (const file of ROOT_FILES) {
    if (await fileExists(path.join(workspacePath, file))) {
      tree.push({ name: file, path: file, type: 'file' });
    }
  }

  const memoryPath = path.join(workspacePath, MEMORY_DIR);
  if (await fileExists(memoryPath)) {
    const memoryStats = await fs.stat(memoryPath);
    if (memoryStats.isDirectory()) {
      const memoryFiles = await fs.readdir(memoryPath);
      const children = memoryFiles
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse()
        .map<FileNode>((f) => ({
          name: f,
          path: `${MEMORY_DIR}/${f}`,
          type: 'file',
        }));

      if (children.length > 0) {
        tree.push({
          name: MEMORY_DIR,
          path: MEMORY_DIR,
          type: 'folder',
          children,
        });
      }
    }
  }

  return tree;
}

/** Defensive: reject anything not on the explicit list of readable files. */
function isWhitelistedPath(rel: string): boolean {
  if (!rel.endsWith('.md')) return false;
  if (ROOT_FILES.includes(rel)) return true;
  if (rel.startsWith(`${MEMORY_DIR}/`) && !rel.includes('..')) return true;
  return false;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');

  try {
    if (!(await fileExists(OPENCLAW_WORKSPACE))) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 },
      );
    }

    if (!filePath) {
      const tree = await getFileTree(OPENCLAW_WORKSPACE);
      return NextResponse.json(tree);
    }

    if (!isWhitelistedPath(filePath)) {
      return NextResponse.json(
        { error: 'Invalid file path' },
        { status: 400 },
      );
    }

    const fullPath = resolveSafe('workspace', filePath);
    if (!fullPath) {
      return NextResponse.json(
        { error: 'Invalid file path' },
        { status: 400 },
      );
    }

    if (!(await fileExists(fullPath))) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    return NextResponse.json({ path: filePath, content });
  } catch (error) {
    console.error('[api/files] read error', error);
    return NextResponse.json(
      { error: 'Failed to read file' },
      { status: 500 },
    );
  }
}
