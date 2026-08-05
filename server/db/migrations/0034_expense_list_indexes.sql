DROP INDEX "idx_expenses_trip_id";--> statement-breakpoint
CREATE INDEX "idx_expenses_trip_created_at" ON "expenses" USING btree ("trip_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_expenses_trip_paid_at" ON "expenses" USING btree ("trip_id","paid_at" DESC NULLS LAST,"id" DESC NULLS LAST);