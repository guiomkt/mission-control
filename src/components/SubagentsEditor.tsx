"use client";

/**
 * Tab "Subagents" do agent detail.
 *
 * Mostra grid de checkboxes com todos os outros agentes existentes.
 * Marcados = entram em `subagents.allowAgents[]` deste agente, podem ser
 * invocados como subagent pelo gateway.
 *
 * Save = PATCH /api/agents/[id]/subagents com `{ allowAgents: [...] }`.
 * Vazio = remove a chave `subagents` inteira do agente.
 */
import { useState } from "react";
import {
  Loader2,
  Save,
  Users,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface Sibling {
  id: string;
  name: string;
  emoji?: string;
}

interface Props {
  agentId: string;
  /** Estado atual de allowAgents vindo do GET. */
  allowAgents: string[];
  /** Outros agentes da config — possíveis candidatos. */
  siblings: Sibling[];
  onChange: () => void;
}

export function SubagentsEditor({
  agentId,
  allowAgents,
  siblings,
  onChange,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(allowAgents),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSavedAt(null);
  };

  // Diff: o que mudou?
  const original = new Set(allowAgents);
  const added = [...selected].filter((x) => !original.has(x));
  const removed = [...original].filter((x) => !selected.has(x));
  const dirty = added.length > 0 || removed.length > 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/subagents`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allowAgents: [...selected] }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setSavedAt(Date.now());
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSelected(new Set(allowAgents));
    setError(null);
    setSavedAt(null);
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-sm font-semibold mb-2 flex items-center gap-2"
          style={{ color: "var(--text-primary)" }}
        >
          <Users className="w-4 h-4" />
          Subagents permitidos ({selected.size})
        </h3>
        <p
          className="text-xs mb-4"
          style={{ color: "var(--text-muted)" }}
        >
          Quais outros agentes este pode invocar via{" "}
          <code>spawn_agent</code>. Mudanças entram em vigor na próxima sessão
          (não afeta sessions já ativas).
        </p>

        {siblings.length === 0 ? (
          <div
            className="text-xs p-3 rounded text-center"
            style={{
              backgroundColor: "var(--card-elevated)",
              color: "var(--text-muted)",
              border: "1px dashed var(--border)",
            }}
          >
            Não há outros agentes na config. Crie agentes primeiro pra montar a hierarquia.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {siblings.map((s) => {
              const checked = selected.has(s.id);
              return (
                <label
                  key={s.id}
                  className="flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors"
                  style={{
                    backgroundColor: checked
                      ? "var(--accent-soft, rgba(0,122,255,0.12))"
                      : "var(--card-elevated)",
                    border: checked
                      ? "1px solid var(--accent)"
                      : "1px solid var(--border)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="w-4 h-4"
                  />
                  <span className="text-lg">{s.emoji ?? "🤖"}</span>
                  <span className="flex-1 min-w-0">
                    <span
                      className="block text-sm font-medium truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {s.name}
                    </span>
                    <code
                      className="block text-[10px] truncate"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {s.id}
                    </code>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {/* Diff preview */}
        {dirty && (
          <div
            className="mt-4 p-3 rounded text-xs"
            style={{
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              className="font-semibold mb-1"
              style={{ color: "var(--text-secondary)" }}
            >
              Mudanças pendentes:
            </div>
            {added.length > 0 && (
              <div style={{ color: "var(--success, #34C759)" }}>
                + adicionar: {added.join(", ")}
              </div>
            )}
            {removed.length > 0 && (
              <div style={{ color: "var(--error, #FF3B30)" }}>
                − remover: {removed.join(", ")}
              </div>
            )}
          </div>
        )}

        {error && (
          <div
            className="mt-3 flex items-start gap-2 text-xs px-3 py-2 rounded"
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

        {savedAt && !dirty && (
          <div
            className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded"
            style={{
              backgroundColor: "var(--success-bg, rgba(52,199,89,0.1))",
              color: "var(--success, #34C759)",
            }}
          >
            <CheckCircle2 className="w-4 h-4" />
            Salvo. As mudanças aplicam na próxima sessão deste agente.
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          {dirty && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-3 py-1.5 rounded text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              Descartar
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
