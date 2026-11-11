import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { eq, and, isNull, or, sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { Store, Logger } from "./store.js";
import { ConstraintViolationError } from "./store.js";
import type { DomainEvent } from "./events.js";
import { normalizeIp } from "./normalize.js";

export class SqlStore implements Store {
  constructor(
    private readonly db: BunSQLDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async apply(events: DomainEvent[]): Promise<void> {
    const start = Bun.nanoseconds();

    try {
      await this.db.transaction(async (tx) => {
        for (const event of events) {
          await this.applyEvent(tx, event);
        }
      });

      const durationMs = Number((Bun.nanoseconds() - start) / 1_000_000);
      if (durationMs > 1000) {
        this.logger.warn(`lote lento: ${durationMs}ms, ${events.length} eventos`);
      }
    } catch (err) {
      // Constraint violations (SQLSTATE class 23). Drizzle wraps driver errors,
      // so the Postgres errno lives on the cause, not on err itself.
      const errno = (err as { errno?: unknown; cause?: { errno?: unknown } }).cause?.errno ??
        (err as { errno?: unknown }).errno;
      if (typeof errno === "string" && errno.startsWith("23")) {
        throw new ConstraintViolationError("Constraint violation", err);
      }
      // Rethrow as-is (transient errors checked by caller)
      throw err;
    }
  }

  private async applyEvent(
    tx: Parameters<Parameters<BunSQLDatabase<typeof schema>["transaction"]>[0]>[0],
    event: DomainEvent,
  ): Promise<void> {
    switch (event.type) {
      case "session_created":
        await tx
          .insert(schema.sessions)
          .values({
            id: event.sessionId,
            visualId: event.visualId,
            computerIp: normalizeIp(event.computerIp),
            createdAt: event.at.toISOString(),
          })
          .onConflictDoNothing();
        break;

      case "session_paired":
        await tx
          .update(schema.sessions)
          .set({
            phoneIp: normalizeIp(event.phoneIp),
            pairedAt: event.at.toISOString(),
          })
          .where(eq(schema.sessions.id, event.sessionId));
        break;

      case "session_closed":
        await tx
          .update(schema.sessions)
          .set({
            closedAt: event.at.toISOString(),
            closeReason: event.reason,
          })
          .where(
            and(eq(schema.sessions.id, event.sessionId), isNull(schema.sessions.closedAt)),
          );
        break;

      case "transfer_started":
        await tx
          .insert(schema.transfers)
          .values({
            id: event.id,
            sessionId: event.sessionId,
            name: event.name.slice(0, 255),
            extension: event.extension,
            mime: event.mime,
            category: event.category,
            size: event.size,
            status: "receiving",
            startedAt: event.at.toISOString(),
          })
          .onConflictDoNothing();
        break;

      case "transfer_finished":
        await tx
          .update(schema.transfers)
          .set({
            status: event.status,
            size: event.size,
            version: sql`${schema.transfers.version} + 1`,
            finishedAt: event.at.toISOString(),
          })
          .where(
            and(
              eq(schema.transfers.id, event.id),
              or(
                eq(schema.transfers.status, "receiving"),
                and(
                  eq(schema.transfers.status, "completed"),
                  sql`${event.status} = 'completed'`,
                ),
              ),
            ),
          );
        break;

      case "pairing_refused":
        await tx.insert(schema.events).values({
          at: event.at.toISOString(),
          type: event.type,
          ip: normalizeIp(event.ip) ?? "",
          sessionId: event.sessionId ?? null,
        });
        break;
    }
  }
}
