import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

interface MigrationRunnerOptions {
  databaseUrl: string;
  logger?: { info(msg: string): void; error(msg: string, err?: Error): void };
  onReady?: () => void;
}

export class MigrationRunner {
  private databaseUrl: string;
  private logger: { info(msg: string): void; error(msg: string, err?: Error): void };
  private onReady?: () => void;
  private cancelToken: { cancelled: boolean } = { cancelled: false };
  private ready = false;

  constructor(options: MigrationRunnerOptions) {
    this.databaseUrl = options.databaseUrl;
    this.logger = options.logger ?? console;
    this.onReady = options.onReady;
  }

  async start(): Promise<void> {
    let delayMs = 1000;
    const maxDelay = 30_000;

    while (!this.cancelToken.cancelled) {
      try {
        const sql = postgres(this.databaseUrl, { max: 1, connect_timeout: 5 });
        const db = drizzle(sql);

        await migrate(db, { migrationsFolder: "./drizzle" });

        await sql.end({ timeout: 1 });

        this.ready = true;
        this.logger.info("Database migrations completed successfully");
        if (this.onReady) this.onReady();
        return;
      } catch (err) {
        if (this.cancelToken.cancelled) return;

        this.logger.error(
          `Migration failed, retrying in ${delayMs}ms...`,
          err instanceof Error ? err : undefined,
        );

        await Bun.sleep(delayMs);
        delayMs = Math.min(delayMs * 2, maxDelay);
      }
    }
  }

  stop(): void {
    this.cancelToken.cancelled = true;
  }

  isReady(): boolean {
    return this.ready;
  }
}

// CLI script: run migrations once and exit
if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const runner = new MigrationRunner({ databaseUrl, logger: console });
  try {
    await runner.start();
    console.log("✅ Migrations applied successfully");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}
