"use client";

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
} from "lucide-react";

export interface ModelCostStatus {
  defaultModel: string | null;
  defaultCostClass: "oauth" | "paid" | "unknown";
  fallbacks: Array<{ model: string; costClass: "oauth" | "paid" | "unknown" }>;
  aliasesPointingToPaid: Array<{ name: string; target: string }>;
  severity: "ok" | "warn" | "alert";
  checkedAt: string;
}

interface Props {
  data: ModelCostStatus | null;
}

const COST_COLOR: Record<string, string> = {
  oauth: "var(--success, #34C759)",
  paid: "var(--error, #FF3B30)",
  unknown: "var(--text-muted)",
};

const COST_LABEL: Record<string, string> = {
  oauth: "OAuth (assinatura)",
  paid: "API PAGA",
  unknown: "desconhecido",
};

export function ModelCostBanner({ data }: Props) {
  if (!data) {
    return (
      <div
        className="rounded-xl p-4 flex items-center gap-2 text-sm"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
        }}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        Verificando classe de custo do modelo do agente…
      </div>
    );
  }

  const isAlert = data.severity === "alert";
  const isWarn = data.severity === "warn";

  const borderColor = isAlert
    ? "var(--error, #FF3B30)"
    : isWarn
      ? "var(--warning, #FF9500)"
      : "var(--border)";
  const bgColor = isAlert
    ? "var(--error-bg, rgba(255,59,48,0.05))"
    : isWarn
      ? "var(--warning-bg, rgba(255,149,0,0.05))"
      : "var(--card)";

  return (
    <div
      className="rounded-xl p-4"
      style={{
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
      }}
    >
      {/* Headline */}
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 mt-0.5"
          style={{
            color: isAlert
              ? "var(--error, #FF3B30)"
              : isWarn
                ? "var(--warning, #FF9500)"
                : "var(--success, #34C759)",
          }}
        >
          {isAlert ? (
            <XCircle className="w-5 h-5" />
          ) : isWarn ? (
            <AlertTriangle className="w-5 h-5" />
          ) : (
            <CheckCircle2 className="w-5 h-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="font-semibold text-sm mb-1"
            style={{
              color: isAlert
                ? "var(--error, #FF3B30)"
                : "var(--text-primary)",
            }}
          >
            {isAlert
              ? "🚨 Modelo padrão do agente é PAGO"
              : isWarn
                ? "⚠️ Há rotas pagas configuradas no agente"
                : "✅ Agente roda 100% em modelos de assinatura (OAuth)"}
          </p>

          {/* Default */}
          <div className="text-xs space-y-1">
            <div className="flex items-baseline gap-2">
              <span style={{ color: "var(--text-muted)" }}>Modelo padrão:</span>
              <code style={{ color: "var(--text-primary)" }}>
                {data.defaultModel ?? "—"}
              </code>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  color: COST_COLOR[data.defaultCostClass],
                  border: `1px solid ${COST_COLOR[data.defaultCostClass]}`,
                }}
              >
                {COST_LABEL[data.defaultCostClass]}
              </span>
            </div>

            {/* Fallbacks */}
            {data.fallbacks.length > 0 && (
              <div>
                <span style={{ color: "var(--text-muted)" }}>Fallbacks:</span>{" "}
                {data.fallbacks.map((f, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <code style={{ color: "var(--text-primary)" }}>
                      {f.model}
                    </code>{" "}
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                      style={{
                        backgroundColor: "var(--card-elevated)",
                        color: COST_COLOR[f.costClass],
                        border: `1px solid ${COST_COLOR[f.costClass]}`,
                      }}
                    >
                      {COST_LABEL[f.costClass]}
                    </span>
                  </span>
                ))}
              </div>
            )}

            {/* Aliases warning */}
            {data.aliasesPointingToPaid.length > 0 && (
              <details className="mt-2">
                <summary
                  className="cursor-pointer"
                  style={{ color: "var(--warning, #FF9500)" }}
                >
                  {data.aliasesPointingToPaid.length} alias(es) apontam pra modelos pagos
                </summary>
                <ul className="ml-3 mt-1 space-y-0.5" style={{ color: "var(--text-muted)" }}>
                  {data.aliasesPointingToPaid.map((a, i) => (
                    <li key={i} className="font-mono">
                      <code>{a.name}</code> → <code>{a.target}</code>
                    </li>
                  ))}
                </ul>
                <p
                  className="ml-3 mt-1 text-[10px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Esses aliases só geram custo se forem invocados explicitamente
                  (por skill ou prompt). O agente NÃO usa esses caminhos pra
                  resolução automática enquanto o default e fallback estiverem
                  em OAuth.
                </p>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
