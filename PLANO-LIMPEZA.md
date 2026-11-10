# Plano — limpeza de codebase (chore/cleanup)

Base: `dev`. Já existem 2 commits + working tree sujo (~50 arquivos). Objetivo: sem mudar comportamento.

## Baseline medido (antes de qualquer edição)

| Verificação | Estado |
|---|---|
| `bun run typecheck` | **Falha** — `src/utils/config.ts(3,10)` importa `DEFAULT_CLEANUP_RETRY`, declarado em `src/session/store.ts:47` sem `export` (TS2459). |
| `bun run test` | **17 falhas / 45 arquivos** — todas com a mesma causa: `TypeError: undefined is not an object (DEFAULT_CLEANUP_RETRY.maxAttempts)` em `loadConfig`. |
| `bun run typecheck:web` | OK. |
| `bun run test:web` | **1 falha** — `web/src/test/lib/admin-router.test.ts:38` `fitGranularity` espera `week`, recebe `day` (golden de 2026-11-10 passou a ser dinâmico; `yearsAgo(4)` ≈ 1461 dias não estoura 400 buckets em dias). |
| `bun run build:web` (usado no Docker stage 1) | OK — `UiShowcase` não entra no bundle. |

Toda tarefa abaixo parte desse baseline. Critério de sucesso final: typecheck back+web OK, suíte back e web 100% verde, `docker build` OK.

## Distribuição (sem sobreposição de arquivos)

- **A — backend src** (worktree isolado): T1, T2
- **B — backend testes** (worktree isolado): T3, T4
- **C — frontend+docker** (worktree isolado): T5, T6
- **D — correção pós-review** (branch): T7

Worktrees isolados porque A/B/C tocam lint e suíte globais; checkout compartilhado mudaria o diretório um do outro. O merge dos worktrees é linear e local (sem push).

---

## T1 — backend: desbloquear build + limpezas mecânicas

Arquivos:
- `src/session/store.ts`
- `src/utils/config.ts`
- `src/controllers/download.ts`

Mudanças:
1. `export` em `DEFAULT_CLEANUP_RETRY` (store.ts:47). Corrige TS2459 e as 17 falhas. Sem ciclo: nenhum módulo de `src/session/` importa `utils/config`.
2. `config.ts`: corrigir o comentário que diz "re-exported by shared/admin/format" — `DEFAULT_TZ` não é re-exportado (verificar antes de remover a linha).
3. `download.ts`: remover chave `".png"` duplicada no literal de MIME (a segunda vence, valor idêntico).
4. `download.ts`: remover condição morta `ext !== ".svg"` (não existe `.svg` em `INLINE_EXTENSIONS`). **Não** trocar o `Content-Disposition` manual por `rfc5987()` (bytes de header mudam).

Fora de escopo (documentado): extrair `recordPairingRefused`, `extractBearerToken`, `usePoll`, `onTransientFailure` — puro churn, risco de regressão sem ganho.

Verificação: `bun run typecheck`, `bun run lint`, `bun run test`, commit `refactor(backend): exporta defaults de retry e remove condição morta`.

### Status
DONE — commit `ed8f609`; retomado e verificado no worktree `wt-a-backend-src`, commit final `4f0f6d5`. Aplicado: `export` em `DEFAULT_CLEANUP_RETRY`; `DEFAULT_TZ` tem só um comentário curto e correto (grep em `src/`, `tests/`, `web/src`: nenhum import de `DEFAULT_TZ` de `utils/config` e nenhum `DEFAULT_ADMIN_TZ`; `shared/admin/format.ts` declara o próprio e `admin.ts` importa de lá); condição morta `&& ext !== ".svg"` removida (`INLINE_EXTENSIONS` não tem `.svg`).
**Pulado:** chave `".png"` duplicada — só existe uma ocorrência em `INLINE_EXTENSIONS`; nada a remover. `Content-Disposition` intacto (não trocado por `rfc5987()`).
Verificação (`PUBLIC_BASE_URL=http://localhost:3000`): typecheck OK; lint com os mesmos 23 erros pré-existentes (`no-empty`/`no-explicit-any`, todos fora do escopo); testes 288 passam, mesmas 3 falhas ambientais (`static.test.ts` sem `web/dist`, `db-boot-resilience` depende de Postgres/timing). Sem `PUBLIC_BASE_URL`, 14 falham por `Missing required environment variable` (idem baseline).

## T2 — backend: código morto confirmado

Arquivos:
- `src/utils/events.ts`
- `src/services/session-service.ts`
- `src/session/store.ts`

Mudanças:
1. Remover `emitSessionClosed` de `events.ts` e a chamada em `store.ts` (nenhum handler para `"session:closed"`; duplica o close do WS).
2. Remover `clearAllTimers()` e `shutdown()` de `SessionService` se grep confirmar zero callers em `src/` e `tests/` (`app.ts` chama `sessionStore.shutdown()`).
3. Remover cast-resto de `utils/logger.ts` em `store.ts` (logger fallback `undefined as unknown as FastifyBaseLogger`) se o app sempre passa logger — ajustar tipo da opção.

**Não** deletar `src/repositories/session-repository.ts` (é "code smell de teste": só o teste usa; fica para T4).

Verificação: `bun run typecheck`, `bun run lint`, `bun run test`, commit `refactor(backend): remove emissor de evento sem listener e métodos sem callers`.

### Status
DONE — commit `e285b5e`. Removidos: `emitSessionClosed` + a chamada em `closeSession` (com o import agora órfão de `fileEvents`); `SessionService.close()`, `.shutdown()` e `.clearAllTimers()` — grep em `src/`, `tests/`, `scripts/` dá zero callers. `SessionStore.shutdown()`/`tick()` mantidos (`app.ts` e testes usam).
**Pulado:** item 3 (logger fallback em `store.ts:76`). `tests/session-simplified.test.ts` e `tests/session-presence-initial.test.ts` constroem `new SessionStore({ clock, tempDir })` sem `logger`; tornar a opção obrigatória obrigaria a editar testes fora do escopo. Os caminhos `this.log` (`closeSession` com recorder, `removeSessionDir`) não são atingidos nesses testes, então o fallback segue inofensivo. Deixado como está.
Verificação: typecheck OK; lint e testes iguais ao T1 (23 erros de lint pré-existentes; 288 passam, as mesmas 3 falhas ambientais).

### Status
PARTIAL — commit `e285b5e`; complementado no worktree `wt-a-backend-src`, commit final `4f0f6d5`. Feito: `emitSessionClosed` removido de `events.ts` (grep de `"session:closed"` em `src/`, `tests/`, `web/` = zero listeners; `session_closed` restante é mensagem WS e tipo de recording, não este evento) e a chamada em `closeSession`; `SessionService.close()`, `shutdown()` e `clearAllTimers()` removidos (zero callers em `src/`, `tests/`, `scripts/`); `tick()` mantido (chamado por `store.startSweeper` e por testes).
**Pulado:** item 3 (logger fallback `undefined as unknown as FastifyBaseLogger`). `tests/session-simplified.test.ts` e `tests/session-presence-initial.test.ts` constroem `SessionStore` sem `logger`; tornar `logger` obrigatório editaria arquivos de teste fora do escopo. Os usos de `this.log` não são atingidos nesses testes.
Verificação: igual ao T1 (typecheck OK, 23 erros de lint pré-existentes, 288 passam / 3 falhas ambientais).

## T3 — testes backend: alinhar `pairing-domain` ao `SessionStore`

Arquivos:
- `tests/pairing-domain.test.ts`

Mudanças:
- Trocar `SessionRepository` (órfão) por `SessionStore` mantendo os 5 casos de `getByShortId` (hit, miss, repo vazio, múltiplas sessões, pós-delete).
- Remover `src/repositories/session-repository.ts` no mesmo commit (sem imports restantes — grep em `src/`, `tests/`, `scripts/`).

Verificação: `bun run typecheck`, `bun --bun vitest run tests/pairing-domain.test.ts`, commit `test(pairing): usa SessionStore e remove repositório órfão`.

## T4 — testes backend: remover/rastreio

Arquivos (só estes):
- `tests/session-pairing.test.ts`
- `tests/session-auth.test.ts`
- `tests/visual-id.test.ts`
- `tests/recording-normalize.test.ts`
- `tests/recording-queue.test.ts`
- `tests/admin-filters.test.ts`
- `tests/exclusive-pairing-part2.test.ts`

Mudanças:
1. **Restaurar** em `session-pairing.test.ts` o caso "QR continua válido em sessão PAIRED e DISCONNECTED" — contrato de QR reutilizável (reconexão), único teste explícito; mantê-lo.
2. **Remover** testes de forma de gerador/estrutura: `hashToken`/`generateQrToken` shape (session-pairing), `generateSecret >= 40` (session-auth), charset/length/uniqueness de `visualId` mantendo colisão/throw (visual-id), 3 dos 5 `normalizeIp` mantendo `::ffff:`+null (recording-normalize), `recording-queue.test.ts` inteiro se for só FIFO/mock de fila (confirmar que `recording-postgres-recorder` cobre drain).
3. **Fundir** no arquivo que já cobre: testes de filtro/tabela de constantes em `admin-filters` → manter 1 caso por filtro real; `exclusive-pairing-part2` "logs não contêm credenciais" (duplicado por `log-redaction`).

Mantidos por critério: pareamento, sessão, reconexão, upload, ZIP, segurança (inline HTML/SVG/JS, path traversal).

Verificação: `bun run test`, commit `test(backend): remove testes de forma e restaura contrato de QR reutilizável`.

## T5 — frontend: remover re-declaração de `__BASE_URL__`

Arquivos:
- `web/src/pages/phone/PhonePage.tsx`
- `web/src/pages/computer/ComputerPage.tsx`
- `web/src/pages/computer/SessionCard.tsx`
- `web/src/test/lib/admin-router.test.ts`

Mudanças:
1. `PhonePage`/`ComputerPage`: importar `BASE_URL` de `../../lib/base.ts` em vez de `declare const __BASE_URL__` local. `ComputerPage` preserva o fallback `|| window.location.origin`.
2. `SessionCard.tsx:69-70`: inlinar os aliases `files`/`connected` (resto dos props removidos, `externalFiles`/`externalConnected`).
3. `admin-router.test.ts`: corrigir o golden — golden temporal dinâmico. Usar `from = "2026-10-12", to = "2026-11-10"` fixos, ou derivar o intervalo do próprio `spanDays`. Preferir datas fixas: o teste é de granularidade, não de "hoje".
4. `git add web/src/lib/base.ts` (está untracked; sem isso o build limpo quebra).

Verificação: `bun run typecheck:web`, `bun run test:web`, commit `refactor(web): centraliza BASE_URL e corrige golden de granularidade`.

## T6 — Docker (um commit)

Arquivos:
- `.dockerignore` (novo, se ausente)

Contexto: o stage 1 copia `web/` inteiro, então imagens locais verdes podem vir de `node_modules`/`dist` do host. Um `.dockerignore` mínimo (`node_modules`, `web/node_modules`, `web/dist`, `tmp`, `spike`, `.git`) torna o build reprodutível. Não altera runtime.

Verificação: `docker build .` (Fase 4 confirma de novo).

---

## Fase 4 — revisão

Subagent revisor sem contexto, recebe `git diff dev...HEAD` de cada branch de tarefa e aponta: mudança de comportamento, teste de contrato removido, import quebrado. Correções em T7 (branch `chore/cleanup`, commit `fix`). Depois: suíte completa back+web, `typecheck`, `lint`, `docker build`. Sem merge para `dev`/`main`; aviso ao terminar.

## Riscos

- T2: remover `clearAllTimers`/`shutdown` exige grep de callers — se um teste usa, vira KEEP.
- T5: `ComputerPage` sem fallback ficaria quebrado em dev; o import mantém fallback.
- T4: nenhuma remoção de teste cobre upload de arquivo único, ZIP ou autorização — esses ficam intactos.
