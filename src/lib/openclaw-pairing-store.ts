/**
 * Store em memória pra sessões de pairing do WhatsApp.
 *
 * Fluxo:
 *   1. Operador clica "Adicionar WhatsApp" → POST /api/openclaw/channels/whatsapp/login
 *      cria um pairingId, spawna `openclaw channels login --channel whatsapp --account NAME`
 *      e guarda o handle no store.
 *   2. Frontend abre EventSource em GET /api/openclaw/channels/whatsapp/pair-stream?id=PAIRING_ID
 *      Esse endpoint puxa o handle do store e plumba stdout → SSE.
 *   3. Quando o pairing termina (sucesso/timeout/cancel), o handle é removido.
 *
 * Por que Map em memória e não Redis: single-instance deploy, vida média
 * dum pairing é < 2min, e perder o handle num restart só obriga o
 * operador a reabrir o modal (não corrompe nada).
 *
 * O store também faz garbage collection passivo via TTL — entradas
 * abandonadas (modal fechado sem cleanup) caem em 5 minutos.
 */
import type { ChildProcess } from "child_process";
import type { Readable } from "stream";

// `openclawSpawn` redireciona stdin pra 'ignore', então o ChildProcess
// resultante tem `stdin: null`. Usamos um tipo derivado pra refletir
// isso sem cair no `ChildProcessWithoutNullStreams` (que assume stdin
// existente). Stdout/stderr são Readable streams obrigatórios.
type PairingProc = ChildProcess & { stdout: Readable; stderr: Readable };

interface PairingEntry {
  proc: PairingProc;
  startedAt: number;
  // Buffer de output coletado entre o spawn e o primeiro consumer SSE
  // se conectar — pequena janela mas evita perder a primeira linha.
  bufferedLines: Array<{
    line: string;
    stream: "stdout" | "stderr";
    ts: number;
  }>;
  consumed: boolean;
}

const TTL_MS = 5 * 60 * 1000;
const sessions = new Map<string, PairingEntry>();

export function putPairing(id: string, proc: PairingProc): void {
  sessions.set(id, {
    proc,
    startedAt: Date.now(),
    bufferedLines: [],
    consumed: false,
  });
  pruneStale();
}

export function getPairing(id: string): PairingEntry | undefined {
  return sessions.get(id);
}

export function markConsumed(id: string): void {
  const entry = sessions.get(id);
  if (entry) entry.consumed = true;
}

export function bufferLine(
  id: string,
  line: string,
  stream: "stdout" | "stderr",
): void {
  const entry = sessions.get(id);
  if (!entry || entry.consumed) return;
  if (entry.bufferedLines.length > 500) return; // cap
  entry.bufferedLines.push({ line, stream, ts: Date.now() });
}

export function removePairing(id: string): void {
  const entry = sessions.get(id);
  if (!entry) return;
  try {
    entry.proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        entry.proc.kill("SIGKILL");
      } catch {
        /* already dead */
      }
    }, 1500);
  } catch {
    /* already dead */
  }
  sessions.delete(id);
}

function pruneStale(): void {
  const now = Date.now();
  for (const [id, entry] of sessions.entries()) {
    if (now - entry.startedAt > TTL_MS) {
      removePairing(id);
    }
  }
}
