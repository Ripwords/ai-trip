CREATE TABLE "flight_api_cache" (
	"flight_number" text NOT NULL,
	"flight_date" date NOT NULL,
	"response" jsonb,
	"not_found" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lookup_schema_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "flight_api_cache_flight_number_flight_date_pk" PRIMARY KEY("flight_number","flight_date")
);
