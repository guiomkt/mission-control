/**
 * Helper centralizado pra executar comandos do OpenClaw dentro do
 * container `openclaw-kozw-openclaw-1` via o docker socket que o painel
 * tem bind-mounted (ver docker-compose.yml + entrypoint.sh).
 *
 * Padroniza:
 * - Timeout default de 15s (operações de config tem o SIGUSR1 reload no fim).
 * - Captura stdout + stderr separados.
 * - Rejeita comandos que tentem usar shell metacharacters.
 * - Lock global pra ops que mexem em openclaw.json — só um `channels add/
 *   remove` por vez, pra não corromper a config com edições simultâneas.
 */
import { spawn } from "child_process";

const OPENCLAW_CONTAINER = "openclaw-kozw-openclaw-1";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class OpenClawExecError extends Error {
  constructor(
    message: string,
    public readonly result: ExecResult,
  ) {
    super(message);
    this.name = "OpenClawExecError";
  }
}

/**
 * Roda `docker exec openclaw-kozw-openclaw-1 openclaw <args>` e devolve
 * stdout + stderr juntos. Lança `OpenClawExecError` em exit code != 0.
 *
 * Cada argumento é passado intacto ao spawn (sem `shell: true`), o que
 * elimina o risco de injection — se o caller passar `["foo; rm -rf"]`,
 * o openclaw vai receber esse argumento literal e rejeitar.
 */
export async function openclawExec(
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;

  return new Promise<ExecResult>((resolve, reject) => {
    const proc = spawn(
      "docker",
      ["exec", OPENCLAW_CONTAINER, "openclaw", ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      }, 1500);
      reject(
        new OpenClawExecError(
          `openclaw ${args.join(" ")} timed out after ${timeoutMs}ms`,
          { code: -1, stdout, stderr },
        ),
      );
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new OpenClawExecError(`spawn failed: ${err.message}`, {
          code: -1,
          stdout,
          stderr,
        }),
      );
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result: ExecResult = { code: code ?? -1, stdout, stderr };
      if (code === 0) {
        resolve(result);
      } else {
        reject(
          new OpenClawExecError(
            `openclaw ${args.join(" ")} exited with code ${code}`,
            result,
          ),
        );
      }
    });
  });
}

/**
 * Streaming spawn pra comandos interativos (WhatsApp pairing).
 * Caller fica responsável por consumir stdout/stderr via os listeners
 * que registrar, e por chamar `kill()` quando quiser cancelar.
 */
export function openclawSpawn(args: string[]) {
  return spawn(
    "docker",
    ["exec", "-i", OPENCLAW_CONTAINER, "openclaw", ...args],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

/**
 * Lock global pra ops mutativas (`channels add/remove`, `config set`).
 * O OpenClaw faz o reload via SIGUSR1 ao final de cada uma; correr duas
 * em paralelo causa o `openclaw.json` mais antigo a vencer no final do
 * write. Serializamos com uma Promise chain.
 */
let lastOp: Promise<unknown> = Promise.resolve();

export async function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lastOp.then(fn, fn);
  // Mantém a chain mesmo se uma das ops rejeitar; queremos que a próxima
  // espere o lado do reload independente de sucesso/erro.
  lastOp = next.catch(() => undefined);
  return next;
}

/**
 * Valida nome de conta — usado nos endpoints add/remove.
 * Aceita só [a-z0-9-], começa com letra, 1-30 chars.
 */
export function isValidAccountName(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-z][a-z0-9-]{0,29}$/.test(value)
  );
}

/**
 * Valida bot token Telegram: `<bot-id>:<secret>` onde o secret é
 * alfanumérico + alguns caracteres permitidos. Não tentamos validar
 * o secret semântica — só forma.
 */
export function isValidTelegramBotToken(value: unknown): value is string {
  return typeof value === "string" && /^\d+:[A-Za-z0-9_-]{20,}$/.test(value);
}
