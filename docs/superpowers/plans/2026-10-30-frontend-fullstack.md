# Frontend + Smoke + Docker + README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar interface React completa (telas computador e telefone), teste de fumaça, Docker e README ao backend existente.

**Architecture:** Front-end React/Vite/Tailwind em `web/`, servido estaticamente por `@fastify/static` do Fastify. Tela computador em `/` (sessões + arquivos + QR Code), tela telefone em `/enviar/:id`. Lógica de estado via reducer puro + WebSocket hook com reconexão exponencial. Smoke test é script Bun que sobe servidor em porta aleatória, executa fluxo real e verifica hashes. Docker multi-stage com oven/bun.

**Tech Stack:** React 19, TypeScript strict, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`), lucide-react, qrcode.react, @fontsource-variable/inter, Vitest + @testing-library/react, @fastify/static, fflate (já existe), oven/bun Docker.

**Spec:** Prompt do usuário (inline na conversa)

## Global Constraints

- Bun 1.4.4 (`.bun-version` obrigatório)
- TypeScript 5.8, strict, sem `any` implícito
- React versão estável atual (19.x)
- Vite 6.x; plugin `@tailwindcss/vite` (Tailwind v4 — sem `tailwind.config.js`)
- Sem outra lib de UI, estado ou animação além das listadas
- Fonte Inter empacotada via `@fontsource-variable/inter` — proibido CDN
- `web/dist` gerado por `bun run build:web` → servido pelo Fastify
- `PUBLIC_BASE_URL` obrigatório; QR Code usa `uploadToken` como token
- Download individual e ZIP via link `<a href>` com `?token=` — sem fetch agent local
- Sem Playwright, sem navegador automatizado
- Testes: Vitest + Testing Library (jsdom)
- Alvos de toque ≥ 44 px; prefers-reduced-motion respeitado; dvh em vez de vh
- Contraste WCAG AA; foco visível com anel 2 px índigo
- Claro: fundo `#FAFAFA`, superfícies brancas. Escuro: zinc-950/900/800
- Acento único: índigo. Verde/âmbar/vermelho só em indicadores de estado
- QR Code sempre sobre fundo branco com zona de silêncio (mesmo no dark mode)
- Smoke test: `bun run smoke` — porta aleatória, fluxo real, comparação de hash, saída OK/FALHOU
- Docker: multi-stage oven/bun, usuário não-root, healthcheck `/health`, tmpfs para TEMP_DIR

## Review Focus

1. **Token de upload no QR Code**: a URL do QR Code deve conter `uploadToken`, não `ownerToken` — revisar formação da URL em `useSession`
2. **WebSocket close code 4000**: ao receber code 4000, UI deve mostrar "sessão encerrada" e parar de reconectar
3. **pagehide + sendBeacon**: deve chamar `DELETE /api/sessions/:id` via `navigator.sendBeacon` com header `Authorization` impossível — usar body com token em vez de header (sendBeacon não suporta headers customizados); alternativa: heartbeat periódico com cleanup no timeout
4. **Upload XMLHttpRequest no Android**: usar `xhr.upload.onprogress` com `FormData` — não `fetch` — para progresso real; confirmar que o campo `files[]` é aceito pelo backend
5. **Modo offline / reconexão**: WebSocket deve usar backoff exponencial (1s→2s→4s→8s→max 30s), StatusDot cinza quando desconectado, sem flood de reconexão

---

## Task 1: Scaffold web/ — Vite + React + TypeScript + Tailwind v4 + Fonte

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx` (placeholder)
- Create: `web/src/styles/globals.css` (tokens Tailwind + imports fonte)
- Modify: `package.json` (scripts `dev:web`, `build:web`, `typecheck:web`)
- Create: `.bun-version`

**Interfaces:**
- Produces: `VITE_PUBLIC_BASE_URL` env var consumida por tasks subsequentes

- [ ] **Step 1: Criar `web/package.json`** com deps fixas:
  ```json
  {
    "name": "does-not-send-web",
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "bunx --bun vite",
      "build": "bunx --bun vite build",
      "preview": "bunx --bun vite preview",
      "test": "bunx --bun vitest run",
      "test:watch": "bunx --bun vitest",
      "typecheck": "tsc --noEmit"
    },
    "dependencies": {
      "@fontsource-variable/inter": "5.2.5",
      "lucide-react": "0.511.0",
      "qrcode.react": "4.2.0",
      "react": "19.1.0",
      "react-dom": "19.1.0"
    },
    "devDependencies": {
      "@tailwindcss/vite": "4.1.8",
      "@testing-library/jest-dom": "6.6.3",
      "@testing-library/react": "16.3.0",
      "@testing-library/user-event": "14.6.1",
      "@types/react": "19.1.6",
      "@types/react-dom": "19.1.6",
      "@vitejs/plugin-react": "4.5.2",
      "jsdom": "26.1.0",
      "tailwindcss": "4.1.8",
      "typescript": "5.8.3",
      "vite": "6.3.5",
      "vitest": "3.2.4"
    }
  }
  ```

- [ ] **Step 2: Criar `web/tsconfig.json`** com `"strict": true`, `"jsx": "react-jsx"`, `"moduleResolution": "bundler"`, `"target": "ES2022"`, paths para `src/`

- [ ] **Step 3: Criar `web/vite.config.ts`**:
  - plugin `@vitejs/plugin-react`
  - plugin `tailwindcss()` de `@tailwindcss/vite`
  - `build.outDir`: `dist`
  - `test.environment`: `jsdom`
  - `test.setupFiles`: `src/test/setup.ts`
  - `define`: `{ __BASE_URL__: JSON.stringify(process.env.VITE_PUBLIC_BASE_URL ?? '') }`

- [ ] **Step 4: Criar `web/src/styles/globals.css`**:
  ```css
  @import "@fontsource-variable/inter";
  @import "tailwindcss";

  @theme {
    --color-surface: #ffffff;
    --color-bg: #fafafa;
    --color-border: #e4e4e7; /* zinc-200 */
    --color-accent: #6366f1; /* indigo-500 */
    --color-accent-hover: #4f46e5; /* indigo-600 */
    --color-text: #18181b; /* zinc-900 */
    --color-text-muted: #71717a; /* zinc-500 */
    --color-success: #22c55e; /* green-500 */
    --color-warn: #f59e0b; /* amber-500 */
    --color-error: #ef4444; /* red-500 */
    --font-sans: "Inter Variable", sans-serif;
  }

  @media (prefers-color-scheme: dark) {
    @theme {
      --color-surface: #18181b; /* zinc-900 */
      --color-bg: #09090b; /* zinc-950 */
      --color-border: #27272a; /* zinc-800 */
      --color-text: #fafafa; /* zinc-50 */
      --color-text-muted: #a1a1aa; /* zinc-400 */
    }
  }

  *, *::before, *::after { box-sizing: border-box; }
  html { font-family: var(--font-sans); background: var(--color-bg); color: var(--color-text); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
  ```

- [ ] **Step 5: Criar `web/index.html`** com `<div id="root">` e script `src/main.tsx`

- [ ] **Step 6: Criar `web/src/main.tsx`** — monta `<App />` em `#root`

- [ ] **Step 7: Criar `web/src/App.tsx`** placeholder — `export default function App() { return <div>ok</div> }`

- [ ] **Step 8: Criar `web/src/test/setup.ts`** — `import '@testing-library/jest-dom'`

- [ ] **Step 9: Adicionar scripts ao `package.json` raiz**:
  ```json
  "dev:web": "cd web && bun run dev",
  "build:web": "cd web && bun run build",
  "typecheck:web": "cd web && bun run typecheck"
  ```

- [ ] **Step 10: Criar `.bun-version`** com conteúdo `1.4.4`

- [ ] **Step 11: Instalar deps e confirmar build**
  ```bash
  cd web && bun install && bun run build
  ```
  Esperado: `dist/` criado sem erros.

- [ ] **Step 12: Commit**
  ```bash
  git add web/ .bun-version package.json
  git commit -m "feat(web): scaffold Vite + React + Tailwind v4 + Inter"
  ```

---

## Task 2: Componentes UI base

**Files:**
- Create: `web/src/components/ui/Button.tsx`
- Create: `web/src/components/ui/Card.tsx`
- Create: `web/src/components/ui/ProgressBar.tsx`
- Create: `web/src/components/ui/Badge.tsx`
- Create: `web/src/components/ui/StatusDot.tsx`
- Create: `web/src/components/ui/EmptyState.tsx`
- Create: `web/src/components/ui/Modal.tsx`
- Create: `web/src/components/ui/Toast.tsx`
- Create: `web/src/components/ui/index.ts`
- Create: `web/src/pages/dev/UiShowcase.tsx` (só em dev)
- Create: `web/src/test/components/ui.test.tsx`

**Interfaces:**
- Produces:
  - `Button({ variant: 'primary'|'ghost'|'danger', size?: 'sm'|'md', children, ...props })`
  - `Card({ children, className? })`
  - `ProgressBar({ value: number, max: number, className? })` — valor 0-1
  - `Badge({ label: string, variant: 'neutral'|'success'|'warn'|'error' })`
  - `StatusDot({ connected: boolean })` — pulsa se connected
  - `EmptyState({ icon: LucideIcon, title: string, description: string })`
  - `Modal({ open: boolean, onClose: () => void, title: string, children })`
  - `Toast({ message: string, type: 'error'|'info', onDismiss: () => void })`

- [ ] **Step 1: Escrever teste de fumaça de renderização** em `web/src/test/components/ui.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import { Button, Card, ProgressBar, Badge, StatusDot, EmptyState } from '../../components/ui'
  import { Upload } from 'lucide-react'

  it('Button renderiza children', () => {
    render(<Button variant="primary">Enviar</Button>)
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument()
  })

  it('ProgressBar renderiza role progressbar', () => {
    render(<ProgressBar value={0.5} max={1} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('Badge renderiza label', () => {
    render(<Badge label="Concluído" variant="success" />)
    expect(screen.getByText('Concluído')).toBeInTheDocument()
  })

  it('StatusDot renderiza com aria-label', () => {
    render(<StatusDot connected={true} />)
    expect(screen.getByLabelText(/conectado/i)).toBeInTheDocument()
  })

  it('EmptyState renderiza title e description', () => {
    render(<EmptyState icon={Upload} title="Nenhum arquivo" description="Aguardando envio" />)
    expect(screen.getByText('Nenhum arquivo')).toBeInTheDocument()
    expect(screen.getByText('Aguardando envio')).toBeInTheDocument()
  })
  ```

- [ ] **Step 2: Rodar teste — confirmar FAIL**
  ```bash
  cd web && bun test src/test/components/ui.test.tsx
  ```

- [ ] **Step 3: Implementar componentes** seguindo as assinaturas acima. Guias de estilo:
  - `Button primary`: `bg-[var(--color-accent)] text-white rounded-xl px-4 py-2 min-h-[44px] hover:bg-[var(--color-accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] transition-colors duration-150`
  - `Button ghost`: borda 1px, fundo transparente, mesmo anel de foco
  - `ProgressBar`: `<div role="progressbar" aria-valuenow aria-valuemin aria-valuemax>` + barra interna `h-[6px] rounded-full bg-[var(--color-accent)] transition-[width] duration-200`
  - `StatusDot`: `<span aria-label="conectado/desconectado">` + círculo 8px; se `connected`, classe `animate-pulse bg-[var(--color-success)]`; senão `bg-[var(--color-text-muted)]`
  - `Modal`: portal `ReactDOM.createPortal` em `document.body`, backdrop `bg-black/40`, conteúdo `rounded-2xl bg-[var(--color-surface)] shadow-md`, fechar com Escape; `aria-modal`, `role="dialog"`, `aria-labelledby`
  - `Toast`: fixo `bottom-4 right-4`, fade-in 150ms, auto-dismiss 4s

- [ ] **Step 4: Rodar testes — confirmar PASS**
  ```bash
  cd web && bun test src/test/components/ui.test.tsx
  ```

- [ ] **Step 5: Criar `web/src/pages/dev/UiShowcase.tsx`** — renderiza todos os estados dos componentes; só importada em `App.tsx` quando `import.meta.env.DEV`

- [ ] **Step 6: Commit**
  ```bash
  git add web/src/components/ web/src/pages/dev/ web/src/test/components/
  git commit -m "feat(web): componentes UI base (Button, Card, ProgressBar, Badge, StatusDot, EmptyState, Modal, Toast)"
  ```

---

## Task 3: Lógica pura e cliente de API (com testes)

**Files:**
- Create: `web/src/lib/format.ts` — funções puras de formatação
- Create: `web/src/lib/api.ts` — cliente tipado
- Create: `web/src/lib/sessionReducer.ts` — reducer de eventos WS
- Create: `web/src/test/lib/format.test.ts`
- Create: `web/src/test/lib/sessionReducer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // format.ts
  formatBytes(bytes: number): string  // "1,2 MB", "345 KB", "12 B"
  fileCategory(mimeType: string, fileName: string): 'image'|'video'|'audio'|'pdf'|'other'
  overallProgress(files: FileState[]): number  // 0-1
  fileStateLabel(state: FileEntry['state']): string  // "Recebendo…" | "Concluído" | "Falhou"

  // api.ts
  interface Session { id: string; ownerToken: string; uploadToken: string; createdAt: string }
  interface FileEntry {
    id: string; originalName: string; mimeType: string; size: number
    bytesReceived: number; state: 'receiving'|'completed'|'failed'; createdAt: string
  }
  createSession(): Promise<Session>
  deleteSession(id: string, token: string): Promise<void>
  heartbeat(id: string, token: string): Promise<void>
  listFiles(id: string, token: string): Promise<FileEntry[]>
  previewUrl(sessionId: string, fileId: string, token: string): string
  downloadUrl(sessionId: string, fileId: string, token: string): string
  zipUrl(sessionId: string, token: string): string

  // sessionReducer.ts
  type WsEvent =
    | { type: 'file:state-changed'; fileId: string; state: FileEntry['state']; originalName: string; size: number; bytesReceived: number }
    | { type: 'file:progress'; fileId: string; bytesReceived: number; size: number }
  type SessionState = { files: FileEntry[] }
  sessionReducer(state: SessionState, event: WsEvent): SessionState
  ```

- [ ] **Step 1: Escrever `web/src/test/lib/format.test.ts`**:
  ```ts
  import { formatBytes, fileCategory, overallProgress, fileStateLabel } from '../../lib/format'

  describe('formatBytes', () => {
    it('formata bytes', () => expect(formatBytes(500)).toBe('500 B'))
    it('formata KB', () => expect(formatBytes(1024)).toBe('1,0 KB'))
    it('formata MB', () => expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB'))
    it('formata GB', () => expect(formatBytes(2 * 1024 ** 3)).toBe('2,0 GB'))
  })

  describe('fileCategory', () => {
    it('imagem', () => expect(fileCategory('image/jpeg', 'foto.jpg')).toBe('image'))
    it('vídeo', () => expect(fileCategory('video/mp4', 'video.mp4')).toBe('video'))
    it('áudio', () => expect(fileCategory('audio/mpeg', 'song.mp3')).toBe('audio'))
    it('pdf', () => expect(fileCategory('application/pdf', 'doc.pdf')).toBe('pdf'))
    it('outro', () => expect(fileCategory('application/zip', 'arq.zip')).toBe('other'))
  })

  describe('overallProgress', () => {
    it('zero quando sem arquivos', () => expect(overallProgress([])).toBe(0))
    it('calcula progresso parcial', () => {
      const files = [
        { size: 100, bytesReceived: 50, state: 'receiving' as const },
        { size: 100, bytesReceived: 100, state: 'completed' as const }
      ] as any
      expect(overallProgress(files)).toBeCloseTo(0.75)
    })
    it('1 quando todos concluídos', () => {
      const files = [{ size: 100, bytesReceived: 100, state: 'completed' as const }] as any
      expect(overallProgress(files)).toBe(1)
    })
  })

  describe('fileStateLabel', () => {
    it('receiving', () => expect(fileStateLabel('receiving')).toBe('Recebendo…'))
    it('completed', () => expect(fileStateLabel('completed')).toBe('Concluído'))
    it('failed', () => expect(fileStateLabel('failed')).toBe('Falhou'))
  })
  ```

- [ ] **Step 2: Escrever `web/src/test/lib/sessionReducer.test.ts`**:
  ```ts
  import { sessionReducer } from '../../lib/sessionReducer'

  const empty = { files: [] }

  it('adiciona arquivo via file:state-changed', () => {
    const s = sessionReducer(empty, { type: 'file:state-changed', fileId: 'f1', state: 'receiving', originalName: 'a.jpg', size: 100, bytesReceived: 0 })
    expect(s.files).toHaveLength(1)
    expect(s.files[0]!.id).toBe('f1')
  })

  it('atualiza progresso via file:progress', () => {
    const s0 = sessionReducer(empty, { type: 'file:state-changed', fileId: 'f1', state: 'receiving', originalName: 'a.jpg', size: 100, bytesReceived: 0 })
    const s1 = sessionReducer(s0, { type: 'file:progress', fileId: 'f1', bytesReceived: 50, size: 100 })
    expect(s1.files[0]!.bytesReceived).toBe(50)
  })

  it('atualiza estado para completed', () => {
    const s0 = sessionReducer(empty, { type: 'file:state-changed', fileId: 'f1', state: 'receiving', originalName: 'a.jpg', size: 100, bytesReceived: 0 })
    const s1 = sessionReducer(s0, { type: 'file:state-changed', fileId: 'f1', state: 'completed', originalName: 'a.jpg', size: 100, bytesReceived: 100 })
    expect(s1.files[0]!.state).toBe('completed')
  })

  it('não duplica arquivo existente', () => {
    const ev = { type: 'file:state-changed' as const, fileId: 'f1', state: 'receiving' as const, originalName: 'a.jpg', size: 100, bytesReceived: 0 }
    const s = sessionReducer(sessionReducer(empty, ev), ev)
    expect(s.files).toHaveLength(1)
  })
  ```

- [ ] **Step 3: Rodar testes — confirmar FAIL**
  ```bash
  cd web && bun test src/test/lib/
  ```

- [ ] **Step 4: Implementar `web/src/lib/format.ts`** com as 4 funções acima. `formatBytes`: use `Intl.NumberFormat('pt-BR', {maximumFractionDigits:1})`. Limites: <1024→B, <1024²→KB, <1024³→MB, senão GB.

- [ ] **Step 5: Implementar `web/src/lib/api.ts`**. Base URL: `__BASE_URL__` (global injetado pelo Vite, vazio em dev aponta para `/`). `previewUrl`, `downloadUrl`, `zipUrl` retornam strings (links diretos). `createSession` faz `POST /api/sessions`. Sem auth no create; demais passam `Authorization: Bearer <token>`.

- [ ] **Step 6: Implementar `web/src/lib/sessionReducer.ts`** como reducer puro. Se evento é `file:progress` e arquivo não existe, retorna estado sem mudança. Se `file:state-changed` e `fileId` já existe, atualiza in-place. Se não existe, adiciona.

- [ ] **Step 7: Rodar testes — confirmar PASS**
  ```bash
  cd web && bun test src/test/lib/
  ```

- [ ] **Step 8: Commit**
  ```bash
  git add web/src/lib/ web/src/test/lib/
  git commit -m "feat(web): lógica pura (format, api, sessionReducer) com testes"
  ```

---

## Task 4: Hook useSessionEvents (WebSocket com reconexão)

**Files:**
- Create: `web/src/hooks/useSessionEvents.ts`
- Create: `web/src/test/hooks/useSessionEvents.test.ts`

**Interfaces:**
- Consumes: `sessionReducer` (Task 3), `FileEntry`, `WsEvent` (Task 3)
- Produces:
  ```ts
  function useSessionEvents(
    sessionId: string | null,
    ownerToken: string | null
  ): { files: FileEntry[]; connected: boolean }
  ```
  Internamente: `useReducer(sessionReducer, { files: [] })`, WebSocket para `/api/sessions/:id/ws?token=:token`, reconexão com backoff 1s→2s→4s→8s→30s (max), para ao receber close code 4000, limpa ao desmontar.

- [ ] **Step 1: Escrever teste de fumaça** em `web/src/test/hooks/useSessionEvents.test.ts`:
  ```ts
  import { renderHook } from '@testing-library/react'
  import { useSessionEvents } from '../../hooks/useSessionEvents'

  it('retorna files vazio e connected false quando sessionId é null', () => {
    const { result } = renderHook(() => useSessionEvents(null, null))
    expect(result.current.files).toEqual([])
    expect(result.current.connected).toBe(false)
  })
  ```

- [ ] **Step 2: Rodar — confirmar FAIL**

- [ ] **Step 3: Implementar `useSessionEvents`** em `web/src/hooks/useSessionEvents.ts`. Usa `useEffect` para criar WS quando `sessionId` e `ownerToken` não-nulos. `onopen` → `setConnected(true)`. `onmessage` → parse JSON, dispatch. `onclose(e)` → se `e.code === 4000`, não reconectar; senão agenda retry com backoff. `onerror` → fecha e reagenda. Cleanup: `ws.close()`, cancela timer.

- [ ] **Step 4: Rodar — confirmar PASS**

- [ ] **Step 5: Commit**
  ```bash
  git add web/src/hooks/ web/src/test/hooks/
  git commit -m "feat(web): hook useSessionEvents com reconexão exponencial"
  ```

---

## Task 5: Tela do computador

**Files:**
- Create: `web/src/pages/computer/ComputerPage.tsx`
- Create: `web/src/pages/computer/SessionCard.tsx`
- Create: `web/src/pages/computer/FileList.tsx`
- Create: `web/src/pages/computer/FileRow.tsx`
- Create: `web/src/pages/computer/PreviewModal.tsx`
- Create: `web/src/hooks/useHeartbeat.ts`
- Create: `web/src/test/pages/ComputerPage.test.tsx`

**Interfaces:**
- Consumes: todos os components UI (Task 2), `useSessionEvents` (Task 4), `api.*` (Task 3), `formatBytes`, `fileCategory`, `fileStateLabel`, `overallProgress` (Task 3)
- Produces: `<ComputerPage />` (default export) — estado local de sessões (array), QR Code via `qrcode.react`, pagehide via `navigator.sendBeacon`

- [ ] **Step 1: Escrever teste de renderização** em `web/src/test/pages/ComputerPage.test.tsx`:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import ComputerPage from '../../pages/computer/ComputerPage'

  // Mock api
  vi.mock('../../lib/api', () => ({ createSession: vi.fn(), deleteSession: vi.fn(), heartbeat: vi.fn(), listFiles: vi.fn().mockResolvedValue([]) }))
  // Mock useSessionEvents
  vi.mock('../../hooks/useSessionEvents', () => ({ useSessionEvents: () => ({ files: [], connected: false }) }))

  it('renderiza botão Nova sessão', () => {
    render(<ComputerPage />)
    expect(screen.getByRole('button', { name: /nova sessão/i })).toBeInTheDocument()
  })
  ```

- [ ] **Step 2: Rodar — confirmar FAIL**

- [ ] **Step 3: Implementar `ComputerPage`** — estado: `sessions: ActiveSession[]` onde `ActiveSession = { id: string; ownerToken: string; uploadToken: string }`. `selectedSessionId: string | null`. Botão "Nova sessão" chama `createSession()`, adiciona ao array. `pagehide`: itera sessões e chama `sendBeacon` para cada uma. **Importante**: `sendBeacon` não suporta headers; usar `DELETE /api/sessions/:id?token=:ownerToken` (backend precisa aceitar ownerToken via query param — verificar; se não aceitar, usar heartbeat timeout como fallback). Layout: max-w-5xl, duas colunas a partir de 1024 px.

- [ ] **Step 4: Implementar `SessionCard`** — QR Code da URL `${publicBaseUrl}/enviar/${session.id}?token=${session.uploadToken}` sobre fundo branco fixo, `StatusDot`, contagem de arquivos, botão "Encerrar" (ghost/danger).

- [ ] **Step 5: Implementar `FileList` + `FileRow`** — lista de arquivos da sessão selecionada. Cada `FileRow`: thumbnail/ícone, nome truncado, tamanho, `fileStateLabel`, `ProgressBar` enquanto `state === 'receiving'`, botão download `<a href>`.

- [ ] **Step 6: Implementar `PreviewModal`** — detecta categoria com `fileCategory`; imagem: `<img src={previewUrl} />`; vídeo: `<video controls src>`; áudio: `<audio controls src>`; PDF: `<iframe sandbox src>` (CSP do servidor já diz `sandbox`); outros: ícone + botão download. QR Code na URL de preview com `?token=ownerToken`.

- [ ] **Step 7: Implementar `useHeartbeat`** — `setInterval` a cada 30s chamando `api.heartbeat(id, token)`, limpa ao desmontar.

- [ ] **Step 8: Rodar — confirmar PASS**

- [ ] **Step 9: Commit**
  ```bash
  git add web/src/pages/computer/ web/src/hooks/useHeartbeat.ts web/src/test/pages/ComputerPage.test.tsx
  git commit -m "feat(web): tela do computador (sessões, QR Code, lista de arquivos, preview)"
  ```

---

## Task 6: Tela do telefone

**Files:**
- Create: `web/src/pages/phone/PhonePage.tsx`
- Create: `web/src/pages/phone/UploadItem.tsx`
- Create: `web/src/test/pages/PhonePage.test.tsx`

**Interfaces:**
- Consumes: componentes UI (Task 2), `formatBytes` (Task 3), `api.previewUrl` indiretamente via URL params `/:id?token=`
- Produces: `<PhonePage />` (default export) — lê `sessionId` e `uploadToken` da URL (`/enviar/:id?token=`)

- [ ] **Step 1: Escrever teste de renderização**:
  ```tsx
  import { render, screen } from '@testing-library/react'
  import PhonePage from '../../pages/phone/PhonePage'

  // Mock window.location
  Object.defineProperty(window, 'location', { value: { pathname: '/enviar/session-123', search: '?token=abc' }, writable: true })

  it('renderiza área de escolher arquivos', () => {
    render(<PhonePage />)
    expect(screen.getByRole('button', { name: /escolher arquivos/i })).toBeInTheDocument()
  })
  ```

- [ ] **Step 2: Rodar — confirmar FAIL**

- [ ] **Step 3: Implementar `PhonePage`** — parse de `window.location.pathname` para `sessionId` e `search` para `token`. Se token ausente ou sessão 401: mostrar mensagem "Sessão inválida ou encerrada". Upload com `XMLHttpRequest` + `FormData` (campo `files[]` ou campo individual por arquivo — testar contra `POST /api/sessions/:id/files`). `xhr.upload.onprogress` para progresso real. Estado: `uploads: UploadItem[]` onde cada item tem `file: File`, `progress: number`, `state: 'pending'|'uploading'|'done'|'error'`. Botão "Tentar novamente" nos com erro. Botão "Enviar mais" na mesma sessão quando todos concluídos.

- [ ] **Step 4: Implementar `UploadItem`** — linha com nome, progresso, estado, botão retry.

- [ ] **Step 5: Rodar — confirmar PASS**

- [ ] **Step 6: Commit**
  ```bash
  git add web/src/pages/phone/ web/src/test/pages/PhonePage.test.tsx
  git commit -m "feat(web): tela do telefone (upload XHR, progresso, retry)"
  ```

---

## Task 7: Roteamento + integração Fastify Static + build

**Files:**
- Modify: `web/src/App.tsx` — roteamento por `window.location.pathname`
- Modify: `web/src/pages/dev/UiShowcase.tsx` — rota `/dev/ui` só em DEV
- Create: `src/controllers/static.ts` — `@fastify/static` servindo `web/dist`
- Modify: `src/app.ts` — registrar static route; SPA fallback para `/` e `/enviar/*`
- Modify: `package.json` — adicionar `@fastify/static` à dependências

**Interfaces:**
- Consumes: `web/dist` produzido por `bun run build:web`
- Produces: GET `/` → `web/dist/index.html`; GET `/enviar/:id` → `web/dist/index.html`; GET `/dev/ui` → idem (roteado pelo React)

- [ ] **Step 1: Implementar roteamento no `App.tsx`** — lê `window.location.pathname`:
  ```ts
  if (path === '/' || path === '') → <ComputerPage />
  if (path.startsWith('/enviar/')) → <PhonePage />
  if (import.meta.env.DEV && path === '/dev/ui') → <UiShowcase />
  else → <NotFound />
  ```

- [ ] **Step 2: Adicionar `@fastify/static` ao `package.json` raiz**:
  ```json
  "@fastify/static": "^8.1.1"
  ```

- [ ] **Step 3: Criar `src/controllers/static.ts`** — registra `@fastify/static` com `root: path.join(import.meta.dirname, '../../web/dist')`, `prefix: '/'`, `decorateReply: false`. Adicionar wildcard para SPA: GET `/*` → send `index.html` (exceto rotas `/api/*` e `/health`).

- [ ] **Step 4: Registrar em `src/app.ts`** após as rotas de API, só se `web/dist` existir (`fs.existsSync`).

- [ ] **Step 5: Rodar `bun run build:web` + `bun typecheck` + `bun typecheck:web`**

- [ ] **Step 6: Commit**
  ```bash
  git add src/controllers/static.ts src/app.ts web/src/App.tsx package.json
  git commit -m "feat: servir front-end estático via Fastify; roteamento SPA"
  ```

---

## Task 8: Smoke test

**Files:**
- Create: `scripts/smoke.ts`
- Modify: `package.json` — script `"smoke": "bun run scripts/smoke.ts"`

**Interfaces:**
- Consumes: `buildApp` de `src/app.ts`, API REST e WebSocket do backend

- [ ] **Step 1: Implementar `scripts/smoke.ts`**. Fluxo:
  1. Sobe servidor em porta aleatória (`port: 0`, pega porta do `address().port`)
  2. `POST /api/sessions` → obtém `id`, `ownerToken`, `uploadToken`
  3. Conecta WebSocket `/api/sessions/${id}/ws?token=${ownerToken}`, aguarda `open`
  4. Envia 2 arquivos via `FormData` + fetch como `uploadToken` (`POST /api/sessions/${id}/files`)
  5. Aguarda 2 eventos `file:state-changed` com `state: 'completed'` via WS (timeout 10s)
  6. `GET /api/sessions/${id}/files` → confirma 2 arquivos `completed`
  7. Download individual do primeiro arquivo, calcula SHA-256, compara com original
  8. `GET /api/sessions/${id}/download.zip` → salva, extrai com `fflate`, verifica que ambos os arquivos estão presentes com conteúdo correto
  9. `DELETE /api/sessions/${id}` com `ownerToken`
  10. Confirma que `${TEMP_DIR}/${id}` não existe mais
  11. Fecha servidor
  12. Imprime `✅ OK` ou `❌ FALHOU: <motivo>` e sai com código 0/1

- [ ] **Step 2: Rodar smoke test**:
  ```bash
  PUBLIC_BASE_URL=http://localhost bun run smoke
  ```
  Esperado: `✅ OK`

- [ ] **Step 3: Commit**
  ```bash
  git add scripts/smoke.ts package.json
  git commit -m "feat: smoke test (bun run smoke)"
  ```

---

## Task 9: Docker

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`

- [ ] **Step 1: Criar `.dockerignore`**:
  ```
  node_modules
  web/node_modules
  web/dist
  .env
  tmp/
  *.test.ts
  tests/
  scripts/
  docs/
  spike/
  .git
  ```

- [ ] **Step 2: Criar `Dockerfile`** multi-stage:
  ```dockerfile
  ARG BUN_VERSION=1.4.4
  # Stage 1: build front-end
  FROM oven/bun:${BUN_VERSION} AS web-builder
  WORKDIR /app
  COPY web/package.json web/bun.lock* ./web/
  RUN cd web && bun install --frozen-lockfile
  COPY web/ ./web/
  RUN cd web && bun run build

  # Stage 2: produção
  FROM oven/bun:${BUN_VERSION}-slim AS runner
  WORKDIR /app
  RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 bunjs
  COPY package.json bun.lock ./
  RUN bun install --frozen-lockfile --production
  COPY src/ ./src/
  COPY --from=web-builder /app/web/dist ./web/dist/
  USER bunjs
  EXPOSE 3000
  HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1
  ENV HOST=0.0.0.0
  CMD ["bun", "--bun", "run", "src/server.ts"]
  ```

- [ ] **Step 3: Criar `docker-compose.yml`**:
  ```yaml
  services:
    app:
      build: .
      ports:
        - "${LAN_IP:-0.0.0.0}:${PORT:-3000}:3000"
      environment:
        PORT: "${PORT:-3000}"
        PUBLIC_BASE_URL: "${PUBLIC_BASE_URL}"
        TEMP_DIR: /tmp/uploads
        MAX_FILE_SIZE: "${MAX_FILE_SIZE:-5368709120}"
        SESSION_IDLE_TIMEOUT: "${SESSION_IDLE_TIMEOUT:-1800000}"
        ALLOWED_ORIGINS: "${ALLOWED_ORIGINS:-*}"
      tmpfs:
        - /tmp/uploads
      restart: unless-stopped
      healthcheck:
        test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
        interval: 30s
        timeout: 5s
        retries: 3
        start_period: 10s
  ```

- [ ] **Step 4: Commit**
  ```bash
  git add Dockerfile .dockerignore docker-compose.yml
  git commit -m "feat: Dockerfile multi-stage + docker-compose.yml"
  ```

---

## Task 10: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Escrever README em português** com seções:
  - Visão geral (2 parágrafos)
  - Arquitetura (diagrama ASCII ou lista)
  - Requisitos (Bun 1.4.4, Node para nada mais)
  - Instalação (instalar Bun, `bun install`, `cd web && bun install`)
  - Variáveis de ambiente (tabela com todas as vars)
  - Execução com Bun (`PUBLIC_BASE_URL=http://IP:3000 bun run start`)
  - Descobrir IP na LAN (ip route / ifconfig / ipconfig)
  - Execução com Docker / Docker Compose
  - Firewall (abrir porta 3000 TCP)
  - Rodar testes (`bun run test`, `cd web && bun test`)
  - Smoke test (`PUBLIC_BASE_URL=http://localhost bun run smoke`)
  - Solução de problemas (QR não funciona, upload falha, porta em uso)
  - Limitações conhecidas

- [ ] **Step 2: Commit**
  ```bash
  git add README.md
  git commit -m "docs: README em português"
  ```

---

## Task 11: Verificação final (todas as garantias)

- [ ] `bun install` limpo (remover node_modules, reinstalar)
- [ ] `bun run typecheck` — zero erros
- [ ] `cd web && bun run typecheck` — zero erros
- [ ] `bun run lint` — zero warnings
- [ ] `bun --bun vitest run` — 85+ testes passando
- [ ] `cd web && bun test` — todos os testes passando
- [ ] `bun run build:web` — `web/dist/` gerado
- [ ] `PUBLIC_BASE_URL=http://localhost bun run smoke` — `✅ OK`
- [ ] `docker build -t does-not-send .` — sem erros
- [ ] `PUBLIC_BASE_URL=http://localhost docker compose up -d` — healthcheck saudável
- [ ] `PUBLIC_BASE_URL=http://localhost bun run smoke` apontando para container
- [ ] `docker compose down` — diretório temporário vazio (tmpfs some automaticamente)
