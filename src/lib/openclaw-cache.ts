/**
 * Single-flight cache pro openclaw CLI.
 *
 * Problema observado em produção (2026-05-15): a página /settings faz
 * `Promise.all` em 4-6 endpoints, cada um spawnando `docker exec
 * openclaw-kozw-openclaw-1 openclaw <subcmd>`. Cada invocação carrega o
 * runtime do openclaw inteiro dentro do kozw (~300 MB + CPU pesado pra
 * inicializar plugins/skills). 4 chamadas concorrentes = ~1.2 GB de
 * pressão de memória + CPU em 100% por dezenas de segundos.
 *
 * Cache simples por TTL não resolve: se 4 requisições chegam dentro do
 * mesmo TTL ANTES da primeira terminar, todas viram cache miss e
 * spawnam 4 execs paralelos. Stampede clássica.
 *
 * Solução: **single-flight + TTL longo + stale-while-revalidate**.
 *
 *  - Se `now - cacheTs < ttl`: devolve cache válido (fast path).
 *  - Se há uma Promise em voo pra essa key: aguarda ela.
 *  - Se há cache stale (entre ttl e maxAge): devolve stale + dispara
 *    refresh em background (não bloqueia o caller).
 *  - Caso contrário: spawna, guarda a Promise, espera, popula cache.
 *
 * Use uma instância por endpoint (ou key lógica) — cada key tem cache
 * próprio.
 */

interface CacheEntry<T> {
  ts: number;
  value: T;
}

interface CacheOptions {
  /** Tempo em ms enquanto o cache é considerado fresh. */
  ttlMs: number;
  /**
   * Tempo total em ms até considerar o cache totalmente expired.
   * Entre ttlMs e maxAgeMs, o cache é "stale" — retornado imediato
   * mas dispara um refresh em background. Default = ttlMs (sem SWR).
   */
  maxAgeMs?: number;
}

export class SingleFlightCache<T> {
  private cache: CacheEntry<T> | null = null;
  private inFlight: Promise<T> | null = null;
  private refreshing = false;

  constructor(private readonly options: CacheOptions) {
    if (options.ttlMs <= 0) {
      throw new Error("ttlMs must be > 0");
    }
  }

  /**
   * Lê do cache (com single-flight). `loader` só é chamado se necessário.
   */
  async get(loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const ttl = this.options.ttlMs;
    const maxAge = this.options.maxAgeMs ?? ttl;

    // Cache fresh — fast path.
    if (this.cache && now - this.cache.ts < ttl) {
      return this.cache.value;
    }

    // Cache stale but within maxAge — retorna stale + refresh background.
    if (this.cache && now - this.cache.ts < maxAge) {
      this.maybeRefreshInBackground(loader);
      return this.cache.value;
    }

    // Cache expired ou ausente — precisa esperar.
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runLoader(loader);
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async runLoader(loader: () => Promise<T>): Promise<T> {
    const value = await loader();
    this.cache = { ts: Date.now(), value };
    return value;
  }

  private maybeRefreshInBackground(loader: () => Promise<T>): void {
    if (this.refreshing || this.inFlight) return;
    this.refreshing = true;
    void (async () => {
      try {
        const value = await loader();
        this.cache = { ts: Date.now(), value };
      } catch {
        // Refresh em background pode falhar silenciosamente. O stale
        // cache continua válido até maxAge expirar; depois disso o
        // próximo caller pega o erro de loader() diretamente.
      } finally {
        this.refreshing = false;
      }
    })();
  }

  /** Limpa o cache. Útil pra forçar refresh após mutation. */
  invalidate(): void {
    this.cache = null;
  }
}
