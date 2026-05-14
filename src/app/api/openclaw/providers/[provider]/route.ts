/**
 * Set / delete / migrate de uma chave de provedor LLM.
 *
 * PUT    /api/openclaw/providers/:provider  body={ value }
 * DELETE /api/openclaw/providers/:provider
 * POST   /api/openclaw/providers/:provider/migrate  (handled aqui via PUT
 *        com body `{ migrate: true }`, pra evitar criar mais um arquivo)
 *
 * Tanto PUT quanto DELETE causam restart do container kozw (necessário
 * pra que env vars novas surtam efeito — sem reload granular no CLI).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  findProvider,
  upsertProviderKey,
  deleteProviderKeyRow,
} from "@/lib/provider-keys";
import { applyEnvToKozw, readEnvFromKozw } from "@/lib/kozw-env-sync";
import {
  createSupabaseRouteClient,
} from "@/lib/supabase/server";
import { auditMutation } from "@/lib/audit-log";

async function resolveUserId(request: NextRequest): Promise<string | null> {
  try {
    const throwaway = NextResponse.next();
    const supabase = createSupabaseRouteClient(request, throwaway);
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const spec = findProvider(provider);
  if (!spec) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}` },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    value?: unknown;
    migrate?: unknown;
  };

  // ── Migrate flow ───────────────────────────────────────────────────
  // Em vez do operador colar a chave de novo, lemos o valor atual do
  // container kozw e gravamos no Supabase. Útil pra trazer chaves
  // pré-existentes (no .env desde antes do painel) pro painel.
  if (body.migrate === true) {
    const existing = await readEnvFromKozw(spec.envName);
    if (!existing) {
      return NextResponse.json(
        {
          error: "Não há chave no container pra migrar",
          detail: `${spec.envName} não está definida em ${"openclaw-kozw-openclaw-1"}.`,
        },
        { status: 404 },
      );
    }
    if (!spec.keyRegex.test(existing)) {
      return NextResponse.json(
        {
          error: "A chave existente no container não tem o formato esperado",
          detail: "Recusando migrar — provavelmente corrupted ou em formato antigo. Use PUT com value pra sobrescrever.",
        },
        { status: 422 },
      );
    }
    const userId = await resolveUserId(request);
    await upsertProviderKey({
      providerId: spec.id,
      envName: spec.envName,
      value: existing,
      updatedBy: userId,
    });
    await auditMutation(request, {
      action: "provider.migrate",
      target: spec.id,
      ok: true,
    });
    // Não precisa rewrite do .env / restart — o valor já está lá.
    return NextResponse.json({ success: true, migrated: true });
  }

  // ── Set flow ───────────────────────────────────────────────────────
  if (typeof body.value !== "string" || body.value.length === 0) {
    return NextResponse.json(
      { error: "Body precisa conter `value` (string não vazia)" },
      { status: 400 },
    );
  }
  const value = body.value.trim();
  if (!spec.keyRegex.test(value)) {
    return NextResponse.json(
      {
        error: "Formato da chave inválido",
        detail: `Esperado: ${spec.keyRegex.source}`,
      },
      { status: 400 },
    );
  }

  try {
    const userId = await resolveUserId(request);
    await upsertProviderKey({
      providerId: spec.id,
      envName: spec.envName,
      value,
      updatedBy: userId,
    });
    const syncResult = await applyEnvToKozw(spec.envName, value);
    await auditMutation(request, {
      action: "provider.set",
      target: spec.id,
      ok: true,
      meta: { restarted: syncResult.restarted },
    });
    return NextResponse.json({
      success: true,
      restarted: syncResult.restarted,
    });
  } catch (err) {
    await auditMutation(request, {
      action: "provider.set",
      target: spec.id,
      ok: false,
    });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao gravar/sincronizar chave", detail: message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const spec = findProvider(provider);
  if (!spec) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}` },
      { status: 404 },
    );
  }

  try {
    await deleteProviderKeyRow(spec.id);
    const syncResult = await applyEnvToKozw(spec.envName, null);
    await auditMutation(request, {
      action: "provider.delete",
      target: spec.id,
      ok: true,
      meta: { restarted: syncResult.restarted },
    });
    return NextResponse.json({
      success: true,
      restarted: syncResult.restarted,
    });
  } catch (err) {
    await auditMutation(request, {
      action: "provider.delete",
      target: spec.id,
      ok: false,
    });
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Falha ao remover chave", detail: message },
      { status: 500 },
    );
  }
}
