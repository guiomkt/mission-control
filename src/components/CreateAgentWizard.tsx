"use client";

import { useEffect, useState } from "react";
import {
  X,
  Bot,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

interface CreateAgentWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (agent: { id: string; name: string }) => void;
  /** Ids já existentes, pra validação client-side de colisão. */
  existingIds: string[];
}

type Step = "basics" | "model" | "review";

interface FormState {
  id: string;
  name: string;
  emoji: string;
  theme: string;
  model: string;
}

const DEFAULT_FORM: FormState = {
  id: "",
  name: "",
  emoji: "🤖",
  theme: "",
  model: "openai-codex/gpt-5.4",
};

// Modelos OAuth seguros (descobertos via /api/openclaw/models/cost-status).
const MODEL_OPTIONS = [
  { value: "openai-codex/gpt-5.4", label: "ChatGPT 5.4 (OAuth) — recomendado" },
  { value: "openai-codex/gpt-5.4-pro", label: "ChatGPT 5.4 Pro (OAuth)" },
  // Removidos em 2026-05-18 (OpenClaw 2026.5.12 deprecou gpt-5.2 + gpt-5.1-codex-max).
  {
    value: "minimax-portal/MiniMax-M2.7",
    label: "Minimax M2.7 (OAuth — fallback)",
  },
];

const THEME_SUGGESTIONS = [
  { value: "#3b82f6", label: "Azul" },
  { value: "#10b981", label: "Verde" },
  { value: "#f59e0b", label: "Âmbar" },
  { value: "#ef4444", label: "Vermelho" },
  { value: "#a855f7", label: "Roxo" },
  { value: "#ec4899", label: "Rosa" },
];

const ID_REGEX = /^[a-z][a-z0-9-]{0,39}$/;

export function CreateAgentWizard({
  isOpen,
  onClose,
  onSuccess,
  existingIds,
}: CreateAgentWizardProps) {
  const [step, setStep] = useState<Step>("basics");
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset ao abrir/fechar
  useEffect(() => {
    if (isOpen) {
      setStep("basics");
      setForm(DEFAULT_FORM);
      setServerError(null);
    }
  }, [isOpen]);

  // Auto-slug do nome quando o user ainda não digitou id
  useEffect(() => {
    if (!form.name) return;
    if (form.id) return; // operador já customizou
    const slug = form.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (slug && slug !== form.id) setForm((f) => ({ ...f, id: slug }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name]);

  if (!isOpen) return null;

  const idError = validateId(form.id, existingIds);

  const canAdvanceFromBasics =
    form.name.trim().length > 0 && !idError;
  const canSubmit = canAdvanceFromBasics && form.model.length > 0;

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleSubmit = async () => {
    setServerError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          name: form.name.trim(),
          emoji: form.emoji,
          theme: form.theme,
          model: form.model,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "Falha ao criar agente");
      }
      onSuccess({ id: form.id, name: form.name.trim() });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
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
        className="w-full max-w-lg rounded-xl p-6"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Novo agente — passo {stepNumber(step)} de 3
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

        {/* Progress dots */}
        <div className="flex gap-2 mb-4">
          {(["basics", "model", "review"] as Step[]).map((s) => (
            <div
              key={s}
              className="flex-1 h-1 rounded"
              style={{
                backgroundColor:
                  stepNumber(s) <= stepNumber(step)
                    ? "var(--accent)"
                    : "var(--border)",
              }}
            />
          ))}
        </div>

        {/* Step content */}
        {step === "basics" && (
          <BasicsStep form={form} setForm={setForm} idError={idError} />
        )}
        {step === "model" && <ModelStep form={form} setForm={setForm} />}
        {step === "review" && <ReviewStep form={form} />}

        {/* Server error */}
        {serverError && (
          <div
            className="flex items-start gap-2 text-xs px-3 py-2 rounded mt-3"
            style={{
              backgroundColor: "var(--error-bg, rgba(255,59,48,0.1))",
              color: "var(--error, #FF3B30)",
              whiteSpace: "pre-wrap",
            }}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-5 gap-2">
          <button
            type="button"
            onClick={() => {
              if (step === "model") setStep("basics");
              else if (step === "review") setStep("model");
            }}
            disabled={step === "basics" || loading}
            className="px-3 py-2 rounded-lg text-sm disabled:opacity-40 flex items-center gap-1"
            style={{
              color: "var(--text-secondary)",
            }}
          >
            <ChevronLeft className="w-4 h-4" />
            Voltar
          </button>

          {step === "basics" && (
            <button
              type="button"
              onClick={() => setStep("model")}
              disabled={!canAdvanceFromBasics}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex items-center gap-1"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              Próximo
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {step === "model" && (
            <button
              type="button"
              onClick={() => setStep("review")}
              disabled={form.model.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex items-center gap-1"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              Revisar
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {step === "review" && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Criando..." : "Criar agente"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Steps ──────────────────────────────────────────────────────────────

function BasicsStep({
  form,
  setForm,
  idError,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  idError: string | null;
}) {
  return (
    <div className="space-y-3">
      <p
        className="text-sm mb-2"
        style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
      >
        Comece pelo básico: nome amigável, ID único (slug) e visual.
      </p>

      <Field label="Nome">
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="ex: Researcher Bot"
          maxLength={80}
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={inputStyle}
        />
      </Field>

      <Field label="ID (slug)">
        <input
          type="text"
          value={form.id}
          onChange={(e) =>
            setForm({ ...form, id: e.target.value.toLowerCase() })
          }
          placeholder="researcher-bot"
          pattern="^[a-z][a-z0-9-]{0,39}$"
          maxLength={40}
          className="w-full px-3 py-2 rounded-lg text-sm font-mono"
          style={inputStyle}
        />
        <p
          className="text-[11px] mt-1"
          style={{
            color: idError ? "var(--error, #FF3B30)" : "var(--text-muted)",
          }}
        >
          {idError ?? "Letras minúsculas, dígitos e hífen. Começa com letra. Max 40 chars."}
        </p>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Emoji">
          <input
            type="text"
            value={form.emoji}
            onChange={(e) => setForm({ ...form, emoji: e.target.value })}
            maxLength={8}
            className="w-full px-3 py-2 rounded-lg text-2xl text-center"
            style={inputStyle}
          />
        </Field>

        <Field label="Cor / Tema">
          <div className="flex gap-1.5 flex-wrap">
            {THEME_SUGGESTIONS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setForm({ ...form, theme: t.value })}
                className="w-7 h-7 rounded-full"
                style={{
                  backgroundColor: t.value,
                  border:
                    form.theme === t.value
                      ? "2px solid var(--text-primary)"
                      : "1px solid var(--border)",
                }}
                title={t.label}
                aria-label={t.label}
              />
            ))}
          </div>
        </Field>
      </div>
    </div>
  );
}

function ModelStep({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <div className="space-y-3">
      <p
        className="text-sm mb-2"
        style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
      >
        Escolha o modelo principal do agente. Recomendamos modelos OAuth (sem custo extra por token).
      </p>

      <Field label="Modelo">
        <div className="space-y-2">
          {MODEL_OPTIONS.map((m) => (
            <label
              key={m.value}
              className="flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer"
              style={{
                backgroundColor:
                  form.model === m.value
                    ? "var(--accent-soft, rgba(0,122,255,0.12))"
                    : "var(--card-elevated)",
                border:
                  form.model === m.value
                    ? "1px solid var(--accent)"
                    : "1px solid var(--border)",
              }}
            >
              <input
                type="radio"
                name="model"
                checked={form.model === m.value}
                onChange={() => setForm({ ...form, model: m.value })}
                className="mt-1"
              />
              <div className="flex-1">
                <div
                  className="font-mono text-xs"
                  style={{ color: "var(--text-primary)" }}
                >
                  {m.value}
                </div>
                <div
                  className="text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {m.label}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}

function ReviewStep({ form }: { form: FormState }) {
  return (
    <div className="space-y-3">
      <p
        className="text-sm mb-2"
        style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}
      >
        Confirme antes de criar. Workspace e config serão criados automaticamente.
      </p>

      <div
        className="rounded-lg p-4 space-y-2"
        style={{
          backgroundColor: "var(--card-elevated)",
          border: "1px solid var(--border)",
        }}
      >
        <Row label="Nome">
          <span className="text-2xl mr-2">{form.emoji}</span>
          {form.name || "—"}
        </Row>
        <Row label="ID">
          <code style={{ color: "var(--text-primary)" }}>{form.id}</code>
        </Row>
        <Row label="Modelo">
          <code className="text-xs">{form.model}</code>
        </Row>
        {form.theme && (
          <Row label="Cor">
            <span
              className="inline-block w-4 h-4 rounded-full mr-2 align-middle"
              style={{ backgroundColor: form.theme }}
            />
            <code className="text-xs">{form.theme}</code>
          </Row>
        )}
        <Row label="Workspace">
          <code className="text-xs">/data/.openclaw/workspace-{form.id}</code>
        </Row>
      </div>

      <div
        className="flex items-start gap-2 text-xs px-3 py-2 rounded"
        style={{
          backgroundColor: "var(--info-bg, rgba(0,122,255,0.05))",
          color: "var(--text-secondary)",
        }}
      >
        <CheckCircle2
          className="w-4 h-4 shrink-0 mt-0.5"
          style={{ color: "var(--accent)" }}
        />
        <span>
          Após criação você poderá editar prompt, heartbeat, subagents,
          bindings, etc. via tabs do agente.
        </span>
      </div>
    </div>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────

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

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className="text-xs uppercase tracking-wider w-24 shrink-0"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <span className="flex-1" style={{ color: "var(--text-primary)" }}>
        {children}
      </span>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--card-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono, monospace)",
};

function stepNumber(s: Step): number {
  return s === "basics" ? 1 : s === "model" ? 2 : 3;
}

function validateId(id: string, existingIds: string[]): string | null {
  if (!id) return null; // empty = not yet typed, no error
  if (!ID_REGEX.test(id)) {
    return "ID inválido. Use [a-z, 0-9, -], começa com letra, max 40 chars.";
  }
  if (id === "main" || id === "defaults") {
    return `"${id}" é reservado.`;
  }
  if (existingIds.includes(id)) {
    return `Já existe um agente com id "${id}".`;
  }
  return null;
}
