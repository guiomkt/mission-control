/**
 * Import de um tarball exportado.
 *
 * POST /api/agents/import
 * Body: multipart/form-data
 *   newId:   string (required)
 *   newName: string (optional — usa identity.name do tarball ou newId)
 *   file:    tarball (.tar.gz) gerado pelo export
 *
 * Passos:
 *  1. Valida newId único.
 *  2. Faz upload do tarball pro kozw (via stdin → /tmp).
 *  3. Lista membros do tarball, valida que TODOS começam com "./" e
 *     não têm `..` no path (defesa contra path traversal).
 *  4. Cria agente novo (`openclaw agents add ...`) com workspace vazio.
 *  5. Extrai workspace/ do tarball pro workspace novo (substitui o vazio).
 *  6. Lê agent.json do tarball e aplica subagents/heartbeat/model (mas
 *     NÃO bindings — operador refaz manualmente).
 *
 * Limites: tarball max 100MB pra evitar abuse.
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
  agentDetailCache,
  readOpenClawConfig,
} from "@/lib/agent-detail-cache";
import { mutateAgentEntry } from "@/lib/agent-config-writer";
import { isOAuthModel } from "@/lib/model-whitelist";

const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";
const MAX_TARBALL_BYTES = 100 * 1024 * 1024; // 100 MB

function workspacePath(agentId: string): string {
  return agentId === "main"
    ? "/data/.openclaw/workspace"
    : `/data/.openclaw/workspace-${agentId}`;
}

interface DockerResult {
  code: number;
  stdout: string;
  stderr: string;
}

function dockerExec(
  args: string[],
  options: { timeoutMs?: number; stdin?: Buffer } = {},
): Promise<DockerResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
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
    if (options.stdin) {
      proc.stdin!.write(options.stdin);
      proc.stdin!.end();
    }
  });
}

export async function POST(request: NextRequest) {
  // Multipart parsing nativo do Next.js.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser multipart/form-data." },
      { status: 400 },
    );
  }

  const newIdRaw = form.get("newId");
  const newNameRaw = form.get("newName");
  const file = form.get("file");

  // Validation: newId
  const newIdCheck = validateAgentId(newIdRaw);
  if (!newIdCheck.ok) {
    return NextResponse.json({ error: newIdCheck.reason }, { status: 400 });
  }
  const newId = (newIdRaw as string).trim();
  if (RESERVED_AGENT_IDS.has(newId)) {
    return NextResponse.json(
      { error: `"${newId}" é reservado.` },
      { status: 400 },
    );
  }
  const nameCheck = validateAgentName(newNameRaw);
  if (!nameCheck.ok) {
    return NextResponse.json({ error: nameCheck.reason }, { status: 400 });
  }

  // Validation: file
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "file (.tar.gz) é obrigatório." },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "file está vazio." }, { status: 400 });
  }
  if (file.size > MAX_TARBALL_BYTES) {
    return NextResponse.json(
      {
        error: `Tarball maior que ${MAX_TARBALL_BYTES / 1024 / 1024}MB. Encolhe ou importa via SSH.`,
      },
      { status: 413 },
    );
  }

  const tarballBuf = Buffer.from(await file.arrayBuffer());

  // Confere unicidade ANTES de processar o tarball.
  try {
    const existing = await listAgents();
    if (existing.some((a) => a.id === newId)) {
      return NextResponse.json(
        { error: `Agente "${newId}" já existe.` },
        { status: 409 },
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

  // Step 1: stage o tarball no kozw em /tmp.
  const stageDir = `/tmp/mc-import-${newId}-${Date.now()}`;
  const stagedTar = `${stageDir}/import.tar.gz`;
  const stageScript = `
set -e
mkdir -p "${stageDir}"
cat > "${stagedTar}"
echo OK
`;
  const stage = await dockerExec(
    [
      "exec",
      "--user",
      "node",
      "-i",
      KOZW_CONTAINER,
      "sh",
      "-c",
      stageScript,
    ],
    { timeoutMs: 60_000, stdin: tarballBuf },
  );
  if (stage.code !== 0 || stage.stdout.trim() !== "OK") {
    return NextResponse.json(
      {
        error: "Falha ao stagear tarball",
        detail: stage.stderr || stage.stdout,
      },
      { status: 502 },
    );
  }

  // Step 2: lista membros + valida path traversal.
  const listResult = await dockerExec(
    [
      "exec",
      "--user",
      "node",
      KOZW_CONTAINER,
      "tar",
      "-tzf",
      stagedTar,
    ],
    { timeoutMs: 30_000 },
  );
  if (listResult.code !== 0) {
    // Cleanup stage
    await dockerExec(
      ["exec", "--user", "node", KOZW_CONTAINER, "rm", "-rf", stageDir],
      { timeoutMs: 10_000 },
    ).catch(() => {});
    return NextResponse.json(
      {
        error: "Tarball inválido (não consegui listar membros)",
        detail: listResult.stderr,
      },
      { status: 400 },
    );
  }
  const members = listResult.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // Rejeita absoluto, `..`, ou path fora dos prefixos esperados.
  const SAFE_PREFIXES = ["./", "agent.json", "workspace/", "./agent.json", "./workspace/"];
  for (const m of members) {
    if (m.startsWith("/")) {
      return NextResponse.json(
        { error: `Tarball tem path absoluto: ${m}` },
        { status: 400 },
      );
    }
    if (m.includes("..")) {
      return NextResponse.json(
        { error: `Tarball tem traversal (..): ${m}` },
        { status: 400 },
      );
    }
    const normalized = m.replace(/^\.\//, "");
    if (
      !SAFE_PREFIXES.some(
        (p) => m === p || m.startsWith(p) || normalized.startsWith(p.replace(/^\.\//, "")),
      ) &&
      normalized !== "agent.json" &&
      !normalized.startsWith("workspace/")
    ) {
      return NextResponse.json(
        { error: `Tarball tem membro fora do esperado: ${m}` },
        { status: 400 },
      );
    }
  }
  // Confere que tem ao menos agent.json e workspace/
  const hasAgentJson = members.some(
    (m) => m === "./agent.json" || m === "agent.json",
  );
  if (!hasAgentJson) {
    return NextResponse.json(
      { error: "Tarball não tem agent.json. Não parece um export válido." },
      { status: 400 },
    );
  }

  // Step 3: lê agent.json do tarball.
  const readAgentJson = await dockerExec(
    [
      "exec",
      "--user",
      "node",
      KOZW_CONTAINER,
      "tar",
      "-xzOf",
      stagedTar,
      "agent.json",
    ],
    { timeoutMs: 10_000 },
  );
  let agentSlice: {
    id?: string;
    name?: string;
    identity?: { name?: string; emoji?: string; theme?: string; avatar?: string };
    subagents?: { allowAgents?: string[] };
    heartbeat?: Record<string, unknown>;
    model?: { primary?: string; fallbacks?: string[] };
  };
  try {
    // Falha em tarballs sem `./` prefix → tenta novamente com ./
    const stdout = readAgentJson.stdout.trim();
    if (!stdout && readAgentJson.code === 0) {
      const retry = await dockerExec(
        [
          "exec",
          "--user",
          "node",
          KOZW_CONTAINER,
          "tar",
          "-xzOf",
          stagedTar,
          "./agent.json",
        ],
        { timeoutMs: 10_000 },
      );
      agentSlice = JSON.parse(retry.stdout);
    } else {
      agentSlice = JSON.parse(stdout);
    }
  } catch (err) {
    await dockerExec(
      ["exec", "--user", "node", KOZW_CONTAINER, "rm", "-rf", stageDir],
      { timeoutMs: 10_000 },
    ).catch(() => {});
    return NextResponse.json(
      {
        error: "agent.json no tarball inválido",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  // Model do tarball precisa ser OAuth (mesma proteção do model swap).
  const importedModel = agentSlice.model?.primary;
  if (importedModel && !isOAuthModel(importedModel)) {
    await dockerExec(
      ["exec", "--user", "node", KOZW_CONTAINER, "rm", "-rf", stageDir],
      { timeoutMs: 10_000 },
    ).catch(() => {});
    return NextResponse.json(
      {
        error: `Tarball tem modelo não-OAuth ("${importedModel}"). Bloqueado por política de custo.`,
      },
      { status: 400 },
    );
  }

  const newName =
    (typeof newNameRaw === "string" && newNameRaw.trim().length > 0
      ? newNameRaw.trim()
      : null) ??
    agentSlice.identity?.name ??
    agentSlice.name ??
    newId;
  const modelToUse = importedModel ?? "openai-codex/gpt-5.4";
  const dstWs = workspacePath(newId);

  const meta = {
    newId,
    newName,
    importedFrom: agentSlice.id ?? "unknown",
    importedModel,
    tarballBytes: tarballBuf.length,
  };

  try {
    // Step 4: cria agente novo via CLI.
    await withConfigLock(() =>
      openclawExec(
        [
          "agents",
          "add",
          "--name",
          newName,
          "--model",
          modelToUse,
          "--workspace",
          dstWs,
          "--non-interactive",
          "--json",
        ],
        { timeoutMs: 30_000 },
      ),
    );

    // Step 5: extrai workspace/ do tarball pro workspace novo.
    const extractScript = `
set -e
rm -rf "${dstWs}"/*
rm -rf "${dstWs}"/.[!.]* 2>/dev/null || true
# Extrai só os arquivos abaixo de workspace/ direto pro dstWs.
tar -xzf "${stagedTar}" --strip-components=1 -C "${dstWs}" workspace 2>/dev/null \
  || tar -xzf "${stagedTar}" --strip-components=2 -C "${dstWs}" ./workspace 2>/dev/null \
  || tar -xzf "${stagedTar}" --strip-components=1 -C "${dstWs}" ./workspace
# Reinit git no workspace importado.
cd "${dstWs}"
rm -rf .git
git init --quiet >/dev/null 2>&1 || true
git -C "${dstWs}" add -A 2>/dev/null && git -C "${dstWs}" -c user.email=panel@mc.local -c user.name="Mission Control Panel" commit -q -m "import (from ${agentSlice.id ?? "?"})" 2>/dev/null || true
rm -rf "${stageDir}"
echo OK
`;
    const extract = await dockerExec(
      [
        "exec",
        "--user",
        "node",
        KOZW_CONTAINER,
        "sh",
        "-c",
        extractScript,
      ],
      { timeoutMs: 120_000 },
    );
    if (extract.code !== 0) {
      return NextResponse.json(
        {
          error: "Falha ao extrair workspace",
          detail: extract.stderr || extract.stdout,
        },
        { status: 502 },
      );
    }

    // Step 6: aplica subagents/heartbeat/model do tarball (model já foi
    // definido no `agents add`, mas se tem fallbacks aplicamos aqui).
    const patches: Array<Promise<unknown>> = [];
    if (
      agentSlice.subagents?.allowAgents &&
      agentSlice.subagents.allowAgents.length > 0
    ) {
      patches.push(
        mutateAgentEntry(newId, {
          subagents: {
            allowAgents: agentSlice.subagents.allowAgents,
          },
        }),
      );
    }
    if (agentSlice.heartbeat) {
      patches.push(
        mutateAgentEntry(newId, {
          heartbeat: agentSlice.heartbeat as Parameters<
            typeof mutateAgentEntry
          >[1]["heartbeat"],
        }),
      );
    }
    if (agentSlice.model?.fallbacks && agentSlice.model.fallbacks.length > 0) {
      patches.push(
        mutateAgentEntry(newId, {
          model: {
            primary: modelToUse,
            fallbacks: agentSlice.model.fallbacks,
          },
        }),
      );
    }
    await Promise.all(patches);

    agentDetailCache.invalidate();
    await auditMutation(request, {
      action: "agent.import",
      target: newId,
      ok: true,
      meta,
    });

    // Cross-check final.
    const config = await readOpenClawConfig();
    const persisted = (config?.agents?.list ?? []).find((a) => a.id === newId);

    return NextResponse.json(
      {
        success: true,
        id: newId,
        name: newName,
        importedFrom: agentSlice.id ?? null,
        applied: {
          subagents: !!agentSlice.subagents?.allowAgents?.length,
          heartbeat: !!agentSlice.heartbeat,
          model: !!agentSlice.model?.primary,
        },
        confirmedInConfig: !!persisted,
      },
      { status: 201 },
    );
  } catch (err) {
    // Cleanup stage em qualquer caminho de erro.
    await dockerExec(
      ["exec", "--user", "node", KOZW_CONTAINER, "rm", "-rf", stageDir],
      { timeoutMs: 10_000 },
    ).catch(() => {});
    await auditMutation(request, {
      action: "agent.import",
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
