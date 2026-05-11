import path from 'path';
import { realpathSync } from 'fs';

/**
 * Centralized path configuration + allowlist enforcement.
 *
 * In production we run inside a container and mount the OpenClaw data
 * directory as a read-only volume at /workspace. Override via env vars
 * for local development or alternate layouts.
 *
 * NEVER call fs from a route with a user-supplied path without first
 * passing it through `resolveSafe(baseId, requested)`. That helper:
 *   - rejects absolute paths
 *   - normalizes ../ traversal attempts
 *   - resolves symlinks (so a link pointing outside the allowlist is rejected)
 *   - confirms the final resolved path is under an allowed prefix
 */

// ── Base directories ────────────────────────────────────────────────────────
export const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/workspace';
export const OPENCLAW_WORKSPACE =
  process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_DIR, 'workspace');
export const OPENCLAW_CONFIG = path.join(OPENCLAW_DIR, 'openclaw.json');
export const OPENCLAW_MEDIA = path.join(OPENCLAW_DIR, 'media');

export const WORKSPACE_IDENTITY = path.join(OPENCLAW_WORKSPACE, 'IDENTITY.md');
export const WORKSPACE_TOOLS = path.join(OPENCLAW_WORKSPACE, 'TOOLS.md');
export const WORKSPACE_MEMORY = path.join(OPENCLAW_WORKSPACE, 'memory');

export const SYSTEM_SKILLS_PATH = '/usr/lib/node_modules/openclaw/skills';
export const WORKSPACE_SKILLS_PATH = path.join(
  OPENCLAW_DIR,
  'workspace-infra',
  'skills',
);

// ── Allowlist ───────────────────────────────────────────────────────────────
/**
 * Named bases that user-supplied paths can be resolved against.
 * Each base resolves to an absolute prefix; nothing outside these prefixes
 * is ever served.
 */
export const BASES = {
  workspace: OPENCLAW_WORKSPACE,
  media: OPENCLAW_MEDIA,
} as const;

export type BaseId = keyof typeof BASES;

/** Backwards-compat: media wildcard route still references this. */
export const ALLOWED_MEDIA_PREFIXES = [
  path.join(OPENCLAW_WORKSPACE, '/'),
  path.join(OPENCLAW_MEDIA, '/'),
];

// ── Safe path resolution ────────────────────────────────────────────────────
function isUnderPrefix(target: string, prefix: string): boolean {
  // ensure trailing separator on prefix so /foo doesn't match /foobar
  const p = prefix.endsWith(path.sep) ? prefix : prefix + path.sep;
  return target === prefix || target.startsWith(p);
}

/**
 * Resolve a user-supplied relative path against a named base. Returns
 * `null` if the request would escape the base or hit a symlink that
 * escapes it.
 *
 * Use this in every route that touches the filesystem with a user input.
 */
export function resolveSafe(
  baseId: BaseId,
  requested: string,
): string | null {
  if (typeof requested !== 'string') return null;
  // Absolute paths and explicit traversal segments are rejected outright.
  if (path.isAbsolute(requested)) return null;

  const base = BASES[baseId];
  const joined = path.resolve(base, requested);

  // Plain prefix check (handles ../ that normalize() couldn't fix).
  if (!isUnderPrefix(joined, base)) return null;

  // Resolve symlinks if the path exists. If realpath escapes the base,
  // reject — protects against attacker-planted symlinks.
  try {
    const real = realpathSync(joined);
    if (!isUnderPrefix(real, base)) return null;
    return real;
  } catch {
    // File doesn't exist (yet) — return the resolved literal path. Callers
    // are expected to handle ENOENT downstream.
    return joined;
  }
}

/**
 * True if `absPath` lies under any allowed prefix. Use for incoming
 * already-absolute paths (e.g. media wildcard route after building the URL).
 */
export function isPathAllowed(absPath: string): boolean {
  return Object.values(BASES).some((b) => isUnderPrefix(absPath, b));
}
