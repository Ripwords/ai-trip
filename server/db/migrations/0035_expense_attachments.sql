-- Guarded by hand. Preview deploys used to run `vercel-build` (`nuxt build &&
-- drizzle-kit migrate`) against the production database, so this migration has
-- already been applied there: production has `expense_attachments` and
-- `stored_objects` even though this branch has not merged.
--
-- Its `when` was also raised, because 0034_expense_list_indexes.sql had to move
-- above production's watermark (1785903411291) and the journal must stay
-- strictly ascending. 0035's original `when` was exactly that watermark, i.e.
-- it would not have re-run; now it sits above it and will. Every statement is
-- therefore written to be safely re-runnable: correct against a fresh database,
-- a no-op against production's, which already has all of it.
CREATE TABLE IF NOT EXISTS "expense_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stored_objects" (
	"key" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_attachments_expense" ON "expense_attachments" USING btree ("expense_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_expense_attachments_trip" ON "expense_attachments" USING btree ("trip_id");
