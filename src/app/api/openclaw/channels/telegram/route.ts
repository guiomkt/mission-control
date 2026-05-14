/**
 * Adiciona uma conta de Telegram nova ao gateway.
 * POST /api/openclaw/channels/telegram
 * Body: { account: "lowercase-name", botToken: "123:ABC…" }
 *
 * Roda `openclaw channels add --channel telegram --account NAME --bot-token TOKEN`
 * dentro do container do gateway. O CLI valida o token contra o
 * Telegram (`getMe`) antes de persistir, então um token falso vira 400
 * com mensagem amigável.
 *
 * O endpoint serializa via `withConfigLock` pra não correr duas escritas
 * simultâneas no openclaw.json.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isValidAccountName,
  isValidTelegramBotToken,
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import { auditMutation } from "@/lib/audit-log";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    account?: unknown;
    botToken?: unknown;
  };

  if (!isValidAccountName(body.account)) {
    return NextResponse.json(
      {
        error:
          "Nome inválido. Use só letras minúsculas, dígitos e hífen (ex: 'ops-team').",
      },
      { status: 400 },
    );
  }

  if (!isValidTelegramBotToken(body.botToken)) {
    return NextResponse.json(
      { error: "Bot token Telegram em formato inválido (esperado: '123:AB...')." },
      { status: 400 },
    );
  }

  const account = body.account;
  const botToken = body.botToken;

  try {
    const result = await withConfigLock(() =>
      openclawExec(
        [
          "channels",
          "add",
          "--channel",
          "telegram",
          "--account",
          account,
          "--bot-token",
          botToken,
        ],
        { timeoutMs: 30_000 },
      ),
    );
    await auditMutation(request, {
      action: "channel.add",
      target: `telegram/${account}`,
      ok: true,
    });
    return NextResponse.json({
      success: true,
      stdout: result.stdout.trim(),
    });
  } catch (err) {
    await auditMutation(request, {
      action: "channel.add",
      target: `telegram/${account}`,
      ok: false,
    });
    if (err instanceof OpenClawExecError) {
      return NextResponse.json(
        {
          error: "openclaw channels add falhou",
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
