CREATE INDEX "idx_activity_comments_user_id" ON "activity_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_documents_uploaded_by" ON "documents" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE INDEX "idx_travel_segments_to" ON "travel_segments" USING btree ("to_activity_id");--> statement-breakpoint
CREATE INDEX "idx_trip_members_invite_token" ON "trip_members" USING btree ("invite_token");--> statement-breakpoint
CREATE INDEX "idx_reservations_created_by" ON "reservations" USING btree ("created_by_id");