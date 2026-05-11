"use client";

import { Terminal, Lock, Clock } from "lucide-react";

/**
 * V1 placeholder.
 *
 * Upstream tailed gateway / pm2 logs via `journalctl -u <svc> -f` and
 * `pm2 logs <name>`, both spawned from inside the panel process. Our
 * container doesn't ship either binary and (correctly) cannot reach
 * the host's pm2 socket or systemd journal.
 *
 * V1.1 plan: read the OpenClaw container's logs via the Docker socket
 * mounted read-only into the panel, or via a thin authenticated tail
 * endpoint on the gateway side.
 */
export default function LogsPage() {
  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1
          className="text-2xl md:text-3xl font-bold mb-1"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
        >
          Live Logs
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
          Tail real-time output from the gateway and connected services
        </p>
      </div>

      <div
        className="rounded-xl p-8 max-w-2xl"
        style={{
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="flex items-start gap-4 mb-4">
          <div
            className="p-3 rounded-lg flex-shrink-0"
            style={{ backgroundColor: "rgba(255,149,0,0.12)" }}
          >
            <Lock className="w-6 h-6" style={{ color: "var(--warning, #FF9500)" }} />
          </div>
          <div>
            <h2
              className="text-lg font-semibold mb-1"
              style={{ color: "var(--text-primary)" }}
            >
              Disabled in V1
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "14px", lineHeight: 1.6 }}>
              The upstream tailing was based on <code>journalctl</code> /{" "}
              <code>pm2 logs</code> spawned from inside the panel. Neither is
              available in our hardened container.
            </p>
          </div>
        </div>

        <div
          className="mt-6 pt-6"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-3" style={{ color: "var(--text-muted)" }}>
            <Clock className="w-4 h-4" />
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Coming back in V1.1</span>
          </div>
          <ul style={{ color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.8 }}>
            <li className="flex items-start gap-2">
              <Terminal className="w-3.5 h-3.5 mt-1 flex-shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                <strong>OpenClaw container logs</strong> via the Docker socket
                mounted read-only, with a hard cap on bytes per request.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Terminal className="w-3.5 h-3.5 mt-1 flex-shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                <strong>Audit log tail</strong> — stream the panel's own{" "}
                <code>data/audit.log</code>.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
