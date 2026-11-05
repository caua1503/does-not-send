import { pgTable, text, timestamp, bigint, pgEnum, index } from "drizzle-orm/pg-core";

export const closeReasonEnum = pgEnum("close_reason", [
  "idle_timeout",
  "computer_lost",
  "phone_lost",
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

export const eventTypeEnum = pgEnum("event_type", ["pairing_refused", "qr_reused"]);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    visualId: text("visual_id").notNull(),
    computerIp: text("computer_ip"),
    phoneIp: text("phone_ip"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    pairedAt: timestamp("paired_at", { withTimezone: true, mode: "string" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "string" }),
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
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
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
    at: timestamp("at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    type: eventTypeEnum("type").notNull(),
    ip: text("ip").notNull(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  },
  (table) => [index("events_at_idx").on(table.at)],
);
