"use client";

import { useState } from "react";
import { X, MessageCircle, Loader2, AlertCircle } from "lucide-react";

interface AddTelegramAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddTelegramAccountModal({
  isOpen,
  onClose,
  onSuccess,
}: AddTelegramAccountModalProps) {
  const [account, setAccount] = useState("");
  const [botToken, setBotToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setAccount("");
    setBotToken("");
    setError(null);
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/openclaw/channels/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account.trim(), botToken: botToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.detail || "Falha ao adicionar conta");
      }
      reset();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao adicionar conta");
    } finally {
      setLoading(false);
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
        className="w-full max-w-md rounded-xl p-6"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Adicionar conta Telegram
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
          Cria um novo bot polling. Gere o token via{" "}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            @BotFather
          </a>{" "}
          no Telegram.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
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
              placeholder="ex: ops-team"
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
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Só letras minúsculas, dígitos e hífen. Começa com letra.
            </p>
          </div>

          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Bot token
            </label>
            <input
              type="text"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456789:ABCdefGhIjKlMnOpQrStUvWxYz"
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
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Adicionando..." : "Adicionar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
