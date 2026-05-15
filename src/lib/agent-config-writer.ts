/**
 * Helper pra mutar `agents.list[i]` em `openclaw.json` de forma atômica.
 *
 * Por que existe (e não usa o CLI):
 *  - `openclaw agents set-identity` cobre identity, mas NÃO cobre
 *    `subagents.allowAgents` nem `heartbeat.*` — esses campos só são
 *    editáveis via JSON direto.
 *  - `openclaw channels remove` tem bug conhecido em 2026.5.7; o pattern
 *    de container alpine efêmero com bind-mount RW (ver
 *    `openclaw-channel-config.ts`) é o caminho que já provou funcionar.
 *
 * Decisões de segurança:
 *  - Whitelist de chaves mutáveis por agente: APENAS `subagents` e
 *    `heartbeat`. Tentar mutar `id`/`identity`/`workspace`/`agentDir`
 *    é rejeitado — pra essas use o CLI (`set-identity`).
 *  - Proibido tocar em `agents.defaults` — o auto-heal do kozw restaura
 *    defaults no boot e os modelos que removemos (pagos) voltariam.
 *  - Backup automático `openclaw.json.bak.<timestamp>` antes de cada write.
 *  - Tudo envolto em `withConfigLock` pra serializar mutações.
 *  - NÃO reinicia o kozw — heartbeat/subagents são lidos a cada
 *    tick/spawn do gateway. Restart traria o risco do auto-heal apagar
 *    aliases pagos que removemos manualmente.
 */
import { spawn } from "child_process";
import { withConfigLock } from "@/lib/openclaw-exec";

const KOZW_OPENCLAW_DIR = "/docker/openclaw-kozw/data/.openclaw";

/** Campos em `agents.list[i]` que esse helper aceita escrever. */
export type AgentMutableKey = "subagents" | "heartbeat" | "model";

export interface AgentSubagents {
  allowAgents: string[];
}

export interface AgentHeartbeat {
  every?: string;
  activeHours?: {
    start?: string;
    end?: string;
    timezone?: string;
  };
  target?: string;
  to?: string;
  accountId?: string;
  lightContext?: boolean;
  isolatedSession?: boolean;
}

export interface AgentModel {
  /** Modelo primário (formato: provider/slug, ex: openai-codex/gpt-5.4). */
  primary: string;
  /** Lista de fallbacks ordenada. */
  fallbacks?: string[];
}

export interface AgentMutation {
  /** Setar `agents.list[i].subagents`. `null` remove a chave inteira. */
  subagents?: AgentSubagents | null;
  /** Setar `agents.list[i].heartbeat`. `null` remove a chave inteira. */
  heartbeat?: AgentHeartbeat | null;
  /**
   * Setar `agents.list[i].model`. `null` remove (volta pro defaults).
   * **Whitelist OAuth-only enforced no caller** — esse módulo só
   * persiste; quem chama precisa validar.
   */
  model?: AgentModel | null;
}

export class AgentConfigWriterError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "AgentConfigWriterError";
  }
}

export interface MutationResult {
  status: "ok" | "agent_not_found" | "no_change";
  backupTimestamp?: string;
  /** Snapshot do agente DEPOIS da mutação (pra audit). */
  after?: Record<string, unknown>;
  rawOutput: string;
}

function runDocker(
  args: string[],
  timeoutMs: number,
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", args, {
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(
        new AgentConfigWriterError(
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
      reject(
        new AgentConfigWriterError(
          `spawn failed: ${err.message}`,
          stdout,
          stderr,
        ),
      );
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });

    if (stdin) {
      proc.stdin!.write(stdin);
      proc.stdin!.end();
    }
  });
}

// Script Python que faz read+mutate+write. Recebe o payload de mutação
// via stdin (JSON), identifica o agente por argv[1].
//
// Idempotente: se a mutação não muda nada, devolve "no_change" sem
// criar backup.
//
// Se o agente não existir em `agents.list[]`, devolve "agent_not_found"
// e exit 0 (não é erro de execução, é erro de domínio).
//
// Whitelist hardcoded: só aceita as chaves `subagents` e `heartbeat`.
// Valores `null` removem a chave do agente.
const PY_SCRIPT = `
import json, sys, time, shutil

agent_id = sys.argv[1]
patch = json.loads(sys.stdin.read())
ALLOWED_KEYS = {"subagents", "heartbeat", "model"}

bad = [k for k in patch.keys() if k not in ALLOWED_KEYS]
if bad:
    print(json.dumps({"status": "error", "detail": "forbidden keys: " + ",".join(bad)}))
    sys.exit(2)

path = "/work/openclaw.json"
with open(path) as f:
    cfg = json.load(f)

lst = cfg.get("agents", {}).get("list", [])
if not isinstance(lst, list):
    print(json.dumps({"status": "error", "detail": "agents.list is not an array"}))
    sys.exit(3)

idx = next((i for i, a in enumerate(lst) if isinstance(a, dict) and a.get("id") == agent_id), -1)
if idx < 0:
    print(json.dumps({"status": "agent_not_found"}))
    sys.exit(0)

agent = lst[idx]
changed = False
for key, value in patch.items():
    if value is None:
        if key in agent:
            del agent[key]
            changed = True
    else:
        # Comparação de igualdade JSON: serializar nos dois lados.
        before = json.dumps(agent.get(key), sort_keys=True) if key in agent else None
        after = json.dumps(value, sort_keys=True)
        if before != after:
            agent[key] = value
            changed = True

if not changed:
    print(json.dumps({"status": "no_change", "after": agent}))
    sys.exit(0)

ts = int(time.time())
shutil.copyfile(path, path + ".bak." + str(ts))
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
print(json.dumps({"status": "ok", "backup_ts": str(ts), "after": agent}))
`;

/**
 * Aplica mutação a `agents.list[i]` matching `agentId`, atomicamente.
 *
 * Lança se: timeout, docker falha, container falha, ou agent.list não é array.
 * Devolve status `agent_not_found` se ID não bate (não é exception — é estado).
 */
export async function mutateAgentEntry(
  agentId: string,
  mutation: AgentMutation,
): Promise<MutationResult> {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(agentId)) {
    throw new AgentConfigWriterError(
      `invalid agentId: ${agentId}`,
      "",
      "must match [a-z][a-z0-9-]{0,39}",
    );
  }
  if (Object.keys(mutation).length === 0) {
    throw new AgentConfigWriterError(
      "empty mutation",
      "",
      "send at least one of: subagents, heartbeat",
    );
  }
  // Validação adicional: filtra chaves desconhecidas no client-side
  // antes de chegar no container.
  const filtered: AgentMutation = {};
  if ("subagents" in mutation) filtered.subagents = mutation.subagents;
  if ("heartbeat" in mutation) filtered.heartbeat = mutation.heartbeat;
  if ("model" in mutation) filtered.model = mutation.model;
  if (Object.keys(filtered).length === 0) {
    throw new AgentConfigWriterError(
      "no allowed keys in mutation",
      "",
      "allowed: subagents, heartbeat, model",
    );
  }

  return withConfigLock(async () => {
    const result = await runDocker(
      [
        "run",
        "--rm",
        "-i",
        "-v",
        `${KOZW_OPENCLAW_DIR}:/work`,
        "python:3.12-alpine",
        "python3",
        "-c",
        PY_SCRIPT,
        agentId,
      ],
      30_000,
      JSON.stringify(filtered),
    );

    if (result.code !== 0 && result.code !== 2 && result.code !== 3) {
      throw new AgentConfigWriterError(
        `openclaw.json mutation failed (exit ${result.code})`,
        result.stdout,
        result.stderr,
      );
    }

    let parsed: {
      status: string;
      backup_ts?: string;
      detail?: string;
      after?: Record<string, unknown>;
    };
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      throw new AgentConfigWriterError(
        "could not parse mutator output",
        result.stdout,
        result.stderr,
      );
    }

    if (parsed.status === "error") {
      throw new AgentConfigWriterError(
        parsed.detail ?? "mutator returned error",
        result.stdout,
        result.stderr,
      );
    }

    return {
      status: parsed.status as MutationResult["status"],
      backupTimestamp: parsed.backup_ts,
      after: parsed.after,
      rawOutput: result.stdout.trim(),
    };
  });
}
