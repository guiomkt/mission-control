"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Bot,
  ArrowLeft,
  Edit3,
  Trash2,
  AlertTriangle,
  Loader2,
  Lock,
  Circle,
  HardDrive,
  Users,
  Calendar,
  Wrench,
  MessageSquare,
  History,
  BarChart3,
} from "lucide-react";
import { EditAgentIdentityModal } from "@/components/EditAgentIdentityModal";
import { DeleteAgentDialog } from "@/components/DeleteAgentDialog";

interface AgentDetail {
  id: string;
  name: string;
  identity: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
    color?: string;
  };
  workspace: string;
  model: string | null;
  fallbacks: string[];
  allowAgents: string[];
  heartbeat: Record<string, unknown> | null;
  bindings: Array<{ channel: string | null; accountId: string | null }>;
  referencedBy: Array<{ id: string; name: string }>;
  activeSessions: number;
  isMain: boolean;
}

type TabKey =
  | "identity"
  | "prompt"
  | "model"
  | "subagents"
  | "bindings"
  | "skills"
  | "sessions"
  | "analytics";

const TABS: Array<{ key: TabKey; label: string; icon: React.ElementType; phase: number }> = [
  { key: "identity", label: "Identidade", icon: Bot, phase: 1 },
  { key: "prompt", label: "Prompt", icon: Edit3, phase: 3 },
  { key: "model", label: "Modelo", icon: Wrench, phase: 2 },
  { key: "subagents", label: "Subagents", icon: Users, phase: 2 },
  { key: "bindings", label: "Bindings", icon: MessageSquare, phase: 2 },
  { key: "skills", label: "Skills", icon: Wrench, phase: 4 },
  { key: "sessions", label: "Sessions", icon: History, phase: 5 },
  { key: "analytics", label: "Analytics", icon: BarChart3, phase: 5 },
];

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("identity");

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fetchAgent = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setAgent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  if (loading) {
    return (
      <div className="p-8">
        <div
          className="flex items-center justify-center min-h-[400px] gap-2"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando agente…
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="p-8">
        <button
          onClick={() => router.push("/agents")}
          className="flex items-center gap-2 mb-4 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <div
          className="rounded-xl p-4 flex items-start gap-2 text-sm"
          style={{
            backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
            color: "var(--error, #FF3B30)",
            border: "1px solid var(--error, #FF3B30)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error ?? "Agente não encontrado"}</span>
        </div>
      </div>
    );
  }

  const displayEmoji = agent.identity.emoji ?? "🤖";
  const displayColor = agent.identity.theme ?? agent.identity.color ?? "#666";

  return (
    <div className="p-4 md:p-8">
      {/* Back link */}
      <button
        onClick={() => router.push("/agents")}
        className="flex items-center gap-2 mb-4 text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        <ArrowLeft className="w-4 h-4" /> Agents
      </button>

      {/* Header */}
      <div
        className="rounded-xl p-5 mb-6 flex items-center justify-between gap-4"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          background: `linear-gradient(135deg, ${displayColor}15, transparent)`,
        }}
      >
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl"
            style={{
              backgroundColor: `${displayColor}20`,
              border: `2px solid ${displayColor}`,
            }}
          >
            {displayEmoji}
          </div>
          <div>
            <h1
              className="text-2xl font-bold"
              style={{
                fontFamily: "var(--font-heading)",
                color: "var(--text-primary)",
              }}
            >
              {agent.name}
            </h1>
            <div
              className="flex items-center gap-2 mt-1 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              <code style={{ color: "var(--text-secondary)" }}>{agent.id}</code>
              {agent.isMain && (
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1"
                  style={{
                    backgroundColor: "var(--accent-soft, rgba(0,122,255,0.12))",
                    color: "var(--accent)",
                  }}
                >
                  <Lock className="w-3 h-3" />
                  default
                </span>
              )}
              {agent.activeSessions > 0 && (
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-semibold"
                  style={{
                    backgroundColor: "var(--success-bg, rgba(52,199,89,0.15))",
                    color: "var(--success, #34C759)",
                  }}
                >
                  <Circle className="inline w-2 h-2 mr-1 fill-current" />
                  {agent.activeSessions} session{agent.activeSessions === 1 ? "" : "es"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          >
            <Edit3 className="w-4 h-4" />
            Editar identidade
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            disabled={agent.isMain}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--error, #FF3B30)",
              color: "var(--error, #FF3B30)",
            }}
            title={
              agent.isMain
                ? "O agente padrão não pode ser deletado"
                : "Deletar agente"
            }
          >
            <Trash2 className="w-4 h-4" />
            Deletar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-6 border-b overflow-x-auto"
        style={{ borderColor: "var(--border)" }}
      >
        {TABS.map(({ key, label, icon: Icon, phase }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className="flex items-center gap-2 px-4 py-2 font-medium transition-all whitespace-nowrap"
            style={{
              color: activeTab === key ? "var(--accent)" : "var(--text-secondary)",
              borderBottomStyle: "solid",
              borderBottomWidth: "2px",
              borderBottomColor:
                activeTab === key ? "var(--accent)" : "transparent",
              background: "none",
              border: "none",
              cursor: "pointer",
              paddingBottom: "0.5rem",
            }}
          >
            <Icon className="w-4 h-4" />
            {label}
            {phase > 1 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded ml-1"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  color: "var(--text-muted)",
                }}
              >
                F{phase}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "identity" && <IdentityTab agent={agent} />}
      {activeTab !== "identity" && (
        <Placeholder phase={TABS.find((t) => t.key === activeTab)?.phase ?? 0} />
      )}

      {/* Modais */}
      <EditAgentIdentityModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={() => {
          setEditOpen(false);
          fetchAgent();
        }}
        agent={{
          id: agent.id,
          name: agent.identity.name ?? agent.name,
          emoji: agent.identity.emoji,
          theme: agent.identity.theme ?? agent.identity.color,
          avatar: agent.identity.avatar,
        }}
      />
      <DeleteAgentDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onSuccess={() => {
          setDeleteOpen(false);
          router.push("/agents");
        }}
        agent={{
          id: agent.id,
          name: agent.name,
          activeSessions: agent.activeSessions,
          workspace: agent.workspace,
          referencedBy: agent.referencedBy,
        }}
      />
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────

function IdentityTab({ agent }: { agent: AgentDetail }) {
  return (
    <div className="space-y-4 max-w-2xl">
      <Section title="Identidade">
        <InfoRow label="Nome">{agent.identity.name ?? agent.name}</InfoRow>
        <InfoRow label="ID">
          <code>{agent.id}</code>
        </InfoRow>
        <InfoRow label="Emoji">
          <span className="text-2xl">{agent.identity.emoji ?? "—"}</span>
        </InfoRow>
        <InfoRow label="Tema">
          {agent.identity.theme || agent.identity.color ? (
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-4 rounded-full"
                style={{
                  backgroundColor: agent.identity.theme ?? agent.identity.color,
                }}
              />
              <code className="text-xs">
                {agent.identity.theme ?? agent.identity.color}
              </code>
            </div>
          ) : (
            "—"
          )}
        </InfoRow>
        <InfoRow label="Avatar">
          {agent.identity.avatar ? (
            <code className="text-xs">{agent.identity.avatar}</code>
          ) : (
            "—"
          )}
        </InfoRow>
      </Section>

      <Section title="Configuração runtime">
        <InfoRow label="Modelo">
          <code className="text-xs">{agent.model ?? "—"}</code>
        </InfoRow>
        {agent.fallbacks.length > 0 && (
          <InfoRow label="Fallbacks">
            <div className="space-y-1">
              {agent.fallbacks.map((f) => (
                <code key={f} className="block text-xs">
                  {f}
                </code>
              ))}
            </div>
          </InfoRow>
        )}
        <InfoRow label="Workspace">
          <code className="text-xs">{agent.workspace}</code>
        </InfoRow>
      </Section>

      {(agent.bindings.length > 0 ||
        agent.allowAgents.length > 0 ||
        agent.referencedBy.length > 0) && (
        <Section title="Conexões (read-only nesta fase)">
          {agent.bindings.length > 0 && (
            <InfoRow label="Canais">
              <div className="flex flex-wrap gap-1">
                {agent.bindings.map((b, i) => (
                  <span
                    key={i}
                    className="text-xs px-2 py-1 rounded font-mono"
                    style={{
                      backgroundColor: "var(--card-elevated)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {b.channel}
                    {b.accountId ? `:${b.accountId}` : ""}
                  </span>
                ))}
              </div>
            </InfoRow>
          )}
          {agent.allowAgents.length > 0 && (
            <InfoRow label="Pode invocar">
              <div className="flex flex-wrap gap-1">
                {agent.allowAgents.map((sub) => (
                  <span
                    key={sub}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      backgroundColor: "var(--accent-soft, rgba(0,122,255,0.12))",
                      color: "var(--accent)",
                    }}
                  >
                    {sub}
                  </span>
                ))}
              </div>
            </InfoRow>
          )}
          {agent.referencedBy.length > 0 && (
            <InfoRow label="Subagent de">
              <div className="flex flex-wrap gap-1">
                {agent.referencedBy.map((r) => (
                  <span
                    key={r.id}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      backgroundColor: "var(--warning-bg, rgba(255,149,0,0.12))",
                      color: "var(--warning, #FF9500)",
                    }}
                  >
                    {r.name}
                  </span>
                ))}
              </div>
            </InfoRow>
          )}
        </Section>
      )}
    </div>
  );
}

function Placeholder({ phase }: { phase: number }) {
  return (
    <div
      className="rounded-xl p-8 text-center"
      style={{
        backgroundColor: "var(--card)",
        border: "1px dashed var(--border)",
      }}
    >
      <Calendar
        className="w-8 h-8 mx-auto mb-2 opacity-40"
        style={{ color: "var(--text-muted)" }}
      />
      <p
        className="text-sm font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        Em breve — Fase {phase}
      </p>
      <p
        className="text-xs mt-1"
        style={{ color: "var(--text-muted)" }}
      >
        Esta tab chega na próxima fase do roadmap. Por enquanto, edite
        via SSH se precisar urgente.
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <h3
        className="text-sm font-semibold mb-3 flex items-center gap-2"
        style={{
          color: "var(--text-primary)",
          fontFamily: "var(--font-heading)",
        }}
      >
        <HardDrive className="w-4 h-4" />
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        className="text-xs uppercase tracking-wider w-28 shrink-0"
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
