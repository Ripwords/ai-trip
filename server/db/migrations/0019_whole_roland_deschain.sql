CREATE TABLE "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trip_id" uuid,
	"flight_number" text NOT NULL,
	"flight_date" date NOT NULL,
	"airline" text,
	"departure_airport" text,
	"arrival_airport" text,
	"departure_time" timestamp with time zone,
	"arrival_time" timestamp with time zone,
	"terminal" text,
	"gate" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"raw_api_response" jsonb,
	"api_last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visa_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passport_country" text NOT NULL,
	"destination_country" text NOT NULL,
	"visa_status" text NOT NULL,
	"max_stay_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flights" ADD CONSTRAINT "flights_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_flights_user_flight_date" ON "flights" USING btree ("user_id","flight_number","flight_date");--> statement-breakpoint
CREATE INDEX "idx_flights_user_id" ON "flights" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_flights_trip_id" ON "flights" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_visa_req_lookup" ON "visa_requirements" USING btree ("passport_country","destination_country");