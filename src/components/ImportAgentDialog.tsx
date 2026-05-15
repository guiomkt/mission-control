"use client";

/**
 * Diálogo de importar agente de um tarball exportado.
 *
 * Multipart upload do .tar.gz + newId + newName opcional. Valida
 * client-side (extensão, tamanho) e delega o resto pro backend.
 */
import { useEffect, useState } from "react";
import {
  X,
  Upload,
  Loader2,
  AlertCircle,
  FileArchive,
  AlertTriangle,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (created: { id: string; name: string }) => void;
  existingIds: string[];
}

const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_BYTES = 100 * 1024 * 1024; // sincronia com backend

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function ImportAgentDialog({
  isOpen,
  onClose,
  onSuccess,
  existingIds,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setNewId("");
      setNewName("");
      setIdTouched(false);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!idTouched && newName) {
      setNewId(slugify(newName));
    }
  }, [newName, idTouched]);

  if (!isOpen) return null;

  const fileTooLarge = file && file.size > MAX_BYTES;
  const fileWrongType =
    file && !/\.(tar\.gz|tgz)$/i.test(file.name);
  const idValid = ID_RE.test(newId);
  const idCollision = existingIds.includes(newId);
  const canSubmit =
    !!file &&
    !fileTooLarge &&
    !fileWrongType &&
    idValid &&
    !idCollision &&
    !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("newId", newId);
      if (newName.trim().length > 0) fd.set("newName", newName.trim());
      fd.set("file", file);
      const res = await fetch("/api/agents/import", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      onSuccess({ id: data.id, name: data.name });
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
      onClick={() => !loading && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl p-6"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Importar agente
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded hover:bg-gray-700"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <p
          className="text-xs mb-4"
          style={{ color: "var(--text-muted)" }}
        >
          Suba um tarball gerado pelo botão Exportar. Cria novo agente com o
          conteúdo do workspace + identity + model + subagents + heartbeat.
        </p>

        <div
          className="rounded-lg p-3 mb-4 flex items-start gap-2 text-xs"
          style={{
            backgroundColor: "var(--warning-bg, rgba(255,149,0,0.08))",
            border: "1px solid var(--warning, #FF9500)",
            color: "var(--warning, #FF9500)",
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            Modelos pagos no tarball são bloqueados (OAuth-only). Bindings e
            sessions NÃO são importados.
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Tarball (.tar.gz)
            </label>
            <input
              type="file"
              accept=".tar.gz,.tgz,application/gzip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="block w-full text-xs"
              style={{ color: "var(--text-secondary)" }}
            />
            {file && (
              <p
                className="text-[11px] mt-1 flex items-center gap-1"
                style={{ color: "var(--text-muted)" }}
              >
                <FileArchive className="w-3 h-3" />
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
            {fileTooLarge && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--error, #FF3B30)" }}
              >
                Maior que 100MB. Importa via SSH.
              </p>
            )}
            {fileWrongType && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--error, #FF3B30)" }}
              >
                Esperado .tar.gz ou .tgz.
              </p>
            )}
          </div>

          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Nome (opcional)
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              placeholder="usa o nome do tarball se vazio"
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={inputStyle}
            />
          </div>

          <div>
            <label
              className="block text-xs uppercase mb-1 tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              ID do novo agente
            </label>
            <input
              type="text"
              value={newId}
              onChange={(e) => {
                setNewId(e.target.value);
                setIdTouched(true);
              }}
              maxLength={40}
              required
              className="w-full px-3 py-2 rounded-lg text-sm font-mono"
              style={{
                ...inputStyle,
                borderColor:
                  newId.length > 0 && (!idValid || idCollision)
                    ? "var(--error, #FF3B30)"
                    : "var(--border)",
              }}
              placeholder="lowercase-com-hifens"
            />
            {newId.length > 0 && !idValid && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--error, #FF3B30)" }}
              >
                Use [a-z][a-z0-9-], máx 40 chars.
              </p>
            )}
            {idCollision && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--error, #FF3B30)" }}
              >
                ID já existe.
              </p>
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

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ backgroundColor: "var(--accent)", color: "white" }}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {loading ? "Importando…" : "Importar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--card-elevated)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
};
