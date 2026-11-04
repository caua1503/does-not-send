import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

let writerSqlClient: ReturnType<typeof postgres> | null = null;
let readerSqlClient: ReturnType<typeof postgres> | null = null;
let writerInstance: PostgresJsDatabase<typeof schema> | null = null;
let readerInstance: PostgresJsDatabase<typeof schema> | null = null;

export interface DbClient {
  writer: PostgresJsDatabase<typeof schema>;
  reader: PostgresJsDatabase<typeof schema>;
  close(): Promise<void>;
}

export function getDbClient(databaseUrl: string): DbClient {
  if (writerInstance && readerInstance) {
    return { writer: writerInstance, reader: readerInstance, close: closeDb };
  }

  // Writer pool: max 2 connections, 3s statement timeout, 2s connection timeout
  writerSqlClient = postgres(databaseUrl, {
    max: 2,
    connect_timeout: 2,
    statement_timeout: 3000,
    idle_timeout: 20,
  });

  // Reader pool: max 3 connections, 5s statement timeout, 2s connection timeout
  readerSqlClient = postgres(databaseUrl, {
    max: 3,
    connect_timeout: 2,
    statement_timeout: 5000,
    idle_timeout: 20,
  });

  writerInstance = drizzle(writerSqlClient, { schema });
  readerInstance = drizzle(readerSqlClient, { schema });

  return { writer: writerInstance, reader: readerInstance, close: closeDb };
}

async function closeDb(): Promise<void> {
  await writerSqlClient?.end({ timeout: 1 });
  await readerSqlClient?.end({ timeout: 1 });
  writerSqlClient = null;
  readerSqlClient = null;
  writerInstance = null;
  readerInstance = null;
}

