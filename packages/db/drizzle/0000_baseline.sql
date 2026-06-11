CREATE TYPE "public"."change_event_status" AS ENUM('detected', 'triaged', 'synthesized', 'verified', 'in_review', 'published', 'rejected', 'archived', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel" AS ENUM('web', 'email', 'slack');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'needs_edit');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('federal_register', 'ecfr', 'openstates', 'agency_rss', 'state_register_pdf');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'blocked');--> statement-breakpoint
CREATE TABLE "canonical_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"citation" text NOT NULL,
	"heading" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"topic_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_version_id" text,
	"current_hash" text
);
--> statement-breakpoint
CREATE TABLE "change_events" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"old_version_id" text NOT NULL,
	"new_version_id" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"structural_diff" jsonb NOT NULL,
	"status" "change_event_status" DEFAULT 'detected' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"delta_id" text NOT NULL,
	"template_id" text NOT NULL,
	"rendered_docx_url" text,
	"exported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"delta_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deltas" (
	"id" text PRIMARY KEY NOT NULL,
	"jurisdiction" text NOT NULL,
	"topic" text NOT NULL,
	"change_event_ids" jsonb NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"effective_date" date NOT NULL,
	"citations" jsonb NOT NULL,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"published_at" timestamp with time zone,
	"token_cost" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"jurisdictions" jsonb NOT NULL,
	"practice_areas" jsonb NOT NULL,
	"client_types" jsonb NOT NULL,
	"topic_weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correction_history" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_records" (
	"id" text PRIMARY KEY NOT NULL,
	"delta_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "section_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"normalized_text" text NOT NULL,
	"normalized_paragraphs" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"source_url" text NOT NULL,
	"effective_date" date,
	"supersedes_version_id" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "source_kind" NOT NULL,
	"jurisdiction" text NOT NULL,
	"feed_url" text NOT NULL,
	"parser_id" text NOT NULL,
	"schedule" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_crawled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"plan_tier" text DEFAULT 'trial' NOT NULL,
	"jurisdiction_bundles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage_manifest_accepted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "canonical_sections" ADD CONSTRAINT "canonical_sections_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_section_id_canonical_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."canonical_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_old_version_id_section_versions_id_fk" FOREIGN KEY ("old_version_id") REFERENCES "public"."section_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_new_version_id_section_versions_id_fk" FOREIGN KEY ("new_version_id") REFERENCES "public"."section_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_alerts" ADD CONSTRAINT "client_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_alerts" ADD CONSTRAINT "client_alerts_delta_id_deltas_id_fk" FOREIGN KEY ("delta_id") REFERENCES "public"."deltas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_delta_id_deltas_id_fk" FOREIGN KEY ("delta_id") REFERENCES "public"."deltas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_profiles" ADD CONSTRAINT "practice_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_records" ADD CONSTRAINT "review_records_delta_id_deltas_id_fk" FOREIGN KEY ("delta_id") REFERENCES "public"."deltas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_section_id_canonical_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."canonical_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "canonical_sections_citation_idx" ON "canonical_sections" USING btree ("citation");