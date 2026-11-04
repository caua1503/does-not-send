import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import * as schema from "./schema.js";

const WRITER_POOL_SIZE = 2;
const READER_POOL_SIZE = 3;
const WRITER_STATEMENT_TIMEOUT_MS = 3000;
const READER_STATEMENT_TIMEOUT_MS = 5000;
const CONNECTION_TIMEOUT_S = 2;

export interface DbClient {
  writer: BunSQLDatabase<typeof schema>;
  reader: BunSQLDatabase<typeof schema>;
  close(): Promise<void>;
}

function createSql(databaseUrl: string, max: number, statementTimeoutMs: number): SQL {
  return new SQL(databaseUrl, {
    max,
    connectionTimeout: CONNECTION_TIMEOUT_S,
    idleTimeout: 20,
    // Bun.SQL has no per-statement timeout option; PostgreSQL applies this
    // as a session default when the connection is opened.
    connection: { statement_timeout: statementTimeoutMs },
  });
}

export function createDbClient(databaseUrl: string): DbClient {
  const writerSql = createSql(databaseUrl, WRITER_POOL_SIZE, WRITER_STATEMENT_TIMEOUT_MS);
  const readerSql = createSql(databaseUrl, READER_POOL_SIZE, READER_STATEMENT_TIMEOUT_MS);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    // Never let a stuck database delay shutdown: close in parallel, short timeout.
    await Promise.allSettled([
      writerSql.close({ timeout: 1 }),
      readerSql.close({ timeout: 1 }),
    ]);
  };

  return {
    writer: drizzle(writerSql, { schema }),
    reader: drizzle(readerSql, { schema }),
    close,
  };
}
