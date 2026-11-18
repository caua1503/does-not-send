CREATE TYPE "public"."participant_role" AS ENUM('host', 'guest');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('oneway', 'twoway');--> statement-breakpoint
CREATE TABLE "session_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" "participant_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mode" "session_mode";--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_participants_session_id_idx" ON "session_participants" USING btree ("session_id");
