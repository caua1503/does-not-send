import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createDbClient, type DbClient } from "../src/db/client.js";
import { MigrationRunner } from "../src/db/migrate.js";
import { events, sessions, transfers } from "../src/db/schema.js";
import { loadConfig } from "../src/utils/config.js";
import type { AdminSummary, Paginated, SessionDetail, TimeseriesResponse, TransferRow } from "../src/shared/admin/types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
// Drops the public schema, so refuse anything that is not clearly a test database.
const isDedicatedTestDb = databaseUrl !== undefined && /_test($|\?)/.test(databaseUrl);

const ADMIN_PASSWORD = "senha-de-teste-123";
const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const SESSION_C = "33333333-3333-4333-8333-333333333333";

const insertedAt: Record<string, string> = {};


describe.skipIf(!isDedicatedTestDb)("admin API @db", () => {
  let client: DbClient;
  let app: FastifyInstance;
  let cookie: string;

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
    expect(runner.isReady()).toBe(true);
    client = createDbClient(databaseUrl!);

    process.env.NODE_ENV = "test";
    process.env.ADMIN_USER = "admin";
    process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.ADMIN_TZ = "America/Sao_Paulo";
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    process.env.DATABASE_URL = databaseUrl!;
    app = await buildApp(loadConfig(), { startSweeper: false });
    const readyDeadline = Date.now() + 15_000;
    // The API answers 503 db_unavailable until migrations are ready, so wait it out.
    const booted = app as unknown as { ctx: { db?: { isReady(): boolean } } };
    while (!booted.ctx.db?.isReady() && Date.now() < readyDeadline) await Bun.sleep(50);

    // Fixed dataset (2026, São Paulo = UTC-3 in January).
    const at = (iso: string): string => {
      const stored = new Date(iso).toISOString();
      insertedAt[iso] = stored;
      return stored;
    };
    await client.writer.insert(sessions).values([
      {
        id: SESSION_A,
        visualId: "AAA-111",
        computerIp: "10.0.0.1",
        phoneIp: "10.0.0.50",
        createdAt: at("2026-01-05T10:00:00-03:00"),
        pairedAt: at("2026-01-05T10:01:00-03:00"),
        closedAt: at("2026-01-05T11:00:00-03:00"),
        closeReason: "user_closed",
      },
      {
        id: SESSION_B,
        visualId: "BBB-222",
        computerIp: "10.0.0.2",
        phoneIp: "10.0.0.50",
        createdAt: at("2026-01-06T10:00:00-03:00"),
        pairedAt: at("2026-01-06T10:01:00-03:00"),
        closedAt: null,
      },
      {
        id: SESSION_C,
        visualId: "CCC-333",
        computerIp: "10.0.0.3",
        phoneIp: null,
        createdAt: at("2026-01-07T10:00:00-03:00"),
        closedAt: at("2026-01-07T10:30:00-03:00"),
        closeReason: "idle_timeout",
      },
      // Outside the default window (30 days before "now") but inside the fixed test period.
      {
        id: "44444444-4444-4444-8444-444444444444",
        visualId: "OLD-000",
        createdAt: at("2025-12-20T10:00:00-03:00"),
      },
    ]);

    const transferRows: Array<typeof transfers.$inferInsert> = [
      {
        id: "t1",
        sessionId: SESSION_A,
        name: "nota fiscal 100%.pdf",
        extension: "pdf",
        mime: "application/pdf",
        category: "pdfs",
        size: 1000,
        status: "completed",
        startedAt: at("2026-01-05T10:05:00-03:00"),
        finishedAt: at("2026-01-05T10:06:00-03:00"),
      },
      {
        id: "t2",
        sessionId: SESSION_A,
        name: "foto.jpg",
        extension: "jpg",
        mime: "image/jpeg",
        category: "images",
        size: 3000,
        status: "completed",
        startedAt: at("2026-01-05T10:07:00-03:00"),
        finishedAt: at("2026-01-05T10:08:00-03:00"),
      },
      {
        id: "t3",
        sessionId: SESSION_A,
        name: "video.mp4",
        extension: "mp4",
        mime: "video/mp4",
        category: "videos",
        size: 5000,
        status: "failed",
        startedAt: at("2026-01-05T10:09:00-03:00"),
        finishedAt: at("2026-01-05T10:10:00-03:00"),
      },
      {
        id: "t4",
        sessionId: SESSION_A,
        name: "em andamento.zip",
        extension: "zip",
        mime: "application/zip",
        category: "archives",
        size: 7000,
        status: "receiving",
        startedAt: at("2026-01-05T10:11:00-03:00"),
      },
      {
        id: "t5",
        sessionId: SESSION_B,
        name: "relatorio_final.pdf",
        extension: "pdf",
        mime: "application/pdf",
        category: "pdfs",
        size: 2000,
        status: "completed",
        startedAt: at("2026-01-06T10:05:00-03:00"),
        finishedAt: at("2026-01-06T10:06:00-03:00"),
      },
      {
        id: "t6",
        sessionId: SESSION_C,
        name: "planilha.xlsx",
        extension: "xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        category: "documents",
        size: 9_000_000_000,
        status: "completed",
        startedAt: at("2026-01-07T10:05:00-03:00"),
        finishedAt: at("2026-01-07T10:06:00-03:00"),
      },
    ];
    await client.writer.insert(transfers).values(transferRows);

    await client.writer.insert(events).values([
      { at: at("2026-01-05T09:00:00-03:00"), type: "pairing_refused", ip: "10.0.0.9" },
      { at: at("2026-01-05T09:01:00-03:00"), type: "pairing_refused", ip: "10.0.0.9" },
      { at: at("2026-01-05T09:02:00-03:00"), type: "pairing_refused", ip: "10.0.0.8" },
      { at: at("2026-01-05T09:03:00-03:00"), type: "qr_reused", ip: "10.0.0.7" },
      { at: at("2026-01-05T09:04:00-03:00"), type: "pairing_refused", ip: "" },
    ]);

    // Real login: exercises the argon2id route path once against the booted app.
    const login = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      headers: { "content-type": "application/json" },
      payload: { username: "admin", password: ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  });

  afterAll(async () => {
    await app?.close();
    await client?.close();
    delete process.env.ADMIN_PASSWORD;
    delete process.env.DATABASE_URL;
  });

  const get = async (url: string) => {
    const res = await app.inject({ method: "GET", url, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };

  it("@db summary soma só concluídas, ignora qr_reused e IP vazio", async () => {
    const summary = (await get(
      "/admin/api/summary?from=2026-01-01&to=2026-01-31",
    )) as AdminSummary;
    expect(summary.totals).toMatchObject({
      files: 4,
      volumeBytes: 1000 + 3000 + 2000 + 9_000_000_000,
      sessions: 3,
      transfers: 6,
      largestSize: 9_000_000_000,
    });
    expect(summary.totals.avgSize).toBe(Math.round((1000 + 3000 + 2000 + 9_000_000_000) / 4));
    expect(summary.byStatus).toEqual([
      { status: "completed", count: 4 },
      { status: "failed", count: 1 },
      { status: "receiving", count: 1 },
    ]);
    expect(summary.byCategory[0]).toEqual({ category: "pdfs", count: 2, volumeBytes: 3000 });
    expect(summary.topPhoneIps).toEqual([{ ip: "10.0.0.50", count: 2 }]);
    expect(summary.refusedPairings).toBe(3); // 2 IPs + 1 outro; qr_reused e IP '' fora
  });

  it("@db from/to de dias inteiros no fuso de São Paulo", async () => {
    // Que bug pega: from=2026-01-06 lido em UTC incluiria t5? Não: ele começaria 21:00 de 05/01 e pegaria t1..t4.
    const summary = (await get("/admin/api/summary?from=2026-01-06&to=2026-01-06")) as AdminSummary;
    expect(summary.totals.transfers).toBe(1);
    expect(summary.totals.files).toBe(1);
  });

  it("@db timeseries preenche dias vazios com zero", async () => {
    const data = (await get(
      "/admin/api/timeseries?from=2026-01-04&to=2026-01-07&granularity=day",
    )) as TimeseriesResponse;
    expect(data.granularity).toBe("day");
    expect(data.points.map((p) => [p.bucketStart, p.transfers, p.volumeBytes])).toEqual([
      ["2026-01-04T03:00:00.000Z", 0, 0],
      ["2026-01-05T03:00:00.000Z", 4, 4000],
      ["2026-01-06T03:00:00.000Z", 1, 2000],
      ["2026-01-07T03:00:00.000Z", 1, 9_000_000_000],
    ]);
  });

  it("@db busca escapa curingas do ILIKE", async () => {
    // Que bug pega: q=%25 sem escape retornaria todas as transferências.
    const exact = (await get(
      `/admin/api/transfers?from=2026-01-01&to=2026-01-31&q=${encodeURIComponent("100%")}`,
    )) as Paginated<TransferRow>;
    expect(exact.items.map((t) => t.id)).toEqual(["t1"]);
    expect(exact.items[0]!.finishedAt).toBe(insertedAt["2026-01-05T10:06:00-03:00"]);
    const wildcard = (await get(
      `/admin/api/transfers?from=2026-01-01&to=2026-01-31&q=${encodeURIComponent("_")}`,
    )) as Paginated<TransferRow>;
    expect(wildcard.items.map((t) => t.id)).toEqual(["t5"]);
  });

  it("@db filtro ip casa computer_ip OU phone_ip e sessão por visual_id", async () => {
    const byPhoneIp = (await get(
      "/admin/api/sessions?from=2026-01-01&to=2026-01-31&ip=10.0.0.50",
    )) as Paginated<{ id: string; fileCount: number; totalBytes: number; isActive: boolean }>;
    expect(byPhoneIp.items.map((s) => s.id).sort()).toEqual([SESSION_A, SESSION_B].sort());
    const sessionA = byPhoneIp.items.find((s) => s.id === SESSION_A)!;
    expect(sessionA).toMatchObject({ fileCount: 2, totalBytes: 4000, isActive: false });

    const byVisualId = (await get(
      "/admin/api/transfers?session=AAA-111&from=2026-01-01&to=2026-01-31",
    )) as Paginated<TransferRow>;
    expect(byVisualId.items.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("@db ordenação, paginação e pageSize máximo", async () => {
    const page = (await get(
      "/admin/api/transfers?from=2026-01-01&to=2026-01-31&sort=size&dir=asc&page=2&pageSize=2",
    )) as Paginated<TransferRow>;
    expect(page).toMatchObject({ total: 6, page: 2, pageSize: 2, totalPages: 3 });
    expect(page.items.map((t) => t.size)).toEqual([3000, 5000]);

    const injected = (await get(
      "/admin/api/transfers?sort=size%3Bdrop+table+transfers&dir=x",
    )) as Paginated<TransferRow>;
    expect(injected.items.length).toBeGreaterThan(0);

    const capped = (await get("/admin/api/transfers?pageSize=500")) as Paginated<TransferRow>;
    expect(capped.pageSize).toBe(100);
  });

  it("@db detalhes de sessão: linha do tempo e até 20 outras sessões com o mesmo IP", async () => {
    const detail = (await get(`/admin/api/sessions/${SESSION_A}`)) as SessionDetail;
    expect(detail.session.visualId).toBe("AAA-111");
    expect(detail.transfers).toHaveLength(4);
    expect(detail.relatedSessions.map((s) => s.id)).toEqual([SESSION_B]);
    expect(detail.timeline.map((item) => item.kind)).toEqual([
      "created",
      "paired",
      "transfer_started",
      "transfer_finished",
      "transfer_started",
      "transfer_finished",
      "transfer_finished",
      "transfer_started",
      "closed",
    ]);
    expect(detail.timeline[0]!.at).toBe(insertedAt["2026-01-05T10:00:00-03:00"]);
  });

  it("@db detalhe da transferência e 404 para id inexistente", async () => {
    const detail = (await get("/admin/api/transfers/t1")) as { transfer: TransferRow; session: { id: string } };
    expect(detail.transfer).toMatchObject({ id: "t1", sessionId: SESSION_A, status: "completed" });
    expect(detail.session.id).toBe(SESSION_A);
    const missing = await app.inject({ method: "GET", url: "/admin/api/transfers/nope", headers: { cookie } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("@db sem sessão: 401 (painel não vaza dados)", () => {
    return app.inject({ method: "GET", url: "/admin/api/summary" }).then((res) => {
      expect(res.statusCode).toBe(401);
    });
  });
});
