"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollText, Pause, Play, Eraser, Download } from "lucide-react";

interface LogEntry {
  line: string;
  stream: "stdout" | "stderr";
  ts: string;
}

const CONTAINERS = [
  { id: "openclaw-kozw-openclaw-1", label: "openclaw-kozw (gateway)" },
  { id: "mission-control", label: "mission-control (panel)" },
  { id: "openclaw-mission-control-backend-1", label: "v2 backend (parado)" },
  { id: "openclaw-mission-control-frontend-1", label: "v2 frontend (parado)" },
];

// Cap em memória pra não estourar — janela rolante das últimas N linhas.
const MAX_LINES = 2000;

export default function LogsPage() {
  const [container, setContainer] = useState(CONTAINERS[0].id);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const pausedRef = useRef(paused);

  // Mantém a flag de pausa acessível dentro do onmessage sem precisar
  // refazer a subscription a cada toggle (que duplicaria backlog).
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    setEntries([]);
    setError(null);

    sourceRef.current?.close();

    const url = `/api/logs/stream?container=${encodeURIComponent(container)}&tail=200`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onmessage = (event) => {
      if (pausedRef.current) return;
      try {
        const parsed = JSON.parse(event.data) as LogEntry;
        setEntries((prev) => {
          const next = [...prev, parsed];
          if (next.length > MAX_LINES) {
            return next.slice(next.length - MAX_LINES);
          }
          return next;
        });
      } catch {
        // skip malformed line
      }
    };

    es.onerror = () => {
      setError(
        "Conexão com o stream foi interrompida. Tente trocar de container ou recarregar.",
      );
      es.close();
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [container]);

  // Auto-scroll: quando uma linha nova chega, rola pro fundo (a menos que
  // o usuário tenha rolado pra cima manualmente, sinalizando que quer ler
  // o histórico).
  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [entries, autoScroll]);

  const handleClear = () => setEntries([]);

  const handleDownload = () => {
    const text = entries
      .map((e) => `[${e.ts}] [${e.stream}] ${e.line}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${container}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-8 flex flex-col h-screen">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ScrollText className="w-7 h-7" style={{ color: "var(--accent)" }} />
          <div>
            <h1
              className="text-2xl font-bold"
              style={{
                color: "var(--text-primary)",
                fontFamily: "var(--font-heading)",
              }}
            >
              Live Logs
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px" }}>
              Tail em tempo real via <code>docker logs -f</code>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={container}
            onChange={(e) => setContainer(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm"
            style={{
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          >
            {CONTAINERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => setPaused((v) => !v)}
            className="p-2 rounded-lg"
            style={{
              backgroundColor: paused
                ? "var(--accent-soft)"
                : "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: paused ? "var(--accent)" : "var(--text-secondary)",
            }}
            title={paused ? "Retomar" : "Pausar"}
          >
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </button>

          <button
            onClick={handleClear}
            className="p-2 rounded-lg"
            style={{
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
            title="Limpar"
          >
            <Eraser className="w-4 h-4" />
          </button>

          <button
            onClick={handleDownload}
            disabled={entries.length === 0}
            className="p-2 rounded-lg disabled:opacity-40"
            style={{
              backgroundColor: "var(--card-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
            title="Baixar como .txt"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mb-3 px-4 py-2 rounded-lg text-sm"
          style={{
            backgroundColor: "var(--error-bg, rgba(255,59,48,0.1))",
            color: "var(--error, #FF3B30)",
            border: "1px solid var(--error, #FF3B30)",
          }}
        >
          {error}
        </div>
      )}

      <div
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          setAutoScroll(atBottom);
        }}
        className="flex-1 overflow-y-auto rounded-lg p-3 font-mono text-xs"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-mono, monospace)",
          lineHeight: 1.5,
        }}
      >
        {entries.length === 0 ? (
          <div
            className="flex items-center justify-center h-full"
            style={{ color: "var(--text-muted)" }}
          >
            Aguardando logs…
          </div>
        ) : (
          entries.map((entry, idx) => (
            <div
              key={idx}
              style={{
                color:
                  entry.stream === "stderr"
                    ? "var(--error, #FF3B30)"
                    : "var(--text-primary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {entry.line}
            </div>
          ))
        )}
      </div>

      <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {entries.length} linhas em memória • máximo {MAX_LINES} •{" "}
        {paused
          ? "Pausado"
          : autoScroll
            ? "Auto-scroll ativo"
            : "Scroll manual"}
      </div>
    </div>
  );
}
