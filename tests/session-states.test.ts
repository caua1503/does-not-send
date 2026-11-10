import { describe, it, expect } from "vitest";
import { transition } from "../src/session/states.js";
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
});
