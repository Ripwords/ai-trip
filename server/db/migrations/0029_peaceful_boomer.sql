ALTER TABLE "trips" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "country_code" char(2);--> statement-breakpoint
CREATE INDEX "idx_trips_country_code" ON "trips" USING btree ("country_code");--> statement-breakpoint
UPDATE "trips" SET "name" = "destination" WHERE "name" IS NULL;