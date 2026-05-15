/**
 * Bindings de roteamento de um agente.
 *
 * POST   /api/agents/[id]/bindings   — Body: { channel, accountId }
 *                                       Roda `openclaw agents bind --agent X
 *                                       --bind <channel>:<accountId> --json`
 *
 * DELETE /api/agents/[id]/bindings?channel=X&accountId=Y
 *                                     — Roda `openclaw agents unbind --agent X
 *                                       --bind <channel>:<accountId> --json`
 *
 * Por que CLI (e não JSON edit direto):
 *  - O CLI já cuida do reload do gateway (SIGUSR1) e da consistência da
 *    estrutura `bindings[]`. Reinventar isso aumenta risco de quebrar
 *    routing.
 *
 * Channel/accountId validados contra regex restrito antes de chegar no
 * CLI — sem injection mesmo se o usuário tentar coisa estranha (o spawn
 * já é sem shell, mas defesa em profundidade).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import { agentDetailCache } from "@/lib/agent-detail-cache";

// Canais permitidos hoje. Adicionar novos só depois de validar que o
// CLI aceita o nome (caso contrário falha no exec, mas explicitar
// melhora UX).
const ALLOWED_CHANNELS = new Set(["telegram", "whatsapp"]);

function validateChannel(value: unknown): value is string {
  return typeof value === "string" && ALLOWED_CHANNELS.has(value);
}

function validateAccountId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(value)
  );
}

function checkAgent(id: string) {
  if (RESERVED_AGENT_IDS.has(id) && id !== "main") {
    return { ok: false, status: 403, reason: "ID reservado." };
  }
  const idCheck = validateAgentId(id);
  if (!idCheck.ok && id !== "main") {
    return { ok: false, status: 400, reason: idCheck.reason };
  }
  return { ok: true };
}

// ── POST (criar binding) ──────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const check = checkAgent(id);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: check.status });
  }

  let body: { channel?: unknown; accountId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  if (!validateChannel(body.channel)) {
    return NextResponse.json(
      { error: `Canal inválido. Permitidos: ${[...ALLOWED_CHANNELS].join(", ")}.` },
      { status: 400 },
    );
  }
  if (!validateAccountId(body.accountId)) {
    return NextResponse.json(
      { error: "accountId inválido. Use [a-z][a-z0-9-]{0,39}." },
      { status: 400 },
    );
  }

  const bindSpec = `${body.channel}:${body.accountId}`;
  const meta = { channel: body.channel, accountId: body.accountId };

  try {
    const result = await withConfigLock(() =>
      openclawExec(
        ["agents", "bind", "--agent", id, "--bind", bindSpec, "--json"],
        { timeoutMs: 15_000 },
      ),
    );
    agentDetailCache.invalidate();
    await auditMutation(request, {
      action: "agent.binding.add",
      target: id,
      ok: true,
      meta,
    });
    return NextResponse.json(
      { success: true, binding: meta, stdout: result.stdout.trim() },
      { status: 201 },
    );
  } catch (err) {
    await auditMutation(request, {
      action: "agent.binding.add",
      target: id,
      ok: false,
      meta,
    });
    if (err instanceof OpenClawExecError) {
      const detail = err.result.stderr || err.message;
      // Duplicado ou já existe → 409
      if (/already|exists|duplicate/i.test(detail)) {
        return NextResponse.json(
          { error: "Binding já existe.", detail },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "openclaw agents bind falhou", detail },
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

// ── DELETE (remover binding) ──────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const check = checkAgent(id);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason }, { status: check.status });
  }

  // Channel/accountId vêm da query string (DELETE não tem body
  // confiável no fetch).
  const url = new URL(request.url);
  const channel = url.searchParams.get("channel");
  const accountId = url.searchParams.get("accountId");

  if (!validateChannel(channel)) {
    return NextResponse.json(
      { error: `Canal inválido. Permitidos: ${[...ALLOWED_CHANNELS].join(", ")}.` },
      { status: 400 },
    );
  }
  if (!validateAccountId(accountId)) {
    return NextResponse.json(
      { error: "accountId inválido. Use [a-z][a-z0-9-]{0,39}." },
      { status: 400 },
    );
  }

  const bindSpec = `${channel}:${accountId}`;
  const meta = { channel, accountId };

  try {
    const result = await withConfigLock(() =>
      openclawExec(
        ["agents", "unbind", "--agent", id, "--bind", bindSpec, "--json"],
        { timeoutMs: 15_000 },
      ),
    );
    agentDetailCache.invalidate();
    await auditMutation(request, {
      action: "agent.binding.remove",
      target: id,
      ok: true,
      meta,
    });
    return NextResponse.json({
      success: true,
      binding: meta,
      stdout: result.stdout.trim(),
    });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.binding.remove",
      target: id,
      ok: false,
      meta,
    });
    if (err instanceof OpenClawExecError) {
      const detail = err.result.stderr || err.message;
      if (/not.found|no.such|missing/i.test(detail)) {
        return NextResponse.json(
          { error: "Binding não encontrado.", detail },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "openclaw agents unbind falhou", detail },
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
