# Exclusive Session Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement exclusive 1:1 session pairing between computer and phone with single-use QR code, short human-readable session IDs, dual-presence WebSocket/heartbeat monitoring with disconnection/reconnection handling, and atomic QR consumption.

**Architecture:**
- Sessions generate a unique short display ID (`shortId`, e.g. `A7K92F`) and a single-use `qrToken`.
- The phone scans the QR code containing `qrToken` and calls atomic pairing endpoint `POST /api/sessions/:id/pair`.
- Pairing immediately invalidates `qrToken`, marks session paired, generates an independent private `uploadToken`, and rejects any concurrent or subsequent pairing attempts with 409 Conflict.
- WebSocket endpoint supports both `owner` and `phone` roles for dual-presence tracking. Disconnecting computer immediately closes session, aborts pending transfers, notifies phone, and cleans temp directory. Disconnecting phone triggers a grace reconnection window before closing the session.

**Tech Stack:** TypeScript, Node.js / Bun, Fastify 5, `@fastify/websocket`, React 18, Vitest.

**Spec:** User request "Implementar pareamento exclusivo de sessões" (Pareamento, Identificação, Monitoramento, Testes e segurança, Restrições).

## Global Constraints
- Preserve existing REST and WebSocket endpoints and contract compatibility.
- In-memory session repository: no external database.
- Strictly 1 phone paired per session; reject reuse and multiple devices.
- Single pairing allows multiple file uploads without rescanning.
- Cryptographically secure tokens and atomic single-threaded in-memory consumption.

## Review Focus
1. Concurrent pairing race condition: two phones hitting `/pair` with the same `qrToken` simultaneously — exactly one must succeed with 200, the other must fail with 409.
2. QR code reuse: same phone or different phone hitting `/pair` after consumption — returns 409 or 401; QR code cannot be reused.
3. Computer disconnection while phone is connected: computer WS close triggers immediate session close, phone notification, file cleanup, and upload rejection.
4. Phone disconnection with reconnect: phone WS close starts grace timer; reconnecting within grace period preserves session and active upload capability.
5. Identification consistency: short display ID (`shortId`) generated on server is returned to both computer and paired phone and displayed on both UIs.

---

### Task 1: Domain Model, Short ID Generator & Session Repository Updates

**Files:**
- Modify: `src/types.ts`
- Modify: `src/utils/crypto.ts`
- Modify: `src/repositories/session-repository.ts`
- Test: `tests/pairing-domain.test.ts`

**Interfaces:**
- Consumes: `generateToken` from `src/utils/crypto.ts`
- Produces: `generateShortId(): string`, updated `Session` interface with `shortId`, `qrToken`, `isPaired`, `phoneDisconnectedAt`, and `SessionRepository.getByShortId(shortId: string)`.

- [ ] **Step 1: Write failing test in `tests/pairing-domain.test.ts`**
Test `generateShortId()` format (6 chars, alphanumeric uppercase, no ambiguous chars), `SessionRepository.getByShortId()`, and session pairing attributes.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun --bun vitest run tests/pairing-domain.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `generateShortId` and update `src/types.ts` and `src/repositories/session-repository.ts`**
Add `generateShortId(length = 6): string` to `src/utils/crypto.ts`.
Add fields to `Session` in `src/types.ts`: `shortId`, `qrToken`, `isPaired`, `pairedAt`, `phoneDisconnectedAt`.
Add `getByShortId(shortId: string): Session | undefined` to `SessionRepository`.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun --bun vitest run tests/pairing-domain.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/types.ts src/utils/crypto.ts src/repositories/session-repository.ts tests/pairing-domain.test.ts
git commit -m "feat: add shortId generator and session pairing domain fields"
```

---

### Task 2: Atomic Pairing, QR Consumption, and Lifecycle in SessionService

**Files:**
- Modify: `src/services/session-service.ts`
- Modify: `src/utils/events.ts`
- Test: `tests/session-service-pairing.test.ts`

**Interfaces:**
- Consumes: `SessionRepository`, `generateShortId`, `generateToken`, `safeCompare`
- Produces:
  - `sessionService.pair(id: string, qrToken: string): { success: boolean; statusCode: number; error?: string; uploadToken?: string; shortId?: string }`
  - `sessionService.handlePhoneDisconnect(id: string): void`
  - `sessionService.handlePhoneReconnect(id: string): void`
  - `sessionService.handleComputerDisconnect(id: string): Promise<void>`
  - Event `session:paired` emitted on `fileEvents`

- [ ] **Step 1: Write failing tests in `tests/session-service-pairing.test.ts`**
Test atomic consumption of `qrToken`, rejection of reused QR code, concurrent pairing calls, phone disconnect grace timer, and computer disconnect immediate cleanup.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun --bun vitest run tests/session-service-pairing.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement pairing and lifecycle methods in `src/services/session-service.ts`**
In `create()`: generate `shortId` and `qrToken`. Set `isPaired = false`.
In `pair(id, qrToken)`: validate active, unconsumed `qrToken`, and `!isPaired`. Atomically set `isPaired = true`, `qrToken = null`, generate `uploadToken`. Emit `session:paired`.
In `handleComputerDisconnect(id)`: call `close(id)`.
In `handlePhoneDisconnect(id)`: start phone grace timeout (e.g. 5s in test / config).
In `handlePhoneReconnect(id)`: cancel phone grace timeout.

- [ ] **Step 4: Run test to verify it passes**
Run: `bun --bun vitest run tests/session-service-pairing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/services/session-service.ts src/utils/events.ts tests/session-service-pairing.test.ts
git commit -m "feat: implement atomic pairing and device lifecycle in SessionService"
```

---

### Task 3: Pairing HTTP Route and Exclusive Upload Authorization

**Files:**
- Modify: `src/controllers/sessions.ts`
- Modify: `src/controllers/files.ts`
- Modify: `tests/helpers.ts`
- Test: `tests/pairing-api.test.ts`

**Interfaces:**
- Consumes: `sessionService.pair`, `authorize`
- Produces:
  - `POST /api/sessions/:id/pair` with body `{ qrToken: string }` or query `?qr=...`
  - Updated `authorize()`: rejects uploads if session is not paired or closed
  - `POST /api/sessions/:id/heartbeat` supports both `owner` and `upload` (phone) tokens
  - `tests/helpers.ts` updated to support `autoPair` and `pairSession`

- [ ] **Step 1: Write failing tests in `tests/pairing-api.test.ts`**
Test:
- First phone pairs successfully with valid `qrToken` (returns 200, `uploadToken`, `shortId`).
- Second phone with same `qrToken` returns 409 Conflict.
- Using invalid or consumed `qrToken` returns 401/409.
- Upload before pairing is rejected.
- Upload after pairing by paired phone succeeds for multiple files.
- Upload after session closed is rejected with 401.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun --bun vitest run tests/pairing-api.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `POST /api/sessions/:id/pair` and update `authorize()` & `sessions.ts`**
Add route `POST /sessions/:id/pair`.
Update `authorize()` to verify `session.isPaired === true` when role is `upload`.
Update `/sessions/:id/heartbeat` to accept `["owner", "upload"]` and touch appropriate presence.
Update `POST /sessions` to return `{ id, shortId, ownerToken, qrToken, uploadToken, createdAt }`.
Update `tests/helpers.ts` with `pairSession` helper and autoPair in `createSession` so existing tests keep passing.

- [ ] **Step 4: Run tests to verify all pass**
Run: `bun --bun vitest run tests/pairing-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/controllers/sessions.ts src/controllers/files.ts tests/helpers.ts tests/pairing-api.test.ts
git commit -m "feat: add pairing HTTP route and enforce exclusive upload authorization"
```

---

### Task 4: Dual-Presence WebSocket Monitoring & Phone Reconnection

**Files:**
- Modify: `src/controllers/websocket.ts`
- Test: `tests/dual-presence-ws.test.ts`

**Interfaces:**
- Consumes: `SessionService.handleComputerDisconnect`, `handlePhoneDisconnect`, `handlePhoneReconnect`
- Produces:
  - Computer WS accepts `ownerToken` (default)
  - Phone WS accepts `uploadToken` when `role=phone`
  - Computer disconnect closes session, sends WS close 4000 to phone, cleans temp files
  - Phone disconnect triggers grace timer; reconnecting resets timer

- [ ] **Step 1: Write failing tests in `tests/dual-presence-ws.test.ts`**
Test:
- Phone connects with `uploadToken` and `role=phone`.
- Computer disconnect triggers phone WS close (code 4000) and cleans session dir.
- Phone disconnect starts grace timer; reconnecting resets timer; failing to reconnect closes session.

- [ ] **Step 2: Run test to verify it fails**
Run: `bun --bun vitest run tests/dual-presence-ws.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement dual-presence handling in `src/controllers/websocket.ts`**
Inspect query `role`:
If `role === "phone"`: authenticate `uploadToken` and `session.isPaired`. On socket open, notify sessionService phone connected. On socket close, notify sessionService phone disconnected (starts grace timer).
If owner connection: on socket open, mark computer connected. On socket close, trigger `sessionService.handleComputerDisconnect(sessionId)`.

- [ ] **Step 4: Run tests to verify it passes**
Run: `bun --bun vitest run tests/dual-presence-ws.test.ts tests/websocket.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/controllers/websocket.ts tests/dual-presence-ws.test.ts
git commit -m "feat: add dual-presence WebSocket monitoring with phone reconnection grace period"
```

---

### Task 5: Frontend UI Updates (Computer & Phone Pages)

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/pages/computer/SessionCard.tsx`
- Modify: `web/src/pages/phone/PhonePage.tsx`
- Modify: `web/src/hooks/useSessionEvents.ts`
- Test: `web/src/test/pages/SessionCard.test.tsx`
- Test: `web/src/test/pages/PhonePage.test.tsx`

**Interfaces:**
- Consumes: `pairSession(id: string, qrToken: string)` from `web/src/lib/api.ts`
- Produces:
  - Computer UI shows short ID (`A7K92F`), QR code with `qrToken`, and pairing status.
  - Phone UI pairs on load via `POST /api/sessions/:id/pair`, displays same short ID (`A7K92F`), uses `uploadToken` for uploads and WS/heartbeat, and shows informative error if QR code was already used or session ended.

- [ ] **Step 1: Update web tests in `web/src/test/pages/`**
Write tests for pairing handshake on phone, rejection of invalid/used QR code, and display of `shortId` on both computer and phone.

- [ ] **Step 2: Run web tests to verify failures**
Run: `bun run test:web`
Expected: FAIL

- [ ] **Step 3: Implement changes in `web/src/`**
Add `pairSession(id, qrToken)` to `web/src/lib/api.ts`.
In `SessionCard.tsx`: display `shortId` badge; generate QR code with `?qr=${session.qrToken}`; listen for `session:paired` to show phone connected.
In `PhonePage.tsx`: read `qr` from URL search params; call `pairSession`; store returned `uploadToken` and `shortId`; display `shortId` prominently in header; connect to WS/heartbeat; handle 409 already paired / expired QR.

- [ ] **Step 4: Run web tests and build**
Run: `bun run test:web && bun run build:web`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add web/
git commit -m "feat(web): add shortId display, QR pairing flow and exclusive session UI"
```

---

### Task 6: Full Integration & Verification

**Files:**
- Verify all backend tests: `bun run test`
- Verify all web tests: `bun run test:web`
- Verify types and lint: `bun run typecheck && bun run lint && bun run typecheck:web`

- [ ] **Step 1: Run complete test suite**
Run: `bun run test && bun run test:web`
Expected: All tests pass.

- [ ] **Step 2: Run linter and typecheckers**
Run: `bun run typecheck && bun run lint && bun run typecheck:web`
Expected: Zero errors.

- [ ] **Step 3: Verification commit if needed**
```bash
git commit --allow-empty -m "chore: verify all test suites and typechecks pass"
```
