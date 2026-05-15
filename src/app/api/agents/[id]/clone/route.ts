/**
 * Clona um agente existente.
 *
 * POST /api/agents/[id]/clone
 * Body: { newId: string, newName?: string }
 *
 * Passos:
 *  1. Valida que `newId` é único e bem-formado.
 *  2. Lê config slice + workspace path do agente source.
 *  3. Roda `openclaw agents add --name <newName> --model <primary> --workspace <newWs>`
 *     pro novo agente (cria workspace vazio + state).
 *  4. Copia o workspace inteiro do source pro target via docker exec
 *     (cp -a, preservando ownership).
 *  5. Aplica subagents/heartbeat/model do source no target via
 *     mutateAgentEntry. Bindings NÃO são copiados (operador refaz na UI
 *     pra evitar duplo-routing acidental).
 *
 * NÃO clona: bindings, sessions/transcripts, .clawhub/lock.json (skills
 * são re-instaladas se quiser).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { spawn } from "child_process";
import {
  validateAgentId,
  validateAgentName,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import {
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import { listAgents } from "@/lib/openclaw-client";
import {
  readOpenClawConfig,
  agentDetailCache,
} from "@/lib/agent-detail-cache";
import { mutateAgentEntry } from "@/lib/agent-config-writer";

const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";

function workspacePathInKozw(agentId: string): string {
  return agentId === "main"
    ? "/data/.openclaw/workspace"
    : `/data/.openclaw/workspace-${agentId}`;
}

function dockerExec(
  args: string[],
  timeoutMs = 60_000,
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
      reject(new Error(`docker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout!.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr!.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sourceId } = await params;
  if (
    !validateAgentId(sourceId).ok &&
    !RESERVED_AGENT_IDS.has(sourceId) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(sourceId)
  ) {
    return NextResponse.json({ error: "ID source inválido." }, { status: 400 });
  }

  let body: { newId?: unknown; newName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  const newIdCheck = validateAgentId(body.newId);
  if (!newIdCheck.ok) {
    return NextResponse.json({ error: newIdCheck.reason }, { status: 400 });
  }
  const newId = (body.newId as string).trim();
  if (RESERVED_AGENT_IDS.has(newId)) {
    return NextResponse.json(
      { error: `"${newId}" é reservado.` },
      { status: 400 },
    );
  }
  const nameCheck = validateAgentName(body.newName);
  if (!nameCheck.ok) {
    return NextResponse.json({ error: nameCheck.reason }, { status: 400 });
  }
  const newName =
    typeof body.newName === "string" && body.newName.trim().length > 0
      ? body.newName.trim()
      : `${sourceId} (clone)`;

  // Confere unicidade do newId.
  try {
    const existing = await listAgents();
    if (existing.some((a) => a.id === newId)) {
      return NextResponse.json(
        { error: `Agente "${newId}" já existe.` },
        { status: 409 },
      );
    }
    if (!existing.some((a) => a.id === sourceId)) {
      return NextResponse.json(
        { error: `Source "${sourceId}" não existe.` },
        { status: 404 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "Falha ao verificar agentes existentes",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // Pega config slice do source.
  const config = await readOpenClawConfig();
  const sourceEntry = (config?.agents?.list ?? []).find(
    (a) => a.id === sourceId,
  );
  if (!sourceEntry) {
    return NextResponse.json(
      { error: `Source "${sourceId}" sem entry na config.` },
      { status: 404 },
    );
  }
  const sourceModel =
    sourceEntry.model?.primary ?? "openai-codex/gpt-5.4";
  const sourceFallbacks = sourceEntry.model?.fallbacks ?? [];
  const sourceSubagents = sourceEntry.subagents?.allowAgents ?? [];
  const sourceHeartbeat = sourceEntry.heartbeat;

  const meta = { sourceId, newId, newName };

  try {
    // Step 1: cria agente novo via CLI.
    const newWorkspace = `/data/.openclaw/workspace-${newId}`;
    await withConfigLock(() =>
      openclawExec(
        [
          "agents",
          "add",
          "--name",
          newName,
          "--model",
          sourceModel,
          "--workspace",
          newWorkspace,
          "--non-interactive",
          "--json",
        ],
        { timeoutMs: 30_000 },
      ),
    );

    // Resolve o ID que o CLI gerou — pode normalizar `New Name` pra
    // `new-name`. Re-lê a lista pra confirmar.
    const after = await listAgents();
    const created = after.find((a) => a.id === newId);
    if (!created) {
      // Tenta achar por workspace (newId pode ter sido derivado do nome).
      const fallback = after.find(
        (a) =>
          !sourceEntry || a.id !== sourceId,
      );
      if (!fallback) {
        return NextResponse.json(
          {
            error: "agents add executou mas o agente novo não apareceu na lista",
          },
          { status: 502 },
        );
      }
    }

    // Step 2: copia o workspace inteiro do source pro target (sobrescreve
    // os arquivos default que o `agents add` criou).
    const srcWs = workspacePathInKozw(sourceId);
    const dstWs = workspacePathInKozw(newId);
    const cp = await dockerExec(
      [
        "exec",
        "--user",
        "node",
        KOZW_CONTAINER,
        "sh",
        "-c",
        `set -e
# Limpa o destino (mantém o dir) e copia conteúdo source.
rm -rf "${dstWs}"/*
rm -rf "${dstWs}"/.[!.]* 2>/dev/null || true
# Copia preservando perms/timestamps. /. evita criar subdir.
cp -a "${srcWs}/." "${dstWs}/"
# Reinit git no novo workspace pra histórico próprio.
cd "${dstWs}" && rm -rf .git && git init --quiet >/dev/null 2>&1 || true
git -C "${dstWs}" add -A 2>/dev/null && git -C "${dstWs}" -c user.email=panel@mc.local -c user.name="Mission Control Panel" commit -q -m "clone from ${sourceId}" 2>/dev/null || true
echo OK`,
      ],
      60_000,
    );
    if (cp.code !== 0) {
      return NextResponse.json(
        {
          error: "workspace copy failed",
          detail: cp.stderr || cp.stdout,
        },
        { status: 502 },
      );
    }

    // Step 3: aplica subagents/heartbeat/model do source via JSON edit.
    const patches: Array<Promise<unknown>> = [];
    if (sourceSubagents.length > 0) {
      patches.push(
        mutateAgentEntry(newId, {
          subagents: { allowAgents: sourceSubagents },
        }),
      );
    }
    if (sourceHeartbeat) {
      patches.push(
        mutateAgentEntry(newId, {
          heartbeat: sourceHeartbeat as Parameters<
            typeof mutateAgentEntry
          >[1]["heartbeat"],
        }),
      );
    }
    if (sourceFallbacks.length > 0) {
      patches.push(
        mutateAgentEntry(newId, {
          model: {
            primary: sourceModel,
            fallbacks: sourceFallbacks,
          },
        }),
      );
    }
    await Promise.all(patches);

    agentDetailCache.invalidate();
    await auditMutation(request, {
      action: "agent.clone",
      target: newId,
      ok: true,
      meta: { ...meta, copiedFiles: cp.stdout.trim() === "OK" },
    });

    return NextResponse.json(
      {
        success: true,
        id: newId,
        name: newName,
        sourceId,
        bindingsCopied: false,
        sessionsCopied: false,
      },
      { status: 201 },
    );
  } catch (err) {
    await auditMutation(request, {
      action: "agent.clone",
      target: newId,
      ok: false,
      meta,
    });
    if (err instanceof OpenClawExecError) {
      return NextResponse.json(
        {
          error: "openclaw agents add falhou",
          detail: err.result.stderr || err.message,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: "unexpected error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
