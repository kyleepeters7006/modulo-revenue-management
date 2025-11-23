ALTER TABLE "competitive_survey_data" ADD COLUMN "care_level_1_rate" real;--> statement-breakpoint
ALTER TABLE "competitive_survey_data" ADD COLUMN "care_level_2_rate" real;--> statement-breakpoint
ALTER TABLE "competitive_survey_data" ADD COLUMN "care_level_3_rate" real;--> statement-breakpoint
ALTER TABLE "competitive_survey_data" ADD COLUMN "care_level_4_rate" real;--> statement-breakpoint
ALTER TABLE "competitive_survey_data" ADD COLUMN "medication_management_fee" real;--> statement-breakpoint
ALTER TABLE "pricing_weights" ADD COLUMN "room_attributes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "rent_roll_data" ADD COLUMN "competitor_name" text;--> statement-breakpoint
ALTER TABLE "rent_roll_data" ADD COLUMN "competitor_base_rate" real;--> statement-breakpoint
ALTER TABLE "rent_roll_data" ADD COLUMN "competitor_weight" real;--> statement-breakpoint
ALTER TABLE "rent_roll_data" ADD COLUMN "competitor_care_level2_adjustment" real;--> statement-breakpoint
ALTER TABLE "rent_roll_data" ADD COLUMN "competitor_med_management_adjustment" real;--> statement-breakpoint
ALTER TABLE "rent_roll_data" ADD COLUMN "competitor_adjustment_explanation" text;