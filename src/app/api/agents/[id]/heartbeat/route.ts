/**
 * Heartbeat schedule de um agente.
 *
 * PATCH /api/agents/[id]/heartbeat
 * Body shape (todos opcionais — só os fornecidos são persistidos):
 *   {
 *     every?: string          // "0m" (disabled) | "30m" | "1h" | "2h" | "6h"
 *     activeHours?: { start, end, timezone }  // start/end "HH:MM"
 *     target?: string         // "telegram" — canal alvo
 *     to?: string             // chat/topic id no canal
 *     accountId?: string      // conta do canal usada pra enviar
 *     lightContext?: boolean
 *     isolatedSession?: boolean
 *   }
 *
 * Body especial `{ disable: true }` → remove a chave `heartbeat` inteira.
 *
 * Mutação direta em `openclaw.json` (sem CLI). O gateway lê heartbeat
 * a cada tick interno, então NÃO reiniciamos kozw (evita auto-heal
 * apagar aliases removidos).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import {
  agentDetailCache,
  readOpenClawConfig,
} from "@/lib/agent-detail-cache";
import {
  mutateAgentEntry,
  AgentConfigWriterError,
  AgentHeartbeat,
} from "@/lib/agent-config-writer";

// "every" aceita formatos como "0m", "30m", "1h", "2h", "6h", "24h", "1d".
const EVERY_REGEX = /^(0|[1-9][0-9]*)(m|h|d)$/;
const HHMM_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
// Timezone: aceita formato IANA (America/Sao_Paulo) — checagem básica.
const TZ_REGEX = /^[A-Z][a-zA-Z_]+\/[A-Z][a-zA-Z_]+$/;
// target hoje: só "telegram".
const ALLOWED_TARGETS = new Set(["telegram"]);
// `to`: aceita string razoavelmente solta — chat id, topic, etc.
const TO_REGEX = /^[-_:0-9a-zA-Z]{1,80}$/;

function validateBody(input: Record<string, unknown>): {
  ok: true;
  value: AgentHeartbeat;
} | { ok: false; reason: string } {
  const out: AgentHeartbeat = {};

  if ("every" in input) {
    const v = input.every;
    if (typeof v !== "string" || !EVERY_REGEX.test(v)) {
      return { ok: false, reason: 'every deve ser tipo "0m", "30m", "1h"…' };
    }
    out.every = v;
  }
  if ("activeHours" in input) {
    const ah = input.activeHours;
    if (!ah || typeof ah !== "object") {
      return { ok: false, reason: "activeHours deve ser objeto." };
    }
    const obj = ah as Record<string, unknown>;
    const ahOut: NonNullable<AgentHeartbeat["activeHours"]> = {};
    if ("start" in obj) {
      if (typeof obj.start !== "string" || !HHMM_REGEX.test(obj.start)) {
        return { ok: false, reason: "activeHours.start deve ser HH:MM." };
      }
      ahOut.start = obj.start;
    }
    if ("end" in obj) {
      if (typeof obj.end !== "string" || !HHMM_REGEX.test(obj.end)) {
        return { ok: false, reason: "activeHours.end deve ser HH:MM." };
      }
      ahOut.end = obj.end;
    }
    if ("timezone" in obj) {
      if (typeof obj.timezone !== "string" || !TZ_REGEX.test(obj.timezone)) {
        return {
          ok: false,
          reason: "activeHours.timezone deve ser IANA (ex: America/Sao_Paulo).",
        };
      }
      ahOut.timezone = obj.timezone;
    }
    out.activeHours = ahOut;
  }
  if ("target" in input) {
    if (typeof input.target !== "string" || !ALLOWED_TARGETS.has(input.target)) {
      return {
        ok: false,
        reason: `target inválido. Permitidos: ${[...ALLOWED_TARGETS].join(", ")}.`,
      };
    }
    out.target = input.target;
  }
  if ("to" in input) {
    if (typeof input.to !== "string" || !TO_REGEX.test(input.to)) {
      return { ok: false, reason: "to inválido. Use [a-zA-Z0-9_:-]{1,80}." };
    }
    out.to = input.to;
  }
  if ("accountId" in input) {
    if (
      typeof input.accountId !== "string" ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(input.accountId)
    ) {
      return { ok: false, reason: "accountId inválido." };
    }
    out.accountId = input.accountId;
  }
  if ("lightContext" in input) {
    if (typeof input.lightContext !== "boolean") {
      return { ok: false, reason: "lightContext deve ser boolean." };
    }
    out.lightContext = input.lightContext;
  }
  if ("isolatedSession" in input) {
    if (typeof input.isolatedSession !== "boolean") {
      return { ok: false, reason: "isolatedSession deve ser boolean." };
    }
    out.isolatedSession = input.isolatedSession;
  }

  return { ok: true, value: out };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const idCheck = validateAgentId(id);
  if (!idCheck.ok && id !== "main") {
    return NextResponse.json({ error: idCheck.reason }, { status: 400 });
  }
  if (RESERVED_AGENT_IDS.has(id) && id !== "main") {
    return NextResponse.json(
      { error: `Agente "${id}" é reservado.` },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  // Modo especial: { disable: true } remove a chave inteira.
  if (body.disable === true) {
    try {
      const config = await readOpenClawConfig();
      const existingIds = new Set(
        (config?.agents?.list ?? []).map((a) => a.id),
      );
      if (!existingIds.has(id)) {
        return NextResponse.json(
          { error: `Agente "${id}" não encontrado.` },
          { status: 404 },
        );
      }
      const result = await mutateAgentEntry(id, { heartbeat: null });
      agentDetailCache.invalidate();
      await auditMutation(request, {
        action: "agent.heartbeat.disable",
        target: id,
        ok: true,
        meta: { status: result.status },
      });
      return NextResponse.json({
        success: true,
        status: result.status,
        disabled: true,
        backupTimestamp: result.backupTimestamp,
      });
    } catch (err) {
      await auditMutation(request, {
        action: "agent.heartbeat.disable",
        target: id,
        ok: false,
      });
      if (err instanceof AgentConfigWriterError) {
        return NextResponse.json(
          { error: "Falha ao escrever openclaw.json", detail: err.stderr || err.message },
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

  const validated = validateBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 });
  }
  if (Object.keys(validated.value).length === 0) {
    return NextResponse.json(
      { error: "Nenhum campo fornecido. Envie ao menos um." },
      { status: 400 },
    );
  }

  // Pega o agente atual pra fazer merge (preservar campos não enviados).
  const config = await readOpenClawConfig();
  const entry = (config?.agents?.list ?? []).find((a) => a.id === id);
  if (!entry) {
    return NextResponse.json(
      { error: `Agente "${id}" não encontrado.` },
      { status: 404 },
    );
  }
  const currentHB = (entry.heartbeat ?? {}) as AgentHeartbeat;

  // Merge field-a-field. Pra activeHours, faz merge profundo.
  const merged: AgentHeartbeat = { ...currentHB };
  for (const [key, value] of Object.entries(validated.value)) {
    if (key === "activeHours" && value && typeof value === "object") {
      merged.activeHours = {
        ...(currentHB.activeHours ?? {}),
        ...(value as Record<string, string>),
      };
    } else {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  try {
    const result = await mutateAgentEntry(id, { heartbeat: merged });
    agentDetailCache.invalidate();
    await auditMutation(request, {
      action: "agent.heartbeat.update",
      target: id,
      ok: true,
      meta: {
        changed: Object.keys(validated.value),
        status: result.status,
      },
    });
    return NextResponse.json({
      success: true,
      status: result.status,
      heartbeat: merged,
      backupTimestamp: result.backupTimestamp,
    });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.heartbeat.update",
      target: id,
      ok: false,
      meta: { changed: Object.keys(validated.value) },
    });
    if (err instanceof AgentConfigWriterError) {
      return NextResponse.json(
        { error: "Falha ao escrever openclaw.json", detail: err.stderr || err.message },
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
