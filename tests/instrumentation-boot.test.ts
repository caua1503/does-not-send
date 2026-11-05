/**
 * Etapa 4: Teste de integração do boot — server_restart e limpeza de órfãos.
 *
 * Bug real que este teste pega:
 * - A query UPDATE não filtra por closed_at IS NULL, marcando sessões já fechadas.
 * - A query não roda ou roda antes das migrações (banco inconsistente).
 * - Uma falha na query derruba o boot ao invés de apenas logá-la.
 *
 * Requer TEST_DATABASE_URL (pulado sem ela).
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { SQL } from "bun";
import { eq } from "drizzle-orm";
import { MigrationRunner } from "../src/db/migrate.js";
import { sessions } from "../src/db/schema.js";
import { createDbClient, type DbClient } from "../src/db/client.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/utils/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const isDedicatedTestDb = databaseUrl !== undefined && /_test($|\?)/.test(databaseUrl);

describe.skipIf(!isDedicatedTestDb)("Boot: server_restart marca sessões abertas @db", () => {
  let client: DbClient;

  beforeAll(async () => {
    const setup = new SQL(databaseUrl!, { max: 1, connectionTimeout: 2 });
    try {
      await setup`DROP SCHEMA IF EXISTS public CASCADE`;
      await setup`DROP SCHEMA IF EXISTS drizzle CASCADE`;
      await setup`CREATE SCHEMA public`;
    } finally {
      await setup.close({ timeout: 5 });
    }

    const runner = new MigrationRunner(databaseUrl!, {
      logger: { info: () => {}, error: () => {} },
    });
    runner.start();
    const deadline = Date.now() + 15_000;
    while (!runner.isReady() && Date.now() < deadline) await Bun.sleep(50);
    await runner.stop();

    client = createDbClient(databaseUrl!);
  });

  afterAll(async () => {
    await client?.close();
  });

  test("@db sessão aberta recebe server_restart; sessão já fechada não é alterada", async () => {
    const openId = crypto.randomUUID();
    const closedId = crypto.randomUUID();
    const closedAt = new Date().toISOString();

    // Inserir sessão aberta e sessão já fechada antes do boot
    await client.writer.insert(sessions).values([
      { id: openId, visualId: "OPEN-1", createdAt: new Date().toISOString() },
      {
        id: closedId,
        visualId: "CLSD-1",
        createdAt: new Date().toISOString(),
        closedAt,
        closeReason: "user_closed",
      },
    ]);

    // Simular boot da aplicação com o banco disponível
    const originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    process.env.PUBLIC_BASE_URL ??= "http://localhost:3000";

    const app = await buildApp(loadConfig(), { startSweeper: false });
    try {
      const ctx = (app as unknown as { ctx: { db?: { isReady(): boolean } } }).ctx;

      // Aguardar migrações + onReady
      const deadline = Date.now() + 15_000;
      while (!ctx.db?.isReady() && Date.now() < deadline) await Bun.sleep(50);
      expect(ctx.db?.isReady()).toBe(true);

      // Dar tempo para o onReady rodar
      await Bun.sleep(200);

      // Sessão aberta → deve ter sido marcada como server_restart
      const [open] = await client.reader
        .select()
        .from(sessions)
        .where(eq(sessions.id, openId));
      expect(open?.closeReason).toBe("server_restart");
      expect(open?.closedAt).not.toBeNull();

      // Sessão já fechada → não deve ter sido alterada
      const [closed] = await client.reader
        .select()
        .from(sessions)
        .where(eq(sessions.id, closedId));
      expect(closed?.closeReason).toBe("user_closed"); // manteve o motivo original
      expect(closed?.closedAt).toBe(closedAt); // manteve o timestamp original
    } finally {
      await app.close();
      if (originalUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalUrl;
    }
  });
});
