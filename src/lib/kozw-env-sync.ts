/**
 * Sincroniza um par envName=value com o arquivo `/docker/openclaw-kozw/.env`
 * no HOST (não no container do painel), e em seguida reinicia o container
 * `openclaw-kozw-openclaw-1` pra que a nova var entre em vigor.
 *
 * Por que container efêmero?
 *   O painel tem socket docker bind-mountado (read-only), mas NÃO tem o
 *   diretório `/docker/openclaw-kozw/` montado. A forma menos invasiva
 *   de editar o arquivo é spawnar um container alpine descartável com
 *   bind-mount RW pro diretório, rodar a edição, e descartar.
 *
 * Sobre o restart:
 *   O CLI do OpenClaw não tem `plugins reload`. Mudar uma env var exige
 *   relançar o processo. `docker restart` causa ~3-5s de downtime do
 *   gateway — aceitável pra uma operação manual de rotação de chave.
 *
 * Segurança:
 *   - Spawn sem `shell: true` — argumentos passam intactos pro alpine.
 *   - O valor da chave NUNCA aparece como argumento de linha de comando
 *     (que seria visível em `ps`). Em vez disso, escrevemos o script
 *     completo no stdin do `sh -c` via heredoc-style encoding.
 *   - Validação de envName antes de qualquer escrita (regex estrito).
 */
import { spawn } from "child_process";
import { withConfigLock } from "@/lib/openclaw-exec";

const KOZW_DIR_ON_HOST = "/docker/openclaw-kozw";
const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";

const VALID_ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export interface EnvSyncResult {
  stdout: string;
  stderr: string;
  restarted: boolean;
}

export class EnvSyncError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "EnvSyncError";
  }
}

interface SpawnOptions {
  /** Conteúdo a injetar no stdin do processo. */
  stdin?: string;
  timeoutMs?: number;
}

function runDocker(
  args: string[],
  options: SpawnOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? 30_000;
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
        new EnvSyncError(
          `docker ${args.join(" ")} timed out after ${timeoutMs}ms`,
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
      reject(new EnvSyncError(`spawn failed: ${err.message}`, stdout, stderr));
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

/**
 * Aplica (upsert) ou remove (value=null) uma env var no arquivo .env do
 * gateway kozw. Sempre tira um backup `.env.bak.<ts>` antes.
 *
 * Side effect: reinicia o container kozw após a escrita pra que o env
 * novo entre em vigor (a menos que `restart: false` seja passado).
 */
export async function applyEnvToKozw(
  envName: string,
  value: string | null,
  options: { restart?: boolean } = {},
): Promise<EnvSyncResult> {
  if (!VALID_ENV_NAME.test(envName)) {
    throw new EnvSyncError(
      `invalid env name: ${envName}`,
      "",
      "envName must match /^[A-Z][A-Z0-9_]{0,63}$/",
    );
  }

  return withConfigLock(async () => {
    // Script que roda dentro do alpine. Lê stdin (2 linhas: NAME, VALUE)
    // pra evitar expor o valor em `ps aux` no host. Estratégia:
    //   1. Backup .env
    //   2. Filtrar linhas existentes que comecem com `${NAME}=`
    //   3. Se value não é vazio, append `NAME=VALUE` no final
    //
    // Não interpretamos `VAL` via shell — `printf '%s'` preserva o valor
    // bruto. Não usamos `sed` com /pattern/ pra evitar escaping infernal
    // com chars especiais; preferimos `awk` que toma o pattern como string
    // literal via -v.
    const script = `
set -eu
cd /work
TS=$(date +%s)
INPUT=$(cat)
NAME=$(printf '%s' "$INPUT" | head -n1)
VAL=$(printf '%s' "$INPUT" | tail -n +2)
if [ ! -f .env ]; then
  echo "missing .env" >&2
  exit 2
fi
cp .env .env.bak.$TS
awk -v name="$NAME" 'index($0, name "=") != 1 { print }' .env > .env.new
mv .env.new .env
if [ -n "$VAL" ]; then
  printf '%s=%s\n' "$NAME" "$VAL" >> .env
fi
echo "ok ts=$TS"
`;
    // Stdin: nome na linha 1, valor na linha 2.
    const stdin = `${envName}\n${value ?? ""}\n`;

    const editArgs = [
      "run",
      "--rm",
      "-i",
      "-v",
      `${KOZW_DIR_ON_HOST}:/work`,
      "alpine:3.19",
      "sh",
      "-c",
      script,
    ];

    const editResult = await runDocker(editArgs, {
      stdin,
      timeoutMs: 15_000,
    });
    if (editResult.code !== 0) {
      throw new EnvSyncError(
        `.env edit failed (exit ${editResult.code})`,
        editResult.stdout,
        editResult.stderr,
      );
    }

    let restarted = false;
    if (options.restart !== false) {
      const restartResult = await runDocker(["restart", KOZW_CONTAINER], {
        timeoutMs: 60_000,
      });
      if (restartResult.code !== 0) {
        throw new EnvSyncError(
          `docker restart ${KOZW_CONTAINER} failed (exit ${restartResult.code})`,
          restartResult.stdout,
          restartResult.stderr,
        );
      }
      restarted = true;
    }

    return {
      stdout: editResult.stdout.trim(),
      stderr: editResult.stderr.trim(),
      restarted,
    };
  });
}

/**
 * Lê o valor atual de uma env var do container kozw via `docker inspect`.
 * Usado pra detectar chaves "legado" (existem no container mas não na
 * tabela do painel) e pra fluxo "Migrar pro painel".
 */
export async function readEnvFromKozw(
  envName: string,
): Promise<string | null> {
  if (!VALID_ENV_NAME.test(envName)) return null;
  // `docker inspect` retorna o array Config.Env do container. Filtra
  // localmente — não passamos envName pro shell, então sem injection.
  const result = await runDocker(
    ["inspect", "--format", "{{json .Config.Env}}", KOZW_CONTAINER],
    { timeoutMs: 10_000 },
  );
  if (result.code !== 0) return null;
  try {
    const list = JSON.parse(result.stdout.trim()) as string[];
    for (const entry of list) {
      const idx = entry.indexOf("=");
      if (idx < 0) continue;
      if (entry.slice(0, idx) === envName) {
        return entry.slice(idx + 1);
      }
    }
  } catch {
    return null;
  }
  return null;
}
