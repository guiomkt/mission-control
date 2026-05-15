/**
 * Export do workspace + config slice de um agente como tarball gzip.
 *
 * GET /api/agents/[id]/export
 *   → application/gzip stream com filename agent-<id>-YYYY-MM-DD.tar.gz
 *
 * Conteúdo do tarball:
 *   agent.json                          → config slice de agents.list[i]
 *   workspace/                          → workspace inteiro (read-only ao
 *                                          unzip; quem importa decide.)
 *
 * NÃO inclui: sessions (transcripts), bindings, agentDir state.
 * Motivo: sessions são privadas (têm conversas reais); bindings são
 * específicos do ambiente alvo; agentDir contém auth-state.json com
 * tokens.
 *
 * Implementação: docker exec no kozw monta o tarball em /tmp e pipe
 * stdout pro response. tar é built-in no container.
 */
import type { NextRequest } from "next/server";
import { spawn } from "child_process";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import { readOpenClawConfig } from "@/lib/agent-detail-cache";

const KOZW_CONTAINER = "openclaw-kozw-openclaw-1";

function workspacePath(agentId: string): string {
  return agentId === "main"
    ? "/data/.openclaw/workspace"
    : `/data/.openclaw/workspace-${agentId}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (
    !validateAgentId(id).ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return new Response(JSON.stringify({ error: "ID inválido." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Pega config slice pra incluir no tarball.
  const config = await readOpenClawConfig();
  const entry = (config?.agents?.list ?? []).find((a) => a.id === id);
  if (!entry) {
    return new Response(JSON.stringify({ error: "Agente não encontrado." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // Auditoria síncrona ANTES do stream (porque depois a request já está
  // entregue ao client).
  await auditMutation(request, {
    action: "agent.export",
    target: id,
    ok: true,
    meta: { workspace: entry.workspace },
  });

  // Slice limpa pra agent.json — sem `agentDir` (path absoluto interno)
  // e sem `workspace` (path varia entre ambientes; quem importa
  // recalcula).
  const sliceAny = entry as unknown as Record<string, unknown>;
  const slice: Record<string, unknown> = {
    id: sliceAny.id,
    name: sliceAny.name,
    identity: sliceAny.identity,
  };
  if (sliceAny.subagents !== undefined) slice.subagents = sliceAny.subagents;
  if (sliceAny.heartbeat !== undefined) slice.heartbeat = sliceAny.heartbeat;
  if (sliceAny.model !== undefined) slice.model = sliceAny.model;
  const sliceJson = JSON.stringify(slice, null, 2);

  // Script: monta o tarball em stdout. Passamos `agent.json` via base64
  // pra não brigar com escape de shell — o conteúdo pode ter aspas,
  // crase, `$`, etc.
  const stageDir = `/tmp/mc-export-${id}-${Date.now()}`;
  const sliceBase64 = Buffer.from(sliceJson).toString("base64");
  const safeScript = `
set -e
mkdir -p "${stageDir}/workspace"
echo "${sliceBase64}" | base64 -d > "${stageDir}/agent.json"
cp -a "${workspacePath(id)}/." "${stageDir}/workspace/"
rm -rf "${stageDir}/workspace/.git" || true
cd "${stageDir}"
tar -czf - .
rm -rf "${stageDir}"
`;

  const proc = spawn(
    "docker",
    [
      "exec",
      "--user",
      "node",
      KOZW_CONTAINER,
      "sh",
      "-c",
      safeScript,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const date = new Date().toISOString().slice(0, 10);
  const filename = `agent-${id}-${date}.tar.gz`;

  const stream = new ReadableStream({
    start(controller) {
      let stderrBuf = "";
      proc.stdout!.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      proc.stderr!.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });
      proc.on("error", (err) => {
        controller.error(err);
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          // Não tem como mandar erro 502 depois do stream começar — o
          // melhor é fechar o stream. O client vai ver tarball truncado.
          // Logamos o stderr no server.
          console.error(
            `[/api/agents/${id}/export] tar exited ${code}: ${stderrBuf}`,
          );
        }
        controller.close();
      });
    },
    cancel() {
      proc.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Sem Content-Length porque o stream é dinâmico.
      "Cache-Control": "no-store",
    },
  });
}
