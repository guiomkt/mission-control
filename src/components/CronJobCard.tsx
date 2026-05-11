"use client";

import { useState } from "react";
import {
  Clock,
  Calendar,
  ChevronDown,
  ChevronUp,
  Bot,
} from "lucide-react";

/**
 * Cron job card (V1 — read-only).
 *
 * Pause/Delete/Run-now used to live here, but the panel runs in a separate
 * container with a read-only mount of OpenClaw — the corresponding API
 * routes 405/501. Re-introduce them once Phase 3 ships a gateway-side
 * control channel.
 */

export interface CronJob {
  id: string;
  agentId: string;
  name: string;
  description: string;
  schedule: string | Record<string, unknown>;
  scheduleDisplay: string;
  timezone: string;
  enabled: boolean;
  nextRun: string | null;
  lastRun: string | null;
  sessionTarget: string;
  payload: Record<string, unknown>;
}

interface CronJobCardProps {
  job: CronJob;
}

const AGENT_EMOJI: Record<string, string> = {
  main: "🦞",
  academic: "🎓",
  infra: "🔧",
  studio: "🎬",
  social: "📱",
  linkedin: "💼",
  freelance: "🔧",
};

export function CronJobCard({ job }: CronJobCardProps) {
  const [expanded, setExpanded] = useState(false);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return date.toLocaleString("es-ES", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
  };

  const getRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (diff < 0) return "overdue";
    if (days > 0) return `in ${days}d ${hours % 24}h`;
    if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `in ${minutes}m`;
    return "now";
  };

  const agentEmoji = AGENT_EMOJI[job.agentId] || "🤖";

  return (
    <div
      className="rounded-xl"
      style={{
        border: '1px solid',
        borderColor: job.enabled ? 'var(--border)' : 'rgba(42, 42, 42, 0.5)',
        backgroundColor: job.enabled ? 'color-mix(in srgb, var(--card) 50%, transparent)' : 'color-mix(in srgb, var(--card) 30%, transparent)',
        opacity: job.enabled ? 1 : 0.6,
        transition: 'all 0.2s'
      }}
    >
      <div className="p-3 md:p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-2 md:mb-3 gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 md:gap-2 flex-wrap">
              <span title={job.agentId}>{agentEmoji}</span>
              <h3 className="text-sm md:text-lg font-semibold truncate" style={{ 
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-heading)'
              }}>
                {job.name}
              </h3>
              <span
                className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{
                  backgroundColor: job.enabled 
                    ? 'color-mix(in srgb, var(--success) 20%, transparent)' 
                    : 'rgba(42, 42, 42, 0.5)',
                  color: job.enabled ? 'var(--success)' : 'var(--text-secondary)'
                }}
              >
                {job.enabled ? "Active" : "Paused"}
              </span>
            </div>
            <p className="text-xs md:text-sm mt-0.5 md:mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
              {job.description}
            </p>
          </div>
        </div>

        {/* Schedule Info */}
        <div className="flex flex-wrap gap-2 md:gap-4 mb-2 md:mb-4">
          <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
            <Clock className="w-3.5 h-3.5 md:w-4 md:h-4" style={{ color: 'var(--info)' }} />
            <code className="text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded" style={{
              backgroundColor: 'rgba(42, 42, 42, 0.5)',
              color: 'var(--text-secondary)',
              fontFamily: 'monospace'
            }}>
              {job.scheduleDisplay}
            </code>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm">
            <Bot className="w-3.5 h-3.5 md:w-4 md:h-4" style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'var(--text-muted)' }}>{job.sessionTarget}</span>
          </div>
        </div>

        {/* Next Run */}
        {job.enabled && job.nextRun && (
          <div className="flex flex-wrap items-center gap-1 md:gap-2 text-xs md:text-sm mb-2 md:mb-4">
            <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4" style={{ color: 'var(--type-cron)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Next:</span>
            <span style={{ color: 'var(--text-primary)' }}>{formatDate(job.nextRun)}</span>
            <span style={{ color: 'var(--type-cron)' }}>({getRelativeTime(job.nextRun)})</span>
          </div>
        )}

        {/* Expand/Collapse for Details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs md:text-sm"
          style={{
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            transition: 'color 0.2s'
          }}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span>Hide details</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span>Show details</span>
            </>
          )}
        </button>

        {/* Expanded: Details */}
        {expanded && (
          <div className="mt-2 md:mt-3 pl-3 md:pl-4 flex flex-col gap-1 md:gap-2 text-xs md:text-sm" style={{ borderLeft: '2px solid var(--border)' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>ID: </span>
              <code style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>{job.id}</code>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Agent: </span>
              <span style={{ color: 'var(--text-secondary)' }}>{agentEmoji} {job.agentId}</span>
            </div>
            {job.lastRun && (
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Last run: </span>
                <span style={{ color: 'var(--text-secondary)' }}>{formatDate(job.lastRun)}</span>
              </div>
            )}
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Timezone: </span>
              <span style={{ color: 'var(--text-secondary)' }}>{job.timezone}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
