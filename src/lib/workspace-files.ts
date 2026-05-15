/**
 * Leitura e escrita de markdowns "cérebro" de um agente — SOUL.md,
 * IDENTITY.md, PROCESS.md, MEMORY.md, USER.md, TOOLS.md, etc.
 *
 * Layout (no host):
 *   /docker/openclaw-kozw/data/.openclaw/workspace            (main)
 *   /docker/openclaw-kozw/data/.openclaw/workspace-<id>       (per agent)
 *
 * No painel:
 *   /workspace                                                (RO mount)
 *
 * No kozw:
 *   /data/.openclaw/workspace, /data/.openclaw/workspace-<id> (RW)
 *
 * Decisões:
 *  - **Read** vai direto pelo mount RO do painel (rápido, sem container spawn).
 *  - **Write** entra no container do kozw como user `node` (UID 1000) pra
 *    preservar o ownership ubuntu:ubuntu existente. kozw já tem git
 *    instalado — usamos o mesmo container ao invés de alpine efêmero.
 *  - Cada save vira um commit no git do workspace ("panel: edit FILE")
 *    pra ter histórico revertível.
 *  - Conteúdo passado via stdin pro shell — sem escape risk, mesmo se
 *    o markdown tiver `$`, backticks, etc.
 *  - Whitelist hardcoded de filenames (sem path traversal possível).
 *  - Tamanho cap em 256 KB (markdown gigante = provavelmente erro).
 */
import { promises as fs } from "fs";
import { spawn } from "child_process";
import path from "path";
import {
  OPENCLAW_DIR,
  resolveSafeInWorkspace,
} from "@/lib/paths";

const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";

/** Filenames editáveis pela UI. Tudo fora dessa lista é rejeitado. */
export const EDITABLE_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "PROCESS.md",
  "MEMORY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "PROMPT_BANK.md",
  "AGENTS.md",
  "OPERATING_INDEX.md",
] as const;
export type EditableFile = (typeof EDITABLE_FILES)[number];

export const MAX_FILE_BYTES = 256 * 1024; // 256 KB

export class WorkspaceFileError extends Error {
  constructor(
    message: string,
    public readonly stdout: string = "",
    public readonly stderr: string = "",
  ) {
    super(message);
    this.name = "WorkspaceFileError";
  }
}

// ── Path helpers ─────────────────────────────────────────────────────────

/** "main" → "workspace", outros → "workspace-<id>". */
function workspaceIdFor(agentId: string): string {
  return agentId === "main" ? "workspace" : `workspace-${agentId}`;
}

/** Path absoluto dentro do mount RO do painel (pra leitura). */
function panelReadPath(agentId: string, filename: string): string | null {
  return resolveSafeInWorkspace(workspaceIdFor(agentId), filename);
}

/** Path absoluto dentro do kozw (pra escrita via docker exec). */
function kozwWritePath(agentId: string, filename: string): string {
  return `/data/.openclaw/${workspaceIdFor(agentId)}/${filename}`;
}

/** Root do workspace dentro do kozw (pra ops de git). */
function kozwWorkspaceRoot(agentId: string): string {
  return `/data/.openclaw/${workspaceIdFor(agentId)}`;
}

/** Valida filename contra whitelist. */
export function isEditableFile(name: string): name is EditableFile {
  return (EDITABLE_FILES as readonly string[]).includes(name);
}

// ── docker exec runner ───────────────────────────────────────────────────

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function dockerExec(
  args: string[],
  options: { timeoutMs?: number; stdin?: string } = {},
): Promise<ExecResult> {
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
        new WorkspaceFileError(
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
      reject(new WorkspaceFileError(`spawn failed: ${err.message}`, stdout, stderr));
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

// ── List ─────────────────────────────────────────────────────────────────

export interface WorkspaceFileInfo {
  filename: EditableFile;
  exists: boolean;
  size?: number;
  mtimeMs?: number;
}

/** Lista whitelist intersectada com o que existe no workspace. */
export async function listWorkspaceFiles(
  agentId: string,
): Promise<WorkspaceFileInfo[]> {
  const results: WorkspaceFileInfo[] = [];
  for (const filename of EDITABLE_FILES) {
    const absPath = panelReadPath(agentId, filename);
    if (!absPath) {
      results.push({ filename, exists: false });
      continue;
    }
    try {
      const stat = await fs.stat(absPath);
      results.push({
        filename,
        exists: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      results.push({ filename, exists: false });
    }
  }
  return results;
}

// ── Read ─────────────────────────────────────────────────────────────────

export interface ReadResult {
  filename: EditableFile;
  content: string;
  mtimeMs: number;
  size: number;
}

export async function readWorkspaceFile(
  agentId: string,
  filename: string,
): Promise<ReadResult | null> {
  if (!isEditableFile(filename)) {
    throw new WorkspaceFileError(`file not in whitelist: ${filename}`);
  }
  const absPath = panelReadPath(agentId, filename);
  if (!absPath) return null;
  try {
    const [stat, content] = await Promise.all([
      fs.stat(absPath),
      fs.readFile(absPath, "utf-8"),
    ]);
    return {
      filename,
      content,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
}

// ── Write ────────────────────────────────────────────────────────────────

export interface WriteOptions {
  /** Mensagem custom de commit. Default: "panel: edit <file>". */
  commitMessage?: string;
  /** Identificador do operador pra audit trail no commit. */
  author?: string;
}

export interface WriteResult {
  filename: EditableFile;
  bytesWritten: number;
  commitSha?: string;
  noChange: boolean;
}

/**
 * Escreve `content` em <workspace>/<filename> via docker exec no kozw,
 * preservando ownership 1000:1000. Auto-commita no git do workspace.
 *
 * Atomicidade: usa write em tmpfile + rename. Se git falhar no commit
 * (ex: nothing to commit), retorna `noChange: true`.
 */
export async function writeWorkspaceFile(
  agentId: string,
  filename: string,
  content: string,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (!isEditableFile(filename)) {
    throw new WorkspaceFileError(`file not in whitelist: ${filename}`);
  }
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > MAX_FILE_BYTES) {
    throw new WorkspaceFileError(
      `content too large: ${bytes} bytes (max ${MAX_FILE_BYTES})`,
    );
  }
  // Validação de UTF-8: byteLength já garante encoding limpo do lado JS,
  // mas vamos rejeitar bytes nulos que podem corromper o git.
  if (content.includes("\0")) {
    throw new WorkspaceFileError("content contains null bytes");
  }

  const wsRoot = kozwWorkspaceRoot(agentId);
  const target = kozwWritePath(agentId, filename);
  const tmp = `${target}.tmp.panel.${Date.now()}`;
  const commitMsg = (
    options.commitMessage ?? `panel: edit ${filename}`
  ).replace(/[\r\n]+/g, " ");
  const authorTag = options.author
    ? ` (operator: ${options.author.slice(0, 60)})`
    : "";

  // Shell script rodado dentro do kozw como user node (UID 1000). Recebe
  // conteúdo via stdin → tmpfile → mv atomico → git add + commit.
  // `set -e` interrompe na primeira falha; nothing-to-commit é tratado
  // explicitamente pelo grep do git status.
  const script = `
set -e
cd "${wsRoot}"
# read all of stdin -> tmpfile
cat > "${tmp}"
mv "${tmp}" "${target}"
git config user.email "panel@mc.local" >/dev/null
git config user.name "Mission Control Panel" >/dev/null
git add -- "${filename}"
# Se o conteúdo não mudou, git status fica vazio. Sai com NOCHANGE.
if git diff --cached --quiet -- "${filename}"; then
  echo "NOCHANGE"
  exit 0
fi
git commit --quiet -m "${commitMsg.replace(/"/g, '\\"')}${authorTag.replace(/"/g, '\\"')}"
git rev-parse --short HEAD
`;

  const result = await dockerExec(
    [
      "exec",
      "--user",
      "node",
      "-i",
      KOZW_CONTAINER,
      "sh",
      "-c",
      script,
    ],
    { timeoutMs: 20_000, stdin: content },
  );

  if (result.code !== 0) {
    throw new WorkspaceFileError(
      `workspace write failed (exit ${result.code})`,
      result.stdout,
      result.stderr,
    );
  }

  const trimmed = result.stdout.trim();
  if (trimmed === "NOCHANGE") {
    return { filename, bytesWritten: bytes, noChange: true };
  }
  // stdout deve ser o short SHA do commit.
  const sha = trimmed.split(/\s+/).pop() ?? "";
  return {
    filename,
    bytesWritten: bytes,
    commitSha: sha || undefined,
    noChange: false,
  };
}

// ── Git history ──────────────────────────────────────────────────────────

export interface CommitEntry {
  sha: string;
  date: string;
  author: string;
  subject: string;
}

/** Retorna últimos N commits que tocaram esse arquivo. */
export async function fileHistory(
  agentId: string,
  filename: string,
  limit: number = 20,
): Promise<CommitEntry[]> {
  if (!isEditableFile(filename)) {
    throw new WorkspaceFileError(`file not in whitelist: ${filename}`);
  }
  if (limit < 1 || limit > 100) limit = 20;

  const wsRoot = kozwWorkspaceRoot(agentId);
  // Format: SHA<TAB>ISO_DATE<TAB>AUTHOR<TAB>SUBJECT
  const result = await dockerExec(
    [
      "exec",
      "--user",
      "node",
      KOZW_CONTAINER,
      "git",
      "-C",
      wsRoot,
      "log",
      `-n`,
      String(limit),
      "--pretty=format:%h%x09%aI%x09%an%x09%s",
      "--",
      filename,
    ],
    { timeoutMs: 10_000 },
  );

  if (result.code !== 0) {
    // Provável: arquivo nunca commitado ainda → não é erro fatal.
    if (/does not have any commits|unknown revision|no such path/i.test(result.stderr)) {
      return [];
    }
    throw new WorkspaceFileError(
      `git log failed (exit ${result.code})`,
      result.stdout,
      result.stderr,
    );
  }

  return result.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [sha, date, author, ...rest] = line.split("\t");
      return {
        sha,
        date,
        author,
        subject: rest.join("\t"),
      };
    });
}

/** Retorna o conteúdo do arquivo em um commit específico (pra preview/restore). */
export async function fileAtCommit(
  agentId: string,
  filename: string,
  sha: string,
): Promise<string | null> {
  if (!isEditableFile(filename)) {
    throw new WorkspaceFileError(`file not in whitelist: ${filename}`);
  }
  // SHA short é 7+ chars hex. Aceitamos até 40 (full SHA).
  if (!/^[0-9a-f]{4,40}$/.test(sha)) {
    throw new WorkspaceFileError(`invalid sha: ${sha}`);
  }
  const wsRoot = kozwWorkspaceRoot(agentId);
  const result = await dockerExec(
    [
      "exec",
      "--user",
      "node",
      KOZW_CONTAINER,
      "git",
      "-C",
      wsRoot,
      "show",
      `${sha}:${filename}`,
    ],
    { timeoutMs: 10_000 },
  );
  if (result.code !== 0) {
    if (/does not exist|bad object|exists on disk, but not in/i.test(result.stderr)) {
      return null;
    }
    throw new WorkspaceFileError(
      `git show failed (exit ${result.code})`,
      result.stdout,
      result.stderr,
    );
  }
  return result.stdout;
}

// ── Sanity exports ───────────────────────────────────────────────────────

/** Pra audit log: retorna a tupla canonical de identificação. */
export function describeTarget(agentId: string, filename: string): string {
  return `${workspaceIdFor(agentId)}/${filename}`;
}

// Side-channel: expor o path resolvido pra logs/erros. Não permite write
// direto — só leitura.
export function describePanelPath(
  agentId: string,
  filename: string,
): string | null {
  const safe = panelReadPath(agentId, filename);
  if (!safe) return null;
  return path.relative(OPENCLAW_DIR, safe);
}
