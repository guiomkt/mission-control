/**
 * Skills instaladas/disponíveis pra um agente.
 *
 * GET  /api/agents/[id]/skills
 *   → { workspaceDir, managedSkillsDir, skills: [...] }
 *   Resposta de `openclaw skills list --agent X --json`, cacheada 60s.
 *
 * POST /api/agents/[id]/skills
 *   Body: { slug: string, version?: string, force?: boolean }
 *   Roda `openclaw skills install <slug> --agent X [--version V] [--force]`
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import {
  listSkills,
  installSkill,
  isValidSkillSlug,
  isValidSkillVersion,
  SkillManagerError,
  type SkillsListResult,
} from "@/lib/agent-skills-manager";
import {
  getSkillsCache,
  invalidateSkillsCacheForAgent,
} from "@/lib/agent-skills-cache";

export const dynamic = "force-dynamic";


function checkAgent(id: string) {
  if (
    !validateAgentId(id).ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return { ok: false as const, status: 400, error: "ID inválido." };
  }
  return { ok: true as const };
}

async function fetchForAgent(id: string): Promise<SkillsListResult> {
  return getSkillsCache(id).get(() => listSkills(id));
}

// ── GET ──────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const check = checkAgent(id);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  try {
    // Cache invalidate quando muda de agentId pra evitar mistura
    // (SingleFlightCache é mono-key).
    const result = await fetchForAgent(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SkillManagerError) {
      return NextResponse.json(
        { error: err.message, detail: err.stderr || err.stdout || undefined },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: "Falha ao listar skills",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ── POST (install) ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const check = checkAgent(id);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  let body: { slug?: unknown; version?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Body deve ser JSON válido." },
      { status: 400 },
    );
  }

  if (!isValidSkillSlug(body.slug)) {
    return NextResponse.json(
      { error: "slug inválido. Use [a-z0-9][a-z0-9-]{0,62}." },
      { status: 400 },
    );
  }
  if (body.version !== undefined && !isValidSkillVersion(body.version)) {
    return NextResponse.json(
      { error: "version inválida." },
      { status: 400 },
    );
  }
  const force = body.force === true;
  const version =
    typeof body.version === "string" ? body.version : undefined;

  const meta = { slug: body.slug, version, force };

  try {
    const result = await installSkill(id, body.slug, version, { force });
    invalidateSkillsCacheForAgent(id);
    await auditMutation(request, {
      action: "agent.skill.install",
      target: id,
      ok: true,
      meta,
    });
    return NextResponse.json(
      { success: true, ...result },
      { status: 201 },
    );
  } catch (err) {
    await auditMutation(request, {
      action: "agent.skill.install",
      target: id,
      ok: false,
      meta,
    });
    if (err instanceof SkillManagerError) {
      const msg = err.message;
      // Mapeamento de status code baseado no erro.
      if (/já instalada|exists/i.test(msg)) {
        return NextResponse.json(
          { error: msg, detail: err.stderr || err.stdout || undefined },
          { status: 409 },
        );
      }
      if (/não encontrada|not.found/i.test(msg)) {
        return NextResponse.json(
          { error: msg, detail: err.stderr || err.stdout || undefined },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: msg, detail: err.stderr || err.stdout || undefined },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: "unexpected error",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
