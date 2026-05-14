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

export default function SettingsPage() {
  const [systemData, setSystemData] = useState<SystemData | null>(null);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [plugins, setPlugins] = useState<PluginsResponse | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [tgModalOpen, setTgModalOpen] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waAccount, setWaAccount] = useState<string>("");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [sysRes, stRes, plRes] = await Promise.all([
        fetch("/api/system", { cache: "no-store" }),
        fetch("/api/openclaw/status", { cache: "no-store" }),
        fetch("/api/openclaw/plugins", { cache: "no-store" }),
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

  const telegramAccounts = status?.channelAccounts?.telegram ?? [];
  const whatsappAccounts = status?.channelAccounts?.whatsapp ?? [];

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
