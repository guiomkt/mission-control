/**
 * Skills management per-agent via OpenClaw CLI.
 *
 * Lista, busca no ClawHub, instala e desinstala skills. O CLI não tem
 * `skills uninstall` em 2026.5.7, então uninstall é manual:
 *  - rm -rf <workspace>/skills/<slug>/
 *  - edita <workspace>/.clawhub/lock.json removendo a entry
 * Tudo via docker exec no kozw como user `node` (UID 1000) pra
 * preservar ownership ubuntu:ubuntu.
 *
 * Performance note: `openclaw skills list` leva ~3s pra rodar (carrega
 * runtime + classifica eligibility). Os endpoints GET devem envolver
 * isso em `SingleFlightCache`.
 */
import { spawn } from "child_process";
import {
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";

const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";

// Skill slugs no ClawHub seguem padrão URL-safe.
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;
// Versions são semver soltos (com prefixo opcional `v`) ou tags.
const VERSION_REGEX = /^v?\d+\.\d+\.\d+(?:[-+][\w.]+)?$|^[a-zA-Z][\w.-]{0,30}$/;

export class SkillManagerError extends Error {
  constructor(
    message: string,
    public readonly stdout: string = "",
    public readonly stderr: string = "",
  ) {
    super(message);
    this.name = "SkillManagerError";
  }
}

export function isValidSkillSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_REGEX.test(value);
}

export function isValidSkillVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_REGEX.test(value);
}

// ── Types ────────────────────────────────────────────────────────────────

export interface SkillEntry {
  /** Slug (canonical id). O CLI chama "name" mas é o slug. */
  name: string;
  description: string;
  emoji?: string;
  /** True se requirements estão satisfeitos. */
  eligible: boolean;
  /** True se foi disabilitado por allowlist/filtro. */
  disabled: boolean;
  modelVisible: boolean;
  userInvocable: boolean;
  commandVisible: boolean;
  /** "openclaw-bundled" | "clawhub-installed" | "agents-skills-personal" | etc. */
  source: string;
  bundled: boolean;
  homepage?: string;
  missing?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
}

export interface SkillsListResult {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillEntry[];
}

export interface SearchHit {
  slug: string;
  displayName: string;
  summary: string;
  version: string | null;
  updatedAt: number;
  ownerHandle: string;
  score: number;
  owner?: {
    handle: string;
    displayName: string;
    image?: string;
  };
}

// ── List ─────────────────────────────────────────────────────────────────

export async function listSkills(agentId: string): Promise<SkillsListResult> {
  try {
    const result = await openclawExec(
      ["skills", "list", "--agent", agentId, "--json"],
      { timeoutMs: 30_000 },
    );
    // O CLI inclui warnings de config no stderr — stdout é puro JSON.
    const parsed = JSON.parse(result.stdout) as SkillsListResult;
    return parsed;
  } catch (err) {
    if (err instanceof OpenClawExecError) {
      throw new SkillManagerError(
        "openclaw skills list falhou",
        err.result.stdout,
        err.result.stderr,
      );
    }
    if (err instanceof Error && err.message.includes("JSON")) {
      throw new SkillManagerError("não consegui parsear skills list");
    }
    throw err;
  }
}

// ── Search ──────────────────────────────────────────────────────────────

export async function searchSkills(
  query: string,
  limit: number = 20,
): Promise<SearchHit[]> {
  if (limit < 1 || limit > 100) limit = 20;
  // Validação minimal — o CLI já sanitiza; rejeitamos só null bytes e
  // strings absurdas pra não estourar argv.
  if (typeof query !== "string" || query.includes("\0") || query.length > 200) {
    throw new SkillManagerError(`invalid query`);
  }
  const args = ["skills", "search"];
  const trimmed = query.trim();
  if (trimmed.length > 0) args.push(trimmed);
  args.push("--json", "--limit", String(limit));

  try {
    const result = await openclawExec(args, { timeoutMs: 30_000 });
    const parsed = JSON.parse(result.stdout) as
      | { hits?: SearchHit[]; results?: SearchHit[] }
      | SearchHit[];
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.hits)) return parsed.hits;
    if (Array.isArray(parsed.results)) return parsed.results;
    return [];
  } catch (err) {
    if (err instanceof OpenClawExecError) {
      throw new SkillManagerError(
        "openclaw skills search falhou",
        err.result.stdout,
        err.result.stderr,
      );
    }
    if (err instanceof Error && err.message.includes("JSON")) {
      throw new SkillManagerError("não consegui parsear skills search");
    }
    throw err;
  }
}

// ── Install ─────────────────────────────────────────────────────────────

export interface InstallResult {
  slug: string;
  version?: string;
  rawOutput: string;
}

export async function installSkill(
  agentId: string,
  slug: string,
  version?: string,
  options: { force?: boolean } = {},
): Promise<InstallResult> {
  if (!isValidSkillSlug(slug)) {
    throw new SkillManagerError(`invalid slug: ${slug}`);
  }
  if (version !== undefined && !isValidSkillVersion(version)) {
    throw new SkillManagerError(`invalid version: ${version}`);
  }
  const args = ["skills", "install", slug, "--agent", agentId];
  if (version) args.push("--version", version);
  if (options.force) args.push("--force");

  // Install pode demorar (download + unpack). Lock e timeout generosos.
  try {
    const result = await withConfigLock(() =>
      openclawExec(args, { timeoutMs: 90_000 }),
    );
    return {
      slug,
      version,
      rawOutput: result.stdout.trim(),
    };
  } catch (err) {
    if (err instanceof OpenClawExecError) {
      const detail = err.result.stderr || err.result.stdout;
      // 409 quando já está instalado (sem --force) — checamos pra UX
      // mais clara no caller.
      if (/already.installed|exists/i.test(detail)) {
        throw new SkillManagerError(
          "skill já instalada (use --force pra sobrescrever)",
          err.result.stdout,
          err.result.stderr,
        );
      }
      // 404 quando o slug não existe no ClawHub.
      if (/not.found|no.such|unknown.skill/i.test(detail)) {
        throw new SkillManagerError(
          "skill não encontrada no ClawHub",
          err.result.stdout,
          err.result.stderr,
        );
      }
      throw new SkillManagerError(
        "openclaw skills install falhou",
        err.result.stdout,
        err.result.stderr,
      );
    }
    throw err;
  }
}

// ── Uninstall ───────────────────────────────────────────────────────────

interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

function dockerExec(
  args: string[],
  options: { timeoutMs?: number; stdin?: string } = {},
): Promise<DockerResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, {
      stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(
        new SkillManagerError(
          `docker timed out after ${timeoutMs}ms`,
          stdout,
          stderr,
        ),
      );
    }, timeoutMs);

    proc.stdout!.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new SkillManagerError(`spawn failed: ${err.message}`, stdout, stderr),
      );
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });

    if (options.stdin !== undefined) {
      proc.stdin!.write(options.stdin);
      proc.stdin!.end();
    }
  });
}

/** "main" → "workspace", outros → "workspace-<id>". */
function workspaceFor(agentId: string): string {
  return agentId === "main"
    ? "/data/.openclaw/workspace"
    : `/data/.openclaw/workspace-${agentId}`;
}

export interface UninstallResult {
  slug: string;
  agentId: string;
  /** "removed" | "not_installed" */
  status: "removed" | "not_installed";
  rawOutput: string;
}

/**
 * Remove a skill do agente:
 *  1. rm -rf <workspace>/skills/<slug>/
 *  2. Edita <workspace>/.clawhub/lock.json removendo a entry
 *
 * Rejeita se slug for inválido (path traversal possível). Idempotente:
 * se a skill já não está instalada, retorna "not_installed".
 */
export async function uninstallSkill(
  agentId: string,
  slug: string,
): Promise<UninstallResult> {
  if (!isValidSkillSlug(slug)) {
    throw new SkillManagerError(`invalid slug: ${slug}`);
  }
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(agentId) && agentId !== "main") {
    throw new SkillManagerError(`invalid agentId: ${agentId}`);
  }

  const ws = workspaceFor(agentId);
  const slugDir = `${ws}/skills/${slug}`;
  const lockFile = `${ws}/.clawhub/lock.json`;

  // Script Python: edita lock.json removendo entry + rm -rf do dir.
  // Recebe slug via argv. Idempotente.
  const py = `
import json, sys, os, shutil

slug = sys.argv[1]
slug_dir = sys.argv[2]
lock_file = sys.argv[3]

dir_existed = os.path.isdir(slug_dir)
locked = False
if os.path.exists(lock_file):
    with open(lock_file) as f:
        lock = json.load(f)
    if isinstance(lock.get('skills'), dict) and slug in lock['skills']:
        locked = True

if not dir_existed and not locked:
    print('NOT_INSTALLED')
    sys.exit(0)

if dir_existed:
    shutil.rmtree(slug_dir)
if locked:
    del lock['skills'][slug]
    with open(lock_file, 'w') as f:
        json.dump(lock, f, indent=2)

print('REMOVED')
`;

  // Rodamos como user node (1000) dentro do kozw. Kozw tem python3 disponível.
  const result = await withConfigLock(() =>
    dockerExec(
      [
        "exec",
        "--user",
        "node",
        "-i",
        KOZW_CONTAINER,
        "python3",
        "-c",
        py,
        slug,
        slugDir,
        lockFile,
      ],
      { timeoutMs: 30_000 },
    ),
  );

  if (result.code !== 0) {
    throw new SkillManagerError(
      `uninstall failed (exit ${result.code})`,
      result.stdout,
      result.stderr,
    );
  }

  const out = result.stdout.trim();
  if (out === "NOT_INSTALLED") {
    return { slug, agentId, status: "not_installed", rawOutput: out };
  }
  return { slug, agentId, status: "removed", rawOutput: out };
}
