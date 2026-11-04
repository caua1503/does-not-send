import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { sessions, transfers, events } from "./schema.js";

export type DbSession = InferSelectModel<typeof sessions>;
export type DbInsertSession = InferInsertModel<typeof sessions>;

export type DbTransfer = InferSelectModel<typeof transfers>;
export type DbInsertTransfer = InferInsertModel<typeof transfers>;

export type DbEvent = InferSelectModel<typeof events>;
export type DbInsertEvent = InferInsertModel<typeof events>;
