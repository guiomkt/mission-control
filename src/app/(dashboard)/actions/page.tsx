"use client";

import { Wrench, Lock, Clock } from "lucide-react";

/**
 * V1 placeholder.
 *
 * Quick Actions in the upstream tenacitOS shelled out to `systemctl`,
 * `pm2`, `find`, `rm`, etc. from inside the panel process. Our deploy
 * runs the panel in an isolated container without host shell access,
 * so the original implementation isn't viable.
 *
 * They'll come back in V1.1 as specific gateway-side endpoints — not
 * generic shell execution — so a "restart channel" action will be a
 * dedicated, audited call into the OpenClaw gateway, etc.
 */
export default function ActionsPage() {
  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1
          className="text-2xl md:text-3xl font-bold mb-1"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
        >
          Quick Actions
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
          Operational shortcuts for common one-click tasks
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
              The original Quick Actions ran shell pipelines on the host
              (<code>systemctl</code>, <code>pm2</code>, <code>find</code> + <code>rm</code>).
              The hardened panel runs in an isolated container without that
              access, so those actions were intentionally cut.
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
              <Wrench className="w-3.5 h-3.5 mt-1 flex-shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                <strong>Restart channel</strong> — call the OpenClaw gateway directly
                (e.g. WhatsApp 401 loop), no generic shell.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Wrench className="w-3.5 h-3.5 mt-1 flex-shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                <strong>Trigger cron now</strong> — same control-channel idea,
                wired into <code>/api/cron/run</code>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Wrench className="w-3.5 h-3.5 mt-1 flex-shrink-0" style={{ color: "var(--accent)" }} />
              <span>
                <strong>Audit log export</strong> — pull <code>data/audit.log</code> as JSONL.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
