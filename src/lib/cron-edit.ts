import { promises as fs } from 'fs';
import path from 'path';
import { OPENCLAW_DIR } from './paths';
import { listCrons, type CronEntry } from './openclaw-client';

/**
 * In-place mutator for the OpenClaw `crontab.txt` (V1 — option A).
 *
 * The panel mounts the rest of the OpenClaw data directory as read-only,
 * with `crontab.txt` bind-mounted separately as read-write so operators
 * can pause / enable / delete cron lines without needing a sidecar.
 *
 * Why truncate-write and not the usual write-tmp-then-rename atomic
 * pattern: when Docker bind-mounts a single file, `rename()` to that path
 * unlinks the bind-mount target and creates a new inode, which leaves the
 * container <-> host file lineage broken (the OpenClaw container would
 * keep reading the old data). Writing to the same inode with
 * `fs.writeFile` keeps the mapping intact. The window of inconsistency
 * is microseconds for a sub-2KB file, and supercronic debounces fsnotify
 * events anyway.
 *
 * Concurrency: we re-read the file under a single async tick before
 * editing, so the lineNumber we got from `listCrons()` is fresh. If two
 * operators race, the second one's mutation may apply to a moved line
 * — acceptable for the operator panel.
 */

const CRONTAB_FILE = path.join(OPENCLAW_DIR, 'crontab.txt');

async function loadCrontab(): Promise<{ lines: string[]; raw: string }> {
  const raw = await fs.readFile(CRONTAB_FILE, 'utf-8');
  return { raw, lines: raw.split('\n') };
}

async function writeCrontab(lines: string[]): Promise<void> {
  // Preserve trailing newline if the original had one (it should).
  const next = lines.join('\n');
  await fs.writeFile(CRONTAB_FILE, next, 'utf-8');
}

async function locate(id: string): Promise<CronEntry> {
  const entries = await listCrons();
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    const err = new Error(`Cron with id ${id} not found`);
    (err as Error & { status?: number }).status = 404;
    throw err;
  }
  return entry;
}

/**
 * Toggle a cron line between enabled (no leading `#`) and disabled
 * (single leading `# `). Idempotent: calling enable on an enabled entry
 * is a no-op.
 */
export async function setCronEnabled(id: string, enabled: boolean): Promise<CronEntry> {
  const entry = await locate(id);
  if (entry.enabled === enabled) return entry;

  const { lines } = await loadCrontab();
  const idx = entry.lineNumber;
  const original = lines[idx] ?? '';

  if (enabled) {
    // Drop leading `# ` (and any extra whitespace before it).
    lines[idx] = original.replace(/^\s*#\s*/, '');
  } else {
    // Prefix with `# `, but only if it isn't already commented.
    if (!/^\s*#/.test(original)) {
      lines[idx] = `# ${original}`;
    }
  }

  await writeCrontab(lines);
  return { ...entry, enabled };
}

/**
 * Remove the cron's line entirely. Any orphan human comment that lived
 * directly above is left in place — operators can clean up via the file
 * if it bothers them. We avoid touching adjacent lines because a comment
 * may belong to the entry below it.
 */
export async function deleteCron(id: string): Promise<CronEntry> {
  const entry = await locate(id);
  const { lines } = await loadCrontab();
  lines.splice(entry.lineNumber, 1);
  await writeCrontab(lines);
  return entry;
}
