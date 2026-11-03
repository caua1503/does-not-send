import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX || "10", 10);

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL or TEST_DATABASE_URL environment variable is required");
}

/**
 * Singleton Postgres connection pool using bun native driver.
 * Pool size controlled by DB_POOL_MAX (default 10).
 */
export const sql = postgres(DATABASE_URL, {
  max: DB_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * Graceful shutdown: close all connections.
 */
export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}
