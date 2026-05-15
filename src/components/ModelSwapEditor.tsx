"use client";

/**
 * Card de "Trocar modelo" — fica na tab Identity (não merece tab própria
 * porque a UI é compacta).
 *
 * Reforço de segurança visual: badge "OAuth-only" + lista filtrada da
 * whitelist em model-whitelist.ts. O endpoint server-side faz a mesma
 * checagem, então mesmo se alguém POSTar direto sem usar essa UI, o
 * modelo pago é rejeitado.
 */
import { useState } from "react";
import {
  Loader2,
  Save,
  AlertCircle,
  CheckCircle2,
  Plus,
  X,
  Lock,
  RefreshCcw,
} from "lucide-react";
import { OAUTH_MODELS } from "@/lib/model-whitelist";

interface Props {
  agentId: string;
  currentPrimary: string | null;
  currentFallbacks: string[];
  onChange: () => void;
}

export function ModelSwapEditor({
  agentId,
  currentPrimary,
  currentFallbacks,
  onChange,
}: Props) {
  const [primary, setPrimary] = useState<string>(
    currentPrimary ?? OAUTH_MODELS[0].value,
  );
  const [fallbacks, setFallbacks] = useState<string[]>(currentFallbacks);
  const [addingFallback, setAddingFallback] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    primary !== (currentPrimary ?? OAUTH_MODELS[0].value) ||
    fallbacks.length !== currentFallbacks.length ||
    !fallbacks.every((f, i) => currentFallbacks[i] === f);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/model`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primary, fallbacks }),
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

  const handleReset = async () => {
    if (
      !confirm(
        `Resetar modelo de ${agentId} pra usar os defaults?\nO agente vai usar agents.defaults.model.`,
      )
    )
      return;
    setResetting(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/model`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disable: true }),
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
      setResetting(false);
    }
  };

  const handleAddFallback = () => {
    if (!addingFallback || fallbacks.includes(addingFallback)) return;
    if (addingFallback === primary) return;
    setFallbacks([...fallbacks, addingFallback]);
    setAddingFallback("");
  };

  const handleRemoveFallback = (value: string) => {
    setFallbacks(fallbacks.filter((f) => f !== value));
  };

  // Opções de fallback = todos OAuth menos o primary e os já adicionados.
  const fallbackOptions = OAUTH_MODELS.filter(
    (m) => m.value !== primary && !fallbacks.includes(m.value),
  );

  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-sm font-semibold flex items-center gap-2"
          style={{ color: "var(--text-primary)" }}
        >
          <RefreshCcw className="w-4 h-4" />
          Modelo do agente
        </h3>
        <span
          className="text-[10px] px-2 py-0.5 rounded font-semibold flex items-center gap-1"
          style={{
            backgroundColor: "var(--success-bg, rgba(52,199,89,0.15))",
            color: "var(--success, #34C759)",
          }}
        >
          <Lock className="w-3 h-3" />
          OAuth-only
        </span>
      </div>

      <p
        className="text-xs mb-4"
        style={{ color: "var(--text-muted)" }}
      >
        Modelo primário + fallbacks ordenados. Só modelos OAuth são oferecidos —
        modelos pagos (openai/, google/, etc) são bloqueados no backend pra
        honrar a restrição de custo.
      </p>

      <div className="space-y-3">
        <Field label="Primário">
          <select
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            disabled={saving || resetting}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={inputStyle}
          >
            {OAUTH_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Fallbacks (${fallbacks.length})`}>
          {fallbacks.length === 0 ? (
            <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
              Nenhum fallback. Se o primário falhar, usa o defaults global.
            </p>
          ) : (
            <ol className="space-y-1 mb-2 list-decimal pl-5">
              {fallbacks.map((f) => {
                const meta = OAUTH_MODELS.find((m) => m.value === f);
                return (
                  <li
                    key={f}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <code style={{ color: "var(--text-primary)" }}>
                      {meta?.label ?? f}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleRemoveFallback(f)}
                      disabled={saving || resetting}
                      className="p-1 rounded hover:bg-red-500/20"
                    >
                      <X
                        className="w-3 h-3"
                        style={{ color: "var(--text-muted)" }}
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {fallbackOptions.length > 0 && (
            <div className="flex gap-2">
              <select
                value={addingFallback}
                onChange={(e) => setAddingFallback(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded text-xs"
                style={inputStyle}
              >
                <option value="">— escolha um fallback —</option>
                {fallbackOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddFallback}
                disabled={!addingFallback || saving || resetting}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-30"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  color: "var(--accent)",
                  border: "1px solid var(--accent)",
                }}
              >
                <Plus className="w-3 h-3" />
                Adicionar
              </button>
            </div>
          )}
        </Field>
      </div>

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

      {savedAt && !dirty && !error && (
        <div
          className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded"
          style={{
            backgroundColor: "var(--success-bg, rgba(52,199,89,0.1))",
            color: "var(--success, #34C759)",
          }}
        >
          <CheckCircle2 className="w-4 h-4" />
          Salvo. Próxima session do agente usa o modelo novo.
        </div>
      )}

      <div className="mt-4 flex justify-between gap-2">
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting || saving}
          className="flex items-center gap-2 px-3 py-2 rounded text-xs disabled:opacity-40"
          style={{
            backgroundColor: "var(--card-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
          title="Remove a chave model do agente — vai usar agents.defaults.model"
        >
          {resetting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="w-3.5 h-3.5" />
          )}
          Resetar pra defaults
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || resetting || !dirty}
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
};
