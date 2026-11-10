CREATE TYPE "public"."category" AS ENUM('images', 'videos', 'audios', 'pdfs', 'documents', 'archives', 'other');--> statement-breakpoint
CREATE TYPE "public"."close_reason" AS ENUM('user_closed', 'closed', 'server_restart');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('pairing_refused');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('receiving', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "event_type" NOT NULL,
	"ip" text NOT NULL,
	"session_id" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"visual_id" text NOT NULL,
	"computer_ip" text,
	"phone_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paired_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" "close_reason"
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"name" text NOT NULL,
	"extension" text NOT NULL,
	"mime" text NOT NULL,
	"category" "category" NOT NULL,
	"size" bigint NOT NULL,
	"status" "transfer_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "sessions_created_at_idx" ON "sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transfers_started_at_idx" ON "transfers" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "transfers_session_id_idx" ON "transfers" USING btree ("session_id");