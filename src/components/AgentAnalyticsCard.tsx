"use client";

/**
 * Tab "Analytics" do agent detail.
 *
 * Cards de uso agregado (cost, tokens, count, error rate) + breakdown
 * por model / channel / kind. Tudo derivado de sessions.json — sem CLI.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  DollarSign,
  Activity,
  Zap,
  AlertTriangle,
  BarChart3,
} from "lucide-react";

interface UsageStats {
  count: number;
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  errorCount: number;
  errorRate: number;
  byModel: Array<{ model: string; count: number; cost: number; tokens: number }>;
  byChannel: Array<{ channel: string; count: number; cost: number }>;
  byKind: Array<{ kind: string; count: number; cost: number }>;
  oldestUpdatedAt: number | null;
  latestUpdatedAt: number | null;
  windowSize: number;
  capped: boolean;
}

interface Props {
  agentId: string;
}

export function AgentAnalyticsCard({ agentId }: Props) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/usage`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 p-4"
        style={{ color: "var(--text-muted)" }}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Computando usage…
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div
        className="rounded-lg p-3 flex items-start gap-2 text-sm"
        style={{
          backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
          color: "var(--error, #FF3B30)",
          border: "1px solid var(--error, #FF3B30)",
        }}
      >
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{error ?? "Sem dados."}</span>
      </div>
    );
  }

  const errorPercent = (stats.errorRate * 100).toFixed(1);

  return (
    <div className="space-y-4">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <BigCard
          icon={DollarSign}
          label="Custo total"
          value={`$${stats.totalCost.toFixed(4)}`}
          sub={`${stats.windowSize} sessions`}
        />
        <BigCard
          icon={Zap}
          label="Tokens"
          value={stats.totalTokens.toLocaleString()}
          sub={`${stats.totalInputTokens.toLocaleString()} in / ${stats.totalOutputTokens.toLocaleString()} out`}
        />
        <BigCard
          icon={Activity}
          label="Sessions"
          value={stats.count.toLocaleString()}
          sub={
            stats.latestUpdatedAt
              ? `última ${formatRelative(stats.latestUpdatedAt)}`
              : "—"
          }
        />
        <BigCard
          icon={AlertTriangle}
          label="Erro rate"
          value={`${errorPercent}%`}
          sub={`${stats.errorCount} abortadas`}
          tone={stats.errorRate > 0.1 ? "warn" : "ok"}
        />
      </div>

      {stats.capped && (
        <div
          className="rounded p-2 text-xs flex items-start gap-2"
          style={{
            backgroundColor: "var(--warning-bg, rgba(255,149,0,0.08))",
            color: "var(--warning, #FF9500)",
            border: "1px solid var(--warning, #FF9500)",
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Window cap: agregando últimas {stats.windowSize} sessions. O agente tem mais que isso — números são lower-bound.
          </span>
        </div>
      )}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <BreakdownCard
          title="Por model"
          rows={stats.byModel.map((m) => ({
            label: m.model,
            primary: `$${m.cost.toFixed(4)}`,
            secondary: `${m.count} sessions · ${m.tokens.toLocaleString()} tokens`,
            bar: stats.totalCost > 0 ? m.cost / stats.totalCost : 0,
          }))}
        />
        <BreakdownCard
          title="Por canal"
          rows={stats.byChannel.map((c) => ({
            label: c.channel,
            primary: `${c.count} sessions`,
            secondary: `$${c.cost.toFixed(4)}`,
            bar: stats.count > 0 ? c.count / stats.count : 0,
          }))}
        />
        <BreakdownCard
          title="Por kind"
          rows={stats.byKind.map((k) => ({
            label: k.kind,
            primary: `${k.count} sessions`,
            secondary: `$${k.cost.toFixed(4)}`,
            bar: stats.count > 0 ? k.count / stats.count : 0,
          }))}
        />
      </div>

      {/* Cache stats — útil pra ver se context cache tá funcionando */}
      {(stats.totalCacheRead > 0 || stats.totalCacheWrite > 0) && (
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <h3
            className="text-xs uppercase tracking-wider mb-3 flex items-center gap-1"
            style={{ color: "var(--text-muted)" }}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Context cache
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Cache read
              </div>
              <div
                className="text-lg font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {stats.totalCacheRead.toLocaleString()}
              </div>
            </div>
            <div>
              <div
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                Cache write
              </div>
              <div
                className="text-lg font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {stats.totalCacheWrite.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function BigCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "ok" | "warn";
}) {
  const accent =
    tone === "warn"
      ? "var(--warning, #FF9500)"
      : tone === "ok"
        ? "var(--success, #34C759)"
        : "var(--accent)";
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: accent }} />
        <span
          className="text-xs uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
      </div>
      <div
        className="text-2xl font-bold"
        style={{
          color: tone === "warn" ? accent : "var(--text-primary)",
          fontFamily: "var(--font-heading)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="text-[11px] mt-1"
          style={{ color: "var(--text-muted)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; primary: string; secondary: string; bar: number }>;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <h3
        className="text-xs uppercase tracking-wider mb-3"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>—</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <code
                  className="text-xs font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                  title={r.label}
                >
                  {r.label}
                </code>
                <span
                  className="text-xs font-semibold"
                  style={{ color: "var(--accent)" }}
                >
                  {r.primary}
                </span>
              </div>
              <div
                className="w-full rounded-full overflow-hidden h-1"
                style={{ backgroundColor: "var(--card-elevated)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(r.bar * 100, 2)}%`,
                    backgroundColor: "var(--accent)",
                  }}
                />
              </div>
              <div
                className="text-[10px] mt-0.5"
                style={{ color: "var(--text-muted)" }}
              >
                {r.secondary}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const ms = Date.now() - ts;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}
