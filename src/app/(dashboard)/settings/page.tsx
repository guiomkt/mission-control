"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  RefreshCw,
  Plus,
  Trash2,
  RefreshCcw,
  Key,
  Mail,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { SystemInfo } from "@/components/SystemInfo";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { AddTelegramAccountModal } from "@/components/AddTelegramAccountModal";
import { WhatsAppPairingModal } from "@/components/WhatsAppPairingModal";
import {
  ProviderKeyModal,
  type ProviderModalSpec,
} from "@/components/ProviderKeyModal";
import {
  OAuthProfilesTable,
  type OAuthProvider,
} from "@/components/OAuthProfilesTable";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// ── Tipos do /api/openclaw/status ────────────────────────────────────────
interface ChannelAccount {
  accountId: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
  reconnectAttempts?: number;
  lastError?: string | null;
  tokenStatus?: string;
  mode?: string;
}

interface ChannelState {
  configured?: boolean;
  running?: boolean;
  linked?: boolean;
  lastError?: string | null;
  healthState?: string;
  reconnectAttempts?: number;
}

interface OpenClawStatus {
  channels?: Record<string, ChannelState>;
  channelAccounts?: Record<string, ChannelAccount[]>;
}

interface SystemData {
  agent: { name: string; creature: string; emoji: string };
  system: {
    uptime: number;
    uptimeFormatted: string;
    nodeVersion: string;
    model: string;
    workspacePath: string;
    platform: string;
    hostname: string;
    memory: { total: number; free: number; used: number };
  };
  timestamp: string;
}

interface PluginsResponse {
  plugins: Array<{ id: string; enabled: boolean; installed: boolean }>;
}

interface ProviderEntry {
  id: string;
  label: string;
  envName: string;
  helpUrl?: string;
  status: "configured" | "legacy" | "missing";
  lastFour?: string;
  updatedAt?: string;
}

interface ProvidersResponse {
  providers: ProviderEntry[];
}

interface OAuthProfilesResponse {
  providers: OAuthProvider[];
  otherProfiles?: Array<{
    key: string;
    providerId: string;
    type: string;
    health: string;
    daysRemaining: number | null;
    expiresAt?: string;
  }>;
}

export default function SettingsPage() {
  const [systemData, setSystemData] = useState<SystemData | null>(null);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [plugins, setPlugins] = useState<PluginsResponse | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[] | null>(null);
  const [oauthProfiles, setOauthProfiles] = useState<OAuthProfilesResponse | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [tgModalOpen, setTgModalOpen] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waAccount, setWaAccount] = useState<string>("");
  const [providerModal, setProviderModal] = useState<ProviderModalSpec | null>(
    null,
  );
  const [providerBusy, setProviderBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [sysRes, stRes, plRes, prRes, oaRes] = await Promise.all([
        fetch("/api/system", { cache: "no-store" }),
        fetch("/api/openclaw/status", { cache: "no-store" }),
        fetch("/api/openclaw/plugins", { cache: "no-store" }),
        fetch("/api/openclaw/providers", { cache: "no-store" }),
        fetch("/api/openclaw/oauth/profiles", { cache: "no-store" }),
      ]);
      if (sysRes.ok) setSystemData(await sysRes.json());
      if (stRes.ok) {
        setStatus(await stRes.json());
      } else {
        const j = await stRes.json().catch(() => ({}));
        setError(
          `Não consegui ler o status do gateway: ${j.detail || j.error || stRes.status}`,
        );
      }
      if (plRes.ok) setPlugins(await plRes.json());
      if (prRes.ok) {
        const data = (await prRes.json()) as ProvidersResponse;
        setProviders(data.providers);
      }
      if (oaRes.ok) {
        const data = (await oaRes.json()) as OAuthProfilesResponse;
        setOauthProfiles(data);
      }
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Carrega o email do operador do Supabase Auth (client-side).
  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    sb.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  const handleRemove = async (
    kind: "telegram" | "whatsapp",
    account: string,
  ) => {
    if (
      !confirm(
        `Remover a conta '${account}' do ${kind}? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/openclaw/channels/${kind}/${encodeURIComponent(account)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || data.detail || "Falha ao remover");
        return;
      }
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReconnectWhatsApp = (account: string) => {
    setWaAccount(account);
    setWaModalOpen(true);
  };

  const handleProviderMigrate = async (id: string) => {
    setProviderBusy(id);
    try {
      const res = await fetch(`/api/openclaw/providers/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ migrate: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.detail || data.error || "Falha ao migrar chave");
        return;
      }
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(null);
    }
  };

  const handleProviderDelete = async (id: string, label: string) => {
    if (
      !confirm(
        `Remover a chave de ${label}? O container vai ser reiniciado (~5s downtime) sem essa env.`,
      )
    ) {
      return;
    }
    setProviderBusy(id);
    try {
      const res = await fetch(`/api/openclaw/providers/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.detail || data.error || "Falha ao remover chave");
        return;
      }
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setProviderBusy(null);
    }
  };

  const telegramAccounts = status?.channelAccounts?.telegram ?? [];
  const whatsappAccounts = status?.channelAccounts?.whatsapp ?? [];

  // OAuth profiles que merecem alerta no topo: expiring-urgent, expired,
  // ou cooldown ativo. Banner amarelo/vermelho conforme severidade.
  const urgentOAuth = (oauthProfiles?.providers ?? []).flatMap((p) =>
    p.profiles
      .filter((prof) =>
        ["expiring-urgent", "expired", "cooldown"].includes(prof.health),
      )
      .map((prof) => ({ provider: p, profile: prof })),
  );

  // Detecta canais quebrados pra mostrar banner no topo. Considera unhealthy
  // qualquer conta configurada que não está conectada (running && connected).
  const brokenChannels: Array<{ kind: "telegram" | "whatsapp"; account: string; lastError?: string | null }> =
    [
      ...telegramAccounts
        .filter((a) => !(a.running && (a.connected ?? a.running)))
        .map((a) => ({
          kind: "telegram" as const,
          account: a.accountId,
          lastError: a.lastError,
        })),
      ...whatsappAccounts
        .filter((a) => !(a.running && (a.connected ?? a.running)))
        .map((a) => ({
          kind: "whatsapp" as const,
          account: a.accountId,
          lastError: a.lastError,
        })),
    ];

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-7 h-7" style={{ color: "var(--accent)" }} />
          <div>
            <h1
              className="text-2xl md:text-3xl font-bold"
              style={{
                color: "var(--text-primary)",
                fontFamily: "var(--font-heading)",
              }}
            >
              Settings
            </h1>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {lastRefresh
                ? `Atualizado às ${lastRefresh.toLocaleTimeString()}`
                : "Carregando..."}
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--card-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-lg flex items-start gap-2 text-sm"
          style={{
            backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
            color: "var(--error, #FF3B30)",
            border: "1px solid var(--error, #FF3B30)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {urgentOAuth.length > 0 && (
        <div
          className="mb-4 px-4 py-3 rounded-lg flex items-start gap-3 text-sm"
          style={{
            backgroundColor: "var(--warning-bg, rgba(255,149,0,0.08))",
            color: "var(--warning, #FF9500)",
            border: "1px solid var(--warning, #FF9500)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold mb-1">
              {urgentOAuth.length === 1
                ? "1 conta de assinatura precisa de atenção"
                : `${urgentOAuth.length} contas de assinatura precisam de atenção`}
            </p>
            <ul className="space-y-1 text-xs opacity-90">
              {urgentOAuth.map(({ provider, profile }) => (
                <li key={`${provider.id}/${profile.key}`}>
                  <span className="font-mono">{provider.label}</span>
                  {" — "}
                  {profile.health === "expired"
                    ? "expirado"
                    : profile.health === "cooldown"
                      ? `cooldown (${profile.daysRemaining}d)`
                      : `expira em ${profile.daysRemaining}d`}
                  {" — veja seção “Contas conectadas” abaixo pro comando de reconect."}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {brokenChannels.length > 0 && (
        <div
          className="mb-4 px-4 py-3 rounded-lg flex items-start gap-3 text-sm"
          style={{
            backgroundColor: "var(--warning-bg, rgba(255,149,0,0.08))",
            color: "var(--warning, #FF9500)",
            border: "1px solid var(--warning, #FF9500)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold mb-1">
              {brokenChannels.length === 1
                ? "1 canal em loop de reconexão"
                : `${brokenChannels.length} canais em loop de reconexão`}
            </p>
            <ul className="space-y-1 text-xs opacity-90">
              {brokenChannels.map((c) => (
                <li key={`${c.kind}/${c.account}`}>
                  <span className="font-mono">{c.kind}/{c.account}</span>
                  {" — "}
                  <button
                    onClick={() => handleRemove(c.kind, c.account)}
                    className="underline"
                    style={{ color: "inherit" }}
                  >
                    Remover agora
                  </button>
                  {c.kind === "whatsapp" && (
                    <>
                      {" "}ou{" "}
                      <button
                        onClick={() => handleReconnectWhatsApp(c.account)}
                        className="underline"
                        style={{ color: "inherit" }}
                      >
                        Re-parear
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {systemData && <SystemInfo data={systemData} />}

      <Section title="Conta">
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <Mail className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
            <div className="flex-1">
              <p
                className="text-xs uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Email
              </p>
              <p
                className="font-mono text-sm"
                style={{ color: "var(--text-primary)" }}
              >
                {userEmail ?? "—"}
              </p>
            </div>
            <button
              onClick={() => setPwModalOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
              style={{
                backgroundColor: "var(--card-elevated)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            >
              <Key className="w-4 h-4" />
              Alterar senha
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Telegram"
        rightAction={
          <button
            onClick={() => setTgModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            <Plus className="w-4 h-4" />
            Adicionar
          </button>
        }
      >
        <ChannelTable
          accounts={telegramAccounts}
          channelState={status?.channels?.telegram}
          onRemove={(a) => handleRemove("telegram", a)}
        />
      </Section>

      <Section
        title="WhatsApp"
        rightAction={
          <button
            onClick={() => {
              setWaAccount("");
              setWaModalOpen(true);
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            <Plus className="w-4 h-4" />
            Conectar
          </button>
        }
      >
        <ChannelTable
          accounts={whatsappAccounts}
          channelState={status?.channels?.whatsapp}
          onRemove={(a) => handleRemove("whatsapp", a)}
          onReconnect={handleReconnectWhatsApp}
        />
      </Section>

      <Section title="Plugins habilitados">
        <div
          className="flex flex-wrap gap-2 rounded-xl p-5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          {plugins?.plugins
            .filter((p) => p.enabled)
            .map((p) => (
              <span
                key={p.id}
                className="px-3 py-1 rounded-full text-xs font-mono"
                style={{
                  backgroundColor: "var(--accent-soft, rgba(0,122,255,0.12))",
                  color: "var(--accent)",
                  border: "1px solid var(--accent)",
                }}
              >
                {p.id}
              </span>
            ))}
          {plugins && plugins.plugins.filter((p) => p.enabled).length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Nenhum plugin habilitado.
            </p>
          )}
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          Pra habilitar/desabilitar um plugin é necessário editar o{" "}
          <code>openclaw.json</code> via SSH e reiniciar o gateway.
        </p>
      </Section>

      <Section title="Contas conectadas (Assinatura / OAuth)">
        <OAuthProfilesTable
          providers={oauthProfiles?.providers ?? null}
          otherProfiles={oauthProfiles?.otherProfiles}
        />
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          Essas contas usam o login da assinatura (Claude Pro/Max, ChatGPT
          Plus, Gemini Advanced, Kimi/Moonshot Pro) em vez de cobrança por
          token. A reconexão hoje é via SSH — o fluxo direto no painel
          fica pra Phase 2 (o CLI da OpenClaw exige TTY).
        </p>
      </Section>

      <Section title="API Keys (pay-per-token)">
        <ProvidersTable
          providers={providers}
          busy={providerBusy}
          onConnect={(p) =>
            setProviderModal({
              id: p.id,
              label: p.label,
              envName: p.envName,
              helpUrl: p.helpUrl,
              currentLastFour: p.lastFour,
            })
          }
          onMigrate={(id) => handleProviderMigrate(id)}
          onDelete={(id, label) => handleProviderDelete(id, label)}
        />
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          Pra provedores que não suportam OAuth (DeepSeek, Perplexity) ou
          quando você prefere pagamento por token. Cada alteração reinicia o
          container <code>openclaw-kozw</code> (~5s downtime). Backup automático
          em <code>.env.bak.&lt;timestamp&gt;</code>.
        </p>
      </Section>

      <ChangePasswordModal
        isOpen={pwModalOpen}
        onClose={() => setPwModalOpen(false)}
        onSuccess={() => {
          setPwModalOpen(false);
          alert("Senha alterada com sucesso.");
        }}
      />
      <AddTelegramAccountModal
        isOpen={tgModalOpen}
        onClose={() => setTgModalOpen(false)}
        onSuccess={() => {
          setTgModalOpen(false);
          refresh();
        }}
      />
      <WhatsAppPairingModal
        isOpen={waModalOpen}
        initialAccount={waAccount}
        onClose={() => setWaModalOpen(false)}
        onSuccess={() => {
          setWaModalOpen(false);
          refresh();
        }}
      />
      <ProviderKeyModal
        isOpen={providerModal !== null}
        provider={providerModal}
        onClose={() => setProviderModal(null)}
        onSuccess={() => {
          setProviderModal(null);
          refresh();
        }}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function Section({
  title,
  rightAction,
  children,
}: {
  title: string;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-base font-semibold"
          style={{
            color: "var(--text-primary)",
            fontFamily: "var(--font-heading)",
          }}
        >
          {title}
        </h2>
        {rightAction}
      </div>
      {children}
    </div>
  );
}

function ChannelTable({
  accounts,
  channelState,
  onRemove,
  onReconnect,
}: {
  accounts: ChannelAccount[];
  channelState?: ChannelState;
  onRemove: (account: string) => void;
  onReconnect?: (account: string) => void;
}) {
  if (accounts.length === 0) {
    return (
      <div
        className="rounded-xl p-5 text-sm text-center"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
        }}
      >
        Nenhuma conta configurada.
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      {channelState?.lastError && (
        <div
          className="px-4 py-2 text-xs flex items-center gap-2"
          style={{
            backgroundColor: "var(--warning-bg, rgba(255,149,0,0.08))",
            color: "var(--warning, #FF9500)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span className="truncate">
            Channel state: {channelState.healthState || "degraded"}
          </span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            <th className="text-left px-4 py-2 text-xs uppercase">Conta</th>
            <th className="text-left px-4 py-2 text-xs uppercase">Status</th>
            <th className="text-left px-4 py-2 text-xs uppercase">Modo</th>
            <th className="text-right px-4 py-2 text-xs uppercase">Ações</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((acc) => {
            const healthy = acc.running && (acc.connected ?? acc.running);
            return (
              <tr
                key={acc.accountId}
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <td
                  className="px-4 py-3 font-mono text-sm"
                  style={{ color: "var(--text-primary)" }}
                >
                  {acc.accountId}
                </td>
                <td className="px-4 py-3">
                  {healthy ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs"
                      style={{ color: "var(--success, #34C759)" }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      conectado
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-xs"
                      style={{ color: "var(--error, #FF3B30)" }}
                      title={acc.lastError ?? undefined}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {acc.reconnectAttempts
                        ? `reconectando (${acc.reconnectAttempts})`
                        : "desconectado"}
                    </span>
                  )}
                </td>
                <td
                  className="px-4 py-3 text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  {acc.mode ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {onReconnect && !healthy && (
                      <button
                        onClick={() => onReconnect(acc.accountId)}
                        className="p-1.5 rounded"
                        style={{
                          backgroundColor: "var(--card-elevated)",
                          color: "var(--accent)",
                        }}
                        title="Reconectar"
                      >
                        <RefreshCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(acc.accountId)}
                      className="p-1.5 rounded"
                      style={{
                        backgroundColor: "var(--card-elevated)",
                        color: "var(--error, #FF3B30)",
                      }}
                      title="Remover"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProvidersTable({
  providers,
  busy,
  onConnect,
  onMigrate,
  onDelete,
}: {
  providers: ProviderEntry[] | null;
  busy: string | null;
  onConnect: (p: ProviderEntry) => void;
  onMigrate: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}) {
  if (providers === null) {
    return (
      <div
        className="rounded-xl p-5 text-sm text-center"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
        }}
      >
        Carregando…
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            <th className="text-left px-4 py-2 text-xs uppercase">Provedor</th>
            <th className="text-left px-4 py-2 text-xs uppercase">Status</th>
            <th className="text-left px-4 py-2 text-xs uppercase">Chave</th>
            <th className="text-right px-4 py-2 text-xs uppercase">Ações</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => {
            const isBusy = busy === p.id;
            return (
              <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td
                  className="px-4 py-3"
                  style={{ color: "var(--text-primary)" }}
                >
                  <div className="font-medium">{p.label}</div>
                  <div
                    className="text-xs font-mono"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {p.envName}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {p.status === "configured" && (
                    <span
                      className="inline-flex items-center gap-1 text-xs"
                      style={{ color: "var(--success, #34C759)" }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      gerenciado
                    </span>
                  )}
                  {p.status === "legacy" && (
                    <span
                      className="inline-flex items-center gap-1 text-xs"
                      style={{ color: "var(--warning, #FF9500)" }}
                      title="Existe no .env do container, mas não passou pelo painel"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      legado
                    </span>
                  )}
                  {p.status === "missing" && (
                    <span
                      className="inline-flex items-center gap-1 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      não configurado
                    </span>
                  )}
                </td>
                <td
                  className="px-4 py-3 text-xs font-mono"
                  style={{ color: "var(--text-muted)" }}
                >
                  {p.lastFour ? `…${p.lastFour}` : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {p.status === "legacy" && (
                      <button
                        onClick={() => onMigrate(p.id)}
                        disabled={isBusy}
                        className="px-2.5 py-1 rounded text-xs disabled:opacity-50"
                        style={{
                          backgroundColor: "var(--card-elevated)",
                          color: "var(--accent)",
                          border: "1px solid var(--border)",
                        }}
                        title="Importar a chave existente do .env pro painel"
                      >
                        Migrar
                      </button>
                    )}
                    <button
                      onClick={() => onConnect(p)}
                      disabled={isBusy}
                      className="px-2.5 py-1 rounded text-xs font-semibold disabled:opacity-50"
                      style={{
                        backgroundColor:
                          p.status === "missing" ? "var(--accent)" : "var(--card-elevated)",
                        color:
                          p.status === "missing" ? "white" : "var(--text-primary)",
                        border:
                          p.status === "missing"
                            ? "1px solid var(--accent)"
                            : "1px solid var(--border)",
                      }}
                    >
                      {p.status === "missing" ? "Conectar" : "Atualizar"}
                    </button>
                    {p.status === "configured" && (
                      <button
                        onClick={() => onDelete(p.id, p.label)}
                        disabled={isBusy}
                        className="p-1.5 rounded disabled:opacity-50"
                        style={{
                          backgroundColor: "var(--card-elevated)",
                          color: "var(--error, #FF3B30)",
                        }}
                        title="Remover chave"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
