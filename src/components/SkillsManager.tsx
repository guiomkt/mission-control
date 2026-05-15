"use client";

/**
 * Tab "Skills" do agent detail.
 *
 * Layout:
 *  - Tab "Instaladas": lista do `openclaw skills list`, mostra
 *    eligibility, missing requirements, e botão "Remover" pras
 *    instaladas via ClawHub (não pras bundled).
 *  - Tab "Marketplace": campo de busca no ClawHub + lista de hits
 *    com botão "Instalar" pra cada uma.
 *
 * Auto-refresh da lista após install/uninstall.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Search,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Wrench,
  ExternalLink,
  Package,
} from "lucide-react";

interface Skill {
  name: string;
  description: string;
  emoji?: string;
  eligible: boolean;
  disabled: boolean;
  modelVisible: boolean;
  userInvocable: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  missing?: {
    bins?: string[];
    env?: string[];
    config?: string[];
  };
}

interface SearchHit {
  slug: string;
  displayName: string;
  summary: string;
  version: string | null;
  updatedAt: number;
  ownerHandle: string;
  owner?: {
    handle: string;
    displayName: string;
    image?: string;
  };
}

interface Props {
  agentId: string;
}

export function SkillsManager({ agentId }: Props) {
  const [activeView, setActiveView] = useState<"installed" | "marketplace">(
    "installed",
  );

  // ── Installed list ───────────────────────────────────────────────────
  const [skills, setSkills] = useState<Skill[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/skills`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setSkills(data.skills ?? []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  // ── Marketplace search ──────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const url = `/api/agents/${encodeURIComponent(agentId)}/skills/search?q=${encodeURIComponent(query)}&limit=30`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      setHits(data.hits ?? []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  // ── Install ──────────────────────────────────────────────────────────
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<
    | { type: "ok" | "err"; text: string }
    | null
  >(null);

  const handleInstall = async (slug: string, force = false) => {
    setBusySlug(slug);
    setActionMsg(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/skills`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, force }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        // 409 → oferece force
        if (res.status === 409 && !force) {
          if (
            confirm(
              `${slug} já está instalada. Reinstalar (sobrescreve)?`,
            )
          ) {
            await handleInstall(slug, true);
            return;
          }
          setActionMsg({ type: "err", text: "Já instalada." });
          return;
        }
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setActionMsg({ type: "ok", text: `${slug} instalada.` });
      fetchSkills();
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusySlug(null);
    }
  };

  const handleUninstall = async (slug: string) => {
    if (!confirm(`Remover skill "${slug}" do agente ${agentId}?`)) return;
    setBusySlug(slug);
    setActionMsg(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(slug)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setActionMsg({
        type: "ok",
        text:
          data.status === "removed"
            ? `${slug} removida.`
            : `${slug} já não estava instalada.`,
      });
      fetchSkills();
    } catch (err) {
      setActionMsg({
        type: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusySlug(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div
        className="inline-flex rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--border)" }}
      >
        {(["installed", "marketplace"] as const).map((v) => {
          const active = activeView === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setActiveView(v)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium"
              style={{
                backgroundColor: active
                  ? "var(--accent-soft, rgba(0,122,255,0.12))"
                  : "var(--card)",
                color: active ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {v === "installed" ? (
                <>
                  <Wrench className="w-4 h-4" />
                  Instaladas ({skills.filter((s) => !s.bundled).length})
                </>
              ) : (
                <>
                  <Package className="w-4 h-4" />
                  Marketplace
                </>
              )}
            </button>
          );
        })}
      </div>

      {actionMsg && (
        <div
          className="flex items-start gap-2 text-xs px-3 py-2 rounded"
          style={{
            backgroundColor:
              actionMsg.type === "ok"
                ? "var(--success-bg, rgba(52,199,89,0.1))"
                : "var(--error-bg, rgba(255,59,48,0.1))",
            color:
              actionMsg.type === "ok"
                ? "var(--success, #34C759)"
                : "var(--error, #FF3B30)",
            whiteSpace: "pre-wrap",
          }}
        >
          {actionMsg.type === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {activeView === "installed" ? (
        <InstalledView
          skills={skills}
          loading={listLoading}
          error={listError}
          busySlug={busySlug}
          onUninstall={handleUninstall}
        />
      ) : (
        <MarketplaceView
          query={query}
          onQueryChange={setQuery}
          searching={searching}
          hits={hits}
          searchError={searchError}
          onSearch={handleSearch}
          installedSlugs={new Set(skills.map((s) => s.name))}
          busySlug={busySlug}
          onInstall={handleInstall}
        />
      )}
    </div>
  );
}

// ── Installed list ─────────────────────────────────────────────────────

function InstalledView({
  skills,
  loading,
  error,
  busySlug,
  onUninstall,
}: {
  skills: Skill[];
  loading: boolean;
  error: string | null;
  busySlug: string | null;
  onUninstall: (slug: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4" style={{ color: "var(--text-muted)" }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Carregando skills…
      </div>
    );
  }
  if (error) {
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
        <span>{error}</span>
      </div>
    );
  }

  // Separa instaladas via ClawHub (removíveis) vs bundled (não removíveis).
  const installed = skills.filter((s) => !s.bundled);
  const bundled = skills.filter((s) => s.bundled);

  return (
    <div className="space-y-4">
      <Section title={`Instaladas via ClawHub (${installed.length})`}>
        {installed.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Nenhuma skill instalada via marketplace. Aba "Marketplace" pra buscar.
          </p>
        ) : (
          <ul className="space-y-2">
            {installed.map((s) => (
              <SkillRow
                key={s.name}
                skill={s}
                removable
                busy={busySlug === s.name}
                onUninstall={onUninstall}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Bundled (${bundled.length})`} muted>
        {bundled.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>—</p>
        ) : (
          <ul className="space-y-2">
            {bundled.map((s) => (
              <SkillRow key={s.name} skill={s} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function SkillRow({
  skill,
  removable,
  busy,
  onUninstall,
}: {
  skill: Skill;
  removable?: boolean;
  busy?: boolean;
  onUninstall?: (slug: string) => void;
}) {
  const blockedReason = !skill.eligible
    ? skill.missing?.bins?.length
      ? `binários faltando: ${skill.missing.bins.join(", ")}`
      : skill.missing?.env?.length
        ? `env faltando: ${skill.missing.env.join(", ")}`
        : skill.disabled
          ? "disabled"
          : "ineligible"
    : null;

  return (
    <li
      className="flex items-start justify-between gap-3 p-3 rounded-lg"
      style={{
        backgroundColor: "var(--card-elevated)",
        border: "1px solid var(--border)",
        opacity: skill.eligible ? 1 : 0.7,
      }}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span className="text-lg shrink-0">{skill.emoji ?? "🔧"}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code
              className="text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {skill.name}
            </code>
            {skill.eligible ? (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: "var(--success-bg, rgba(52,199,89,0.15))",
                  color: "var(--success, #34C759)",
                }}
              >
                ATIVA
              </span>
            ) : (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: "var(--warning-bg, rgba(255,149,0,0.15))",
                  color: "var(--warning, #FF9500)",
                }}
                title={blockedReason ?? ""}
              >
                BLOQUEADA
              </span>
            )}
          </div>
          <p
            className="text-xs mt-1 line-clamp-2"
            style={{ color: "var(--text-secondary)" }}
          >
            {skill.description}
          </p>
          {blockedReason && (
            <p
              className="text-[10px] mt-1"
              style={{ color: "var(--warning, #FF9500)" }}
            >
              ⚠️ {blockedReason}
            </p>
          )}
          {skill.homepage && (
            <a
              href={skill.homepage}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] inline-flex items-center gap-1 mt-1"
              style={{ color: "var(--text-muted)" }}
            >
              <ExternalLink className="w-3 h-3" />
              homepage
            </a>
          )}
        </div>
      </div>
      {removable && onUninstall && (
        <button
          type="button"
          onClick={() => onUninstall(skill.name)}
          disabled={busy}
          className="p-1 rounded hover:bg-red-500/20 disabled:opacity-30 shrink-0"
          title="Remover skill"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2
              className="w-4 h-4"
              style={{ color: "var(--error, #FF3B30)" }}
            />
          )}
        </button>
      )}
    </li>
  );
}

// ── Marketplace ────────────────────────────────────────────────────────

function MarketplaceView({
  query,
  onQueryChange,
  searching,
  hits,
  searchError,
  onSearch,
  installedSlugs,
  busySlug,
  onInstall,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  searching: boolean;
  hits: SearchHit[];
  searchError: string | null;
  onSearch: (e: React.FormEvent) => void;
  installedSlugs: Set<string>;
  busySlug: string | null;
  onInstall: (slug: string) => void;
}) {
  return (
    <div className="space-y-3">
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar skills no ClawHub (ex: whatsapp, supabase, browser)…"
          className="flex-1 px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--card-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <button
          type="submit"
          disabled={searching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
          style={{ backgroundColor: "var(--accent)", color: "white" }}
        >
          {searching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          Buscar
        </button>
      </form>

      {searchError && (
        <div
          className="rounded-lg p-3 flex items-start gap-2 text-sm"
          style={{
            backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
            color: "var(--error, #FF3B30)",
            border: "1px solid var(--error, #FF3B30)",
          }}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{searchError}</span>
        </div>
      )}

      {hits.length === 0 && !searching && (
        <p className="text-xs p-4 text-center" style={{ color: "var(--text-muted)" }}>
          {query
            ? "Nenhum resultado. Tenta outro termo."
            : "Digite acima e procure no ClawHub."}
        </p>
      )}

      {hits.length > 0 && (
        <ul className="space-y-2">
          {hits.map((h) => {
            const already = installedSlugs.has(h.slug);
            const busy = busySlug === h.slug;
            return (
              <li
                key={h.slug}
                className="flex items-start justify-between gap-3 p-3 rounded-lg"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code
                      className="text-sm font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {h.slug}
                    </code>
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {h.displayName}
                    </span>
                    {h.version && (
                      <span
                        className="text-[10px] font-mono"
                        style={{ color: "var(--text-muted)" }}
                      >
                        v{h.version}
                      </span>
                    )}
                    {already && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                        style={{
                          backgroundColor: "var(--accent-soft, rgba(0,122,255,0.12))",
                          color: "var(--accent)",
                        }}
                      >
                        INSTALADA
                      </span>
                    )}
                  </div>
                  <p
                    className="text-xs mt-1 line-clamp-2"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {h.summary}
                  </p>
                  {h.owner && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                      por {h.owner.displayName} (@{h.ownerHandle})
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onInstall(h.slug)}
                  disabled={busy}
                  className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40 shrink-0"
                  style={{
                    backgroundColor: already
                      ? "var(--card)"
                      : "var(--accent)",
                    color: already ? "var(--text-secondary)" : "white",
                    border: already ? "1px solid var(--border)" : "none",
                  }}
                  title={
                    already
                      ? "Clique pra reinstalar (--force)"
                      : "Instalar nesse agente"
                  }
                >
                  {busy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  {already ? "Reinstalar" : "Instalar"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Section helper ────────────────────────────────────────────────────

function Section({
  title,
  muted,
  children,
}: {
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        opacity: muted ? 0.85 : 1,
      }}
    >
      <h3
        className="text-xs uppercase tracking-wider mb-3"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}
