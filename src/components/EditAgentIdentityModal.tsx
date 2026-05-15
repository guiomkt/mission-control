"use client";

import { useEffect, useState } from "react";
import { X, Edit3, Loader2, AlertCircle } from "lucide-react";

interface EditAgentIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agent: {
    id: string;
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  } | null;
}

const THEME_SUGGESTIONS = [
  { value: "#3b82f6", label: "Azul" },
  { value: "#10b981", label: "Verde" },
  { value: "#f59e0b", label: "Âmbar" },
  { value: "#ef4444", label: "Vermelho" },
  { value: "#a855f7", label: "Roxo" },
  { value: "#ec4899", label: "Rosa" },
  { value: "#06b6d4", label: "Ciano" },
  { value: "#6b7280", label: "Cinza" },
];

export function EditAgentIdentityModal({
  isOpen,
  onClose,
  onSuccess,
  agent,
}: EditAgentIdentityModalProps) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [theme, setTheme] = useState("");
  const [avatar, setAvatar] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hidrata os campos quando abre / agente muda.
  useEffect(() => {
    if (isOpen && agent) {
      setName(agent.name ?? "");
      setEmoji(agent.emoji ?? "");
      setTheme(agent.theme ?? "");
      setAvatar(agent.avatar ?? "");
      setError(null);
    }
  }, [isOpen, agent]);

  if (!isOpen || !agent) return null;

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  // Só envia campos que mudaram do estado original.
  const buildPatch = () => {
    const patch: Record<string, string> = {};
    if (name.trim() !== (agent.name ?? "")) patch.name = name.trim();
    if (emoji !== (agent.emoji ?? "")) patch.emoji = emoji;
    if (theme !== (agent.theme ?? "")) patch.theme = theme;
    if (avatar !== (agent.avatar ?? "")) patch.avatar = avatar;
    return patch;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setError("Nenhuma mudança detectada.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agent.id)}/identity`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "Falha ao atualizar");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

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
            <Edit3 className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Editar identidade
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
          className="text-xs mb-4"
          style={{ color: "var(--text-muted)" }}
        >
          Editando <code style={{ color: "var(--text-primary)" }}>{agent.id}</code>.
          Apenas campos modificados serão enviados ao gateway.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nome">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
            />
          </Field>

          <Field label="Emoji">
            <input
              type="text"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={8}
              className="w-full px-3 py-2 rounded-lg text-2xl text-center"
              style={inputStyle}
            />
          </Field>

          <Field label="Cor / Tema">
            <div className="flex gap-1.5 flex-wrap mb-2">
              {THEME_SUGGESTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  className="w-7 h-7 rounded-full"
                  style={{
                    backgroundColor: t.value,
                    border:
                      theme === t.value
                        ? "2px solid var(--text-primary)"
                        : "1px solid var(--border)",
                  }}
                  title={t.label}
                  aria-label={t.label}
                />
              ))}
            </div>
            <input
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="#3b82f6"
              maxLength={40}
              className="w-full px-3 py-2 rounded-lg text-xs font-mono"
              style={inputStyle}
            />
          </Field>

          <Field label="Avatar (URL ou path relativo)">
            <input
              type="text"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="https://… ou avatars/foo.png"
              maxLength={300}
              className="w-full px-3 py-2 rounded-lg text-xs"
              style={inputStyle}
            />
          </Field>

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
              {loading ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="block text-xs uppercase mb-1 tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--card-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono, monospace)",
};
