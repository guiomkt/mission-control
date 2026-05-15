"use client";

/**
 * Diálogo de clonar agente. Pede newId + newName, chama POST /clone.
 *
 * NÃO copia: bindings (operador refaz pra evitar duplo-routing) e
 * sessions (privadas). Avisa isso na UI.
 */
import { useEffect, useState } from "react";
import { X, Copy, Loader2, AlertCircle, AlertTriangle } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (created: { id: string; name: string }) => void;
  sourceAgent: { id: string; name: string };
  existingIds: string[];
}

const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function CloneAgentDialog({
  isOpen,
  onClose,
  onSuccess,
  sourceAgent,
  existingIds,
}: Props) {
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idTouched, setIdTouched] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const baseId = `${sourceAgent.id}-copy`;
      const baseName = `${sourceAgent.name} (clone)`;
      setNewId(baseId);
      setNewName(baseName);
      setError(null);
      setIdTouched(false);
    }
  }, [isOpen, sourceAgent.id, sourceAgent.name]);

  // Quando o nome muda E o id ainda não foi tocado, atualiza o id.
  useEffect(() => {
    if (!idTouched && newName) {
      setNewId(slugify(newName));
    }
  }, [newName, idTouched]);

  if (!isOpen) return null;

  const idValid = ID_RE.test(newId);
  const idCollision = existingIds.includes(newId);
  const canSubmit = idValid && !idCollision && !loading && newName.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(sourceAgent.id)}/clone`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newId, newName: newName.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      onSuccess({ id: data.id, name: data.name });
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
      onClick={() => !loading && onClose()}
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
            <Copy className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Clonar agente
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded hover:bg-gray-700"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <p
          className="text-xs mb-4"
          style={{ color: "var(--text-muted)" }}
        >
          Cria novo agente copiando workspace + model + subagents + heartbeat de{" "}
          <code style={{ color: "var(--text-primary)" }}>{sourceAgent.id}</code>.
        </p>

        <div
          className="rounded-lg p-3 mb-4 flex items-start gap-2 text-xs"
          style={{
            backgroundColor: "var(--warning-bg, rgba(255,149,0,0.08))",
            border: "1px solid var(--warning, #FF9500)",
            color: "var(--warning, #FF9500)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">NÃO copiado:</p>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>Bindings (canais) — refaça pra evitar duplo-routing</li>
              <li>Sessions e transcripts (são privadas)</li>
              <li>Skills do .clawhub (reinstala se quiser)</li>
            </ul>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Nome do novo agente
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
            />
          </div>

          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              ID
            </label>
            <input
              type="text"
              value={newId}
              onChange={(e) => {
                setNewId(e.target.value);
                setIdTouched(true);
              }}
              maxLength={40}
              required
              className="w-full px-3 py-2 rounded-lg text-sm font-mono"
              style={{
                ...inputStyle,
                borderColor:
                  newId.length > 0 && (!idValid || idCollision)
                    ? "var(--error, #FF3B30)"
                    : "var(--border)",
              }}
              placeholder="lowercase-com-hifens"
            />
            {newId.length > 0 && !idValid && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--error, #FF3B30)" }}
              >
                Use [a-z][a-z0-9-], máx 40 chars.
              </p>
            )}
            {idCollision && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--error, #FF3B30)" }}
              >
                ID já existe.
              </p>
            )}
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
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {loading ? "Clonando…" : "Clonar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--card-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};
