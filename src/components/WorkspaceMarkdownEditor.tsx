"use client";

/**
 * Editor split-view (textarea + preview) usado pela tab Prompt do agent
 * detail. Maneja o conteúdo internamente; o parent fornece o conteúdo
 * original e o callback de save.
 *
 * Por que não é o `MarkdownEditor` que já existe: aquele é específico
 * do memory page (notas livres com onChange/save buttons no parent).
 * Aqui temos commit message custom, view toggle (split/edit/preview),
 * dirty state interno e UI focada em "isso é um arquivo versionado por
 * git, vai gerar commit".
 */
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Eye, Edit3, Save, Loader2, RotateCcw } from "lucide-react";

interface Props {
  filename: string;
  originalContent: string;
  /** Disabled mostra estado "carregando" / "salvando" no parent. */
  loading?: boolean;
  /** Hook que recebe o conteúdo novo + commit message opcional. */
  onSave: (content: string, commitMessage?: string) => Promise<void> | void;
  /** Quando o parent reset (mudou de arquivo), forçamos sincronia. */
  resetKey?: string;
}

export function WorkspaceMarkdownEditor({
  filename,
  originalContent,
  loading = false,
  onSave,
  resetKey,
}: Props) {
  const [value, setValue] = useState(originalContent);
  const [view, setView] = useState<"split" | "edit" | "preview">("split");
  const [showCommitMsg, setShowCommitMsg] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");

  // Reset interno quando o parent troca de arquivo/conteúdo base.
  useEffect(() => {
    setValue(originalContent);
    setCommitMessage("");
    setShowCommitMsg(false);
  }, [originalContent, resetKey]);

  const dirty = value !== originalContent;

  const handleSave = async () => {
    await onSave(value, commitMessage || undefined);
    setShowCommitMsg(false);
    setCommitMessage("");
  };

  const handleDiscard = () => {
    if (dirty && !confirm(`Descartar mudanças em ${filename}?`)) return;
    setValue(originalContent);
    setCommitMessage("");
    setShowCommitMsg(false);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-2 flex-wrap"
        style={{ color: "var(--text-secondary)" }}
      >
        <div className="flex items-center gap-2">
          <code
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {filename}
          </code>
          {dirty && (
            <span
              className="text-[10px] px-2 py-0.5 rounded font-semibold"
              style={{
                backgroundColor: "var(--warning-bg, rgba(255,149,0,0.15))",
                color: "var(--warning, #FF9500)",
              }}
            >
              MODIFICADO
            </span>
          )}
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {value.length} chars
          </span>
        </div>

        <ViewToggle current={view} onChange={setView} />
      </div>

      {/* Editor/preview */}
      <div
        className={`grid gap-3 ${
          view === "split" ? "md:grid-cols-2" : "grid-cols-1"
        }`}
        style={{ minHeight: "60vh" }}
      >
        {(view === "split" || view === "edit") && (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={loading}
            spellCheck={false}
            className="w-full p-3 rounded-lg text-sm font-mono resize-none"
            style={{
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              minHeight: "60vh",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              lineHeight: 1.55,
            }}
            placeholder={`# ${filename}\n\nMarkdown aqui…`}
          />
        )}
        {(view === "split" || view === "preview") && (
          <div
            className="w-full p-4 rounded-lg overflow-auto markdown-body"
            style={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              minHeight: "60vh",
              fontSize: "14px",
              lineHeight: 1.6,
            }}
          >
            {value.trim().length === 0 ? (
              <p style={{ color: "var(--text-muted)" }}>
                <em>(vazio — comece a digitar à esquerda)</em>
              </p>
            ) : (
              <ReactMarkdown>{value}</ReactMarkdown>
            )}
          </div>
        )}
      </div>

      {/* Commit message + save row */}
      {dirty && (
        <div
          className="rounded-lg p-3 space-y-2"
          style={{
            backgroundColor: "var(--card-elevated)",
            border: "1px solid var(--border)",
          }}
        >
          {showCommitMsg ? (
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={`panel: edit ${filename}`}
              maxLength={200}
              className="w-full px-3 py-1.5 rounded text-xs font-mono"
              style={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowCommitMsg(true)}
              className="text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              + Mensagem de commit customizada
            </button>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs"
              style={{ color: "var(--text-secondary)" }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Descartar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || !dirty}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {loading ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewToggle({
  current,
  onChange,
}: {
  current: "split" | "edit" | "preview";
  onChange: (v: "split" | "edit" | "preview") => void;
}) {
  return (
    <div
      className="flex rounded-lg"
      style={{ border: "1px solid var(--border)" }}
    >
      {(["edit", "split", "preview"] as const).map((v) => {
        const active = current === v;
        const Icon = v === "edit" ? Edit3 : Eye;
        const label = v === "edit" ? "Editar" : v === "preview" ? "Preview" : "Split";
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className="flex items-center gap-1 px-3 py-1 text-xs"
            style={{
              backgroundColor: active
                ? "var(--accent-soft, rgba(0,122,255,0.12))"
                : "transparent",
              color: active ? "var(--accent)" : "var(--text-secondary)",
              borderRight: v !== "preview" ? "1px solid var(--border)" : "none",
            }}
          >
            {v === "split" ? (
              <span className="font-mono">⇆</span>
            ) : (
              <Icon className="w-3 h-3" />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}
