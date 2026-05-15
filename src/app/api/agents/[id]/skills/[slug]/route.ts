/**
 * Uninstall de skill em um agente.
 *
 * DELETE /api/agents/[id]/skills/[slug]
 *   → { success, status: "removed" | "not_installed" }
 *
 * Uninstall é manual (sem `openclaw skills uninstall` em 2026.5.7):
 *  - rm -rf <workspace>/skills/<slug>/
 *  - Edita <workspace>/.clawhub/lock.json removendo a entry
 * Sob `withConfigLock`, audit log, validação rigorosa de slug.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  validateAgentId,
  RESERVED_AGENT_IDS,
} from "@/lib/agent-validation";
import { auditMutation } from "@/lib/audit-log";
import {
  uninstallSkill,
  isValidSkillSlug,
  SkillManagerError,
} from "@/lib/agent-skills-manager";
import { invalidateSkillsCacheForAgent } from "@/lib/agent-skills-cache";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string }> },
) {
  const { id, slug } = await params;

  if (
    !validateAgentId(id).ok &&
    !RESERVED_AGENT_IDS.has(id) &&
    !/^[a-z][a-z0-9-]{0,39}$/.test(id)
  ) {
    return NextResponse.json({ error: "ID de agente inválido." }, { status: 400 });
  }
  if (!isValidSkillSlug(slug)) {
    return NextResponse.json(
      { error: "slug inválido. Use [a-z0-9][a-z0-9-]{0,62}." },
      { status: 400 },
    );
  }

  try {
    const result = await uninstallSkill(id, slug);
    invalidateSkillsCacheForAgent(id);
    await auditMutation(request, {
      action: "agent.skill.uninstall",
      target: id,
      ok: true,
      meta: { slug, status: result.status },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    await auditMutation(request, {
      action: "agent.skill.uninstall",
      target: id,
      ok: false,
      meta: { slug },
    });
    if (err instanceof SkillManagerError) {
      return NextResponse.json(
        { error: err.message, detail: err.stderr || err.stdout || undefined },
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
