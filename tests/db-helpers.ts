/**
 * Database Test Helpers
 * 
 * Fornece funções para criar schemas isolados por teste,
 * aplicar migrações e cleanup automático.
 */

import { sql } from "../src/db/db.js";
import { runMigrations, loadMigrationsFromDisk } from "../src/db/migrations.js";
import { randomBytes } from "node:crypto";

/**
 * Gera ID único para schema de teste.
 */
export function generateTestSchemaName(): string {
  return `test_${randomBytes(8).toString("hex")}`;
}

/**
 * Cria schema isolado, aplica migrações e retorna nome.
 * Use em beforeAll/beforeEach.
 */
export async function setupTestSchema(migrationsDir = "migrations"): Promise<string> {
  const schema = generateTestSchemaName();
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  await sql.unsafe(`SET search_path TO ${schema}`);

  const migrations = await loadMigrationsFromDisk(migrationsDir);
  await runMigrations(migrations, schema);

  return schema;
}

/**
 * Remove schema de teste e todo seu conteúdo.
 * Use em afterAll.
 */
export async function teardownTestSchema(schema: string): Promise<void> {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
}

/**
 * Remove todos os schemas de teste órfãos.
 * Útil para cleanup em afterAll global.
 */
export async function cleanupAllTestSchemas(): Promise<void> {
  const schemas = await sql.unsafe(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name LIKE 'test_%'
  `);

  for (const row of schemas) {
    const schemaName = (row as { schema_name: string }).schema_name;
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  }
}
