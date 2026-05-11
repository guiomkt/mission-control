"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, RefreshCw, AlertCircle, LayoutGrid, CalendarDays, Info } from "lucide-react";
import { CronJobCard, type CronJob } from "@/components/CronJobCard";
import { CronWeeklyTimeline } from "@/components/CronWeeklyTimeline";

type ViewMode = "cards" | "timeline";

/**
 * Cron page (V1 — read-only).
 *
 * The panel sees the OpenClaw `crontab.txt` through a read-only mount, so
 * pausing/deleting/triggering a job from here is impossible until Phase 3
 * adds a control channel into the gateway. The card no longer renders those
 * actions, and the page shows a one-line notice so operators know where to
 * change schedules.
 */
export default function CronJobsPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  const fetchJobs = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/cron");
      if (!res.ok) throw new Error("Failed to fetch jobs");
      const data = await res.json();
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const activeJobs = jobs.filter((j) => j.enabled).length;
  const pausedJobs = jobs.length - activeJobs;

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 md:mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold mb-1" style={{ 
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-heading)'
          }}>
            Cron Jobs
          </h1>
          <p className="text-sm md:text-base" style={{ color: 'var(--text-secondary)' }}>
            Scheduled tasks from OpenClaw Gateway
          </p>
          <p
            style={{
              marginTop: '0.5rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
            }}
          >
            <Info className="w-3.5 h-3.5" />
            Read-only · edit <code style={{ fontFamily: 'monospace' }}>crontab.txt</code> on the gateway to change schedules
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* View mode toggle */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '0.5rem',
              padding: '3px',
            }}
          >
            <button
              onClick={() => setViewMode("cards")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.4rem 0.75rem',
                borderRadius: '0.35rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                backgroundColor: viewMode === "cards" ? 'var(--accent)' : 'transparent',
                color: viewMode === "cards" ? 'white' : 'var(--text-secondary)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Cards
            </button>
            <button
              onClick={() => setViewMode("timeline")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.4rem 0.75rem',
                borderRadius: '0.35rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                backgroundColor: viewMode === "timeline" ? 'var(--accent)' : 'transparent',
                color: viewMode === "timeline" ? 'white' : 'var(--text-secondary)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Timeline
            </button>
          </div>

          <button
            onClick={() => { setIsLoading(true); fetchJobs(); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              backgroundColor: 'var(--card)',
              color: 'var(--text-primary)',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'opacity 0.2s'
            }}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-4 md:mb-8">
        <div style={{
          backgroundColor: 'color-mix(in srgb, var(--card) 50%, transparent)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <div style={{ padding: '0.75rem', backgroundColor: 'color-mix(in srgb, var(--info) 20%, transparent)', borderRadius: '0.5rem' }}>
            <Clock className="w-6 h-6" style={{ color: 'var(--info)' }} />
          </div>
          <div>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{jobs.length}</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Total Jobs</p>
          </div>
        </div>
        <div style={{
          backgroundColor: 'color-mix(in srgb, var(--card) 50%, transparent)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <div style={{ padding: '0.75rem', backgroundColor: 'color-mix(in srgb, var(--success) 20%, transparent)', borderRadius: '0.5rem' }}>
            <RefreshCw className="w-6 h-6" style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{activeJobs}</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Active</p>
          </div>
        </div>
        <div style={{
          backgroundColor: 'color-mix(in srgb, var(--card) 50%, transparent)',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <div style={{ padding: '0.75rem', backgroundColor: 'color-mix(in srgb, var(--warning) 20%, transparent)', borderRadius: '0.5rem' }}>
            <AlertCircle className="w-6 h-6" style={{ color: 'var(--warning)' }} />
          </div>
          <div>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{pausedJobs}</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Paused</p>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '1rem',
          backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--error) 30%, transparent)',
          borderRadius: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertCircle className="w-5 h-5" style={{ color: 'var(--error)' }} />
          <span style={{ color: 'var(--error)' }}>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', color: 'var(--error)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 0' }}>
          <div style={{
            width: '2rem', height: '2rem',
            border: '2px solid var(--accent)', borderTopColor: 'transparent',
            borderRadius: '50%', animation: 'spin 1s linear infinite'
          }} />
        </div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0' }}>
          <Clock className="w-8 h-8 mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            No cron jobs found
          </h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            Create cron jobs via Telegram or the OpenClaw CLI
          </p>
        </div>
      ) : viewMode === "timeline" ? (
        /* Timeline View */
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            padding: '1.25rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
              paddingBottom: '1rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <CalendarDays className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <h2
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-heading)',
              }}
            >
              7-Day Schedule Overview
            </h2>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--card-elevated)',
                padding: '0.25rem 0.6rem',
                borderRadius: '0.35rem',
              }}
            >
              All times in local timezone
            </span>
          </div>
          <CronWeeklyTimeline jobs={jobs} />
        </div>
      ) : (
        /* Cards View */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
          {jobs.map((job) => (
            <CronJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
