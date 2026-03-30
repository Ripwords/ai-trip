CREATE TABLE "packing_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"user_id" text,
	"is_global" boolean DEFAULT false NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "packing_templates" ADD CONSTRAINT "packing_templates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_packing_templates_user_id" ON "packing_templates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_packing_templates_is_global" ON "packing_templates" USING btree ("is_global");