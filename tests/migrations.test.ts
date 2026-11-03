/**
 * Migration Runner Tests
 * 
 * Requisitos:
 * - PostgreSQL rodando (ex: docker-compose up -d postgres)
 * - TEST_DATABASE_URL ou DATABASE_URL configurado
 * 
 * Estes testes falham propositalmente até que o migration runner seja implementado.
 */

// Define DATABASE_URL antes de qualquer import (ESM hoisting)
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgres://doesnotsend:changeme@localhost:5432/doesnotsend_test";

import { describe, test, expect, beforeEach, afterAll } from "vitest";
import { sql } from "../src/db/db.js";
import { randomBytes } from "node:crypto";

// Mock de migrações em memória
interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

function generateRUID(): string {
  return randomBytes(8).toString("hex");
}

function computeChecksum(content: string): string {
  return Buffer.from(content).toString("base64");
}

const mockMigrations: Migration[] = [
  {
    name: "001_initial_schema.sql",
    sql: "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT);",
    checksum: "",
  },
  {
    name: "002_add_email.sql",
    sql: "ALTER TABLE users ADD COLUMN email TEXT;",
    checksum: "",
  },
];

// Calcular checksums
for (const m of mockMigrations) {
  m.checksum = computeChecksum(m.sql);
}

/**
 * Helper: cria tabela schema_version em um schema específico
 */
async function createSchemaVersionTable(schema: string): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_version (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Helper: insere versão fake na tabela schema_version
 */
async function insertFakeVersion(
  schema: string,
  version: string,
  checksum: string,
): Promise<void> {
  await sql.unsafe(`
    INSERT INTO ${schema}.schema_version (version, checksum)
    VALUES ('${version}', '${checksum}')
  `);
}

describe("Migration Runner", () => {
  let testSchema: string;

  beforeEach(() => {
    testSchema = `test_${generateRUID()}`;
  });

  afterAll(async () => {
    // Cleanup: drop all test schemas created
    const schemas = await sql.unsafe(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'test_%'
    `);
    for (const { schema_name } of schemas) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema_name} CASCADE`);
    }
  });

  test("aplica migrações em ordem numérica crescente", async () => {
    // Setup: criar schema isolado
    await sql.unsafe(`CREATE SCHEMA ${testSchema}`);
    await sql.unsafe(`SET search_path TO ${testSchema}`);

    const { runMigrations } = await import("../src/db/migrations.js");
    await runMigrations(mockMigrations, testSchema);

    // Verificar que tabela schema_version existe e contém as duas migrações aplicadas
    const versions = await sql.unsafe(`
      SELECT version 
      FROM ${testSchema}.schema_version 
      ORDER BY applied_at
    `);

    expect(versions).toHaveLength(2);
    expect(versions[0]?.version).toBe("001_initial_schema.sql");
    expect(versions[1]?.version).toBe("002_add_email.sql");

    // Verificar que tabela users foi criada
    const tables = await sql.unsafe(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '${testSchema}' 
        AND table_name = 'users'
    `);
    expect(tables).toHaveLength(1);
  });

  test("idempotência: rodar runner duas vezes não duplica aplicação", async () => {
    await sql.unsafe(`CREATE SCHEMA ${testSchema}`);
    await sql.unsafe(`SET search_path TO ${testSchema}`);

    const { runMigrations } = await import("../src/db/migrations.js");
    await runMigrations(mockMigrations, testSchema);
    await runMigrations(mockMigrations, testSchema);

    const versions = await sql.unsafe(`
      SELECT version 
      FROM ${testSchema}.schema_version 
      ORDER BY applied_at
    `);

    // Deve ter exatamente 2 registros, não 4
    expect(versions).toHaveLength(2);
  });

  test("checksum alterado: falha no boot se migração já aplicada foi modificada", async () => {
    await sql.unsafe(`CREATE SCHEMA ${testSchema}`);
    await sql.unsafe(`SET search_path TO ${testSchema}`);

    // Setup: criar schema_version e inserir versão fake da primeira migração
    await createSchemaVersionTable(testSchema);
    await insertFakeVersion(
      testSchema,
      mockMigrations[0]!.name,
      mockMigrations[0]!.checksum,
    );

    // Simular alteração de checksum: modificar mockMigrations[0]
    const tamperedMigrations = [
      {
        ...mockMigrations[0]!,
        sql: "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, tampered BOOLEAN);",
        checksum: computeChecksum(
          "CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, tampered BOOLEAN);",
        ),
      },
      mockMigrations[1]!,
    ];

    const { runMigrations } = await import("../src/db/migrations.js");
    await expect(runMigrations(tamperedMigrations, testSchema)).rejects.toThrow(/checksum/i);
  });

  test("concorrência: duas chamadas simultâneas não duplicam registros", async () => {
    await sql.unsafe(`CREATE SCHEMA ${testSchema}`);
    await sql.unsafe(`SET search_path TO ${testSchema}`);

    const { runMigrations } = await import("../src/db/migrations.js");
    await Promise.all([
      runMigrations(mockMigrations, testSchema),
      runMigrations(mockMigrations, testSchema),
    ]);

    const versions = await sql.unsafe(`
      SELECT version 
      FROM ${testSchema}.schema_version 
      ORDER BY applied_at
    `);

    // Deve ter exatamente 2 registros, mesmo com duas chamadas simultâneas
    expect(versions).toHaveLength(2);
  });
});
