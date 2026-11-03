/**
 * Schema Tests - Migration 001
 * 
 * Valida estrutura de tabelas, índices, constraints e enums.
 * Requer PostgreSQL rodando.
 */

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgres://doesnotsend:changeme@localhost:5432/doesnotsend_test";

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { sql } from "../src/db/db.js";
import { setupTestSchema, teardownTestSchema } from "./db-helpers.js";

describe("Schema Migration 001", () => {
  let testSchema: string;

  beforeAll(async () => {
    testSchema = await setupTestSchema();
  });

  afterAll(async () => {
    await teardownTestSchema(testSchema);
  });

  test("tabelas sessions, transfers, events existem", async () => {
    const tables = await sql.unsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '${testSchema}' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tableNames = tables.map((t: any) => t.table_name);
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("transfers");
    expect(tableNames).toContain("events");
    expect(tableNames).toContain("schema_version");
  });

  test("sessions: colunas e tipos corretos", async () => {
    const columns = await sql.unsafe(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = '${testSchema}' AND table_name = 'sessions'
      ORDER BY ordinal_position
    `);

    const colMap = new Map(
      columns.map((c: any) => [c.column_name, { type: c.data_type, nullable: c.is_nullable }]),
    );

    expect(colMap.get("id")).toEqual({ type: "uuid", nullable: "NO" });
    expect(colMap.get("visual_id")).toEqual({ type: "text", nullable: "NO" });
    expect(colMap.get("computer_ip")).toEqual({ type: "text", nullable: "NO" });
    expect(colMap.get("phone_ip")).toEqual({ type: "text", nullable: "YES" });
    expect(colMap.get("state")).toEqual({ type: "text", nullable: "NO" });
    expect(colMap.get("created_at")).toMatchObject({ type: "timestamp with time zone" });
    expect(colMap.get("files_count")?.type).toBe("integer");
    expect(colMap.get("bytes_total")?.type).toBe("bigint");
  });

  test("transfers: FK session_id CASCADE", async () => {
    const constraints = await sql.unsafe(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = '${testSchema}' 
        AND table_name = 'transfers' 
        AND constraint_type = 'FOREIGN KEY'
    `);

    expect(constraints.length).toBeGreaterThan(0);

    // Validar CASCADE: inserir session, inserir transfer, deletar session → transfer deletada
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    await sql.unsafe(`
      INSERT INTO ${testSchema}.sessions (id, visual_id, computer_ip, state)
      VALUES ('${sessionId}', 'ABC123', '192.168.1.1', 'WAITING')
    `);

    const transferId = "660e8400-e29b-41d4-a716-446655440001";
    await sql.unsafe(`
      INSERT INTO ${testSchema}.transfers (id, session_id, extension, mime, category, size, phone_ip, status)
      VALUES ('${transferId}', '${sessionId}', 'jpg', 'image/jpeg', 'images', 1024, '192.168.1.2', 'done')
    `);

    await sql.unsafe(`DELETE FROM ${testSchema}.sessions WHERE id = '${sessionId}'`);

    const transfers = await sql.unsafe(`
      SELECT id FROM ${testSchema}.transfers WHERE id = '${transferId}'
    `);
    expect(transfers.length).toBe(0); // Transfer foi deletada em CASCADE
  });

  test("CHECK constraint: sessions.state valores válidos", async () => {
    const sessionId = "770e8400-e29b-41d4-a716-446655440002";
    
    // Valor válido
    await expect(
      sql.unsafe(`
        INSERT INTO ${testSchema}.sessions (id, visual_id, computer_ip, state)
        VALUES ('${sessionId}', 'XYZ789', '192.168.1.3', 'PAIRED')
      `),
    ).resolves.not.toThrow();

    // Valor inválido deve falhar
    const invalidSessionId = "880e8400-e29b-41d4-a716-446655440003";
    await expect(
      sql.unsafe(`
        INSERT INTO ${testSchema}.sessions (id, visual_id, computer_ip, state)
        VALUES ('${invalidSessionId}', 'BAD999', '192.168.1.4', 'INVALID_STATE')
      `),
    ).rejects.toThrow();
  });

  test("CHECK constraint: transfers.category valores válidos", async () => {
    const sessionId = "990e8400-e29b-41d4-a716-446655440004";
    await sql.unsafe(`
      INSERT INTO ${testSchema}.sessions (id, visual_id, computer_ip, state)
      VALUES ('${sessionId}', 'CAT001', '192.168.1.5', 'PAIRED')
    `);

    const transferId = "aa0e8400-e29b-41d4-a716-446655440005";

    // Categoria válida
    await expect(
      sql.unsafe(`
        INSERT INTO ${testSchema}.transfers (id, session_id, extension, mime, category, size, phone_ip, status)
        VALUES ('${transferId}', '${sessionId}', 'pdf', 'application/pdf', 'pdfs', 2048, '192.168.1.6', 'done')
      `),
    ).resolves.not.toThrow();

    // Categoria inválida
    const invalidTransferId = "bb0e8400-e29b-41d4-a716-446655440006";
    await expect(
      sql.unsafe(`
        INSERT INTO ${testSchema}.transfers (id, session_id, extension, mime, category, size, phone_ip, status)
        VALUES ('${invalidTransferId}', '${sessionId}', 'txt', 'text/plain', 'invalid_category', 512, '192.168.1.7', 'done')
      `),
    ).rejects.toThrow();
  });

  test("eventos: FK session_id SET NULL", async () => {
    const sessionId = "cc0e8400-e29b-41d4-a716-446655440007";
    await sql.unsafe(`
      INSERT INTO ${testSchema}.sessions (id, visual_id, computer_ip, state)
      VALUES ('${sessionId}', 'EVT123', '192.168.1.8', 'WAITING')
    `);

    await sql.unsafe(`
      INSERT INTO ${testSchema}.events (session_id, type)
      VALUES ('${sessionId}', 'created')
    `);

    await sql.unsafe(`DELETE FROM ${testSchema}.sessions WHERE id = '${sessionId}'`);

    const events = await sql.unsafe(`
      SELECT session_id FROM ${testSchema}.events WHERE type = 'created'
    `);
    expect(events.length).toBeGreaterThan(0);
    const firstEvent = events[0] as unknown as { session_id: string | null };
    expect(firstEvent.session_id).toBeNull(); // SET NULL funcionou
  });

  test("índices existem", async () => {
    const indexes = await sql.unsafe(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = '${testSchema}' 
        AND tablename IN ('sessions', 'transfers', 'events')
      ORDER BY indexname
    `);

    const indexNames = indexes.map((i: any) => i.indexname);

    // Sessions
    expect(indexNames).toContain("idx_sessions_created_at");
    expect(indexNames).toContain("idx_sessions_computer_ip");
    expect(indexNames).toContain("idx_sessions_visual_id");

    // Transfers
    expect(indexNames).toContain("idx_transfers_session_id");
    expect(indexNames).toContain("idx_transfers_category_started");
    expect(indexNames).toContain("idx_transfers_status_started");

    // Events
    expect(indexNames).toContain("idx_events_session_at");
    expect(indexNames).toContain("idx_events_type_at");
  });
});
