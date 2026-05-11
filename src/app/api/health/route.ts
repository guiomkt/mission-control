/**
 * Health check endpoint
 *
 * GET /api/health
 *
 * Checks that matter for our stack (everything else from the upstream
 * tenacitOS file was removed — we don't run systemctl, pm2, or upstream
 * domains):
 *
 *   1. self           — the panel process is up (we wouldn't be answering otherwise)
 *   2. workspace      — OPENCLAW_DIR is mounted and openclaw.json is readable
 *   3. audit-log      — /app/data is writable so logins/etc. get recorded
 *   4. openclaw-http  — optional, if OPENCLAW_GATEWAY_URL is configured
 *   5. anthropic-api  — external dependency for any LLM call
 */
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { OPENCLAW_DIR } from '@/lib/paths';

interface ServiceCheck {
  name: string;
  status: 'up' | 'down' | 'degraded' | 'unknown';
  latency?: number;
  details?: string;
  url?: string;
}

const AUDIT_LOG_PATH =
  process.env.AUDIT_LOG_PATH || path.join(process.cwd(), 'data', 'audit.log');

async function checkUrl(
  url: string,
  timeoutMs = 3000,
): Promise<{ status: 'up' | 'down'; latency: number; httpCode?: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latency = Date.now() - start;
    return {
      status: res.ok || res.status < 500 ? 'up' : 'down',
      latency,
      httpCode: res.status,
    };
  } catch {
    return { status: 'down', latency: Date.now() - start };
  }
}

async function checkWorkspaceVolume(): Promise<ServiceCheck> {
  const start = Date.now();
  const configPath = path.join(OPENCLAW_DIR, 'openclaw.json');
  try {
    const stat = await fs.stat(configPath);
    if (!stat.isFile()) {
      return {
        name: 'OpenClaw workspace',
        status: 'down',
        details: `${configPath} is not a regular file`,
      };
    }
    return {
      name: 'OpenClaw workspace',
      status: 'up',
      latency: Date.now() - start,
      details: `openclaw.json (${stat.size} bytes), volume mounted at ${OPENCLAW_DIR}`,
    };
  } catch (err) {
    return {
      name: 'OpenClaw workspace',
      status: 'down',
      details: `cannot read ${configPath}: ${(err as Error).message}`,
    };
  }
}

async function checkAuditLog(): Promise<ServiceCheck> {
  const dir = path.dirname(AUDIT_LOG_PATH);
  try {
    await fs.mkdir(dir, { recursive: true });
    // Open in append+rwx mode; fs.access(W_OK) on a non-existent file lies on
    // some filesystems, so write a marker byte and remove it. Cheap and reliable.
    const probe = path.join(dir, '.healthcheck-probe');
    await fs.writeFile(probe, '', { flag: 'w' });
    await fs.unlink(probe);
    return {
      name: 'Audit log',
      status: 'up',
      details: `${AUDIT_LOG_PATH} writable`,
    };
  } catch (err) {
    return {
      name: 'Audit log',
      status: 'down',
      details: `${dir} not writable: ${(err as Error).message}`,
    };
  }
}

async function checkOpenClawGateway(): Promise<ServiceCheck | null> {
  const url = process.env.OPENCLAW_GATEWAY_URL;
  if (!url) return null;

  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${url.replace(/\/$/, '')}/gateway/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latency = Date.now() - start;
    // /gateway/* serves the SPA HTML when reached — HTTP 200 means we got
    // through the proxy + auth and the gateway answered.
    return {
      name: 'OpenClaw gateway HTTP',
      status: res.ok ? 'up' : 'degraded',
      latency,
      details: `HTTP ${res.status}`,
      url,
    };
  } catch (err) {
    return {
      name: 'OpenClaw gateway HTTP',
      status: 'down',
      details: (err as Error).message,
      url,
    };
  }
}

export async function GET() {
  const checks: ServiceCheck[] = [];

  // 1. Self — always up if we're answering.
  checks.push({
    name: 'Mission Control',
    status: 'up',
    details: `uptime ${Math.round(process.uptime())}s`,
  });

  // 2-3. Volume + audit log
  const [volume, audit] = await Promise.all([
    checkWorkspaceVolume(),
    checkAuditLog(),
  ]);
  checks.push(volume, audit);

  // 4. Optional: OpenClaw gateway HTTP (skipped if URL not configured).
  const gateway = await checkOpenClawGateway();
  if (gateway) checks.push(gateway);

  // 5. External — Anthropic API (treat 401 as "up", since unauth probes are rejected).
  const anthropic = await checkUrl('https://api.anthropic.com', 3000);
  checks.push({
    name: 'Anthropic API',
    status:
      anthropic.status === 'up' || anthropic.httpCode === 401 ? 'up' : 'down',
    latency: anthropic.latency,
    url: 'https://api.anthropic.com',
    details:
      anthropic.status === 'up' || anthropic.httpCode === 401
        ? 'reachable'
        : 'unreachable',
  });

  // Overall: down = critical for our own infra (self/volume/audit); external
  // is "degraded" only.
  const ownDown = checks
    .filter((c) =>
      ['Mission Control', 'OpenClaw workspace', 'Audit log'].includes(c.name),
    )
    .some((c) => c.status === 'down');
  const anyDown = checks.some((c) => c.status === 'down');
  const overallStatus = ownDown
    ? 'critical'
    : anyDown
    ? 'degraded'
    : 'healthy';

  return NextResponse.json({
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
