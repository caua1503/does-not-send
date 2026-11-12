import { describe, it, expect, beforeEach } from "vitest";
import {
  LoginGuard,
  SESSION_FAILURE_LIMIT,
  IP_FAILURE_LIMIT,
  IP_WINDOW_MS,
  ENTRY_TTL_MS,
} from "../src/session/login-guard.js";
import { FakeClock } from "../src/session/clock.js";

describe("LoginGuard", () => {
  let clock: FakeClock;
  let guard: LoginGuard;
  let rotated: string[];

  beforeEach(() => {
    clock = new FakeClock(1_000_000);
    guard = new LoginGuard({ clock });
    rotated = [];
  });

  const failSession = (sessionId: string) =>
    guard.recordSessionFailure(sessionId, (id) => rotated.push(id));

  it("estouro por sessão invalida e renova o código só na 5ª falha", () => {
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) {
      expect(failSession("S1")).toBe(false);
    }
    expect(rotated).toEqual([]);

    expect(failSession("S1")).toBe(true);
    expect(rotated).toEqual(["S1"]);

    // Renovação zera o contador: mais 4 falhas ainda não renovam
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) expect(failSession("S1")).toBe(false);
    expect(rotated).toEqual(["S1"]);
    expect(failSession("S1")).toBe(true);
    expect(rotated).toEqual(["S1", "S1"]);
  });

  it("acerto zera o contador da sessão", () => {
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) failSession("S1");
    guard.recordSessionSuccess("S1");

    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) {
      expect(failSession("S1")).toBe(false);
    }
    expect(rotated).toEqual([]);
  });

  it("sessões isoladas: falhas em uma não afetam a outra", () => {
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) failSession("S1");
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) failSession("S2");
    expect(rotated).toEqual([]);

    failSession("S1");
    expect(rotated).toEqual(["S1"]);
  });

  it("estouro por IP: atraso crescente dentro da janela de 1 minuto", () => {
    for (let i = 0; i < IP_FAILURE_LIMIT; i++) guard.recordIpFailure("1.2.3.4");

    expect(guard.ipFailures("1.2.3.4")).toBe(IP_FAILURE_LIMIT);
    expect(guard.ipRetryAfterMs("1.2.3.4")).toBe(IP_WINDOW_MS);

    clock.advance(30_000);
    expect(guard.ipRetryAfterMs("1.2.3.4")).toBe(30_000);

    clock.advance(IP_WINDOW_MS);
    expect(guard.ipFailures("1.2.3.4")).toBe(0);
    expect(guard.ipRetryAfterMs("1.2.3.4")).toBe(0);
  });

  it("IPs isolados entre si", () => {
    for (let i = 0; i < IP_FAILURE_LIMIT; i++) guard.recordIpFailure("1.2.3.4");
    expect(guard.ipRetryAfterMs("5.6.7.8")).toBe(0);
  });

  it("limpeza descarta entradas expiradas", () => {
    failSession("S1");
    failSession("S1");
    guard.recordIpFailure("1.2.3.4");

    clock.advance(ENTRY_TTL_MS);
    guard.sweep(new Set(["S1"]));

    failSession("S1");
    guard.recordIpFailure("1.2.3.4");

    // Contador de IP antigo zerado pela limpeza: só a falha nova conta
    expect(guard.ipFailures("1.2.3.4")).toBe(1);
    // Contador de S1 zerado: a falha pré-sweep não conta; 1 + 3 falhas novas = 4
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 2; i++) failSession("S1");
    expect(rotated).toEqual([]);
  });

  it("limpeza descarta contadores de sessões encerradas", () => {
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) failSession("S1");

    guard.sweep(new Set());
    // S1 não existe mais: contador antigo zerado, 4 falhas novas não renovam
    for (let i = 0; i < SESSION_FAILURE_LIMIT - 1; i++) expect(failSession("S1")).toBe(false);
    expect(rotated).toEqual([]);
  });
});
