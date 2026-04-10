CREATE TABLE "visa_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_country" text NOT NULL,
	"destination_country" text NOT NULL,
	"visa_status" text NOT NULL,
	"max_stay_days" integer,
	"requirements" text,
	"processing_time" text,
	"cost" text,
	"notes" text,
	"source" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_visa_cache_lookup" ON "visa_cache" USING btree ("passport_country","destination_country");