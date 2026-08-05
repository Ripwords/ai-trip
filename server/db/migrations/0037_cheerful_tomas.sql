-- Guarded by hand. Preview deploys used to run `vercel-build` (`nuxt build &&
-- drizzle-kit migrate`) against the production database -- there was no
-- environment gate until the commit that added one on PR #68 -- so this branch
-- has already been applied there under its old, lower migration number.
-- Production has `trip_generation_runs` and `trip_generation_run_days` today,
-- even though this branch has not merged.
--
-- Renumbering for the agreed merge order gave this file a `when` above
-- production's watermark (1785903411291), so drizzle will now try to create
-- those tables a second time. Unguarded that is a `42P07 duplicate table` and a
-- failed production deploy. Production was deliberately NOT touched to repair
-- this; the migration is made idempotent instead, so it is correct both against
-- a fresh database and against production's already-populated one.
CREATE TABLE IF NOT EXISTS "trip_generation_run_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claimed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"mode" text DEFAULT 'generic' NOT NULL,
	"outline" jsonb,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trip_generation_run_days" ADD CONSTRAINT "trip_generation_run_days_run_id_trip_generation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."trip_generation_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trip_generation_run_days" ADD CONSTRAINT "trip_generation_run_days_day_id_itinerary_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."itinerary_days"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trip_generation_runs" ADD CONSTRAINT "trip_generation_runs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trip_generation_runs" ADD CONSTRAINT "trip_generation_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_trip_generation_run_days_run_day" ON "trip_generation_run_days" USING btree ("run_id","day_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trip_generation_runs_trip_id" ON "trip_generation_runs" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_trip_generation_runs_active" ON "trip_generation_runs" USING btree ("trip_id") WHERE status = 'running';
