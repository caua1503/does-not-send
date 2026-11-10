/**
 * Demo data for the /admin panel: `bun run seed:admin:demo`.
 * Refuses production and non-local databases, since it writes rows and can
 * clear previous demo sessions (`--clean`).
 */
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { inArray, like } from "drizzle-orm";
import { events, sessions, transfers } from "../src/db/schema.js";
import type { Category, CloseReason, TransferStatus } from "../src/shared/admin/types.js";

const MARKER = "DEMO-";

interface DemoTransfer {
  name: string;
  category: Category;
  size: number;
  status: TransferStatus;
  minutesAfter: number;
  durationMinutes?: number;
}

const DEMO_FILES: DemoTransfer[] = [
  { name: "nota fiscal 2026.pdf", category: "pdfs", size: 842 * 1024, status: "completed", minutesAfter: 1, durationMinutes: 1 },
  { name: "ferias.jpg", category: "images", size: 4_100_000, status: "completed", minutesAfter: 2, durationMinutes: 1 },
  { name: "reuniao.mp4", category: "videos", size: 48_000_000, status: "completed", minutesAfter: 4, durationMinutes: 3 },
  { name: "contrato assinado.pdf", category: "pdfs", size: 1_300_000, status: "completed", minutesAfter: 9, durationMinutes: 1 },
  { name: "backup.zip", category: "archives", size: 320_000_000, status: "failed", minutesAfter: 12, durationMinutes: 2 },
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

function refuse(reason: string): never {
  console.error(`seed-admin-demo: ${reason}`);
  process.exit(1);
}

function isLocalDatabase(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // `postgres` is the docker-compose service name (internal network only).
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    return host === "postgres" && process.env.ALLOW_REMOTE_SEED === "1";
  } catch {
    return false;
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function mimeOf(category: Category): string {
  switch (category) {
    case "images":
      return "image/jpeg";
    case "videos":
      return "video/mp4";
    case "audios":
      return "audio/mpeg";
    case "pdfs":
      return "application/pdf";
    case "archives":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") refuse("recusado em produção (NODE_ENV=production)");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) refuse("DATABASE_URL não definido");
  if (!isLocalDatabase(databaseUrl)) {
    refuse(
      "recusado: DATABASE_URL precisa apontar para localhost/127.0.0.1 (host 'postgres' só com ALLOW_REMOTE_SEED=1)",
    );
  }

  const clean = Bun.argv.includes("--clean");
  const days = Number(Bun.argv.find((a) => a.startsWith("--days="))?.slice("--days=".length) ?? 14);
  if (!Number.isInteger(days) || days < 1 || days > 90) refuse("--days deve ser um inteiro entre 1 e 90");

  const sql = new SQL(databaseUrl, { max: 1, connectionTimeout: 5 });
  const db = drizzle(sql);
  const now = Date.now();
  let sessionsCreated = 0;
  let transfersCreated = 0;
  let bytesCreated = 0;

  try {
    if (clean) {
      const previous = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(like(sessions.visualId, `${MARKER}%`));
      if (previous.length > 0) {
        await db.delete(sessions).where(inArray(sessions.id, previous.map((r) => r.id)));
        console.log(`seed-admin-demo: removidas ${previous.length} sessões de demonstração`);
      }
    }

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const perDay = 1 + ((dayOffset * 7) % 4);
      for (let n = 0; n < perDay; n += 1) {
        const sessionId = randomUUID();
        sessionsCreated += 1;
        const start = now - dayOffset * DAY - (3 + n * 2) * HOUR;
        const active = dayOffset === 0 && n === perDay - 1;
        const pairedAt = new Date(start + 2 * 60 * 1000);
        const closedAt = active ? null : new Date(start + 50 * 60 * 1000);
        const visualId = `${MARKER}${String(dayOffset).padStart(2, "0")}${n}`;

        await db.insert(sessions).values({
          id: sessionId,
          visualId,
          computerIp: `10.0.${dayOffset % 3}.${10 + n}`,
          phoneIp: `192.168.0.${20 + ((dayOffset + n) % 5)}`,
          createdAt: new Date(start).toISOString(),
          pairedAt: pairedAt.toISOString(),
          ...(closedAt
            ? { closedAt: closedAt.toISOString(), closeReason: closeReasonFor(dayOffset) }
            : {}),
        });

        const files = DEMO_FILES.slice(0, 2 + ((dayOffset + n) % DEMO_FILES.length));
        transfersCreated += files.length;
        bytesCreated += files.reduce((sum, f) => sum + f.size, 0);
        await db.insert(transfers).values(
          files.map((file, index) => {
            const startedAt = start + file.minutesAfter * 60 * 1000;
            const receiving = active && index === files.length - 1;
            return {
              id: randomUUID(),
              sessionId,
              name: file.name,
              extension: extensionOf(file.name),
              mime: mimeOf(file.category),
              category: file.category,
              size: file.size,
              status: receiving ? ("receiving" as const) : file.status,
              startedAt: new Date(startedAt).toISOString(),
              finishedAt:
                receiving || file.durationMinutes === undefined
                  ? null
                  : new Date(startedAt + file.durationMinutes * 60 * 1000).toISOString(),
            };
          }),
        );

        if (dayOffset % 2 === 0) {
          await db.insert(events).values({
            at: new Date(start - 5 * 60 * 1000).toISOString(),
            type: "pairing_refused",
            ip: `172.16.0.${30 + dayOffset}`,
          });
        }
      }
    }

    console.log(
      `seed-admin-demo: ${sessionsCreated} sessões, ${transfersCreated} transferências (${Math.round(bytesCreated / MB)} MB) em ${days} dias`,
    );
  } finally {
    await sql.close({ timeout: 5 });
  }
}

function closeReasonFor(dayOffset: number): CloseReason {
  return dayOffset % 3 === 0 ? "idle_timeout" : dayOffset % 3 === 1 ? "user_closed" : "phone_lost";
}

await main();
