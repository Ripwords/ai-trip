-- Guarded by hand. See 0040_clear_starhawk.sql for the full explanation: an
-- earlier preview deploy ran drizzle-kit migrate against production while this
-- branch still carried its old timestamps, so part of this branch may already
-- exist there. Every statement below is written to be safely re-runnable --
-- correct against a fresh database, a no-op against one that already has the
-- object.
CREATE TABLE IF NOT EXISTS "stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" text NOT NULL,
	"place_id" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itinerary_days" ADD COLUMN IF NOT EXISTS "stay_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "stays" ADD CONSTRAINT "stays_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stays_trip_id" ON "stays" USING btree ("trip_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "itinerary_days" ADD CONSTRAINT "itinerary_days_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_itinerary_days_stay_id" ON "itinerary_days" USING btree ("stay_id");
