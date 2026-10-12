ALTER TABLE "activities" ALTER COLUMN "cost_estimate" SET DATA TYPE numeric(16, 2);--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "actual_cost" SET DATA TYPE numeric(16, 2);--> statement-breakpoint
ALTER TABLE "trips" ALTER COLUMN "budget" SET DATA TYPE numeric(16, 2);--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "amount" SET DATA TYPE numeric(16, 2);