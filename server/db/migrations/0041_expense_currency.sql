ALTER TABLE "expenses" ADD COLUMN "currency_code" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "fx_rate" numeric(18, 8) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "amount_in_trip_currency" numeric(12, 2);--> statement-breakpoint
-- Backfill (hand-written, not generated). UNRESOLVED — see the PR discussion.
--
-- The obvious backfill is "every existing expense is already in its trip's
-- currency, at a rate of 1". That is NOT reliably true. `convertTripMoney`
-- multiplied `expenses.amount` in place, but `PUT /api/trips/:id` also let
-- `currencyCode` be swapped with no conversion of any stored amount — see
-- commit 77c5f34 (closes #53), which names `expenses.amount` explicitly. That
-- path was open for roughly four and a half months, so an unknown number of
-- rows hold an amount denominated in a currency the trip no longer has.
--
-- Stamping those rows `fx_rate = 1` permanently misstates what a user paid, and
-- this PR then makes the columns immutable. Do not merge until this is decided:
-- either audit the affected trips from the activity log, or leave
-- `currency_code` nullable and treat NULL as "provenance unknown" in reporting
-- rather than asserting a value that may be wrong.
--
-- The `'USD'` ADD COLUMN default above is a placeholder and is wrong for every
-- non-USD trip.
UPDATE "expenses" SET "currency_code" = "trips"."currency_code"
  FROM "trips" WHERE "trips"."id" = "expenses"."trip_id";--> statement-breakpoint
UPDATE "expenses" SET "amount_in_trip_currency" = "amount"
  WHERE "amount_in_trip_currency" IS NULL;
