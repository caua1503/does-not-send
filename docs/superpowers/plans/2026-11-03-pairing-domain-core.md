# Pairing Domain Core (Part 1/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `"active"/"closed"` session state with an explicit 5-state machine, add QR hash storage, and implement `consumePairing` — the atomic single-use QR consumption that gates all phone pairing — while keeping all 98 existing tests green.

**Architecture:** A new pure-domain module (`src/session/`) owns the state machine, error types, and `consumePairing`; it has zero Fastify/WebSocket imports. The existing `SessionService` and repository delegate to it. Types in `src/types.ts` are narrowed (new `SessionState` union); existing tests that build `Session` objects inline will need their `state` literal updated from `"active"` to `"WAITING"` or `"PAIRED"` as applicable. Routes translate domain errors to HTTP status codes.

**Tech Stack:** Bun, TypeScript strict, Fastify 5, Vitest, `node:crypto` only.

**Spec:** User prompt — "PAREAMENTO EXCLUSIVO, PARTE 1/3: núcleo de domínio, estados e QR de uso único" (2026-11-03).

## Global Constraints

- No new external libraries; `node:crypto` only.
- TypeScript strict; no `any`.
- No Fastify/WebSocket imports inside `src/session/`.
- `session.state` is never assigned directly outside `transition()`; only `transition()` mutates it.
- `qrTokenHash` stored (SHA-256, hex); raw `qrToken` never appears on the session object after creation.
- Token comparison uses `timingSafeEqual` on equal-length buffers.
- No tokens in logs.
- `consumePairing` is synchronous (no `await` between check and mutation).
- Bun runtime is single-threaded: synchronous consumption is atomic.
- Test command: `bun --bun vitest run` (from repo root).
- Branch: `feat/pareamento-1` off `dev`; merge `--no-ff` back to `dev` at end.

## Review Focus

1. **Concurrent callers on `consumePairing`**: `Promise.all(20 calls)` — exactly 1 must succeed; 19 must return `ALREADY_CONSUMED`. Covered in Task 2 concurrency test.
2. **Correct token with consumed QR**: correct raw token arrives after `qrConsumedAt` is set — must return `ALREADY_CONSUMED`, not `INVALID`. Covered in Task 2 "second phone" test.
3. **State gate on `consumePairing`**: session in `CLOSED` state — must return `CLOSED`, not proceed to hash check. Covered in Task 1 transition tests + Task 2 closed-state test.
4. **TRANSFERRING → PAIRED re-entry**: upload completes and session may return to `PAIRED`; `transition()` must allow it. Covered in Task 1 transition table test.
5. **Isolation**: consuming QR on session A must not touch session B's `qrConsumedAt` or state. Covered in Task 2 isolation test.

---

### Task 1: State Machine and Domain Error Types

**Files:**
- Create: `src/session/states.ts`
- Create: `src/session/errors.ts`
- Create: `tests/session-states.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain, no imports from other src modules)
- Produces:
  - `type SessionState = "WAITING" | "PAIRED" | "TRANSFERRING" | "DISCONNECTED" | "CLOSED"`
  - `const TRANSITIONS: Record<SessionState, SessionState[]>`
  - `function transition(session: { state: SessionState }, to: SessionState): void` — mutates `session.state` or throws `InvalidTransitionError`
  - `class InvalidTransitionError extends Error { from: SessionState; to: SessionState }`
  - `type PairingErrorCode = "ALREADY_CONSUMED" | "INVALID" | "NOT_FOUND" | "CLOSED"`
  - `class PairingError extends Error { code: PairingErrorCode }`

- [ ] **Step 1: Write failing tests in `tests/session-states.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { transition, TRANSITIONS } from "../src/session/states.js";
import { InvalidTransitionError } from "../src/session/errors.js";

describe("transition()", () => {
  it("WAITING → PAIRED succeeds", () => {
    const s = { state: "WAITING" as const };
    transition(s, "PAIRED");
    expect(s.state).toBe("PAIRED");
  });

  it("WAITING → CLOSED succeeds", () => {
    const s = { state: "WAITING" as const };
    transition(s, "CLOSED");
    expect(s.state).toBe("CLOSED");
  });

  it("PAIRED → TRANSFERRING succeeds", () => {
    const s = { state: "PAIRED" as const };
    transition(s, "TRANSFERRING");
    expect(s.state).toBe("TRANSFERRING");
  });

  it("PAIRED → DISCONNECTED succeeds", () => {
    const s = { state: "PAIRED" as const };
    transition(s, "DISCONNECTED");
    expect(s.state).toBe("DISCONNECTED");
  });

  it("PAIRED → CLOSED succeeds", () => {
    const s = { state: "PAIRED" as const };
    transition(s, "CLOSED");
    expect(s.state).toBe("CLOSED");
  });

  it("TRANSFERRING → PAIRED succeeds", () => {
    const s = { state: "TRANSFERRING" as const };
    transition(s, "PAIRED");
    expect(s.state).toBe("PAIRED");
  });

  it("TRANSFERRING → DISCONNECTED succeeds", () => {
    const s = { state: "TRANSFERRING" as const };
    transition(s, "DISCONNECTED");
    expect(s.state).toBe("DISCONNECTED");
  });

  it("TRANSFERRING → CLOSED succeeds", () => {
    const s = { state: "TRANSFERRING" as const };
    transition(s, "CLOSED");
    expect(s.state).toBe("CLOSED");
  });

  it("DISCONNECTED → PAIRED succeeds", () => {
    const s = { state: "DISCONNECTED" as const };
    transition(s, "PAIRED");
    expect(s.state).toBe("PAIRED");
  });

  it("DISCONNECTED → CLOSED succeeds", () => {
    const s = { state: "DISCONNECTED" as const };
    transition(s, "CLOSED");
    expect(s.state).toBe("CLOSED");
  });

  it("WAITING → TRANSFERRING throws InvalidTransitionError", () => {
    const s = { state: "WAITING" as const };
    expect(() => transition(s as any, "TRANSFERRING")).toThrow(InvalidTransitionError);
  });

  it("CLOSED → PAIRED throws InvalidTransitionError", () => {
    const s = { state: "CLOSED" as const };
    expect(() => transition(s as any, "PAIRED")).toThrow(InvalidTransitionError);
  });

  it("CLOSED → WAITING throws InvalidTransitionError", () => {
    const s = { state: "CLOSED" as const };
    expect(() => transition(s as any, "WAITING")).toThrow(InvalidTransitionError);
  });

  it("InvalidTransitionError carries from/to", () => {
    const s = { state: "WAITING" as const };
    try {
      transition(s as any, "TRANSFERRING");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.from).toBe("WAITING");
      expect(err.to).toBe("TRANSFERRING");
    }
  });

  it("state is not mutated on invalid transition", () => {
    const s = { state: "WAITING" as const };
    try { transition(s as any, "TRANSFERRING"); } catch { /* expected */ }
    expect(s.state).toBe("WAITING");
  });

  it("TRANSITIONS table has exactly 5 keys", () => {
    expect(Object.keys(TRANSITIONS)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/session-states.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/session/states.ts` and `src/session/errors.ts`**

`src/session/errors.ts`: export `InvalidTransitionError` (fields `from`, `to: SessionState`) and `PairingError` (field `code: PairingErrorCode`) and the `PairingErrorCode` type.

`src/session/states.ts`: export `SessionState` type, `TRANSITIONS` constant matching the spec table exactly, and `transition(session: { state: SessionState }, to: SessionState): void` — checks `TRANSITIONS[session.state].includes(to)`, throws `InvalidTransitionError` if not, else mutates `session.state = to`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/session-states.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add src/session/states.ts src/session/errors.ts tests/session-states.test.ts
git commit -m "feat(session): state machine and domain error types"
```

---

### Task 2: consumePairing — QR Hash Storage and Atomic Consumption

**Files:**
- Create: `src/session/pairing.ts`
- Create: `tests/session-pairing.test.ts`

**Interfaces:**
- Consumes:
  - `transition` from `src/session/states.ts`
  - `PairingError`, `PairingErrorCode` from `src/session/errors.ts`
  - `SessionState` from `src/session/states.ts`
  - `createHash`, `randomBytes`, `timingSafeEqual` from `node:crypto`
- Produces:
  - `function hashToken(raw: string): string` — `createHash("sha256").update(raw).digest("hex")`
  - `function generateQrToken(): string` — `randomBytes(32).toString("base64url")`
  - `interface PairableSession { id: string; state: SessionState; qrTokenHash: string | null; qrConsumedAt: string | null; pairedAt: string | null }`
  - `type PairingResult = { ok: true; pairedAt: string } | { ok: false; error: PairingError }`
  - `function consumePairing(session: PairableSession, rawToken: string): PairingResult` — **synchronous, no await**

- [ ] **Step 1: Write failing tests in `tests/session-pairing.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { consumePairing, generateQrToken, hashToken } from "../src/session/pairing.js";
import type { PairableSession } from "../src/session/pairing.js";
import { PairingError } from "../src/session/errors.js";

function makeSession(overrides: Partial<PairableSession> = {}): PairableSession {
  const raw = generateQrToken();
  return {
    id: "sess-test",
    state: "WAITING",
    qrTokenHash: hashToken(raw),
    qrConsumedAt: null,
    pairedAt: null,
    ...overrides,
  };
}

describe("hashToken", () => {
  it("returns 64-char hex string", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same input same output", () => {
    expect(hashToken("x")).toBe(hashToken("x"));
  });

  it("different inputs differ", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("consumePairing", () => {
  it("first pairing succeeds and transitions WAITING → PAIRED", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });
    const result = consumePairing(session, raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.pairedAt).toBe("string");
    expect(session.state).toBe("PAIRED");
    expect(session.qrConsumedAt).not.toBeNull();
    expect(session.pairedAt).not.toBeNull();
  });

  it("raw qrToken does not appear on session object after consumption", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });
    consumePairing(session, raw);
    const json = JSON.stringify(session);
    expect(json).not.toContain(raw);
  });

  it("second call with same token returns ALREADY_CONSUMED", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });
    consumePairing(session, raw);
    const result = consumePairing(session, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ALREADY_CONSUMED");
  });

  it("correct token after qrConsumedAt already set returns ALREADY_CONSUMED", () => {
    const raw = generateQrToken();
    const session = makeSession({
      qrTokenHash: hashToken(raw),
      qrConsumedAt: new Date().toISOString(),
      state: "PAIRED",
    });
    const result = consumePairing(session, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ALREADY_CONSUMED");
  });

  it("wrong token returns INVALID", () => {
    const session = makeSession();
    const result = consumePairing(session, "wrong-token");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID");
    expect(session.state).toBe("WAITING");
    expect(session.qrConsumedAt).toBeNull();
  });

  it("CLOSED session returns CLOSED", () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw), state: "CLOSED" });
    const result = consumePairing(session, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CLOSED");
  });

  it("concurrency: 20 simultaneous calls, exactly 1 succeeds", async () => {
    const raw = generateQrToken();
    const session = makeSession({ qrTokenHash: hashToken(raw) });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(consumePairing(session, raw))),
    );
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(19);
    failures.forEach((r) => {
      if (!r.ok) expect(r.error.code).toBe("ALREADY_CONSUMED");
    });
  });

  it("isolation: consuming session A does not affect session B", () => {
    const rawA = generateQrToken();
    const rawB = generateQrToken();
    const sessionA = makeSession({ id: "sess-a", qrTokenHash: hashToken(rawA) });
    const sessionB = makeSession({ id: "sess-b", qrTokenHash: hashToken(rawB) });
    consumePairing(sessionA, rawA);
    expect(sessionA.state).toBe("PAIRED");
    expect(sessionB.state).toBe("WAITING");
    expect(sessionB.qrConsumedAt).toBeNull();
  });

  it("qrTokenHash stored on session is not the raw token", () => {
    const raw = generateQrToken();
    const hash = hashToken(raw);
    const session = makeSession({ qrTokenHash: hash });
    expect(session.qrTokenHash).not.toBe(raw);
    expect(session.qrTokenHash).toBe(hash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/session-pairing.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `src/session/pairing.ts`**

Signature for `consumePairing(session: PairableSession, rawToken: string): PairingResult`:

1. If `session.qrConsumedAt !== null` → return `{ ok: false, error: new PairingError("ALREADY_CONSUMED") }`.
2. If `session.state === "CLOSED"` → return `{ ok: false, error: new PairingError("CLOSED") }`.
3. Hash `rawToken` with `hashToken`; compare with `timingSafeEqual` against `session.qrTokenHash` (both as fixed-length `Buffer` from hex) — if mismatch → return `{ ok: false, error: new PairingError("INVALID") }`.
4. Atomically (still in same sync frame): set `session.qrConsumedAt = new Date().toISOString()`, call `transition(session, "PAIRED")`, set `session.pairedAt = session.qrConsumedAt`.
5. Return `{ ok: true, pairedAt: session.pairedAt }`.

For step 3's comparison: `timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(session.qrTokenHash!, "hex"))` — both are 32 bytes (64 hex chars), so lengths always match.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --bun vitest run tests/session-pairing.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `bun --bun vitest run`
Expected: all tests pass (98 + 11 in pairing + 16 in states = 125 total, or similar)

- [ ] **Step 6: Commit**

```bash
git add src/session/pairing.ts tests/session-pairing.test.ts
git commit -m "feat(session): consumePairing with QR hash storage and atomic single-use"
```

---

### Task 3: Wire Domain into Session Type and Existing Code

**Files:**
- Modify: `src/types.ts` — replace `SessionState = "active" | "closed"` with `SessionState` from `src/session/states.ts`; add `qrTokenHash: string | null`, `qrConsumedAt: string | null` fields; keep `qrToken` as `null` permanently (hash replaces it); keep `isPaired`, `pairedAt`, `phoneDisconnectedAt`.
- Modify: `src/services/session-service.ts` — `create()` generates `generateQrToken()`, stores `hashToken(raw)` as `qrTokenHash`, returns raw token separately for QR URL construction; `close()` uses `transition(session, "CLOSED")`; `heartbeat()`/`expire()` check `state !== "CLOSED"` instead of `state !== "active"`; remove direct `session.state =` assignments.
- Modify: `src/repositories/session-repository.ts` — `getAllActive()` / `getActiveIds()` filter on `state !== "CLOSED"` (covers all non-terminal states).
- Modify: `src/controllers/sessions.ts` — `authorize()` checks `session.state !== "CLOSED"` instead of `state !== "active"`.
- Modify: `tests/helpers.ts` — `createSession` helper adds `qrToken` (raw, from `POST /sessions` response) to `SessionTokens` interface; no other change.
- Modify all inline `Session` fixtures in existing tests that hardcode `state: "active"` → `state: "WAITING"` and add required `qrTokenHash: null, qrConsumedAt: null`.
- Test: `tests/session-wiring.test.ts` (new) — integration tests via `createTestApp`.

> [!IMPORTANT]
> Task 3 is the migration task. Many existing tests build `Session` objects directly with `state: "active"`. They will fail TypeScript compilation and/or runtime checks after the type change. Fix each one — do not delete them.

**Interfaces:**
- Consumes: `SessionState` from `src/session/states.ts`; `generateQrToken`, `hashToken` from `src/session/pairing.ts`; `transition` from `src/session/states.ts`
- Produces:
  - Updated `Session` interface (exported from `src/types.ts`)
  - `POST /api/sessions` response now includes `qrToken: string` (raw, one-time, for QR URL)
  - `SessionService.create()` returns `Session & { rawQrToken: string }` **or** a separate return type — pick one and use it consistently; the route reads `rawQrToken` and never logs it.

- [ ] **Step 1: Write failing integration tests in `tests/session-wiring.test.ts`**

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { createTestApp, cleanupTestApp, type TestContext } from "./helpers.js";

describe("session wiring", () => {
  let ctx: TestContext;
  afterEach(async () => { if (ctx) await cleanupTestApp(ctx); });

  it("POST /sessions returns qrToken in response", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; ownerToken: string; qrToken: string }>();
    expect(typeof body.qrToken).toBe("string");
    expect(body.qrToken.length).toBeGreaterThan(0);
  });

  it("session created with WAITING state, qrTokenHash stored, raw token not on session", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, ownerToken, qrToken } = res.json<{ id: string; ownerToken: string; qrToken: string }>();
    // Read session internals via service (access through app context)
    const appCtx = (ctx.app as any).ctx;
    const session = appCtx.sessionRepository.getById(id);
    expect(session.state).toBe("WAITING");
    expect(session.qrTokenHash).toBeDefined();
    expect(session.qrTokenHash).not.toBe(qrToken);
    expect(JSON.stringify(session)).not.toContain(qrToken);
    expect(ownerToken).toBeDefined();
  });

  it("DELETE /sessions/:id closes session (CLOSED state)", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "POST", url: "/api/sessions" });
    const { id, ownerToken } = res.json<{ id: string; ownerToken: string }>();
    const del = await ctx.app.inject({
      method: "DELETE",
      url: `/api/sessions/${id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(del.statusCode).toBe(204);
    const appCtx = (ctx.app as any).ctx;
    const session = appCtx.sessionRepository.getById(id);
    expect(session?.state).toBe("CLOSED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --bun vitest run tests/session-wiring.test.ts`
Expected: FAIL (type errors or wrong state)

- [ ] **Step 3: Update `src/types.ts`**

Replace `SessionState = "active" | "closed"` import/declaration with a re-export of `SessionState` from `src/session/states.ts`. Add `qrTokenHash: string | null` and `qrConsumedAt: string | null` to `Session`. Remove `qrToken` field (it was only a placeholder; the hash replaces it). Keep `isPaired`, `pairedAt`, `phoneDisconnectedAt`.

- [ ] **Step 4: Update `src/services/session-service.ts`**

In `create()`: call `generateQrToken()` → `raw`; set `qrTokenHash: hashToken(raw)`, `qrConsumedAt: null`, `isPaired: false`, `shortId: generateShortId()`, `state: "WAITING"`. Return an object that includes `rawQrToken: raw` alongside the session (or return `{ session, rawQrToken: raw }`).

In `close()` / `expire()`: replace `session.state = "closed"` with `transition(session, "CLOSED")`.

In `heartbeat()` / `touchActivity()`: replace `state !== "active"` with `state === "CLOSED"`.

Run: `bun --bun vitest run tests/session-wiring.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Update `src/controllers/sessions.ts`**

`authorize()`: change guard to `session.state === "CLOSED"`. Route `POST /api/sessions`: destructure `rawQrToken` from service result; include `qrToken: rawQrToken` in the 201 response body (never log it).

- [ ] **Step 6: Update `src/repositories/session-repository.ts`**

`getAllActive()`: filter `s.state !== "CLOSED"`.
`getActiveIds()`: same.

- [ ] **Step 7: Fix existing test fixtures**

In all test files (including `tests/pairing-domain.test.ts`, `tests/authorization.test.ts`, `tests/sessions.test.ts`, `tests/isolation.test.ts`, etc.) that construct a `Session` object directly with `state: "active"`:
- Change `state: "active"` → `state: "WAITING"`.
- Add `qrTokenHash: null, qrConsumedAt: null` if not present.
- Remove `qrToken` field if present (field is removed from interface).

- [ ] **Step 8: Run full test suite**

Run: `bun --bun vitest run`
Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/services/session-service.ts src/repositories/session-repository.ts \
        src/controllers/sessions.ts tests/session-wiring.test.ts \
        tests/pairing-domain.test.ts tests/authorization.test.ts tests/sessions.test.ts \
        tests/isolation.test.ts tests/cleanup.test.ts tests/websocket.test.ts
git commit -m "feat(session): wire new SessionState and QR hash into types, service, and routes"
```

---

### Task 4: Git Branch and Merge

**Files:** none (git operations only)

**Interfaces:** none

- [ ] **Step 1: Verify all tests pass on current branch**

Run: `bun --bun vitest run`
Expected: all tests pass

- [ ] **Step 2: Create feature branch retroactively** *(if commits were made on dev directly)*

```bash
git checkout dev
git checkout -b feat/pareamento-1
```

If commits were already on a branch, just verify: `git branch --show-current` → `feat/pareamento-1`.

- [ ] **Step 3: Merge to dev**

```bash
git checkout dev
git merge --no-ff feat/pareamento-1 -m "feat(session): estados explícitos e QR de uso único"
```

- [ ] **Step 4: Handle conflicts if any**

Preserve intent of both sides. After resolving: `bun --bun vitest run` → all pass. Then `git merge --continue`.

- [ ] **Step 5: Verify final state**

Run: `bun --bun vitest run`
Expected: all tests pass on `dev`.

Run: `git log --oneline -5`
Confirm merge commit appears.

---

## Appendix: File Responsibility Map

| File | Responsibility |
|---|---|
| `src/session/states.ts` | `SessionState` type, `TRANSITIONS` table, `transition()` — pure domain |
| `src/session/errors.ts` | `InvalidTransitionError`, `PairingError`, `PairingErrorCode` — pure domain |
| `src/session/pairing.ts` | `generateQrToken`, `hashToken`, `consumePairing`, `PairableSession`, `PairingResult` — pure domain |
| `src/types.ts` | `Session` interface, re-exports `SessionState`; single source of truth for session shape |
| `src/services/session-service.ts` | Orchestration, timers, FS cleanup; calls `transition()` for all state changes |
| `src/repositories/session-repository.ts` | In-memory Map storage; active = `state !== "CLOSED"` |
| `src/controllers/sessions.ts` | HTTP routes; translates domain results to status codes |
| `tests/session-states.test.ts` | Unit tests for state machine |
| `tests/session-pairing.test.ts` | Unit tests for `consumePairing` (no HTTP) |
| `tests/session-wiring.test.ts` | Integration tests via `createTestApp` |
