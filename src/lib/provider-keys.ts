/**
 * Abstração da tabela `provider_keys` + lista canônica de provedores LLM
 * que o painel sabe gerenciar.
 *
 * Convenções:
 *  - `id` é o slug usado nas URLs (/api/openclaw/providers/<id>).
 *  - `envName` é o nome da var no .env do gateway kozw.
 *  - `keyRegex` é um sanity check leve — captura paste com espaço, chave
 *    vazia, ou paste do nome em vez do valor. Não valida autenticidade.
 *
 * Storage: a coluna `value_encrypted` armazena base64 da chave. Sim, base64
 * não é encryption — é só pra evitar exposição casual em logs de query /
 * dumps SQL. Pra encryption real precisaríamos de pgsodium + KMS, e o
 * trade-off de complexidade não compensa pra esse setup single-operator.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface ProviderSpec {
  id: string;
  envName: string;
  label: string;
  keyRegex: RegExp;
  helpUrl?: string;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "openai",
    envName: "OPENAI_API_KEY",
    label: "OpenAI",
    keyRegex: /^sk-[A-Za-z0-9_-]{20,}$/,
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    envName: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    keyRegex: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    envName: "GEMINI_API_KEY",
    label: "Google Gemini",
    keyRegex: /^[A-Za-z0-9_-]{30,}$/,
    helpUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "deepseek",
    envName: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
    keyRegex: /^sk-[A-Za-z0-9_-]{20,}$/,
    helpUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "moonshot",
    envName: "MOONSHOT_API_KEY",
    label: "Moonshot (Kimi)",
    keyRegex: /^sk-[A-Za-z0-9_-]{20,}$/,
    helpUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "perplexity",
    envName: "PERPLEXITY_API_KEY",
    label: "Perplexity",
    keyRegex: /^pplx-[A-Za-z0-9_-]{20,}$/,
    helpUrl: "https://www.perplexity.ai/settings/api",
  },
];

export function findProvider(id: string): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// ── Storage helpers ─────────────────────────────────────────────────────

export interface ProviderKeyRecord {
  provider: string;
  env_name: string;
  last_four: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ProviderKeyRecordWithValue extends ProviderKeyRecord {
  /** Base64-decoded plain value. Never log this; never send to the client. */
  value: string;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function decode(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf8");
}

export function lastFour(value: string): string {
  if (value.length <= 4) return value;
  return value.slice(-4);
}

/**
 * Lista todos os providers do painel: combinação da lista canônica + status
 * de cada um (configured? quando? por quem? últimos 4 chars).
 */
export async function listProviderKeys(): Promise<ProviderKeyRecord[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("provider_keys")
    .select("provider, env_name, last_four, updated_at, updated_by");
  if (error) throw new Error(`provider_keys select failed: ${error.message}`);
  return (data ?? []) as ProviderKeyRecord[];
}

/**
 * Recupera o valor plain de uma chave. Use só dentro do server — nunca
 * expõe via API. Retorna null se não estiver configurada.
 */
export async function getProviderKeyValue(
  providerId: string,
): Promise<ProviderKeyRecordWithValue | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("provider_keys")
    .select("provider, env_name, value_encrypted, last_four, updated_at, updated_by")
    .eq("provider", providerId)
    .maybeSingle();
  if (error) throw new Error(`provider_keys read failed: ${error.message}`);
  if (!data) return null;
  return {
    provider: data.provider,
    env_name: data.env_name,
    last_four: data.last_four,
    updated_at: data.updated_at,
    updated_by: data.updated_by,
    value: decode(data.value_encrypted as string),
  };
}

/**
 * Upsert da chave. `updatedBy` é o uuid do usuário Supabase (opcional —
 * deixa null se não conseguimos resolver).
 */
export async function upsertProviderKey(params: {
  providerId: string;
  envName: string;
  value: string;
  updatedBy: string | null;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("provider_keys").upsert(
    {
      provider: params.providerId,
      env_name: params.envName,
      value_encrypted: encode(params.value),
      last_four: lastFour(params.value),
      updated_by: params.updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  if (error) throw new Error(`provider_keys upsert failed: ${error.message}`);
}

export async function deleteProviderKeyRow(providerId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("provider_keys")
    .delete()
    .eq("provider", providerId);
  if (error) throw new Error(`provider_keys delete failed: ${error.message}`);
}
