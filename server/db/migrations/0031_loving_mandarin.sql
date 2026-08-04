-- paid_at becomes a calendar date. Hand-edited from drizzle-kit's generated
-- `SET DATA TYPE date` to add an explicit USING clause.
--
-- Without USING, Postgres casts timestamptz -> date using the *session*
-- TimeZone, so the same migration would produce different dates depending on
-- where it runs. Existing rows were written by the client as
-- `new Date("YYYY-MM-DD").toISOString()` — i.e. UTC midnight — so converting
-- at UTC recovers exactly the date the user originally picked.
ALTER TABLE "expenses" ALTER COLUMN "paid_at" SET DATA TYPE date
  USING ("paid_at" AT TIME ZONE 'UTC')::date;
