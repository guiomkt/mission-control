"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Smartphone,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface WhatsAppPairingModalProps {
  isOpen: boolean;
  initialAccount?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Phase =
  | "form"
  | "starting"
  | "waiting-qr"
  | "qr-ready"
  | "paired"
  | "error";

export function WhatsAppPairingModal({
  isOpen,
  initialAccount = "",
  onClose,
  onSuccess,
}: WhatsAppPairingModalProps) {
  const [account, setAccount] = useState(initialAccount);
  const [phase, setPhase] = useState<Phase>("form");
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Cleanup quando o modal fecha — cancela pairing pendente, fecha SSE.
  useEffect(() => {
    if (!isOpen) {
      cleanup();
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const reset = () => {
    setAccount(initialAccount);
    setPhase("form");
    setQr(null);
    setPairingCode(null);
    setError(null);
    setPairingId(null);
  };

  const cleanup = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (pairingId) {
      // Best-effort cancel — backend mata o subprocess.
      fetch("/api/openclaw/channels/whatsapp/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingId }),
      }).catch(() => {
        /* ignore */
      });
    }
  };

  const handleClose = () => {
    cleanup();
    reset();
    onClose();
  };

  const startPairing = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPhase("starting");

    try {
      const res = await fetch("/api/openclaw/channels/whatsapp/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.pairingId) {
        throw new Error(data.error || "Falha ao iniciar pairing");
      }
      setPairingId(data.pairingId);
      setPhase("waiting-qr");

      // Abre o SSE pra consumir o output do CLI.
      const es = new EventSource(
        `/api/openclaw/channels/whatsapp/pair-stream?id=${encodeURIComponent(data.pairingId)}`,
      );
      esRef.current = es;

      es.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            type: string;
            payload?: string;
          };
          if (msg.type === "qr" && msg.payload) {
            setQr(msg.payload);
            setPhase("qr-ready");
          } else if (msg.type === "code" && msg.payload) {
            setPairingCode(msg.payload);
            setPhase("qr-ready");
          } else if (msg.type === "paired") {
            setPhase("paired");
            es.close();
            esRef.current = null;
            // Pequeno delay pra UX antes de fechar.
            setTimeout(() => onSuccess(), 1500);
          } else if (msg.type === "timeout") {
            setError("Pairing expirou. Tente de novo.");
            setPhase("error");
            es.close();
            esRef.current = null;
          }
        } catch {
          /* ignore non-JSON heartbeats */
        }
      };

      es.onerror = () => {
        if (esRef.current === es) {
          setError("Conexão com o stream falhou. Tente de novo.");
          setPhase("error");
          es.close();
          esRef.current = null;
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
      setPhase("error");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-xl p-6"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {phase === "form"
                ? "Conectar conta WhatsApp"
                : phase === "paired"
                  ? "Conectado!"
                  : "Pareando WhatsApp"}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-gray-700"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        {phase === "form" && (
          <form onSubmit={startPairing} className="space-y-3">
            <p
              className="text-sm"
              style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
            >
              Vai aparecer um QR code aqui. Escaneie no app WhatsApp do
              celular em <strong>Aparelhos conectados → Conectar um aparelho</strong>.
            </p>
            <div>
              <label
                className="block text-xs uppercase mb-1 tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Nome da conta
              </label>
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value.toLowerCase())}
                placeholder="ex: pessoal"
                pattern="^[a-z][a-z0-9-]{0,29}$"
                required
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: "var(--accent)", color: "white" }}
              >
                Gerar QR code
              </button>
            </div>
          </form>
        )}

        {(phase === "starting" || phase === "waiting-qr") && (
          <div
            className="flex flex-col items-center gap-3 py-12"
            style={{ color: "var(--text-secondary)" }}
          >
            <Loader2
              className="w-8 h-8 animate-spin"
              style={{ color: "var(--accent)" }}
            />
            <p className="text-sm">
              {phase === "starting"
                ? "Iniciando pairing..."
                : "Aguardando QR code do gateway..."}
            </p>
          </div>
        )}

        {phase === "qr-ready" && (
          <div className="flex flex-col items-center gap-4">
            {qr && (
              <pre
                className="rounded p-2"
                style={{
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  fontFamily: "monospace",
                  fontSize: "8px",
                  lineHeight: 1,
                  letterSpacing: 0,
                  margin: 0,
                  whiteSpace: "pre",
                }}
              >
                {qr}
              </pre>
            )}
            {pairingCode && (
              <div className="text-center">
                <p
                  className="text-xs uppercase mb-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  Ou use o código:
                </p>
                <p
                  className="font-mono text-lg font-bold tracking-widest"
                  style={{ color: "var(--text-primary)" }}
                >
                  {pairingCode}
                </p>
              </div>
            )}
            <p
              className="text-xs text-center"
              style={{ color: "var(--text-muted)", lineHeight: 1.6 }}
            >
              No celular: WhatsApp → ⋮ → Aparelhos conectados →<br />
              Conectar um aparelho → escaneie ou digite o código
            </p>
          </div>
        )}

        {phase === "paired" && (
          <div
            className="flex flex-col items-center gap-3 py-12"
            style={{ color: "var(--text-secondary)" }}
          >
            <CheckCircle2
              className="w-12 h-12"
              style={{ color: "var(--success, #34C759)" }}
            />
            <p className="text-sm">Pareamento concluído!</p>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col gap-3 py-6">
            <div
              className="flex items-start gap-2 text-sm px-3 py-2 rounded"
              style={{
                backgroundColor: "var(--error-bg, rgba(255,59,48,0.1))",
                color: "var(--error, #FF3B30)",
              }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  reset();
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: "var(--accent)", color: "white" }}
              >
                Tentar de novo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
