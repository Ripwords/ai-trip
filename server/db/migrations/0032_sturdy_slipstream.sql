ALTER TABLE "trips" ADD COLUMN "expense_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill from the rows that already exist, otherwise every existing trip
-- starts at 0 and can be pushed past the cap. Clamped to the cap so the CHECK
-- below is satisfiable even for a trip that the old, racy check let overshoot;
-- such a trip simply cannot add more expenses until some are deleted.
UPDATE "trips" SET "expense_count" = LEAST(counted.total, 200)
FROM (
  SELECT "trip_id", COUNT(*) AS total FROM "expenses" GROUP BY "trip_id"
) AS counted
WHERE counted."trip_id" = "trips"."id";--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_expense_count_within_cap" CHECK ("trips"."expense_count" between 0 and 200);
