"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import {
  Folder,
  FileText,
  FileCode,
  FileJson,
  Image,
  File,
  Loader2,
  AlertCircle,
  Download,
  RefreshCw,
} from "lucide-react";
import { FilePreview } from "./FilePreview";

/**
 * Read-only workspace browser (V1 hardening).
 *
 * Mutation features (upload, delete, mkdir, inline edit via Monaco)
 * were removed. Clicking a file opens FilePreview; the Download button
 * uses /api/files/download which is sanitized server-side.
 */

interface FileEntry {
  name: string;
  type: "file" | "folder";
  size: number;
  modified: string;
}

interface FileBrowserProps {
  workspace: string;
  path: string;
  onNavigate: (path: string) => void;
  viewMode?: "grid" | "list";
}

function getFileIcon(name: string, type: string) {
  if (type === "folder") return Folder;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx", "js", "jsx", "py", "sh", "bash"].includes(ext)) return FileCode;
  if (["json", "yaml", "yml", "toml"].includes(ext)) return FileJson;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext)) return Image;
  if (["md", "mdx", "txt", "log"].includes(ext)) return FileText;
  return File;
}

function getFileColor(name: string, type: string): string {
  if (type === "folder") return "#F59E0B";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["ts", "tsx"].includes(ext)) return "#60A5FA";
  if (["js", "jsx"].includes(ext)) return "#FCD34D";
  if (["json"].includes(ext)) return "#4ADE80";
  if (["py"].includes(ext)) return "#93C5FD";
  if (["md", "mdx"].includes(ext)) return "var(--text-secondary)";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "#C084FC";
  return "var(--text-secondary)";
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function FileBrowser({ workspace, path, onNavigate, viewMode = "list" }: FileBrowserProps) {
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ workspace: string; path: string; name: string } | null>(null);

  const loadItems = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/files/list?path=${encodeURIComponent(path)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load directory");
        return res.json();
      })
      .then((data) => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [path]);

  useEffect(() => {
    // Triggers `setLoading(true)` + `setError(null)` synchronously inside
    // loadItems. That's a single deliberate cascade per path change, not a
    // render-loop hazard.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems();
  }, [loadItems]);

  const handleItemClick = (item: FileEntry) => {
    if (item.type === "folder") {
      const newPath = path ? `${path}/${item.name}` : item.name;
      onNavigate(newPath);
      return;
    }
    const filePath = path ? `${path}/${item.name}` : item.name;
    setPreviewFile({ workspace, path: filePath, name: item.name });
  };

  const handleDownload = (item: FileEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const filePath = path ? `${path}/${item.name}` : item.name;
    const url = `/api/files/download?path=${encodeURIComponent(filePath)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = item.name;
    a.click();
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "1rem", borderRadius: "0.5rem",
        backgroundColor: "rgba(239,68,68,0.1)",
        color: "var(--error)",
      }}>
        <AlertCircle className="w-5 h-5" />
        <span>{error}</span>
        <button
          onClick={loadItems}
          style={{ marginLeft: "auto", padding: "0.25rem 0.75rem", borderRadius: "0.375rem", background: "var(--card-elevated)", color: "var(--text-secondary)", border: "none", cursor: "pointer", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-secondary)" }}>
        <Folder className="w-12 h-12 mx-auto mb-2 opacity-40" />
        <div>Empty directory</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0.75rem" }}>
      {/* Reload button */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
        <button
          onClick={loadItems}
          title="Reload"
          style={{ padding: "0.375rem 0.75rem", borderRadius: "0.375rem", background: "var(--card-elevated)", color: "var(--text-secondary)", border: "none", cursor: "pointer", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Reload
        </button>
      </div>

      {viewMode === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
          {items.map((item) => {
            const Icon = getFileIcon(item.name, item.type);
            const color = getFileColor(item.name, item.type);
            return (
              <button
                key={item.name}
                onClick={() => handleItemClick(item)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem",
                  padding: "1rem 0.5rem", borderRadius: "0.5rem",
                  background: "var(--card)", border: "1px solid var(--border)",
                  cursor: "pointer", color: "var(--text-primary)",
                  textAlign: "center",
                }}
              >
                <Icon className="w-8 h-8" style={{ color }} />
                <span style={{ fontSize: "0.75rem", wordBreak: "break-all", lineHeight: 1.2 }}>{item.name}</span>
                {item.type === "file" && (
                  <button
                    onClick={(e) => handleDownload(item, e)}
                    title="Download"
                    style={{ padding: "0.25rem", borderRadius: "0.25rem", background: "transparent", color: "var(--text-secondary)", border: "none", cursor: "pointer" }}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {items.map((item) => {
            const Icon = getFileIcon(item.name, item.type);
            const color = getFileColor(item.name, item.type);
            return (
              <button
                key={item.name}
                onClick={() => handleItemClick(item)}
                style={{
                  display: "flex", alignItems: "center", gap: "0.75rem",
                  padding: "0.5rem 0.75rem", borderRadius: "0.375rem",
                  background: "transparent", border: "1px solid transparent",
                  cursor: "pointer", color: "var(--text-primary)",
                  textAlign: "left", width: "100%",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--card-elevated)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color }} />
                <span style={{ flex: 1, fontSize: "0.875rem" }}>{item.name}</span>
                {item.type === "file" && (
                  <>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                      {formatFileSize(item.size)}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", minWidth: "8rem", textAlign: "right" }}>
                      {format(new Date(item.modified), "yyyy-MM-dd HH:mm")}
                    </span>
                    <button
                      onClick={(e) => handleDownload(item, e)}
                      title="Download"
                      style={{ padding: "0.25rem", borderRadius: "0.25rem", background: "transparent", color: "var(--text-secondary)", border: "none", cursor: "pointer" }}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}

      {previewFile && (
        <FilePreview
          workspace={previewFile.workspace}
          path={previewFile.path}
          name={previewFile.name}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
