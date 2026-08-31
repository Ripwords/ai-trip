UPDATE "trips" SET "status" = 'active' WHERE "status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_status_is_lifecycle" CHECK ("trips"."status" in ('active', 'cancelled'));