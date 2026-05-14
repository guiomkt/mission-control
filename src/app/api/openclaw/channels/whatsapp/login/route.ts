/**
 * Inicia o fluxo de pareamento WhatsApp.
 * POST /api/openclaw/channels/whatsapp/login
 * Body: { account: "name" }
 *
 * Spawna `openclaw channels login --channel whatsapp --account NAME` em
 * background, guarda o handle no `pairing-store`, e devolve um
 * `pairingId` opaco. O frontend usa esse ID pra abrir o SSE em
 * `/api/openclaw/channels/whatsapp/pair-stream?id=PAIRING_ID`.
 *
 * O CLI fica vivo até parear, dar timeout (~2min), ou ser killed.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { isValidAccountName, openclawSpawn } from "@/lib/openclaw-exec";
import { bufferLine, putPairing } from "@/lib/openclaw-pairing-store";
import { auditMutation } from "@/lib/audit-log";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    account?: unknown;
  };

  if (!isValidAccountName(body.account)) {
    return NextResponse.json(
      {
        error:
          "Nome inválido. Use só letras minúsculas, dígitos e hífen (ex: 'pessoal').",
      },
      { status: 400 },
    );
  }
  const account = body.account;
  const pairingId = randomUUID();

  // `--verbose` faz o CLI imprimir QR + pairing code se disponíveis.
  const proc = openclawSpawn([
    "channels",
    "login",
    "--channel",
    "whatsapp",
    "--account",
    account,
    "--verbose",
  ]);

  putPairing(pairingId, proc);

  // Começa a bufferizar imediatamente — se o consumer demorar a abrir
  // o SSE, não perdemos a primeira saída do CLI.
  proc.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.length > 0) bufferLine(pairingId, line, "stdout");
    }
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.length > 0) bufferLine(pairingId, line, "stderr");
    }
  });

  await auditMutation(request, {
    action: "channel.login.start",
    target: `whatsapp/${account}`,
    ok: true,
    meta: { pairingId },
  });

  return NextResponse.json({ pairingId, account });
}
