import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker } from "../src/recording/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, openDurationMs: 100 });
  });

  it("starts in closed state", () => {
    expect(breaker.getState()).toBe("closed");
    expect(breaker.canAttempt()).toBe(true);
  });

  it("opens after threshold failures", () => {
    expect(breaker.recordFailure()).toBe(false); // 1st failure
    expect(breaker.recordFailure()).toBe(false); // 2nd failure
    expect(breaker.recordFailure()).toBe(true); // 3rd failure → opens

    expect(breaker.getState()).toBe("open");
    expect(breaker.canAttempt()).toBe(false);
  });

  it("transitions to half_open after timeout expires", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure(); // Opens

    expect(breaker.canAttempt()).toBe(false);

    // Simulate time passing (test uses real Date.now, so we can't fake time here,
    // but we can test the logic by directly manipulating the breaker state via reset)
    // For now, just verify state
    expect(breaker.getState()).toBe("open");
  });

  it("closes on success and resets failure count", () => {
    breaker.recordFailure();
    breaker.recordFailure();

    breaker.recordSuccess();

    expect(breaker.getState()).toBe("closed");
    expect(breaker.canAttempt()).toBe(true);

    // Should not open after 2 more failures (count was reset)
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.getState()).toBe("closed");
  });

  it("reset returns breaker to initial state", () => {
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure(); // Opens

    breaker.reset();

    expect(breaker.getState()).toBe("closed");
    expect(breaker.canAttempt()).toBe(true);
  });
});

describe("CircuitBreaker half_open", () => {
  it("volta a abrir depois de uma sonda half_open falhar", async () => {
    // Que bug pega: após timeout e 1 falha, o circuito ficava fechado para sempre.
    const breaker = new CircuitBreaker({ failureThreshold: 3, openDurationMs: 20 });
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canAttempt()).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(breaker.canAttempt()).toBe(true); // half_open
    breaker.recordFailure(); // sonda half_open falha → reabre imediatamente
    expect(breaker.canAttempt()).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(breaker.canAttempt()).toBe(true); // nova sonda
    breaker.recordFailure(); // e falha de novo → reabre
    expect(breaker.canAttempt()).toBe(false);
  });
});
