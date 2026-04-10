CREATE TABLE "visited_countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"country_code" text NOT NULL,
	"country_name" text NOT NULL,
	"visited_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"nationality" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visited_countries" ADD CONSTRAINT "visited_countries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_visited_countries_user_country" ON "visited_countries" USING btree ("user_id","country_code");--> statement-breakpoint
CREATE INDEX "idx_visited_countries_user_id" ON "visited_countries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_profiles_user_id" ON "user_profiles" USING btree ("user_id");