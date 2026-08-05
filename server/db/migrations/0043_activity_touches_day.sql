-- Keep itinerary_days.updated_at honest, from the database (#71).
--
-- A CUSTOM migration (`drizzle-kit generate --custom`): drizzle-kit cannot
-- express triggers in the schema, so this file is hand-written and the snapshot
-- it carries is unchanged from 0042. Re-runnable like everything from 0038 on:
-- `CREATE OR REPLACE FUNCTION`, and `DROP TRIGGER IF EXISTS` before each
-- `CREATE TRIGGER`. `when` is 1785926419618, above production's 1785913802947
-- watermark.
--
-- NOTE ON STATEMENT BREAKPOINTS: drizzle splits this file on the breakpoint
-- marker only -- a plain string match, which is why this comment describes the
-- marker rather than spelling it. The function bodies below contain semicolons
-- and MUST NOT be split, so no marker appears inside a `$$ ... $$` body, only
-- between whole statements.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT APPLICATION CODE
--
-- `updated_at` answers one question: has this day changed since a proposal
-- reasoned about it? A stale "no" is not cosmetic -- it re-enables an Undo that
-- restores a snapshot predating someone else's edits and discards them.
--
-- Application code cannot be trusted with that. A day changes without its own
-- row ever being touched (activities live in a separate table), every write
-- path would have to remember, and a forgotten one fails in the dangerous
-- direction. DELETE settles it outright: there is no row left to bump, yet "an
-- activity was removed" is precisely a change this must catch. The trigger sees
-- every writer -- other trip members, the restore endpoint, backfill scripts,
-- psql -- including code not yet written.
--
-- WHAT IS DELIBERATELY *NOT* TRIGGERED: travel_segments. Segments are derived
-- data, recomputed from a day's activities and accommodation by
-- computeAndSaveSegments AFTER those writes. They record no user intent, so
-- bumping the day for them would detect nothing the two triggers below miss,
-- while a recompute landing after an apply would supersede the user's own Undo.
CREATE OR REPLACE FUNCTION "trip_touch_day_from_activity"() RETURNS trigger AS $$
BEGIN
	-- The day the row is leaving (DELETE), or the day it was on (UPDATE).
	IF TG_OP <> 'INSERT' THEN
		UPDATE "itinerary_days" SET "updated_at" = now() WHERE "id" = OLD."itinerary_day_id";
	END IF;
	-- The day it is arriving on. On an UPDATE that does not move the activity
	-- this is the same row the branch above just bumped, so it is skipped; an
	-- activity dragged from one day to another changes BOTH days and bumps both.
	IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."itinerary_day_id" IS DISTINCT FROM OLD."itinerary_day_id") THEN
		UPDATE "itinerary_days" SET "updated_at" = now() WHERE "id" = NEW."itinerary_day_id";
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- AFTER, returning NULL, so the trigger can never alter or block the write it
-- is observing.
DROP TRIGGER IF EXISTS "trg_activities_touch_day" ON "activities";--> statement-breakpoint
CREATE TRIGGER "trg_activities_touch_day"
	AFTER INSERT OR UPDATE OR DELETE ON "activities"
	FOR EACH ROW EXECUTE FUNCTION "trip_touch_day_from_activity"();--> statement-breakpoint

-- The day row itself: accommodation, notes, date, stay. BEFORE UPDATE so it
-- writes into the row already being updated instead of issuing a second one.
--
-- The guard does two jobs. `NEW IS DISTINCT FROM OLD` keeps a no-op UPDATE from
-- counting as a change. The second half lets an explicit `updated_at` win --
-- which is what stops the activity trigger above (whose whole statement IS
-- `SET updated_at = now()`) from being rewritten here, and keeps a data
-- migration able to set the column deliberately.
CREATE OR REPLACE FUNCTION "trip_touch_day"() RETURNS trigger AS $$
BEGIN
	IF NEW IS DISTINCT FROM OLD AND NEW."updated_at" IS NOT DISTINCT FROM OLD."updated_at" THEN
		NEW."updated_at" = now();
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "trg_itinerary_days_touch" ON "itinerary_days";--> statement-breakpoint
CREATE TRIGGER "trg_itinerary_days_touch"
	BEFORE UPDATE ON "itinerary_days"
	FOR EACH ROW EXECUTE FUNCTION "trip_touch_day"();
