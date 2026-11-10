import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const CONNECTION_TIMEOUT_S = 2;

/** Error text without anything that could carry credentials (driver messages
 *  may echo the URL). */
function redactUrl(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/:\/\/[^\s/@:]+:[^\s/@]*@/g, "://***@");
}

// Only connectivity/transient SQLSTATEs are worth retrying; anything else
// (bad migration, auth, missing schema) is permanent and must stop the loop.
const RETRYABLE_CODES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "57P04", // database_dropped
]);
const RETRYABLE_CLASSES = ["08", "53"];

export function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code ??
    (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code !== "string") return true; // no SQLSTATE (network/unknown): retry
  return RETRYABLE_CODES.has(code) || RETRYABLE_CLASSES.includes(code.slice(0, 2));
}

export interface MigrationLogger {
  info(msg: string): void;
  error(msg: string): void;
}

export interface MigrationRunnerOptions {
  migrationsFolder?: string;
  logger?: MigrationLogger;
  /** Initial retry delay; defaults to 1s and doubles up to 30s. */
  initialDelayMs?: number;
}

export class MigrationRunner {
  private readonly databaseUrl: string;
  private readonly migrationsFolder: string;
  private readonly logger: MigrationLogger;
  private readonly initialDelayMs: number;
  private readonly abort = new AbortController();
  private ready = false;
  private finished: Promise<void> | null = null;

  constructor(databaseUrl: string, options: MigrationRunnerOptions = {}) {
    this.databaseUrl = databaseUrl;
    this.migrationsFolder = options.migrationsFolder ?? "./drizzle";
    this.logger = options.logger ?? console;
    this.initialDelayMs = options.initialDelayMs ?? INITIAL_DELAY_MS;
  }

  /** Starts the background loop. Never rejects while not cancelled. */
  start(): void {
    if (this.finished) return;
    this.finished = this.run();
  }

  /** Cancels retries and in-flight attempts; resolves once the loop has exited. */
  async stop(): Promise<void> {
    this.abort.abort();
    await this.finished;
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Resolves once migrations are applied or retries stop; never rejects. */
  async whenReady(): Promise<boolean> {
    // The loop resolves only after this.ready = true (or on cancel).
    if (this.finished) await this.finished.catch(() => {});
    while (!this.ready && !this.finished) await Bun.sleep(100);
    return this.ready;
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    let delayMs = this.initialDelayMs;

    while (!signal.aborted) {
      try {
        await this.attempt();
        this.ready = true;
        this.logger.info("Database migrations applied");
        return;
      } catch (err) {
        if (signal.aborted) return;
        if (!isRetryable(err)) {
          this.logger.error(
            `Database migration failed permanently: ${redactUrl(err)}`,
          );
          return;
        }
        this.logger.error(
          `Database migration failed, retrying in ${delayMs}ms: ${redactUrl(err)}`,
        );
      }

      await this.sleep(delayMs, signal);
      delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
    }
  }

  private async attempt(): Promise<void> {
    const { signal } = this.abort;
    const sql = new SQL(this.databaseUrl, {
      max: 1,
      connectionTimeout: CONNECTION_TIMEOUT_S,
      // No statement_timeout: DDL and the migrator's advisory lock must not be cut short.
      connection: { application_name: "does-not-send-migrator" },
    });

    try {
      if (signal.aborted) return;
      // Drizzle has no abort support, so bound the attempt here instead.
      await Promise.race([
        migrate(drizzle(sql), { migrationsFolder: this.migrationsFolder }),
        new Promise<never>((_, reject) => {
          const onAbort = (): void => reject(new Error("migration attempt cancelled"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      // Without force(), close() waits for an in-flight migration to finish.
      void sql.close({ timeout: 0 }).catch(() => {});
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}

// CLI: apply migrations once and exit (used by `bun run db:migrate`).
if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  try {
    const sql = new SQL(databaseUrl, { max: 1, connectionTimeout: 5 });
    try {
      await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    } finally {
      await sql.close({ timeout: 5 });
    }
    console.log("Migrations applied successfully");
    process.exit(0);
  } catch (err) {
    console.error(
      `Migration failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
    process.exit(1);
  }
}
