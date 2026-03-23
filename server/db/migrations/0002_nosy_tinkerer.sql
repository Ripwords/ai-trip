CREATE TABLE "activity_log" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"month" text NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_members" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" text,
	"role" text DEFAULT 'editor' NOT NULL,
	"invited_by" text,
	"invited_email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invite_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paid_by_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "splits" jsonb;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_log_trip_id" ON "activity_log" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_user_id" ON "activity_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_created_at" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_user_id" ON "ai_usage" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ai_usage_user_month" ON "ai_usage" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "idx_trip_members_trip_id" ON "trip_members" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "idx_trip_members_user_id" ON "trip_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_trip_members_invited_email" ON "trip_members" USING btree ("invited_email");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_id_user_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_expenses_paid_by" ON "expenses" USING btree ("paid_by_id");