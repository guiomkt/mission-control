"use client";

/**
 * Tab "Sessions" do agent detail.
 *
 * Layout:
 *  - Filtros no topo: channel, kind.
 *  - Lista de sessions (esquerda) em timeline reverso (mais recente primeiro).
 *  - Selecionar uma session → drawer com transcript paginado + delete.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  History,
  AlertTriangle,
} from "lucide-react";

interface SessionItem {
  key: string;
  sessionId: string;
  agentId: string;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  ageMs: number;
  status?: string;
  aborted: boolean;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  cacheRead: number;
  cacheWrite: number;
  estimatedCostUsd: number;
  model: string | null;
  modelProvider: string | null;
  channel: string | null;
  chatType: string | null;
  subject: string | null;
  displayName: string | null;
  kind: string | null;
}

interface TranscriptLine {
  lineNumber: number;
  data: unknown;
  raw?: string;
}

interface Detail {
  entry: SessionItem | null;
  transcriptBytes: number;
  transcriptLines: number;
  lines: TranscriptLine[];
  truncated: boolean;
}

interface Props {
  agentId: string;
}

export function SessionsBrowser({ agentId }: Props) {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [channel, setChannel] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [limit, setLimit] = useState(50);

  const [selected, setSelected] = useState<SessionItem | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(
        `/api/agents/${encodeURIComponent(agentId)}/sessions`,
        window.location.origin,
      );
      url.searchParams.set("limit", String(limit));
      if (channel) url.searchParams.set("channel", channel);
      if (kind) url.searchParams.set("kind", kind);
      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, channel, kind, limit]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Channels/kinds únicos pros filtros (extraídos do dataset atual).
  const channels = [...new Set(items.map((i) => i.channel).filter(Boolean))];
  const kinds = [...new Set(items.map((i) => i.kind).filter(Boolean))];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div
        className="rounded-xl p-3 flex items-center gap-3 flex-wrap"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          {total} sessions total · {items.length} exibidas
        </div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>·</span>
        <FilterSelect
          label="Canal"
          value={channel}
          onChange={setChannel}
          options={channels as string[]}
        />
        <FilterSelect
          label="Kind"
          value={kind}
          onChange={setKind}
          options={kinds as string[]}
        />
        <select
          value={limit}
          onChange={(e) => setLimit(Number.parseInt(e.target.value, 10))}
          className="px-2 py-1 rounded text-xs"
          style={{
            backgroundColor: "var(--card-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {hasMore && (
          <span
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              backgroundColor: "var(--warning-bg, rgba(255,149,0,0.12))",
              color: "var(--warning, #FF9500)",
            }}
          >
            mais que limit — aumente acima
          </span>
        )}
      </div>

      {error && (
        <div
          className="rounded-lg p-3 flex items-start gap-2 text-sm"
          style={{
            backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
            color: "var(--error, #FF3B30)",
            border: "1px solid var(--error, #FF3B30)",
          }}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div
          className="flex items-center gap-2 p-4"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          Carregando sessions…
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{
            backgroundColor: "var(--card)",
            border: "1px dashed var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Sem sessions com esses filtros.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <SessionRow
              key={s.key}
              session={s}
              onClick={() => setSelected(s)}
            />
          ))}
        </ul>
      )}

      {selected && (
        <SessionDrawer
          agentId={agentId}
          session={selected}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null);
            fetchList();
          }}
        />
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────

function SessionRow({
  session,
  onClick,
}: {
  session: SessionItem;
  onClick: () => void;
}) {
  return (
    <li
      onClick={onClick}
      className="rounded-lg p-3 cursor-pointer transition-all hover:scale-[1.01]"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <code
              className="text-xs font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {session.sessionId.slice(0, 8)}
            </code>
            {session.kind && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  color: "var(--text-secondary)",
                }}
              >
                {session.kind}
              </span>
            )}
            {session.channel && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: "var(--accent-soft, rgba(0,122,255,0.12))",
                  color: "var(--accent)",
                }}
              >
                {session.channel}
              </span>
            )}
            {session.aborted && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-1"
                style={{
                  backgroundColor: "var(--error-bg, rgba(255,59,48,0.12))",
                  color: "var(--error, #FF3B30)",
                }}
              >
                <AlertTriangle className="w-3 h-3" />
                ABORTED
              </span>
            )}
          </div>
          {(session.subject || session.displayName) && (
            <div
              className="text-xs truncate"
              style={{ color: "var(--text-secondary)" }}
              title={session.displayName ?? undefined}
            >
              {session.subject ?? session.displayName}
            </div>
          )}
          <div
            className="text-[11px] mt-1 flex gap-3 flex-wrap"
            style={{ color: "var(--text-muted)" }}
          >
            <span>{formatRelative(session.updatedAt)}</span>
            {session.model && (
              <span>
                <code>{session.model}</code>
              </span>
            )}
            {session.totalTokens > 0 && (
              <span>
                {session.totalTokens.toLocaleString()} tokens
              </span>
            )}
            {session.estimatedCostUsd > 0 && (
              <span>${session.estimatedCostUsd.toFixed(4)}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────

function SessionDrawer({
  agentId,
  session,
  onClose,
  onDeleted,
}: {
  agentId: string;
  session: SessionItem;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const linesPerPage = 200;

  const loadDetail = useCallback(async () => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const url = new URL(
        `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(session.sessionId)}`,
        window.location.origin,
      );
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("lines", String(linesPerPage));
      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setDetail(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDetail(false);
    }
  }, [agentId, session.sessionId, offset]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleDelete = async () => {
    if (
      !confirm(
        `Soft-delete session ${session.sessionId.slice(0, 8)}?\nA transcript fica como .deleted.<ts> e some do index.`,
      )
    )
      return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(session.sessionId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      onDeleted();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl p-5 overflow-y-auto"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Session {session.sessionId.slice(0, 8)}
            </h2>
            <div
              className="text-xs mt-1"
              style={{ color: "var(--text-muted)" }}
            >
              <code>{session.key}</code>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs disabled:opacity-40"
              style={{
                backgroundColor: "var(--card-elevated)",
                color: "var(--error, #FF3B30)",
                border: "1px solid var(--error, #FF3B30)",
              }}
            >
              {deleting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3" />
              )}
              Deletar
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-700"
              aria-label="Fechar"
            >
              <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <Stat label="Tokens" value={session.totalTokens.toLocaleString()} />
          <Stat
            label="Custo"
            value={
              session.estimatedCostUsd > 0
                ? `$${session.estimatedCostUsd.toFixed(4)}`
                : "—"
            }
          />
          <Stat label="Model" value={session.model ?? "—"} mono />
          <Stat label="Kind" value={session.kind ?? "—"} />
        </div>

        {/* Transcript */}
        {loadingDetail ? (
          <div
            className="flex items-center gap-2 p-4"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando transcript…
          </div>
        ) : detailError ? (
          <div
            className="rounded p-3 flex items-start gap-2 text-xs"
            style={{
              backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
              color: "var(--error, #FF3B30)",
            }}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{detailError}</span>
          </div>
        ) : detail ? (
          <div>
            <div
              className="text-xs mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              {detail.transcriptLines.toLocaleString()} linhas ·{" "}
              {(detail.transcriptBytes / 1024).toFixed(1)} KB · mostrando{" "}
              {offset + 1}–{offset + detail.lines.length}
              {detail.truncated && " (truncado)"}
            </div>
            <ul className="space-y-1 text-xs font-mono">
              {detail.lines.map((line) => {
                const isExpanded = expandedLine === line.lineNumber;
                const compact = compactLine(line);
                return (
                  <li
                    key={line.lineNumber}
                    className="rounded p-2 cursor-pointer"
                    style={{
                      backgroundColor: "var(--card-elevated)",
                      border: "1px solid var(--border)",
                    }}
                    onClick={() =>
                      setExpandedLine(isExpanded ? null : line.lineNumber)
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <code
                        className="text-[10px] shrink-0"
                        style={{ color: "var(--text-muted)" }}
                      >
                        L{line.lineNumber + 1}
                      </code>
                      <div className="flex-1 min-w-0">
                        <div className="truncate" style={{ color: "var(--text-primary)" }}>
                          {compact}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp
                          className="w-3 h-3 shrink-0"
                          style={{ color: "var(--text-muted)" }}
                        />
                      ) : (
                        <ChevronDown
                          className="w-3 h-3 shrink-0"
                          style={{ color: "var(--text-muted)" }}
                        />
                      )}
                    </div>
                    {isExpanded && (
                      <pre
                        className="text-[10px] mt-2 overflow-auto whitespace-pre-wrap break-all"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {line.raw ?? JSON.stringify(line.data, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Pagination */}
            {detail.transcriptLines > linesPerPage && (
              <div className="flex justify-center gap-2 mt-4">
                <button
                  onClick={() => setOffset(Math.max(0, offset - linesPerPage))}
                  disabled={offset === 0}
                  className="px-3 py-1 rounded text-xs disabled:opacity-30"
                  style={{
                    backgroundColor: "var(--card-elevated)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  ← anterior
                </button>
                <button
                  onClick={() => setOffset(offset + linesPerPage)}
                  disabled={!detail.truncated}
                  className="px-3 py-1 rounded text-xs disabled:opacity-30"
                  style={{
                    backgroundColor: "var(--card-elevated)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  próximo →
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      className="rounded p-2"
      style={{
        backgroundColor: "var(--card-elevated)",
        border: "1px solid var(--border)",
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className={`text-sm font-semibold mt-0.5 ${mono ? "font-mono" : ""}`}
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
      {label}:
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1 rounded text-xs"
        style={{
          backgroundColor: "var(--card-elevated)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
      >
        <option value="">todos</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatRelative(ts: number): string {
  if (!ts) return "—";
  const ms = Date.now() - ts;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days}d`;
  return new Date(ts).toLocaleDateString();
}

function compactLine(line: TranscriptLine): string {
  if (line.data && typeof line.data === "object") {
    const d = line.data as Record<string, unknown>;
    // Tenta extrair "role + first 80 chars do content" pra mensagens
    // típicas; ou "type" pros eventos.
    const role = typeof d.role === "string" ? d.role : null;
    const type = typeof d.type === "string" ? d.type : null;
    const content =
      typeof d.content === "string"
        ? d.content
        : typeof d.text === "string"
          ? d.text
          : null;
    const summary = content?.slice(0, 120) ?? "";
    const tag = role ?? type ?? "—";
    return `${tag}${summary ? ` · ${summary}` : ""}`;
  }
  return line.raw?.slice(0, 120) ?? "—";
}
