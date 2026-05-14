/**
 * Fallback de remoção de canal quando o `openclaw channels remove --delete`
 * falha com o bug "Channel plugin X is not installed" (mismatch de versão
 * gateway-vs-plugin que aparece intermitentemente em 2026.5.7).
 *
 * Estratégia: editar `openclaw.json` direto via container alpine efêmero
 * com bind-mount RW pro diretório `/docker/openclaw-kozw/data/.openclaw/`
 * do host, deletar a entry `channels.<channel>.accounts.<account>`, e
 * reiniciar o container kozw pra forçar reload da config.
 *
 * Faz backup automático `openclaw.json.bak.<timestamp>` antes da escrita.
 *
 * Segurança:
 *  - `channel` e `account` são passados como argv ao python, não como
 *    string interpolada no shell — sem injection.
 *  - Validação prévia: caller já garante regex de account name; channel
 *    é checado contra whitelist ("whatsapp" | "telegram").
 *  - Spawn sem `shell: true`.
 */
import { spawn } from "child_process";
import { withConfigLock } from "@/lib/openclaw-exec";

const KOZW_OPENCLAW_DIR = "/docker/openclaw-kozw/data/.openclaw";
const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";

type SupportedChannel = "whatsapp" | "telegram";

export class ChannelConfigError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "ChannelConfigError";
  }
}

/** Heurística pra detectar o bug do CLI que motiva o fallback. */
export function isPluginNotInstalledBug(
  stderr: string,
  stdout: string,
): boolean {
  const combined = `${stderr}\n${stdout}`;
  return /(?:Channel )?[Pp]lugin\s+["'][^"']+["']\s+is\s+not\s+installed/i.test(
    combined,
  );
}

function runDocker(
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(
        new ChannelConfigError(
          `docker ${args[0]} timed out after ${timeoutMs}ms`,
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
      reject(new ChannelConfigError(`spawn failed: ${err.message}`, stdout, stderr));
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

// Script Python que edita openclaw.json. Recebe (channel, account) como
// argv[1], argv[2]. Idempotente: se a conta já não existe, retorna
// "not_present" e exit 0.
const PY_SCRIPT = `
import json, sys, time, shutil, os
ch = sys.argv[1]
acc = sys.argv[2]
path = '/work/openclaw.json'
with open(path) as f:
    d = json.load(f)
accounts = d.get('channels', {}).get(ch, {}).get('accounts')
if not isinstance(accounts, dict) or acc not in accounts:
    print('not_present')
    sys.exit(0)
ts = int(time.time())
shutil.copyfile(path, path + '.bak.' + str(ts))
del accounts[acc]
with open(path, 'w') as f:
    json.dump(d, f, indent=2)
print('removed ts=' + str(ts))
`;

export interface RemoveResult {
  /** "removed" | "not_present" */
  status: "removed" | "not_present";
  backupTimestamp?: string;
  restarted: boolean;
  rawOutput: string;
}

/**
 * Remove uma conta de canal direto do openclaw.json + reinicia o kozw.
 *
 * Use quando o `openclaw channels remove --delete` falha. Se a config
 * já não tinha a conta, devolve `not_present` sem reiniciar.
 */
export async function removeChannelAccountFromConfig(
  channel: SupportedChannel,
  account: string,
  options: { restart?: boolean } = {},
): Promise<RemoveResult> {
  if (channel !== "whatsapp" && channel !== "telegram") {
    throw new ChannelConfigError(
      `unsupported channel: ${channel}`,
      "",
      "expected whatsapp|telegram",
    );
  }
  if (!/^[a-z][a-z0-9-]{0,29}$/.test(account)) {
    throw new ChannelConfigError(
      `invalid account name: ${account}`,
      "",
      "must match [a-z][a-z0-9-]{0,29}",
    );
  }

  return withConfigLock(async () => {
    const editResult = await runDocker(
      [
        "run",
        "--rm",
        "-v",
        `${KOZW_OPENCLAW_DIR}:/work`,
        "python:3.12-alpine",
        "python3",
        "-c",
        PY_SCRIPT,
        channel,
        account,
      ],
      30_000,
    );
    if (editResult.code !== 0) {
      throw new ChannelConfigError(
        `openclaw.json edit failed (exit ${editResult.code})`,
        editResult.stdout,
        editResult.stderr,
      );
    }
    const rawOutput = editResult.stdout.trim();

    if (rawOutput.startsWith("not_present")) {
      return {
        status: "not_present" as const,
        restarted: false,
        rawOutput,
      };
    }

    // status === "removed"
    const backupMatch = rawOutput.match(/ts=(\d+)/);
    const backupTimestamp = backupMatch?.[1];

    let restarted = false;
    if (options.restart !== false) {
      const restartResult = await runDocker(
        ["restart", KOZW_CONTAINER],
        60_000,
      );
      if (restartResult.code !== 0) {
        throw new ChannelConfigError(
          `docker restart ${KOZW_CONTAINER} failed (exit ${restartResult.code})`,
          restartResult.stdout,
          restartResult.stderr,
        );
      }
      restarted = true;
    }

    return {
      status: "removed" as const,
      backupTimestamp,
      restarted,
      rawOutput,
    };
  });
}
