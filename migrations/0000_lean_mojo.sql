CREATE TABLE "adjustment_ranges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar,
	"service_line" text,
	"occupancy_min" real DEFAULT -0.1 NOT NULL,
	"occupancy_max" real DEFAULT 0.05 NOT NULL,
	"vacancy_min" real DEFAULT -0.15 NOT NULL,
	"vacancy_max" real DEFAULT 0 NOT NULL,
	"attributes_min" real DEFAULT -0.05 NOT NULL,
	"attributes_max" real DEFAULT 0.1 NOT NULL,
	"seasonality_min" real DEFAULT -0.05 NOT NULL,
	"seasonality_max" real DEFAULT 0.1 NOT NULL,
	"competitor_min" real DEFAULT -0.1 NOT NULL,
	"competitor_max" real DEFAULT 0.1 NOT NULL,
	"market_min" real DEFAULT -0.05 NOT NULL,
	"market_max" real DEFAULT 0.05 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "adjustment_rule_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" varchar,
	"executed_at" timestamp DEFAULT now(),
	"affected_units" integer NOT NULL,
	"adjustment_type" text NOT NULL,
	"adjustment_amount" real NOT NULL,
	"before_value" real,
	"after_value" real,
	"monthly_impact" real,
	"annual_impact" real,
	"volume_adjusted_annual_impact" real,
	"impact_summary" jsonb,
	"status" text NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "adjustment_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar,
	"service_line" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"is_active" boolean DEFAULT true,
	"priority" integer DEFAULT 0,
	"created_by" text,
	"last_executed" timestamp,
	"execution_count" integer DEFAULT 0,
	"monthly_impact" real DEFAULT 0,
	"annual_impact" real DEFAULT 0,
	"volume_adjusted_annual_impact" real DEFAULT 0,
	"actual_annual_impact" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_adjustment_ranges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occupancy_min" real DEFAULT -0.15,
	"occupancy_max" real DEFAULT 0.15,
	"vacancy_min" real DEFAULT -0.3,
	"vacancy_max" real DEFAULT 0,
	"attributes_min" real DEFAULT 0,
	"attributes_max" real DEFAULT 0.2,
	"competitor_min" real DEFAULT -0.15,
	"competitor_max" real DEFAULT 0.15,
	"seasonal_min" real DEFAULT -0.08,
	"seasonal_max" real DEFAULT 0.08,
	"market_min" real DEFAULT 0,
	"market_max" real DEFAULT 0.05,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_pricing_weights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occupancy_pressure" real DEFAULT 20,
	"days_vacant_decay" real DEFAULT 20,
	"room_attributes" real DEFAULT 15,
	"competitor_rates" real DEFAULT 15,
	"seasonality" real DEFAULT 15,
	"stock_market" real DEFAULT 15,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "assumptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"start_period" text NOT NULL,
	"months" integer NOT NULL,
	"revenue_monthly_growth_pct" real NOT NULL,
	"sp500_monthly_return_pct" real NOT NULL,
	"target_occupancy" real NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "attribute_ratings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_type" text NOT NULL,
	"rating_level" text NOT NULL,
	"adjustment_percent" real NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campus_maps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar,
	"name" text NOT NULL,
	"base_image_url" text,
	"svg_url" text,
	"svg_content" text,
	"width" integer,
	"height" integer,
	"is_template" boolean DEFAULT false,
	"is_published" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "competitive_survey_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_month" text NOT NULL,
	"keystats_location" text NOT NULL,
	"competitor_name" text NOT NULL,
	"competitor_address" text,
	"distance_miles" real,
	"competitor_type" text,
	"room_type" text,
	"square_footage" integer,
	"monthly_rate_low" real,
	"monthly_rate_high" real,
	"monthly_rate_avg" real,
	"care_fees_low" real,
	"care_fees_high" real,
	"care_fees_avg" real,
	"total_monthly_low" real,
	"total_monthly_high" real,
	"total_monthly_avg" real,
	"community_fee" real,
	"pet_fee" real,
	"other_fees" real,
	"incentives" text,
	"total_units" integer,
	"occupancy_rate" real,
	"year_built" integer,
	"last_renovation" integer,
	"amenities" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"location_id" varchar,
	"lat" real,
	"lng" real,
	"rates" jsonb,
	"avg_care_rate" real,
	"street_rate" real,
	"room_type" text,
	"attributes" jsonb,
	"address" text,
	"rank" integer,
	"weight" real,
	"rating" text,
	"service_lines" text[],
	"care_level_2_rate" real,
	"medication_management_fee" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "enquire_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_source" text NOT NULL,
	"enquire_location" text NOT NULL,
	"mapped_location_id" varchar,
	"mapped_service_line" text,
	"inquiry_id" text,
	"inquiry_date" text,
	"tour_date" text,
	"move_in_date" text,
	"lead_source" text,
	"lead_status" text,
	"prospect_name" text,
	"care_needs" text,
	"budget_range" text,
	"desired_move_in_date" text,
	"room_type_preference" text,
	"notes" text,
	"raw_data" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "floor_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"bedrooms" integer NOT NULL,
	"bathrooms" real NOT NULL,
	"sqft" integer,
	"description" text,
	"image_url" text,
	"amenities" text[],
	"service_line" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guardrails" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar,
	"service_line" text,
	"min_rate_decrease" real DEFAULT 0.05,
	"max_rate_increase" real DEFAULT 0.15,
	"occupancy_thresholds" jsonb,
	"seasonal_adjustments" jsonb,
	"competitor_variance_limit" real DEFAULT 0.1,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inquiry_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_month" text NOT NULL,
	"date" text NOT NULL,
	"region" text,
	"division" text,
	"location" text NOT NULL,
	"location_id" varchar,
	"service_line" text,
	"lead_source" text,
	"inquiry_count" integer DEFAULT 0,
	"tour_count" integer DEFAULT 0,
	"conversion_count" integer DEFAULT 0,
	"conversion_rate" real DEFAULT 0,
	"days_to_tour" integer DEFAULT 0,
	"days_to_move_in" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "location_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" text NOT NULL,
	"source_location" text NOT NULL,
	"target_location_id" varchar NOT NULL,
	"default_service_line" text,
	"confidence" real DEFAULT 1,
	"is_manual_mapping" boolean DEFAULT false,
	"mapped_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"matrixcare_name_hc" text,
	"matrixcare_name_al" text,
	"matrixcare_name_il" text,
	"customer_facility_id_hc" text,
	"customer_facility_id_al" text,
	"customer_facility_id_il" text,
	"location_code" text,
	"region" text,
	"division" text,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"lat" real,
	"lng" real,
	"total_units" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "portfolio_competitors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"portfolio_name" text,
	"locations" jsonb,
	"avg_portfolio_rate" real,
	"total_units" integer,
	"market_share" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pricing_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"action_type" text NOT NULL,
	"service_line" text,
	"units_affected" integer NOT NULL,
	"changes_snapshot" jsonb NOT NULL,
	"description" text NOT NULL,
	"user_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pricing_weights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" varchar,
	"service_line" text,
	"enable_weights" boolean DEFAULT true NOT NULL,
	"occupancy_pressure" integer NOT NULL,
	"days_vacant_decay" integer NOT NULL,
	"seasonality" integer NOT NULL,
	"competitor_rates" integer NOT NULL,
	"stock_market" integer NOT NULL,
	"inquiry_tour_volume" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_card" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_month" text NOT NULL,
	"location" text,
	"location_id" varchar,
	"room_type" text NOT NULL,
	"service_line" text NOT NULL,
	"average_street_rate" real,
	"average_modulo_rate" real,
	"average_ai_rate" real,
	"occupancy_count" integer,
	"total_units" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rent_roll_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_month" text NOT NULL,
	"date" text NOT NULL,
	"location" text NOT NULL,
	"location_id" varchar,
	"room_number" text NOT NULL,
	"room_type" text NOT NULL,
	"service_line" text NOT NULL,
	"occupied_yn" boolean NOT NULL,
	"days_vacant" integer DEFAULT 0,
	"preferred_location" text,
	"size" text NOT NULL,
	"view" text,
	"renovated" boolean DEFAULT false,
	"other_premium_feature" text,
	"location_rating" text,
	"size_rating" text,
	"view_rating" text,
	"renovation_rating" text,
	"amenity_rating" text,
	"street_rate" real NOT NULL,
	"in_house_rate" real NOT NULL,
	"discount_to_street_rate" real,
	"care_level" text,
	"care_rate" real,
	"rent_and_care_rate" real,
	"competitor_rate" real,
	"competitor_avg_care_rate" real,
	"competitor_final_rate" real,
	"modulo_suggested_rate" real,
	"modulo_calculation_details" text,
	"ai_suggested_rate" real,
	"ai_calculation_details" text,
	"promotion_allowance" real,
	"resident_id" text,
	"resident_name" text,
	"move_in_date" text,
	"move_out_date" text,
	"payor_type" text,
	"admission_status" text,
	"level_of_care" text,
	"medicaid_rate" real,
	"medicare_rate" real,
	"assessment_date" text,
	"marketing_source" text,
	"inquiry_count" integer DEFAULT 0,
	"tour_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rent_roll_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_month" text NOT NULL,
	"date" text NOT NULL,
	"location" text NOT NULL,
	"location_id" varchar,
	"room_number" text NOT NULL,
	"room_type" text NOT NULL,
	"service_line" text NOT NULL,
	"occupied_yn" boolean NOT NULL,
	"days_vacant" integer DEFAULT 0,
	"preferred_location" text,
	"size" text NOT NULL,
	"view" text,
	"renovated" boolean DEFAULT false,
	"other_premium_feature" text,
	"location_rating" text,
	"size_rating" text,
	"view_rating" text,
	"renovation_rating" text,
	"amenity_rating" text,
	"street_rate" real NOT NULL,
	"in_house_rate" real NOT NULL,
	"discount_to_street_rate" real,
	"care_level" text,
	"care_rate" real,
	"rent_and_care_rate" real,
	"competitor_rate" real,
	"competitor_avg_care_rate" real,
	"competitor_final_rate" real,
	"resident_id" text,
	"resident_name" text,
	"move_in_date" text,
	"move_out_date" text,
	"payor_type" text,
	"admission_status" text,
	"level_of_care" text,
	"medicaid_rate" real,
	"medicare_rate" real,
	"assessment_date" text,
	"marketing_source" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "special_rates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_name" text NOT NULL,
	"resident_id" text,
	"resident_name" text,
	"begin_date" text,
	"end_date" text,
	"payer_name" text,
	"proration" integer,
	"spcl_rate" integer,
	"amount" real,
	"pct" real,
	"monthly" integer,
	"hosp_hold" integer,
	"hosp_hold_amount" real,
	"hosp_pct" real,
	"hosp_hold_monthly" integer,
	"ther_lv" integer,
	"ther_lv_hold_amount" real,
	"ther_lv_pct" real,
	"ther_lv_hold_monthly" integer,
	"effective_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stock_market_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"data_type" text NOT NULL,
	"value" real NOT NULL,
	"metadata" jsonb,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "street_rates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_name" text NOT NULL,
	"facility_customer_id" text,
	"bed_type_description" text,
	"level_of_care" text,
	"room_charge_description" text,
	"base_price_begin_date" text,
	"base_price" real,
	"base_price_charge_by" text,
	"payer_begin_date" text,
	"payer_name" text,
	"payer_charge_by" text,
	"proration" text,
	"revenue_code" text,
	"allowable_charge" real,
	"allowable_percent" real,
	"hosp_bed_hold_rate" real,
	"hosp_bed_hold_percent" real,
	"ther_bed_hold_rate" real,
	"ther_bed_hold_percent" real,
	"revenue_account" text,
	"contractual_account" text,
	"copay_contractual_account" text,
	"effective_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "targets_and_trends" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"region" text,
	"division" text,
	"campus" text NOT NULL,
	"service_line" text NOT NULL,
	"budgeted_occupancy" real,
	"budgeted_rate" real,
	"room_rate_adjustment" real,
	"room_rate_adjustment_note" text,
	"budgeted_revpor" real,
	"community_fee_collection" real,
	"inquiries" integer,
	"tours" integer,
	"move_ins" integer,
	"conversion_rate" real,
	"avg_days_to_move_in" integer,
	"notes" text,
	"location_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unit_polygons" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campus_map_id" varchar NOT NULL,
	"rent_roll_data_id" varchar,
	"floor_plan_id" varchar,
	"polygon_coordinates" text NOT NULL,
	"normalized_coordinates" jsonb,
	"display_room_number" text,
	"default_service_line" text,
	"section_name" text,
	"label" text,
	"fill_color" text DEFAULT '#4CAF50',
	"stroke_color" text DEFAULT '#2E7D32',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "upload_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_month" text NOT NULL,
	"file_name" text NOT NULL,
	"upload_type" text NOT NULL,
	"location" text,
	"location_id" varchar,
	"total_records" integer,
	"processed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "adjustment_ranges" ADD CONSTRAINT "adjustment_ranges_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_rule_log" ADD CONSTRAINT "adjustment_rule_log_rule_id_adjustment_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."adjustment_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_rules" ADD CONSTRAINT "adjustment_rules_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campus_maps" ADD CONSTRAINT "campus_maps_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquire_data" ADD CONSTRAINT "enquire_data_mapped_location_id_locations_id_fk" FOREIGN KEY ("mapped_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrails" ADD CONSTRAINT "guardrails_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_metrics" ADD CONSTRAINT "inquiry_metrics_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_mappings" ADD CONSTRAINT "location_mappings_target_location_id_locations_id_fk" FOREIGN KEY ("target_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_mappings" ADD CONSTRAINT "location_mappings_mapped_by_users_id_fk" FOREIGN KEY ("mapped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_history" ADD CONSTRAINT "pricing_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_weights" ADD CONSTRAINT "pricing_weights_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_roll_data" ADD CONSTRAINT "rent_roll_data_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_roll_history" ADD CONSTRAINT "rent_roll_history_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets_and_trends" ADD CONSTRAINT "targets_and_trends_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_polygons" ADD CONSTRAINT "unit_polygons_campus_map_id_campus_maps_id_fk" FOREIGN KEY ("campus_map_id") REFERENCES "public"."campus_maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_polygons" ADD CONSTRAINT "unit_polygons_rent_roll_data_id_rent_roll_data_id_fk" FOREIGN KEY ("rent_roll_data_id") REFERENCES "public"."rent_roll_data"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_polygons" ADD CONSTRAINT "unit_polygons_floor_plan_id_floor_plans_id_fk" FOREIGN KEY ("floor_plan_id") REFERENCES "public"."floor_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_history" ADD CONSTRAINT "upload_history_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adjustment_ranges_unique_scope" ON "adjustment_ranges" USING btree ("location_id","service_line");--> statement-breakpoint
CREATE UNIQUE INDEX "adjustment_rules_unique_scope" ON "adjustment_rules" USING btree ("name","location_id","service_line");--> statement-breakpoint
CREATE UNIQUE INDEX "guardrails_unique_scope" ON "guardrails" USING btree ("location_id","service_line");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");