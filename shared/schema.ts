import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  real,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Service line options for senior living facilities
export const serviceLineEnum = ["AL", "AL/MC", "HC", "HC/MC", "IL", "SL"] as const;
export type ServiceLine = typeof serviceLineEnum[number];

// Targets and Trends Table
export const targetsAndTrends = pgTable("targets_and_trends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  month: text("month").notNull(), // YYYY-MM format
  region: text("region"),
  division: text("division"),
  campus: text("campus").notNull(),
  serviceLine: text("service_line").notNull(),
  budgetedOccupancy: real("budgeted_occupancy"), // percentage
  budgetedRate: real("budgeted_rate"), // ADR
  roomRateAdjustment: real("room_rate_adjustment"), // percentage
  roomRateAdjustmentNote: text("room_rate_adjustment_note"),
  budgetedRevPOR: real("budgeted_revpor"),
  communityFeeCollection: real("community_fee_collection"), // percentage
  inquiries: integer("inquiries"),
  tours: integer("tours"),
  moveIns: integer("move_ins"),
  conversionRate: real("conversion_rate"), // auto-calculated
  avgDaysToMoveIn: integer("avg_days_to_move_in"),
  notes: text("notes"),
  locationId: varchar("location_id").references(() => locations.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Portfolio locations table with KeyStats/MatrixCare name mapping
export const locations = pgTable("locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // KeyStats name (display name)
  matrixCareNameHC: text("matrixcare_name_hc"), // MatrixCare facility name for HC
  matrixCareNameAL: text("matrixcare_name_al"), // MatrixCare facility name for AL  
  matrixCareNameIL: text("matrixcare_name_il"), // MatrixCare facility name for IL
  customerFacilityIdHC: text("customer_facility_id_hc"), // Customer ID for HC
  customerFacilityIdAL: text("customer_facility_id_al"), // Customer ID for AL
  customerFacilityIdIL: text("customer_facility_id_il"), // Customer ID for IL
  locationCode: text("location_code"), // 4-digit location code
  region: text("region"),
  division: text("division"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  lat: real("lat"),
  lng: real("lng"),
  totalUnits: integer("total_units").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Updated rent roll data table with complete field structure
export const rentRollData = pgTable("rent_roll_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(), // Format: YYYY-MM
  date: text("date").notNull(),
  location: text("location").notNull(),
  locationId: varchar("location_id").references(() => locations.id),
  roomNumber: text("room_number").notNull(),
  roomType: text("room_type").notNull(),
  serviceLine: text("service_line").notNull(), // AL, AL/MC, HC, HC/MC, IL, SL
  occupiedYN: boolean("occupied_yn").notNull(),
  daysVacant: integer("days_vacant").default(0),
  preferredLocation: text("preferred_location"), // Premium location flag
  size: text("size").notNull(), // Studio, One Bedroom, Two Bedroom
  view: text("view"), // Garden View, Courtyard View, Street View
  renovated: boolean("renovated").default(false),
  otherPremiumFeature: text("other_premium_feature"),
  // A/B/C attribute ratings
  locationRating: text("location_rating"), // A, B, or C
  sizeRating: text("size_rating"), // A, B, or C  
  viewRating: text("view_rating"), // A, B, or C
  renovationRating: text("renovation_rating"), // A, B, or C
  amenityRating: text("amenity_rating"), // A, B, or C
  streetRate: real("street_rate").notNull(),
  inHouseRate: real("in_house_rate").notNull(),
  discountToStreetRate: real("discount_to_street_rate"),
  careLevel: text("care_level"),
  careRate: real("care_rate"),
  rentAndCareRate: real("rent_and_care_rate"),
  competitorRate: real("competitor_rate"),
  competitorAvgCareRate: real("competitor_avg_care_rate"),
  competitorFinalRate: real("competitor_final_rate"),
  moduloSuggestedRate: real("modulo_suggested_rate"),
  moduloCalculationDetails: text("modulo_calculation_details"), // JSON string of Modulo calculation breakdown
  aiSuggestedRate: real("ai_suggested_rate"),
  aiCalculationDetails: text("ai_calculation_details"), // JSON string of AI calculation breakdown
  promotionAllowance: real("promotion_allowance"),
  // MatrixCare specific fields
  residentId: text("resident_id"), // Unique resident identifier for MatrixCare
  residentName: text("resident_name"), // Full name of resident
  moveInDate: text("move_in_date"), // Date resident moved in
  moveOutDate: text("move_out_date"), // Date resident moved out (if applicable)
  payorType: text("payor_type"), // Private Pay, Medicaid, Medicare, Insurance
  admissionStatus: text("admission_status"), // New, Transfer, Readmission
  levelOfCare: text("level_of_care"), // IL, AL, MC, SNF
  medicaidRate: real("medicaid_rate"), // Medicaid reimbursement rate if applicable
  medicareRate: real("medicare_rate"), // Medicare reimbursement rate if applicable
  assessmentDate: text("assessment_date"), // Date of last care assessment
  marketingSource: text("marketing_source"), // How resident found the facility
  createdAt: timestamp("created_at").defaultNow(),
});

// Rate card summary by room type and service line
export const rateCard = pgTable("rate_card", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(),
  location: text("location"),
  locationId: varchar("location_id").references(() => locations.id),
  roomType: text("room_type").notNull(),
  serviceLine: text("service_line").notNull(), // AL, AL/MC, HC, HC/MC, IL, SL
  averageStreetRate: real("average_street_rate"),
  averageModuloRate: real("average_modulo_rate"),
  averageAiRate: real("average_ai_rate"),
  occupancyCount: integer("occupancy_count"),
  totalUnits: integer("total_units"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const assumptions = pgTable("assumptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startPeriod: text("start_period").notNull(),
  months: integer("months").notNull(),
  revenueMonthlyGrowthPct: real("revenue_monthly_growth_pct").notNull(),
  sp500MonthlyReturnPct: real("sp500_monthly_return_pct").notNull(),
  targetOccupancy: real("target_occupancy").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const pricingWeights = pgTable("pricing_weights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  occupancyPressure: integer("occupancy_pressure").notNull(),
  daysVacantDecay: integer("days_vacant_decay").notNull(),
  roomAttributes: integer("room_attributes").notNull(),
  seasonality: integer("seasonality").notNull(),
  competitorRates: integer("competitor_rates").notNull(),
  stockMarket: integer("stock_market").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitors = pgTable("competitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  location: text("location"), // Which portfolio location this competitor is for
  locationId: varchar("location_id").references(() => locations.id),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  rates: jsonb("rates"),
  avgCareRate: real("avg_care_rate"),
  streetRate: real("street_rate"),
  roomType: text("room_type"),
  attributes: jsonb("attributes"),
  address: text("address"),
  rank: integer("rank"),
  weight: real("weight"),
  rating: text("rating"), // A, B, or C
  createdAt: timestamp("created_at").defaultNow(),
});

// Stock market data cache
export const stockMarketCache = pgTable("stock_market_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(), // e.g., "SPY" for S&P 500
  dataType: text("data_type").notNull(), // e.g., "monthly_return", "daily_price"
  value: real("value").notNull(),
  metadata: jsonb("metadata"), // Additional data like full API response
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(), // When this cache entry expires
  createdAt: timestamp("created_at").defaultNow(),
});

// Adjustment ranges for each pricing factor
export const adjustmentRanges = pgTable("adjustment_ranges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  occupancyMin: real("occupancy_min").notNull().default(-0.10), // -10% at low occupancy
  occupancyMax: real("occupancy_max").notNull().default(0.05), // +5% at high occupancy
  vacancyMin: real("vacancy_min").notNull().default(-0.15), // -15% for long vacancy
  vacancyMax: real("vacancy_max").notNull().default(0.00), // 0% for new vacancy
  attributesMin: real("attributes_min").notNull().default(-0.05), // -5% for poor attributes
  attributesMax: real("attributes_max").notNull().default(0.10), // +10% for premium attributes
  seasonalityMin: real("seasonality_min").notNull().default(-0.05), // -5% off-season
  seasonalityMax: real("seasonality_max").notNull().default(0.10), // +10% peak season
  competitorMin: real("competitor_min").notNull().default(-0.10), // -10% when above market
  competitorMax: real("competitor_max").notNull().default(0.10), // +10% when below market
  marketMin: real("market_min").notNull().default(-0.05), // -5% bear market
  marketMax: real("market_max").notNull().default(0.05), // +5% bull market
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Dynamic pricing guardrails
export const guardrails = pgTable("guardrails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  minRateDecrease: real("min_rate_decrease").default(0.05), // 5% minimum
  maxRateIncrease: real("max_rate_increase").default(0.15), // 15% maximum
  occupancyThresholds: jsonb("occupancy_thresholds"), // Different rates for different occupancy levels
  seasonalAdjustments: jsonb("seasonal_adjustments"),
  competitorVarianceLimit: real("competitor_variance_limit").default(0.10), // 10% variance from competitor rates
  createdAt: timestamp("created_at").defaultNow(),
});

// Attribute ratings configuration - A/B/C values for each attribute type
export const attributeRatings = pgTable("attribute_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  attributeType: text("attribute_type").notNull(), // location, size, view, renovation, amenity
  ratingLevel: text("rating_level").notNull(), // A, B, C
  adjustmentPercent: real("adjustment_percent").notNull(), // Percentage adjustment for pricing
  description: text("description"), // Description of what this rating means
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Upload history tracking
export const uploadHistory = pgTable("upload_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(), // YYYY-MM format
  fileName: text("file_name").notNull(),
  uploadType: text("upload_type").notNull(), // 'rent_roll' or 'competitors'
  location: text("location"), // Which location this upload is for
  locationId: varchar("location_id").references(() => locations.id),
  totalRecords: integer("total_records"),
  processedAt: timestamp("processed_at").defaultNow(),
});

// Portfolio-level competitor data
export const portfolioCompetitors = pgTable("portfolio_competitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  portfolioName: text("portfolio_name"), // e.g., "Brookdale", "Sunrise", etc.
  locations: jsonb("locations"), // Array of location objects with rates
  avgPortfolioRate: real("avg_portfolio_rate"),
  totalUnits: integer("total_units"),
  marketShare: real("market_share"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// AI-specific pricing weights
export const aiPricingWeights = pgTable("ai_pricing_weights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  occupancyPressure: real("occupancy_pressure").default(20), // weight as percentage
  daysVacantDecay: real("days_vacant_decay").default(20),
  roomAttributes: real("room_attributes").default(15),
  competitorRates: real("competitor_rates").default(15),
  seasonality: real("seasonality").default(15),
  stockMarket: real("stock_market").default(15),
  createdAt: timestamp("created_at").defaultNow(),
});

// AI-specific adjustment ranges
export const aiAdjustmentRanges = pgTable("ai_adjustment_ranges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  occupancyMin: real("occupancy_min").default(-0.15), // -15%
  occupancyMax: real("occupancy_max").default(0.15),  // +15%
  vacancyMin: real("vacancy_min").default(-0.30),     // -30%
  vacancyMax: real("vacancy_max").default(0),          // 0%
  attributesMin: real("attributes_min").default(0),    // 0%
  attributesMax: real("attributes_max").default(0.20), // +20%
  competitorMin: real("competitor_min").default(-0.15),// -15%
  competitorMax: real("competitor_max").default(0.15), // +15%
  seasonalMin: real("seasonal_min").default(-0.08),   // -8%
  seasonalMax: real("seasonal_max").default(0.08),    // +8%
  marketMin: real("market_min").default(0),            // 0%
  marketMax: real("market_max").default(0.05),         // +5%
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Insert schemas

export const insertLocationsSchema = createInsertSchema(locations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRentRollDataSchema = createInsertSchema(rentRollData).omit({
  id: true,
});

export const insertAssumptionsSchema = createInsertSchema(assumptions).omit({
  id: true,
  createdAt: true,
});

export const insertPricingWeightsSchema = createInsertSchema(pricingWeights).omit({
  id: true,
  createdAt: true,
});

export const insertCompetitorSchema = createInsertSchema(competitors).omit({
  id: true,
  createdAt: true,
});

export const insertStockMarketCacheSchema = createInsertSchema(stockMarketCache).omit({
  id: true,
  fetchedAt: true,
  createdAt: true,
});

export const insertAdjustmentRangesSchema = createInsertSchema(adjustmentRanges).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGuardrailsSchema = createInsertSchema(guardrails).omit({
  id: true,
  createdAt: true,
});

export const insertRateCardSchema = createInsertSchema(rateCard).omit({
  id: true,
  createdAt: true,
});

export const insertUploadHistorySchema = createInsertSchema(uploadHistory).omit({
  id: true,
  processedAt: true,
});

export const insertPortfolioCompetitorsSchema = createInsertSchema(portfolioCompetitors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAttributeRatingsSchema = createInsertSchema(attributeRatings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAiPricingWeightsSchema = createInsertSchema(aiPricingWeights).omit({
  id: true,
  createdAt: true,
});

export const insertAiAdjustmentRangesSchema = createInsertSchema(aiAdjustmentRanges).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTargetsAndTrendsSchema = createInsertSchema(targetsAndTrends).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Portfolio adjustment rules table
export const adjustmentRules = pgTable("adjustment_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(), // Natural language rule description
  trigger: jsonb("trigger").notNull(), // Parsed trigger conditions
  action: jsonb("action").notNull(), // Parsed actions to take
  isActive: boolean("is_active").default(true),
  priority: integer("priority").default(0), // Higher priority rules execute first
  createdBy: text("created_by"),
  lastExecuted: timestamp("last_executed"),
  executionCount: integer("execution_count").default(0),
  monthlyImpact: real("monthly_impact").default(0), // Estimated monthly revenue impact
  annualImpact: real("annual_impact").default(0), // Base annual impact (12x monthly)
  volumeAdjustedAnnualImpact: real("volume_adjusted_annual_impact").default(0), // Annual impact with 5% volume increase
  actualAnnualImpact: real("actual_annual_impact"), // Tracked actual impact over time
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Adjustment rule execution log
export const adjustmentRuleLog = pgTable("adjustment_rule_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleId: varchar("rule_id").references(() => adjustmentRules.id),
  executedAt: timestamp("executed_at").defaultNow(),
  affectedUnits: integer("affected_units").notNull(),
  adjustmentType: text("adjustment_type").notNull(), // street_rate, care_rate, etc
  adjustmentAmount: real("adjustment_amount").notNull(), // Percentage or dollar amount
  beforeValue: real("before_value"),
  afterValue: real("after_value"),
  monthlyImpact: real("monthly_impact"), // Monthly revenue impact from this execution
  annualImpact: real("annual_impact"), // Projected annual impact (12x monthly)
  volumeAdjustedAnnualImpact: real("volume_adjusted_annual_impact"), // Annual impact with 5% volume boost
  impactSummary: jsonb("impact_summary"), // Detailed impact data
  status: text("status").notNull(), // success, partial, failed
  errorMessage: text("error_message"),
});

export const insertAdjustmentRulesSchema = createInsertSchema(adjustmentRules);
export const insertAdjustmentRuleLogSchema = createInsertSchema(adjustmentRuleLog);

// MatrixCare Street Rates (Corporate Room Charges) for new admissions
export const streetRates = pgTable("street_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  facilityName: text("facility_name").notNull(), // MatrixCare facility name
  facilityCustomerId: text("facility_customer_id"), 
  bedTypeDescription: text("bed_type_description"), // Companion, Private, Semi-Private
  levelOfCare: text("level_of_care"), // BASE RATE - AL, BASE RATE - SKILLED, etc.
  roomChargeDescription: text("room_charge_description"),
  basePriceBeginDate: text("base_price_begin_date"),
  basePrice: real("base_price"),
  basePriceChargeBy: text("base_price_charge_by"), // Daily, Monthly
  payerBeginDate: text("payer_begin_date"),
  payerName: text("payer_name"), // Private AL, Private HCC, Hospice Private, etc.
  payerChargeBy: text("payer_charge_by"),
  proration: text("proration"),
  revenueCode: text("revenue_code"),
  allowableCharge: real("allowable_charge"),
  allowablePercent: real("allowable_percent"),
  hospBedHoldRate: real("hosp_bed_hold_rate"),
  hospBedHoldPercent: real("hosp_bed_hold_percent"),
  therBedHoldRate: real("ther_bed_hold_rate"),
  therBedHoldPercent: real("ther_bed_hold_percent"),
  revenueAccount: text("revenue_account"),
  contractualAccount: text("contractual_account"),
  copayContractualAccount: text("copay_contractual_account"),
  effectiveDate: timestamp("effective_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// MatrixCare Special Rates for current residents (rate freezing)
export const specialRates = pgTable("special_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  facilityName: text("facility_name").notNull(),
  residentId: text("resident_id"),
  residentName: text("resident_name"),
  beginDate: text("begin_date"),
  endDate: text("end_date"),
  payerName: text("payer_name"),
  proration: integer("proration"),
  spclRate: integer("spcl_rate"),
  amount: real("amount"),
  pct: real("pct"),
  monthly: integer("monthly"),
  hospHold: integer("hosp_hold"),
  hospHoldAmount: real("hosp_hold_amount"),
  hospPct: real("hosp_pct"),
  hospHoldMonthly: integer("hosp_hold_monthly"),
  therLv: integer("ther_lv"),
  therLvHoldAmount: real("ther_lv_hold_amount"),
  therLvPct: real("ther_lv_pct"),
  therLvHoldMonthly: integer("ther_lv_hold_monthly"),
  effectiveDate: timestamp("effective_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Competitive Survey Data
export const competitiveSurveyData = pgTable("competitive_survey_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  surveyMonth: text("survey_month").notNull(), // Format: YYYY-MM
  keyStatsLocation: text("keystats_location").notNull(), // KeyStats campus name
  competitorName: text("competitor_name").notNull(),
  competitorAddress: text("competitor_address"),
  distanceMiles: real("distance_miles"),
  competitorType: text("competitor_type"), // IL, AL, MC, SNF
  roomType: text("room_type"), // Studio, 1BR, 2BR
  squareFootage: integer("square_footage"),
  monthlyRateLow: real("monthly_rate_low"),
  monthlyRateHigh: real("monthly_rate_high"),
  monthlyRateAvg: real("monthly_rate_avg"),
  careFeesLow: real("care_fees_low"),
  careFeesHigh: real("care_fees_high"),
  careFeesAvg: real("care_fees_avg"),
  totalMonthlyLow: real("total_monthly_low"),
  totalMonthlyHigh: real("total_monthly_high"),
  totalMonthlyAvg: real("total_monthly_avg"),
  communityFee: real("community_fee"),
  petFee: real("pet_fee"),
  otherFees: real("other_fees"),
  incentives: text("incentives"),
  totalUnits: integer("total_units"),
  occupancyRate: real("occupancy_rate"),
  yearBuilt: integer("year_built"),
  lastRenovation: integer("last_renovation"),
  amenities: text("amenities"), // JSON array of amenities
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertStreetRatesSchema = createInsertSchema(streetRates);
export const insertSpecialRatesSchema = createInsertSchema(specialRates);
export const insertCompetitiveSurveyDataSchema = createInsertSchema(competitiveSurveyData);

// Floor Plan Tables for Interactive Campus Maps
export const campusMaps = pgTable("campus_maps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => locations.id).notNull(),
  name: text("name").notNull(),
  baseImageUrl: text("base_image_url"), // Path to photorealistic aerial/satellite base image
  svgUrl: text("svg_url"), // Path to SVG file in object storage
  svgContent: text("svg_content"), // Actual SVG markup (for inline embedding)
  width: integer("width"), // SVG viewBox width
  height: integer("height"), // SVG viewBox height
  isPublished: boolean("is_published").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const floorPlans = pgTable("floor_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => locations.id).notNull(),
  code: text("code").notNull(), // e.g., "IL-1BR-A"
  name: text("name").notNull(), // e.g., "Sycamore"
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: real("bathrooms").notNull(), // Allow 1.5, 2.5, etc.
  sqft: integer("sqft"),
  description: text("description"),
  imageUrl: text("image_url"), // Floor plan photo/rendering
  amenities: text("amenities").array(), // Array of amenities
  serviceLine: text("service_line"), // AL, IL, MC, etc.
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const unitPolygons = pgTable("unit_polygons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campusMapId: varchar("campus_map_id").references(() => campusMaps.id).notNull(),
  rentRollDataId: varchar("rent_roll_data_id").references(() => rentRollData.id),
  floorPlanId: varchar("floor_plan_id").references(() => floorPlans.id),
  polygonCoordinates: text("polygon_coordinates").notNull(), // JSON string: [[x,y], [x,y], ...]
  label: text("label"), // Unit number or label to display on map
  fillColor: text("fill_color").default("#4CAF50"), // Hex color for polygon fill
  strokeColor: text("stroke_color").default("#2E7D32"), // Hex color for polygon stroke
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for floor plan tables
export const insertCampusMapSchema = createInsertSchema(campusMaps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFloorPlanSchema = createInsertSchema(floorPlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUnitPolygonSchema = createInsertSchema(unitPolygons).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationsSchema>;
export type RentRollData = typeof rentRollData.$inferSelect;
export type InsertRentRollData = z.infer<typeof insertRentRollDataSchema>;
export type Assumptions = typeof assumptions.$inferSelect;
export type InsertAssumptions = z.infer<typeof insertAssumptionsSchema>;
export type PricingWeights = typeof pricingWeights.$inferSelect;
export type InsertPricingWeights = z.infer<typeof insertPricingWeightsSchema>;
export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;
export type StockMarketCache = typeof stockMarketCache.$inferSelect;
export type InsertStockMarketCache = z.infer<typeof insertStockMarketCacheSchema>;
export type AdjustmentRanges = typeof adjustmentRanges.$inferSelect;
export type InsertAdjustmentRanges = z.infer<typeof insertAdjustmentRangesSchema>;
export type Guardrails = typeof guardrails.$inferSelect;
export type InsertGuardrails = z.infer<typeof insertGuardrailsSchema>;
export type RateCard = typeof rateCard.$inferSelect;
export type InsertRateCard = z.infer<typeof insertRateCardSchema>;
export type UploadHistory = typeof uploadHistory.$inferSelect;
export type InsertUploadHistory = z.infer<typeof insertUploadHistorySchema>;
export type AttributeRatings = typeof attributeRatings.$inferSelect;
export type InsertAttributeRatings = z.infer<typeof insertAttributeRatingsSchema>;
export type PortfolioCompetitor = typeof portfolioCompetitors.$inferSelect;
export type InsertPortfolioCompetitor = z.infer<typeof insertPortfolioCompetitorsSchema>;
export type TargetsAndTrends = typeof targetsAndTrends.$inferSelect;
export type InsertTargetsAndTrends = z.infer<typeof insertTargetsAndTrendsSchema>;
export type AiPricingWeights = typeof aiPricingWeights.$inferSelect;
export type InsertAiPricingWeights = z.infer<typeof insertAiPricingWeightsSchema>;
export type AiAdjustmentRanges = typeof aiAdjustmentRanges.$inferSelect;
export type InsertAiAdjustmentRanges = z.infer<typeof insertAiAdjustmentRangesSchema>;
export type AdjustmentRules = typeof adjustmentRules.$inferSelect;
export type InsertAdjustmentRules = z.infer<typeof insertAdjustmentRulesSchema>;
export type AdjustmentRuleLog = typeof adjustmentRuleLog.$inferSelect;
export type InsertAdjustmentRuleLog = z.infer<typeof insertAdjustmentRuleLogSchema>;
export type CampusMap = typeof campusMaps.$inferSelect;
export type InsertCampusMap = z.infer<typeof insertCampusMapSchema>;
export type FloorPlan = typeof floorPlans.$inferSelect;
export type InsertFloorPlan = z.infer<typeof insertFloorPlanSchema>;
export type UnitPolygon = typeof unitPolygons.$inferSelect;
export type InsertUnitPolygon = z.infer<typeof insertUnitPolygonSchema>;
