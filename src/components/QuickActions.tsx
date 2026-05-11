"use client";

import { Info } from "lucide-react";

/**
 * Settings → Quick Actions (V1).
 *
 * The upstream tenacitOS shipped four actions here. In V1 we run the panel
 * in its own container with a read-only mount of OpenClaw, and JWT-based
 * auth driven from `ADMIN_PASSWORD` env vars — so none of the original
 * buttons did what the label said:
 *
 *   - Restart Gateway       → placeholder, never wired up
 *   - View Gateway Logs     → placeholder, never wired up
 *   - Clear Activity Log    → wrote to legacy `activities.json`; V1 uses SQLite
 *   - Change Password       → rewrote `.env.local`; V1 reads ADMIN_PASSWORD
 *                             from compose env, so the change reverts on
 *                             the next container restart
 *
 * Rather than keep broken buttons around, the V1 surface is honest: no
 * mutation actions in the panel. Password rotation and gateway restart
 * are now deploy-side concerns (see `deploy/README.md`); audit truncation
 * happens by rotating the `mission-control-data` volume.
 */
export function QuickActions() {
  return (
    <div
      className="rounded-xl p-6"
      style={{
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      <h2
        className="text-xl font-semibold mb-4 flex items-center gap-2"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-heading)' }}
      >
        <Info className="w-5 h-5" style={{ color: 'var(--accent)' }} />
        Operator Actions
      </h2>

      <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
        Mission Control runs as a read-only operator panel. State-changing
        actions live on the host:
      </p>

      <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <li className="flex gap-2">
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Restart gateway:</strong>{' '}
            <code style={{ fontFamily: 'monospace' }}>docker restart openclaw-kozw</code>
          </span>
        </li>
        <li className="flex gap-2">
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>View gateway logs:</strong>{' '}
            <code style={{ fontFamily: 'monospace' }}>docker logs -f openclaw-kozw</code>
          </span>
        </li>
        <li className="flex gap-2">
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Rotate admin password:</strong>{' '}
            update <code style={{ fontFamily: 'monospace' }}>ADMIN_PASSWORD</code> in
            the compose env and{' '}
            <code style={{ fontFamily: 'monospace' }}>docker compose up -d</code>
          </span>
        </li>
        <li className="flex gap-2">
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>Truncate audit log:</strong>{' '}
            rotate the <code style={{ fontFamily: 'monospace' }}>mission-control-data</code>{' '}
            volume (the SQLite lives there)
          </span>
        </li>
      </ul>
    </div>
  );
}
