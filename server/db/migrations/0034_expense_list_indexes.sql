-- WHY THIS FILE'S `when` WAS RAISED BY HAND, AND WHY IT IS `IF NOT EXISTS`
--
-- drizzle-kit decides what to apply by a timestamp watermark, not by filename
-- index: pg-core/dialect.js only runs a migration whose `when` in
-- meta/_journal.json is strictly greater than the highest `created_at` already
-- recorded in drizzle.__drizzle_migrations.
--
-- Preview deploys used to run `vercel-build` (`nuxt build && drizzle-kit
-- migrate`) against the production database -- there was no environment gate
-- until the commit that added one on PR #68. Those preview runs pushed
-- production's watermark up to 1785903411291 while applying migrations from
-- branches that had never merged.
--
-- This file's original `when` was 1785902796244, which is *below* that
-- watermark. It would therefore have been skipped silently and permanently:
-- production would never get either index, and nothing would ever error to say
-- so. The `when` is raised above the watermark -- here and in the journal of
-- every downstream branch that carries this migration -- so that it runs.
--
-- Raising the `when` also means this file can now be applied to a database
-- that already has some of these objects, so every statement below is written
-- to be safely re-runnable: correct against a fresh database, a no-op against
-- one that already has the object.
DROP INDEX IF EXISTS "idx_expenses_trip_id";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_trip_created_at" ON "expenses" USING btree ("trip_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expenses_trip_paid_at" ON "expenses" USING btree ("trip_id","paid_at" DESC NULLS LAST,"id" DESC NULLS LAST);
