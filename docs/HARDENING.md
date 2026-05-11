# Hardening Plan — Mission Control fork (GUIO)

> Este documento descreve as mudanças aplicadas na branch `hardening/v1`
> do fork `guiomkt/mission-control` (originado de `carlosazaustre/tenacitOS`).
> Baseado no PRD `docs/2026-05-11-mission-control-prd.md` do workspace OpenClaw.

## Princípio

O Mission Control deve ser um **cliente de observabilidade do OpenClaw**,
não um "super-admin do host". Toda capacidade que permita execução
arbitrária de shell, leitura/escrita ampla de filesystem ou controle de
serviços do host é removida ou estritamente restringida via allowlist.

## Escopo da Fase 1 (este branch)

### Endpoints removidos (perigo crítico — R1/R2)

| Endpoint | Motivo |
|---|---|
| `POST /api/terminal` | Execução arbitrária de shell no browser |
| `GET /api/browse` | Listagem genérica de filesystem |
| `GET /api/git`, `POST /api/git` | Operações git arbitrárias |
| `* /api/system/services` | `systemctl`/`docker`/`pm2` genéricos |
| `* /api/office` | Funcionalidade 3D fora do escopo V1 |
| `GET /api/weather` | Não é parte do produto |

### Páginas dashboard removidas

- `src/app/(dashboard)/terminal/` — UI do terminal web
- `src/app/(dashboard)/office/` — Office 3D
- `src/app/(dashboard)/git/` — UI de operações git

### File APIs restringidas (V1 = read-only)

| Endpoint | Antes | Depois |
|---|---|---|
| `GET /api/files` | livre | allowlist de prefixos |
| `GET /api/files/download` | livre | allowlist + bloqueio de path traversal |
| `GET /api/files/workspaces` | livre | só workspaces declarados em env |
| `POST /api/files/write` | livre | **removido** |
| `POST /api/files/upload` | livre | **removido** |
| `DELETE /api/files/delete` | livre | **removido** |
| `POST /api/files/mkdir` | livre | **removido** |

### Media wildcard

`GET /api/media/[...path]` mantido mas com:
- normalização do path antes de acessar
- rejeição de `..` e symlinks
- match obrigatório contra `ALLOWED_MEDIA_PREFIXES` de `lib/paths.ts`

### Autenticação (R5)

| Item | Antes | Depois |
|---|---|---|
| Sessão | `cookie.value === AUTH_SECRET` (shared secret) | JWT assinado com `SESSION_SECRET`, payload `{ sub, iat, exp }` |
| Rate limit | já presente (5/15min) | mantido + log de tentativas falhas |
| Logout | cookie delete | cookie delete + lista de jti revogados (in-memory) |
| Headers | já httpOnly+Secure+SameSite | mantido |
| Camada perímetro | nenhuma | Cloudflare Access (configurado fora do app) |

### Markdown sanitization (R4)

`MarkdownPreview.tsx` e `RichDescription.tsx` recebem `rehypePlugins: [rehypeSanitize]`
para neutralizar `<script>`, `on*=`, `javascript:` URLs e iframes.

### Security headers (R4/genéricos)

Adicionados em `next.config.mjs`:
- `Content-Security-Policy` restritivo (sem `unsafe-eval`; `unsafe-inline` só em styles)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Audit log

Toda mutação relevante (login, cron run, file ops futuras) escreve em
`data/audit.log` no formato JSONL com `{ ts, ip, user, action, target, ok }`.

### Paths

`OPENCLAW_DIR` default mudado de `/root/.openclaw` → `/workspace` (volume
read-only montado em container). Os defaults antigos só funcionavam com
o app rodando como root no host — incompatível com nosso modelo de
deploy (container isolado).

## Deps removidas

- `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`, `three`,
  `@types/three` — Office 3D fora do escopo.

## Variáveis de ambiente (`.env.example`)

Adicionadas:
- `SESSION_SECRET` — chave de assinatura JWT (mínimo 32 chars).
- `OPENCLAW_GATEWAY_URL` — URL do gateway OpenClaw (Fase 2).
- `OPENCLAW_GATEWAY_TOKEN` — token de acesso (Fase 2).
- `WORKSPACE_ALLOWLIST` — paths permitidos para leitura, separados por `:`.
- `AUDIT_LOG_PATH` — destino do audit log (default `./data/audit.log`).

Mantidas:
- `ADMIN_PASSWORD` — senha de login do operador.
- `AUTH_SECRET` — **descontinuada na V1** (substituída por `SESSION_SECRET`).

## Fora desta Fase

- Fase 2: trocar leitura local de arquivos por chamadas ao gateway OpenClaw.
- Fase 3: Dockerfile + docker-compose + deploy em VPS.
- Fase 4: Cloudflare Access policies, audit centralizado, runbook.

## Critérios de aceite (deste branch)

- [ ] `npm run build` passa
- [ ] `npm run lint` passa sem warnings novos
- [ ] Nenhum endpoint listado em "removidos" responde 200
- [ ] Login com senha errada bloqueia após 5 tentativas
- [ ] Cookie de sessão é JWT (3 segmentos `.`), não literal de `AUTH_SECRET`
- [ ] `curl /api/files?path=/etc/passwd` retorna 403
- [ ] Header de resposta inclui `Content-Security-Policy`
- [ ] `MarkdownPreview` com `<script>alert(1)</script>` não executa script
