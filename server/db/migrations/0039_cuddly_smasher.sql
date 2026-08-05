-- Guarded by hand. See 0040_clear_starhawk.sql for the full explanation: an
-- earlier preview deploy ran drizzle-kit migrate against production while this
-- branch still carried its old timestamps, so part of this branch may already
-- exist there. Every statement below is safely re-runnable.
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "stay_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "reservations" ADD CONSTRAINT "reservations_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_reservations_stay" ON "reservations" USING btree ("stay_id") WHERE stay_id IS NOT NULL;
