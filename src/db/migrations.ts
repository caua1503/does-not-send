import { sql } from "./db.js";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

/**
 * Computa checksum SHA-256 do conteúdo SQL da migração.
 */
function computeChecksum(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Carrega migrações do diretório migrations/ em ordem numérica.
 */
export async function loadMigrationsFromDisk(
  migrationsDir: string,
): Promise<Migration[]> {
  const files = await readdir(migrationsDir);
  const migrations: Migration[] = [];

  for (const file of files) {
    if (!file.endsWith(".sql")) continue;

    const filePath = join(migrationsDir, file);
    const content = await readFile(filePath, "utf-8");
    const checksum = computeChecksum(content);

    migrations.push({
      name: file,
      sql: content,
      checksum,
    });
  }

  // Ordenar numericamente (001_xxx, 002_xxx, ...)
  migrations.sort((a, b) => {
    const numA = parseInt(a.name.split("_")[0] || "0", 10);
    const numB = parseInt(b.name.split("_")[0] || "0", 10);
    return numA - numB;
  });

  return migrations;
}

/**
 * Executa migrações pendentes em um schema específico.
 * 
 * Usa pg_advisory_lock para prevenir corridas entre múltiplas instâncias.
 * Valida checksums de migrações já aplicadas.
 * Cada migração executa em transação isolada.
 */
export async function runMigrations(
  migrations: Migration[],
  schema = "public",
): Promise<void> {
  // 1. Adquirir lock global de migração (hash simples do nome)
  const lockId = 7788994455; // ID fixo para lock de migrações
  await sql.unsafe(`SELECT pg_advisory_lock(${lockId})`);

  try {
    // 2. Garantir que schema existe
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await sql.unsafe(`SET search_path TO ${schema}`);

    // 3. Criar tabela schema_version se não existir
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${schema}.schema_version (
        version TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 4. Buscar migrações já aplicadas
    const applied = await sql.unsafe(`
      SELECT version, checksum 
      FROM ${schema}.schema_version
    `);

    const appliedMap = new Map<string, string>();
    for (const row of applied) {
      appliedMap.set(row.version, row.checksum);
    }

    // 5. Validar checksums de migrações já aplicadas
    for (const migration of migrations) {
      const existingChecksum = appliedMap.get(migration.name);
      if (existingChecksum && existingChecksum !== migration.checksum) {
        throw new Error(
          `Checksum mismatch for migration ${migration.name}: ` +
            `expected ${existingChecksum}, got ${migration.checksum}. ` +
            `Modifying applied migrations is forbidden.`,
        );
      }
    }

    // 6. Aplicar migrações pendentes em ordem
    for (const migration of migrations) {
      if (appliedMap.has(migration.name)) {
        // Já aplicada, pular
        continue;
      }

      // Aplicar em transação isolada
      await sql.begin(async (tx) => {
        // Executar SQL da migração
        await tx.unsafe(migration.sql);

        // Registrar versão
        await tx.unsafe(`
          INSERT INTO ${schema}.schema_version (version, checksum)
          VALUES ('${migration.name}', '${migration.checksum}')
        `);
      });

      console.log(`✓ Applied migration: ${migration.name}`);
    }
  } finally {
    // 7. Liberar lock
    await sql.unsafe(`SELECT pg_advisory_unlock(${lockId})`);
  }
}

/**
 * Roda migrações do diretório padrão migrations/ no schema público.
 */
export async function runMigrationsFromDisk(
  migrationsDir = join(process.cwd(), "migrations"),
  schema = "public",
): Promise<void> {
  const migrations = await loadMigrationsFromDisk(migrationsDir);
  await runMigrations(migrations, schema);
}
