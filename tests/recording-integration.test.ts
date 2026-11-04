/**
 * Testes de Integração — SqlStore
 * 
 * Requer Postgres rodando.
 * Testa mapeamento de eventos para SQL com banco real.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgres://doesnotsend:changeme@localhost:5432/doesnotsend_test";

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { sql } from "../src/db/db.js";
import { SqlStore } from "../src/recording/sql-store.js";
import { setupTestSchema, teardownTestSchema } from "./db-helpers.js";
import type {
  SessionCreated,
  SessionPaired,
  SessionClosed,
  TransferStarted,
  TransferFinished,
  PairingRefused,
  QrReuseBlocked,
  PhoneLost,
  PhoneBack,
} from "../src/recording/events.js";

describe("SqlStore - Integration", () => {
  let testSchema: string;
  let store: SqlStore;

  beforeEach(async () => {
    testSchema = await setupTestSchema();
    store = new SqlStore();
  });

  afterEach(async () => {
    await teardownTestSchema(testSchema);
  });

  test("ciclo completo: sessão com 2 transferências e 4 tipos de evento", async () => {
    const sessionId = crypto.randomUUID();
    const transfer1Id = crypto.randomUUID();
    const transfer2Id = crypto.randomUUID();
    const baseTime = Date.now();

    const events = [
      // 1. Criar sessão
      {
        type: "session_created",
        sessionId,
        visualId: "ABC123",
        computerIp: "::ffff:192.168.1.100",
        timestamp: baseTime,
      } satisfies SessionCreated,

      // 2. Parear
      {
        type: "session_paired",
        sessionId,
        phoneIp: "::ffff:10.0.0.50",
        userAgent:
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
        timestamp: baseTime + 1000,
      } satisfies SessionPaired,

      // 3. Iniciar transfer 1 (done)
      {
        type: "transfer_started",
        sessionId,
        transferId: transfer1Id,
        fileName: "/home/user/photo.JPG",
        extension: "JPG",
        mime: "image/jpeg",
        size: 102400,
        phoneIp: "10.0.0.50",
        timestamp: baseTime + 2000,
      } satisfies TransferStarted,

      // 4. Finalizar transfer 1 como done
      {
        type: "transfer_finished",
        sessionId,
        transferId: transfer1Id,
        status: "done",
        timestamp: baseTime + 3000,
      } satisfies TransferFinished,

      // 5. Iniciar transfer 2 (discarded)
      {
        type: "transfer_started",
        sessionId,
        transferId: transfer2Id,
        fileName: "document.pdf",
        extension: "pdf",
        mime: "application/pdf",
        size: 51200,
        phoneIp: "10.0.0.50",
        timestamp: baseTime + 4000,
      } satisfies TransferStarted,

      // 6. Finalizar transfer 2 como discarded
      {
        type: "transfer_finished",
        sessionId,
        transferId: transfer2Id,
        status: "discarded",
        timestamp: baseTime + 5000,
      } satisfies TransferFinished,

      // 7. Eventos de domínio (4 tipos)
      {
        type: "pairing_refused",
        sessionId,
        reason: "already_consumed",
        phoneIp: "192.168.1.200",
        userAgent: "Safari/604.1",
        timestamp: baseTime + 6000,
      } satisfies PairingRefused,

      {
        type: "qr_reuse_blocked",
        sessionId,
        phoneIp: "192.168.1.201",
        userAgent: "Firefox/120.0",
        timestamp: baseTime + 7000,
      } satisfies QrReuseBlocked,

      {
        type: "phone_lost",
        sessionId,
        timestamp: baseTime + 8000,
      } satisfies PhoneLost,

      {
        type: "phone_back",
        sessionId,
        timestamp: baseTime + 9000,
      } satisfies PhoneBack,

      // 8. Fechar sessão
      {
        type: "session_closed",
        sessionId,
        closeReason: "computer_closed",
        timestamp: baseTime + 10000,
      } satisfies SessionClosed,
    ];

    await store.apply(events);

    // Verificar sessions
    const sessions = await sql`
      SELECT id, visual_id, computer_ip, phone_ip, ua_summary, paired_at, closed_at, close_reason
      FROM sessions
      WHERE id = ${sessionId}
    `;
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.visual_id).toBe("ABC123");
    expect(sessions[0]?.computer_ip).toBe("192.168.1.100"); // normalizado
    expect(sessions[0]?.phone_ip).toBe("10.0.0.50");
    expect(sessions[0]?.ua_summary).toBe("Chrome (Android)");
    expect(sessions[0]?.close_reason).toBe("computer_closed");

    // Verificar transfers
    const transfers = await sql`
      SELECT id, name, extension, mime, category, size, status, finished_at
      FROM transfers
      WHERE session_id = ${sessionId}
      ORDER BY started_at
    `;
    expect(transfers.length).toBe(2);

    // Transfer 1 (done)
    expect(transfers[0]?.id).toBe(transfer1Id);
    expect(transfers[0]?.name).toBe("photo.JPG"); // basename
    expect(transfers[0]?.category).toBe("images"); // JPG maiúsculo
    expect(transfers[0]?.size).toBe("102400"); // bigint como string no postgres.js
    expect(transfers[0]?.status).toBe("done");
    expect(transfers[0]?.finished_at).not.toBeNull();

    // Transfer 2 (discarded)
    expect(transfers[1]?.id).toBe(transfer2Id);
    expect(transfers[1]?.name).toBe("document.pdf");
    expect(transfers[1]?.category).toBe("pdfs");
    expect(transfers[1]?.status).toBe("discarded");

    // Verificar events (4 tipos)
    const eventRows = await sql`
      SELECT type, detail
      FROM events
      WHERE session_id = ${sessionId}
      ORDER BY at
    `;
    expect(eventRows.length).toBe(4);
    expect(eventRows[0]?.type).toBe("pairing_refused");
    expect(eventRows[1]?.type).toBe("qr_reuse_blocked");
    expect(eventRows[2]?.type).toBe("phone_lost");
    expect(eventRows[3]?.type).toBe("phone_back");

    // Verificar detail de pairing_refused
    const detail0 = typeof eventRows[0]?.detail === "string"
      ? JSON.parse(eventRows[0].detail)
      : eventRows[0]?.detail;
    expect(detail0?.reason).toBe("already_consumed");
    expect(detail0?.ip).toBe("192.168.1.200");
  });

  test("transfer_finished repetido não reprocessa nem regride status", async () => {
    const sessionId = crypto.randomUUID();
    const transferId = crypto.randomUUID();
    const baseTime = Date.now();

    const events = [
      // 1. Criar sessão
      {
        type: "session_created",
        sessionId,
        visualId: "XYZ789",
        computerIp: "192.168.1.1",
        timestamp: baseTime,
      } satisfies SessionCreated,

      // 2. Iniciar transfer
      {
        type: "transfer_started",
        sessionId,
        transferId,
        fileName: "file.txt",
        extension: "txt",
        mime: "text/plain",
        size: 1024,
        phoneIp: "192.168.1.2",
        timestamp: baseTime + 1000,
      } satisfies TransferStarted,

      // 3. Finalizar como done
      {
        type: "transfer_finished",
        sessionId,
        transferId,
        status: "done",
        timestamp: baseTime + 2000,
      } satisfies TransferFinished,

      // 4. Tentar finalizar novamente como aborted (não deve alterar)
      {
        type: "transfer_finished",
        sessionId,
        transferId,
        status: "aborted",
        timestamp: baseTime + 3000,
      } satisfies TransferFinished,
    ];

    await store.apply(events);

    // Verificar que status permanece 'done'
    const transfers = await sql`
      SELECT status, finished_at
      FROM transfers
      WHERE id = ${transferId}
    `;
    expect(transfers.length).toBe(1);
    expect(transfers[0]?.status).toBe("done"); // Não regrediu para 'aborted'

    // Verificar que finished_at é do primeiro evento (baseTime + 2000)
    const finishedAt = new Date(transfers[0]!.finished_at as string).getTime();
    expect(finishedAt).toBeCloseTo(baseTime + 2000, -3); // Precisão de segundos
  });
});
