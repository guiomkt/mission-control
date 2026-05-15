"use client";

/**
 * Tab "Prompt" do agent detail.
 *
 * Layout:
 *  - Esquerda: sub-tabs verticais com cada arquivo editável que existe
 *    no workspace do agente (+ os whitelist faltando podem ser criados).
 *  - Centro: WorkspaceMarkdownEditor split-view.
 *  - Direita: sidebar de histórico git (últimos commits do arquivo).
 *
 * Comportamento:
 *  - Ao abrir uma tab pela primeira vez, fetcha conteúdo.
 *  - Cache leve em memória (component state) pra navegar entre arquivos
 *    sem refetch.
 *  - Save vira PUT, recarrega conteúdo + histórico.
 */
import { useCallback, useEffect, useState } from "react";
import {
  FileText,
  Loader2,
  AlertCircle,
  History,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { WorkspaceMarkdownEditor } from "@/components/WorkspaceMarkdownEditor";

interface FileInfo {
  filename: string;
  exists: boolean;
  size?: number;
  mtimeMs?: number;
}

interface Commit {
  sha: string;
  date: string;
  author: string;
  subject: string;
}

interface Props {
  agentId: string;
}

export function PromptTab({ agentId }: Props) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState<number | null>(null);

  const [history, setHistory] = useState<Commit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── List ─────────────────────────────────────────────────────────────

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/workspace`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "list failed");
      setFiles(data.files ?? []);
      // Selecione o primeiro que existe.
      if (!selected) {
        const first = (data.files ?? []).find((f: FileInfo) => f.exists);
        if (first) setSelected(first.filename);
      }
    } catch (err) {
      setContentError(err instanceof Error ? err.message : String(err));
    } finally {
      setFilesLoading(false);
    }
  }, [agentId, selected]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // ── Read content + history ──────────────────────────────────────────

  const loadFile = useCallback(
    async (filename: string) => {
      setContentLoading(true);
      setContentError(null);
      setSaveOk(null);
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}/workspace/${encodeURIComponent(filename)}`,
          { cache: "no-store" },
        );
        if (res.status === 404) {
          // Arquivo não existe ainda — tratamos como string vazia.
          setContent("");
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
        setContent(data.content ?? "");
      } catch (err) {
        setContentError(err instanceof Error ? err.message : String(err));
        setContent(null);
      } finally {
        setContentLoading(false);
      }
    },
    [agentId],
  );

  const loadHistory = useCallback(
    async (filename: string) => {
      setHistoryLoading(true);
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}/workspace/${encodeURIComponent(filename)}/history?limit=10`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (res.ok && Array.isArray(data.commits)) {
          setHistory(data.commits);
        } else {
          setHistory([]);
        }
      } catch {
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [agentId],
  );

  useEffect(() => {
    if (selected) {
      loadFile(selected);
      loadHistory(selected);
    }
  }, [selected, loadFile, loadHistory]);

  // ── Save ─────────────────────────────────────────────────────────────

  const handleSave = async (newContent: string, commitMessage?: string) => {
    if (!selected) return;
    setSaving(true);
    setContentError(null);
    setSaveOk(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/workspace/${encodeURIComponent(selected)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent, commitMessage }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setSaveOk(Date.now());
      setContent(newContent);
      // Atualiza files + history.
      fetchFiles();
      loadHistory(selected);
    } catch (err) {
      setContentError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (filesLoading) {
    return (
      <div
        className="flex items-center justify-center p-8 gap-2"
        style={{ color: "var(--text-muted)" }}
      >
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando workspace…
      </div>
    );
  }

  const existing = files.filter((f) => f.exists);
  const available = files.filter((f) => !f.exists);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_240px] gap-4">
      {/* Sidebar de arquivos */}
      <aside
        className="rounded-xl p-3 space-y-1 h-fit"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-xs uppercase tracking-wider mb-2 flex items-center gap-1"
          style={{ color: "var(--text-muted)" }}
        >
          <FileText className="w-3.5 h-3.5" />
          Arquivos
        </h3>
        {existing.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Nenhum prompt file ainda.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {existing.map((f) => (
              <FileButton
                key={f.filename}
                f={f}
                selected={selected === f.filename}
                onClick={() => setSelected(f.filename)}
              />
            ))}
          </ul>
        )}

        {available.length > 0 && (
          <>
            <h3
              className="text-xs uppercase tracking-wider mt-4 mb-2 flex items-center gap-1"
              style={{ color: "var(--text-muted)" }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Disponíveis
            </h3>
            <ul className="space-y-0.5">
              {available.map((f) => (
                <FileButton
                  key={f.filename}
                  f={f}
                  selected={selected === f.filename}
                  onClick={() => setSelected(f.filename)}
                  muted
                />
              ))}
            </ul>
          </>
        )}
      </aside>

      {/* Editor */}
      <div>
        {!selected ? (
          <div
            className="rounded-xl p-8 text-center"
            style={{
              backgroundColor: "var(--card)",
              border: "1px dashed var(--border)",
              color: "var(--text-muted)",
            }}
          >
            Escolha um arquivo à esquerda pra editar.
          </div>
        ) : contentLoading ? (
          <div
            className="flex items-center justify-center p-8 gap-2"
            style={{ color: "var(--text-muted)" }}
          >
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando {selected}…
          </div>
        ) : content === null && contentError ? (
          <div
            className="rounded-xl p-4 flex items-start gap-2 text-sm"
            style={{
              backgroundColor: "var(--error-bg, rgba(255,59,48,0.08))",
              color: "var(--error, #FF3B30)",
              border: "1px solid var(--error, #FF3B30)",
            }}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{contentError}</span>
          </div>
        ) : (
          <>
            <WorkspaceMarkdownEditor
              filename={selected}
              originalContent={content ?? ""}
              loading={saving}
              onSave={handleSave}
              resetKey={selected}
            />
            {contentError && (
              <div
                className="mt-3 flex items-start gap-2 text-xs px-3 py-2 rounded"
                style={{
                  backgroundColor: "var(--error-bg, rgba(255,59,48,0.1))",
                  color: "var(--error, #FF3B30)",
                  whiteSpace: "pre-wrap",
                }}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{contentError}</span>
              </div>
            )}
            {saveOk && (
              <div
                className="mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded"
                style={{
                  backgroundColor: "var(--success-bg, rgba(52,199,89,0.1))",
                  color: "var(--success, #34C759)",
                }}
              >
                <CheckCircle2 className="w-4 h-4" />
                Salvo. Próxima session do agente vê o conteúdo novo.
              </div>
            )}
          </>
        )}
      </div>

      {/* Sidebar de histórico */}
      <aside
        className="rounded-xl p-3 space-y-2 h-fit"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-xs uppercase tracking-wider flex items-center gap-1"
          style={{ color: "var(--text-muted)" }}
        >
          <History className="w-3.5 h-3.5" />
          Histórico
        </h3>
        {!selected ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            —
          </p>
        ) : historyLoading ? (
          <Loader2
            className="w-3 h-3 animate-spin"
            style={{ color: "var(--text-muted)" }}
          />
        ) : history.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Sem commits ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {history.map((c) => (
              <li
                key={c.sha}
                className="rounded p-2 text-[11px] space-y-0.5"
                style={{
                  backgroundColor: "var(--card-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                <code style={{ color: "var(--text-primary)" }}>{c.sha}</code>
                <div
                  className="truncate"
                  style={{ color: "var(--text-secondary)" }}
                  title={c.subject}
                >
                  {c.subject}
                </div>
                <div style={{ color: "var(--text-muted)" }}>
                  {new Date(c.date).toLocaleString()} · {c.author}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p
          className="text-[10px] mt-2"
          style={{ color: "var(--text-muted)" }}
        >
          Restore via SSH (<code>git checkout sha -- file</code>) — pra evitar overwrite sem revisar.
        </p>
      </aside>
    </div>
  );
}

function FileButton({
  f,
  selected,
  onClick,
  muted,
}: {
  f: FileInfo;
  selected: boolean;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-2 py-1.5 rounded text-xs font-mono transition-colors"
        style={{
          backgroundColor: selected
            ? "var(--accent-soft, rgba(0,122,255,0.12))"
            : "transparent",
          color: selected
            ? "var(--accent)"
            : muted
              ? "var(--text-muted)"
              : "var(--text-primary)",
          fontStyle: muted ? "italic" : "normal",
        }}
      >
        {f.filename}
        {f.exists && f.size !== undefined && (
          <span
            className="float-right text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {(f.size / 1024).toFixed(1)}k
          </span>
        )}
      </button>
    </li>
  );
}
