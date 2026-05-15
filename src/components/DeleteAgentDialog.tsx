"use client";

import { useEffect, useState } from "react";
import {
  X,
  Trash2,
  Loader2,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";

interface DeleteAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agent: {
    id: string;
    name?: string;
    activeSessions?: number;
    workspace?: string;
    referencedBy?: Array<{ id: string; name: string }>;
  } | null;
}

export function DeleteAgentDialog({
  isOpen,
  onClose,
  onSuccess,
  agent,
}: DeleteAgentDialogProps) {
  const [confirmInput, setConfirmInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setConfirmInput("");
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen || !agent) return null;

  const matchesId = confirmInput.trim() === agent.id;
  const isReferenced = (agent.referencedBy ?? []).length > 0;
  const canDelete = matchesId && !isReferenced && !loading;

  const handleClose = () => {
    if (loading) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!canDelete) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "Falha ao deletar");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-xl p-6"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--error, #FF3B30)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Trash2
              className="w-5 h-5"
              style={{ color: "var(--error, #FF3B30)" }}
            />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--error, #FF3B30)" }}
            >
              Deletar agente
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-gray-700"
            aria-label="Fechar"
            disabled={loading}
          >
            <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        {/* Warning section */}
        <div
          className="rounded-lg p-3 mb-4 text-sm"
          style={{
            backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
            border: "1px solid var(--error, #FF3B30)",
            color: "var(--error, #FF3B30)",
          }}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="font-semibold">
                Esta ação é irreversível.
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--text-secondary)" }}
              >
                Será deletado:
              </p>
              <ul
                className="text-xs list-disc pl-4 space-y-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                <li>Workspace: <code>{agent.workspace ?? `~/.openclaw/workspace-${agent.id}`}</code></li>
                <li>State files do agente em <code>~/.openclaw/agents/{agent.id}/</code></li>
                <li>
                  {agent.activeSessions ?? 0} sessões ativas (histórico de conversas perdido)
                </li>
                <li>Bindings de canais vinculados</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Blocked by references */}
        {isReferenced && (
          <div
            className="rounded-lg p-3 mb-4 text-sm"
            style={{
              backgroundColor: "var(--warning-bg, rgba(255,149,0,0.08))",
              border: "1px solid var(--warning, #FF9500)",
              color: "var(--warning, #FF9500)",
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Bloqueado: ainda é subagent de outros</p>
                <ul
                  className="text-xs mt-1 list-disc pl-4"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {(agent.referencedBy ?? []).map((r) => (
                    <li key={r.id}>
                      {r.name} (<code>{r.id}</code>)
                    </li>
                  ))}
                </ul>
                <p
                  className="text-[11px] mt-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Remova as referências em <code>subagents.allowAgents</code> antes de deletar.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Type-to-confirm */}
        {!isReferenced && (
          <div className="mb-4">
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Pra confirmar, digite o ID do agente:{" "}
              <code style={{ color: "var(--text-primary)" }}>{agent.id}</code>
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={agent.id}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg text-sm font-mono"
              style={{
                backgroundColor: "var(--card-elevated)",
                border:
                  confirmInput.length > 0 && !matchesId
                    ? "1px solid var(--error, #FF3B30)"
                    : "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
          </div>
        )}

        {error && (
          <div
            className="flex items-start gap-2 text-xs px-3 py-2 rounded mb-3"
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

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-secondary)" }}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canDelete}
            className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 flex items-center gap-2"
            style={{
              backgroundColor: canDelete
                ? "var(--error, #FF3B30)"
                : "var(--card-elevated)",
              color: "white",
            }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <Trash2 className="w-4 h-4" />
            {loading ? "Deletando..." : "Deletar permanentemente"}
          </button>
        </div>
      </div>
    </div>
  );
}
