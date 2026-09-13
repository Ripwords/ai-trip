ALTER TABLE "flights" ADD COLUMN "scheduled_departure_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "actual_departure_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "scheduled_arrival_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "actual_arrival_time" timestamp with time zone;--> statement-breakpoint
UPDATE "flights" SET "scheduled_departure_time" = "departure_time", "scheduled_arrival_time" = "arrival_time" WHERE "raw_api_response" IS NOT NULL;--> statement-breakpoint
UPDATE "flights" SET "actual_departure_time" = "departure_time", "actual_arrival_time" = "arrival_time" WHERE "raw_api_response" IS NULL;--> statement-breakpoint
ALTER TABLE "flights" drop column "departure_time";--> statement-breakpoint
ALTER TABLE "flights" drop column "arrival_time";--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "departure_time" timestamp with time zone GENERATED ALWAYS AS (coalesce(actual_departure_time, scheduled_departure_time)) STORED;--> statement-breakpoint
ALTER TABLE "flights" ADD COLUMN "arrival_time" timestamp with time zone GENERATED ALWAYS AS (coalesce(actual_arrival_time, scheduled_arrival_time)) STORED;
