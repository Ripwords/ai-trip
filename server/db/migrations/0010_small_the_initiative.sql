CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"name" text NOT NULL,
	"confirmation_number" text,
	"provider" text,
	"notes" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"amount" numeric(10, 2),
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reservations_trip_id" ON "reservations" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "idx_reservations_type" ON "reservations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_reservations_status" ON "reservations" USING btree ("status");