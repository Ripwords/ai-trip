DROP INDEX "idx_visa_cache_lookup";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_visa_cache_lookup" ON "visa_cache" USING btree ("passport_country","destination_country");