"use client";

import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Copy,
  Check,
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";

export interface OAuthProfile {
  key: string;
  label?: string;
  type: "oauth" | "token" | "api_key" | "other";
  expiresAt?: string;
  cooldownUntil?: string;
  health: "active" | "expiring-soon" | "expiring-urgent" | "expired" | "cooldown" | "no-expiry";
  daysRemaining: number | null;
  statusDetail?: string;
}

export interface OAuthProvider {
  id: string;
  label: string;
  brand: string;
  reconnectMethod: string;
  profiles: OAuthProfile[];
}

interface OAuthProfilesTableProps {
  providers: OAuthProvider[] | null;
  /** Profiles fora do catálogo (providers desconhecidos no painel). */
  otherProfiles?: Array<{
    key: string;
    providerId: string;
    type: string;
    health: string;
    daysRemaining: number | null;
    expiresAt?: string;
  }>;
}

export function OAuthProfilesTable({
  providers,
  otherProfiles,
}: OAuthProfilesTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

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
            <th className="text-left px-4 py-2 text-xs uppercase">Profile</th>
            <th className="text-right px-4 py-2 text-xs uppercase">Ações</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((prov) => (
            <ProviderRows
              key={prov.id}
              provider={prov}
              expanded={expanded === prov.id}
              onToggle={() => setExpanded(expanded === prov.id ? null : prov.id)}
            />
          ))}
          {otherProfiles && otherProfiles.length > 0 && (
            <tr style={{ borderTop: "1px solid var(--border)" }}>
              <td
                colSpan={4}
                className="px-4 py-2 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                <details>
                  <summary className="cursor-pointer">
                    Outros profiles ({otherProfiles.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {otherProfiles.map((p) => (
                      <li key={p.key} className="font-mono">
                        {p.key} — {p.type}
                        {p.expiresAt && ` — expira ${p.expiresAt.slice(0, 10)}`}
                      </li>
                    ))}
                  </ul>
                </details>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Linha por provider ───────────────────────────────────────────────────

function ProviderRows({
  provider,
  expanded,
  onToggle,
}: {
  provider: OAuthProvider;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasProfile = provider.profiles.length > 0;
  // Pegamos o "melhor" profile pra display principal: o mais ativo, ou,
  // se nenhum ativo, o que expira mais longe no futuro.
  const primary = pickPrimary(provider.profiles);

  return (
    <>
      <tr style={{ borderTop: "1px solid var(--border)" }}>
        <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>
          <div className="font-medium">{provider.label}</div>
          <div
            className="text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {provider.brand}
          </div>
        </td>
        <td className="px-4 py-3">
          {hasProfile && primary ? (
            <HealthBadge profile={primary} />
          ) : (
            <span
              className="inline-flex items-center gap-1 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              <XCircle className="w-3.5 h-3.5" />
              não conectado
            </span>
          )}
        </td>
        <td
          className="px-4 py-3 text-xs font-mono"
          style={{ color: "var(--text-muted)" }}
        >
          {hasProfile && primary ? (
            <>
              {primary.label ?? primary.key}
              {provider.profiles.length > 1 && (
                <span
                  className="ml-2 px-1.5 py-0.5 rounded text-[10px]"
                  style={{
                    backgroundColor: "var(--card-elevated)",
                    color: "var(--text-muted)",
                  }}
                  title={`Mais ${provider.profiles.length - 1} profile(s)`}
                >
                  +{provider.profiles.length - 1}
                </span>
              )}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onToggle}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs"
              style={{
                backgroundColor: hasProfile
                  ? "var(--card-elevated)"
                  : "var(--accent)",
                color: hasProfile ? "var(--text-primary)" : "white",
                border: hasProfile ? "1px solid var(--border)" : "none",
              }}
            >
              <Terminal className="w-3 h-3" />
              {hasProfile ? "Como reconectar" : "Como conectar"}
              {expanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderTop: "1px dashed var(--border)" }}>
          <td colSpan={4} className="px-4 py-3" style={{ backgroundColor: "var(--card-elevated)" }}>
            <ReconnectHelp
              provider={provider}
              extraProfiles={provider.profiles.slice(1)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Badge de saúde do profile ────────────────────────────────────────────

function HealthBadge({ profile }: { profile: OAuthProfile }) {
  if (profile.health === "active") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: "var(--success, #34C759)" }}
        title={profile.expiresAt ? `Expira ${profile.expiresAt}` : undefined}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        ativo
        {profile.daysRemaining != null && (
          <span style={{ color: "var(--text-muted)" }}>
            {" "}
            ({profile.daysRemaining}d)
          </span>
        )}
      </span>
    );
  }
  if (profile.health === "no-expiry") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: "var(--success, #34C759)" }}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        ativo (token)
      </span>
    );
  }
  if (profile.health === "expiring-soon") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: "var(--warning, #FF9500)" }}
      >
        <Clock className="w-3.5 h-3.5" />
        expira em {profile.daysRemaining}d
      </span>
    );
  }
  if (profile.health === "expiring-urgent") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs font-semibold"
        style={{ color: "var(--warning, #FF9500)" }}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        expira em {profile.daysRemaining}d!
      </span>
    );
  }
  if (profile.health === "expired") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: "var(--error, #FF3B30)" }}
      >
        <XCircle className="w-3.5 h-3.5" />
        expirado
      </span>
    );
  }
  if (profile.health === "cooldown") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: "var(--error, #FF3B30)" }}
        title={profile.cooldownUntil ? `Cooldown até ${profile.cooldownUntil}` : undefined}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        em cooldown ({profile.daysRemaining}d)
      </span>
    );
  }
  return null;
}

// ── Help expandível ──────────────────────────────────────────────────────

function ReconnectHelp({
  provider,
  extraProfiles,
}: {
  provider: OAuthProvider;
  extraProfiles?: OAuthProfile[];
}) {
  const [copied, setCopied] = useState(false);
  const command = `ssh hostinger 'docker exec -it openclaw-kozw-openclaw-1 openclaw models auth login --provider ${provider.id} --method ${provider.reconnectMethod}'`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-3 text-xs" style={{ color: "var(--text-secondary)" }}>
      <p style={{ color: "var(--text-primary)", lineHeight: 1.5 }}>
        Pra (re)conectar <strong>{provider.label}</strong> rode o comando abaixo
        num terminal local com SSH configurado pro VPS:
      </p>
      <div
        className="rounded-md p-3 font-mono text-[11px] flex items-start justify-between gap-3"
        style={{
          backgroundColor: "#0d1117",
          color: "#c9d1d9",
          border: "1px solid #30363d",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        <code>{command}</code>
        <button
          onClick={copy}
          className="flex items-center gap-1 px-2 py-1 rounded shrink-0"
          style={{
            backgroundColor: copied ? "var(--success-bg, rgba(52,199,89,0.15))" : "var(--card)",
            color: copied ? "var(--success, #34C759)" : "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
          title="Copiar comando"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copiar
            </>
          )}
        </button>
      </div>
      <ol
        className="list-decimal pl-5 space-y-1"
        style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}
      >
        <li>Cole o comando no seu terminal e dê Enter.</li>
        <li>
          O CLI vai mostrar uma URL — abra no navegador, autentique na conta{" "}
          {provider.brand}.
        </li>
        <li>
          Se o navegador mostrar erro de conexão depois do login (
          <code>localhost:8085</code> não responde), copie a URL inteira da
          barra de endereços e cole de volta no terminal.
        </li>
        <li>
          Quando o terminal disser <code>successfully authenticated</code>, esta
          página vai atualizar automaticamente (~15s).
        </li>
      </ol>

      {extraProfiles && extraProfiles.length > 0 && (
        <details
          className="mt-3 pt-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <summary className="cursor-pointer">
            Outros profiles deste provider ({extraProfiles.length})
          </summary>
          <ul className="mt-2 space-y-1 font-mono">
            {extraProfiles.map((p) => (
              <li key={p.key}>
                <code>{p.key}</code> — {p.statusDetail ?? p.type}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p
        className="pt-2 text-[11px]"
        style={{
          borderTop: "1px solid var(--border)",
          color: "var(--text-muted)",
        }}
      >
        <ExternalLink className="w-3 h-3 inline mr-1" />
        Phase 2 fica a possibilidade de rodar esse fluxo direto no painel — hoje
        o CLI exige TTY interativo, então fica via SSH.
      </p>
    </div>
  );
}

function pickPrimary(profiles: OAuthProfile[]): OAuthProfile | undefined {
  if (profiles.length === 0) return undefined;
  // Ranking: active > expiring-soon > expiring-urgent > no-expiry > cooldown > expired
  const order: Record<OAuthProfile["health"], number> = {
    active: 0,
    "no-expiry": 1,
    "expiring-soon": 2,
    "expiring-urgent": 3,
    cooldown: 4,
    expired: 5,
  };
  return [...profiles].sort((a, b) => order[a.health] - order[b.health])[0];
}
