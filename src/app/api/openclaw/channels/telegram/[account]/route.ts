/**
 * Remove uma conta de Telegram do gateway.
 * DELETE /api/openclaw/channels/telegram/:account
 *
 * Roda `openclaw channels remove --channel telegram --account X --delete`.
 * O `--delete` apaga também o state file de polling (offset). Sem ele
 * o canal só fica desabilitado mas mantém o histórico de updates.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isValidAccountName,
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import { auditMutation } from "@/lib/audit-log";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ account: string }> },
) {
  const { account } = await params;
  if (!isValidAccountName(account)) {
    return NextResponse.json(
      { error: "Nome de conta inválido." },
      { status: 400 },
    );
  }

  try {
    const result = await withConfigLock(() =>
      openclawExec(
        [
          "channels",
          "remove",
          "--channel",
          "telegram",
          "--account",
          account,
          "--delete",
        ],
        { timeoutMs: 30_000 },
      ),
    );
    await auditMutation(request, {
      action: "channel.remove",
      target: `telegram/${account}`,
      ok: true,
    });
    return NextResponse.json({
      success: true,
      stdout: result.stdout.trim(),
    });
  } catch (err) {
    await auditMutation(request, {
      action: "channel.remove",
      target: `telegram/${account}`,
      ok: false,
    });
    if (err instanceof OpenClawExecError) {
      return NextResponse.json(
        {
          error: "openclaw channels remove falhou",
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
