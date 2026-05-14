/**
 * Remove uma conta de Telegram do gateway.
 * DELETE /api/openclaw/channels/telegram/:account
 *
 * Tenta primeiro o caminho oficial (`openclaw channels remove --delete`).
 * Se o CLI falhar com o bug "Channel plugin … is not installed", cai
 * pro fallback que edita openclaw.json direto + restart kozw. Mesmo
 * padrão do endpoint de WhatsApp (ver openclaw-channel-config.ts).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isValidAccountName,
  openclawExec,
  OpenClawExecError,
  withConfigLock,
} from "@/lib/openclaw-exec";
import {
  isPluginNotInstalledBug,
  removeChannelAccountFromConfig,
  ChannelConfigError,
} from "@/lib/openclaw-channel-config";
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
      meta: { via: "cli" },
    });
    return NextResponse.json({
      success: true,
      via: "cli",
      stdout: result.stdout.trim(),
    });
  } catch (err) {
    if (
      err instanceof OpenClawExecError &&
      isPluginNotInstalledBug(err.result.stderr, err.result.stdout)
    ) {
      try {
        const result = await removeChannelAccountFromConfig(
          "telegram",
          account,
        );
        await auditMutation(request, {
          action: "channel.remove",
          target: `telegram/${account}`,
          ok: true,
          meta: {
            via: "fallback",
            status: result.status,
            restarted: result.restarted,
            backupTs: result.backupTimestamp,
          },
        });
        return NextResponse.json({
          success: true,
          via: "fallback",
          status: result.status,
          restarted: result.restarted,
          note:
            result.status === "not_present"
              ? "Conta já não estava no config."
              : "CLI deu erro ('plugin not installed') — editamos openclaw.json direto e reiniciamos o kozw.",
        });
      } catch (fallbackErr) {
        await auditMutation(request, {
          action: "channel.remove",
          target: `telegram/${account}`,
          ok: false,
          meta: { via: "fallback" },
        });
        return NextResponse.json(
          {
            error: "Fallback de edição direta também falhou",
            detail:
              fallbackErr instanceof ChannelConfigError
                ? fallbackErr.stderr || fallbackErr.message
                : fallbackErr instanceof Error
                  ? fallbackErr.message
                  : String(fallbackErr),
          },
          { status: 502 },
        );
      }
    }

    await auditMutation(request, {
      action: "channel.remove",
      target: `telegram/${account}`,
      ok: false,
      meta: { via: "cli" },
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
