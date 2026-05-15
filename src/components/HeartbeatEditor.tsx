"use client";

/**
 * Tab "Heartbeat" do agent detail.
 *
 * Heartbeat = "tick" autônomo do agente. O gateway acorda o agente a
 * cada `every` dentro de `activeHours`, e o agente pode enviar mensagem
 * pro `target:to` (canal+chat) usando `accountId`.
 *
 * Disabled = remove a chave `heartbeat` inteira do agente.
 */
import { useState } from "react";
import {
  Loader2,
  Save,
  Calendar,
  AlertCircle,
  CheckCircle2,
  PowerOff,
} from "lucide-react";

interface Heartbeat {
  every?: string;
  activeHours?: { start?: string; end?: string; timezone?: string };
  target?: string;
  to?: string;
  accountId?: string;
  lightContext?: boolean;
  isolatedSession?: boolean;
}

interface ChannelOption {
  name: string;
  accounts: string[];
}

interface Props {
  agentId: string;
  heartbeat: Heartbeat | null;
  availableChannels: ChannelOption[];
  onChange: () => void;
}

const EVERY_PRESETS = [
  { value: "0m", label: "Desligado (0m)" },
  { value: "15m", label: "A cada 15 min" },
  { value: "30m", label: "A cada 30 min" },
  { value: "1h", label: "A cada 1 hora" },
  { value: "2h", label: "A cada 2 horas" },
  { value: "6h", label: "A cada 6 horas" },
  { value: "12h", label: "A cada 12 horas" },
  { value: "24h", label: "A cada 24 horas" },
];

const DEFAULT_TZ = "America/Sao_Paulo";

export function HeartbeatEditor({
  agentId,
  heartbeat,
  availableChannels,
  onChange,
}: Props) {
  const hb = heartbeat ?? {};
  const [every, setEvery] = useState<string>(hb.every ?? "0m");
  const [start, setStart] = useState<string>(hb.activeHours?.start ?? "08:00");
  const [end, setEnd] = useState<string>(hb.activeHours?.end ?? "22:00");
  const [timezone, setTimezone] = useState<string>(
    hb.activeHours?.timezone ?? DEFAULT_TZ,
  );
  const [target, setTarget] = useState<string>(hb.target ?? "telegram");
  const [to, setTo] = useState<string>(hb.to ?? "");
  const [accountId, setAccountId] = useState<string>(hb.accountId ?? agentId);
  const [lightContext, setLightContext] = useState<boolean>(
    hb.lightContext ?? true,
  );
  const [isolatedSession, setIsolatedSession] = useState<boolean>(
    hb.isolatedSession ?? true,
  );

  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const isEnabled = heartbeat !== null && (heartbeat.every ?? "0m") !== "0m";

  const targetChannel = availableChannels.find((c) => c.name === target);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const body: Heartbeat = {
        every,
        activeHours: { start, end, timezone },
        target,
        to,
        accountId,
        lightContext,
        isolatedSession,
      };
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/heartbeat`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

  const handleDisable = async () => {
    if (
      !confirm(
        `Desligar heartbeat de ${agentId}?\nO agente não vai mais despertar autonomamente.`,
      )
    )
      return;
    setDisabling(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/heartbeat`,
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
      setDisabling(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4 max-w-2xl">
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
            <Calendar className="w-4 h-4" />
            Heartbeat — schedule autônomo
          </h3>
          <span
            className="text-[10px] px-2 py-0.5 rounded font-semibold"
            style={{
              backgroundColor: isEnabled
                ? "var(--success-bg, rgba(52,199,89,0.15))"
                : "var(--card-elevated)",
              color: isEnabled
                ? "var(--success, #34C759)"
                : "var(--text-muted)",
            }}
          >
            {isEnabled ? "ATIVO" : "DESLIGADO"}
          </span>
        </div>

        <p
          className="text-xs mb-4"
          style={{ color: "var(--text-muted)" }}
        >
          Define com que frequência este agente acorda sozinho, dentro de quais
          horas, e pra qual canal manda a output. Mudanças entram no próximo
          tick do gateway.
        </p>

        <div className="space-y-4">
          <Field label="Frequência (every)">
            <select
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
            >
              {EVERY_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Active hours (timezone)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm"
                style={inputStyle}
              />
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm"
                style={inputStyle}
              />
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/Sao_Paulo"
                className="px-3 py-2 rounded-lg text-xs font-mono"
                style={inputStyle}
              />
            </div>
          </div>

          <Field label="Canal alvo (target)">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
            >
              {availableChannels.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Conta (accountId)">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
            >
              <option value="">— escolha uma conta —</option>
              {(targetChannel?.accounts ?? []).map((acc) => (
                <option key={acc} value={acc}>
                  {acc}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Destino (to) — chat/topic id">
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="-1003810691299:topic:4"
              className="w-full px-3 py-2 rounded-lg text-xs font-mono"
              style={inputStyle}
              maxLength={80}
            />
          </Field>

          <div className="flex gap-4 pt-2 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={lightContext}
                onChange={(e) => setLightContext(e.target.checked)}
              />
              <span style={{ color: "var(--text-primary)" }}>
                lightContext
              </span>
              <span
                className="text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                (contexto mínimo)
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isolatedSession}
                onChange={(e) => setIsolatedSession(e.target.checked)}
              />
              <span style={{ color: "var(--text-primary)" }}>
                isolatedSession
              </span>
              <span
                className="text-[10px]"
                style={{ color: "var(--text-muted)" }}
              >
                (session separada)
              </span>
            </label>
          </div>
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

        {savedAt && (
          <div
            className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded"
            style={{
              backgroundColor: "var(--success-bg, rgba(52,199,89,0.1))",
              color: "var(--success, #34C759)",
            }}
          >
            <CheckCircle2 className="w-4 h-4" />
            Salvo.
          </div>
        )}

        <div className="mt-4 flex justify-between gap-2">
          {heartbeat !== null && (
            <button
              type="button"
              onClick={handleDisable}
              disabled={disabling || saving}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs disabled:opacity-40"
              style={{
                backgroundColor: "var(--card-elevated)",
                color: "var(--error, #FF3B30)",
                border: "1px solid var(--error, #FF3B30)",
              }}
              title="Remove a chave heartbeat inteira do agente"
            >
              {disabling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <PowerOff className="w-4 h-4" />
              )}
              Desligar heartbeat
            </button>
          )}
          <button
            type="submit"
            disabled={saving || disabling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 ml-auto"
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
    </form>
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
