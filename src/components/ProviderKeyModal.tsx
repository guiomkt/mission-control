"use client";

import { useEffect, useState } from "react";
import {
  X,
  KeyRound,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  ExternalLink,
} from "lucide-react";

export interface ProviderModalSpec {
  id: string;
  label: string;
  envName: string;
  helpUrl?: string;
  /** Estado atual pra mostrar contexto ("Substituindo chave …ab12"). */
  currentLastFour?: string;
}

interface ProviderKeyModalProps {
  isOpen: boolean;
  provider: ProviderModalSpec | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ProviderKeyModal({
  isOpen,
  provider,
  onClose,
  onSuccess,
}: ProviderKeyModalProps) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ao trocar de provider ou abrir.
  useEffect(() => {
    if (isOpen) {
      setValue("");
      setReveal(false);
      setError(null);
    }
  }, [isOpen, provider?.id]);

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(
        `/api/openclaw/providers/${encodeURIComponent(provider.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: value.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "Falha ao gravar chave");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gravar chave");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !provider) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-xl p-6"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {provider.currentLastFour ? "Atualizar chave" : "Conectar"}: {provider.label}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-gray-700"
            aria-label="Fechar"
            disabled={loading}
          >
            <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <p
          className="text-sm mb-4"
          style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
        >
          A chave vai pra <code style={{ fontFamily: "var(--font-mono, monospace)" }}>{provider.envName}</code> no <code>.env</code> do gateway,
          e o container <code>openclaw-kozw</code> é reiniciado (~5s downtime).
          {provider.currentLastFour && (
            <>
              {" "}A chave atual termina em <code>…{provider.currentLastFour}</code>.
            </>
          )}
        </p>

        {provider.helpUrl && (
          <a
            href={provider.helpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs mb-3"
            style={{ color: "var(--accent)" }}
          >
            <ExternalLink className="w-3 h-3" />
            Onde gerar a chave
          </a>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              API Key
            </label>
            <div className="relative">
              <input
                type={reveal ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="cole aqui"
                required
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-2 pr-10 rounded-lg text-sm"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              />
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded"
                style={{ color: "var(--text-muted)" }}
                aria-label={reveal ? "Ocultar" : "Revelar"}
              >
                {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="flex items-start gap-2 text-xs px-3 py-2 rounded"
              style={{
                backgroundColor: "var(--error-bg, rgba(255,59,48,0.1))",
                color: "var(--error, #FF3B30)",
                whiteSpace: "pre-wrap",
              }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: "var(--text-secondary)" }}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || value.trim().length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading
                ? "Aplicando..."
                : provider.currentLastFour
                  ? "Atualizar"
                  : "Conectar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
