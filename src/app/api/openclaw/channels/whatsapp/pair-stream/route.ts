/**
 * SSE stream do output de um pairing WhatsApp em andamento.
 * GET /api/openclaw/channels/whatsapp/pair-stream?id=PAIRING_ID
 *
 * Pegamos o ChildProcess do store (criado por POST /login), drenamos o
 * buffer inicial, e plumbamos stdout/stderr → SSE até o processo
 * encerrar ou o client desconectar.
 *
 * Cada linha vira um evento `data: {json}` onde o JSON é:
 *   { type: "stdout"|"stderr"|"qr"|"code"|"paired"|"timeout"|"error"|"done", payload?: string }
 *
 * Parse minimalista do output do CLI:
 *   - Sequência de chars `█▀▄` formando QR → coleta como bloco e emite "qr"
 *   - Linha tipo "Pairing code: XXX-XXXX" → emite "code"
 *   - "successfully paired" → emite "paired"
 *   - "timeout" / "could not pair" → emite "timeout"
 */
import type { NextRequest } from "next/server";
import {
  getPairing,
  markConsumed,
  removePairing,
} from "@/lib/openclaw-pairing-store";

const QR_CHARS = /[█▀▄ ]/;
const CODE_RE = /pairing code\s*[:=]\s*([A-Z0-9-]+)/i;
const PAIRED_RE = /successfully paired|paired with|linked as/i;
const TIMEOUT_RE = /pair(ing)? (timed out|timeout|expired|failed)|could not pair/i;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return new Response("Missing ?id=", { status: 400 });
  }

  const entry = getPairing(id);
  if (!entry) {
    return new Response("Pairing session not found or already ended.", {
      status: 404,
    });
  }
  markConsumed(id);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (type: string, payload?: string) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type, payload })}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };

      // QR block buffering — quando vemos uma sequência consecutiva de
      // linhas com chars de QR, acumulamos. Esvaziamos no fim do bloco
      // (linha em branco ou linha sem QR chars).
      let qrLines: string[] = [];
      const flushQr = () => {
        if (qrLines.length >= 8) {
          send("qr", qrLines.join("\n"));
        }
        qrLines = [];
      };

      const handleLine = (line: string, streamKind: "stdout" | "stderr") => {
        send(streamKind, line);

        const codeMatch = line.match(CODE_RE);
        if (codeMatch) send("code", codeMatch[1]);

        if (PAIRED_RE.test(line)) send("paired");
        if (TIMEOUT_RE.test(line)) send("timeout");

        // Buffer QR: linha "vazia" de QR são chars de bloco em qualquer
        // posição. Se a linha tem chars de QR e tamanho >= 20, conta.
        const stripped = line.trimEnd();
        if (stripped.length >= 20 && QR_CHARS.test(stripped)) {
          qrLines.push(line);
        } else if (qrLines.length > 0) {
          flushQr();
        }
      };

      // Drena buffer inicial (linhas que chegaram entre o spawn e o
      // consumer abrir o SSE).
      for (const b of entry.bufferedLines) {
        handleLine(b.line, b.stream);
      }
      entry.bufferedLines = [];

      const onStdout = (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.length > 0) handleLine(line, "stdout");
        }
      };
      const onStderr = (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.length > 0) handleLine(line, "stderr");
        }
      };

      entry.proc.stdout.on("data", onStdout);
      entry.proc.stderr.on("data", onStderr);

      entry.proc.on("close", (code) => {
        flushQr();
        send("done", `exit_code=${code}`);
        closed = true;
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });

      request.signal?.addEventListener("abort", () => {
        closed = true;
        try {
          entry.proc.stdout.off("data", onStdout);
          entry.proc.stderr.off("data", onStderr);
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
        // Não removemos a sessão aqui — o operador pode reconectar.
      });
    },

    cancel() {
      // Cleanup completo só quando o stream é cancelado explicitamente.
      removePairing(id);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
