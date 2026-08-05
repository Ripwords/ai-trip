-- Per-expense currency (#47).
--
-- Written to be safely re-runnable (`IF NOT EXISTS`, the CHECK in a
-- DO ... EXCEPTION block), matching 0034-0040 on the branches below this one.
-- Production does NOT currently have any of these columns, so unlike those
-- files this one is not repairing damage that already happened -- it is
-- insurance. Preview deploys used to run `vercel-build` (`nuxt build &&
-- drizzle-kit migrate`) straight against production, which is how the rest of
-- this stack ended up half-applied there; a re-runnable migration is the only
-- thing that makes a partially-applied deploy recoverable without hand-editing
-- production. The gate added on PR #68 stops new instances of the problem, but
-- costs nothing to defend against here too.
--
-- `amount` is widened from numeric(10,2) first. The old ceiling was
-- 99,999,999.99, which is roughly USD 3,800 once the amount is denominated in
-- VND. While a trip had exactly one currency that was only reachable by a
-- genuinely enormous expense; with a per-expense currency an ordinary Hanoi
-- hotel bill reaches it, and Postgres answers with a bare `22003 numeric field
-- overflow` that surfaces as an unhandled 500.
ALTER TABLE "expenses" ALTER COLUMN "amount" SET DATA TYPE numeric(16, 2);--> statement-breakpoint

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "currency_code" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "fx_rate" numeric(18, 8);--> statement-breakpoint
-- Added nullable here and made NOT NULL at the bottom of this file, once every
-- existing row has a value. `ADD COLUMN ... NOT NULL` with no default fails
-- outright on a non-empty table.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "amount_in_trip_currency" numeric(16, 2);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill. Hand-written, and deliberately does NOT claim to know which
-- currency an existing expense was paid in.
--
-- The tempting backfill is `currency_code = trips.currency_code, fx_rate = 1`,
-- justified by "changing the trip currency used to multiply `amount` in place,
-- so every stored amount is already in its trip's currency". That justification
-- is false. `convertTripMoney` did multiply in place, but it was not the only
-- way a trip's currency could change: `PUT /api/trips/:id` accepted
-- `{"currencyCode":"JPY"}` and swapped the code without converting a single
-- stored amount. Commit 77c5f34 (closes #53) names `expenses.amount`
-- explicitly. That path was open from the initial commit (2026-03-22) until
-- 77c5f34 — roughly four and a half months.
--
-- For any trip that went through it, `amount` is denominated in a currency the
-- trip no longer has. Stamping those rows with the trip's *current* code and a
-- rate of 1 would permanently misstate what someone actually paid — and #47
-- makes `amount` and `currency_code` immutable, so the error would be
-- unrecoverable. That is the precise opposite of the provenance this issue
-- exists to protect.
--
-- Two options were considered: (a) reconstruct each trip's currency history
-- from the activity log, or (b) leave `currency_code` NULL, meaning
-- "provenance unknown".
--
-- (a) is not implementable. `trip_updated` has logged the constant string
-- "Trip details updated" with NULL metadata since the initial commit — no
-- before, no after, no currency — and `POST /convert-currency` does not call
-- `logTripAction` at all. There is no record anywhere of any currency change,
-- legitimate or otherwise. There is nothing to reconstruct from and no way to
-- even size the affected population; auditing would mean inventing the audit
-- trail retroactively.
--
-- So (b). Every pre-existing row gets currency_code = NULL and fx_rate = NULL,
-- which is the only true statement available about it. Nothing is asserted and
-- nothing is destroyed, and a NULL stays recoverable — a user can tell us, or a
-- later migration can fill it in — where a wrong stamp on an immutable column
-- never is. The unknown set is closed the moment this migration runs: every row
-- written afterwards carries a real, validated code.
--
-- Mitigating, and why this is a bounded problem rather than a data disaster: no
-- shipped client ever sent `currencyCode` on that route, so the exposure is
-- direct-API callers only and may well be zero rows. It is the *unknowability*
-- that decides the design here, not the expected count.
--
-- `amount_in_trip_currency` is still populated for these rows, with `amount`
-- verbatim. That is not an assertion about currency: it is the figure the
-- application has always displayed for this row, carried forward unchanged so
-- that deploying this migration moves no total on any existing trip. Readers
-- get a number; only the *explanation* of that number is recorded as unknown.
UPDATE "expenses" SET "amount_in_trip_currency" = "amount"
  WHERE "amount_in_trip_currency" IS NULL;--> statement-breakpoint

-- Total from here on. Every read path depended on this: while the column was
-- nullable each one carried a `COALESCE(amount_in_trip_currency, amount)`
-- fallback, and `amount` is denominated in the expense's own currency — so a
-- ¥3,200 row on a USD trip was read as $3,200.00, and re-projected to EUR as
-- 2944 instead of ~19. NOT NULL makes that class of mistake unrepresentable
-- rather than something every new reader has to remember not to write.
ALTER TABLE "expenses" ALTER COLUMN "amount_in_trip_currency" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_provenance_check" CHECK (("expenses"."currency_code" IS NULL) = ("expenses"."fx_rate" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
