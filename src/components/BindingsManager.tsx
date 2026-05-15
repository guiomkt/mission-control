"use client";

/**
 * Tab "Bindings" do agent detail.
 *
 * Mostra a lista atual de bindings (canal:conta) que rota mensagens
 * pra este agente e permite adicionar/remover.
 *
 * Channels + accounts são providos pelo endpoint pai (/api/agents/[id])
 * — não fazemos request adicional aqui pra evitar stampede.
 */
import { useState } from "react";
import { Loader2, Plus, Trash2, AlertCircle, MessageSquare } from "lucide-react";

interface Binding {
  channel: string | null;
  accountId: string | null;
}

interface ChannelOption {
  name: string;
  accounts: string[];
}

interface Props {
  agentId: string;
  bindings: Binding[];
  availableChannels: ChannelOption[];
  onChange: () => void;
}

export function BindingsManager({
  agentId,
  bindings,
  availableChannels,
  onChange,
}: Props) {
  const [channel, setChannel] = useState<string>(
    availableChannels[0]?.name ?? "",
  );
  const [accountId, setAccountId] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // Mostra só accounts do canal selecionado, excluindo as que já estão
  // bound a este agente (evita duplicação).
  const selectedChannel = availableChannels.find((c) => c.name === channel);
  const accountOptions = (selectedChannel?.accounts ?? []).filter(
    (acc) =>
      !bindings.some((b) => b.channel === channel && b.accountId === acc),
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel || !accountId) {
      setError("Selecione canal e conta.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/bindings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, accountId }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setAccountId("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (b: Binding) => {
    if (!b.channel || !b.accountId) return;
    const key = `${b.channel}:${b.accountId}`;
    if (
      !confirm(
        `Remover binding ${key} de ${agentId}?\nMensagens pra ${key} não chegarão mais nesse agente.`,
      )
    )
      return;
    setRemoving(key);
    setError(null);
    try {
      const url = new URL(
        `/api/agents/${encodeURIComponent(agentId)}/bindings`,
        window.location.origin,
      );
      url.searchParams.set("channel", b.channel);
      url.searchParams.set("accountId", b.accountId);
      const res = await fetch(url.toString(), { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-sm font-semibold mb-3 flex items-center gap-2"
          style={{ color: "var(--text-primary)" }}
        >
          <MessageSquare className="w-4 h-4" />
          Bindings ({bindings.length})
        </h3>
        <p
          className="text-xs mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          Mensagens recebidas em <code>canal:conta</code> serão roteadas pra este agente.
        </p>

        {bindings.length === 0 ? (
          <div
            className="text-xs p-3 rounded text-center"
            style={{
              backgroundColor: "var(--card-elevated)",
              color: "var(--text-muted)",
              border: "1px dashed var(--border)",
            }}
          >
            Sem bindings. Adicione abaixo pra rotear mensagens pra este agente.
          </div>
        ) : (
          <ul className="space-y-2">
            {bindings.map((b, i) => {
              const key = `${b.channel}:${b.accountId}`;
              const isRemoving = removing === key;
              return (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded"
                  style={{
                    backgroundColor: "var(--card-elevated)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <code className="text-xs" style={{ color: "var(--text-primary)" }}>
                    {b.channel}:{b.accountId}
                  </code>
                  <button
                    onClick={() => handleRemove(b)}
                    disabled={isRemoving}
                    className="p-1 rounded hover:bg-red-500/20 disabled:opacity-30"
                    title="Remover binding"
                  >
                    {isRemoving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2
                        className="w-4 h-4"
                        style={{ color: "var(--error, #FF3B30)" }}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form
        onSubmit={handleAdd}
        className="rounded-xl p-5"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-sm font-semibold mb-3 flex items-center gap-2"
          style={{ color: "var(--text-primary)" }}
        >
          <Plus className="w-4 h-4" />
          Adicionar binding
        </h3>

        {availableChannels.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Nenhum canal configurado. Configure um canal primeiro em /settings.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <label
                className="block text-xs uppercase mb-1 tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Canal
              </label>
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value);
                  setAccountId("");
                }}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              >
                {availableChannels.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-xs uppercase mb-1 tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Conta
              </label>
              {accountOptions.length === 0 ? (
                <p
                  className="text-xs p-2 rounded"
                  style={{
                    color: "var(--text-muted)",
                    backgroundColor: "var(--card-elevated)",
                  }}
                >
                  Todas as contas de <code>{channel}</code> já estão bound aqui.
                </p>
              ) : (
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: "var(--card-elevated)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">— escolha uma conta —</option>
                  {accountOptions.map((acc) => (
                    <option key={acc} value={acc}>
                      {acc}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {error && (
              <div
                className="flex items-start gap-2 text-xs px-3 py-2 rounded"
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

            <button
              type="submit"
              disabled={adding || !accountId || accountOptions.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {adding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {adding ? "Adicionando…" : "Adicionar"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
