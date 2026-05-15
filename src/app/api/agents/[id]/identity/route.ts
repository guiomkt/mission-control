/**
 * Atualiza a identidade de um agente.
 * PUT /api/agents/[id]/identity
 * Body: { name?: string, emoji?: string, theme?: string, avatar?: string }
 *
 * Wraps `openclaw agents set-identity --agent <id> [--name ...] [--emoji ...]
 *  [--theme ...] [--avatar ...] --json`.
 *
 * Só os campos enviados no body são atualizados (PATCH semântico apesar do
 * verb PUT — escolhido pra ser mais simples na UI).
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
  validateAgentName,
  normalizeAgentEmoji,
  normalizeAgentTheme,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";

function normalizeAvatar(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  // Aceita só http(s) URLs ou paths relativos ao workspace (sem ../).
  // Cap em 300 chars.
  if (trimmed.length > 300) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.includes("..")) return undefined;
  return trimmed;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idCheck = validateAgentId(id);
  // Aceita `main` aqui — editar identidade do main é OK.
  if (!idCheck.ok && !RESERVED_AGENT_IDS.has(id)) {
    return NextResponse.json({ error: idCheck.reason }, { status: 400 });
  }

  let body: {
    name?: unknown;
    emoji?: unknown;
    theme?: unknown;
    avatar?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  const nameCheck = validateAgentName(body.name);
  if (!nameCheck.ok) {
    return NextResponse.json({ error: nameCheck.reason }, { status: 400 });
  }
  const name =
    typeof body.name === "string" ? body.name.trim() : undefined;
  const emoji = normalizeAgentEmoji(body.emoji);
  const theme = normalizeAgentTheme(body.theme);
  const avatar = normalizeAvatar(body.avatar);

  const args: string[] = ["agents", "set-identity", "--agent", id, "--json"];
  const changes: string[] = [];
  if (name !== undefined) {
    args.push("--name", name);
    changes.push("name");
  }
  if (emoji !== undefined) {
    args.push("--emoji", emoji);
    changes.push("emoji");
  }
  if (theme !== undefined) {
    args.push("--theme", theme);
    changes.push("theme");
  }
  if (avatar !== undefined) {
    args.push("--avatar", avatar);
    changes.push("avatar");
  }

  if (changes.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma mudança fornecida. Envie ao menos um campo." },
      { status: 400 },
    );
  }

  try {
    const result = await withConfigLock(() =>
      openclawExec(args, { timeoutMs: 15_000 }),
    );
    await auditMutation(request, {
      action: "agent.identity.update",
      target: id,
      ok: true,
      meta: { changes },
    });
    return NextResponse.json({
      success: true,
      changes,
      stdout: result.stdout.trim(),
    });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.identity.update",
      target: id,
      ok: false,
      meta: { changes },
    });
    if (err instanceof OpenClawExecError) {
      return NextResponse.json(
        {
          error: "openclaw agents set-identity falhou",
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
