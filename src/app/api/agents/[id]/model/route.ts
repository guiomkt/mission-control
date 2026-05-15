/**
 * Model swap de um agente.
 *
 * PATCH /api/agents/[id]/model
 * Body: { primary: string, fallbacks?: string[] }
 *  - `primary`: modelo OAuth (whitelist em model-whitelist.ts)
 *  - `fallbacks`: lista ordenada de OAuth fallbacks (cada um whitelisted)
 *
 * Body especial { disable: true } → remove a chave `model` inteira
 * (volta a usar `agents.defaults.model`).
 *
 * **Segurança crítica:** modelos pagos (openai/, google/, etc) são
 * rejeitados com 400 + reason "não-OAuth". A intenção é honrar a
 * restrição de custo do operador, NÃO permitindo que a UI configure
 * algo que iria cobrar por token.
 *
 * Mutação direta em `openclaw.json` (sem CLI). NÃO restarta kozw.
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
} from "@/lib/agent-config-writer";
import { validateModelValue } from "@/lib/model-whitelist";

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

  let body: { primary?: unknown; fallbacks?: unknown; disable?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  // Modo disable: remove a chave model do agente.
  if (body.disable === true) {
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
    try {
      const result = await mutateAgentEntry(id, { model: null });
      agentDetailCache.invalidate();
      await auditMutation(request, {
        action: "agent.model.reset",
        target: id,
        ok: true,
        meta: { status: result.status },
      });
      return NextResponse.json({
        success: true,
        status: result.status,
        reset: true,
      });
    } catch (err) {
      await auditMutation(request, {
        action: "agent.model.reset",
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

  // Modo set: precisa primary + fallbacks opcionais.
  const primaryCheck = validateModelValue(body.primary);
  if (!primaryCheck.ok) {
    return NextResponse.json(
      {
        error: primaryCheck.reason,
        pricingClass: primaryCheck.pricingClass,
      },
      { status: 400 },
    );
  }

  // Fallbacks: array opcional, cada item passa pela mesma whitelist.
  let fallbacks: string[] | undefined;
  if (body.fallbacks !== undefined) {
    if (!Array.isArray(body.fallbacks)) {
      return NextResponse.json(
        { error: "fallbacks deve ser array de strings (ou omitido)." },
        { status: 400 },
      );
    }
    fallbacks = [];
    for (const f of body.fallbacks) {
      const check = validateModelValue(f);
      if (!check.ok) {
        return NextResponse.json(
          {
            error: `Fallback inválido: ${check.reason}`,
            pricingClass: check.pricingClass,
          },
          { status: 400 },
        );
      }
      // Dedup automático + não repetir o primário.
      const value = typeof f === "string" ? f.trim() : "";
      if (value && value !== body.primary && !fallbacks.includes(value)) {
        fallbacks.push(value);
      }
    }
  }

  // Garante que o agente existe.
  const config = await readOpenClawConfig();
  const exists = (config?.agents?.list ?? []).some((a) => a.id === id);
  if (!exists) {
    return NextResponse.json(
      { error: `Agente "${id}" não encontrado.` },
      { status: 404 },
    );
  }

  const primary = (body.primary as string).trim();
  const meta = {
    primary,
    fallbacks,
    pricingClass: primaryCheck.pricingClass,
  };

  try {
    const result = await mutateAgentEntry(id, {
      model: {
        primary,
        ...(fallbacks && fallbacks.length > 0 ? { fallbacks } : {}),
      },
    });
    agentDetailCache.invalidate();
    await auditMutation(request, {
      action: "agent.model.update",
      target: id,
      ok: true,
      meta,
    });
    return NextResponse.json({
      success: true,
      status: result.status,
      primary,
      fallbacks: fallbacks ?? [],
    });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.model.update",
      target: id,
      ok: false,
      meta,
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
