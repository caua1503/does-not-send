import { sql } from "drizzle-orm";
import { pgTable, text, bigint, integer, pgEnum, index, customType } from "drizzle-orm/pg-core";

// drizzle/bun-sql decodes timestamptz as "2026-01-05 13:05:00.000+00",
// not ISO: anything parsing the value as ISO (the admin panel) would drop it.
const timestamptz = customType<{ data: string; driverData: string }>({
  dataType: () => "timestamptz",
  fromDriver: (value) => new Date(value).toISOString(),
});
const timestamp = (name: string) => timestamptz(name);

export const closeReasonEnum = pgEnum("close_reason", [
  "user_closed",
  "closed",
  "server_restart",
]);

export const transferStatusEnum = pgEnum("transfer_status", [
  "receiving",
  "completed",
  "failed",
]);

export const categoryEnum = pgEnum("category", [
  "images",
  "videos",
  "audios",
  "pdfs",
  "documents",
  "archives",
  "other",
]);

export const eventTypeEnum = pgEnum("event_type", ["pairing_refused"]);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    visualId: text("visual_id").notNull(),
    computerIp: text("computer_ip"),
    phoneIp: text("phone_ip"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`now()`),
    pairedAt: timestamp("paired_at"),
    closedAt: timestamp("closed_at"),
    closeReason: closeReasonEnum("close_reason"),
  },
  (table) => [index("sessions_created_at_idx").on(table.createdAt)],
);

export const transfers = pgTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    extension: text("extension").notNull(),
    mime: text("mime").notNull(),
    category: categoryEnum("category").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    status: transferStatusEnum("status").notNull(),
    version: integer("version").notNull().default(1),
    startedAt: timestamp("started_at")
      .notNull()
      .default(sql`now()`),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("transfers_started_at_idx").on(table.startedAt),
    index("transfers_session_id_idx").on(table.sessionId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at").notNull().default(sql`now()`),
    type: eventTypeEnum("type").notNull(),
    ip: text("ip").notNull(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  },
  (table) => [index("events_at_idx").on(table.at)],
);
