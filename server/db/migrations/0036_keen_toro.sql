-- Guarded by hand. Preview deploys used to run `vercel-build` (`nuxt build &&
-- drizzle-kit migrate`) against the production database -- there was no
-- environment gate until the commit that added one on PR #68 -- so this branch
-- has already been applied there under its old, lower migration number.
-- Production has `trip_chat_messages` today, even though this branch has not
-- merged.
--
-- Renumbering for the agreed merge order gave this file a `when` above
-- production's watermark (1785903411291), so drizzle will now try to create
-- that table a second time. Unguarded that is a `42P07 duplicate table` and a
-- failed production deploy. Production was deliberately NOT touched to repair
-- this; the migration is made idempotent instead, so it is correct both against
-- a fresh database and against production's already-populated one.
CREATE TABLE IF NOT EXISTS "trip_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_call_summary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trip_chat_messages" ADD CONSTRAINT "trip_chat_messages_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trip_chat_messages" ADD CONSTRAINT "trip_chat_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trip_chat_messages_thread" ON "trip_chat_messages" USING btree ("trip_id","user_id","created_at");
