import { sql } from 'drizzle-orm';
import {
  index,
  uniqueIndex,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
  text,
  integer,
  real,
  boolean,
  date,
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

// Multi-tenant client environments
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey(), // slug: 'demo', 'trilogy', 'glm', 'ssmg'
  name: text("name").notNull(), // Display name
  createdAt: timestamp("created_at").defaultNow(),
});

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // Multi-tenant auth fields
  username: varchar("username").unique(),
  passwordHash: varchar("password_hash"),
  clientId: varchar("client_id").references(() => clients.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Service line options for senior living facilities
export const serviceLineEnum = ["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"] as const;
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
  name: text("name").notNull(), // KeyStats name (display name)
  matrixCareNameHC: text("matrixcare_name_hc"), // MatrixCare facility name for HC
  matrixCareNameAL: text("matrixcare_name_al"), // MatrixCare facility name for AL  
  matrixCareNameIL: text("matrixcare_name_il"), // MatrixCare facility name for IL
  customerFacilityIdHC: text("customer_facility_id_hc"), // Customer ID for HC
  customerFacilityIdAL: text("customer_facility_id_al"), // Customer ID for AL
  customerFacilityIdIL: text("customer_facility_id_il"), // Customer ID for IL
  locationCode: text("location_code"), // 4-digit location code
  region: text("region"),
  division: text("division"),
  locationClass: text("location_class"), // Campus classification (e.g., Same Store, New Acquisition)
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  lat: real("lat"),
  lng: real("lng"),
  totalUnits: integer("total_units").default(0),
  sameStore: boolean("same_store").default(true), // If true, location is included in same-store comparisons
  clientId: varchar("client_id").references(() => clients.id), // Multi-tenant: which client owns this location
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  // Location names only need to be unique within a client — two tenants may
  // legitimately operate campuses with the same name.
  uniqueClientName: uniqueIndex("locations_client_name_unique").on(table.clientId, table.name),
}));

// Updated rent roll data table with complete field structure
export const rentRollData = pgTable("rent_roll_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(), // Format: YYYY-MM
  date: text("date").notNull(),
  location: text("location").notNull(),
  locationId: varchar("location_id").references(() => locations.id),
  roomNumber: text("room_number").notNull(),
  roomType: text("room_type").notNull(),
  serviceLine: text("service_line").notNull(), // AL, AL/MC, HC, HC/MC, SL, VIL
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
  // Detailed competitor rate information for dialog display
  competitorName: text("competitor_name"),
  competitorBaseRate: real("competitor_base_rate"),
  competitorWeight: real("competitor_weight"),
  competitorCareLevel2Adjustment: real("competitor_care_level2_adjustment"),
  competitorMedManagementAdjustment: real("competitor_med_management_adjustment"),
  competitorAdjustmentExplanation: text("competitor_adjustment_explanation"),
  moduloSuggestedRate: real("modulo_suggested_rate"),
  moduloCalculationDetails: text("modulo_calculation_details"), // JSON string of Modulo calculation breakdown
  aiSuggestedRate: real("ai_suggested_rate"),
  aiCalculationDetails: text("ai_calculation_details"), // JSON string of AI calculation breakdown
  ruleAdjustedRate: real("rule_adjusted_rate"), // Rate after applying adjustment rules (e.g., 5% AL increase)
  appliedRuleName: text("applied_rule_name"), // Name of the rule that was applied
  ruleRateCalculatedAt: timestamp("rule_rate_calculated_at"), // Timestamp when ruleAdjustedRate was last written
  promotionAllowance: real("promotion_allowance"),
  // MatrixCare specific fields
  residentId: text("resident_id"), // Unique resident identifier for MatrixCare
  residentName: text("resident_name"), // Full name of resident
  moveInDate: text("move_in_date"), // Date resident moved in
  moveOutDate: text("move_out_date"), // Date resident moved out (if applicable)
  payorType: text("payor_type"), // Private Pay, Medicaid, Medicare, Insurance
  admissionStatus: text("admission_status"), // New, Transfer, Readmission
  levelOfCare: text("level_of_care"), // SL, VIL, AL, MC, SNF
  medicaidRate: real("medicaid_rate"), // Medicaid reimbursement rate if applicable
  medicareRate: real("medicare_rate"), // Medicare reimbursement rate if applicable
  assessmentDate: text("assessment_date"), // Date of last care assessment
  marketingSource: text("marketing_source"), // How resident found the facility
  inquiryCount: integer("inquiry_count").default(0), // Number of inquiries for this unit in trailing 30 days
  tourCount: integer("tour_count").default(0), // Number of tours for this unit in trailing 30 days
  sameStore: boolean("same_store").default(true), // Same Store comparison flag - true if location existed in prior year
  sourceRoomType: text("source_room_type"), // Raw room type string from import, before normalization
  clientId: varchar("client_id").references(() => clients.id), // Multi-tenant: which client owns this record
  createdAt: timestamp("created_at").defaultNow(),
});

// Rate card summary by room type and service line
export const rateCard = pgTable("rate_card", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(),
  location: text("location"),
  locationId: varchar("location_id").references(() => locations.id),
  roomType: text("room_type").notNull(),
  serviceLine: text("service_line").notNull(), // AL, AL/MC, HC, HC/MC, SL, VIL
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
  locationId: varchar("location_id").references(() => locations.id),
  serviceLine: text("service_line"),
  enableWeights: boolean("enable_weights").notNull().default(true),
  occupancyPressure: integer("occupancy_pressure").notNull(),
  daysVacantDecay: integer("days_vacant_decay").notNull(),
  roomAttributes: integer("room_attributes").notNull().default(10), // Weight for room attributes signal
  seasonality: integer("seasonality").notNull(),
  competitorRates: integer("competitor_rates").notNull(),
  stockMarket: integer("stock_market").notNull(),
  inquiryTourVolume: integer("inquiry_tour_volume").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitors = pgTable("competitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  location: text("location"), // Which portfolio location this competitor is for
  locationId: varchar("location_id").references(() => locations.id),
  lat: real("lat"), // Made nullable to support uploads without geocoding
  lng: real("lng"), // Made nullable to support uploads without geocoding
  rates: jsonb("rates"),
  avgCareRate: real("avg_care_rate"),
  streetRate: real("street_rate"),
  roomType: text("room_type"),
  attributes: jsonb("attributes"),
  address: text("address"),
  rank: integer("rank"),
  weight: real("weight"),
  rating: text("rating"), // A, B, or C
  serviceLines: text("service_lines").array(), // Service lines offered: HC, HC/MC, AL, AL/MC, IL, SL
  careLevel2Rate: real("care_level_2_rate"), // Care level 2 rate for comparison with Trilogy
  medicationManagementFee: real("medication_management_fee"), // Med management fee (Trilogy doesn't charge)
  clientId: varchar("client_id").references(() => clients.id), // Multi-tenant: which client owns this competitor
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
// Supports 3-tier hierarchical configuration: location+serviceLine specific → location-level → global defaults
export const adjustmentRanges = pgTable("adjustment_ranges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => locations.id), // NULL = global default
  serviceLine: text("service_line"), // NULL = applies to all service lines at this location
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
}, (table) => ({
  uniqueScope: uniqueIndex("adjustment_ranges_unique_scope").on(table.locationId, table.serviceLine)
}));

// Dynamic pricing guardrails
// Supports 3-tier hierarchical configuration: location+serviceLine specific → location-level → global defaults
export const guardrails = pgTable("guardrails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => locations.id), // NULL = global default
  serviceLine: text("service_line"), // NULL = applies to all service lines at this location
  minPriceChangePct: real("min_price_change_pct").default(-5), // most negative allowed % change vs street rate (e.g. -5 = max 5% decrease)
  maxPriceChangePct: real("max_price_change_pct").default(15), // max allowed % increase vs street rate
  minAbsolutePrice: real("min_absolute_price"), // hard floor in $; NULL = no floor
  maxAbsolutePrice: real("max_absolute_price"), // hard ceiling in $; NULL = no ceiling
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  uniqueScope: uniqueIndex("guardrails_unique_scope").on(table.locationId, table.serviceLine)
}));

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
  locationId: varchar("location_id").references(() => locations.id), // NULL = applies to all locations
  serviceLine: text("service_line"), // NULL = applies to all service lines (legacy single)
  serviceLines: text("service_lines").array(), // Multi-SL scope (takes precedence when non-null/non-empty)
  name: text("name").notNull(),
  description: text("description").notNull(), // Natural language rule description
  trigger: jsonb("trigger").notNull(), // Parsed trigger conditions
  action: jsonb("action").notNull(), // Parsed actions to take
  isActive: boolean("is_active").default(true),
  isHistorical: boolean("is_historical").default(false), // true = historical record of a past pricing change; never applied to current rates
  effectiveDate: date("effective_date"), // NULL = effective immediately; otherwise rule only applies on/after this date
  priority: integer("priority").default(0), // Higher priority rules execute first
  createdBy: text("created_by"),
  notes: text("notes"), // Free-form user note (e.g. why the rule was created)
  lastExecuted: timestamp("last_executed"),
  executionCount: integer("execution_count").default(0),
  monthlyImpact: real("monthly_impact").default(0), // Estimated monthly revenue impact
  annualImpact: real("annual_impact").default(0), // Base annual impact (12x monthly)
  volumeAdjustedAnnualImpact: real("volume_adjusted_annual_impact").default(0), // Annual impact with 5% volume increase
  actualAnnualImpact: real("actual_annual_impact"), // Tracked actual impact over time
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueScope: uniqueIndex("adjustment_rules_unique_scope").on(table.name, table.locationId, table.serviceLine)
}));

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
  // Individual care level rates (Trilogy has 4 levels, competitors may have more)
  careLevel1Rate: real("care_level_1_rate"),
  careLevel2Rate: real("care_level_2_rate"),
  careLevel3Rate: real("care_level_3_rate"),
  careLevel4Rate: real("care_level_4_rate"),
  medicationManagementFee: real("medication_management_fee"),
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
  lat: real("lat"),
  lng: real("lng"),
  clientId: varchar("client_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Derived rate formulas — how non-base rates are computed from the base
// (single-occupant, standard-stay) rate. See shared/derivedRates.ts for the
// formula semantics and shared/baseRate.ts for what "base" means.
//
// serviceLine NULL = portfolio-wide. The column exists so a per-service-line
// override can be added later without a migration.
export const derivedRateFormulas = pgTable("derived_rate_formulas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull(),
  rateType: text("rate_type").notNull(), // DerivedRateType
  serviceLine: text("service_line"),     // NULL = all service lines
  percentOfBase: real("percent_of_base").notNull().default(100),
  dollarOffset: real("dollar_offset").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// In-House Rate Planning assumptions.
//
// Three-tier scope exactly like `guardrails` and `adjustment_ranges`:
// location + service line → location → global (both NULL), resolved most
// specific first. Scoped per client on top of that, because an operator's
// growth objective is not portfolio-neutral information.
export const inhousePlanningAssumptions = pgTable("inhouse_planning_assumptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull(),
  locationId: varchar("location_id").references(() => locations.id), // NULL = all campuses
  serviceLine: text("service_line"),                                 // NULL = all service lines
  rateGrowthTargetPct: real("rate_growth_target_pct").notNull().default(5),
  measurementMode: text("measurement_mode").notNull().default("quarterly_yoy"),
  streetRateEffectiveDate: text("street_rate_effective_date"), // YYYY-MM-DD; NULL = next quarter
  inhouseEffectiveDate: text("inhouse_effective_date"),        // YYYY-MM-DD; NULL = next quarter
  annualTurnoverPct: real("annual_turnover_pct").notNull().default(35),
  minInhouseIncreasePct: real("min_inhouse_increase_pct").notNull().default(0),
  maxInhouseIncreasePct: real("max_inhouse_increase_pct").notNull().default(8),
  equalizationStrength: text("equalization_strength").notNull().default("medium"), // low | medium | high
  allowInhouseAboveStreet: boolean("allow_inhouse_above_street").notNull().default(false),
  maxStreetIncreasePct: real("max_street_increase_pct").notNull().default(15),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  uniqueScope: uniqueIndex("inhouse_planning_assumptions_scope")
    .on(table.clientId, table.locationId, table.serviceLine),
}));

// An applied in-house increase plan, kept as an immutable audit version.
//
// Calculating never writes; applying does, and it writes here FIRST so the
// numbers an operator approved survive independently of any later repricing.
export const inhouseRatePlans = pgTable("inhouse_rate_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull(),
  locationId: varchar("location_id").references(() => locations.id),
  location: text("location"),
  serviceLine: text("service_line").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("applied"), // applied | superseded
  assumptions: jsonb("assumptions").notNull(),
  summary: jsonb("summary").notNull(),
  quarters: jsonb("quarters").notNull(),
  residents: jsonb("residents").notNull(),
  streetRateEffectiveDate: text("street_rate_effective_date"),
  inhouseEffectiveDate: text("inhouse_effective_date"),
  recommendedStreetRate: real("recommended_street_rate"),
  appliedBy: text("applied_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInhousePlanningAssumptionsSchema = createInsertSchema(inhousePlanningAssumptions);
export const insertInhouseRatePlansSchema = createInsertSchema(inhouseRatePlans);

export const insertStreetRatesSchema = createInsertSchema(streetRates);
export const insertSpecialRatesSchema = createInsertSchema(specialRates);
export const insertDerivedRateFormulasSchema = createInsertSchema(derivedRateFormulas);
export const insertCompetitiveSurveyDataSchema = createInsertSchema(competitiveSurveyData);

// Historical Rent Roll Data (time series for all 11 months)
export const rentRollHistory = pgTable("rent_roll_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(),
  date: text("date").notNull(),
  location: text("location").notNull(),
  locationId: varchar("location_id").references(() => locations.id),
  roomNumber: text("room_number").notNull(),
  roomType: text("room_type").notNull(),
  serviceLine: text("service_line").notNull(),
  occupiedYN: boolean("occupied_yn").notNull(),
  daysVacant: integer("days_vacant").default(0),
  preferredLocation: text("preferred_location"),
  size: text("size").notNull(),
  view: text("view"),
  renovated: boolean("renovated").default(false),
  otherPremiumFeature: text("other_premium_feature"),
  locationRating: text("location_rating"),
  sizeRating: text("size_rating"),
  viewRating: text("view_rating"),
  renovationRating: text("renovation_rating"),
  amenityRating: text("amenity_rating"),
  streetRate: real("street_rate").notNull(),
  inHouseRate: real("in_house_rate").notNull(),
  discountToStreetRate: real("discount_to_street_rate"),
  careLevel: text("care_level"),
  careRate: real("care_rate"),
  rentAndCareRate: real("rent_and_care_rate"),
  competitorRate: real("competitor_rate"),
  competitorAvgCareRate: real("competitor_avg_care_rate"),
  competitorFinalRate: real("competitor_final_rate"),
  residentId: text("resident_id"),
  residentName: text("resident_name"),
  moveInDate: text("move_in_date"),
  moveOutDate: text("move_out_date"),
  payorType: text("payor_type"),
  admissionStatus: text("admission_status"),
  levelOfCare: text("level_of_care"),
  medicaidRate: real("medicaid_rate"),
  medicareRate: real("medicare_rate"),
  assessmentDate: text("assessment_date"),
  marketingSource: text("marketing_source"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Enquire data with location mapping
export const enquireData = pgTable("enquire_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dataSource: text("data_source").notNull(), // "Senior Housing" or "Post Acute"
  enquireLocation: text("enquire_location").notNull(), // Original location name from Enquire
  mappedLocationId: varchar("mapped_location_id").references(() => locations.id), // Mapped to locations table
  mappedServiceLine: text("mapped_service_line"), // Mapped service line (AL, HC, IL, etc.)
  inquiryId: text("inquiry_id"), // Unique inquiry identifier
  inquiryDate: text("inquiry_date"),
  tourDate: text("tour_date"),
  moveInDate: text("move_in_date"),
  leadSource: text("lead_source"),
  leadStatus: text("lead_status"),
  prospectName: text("prospect_name"),
  careNeeds: text("care_needs"),
  budgetRange: text("budget_range"),
  desiredMoveInDate: text("desired_move_in_date"),
  roomTypePreference: text("room_type_preference"),
  notes: text("notes"),
  rawData: jsonb("raw_data"), // Store full raw record for reference
  createdAt: timestamp("created_at").defaultNow(),
});

// Location mapping table for Enquire → KeyStats campus matching
export const locationMappings = pgTable("location_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceSystem: text("source_system").notNull(), // "enquire", "matrixcare", etc.
  sourceLocation: text("source_location").notNull(), // Original location name from source system
  targetLocationId: varchar("target_location_id").references(() => locations.id).notNull(), // Maps to locations table
  defaultServiceLine: text("default_service_line"), // Default service line for this mapping
  confidence: real("confidence").default(1.0), // Mapping confidence score (0-1)
  isManualMapping: boolean("is_manual_mapping").default(false), // True if manually mapped by user
  mappedBy: varchar("mapped_by").references(() => users.id), // User who created/approved mapping
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRentRollHistorySchema = createInsertSchema(rentRollHistory).omit({
  id: true,
  createdAt: true,
});

export const insertEnquireDataSchema = createInsertSchema(enquireData).omit({
  id: true,
  createdAt: true,
});

export const insertLocationMappingsSchema = createInsertSchema(locationMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Floor Plan Tables for Interactive Campus Maps
export const campusMaps = pgTable("campus_maps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => locations.id), // Nullable for global/template floor plans
  name: text("name").notNull(),
  baseImageUrl: text("base_image_url"), // Path to photorealistic aerial/satellite base image
  svgUrl: text("svg_url"), // Path to SVG file in object storage
  svgContent: text("svg_content"), // Actual SVG markup (for inline embedding)
  width: integer("width"), // SVG viewBox width
  height: integer("height"), // SVG viewBox height
  isTemplate: boolean("is_template").default(false), // True if this floor plan should be used for all locations
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
  polygonCoordinates: text("polygon_coordinates").notNull(), // JSON string: [[x,y], [x,y], ...] (normalized 0-1 or absolute pixels)
  normalizedCoordinates: jsonb("normalized_coordinates"), // Normalized polygon coordinates as JSON array [{x, y}, ...] (0-1 range)
  displayRoomNumber: text("display_room_number"), // Room number to display (e.g., "151", "1025")
  defaultServiceLine: text("default_service_line"), // Default service line (AL, IL, HC, etc.)
  sectionName: text("section_name"), // Section name (e.g., "AL_West_Assisted_Living", "IL_Center")
  label: text("label"), // Unit number or label to display on map
  fillColor: text("fill_color").default("#4CAF50"), // Hex color for polygon fill (overridden by occupancy)
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

// Calculation history to track rate generation runs
export const calculationHistory = pgTable("calculation_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  calculationType: text("calculation_type").notNull(), // 'manual' or 'scheduled'
  status: text("status").notNull(), // 'started', 'completed', 'failed'
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  locationId: varchar("location_id"), // null for portfolio-wide calculations
  uploadMonth: text("upload_month"), // YYYY-MM format for which month's data was used
  totalUnits: integer("total_units"),
  unitsCalculated: integer("units_calculated"),
  averageModuloRate: real("average_modulo_rate"),
  averageAIRate: real("average_ai_rate"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"), // Additional details like service line breakdowns
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCalculationHistorySchema = createInsertSchema(calculationHistory).omit({
  id: true,
  createdAt: true,
});

export type InsertCalculationHistory = z.infer<typeof insertCalculationHistorySchema>;
export type CalculationHistory = typeof calculationHistory.$inferSelect;

// Pricing change history for revert functionality
export const pricingHistory = pgTable("pricing_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  actionType: text("action_type").notNull(), // 'accept_modulo', 'accept_ai', 'manual'
  serviceLine: text("service_line"), // Filter applied (null = all units)
  unitsAffected: integer("units_affected").notNull(), // Number of units changed
  changesSnapshot: jsonb("changes_snapshot").notNull(), // Array of {roomNumber, oldRate, newRate, location}
  description: text("description").notNull(), // Human-readable description
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPricingHistorySchema = createInsertSchema(pricingHistory).omit({
  id: true,
  appliedAt: true,
  createdAt: true,
});

export const inquiryMetrics = pgTable("inquiry_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(),
  date: text("date").notNull(),
  region: text("region"),
  division: text("division"),
  location: text("location").notNull(),
  locationId: varchar("location_id").references(() => locations.id),
  serviceLine: text("service_line"),
  leadSource: text("lead_source"),
  inquiryCount: integer("inquiry_count").default(0),
  tourCount: integer("tour_count").default(0),
  conversionCount: integer("conversion_count").default(0),
  conversionRate: real("conversion_rate").default(0),
  daysToTour: integer("days_to_tour").default(0),
  daysToMoveIn: integer("days_to_move_in").default(0),
  clientId: varchar("client_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInquiryMetricsSchema = createInsertSchema(inquiryMetrics).omit({
  id: true,
  createdAt: true,
});

// Move-In / Move-Out events — authoritative event-level source for monthly
// move-in and move-out counts (imported from "Move Ins & Outs Detail" xlsx).
export const moveInOutEvents = pgTable("move_in_out_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull(),
  eventType: text("event_type").notNull(), // 'move_in' | 'move_out'
  censusId: text("census_id").notNull(),
  patientId: text("patient_id"),
  division: text("division"),
  location: text("location").notNull(),
  dept: text("dept"),
  serviceLine: text("service_line"),
  roomType: text("room_type"),
  bedType: text("bed_type"),
  roomName: text("room_name"),
  payer: text("payer"),
  eventDate: text("event_date").notNull(), // YYYY-MM-DD
  eventCategory: text("event_category"), // Census_Event or Discharge_Type
  isReturn: boolean("is_return").default(false),
  counted: boolean("counted").notNull().default(false), // true if this event counts toward monthly move-in/out stats
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  uniqueClientTypeCensus: uniqueIndex("miox_client_type_census_idx").on(t.clientId, t.eventType, t.censusId),
  clientLocSlDate: index("miox_client_loc_sl_date_idx").on(t.clientId, t.location, t.serviceLine, t.eventDate),
}));

export const insertMoveInOutEventSchema = createInsertSchema(moveInOutEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertMoveInOutEvent = z.infer<typeof insertMoveInOutEventSchema>;
export type MoveInOutEvent = typeof moveInOutEvents.$inferSelect;

// Competitor Rate Jobs - For tracking background competitor rate matching
export const competitorRateJobs = pgTable("competitor_rate_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(),
  clientId: text("client_id"), // Optional: when set, job is scoped to this client only
  status: text("status").notNull().default('pending'), // pending, running, completed, failed
  totalUnits: integer("total_units").default(0),
  processedUnits: integer("processed_units").default(0),
  updatedUnits: integer("updated_units").default(0),
  skippedUnits: integer("skipped_units").default(0),
  errorCount: integer("error_count").default(0),
  lastProcessedId: varchar("last_processed_id"), // For resumable processing
  errorDetails: text("error_details"),
  careRateFallbackCampuses: jsonb("care_rate_fallback_campuses"), // { campusName: unitCount } for campuses that used the $55/day fallback
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCompetitorRateJobSchema = createInsertSchema(competitorRateJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Import Mapping Profiles - For flexible CSV import column mapping
export const importMappingProfiles = pgTable("import_mapping_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isBuiltIn: boolean("is_built_in").default(false),
  isDefault: boolean("is_default").default(false),
  columnMappings: jsonb("column_mappings").notNull(), // JSON object mapping source columns to target fields
  fieldAliases: jsonb("field_aliases"), // JSON object with field name variations for fuzzy matching
  dataTransformations: jsonb("data_transformations"), // Optional transformations per field
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertImportMappingProfileSchema = createInsertSchema(importMappingProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ImportMappingProfile = typeof importMappingProfiles.$inferSelect;
export type InsertImportMappingProfile = z.infer<typeof insertImportMappingProfileSchema>;

// AI Rate Outcomes - Track when AI rates are adopted and their success
export const aiRateOutcomes = pgTable("ai_rate_outcomes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rentRollDataId: varchar("rent_roll_data_id").references(() => rentRollData.id),
  locationId: varchar("location_id").references(() => locations.id),
  location: text("location").notNull(),
  serviceLine: text("service_line").notNull(),
  roomNumber: text("room_number").notNull(),
  roomType: text("room_type"),
  uploadMonth: text("upload_month").notNull(), // YYYY-MM when rate was suggested
  aiSuggestedRate: real("ai_suggested_rate").notNull(),
  streetRateAtSet: real("street_rate_at_set"), // Original street rate when AI rate was generated
  wasAiAdopted: boolean("was_ai_adopted").default(false), // True if AI rate became street rate
  adoptedAt: timestamp("adopted_at"), // When the AI rate was adopted as street rate
  adoptedStreetRate: real("adopted_street_rate"), // The actual street rate that was set (may differ slightly)
  soldAt: timestamp("sold_at"), // When the unit was sold/occupied
  moveInDate: text("move_in_date"), // Date resident moved in
  daysToSale: integer("days_to_sale"), // Days from adoption to sale
  soldWithin30Days: boolean("sold_within_30_days").default(false), // True if sold within 30 days of adoption
  weightsSnapshot: jsonb("weights_snapshot"), // JSON of the 6 factor weights used
  calculationRunId: varchar("calculation_run_id").references(() => calculationHistory.id),
  outcomeScore: real("outcome_score").default(0), // +2 if adopted+sold<30d, +1 if adopted only, 0 otherwise
  // Revenue Target Strategy Layer fields (added in strategy layer enhancement)
  targetAwareAiRate: real("target_aware_ai_rate"),        // Rate after strategy layer, before guardrails
  unitStrategySegment: text("unit_strategy_segment"),      // 'volume_driver' | 'premium_driver' | 'neutral'
  urgencyScore: real("urgency_score"),                     // 0-1 urgency driven by gap and months remaining
  expectedRevenueExistingAi: real("expected_revenue_existing_ai"),   // Expected revenue using existing AI rate
  expectedRevenueTargetAware: real("expected_revenue_target_aware"), // Expected revenue using target-aware rate
  incrementalExpectedRevenue: real("incremental_expected_revenue"),  // Difference: target-aware minus existing
  strategyLayerDetails: jsonb("strategy_layer_details"),  // Full calculation details for UI and audit
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  roomMonthUnique: uniqueIndex("ai_outcomes_room_month_unique").on(table.location, table.roomNumber, table.uploadMonth),
  adoptionIdx: index("ai_outcomes_adoption_idx").on(table.wasAiAdopted, table.soldWithin30Days),
  serviceLineIdx: index("ai_outcomes_service_line_idx").on(table.serviceLine),
}));

export const insertAiRateOutcomesSchema = createInsertSchema(aiRateOutcomes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// AI Weight Versions - Track learned weights over time with audit trail
export const aiWeightVersions = pgTable("ai_weight_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scope: text("scope").notNull(), // 'global', 'service_line', 'location'
  scopeValue: text("scope_value"), // Service line name or location ID (null for global)
  version: integer("version").notNull().default(1),
  occupancyPressure: real("occupancy_pressure").notNull(),
  daysVacantDecay: real("days_vacant_decay").notNull(),
  seasonality: real("seasonality").notNull(),
  competitorRates: real("competitor_rates").notNull(),
  stockMarket: real("stock_market").notNull(),
  inquiryTourVolume: real("inquiry_tour_volume").notNull(),
  sampleSize: integer("sample_size").notNull(), // Number of outcomes used to train
  adoptionRate: real("adoption_rate"), // % of AI rates that were adopted
  saleWithin30Rate: real("sale_within_30_rate"), // % of adopted rates that sold within 30 days
  averageOutcomeScore: real("average_outcome_score"), // Mean outcome score for this model
  modelMetadata: jsonb("model_metadata"), // Training details, coefficients, etc.
  isActive: boolean("is_active").default(true), // Whether this version is currently being used
  activatedAt: timestamp("activated_at"),
  deactivatedAt: timestamp("deactivated_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  scopeActiveIdx: uniqueIndex("ai_weights_scope_active_idx").on(table.scope, table.scopeValue).where(sql`is_active = true`),
  versionIdx: index("ai_weights_version_idx").on(table.scope, table.scopeValue, table.version),
}));

export const insertAiWeightVersionsSchema = createInsertSchema(aiWeightVersions).omit({
  id: true,
  createdAt: true,
});

// Room Type Base Prices - One editable base price per (room type, service line)
export const roomTypeBasePrices = pgTable("room_type_base_prices", {
  roomType: text("room_type").notNull(),
  serviceLine: text("service_line").notNull().default('All'),
  basePrice: real("base_price").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.roomType, table.serviceLine] }),
]);

export const insertRoomTypeBasePricesSchema = createInsertSchema(roomTypeBasePrices).omit({
  updatedAt: true,
});

export type RoomTypeBasePrice = typeof roomTypeBasePrices.$inferSelect;
export type InsertRoomTypeBasePrice = z.infer<typeof insertRoomTypeBasePricesSchema>;

// Revenue Growth Targets - Store target annual growth % by location/service line
export const revenueGrowthTargets = pgTable("revenue_growth_targets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => locations.id),
  serviceLine: text("service_line").notNull(),
  targetGrowthPercent: real("target_growth_percent").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  locationServiceLineIdx: uniqueIndex("revenue_growth_loc_sl_idx").on(table.locationId, table.serviceLine),
}));

export const insertRevenueGrowthTargetsSchema = createInsertSchema(revenueGrowthTargets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Price Elasticity Metrics — learned per (client, campus, service line, room type).
// Elasticity = (% change in days-to-sell) / (% change in street rate), measured
// across the rent-roll history. The stored value is refined over time via an
// exponential moving average (online learning) so it improves as more months of
// data accumulate. Days-to-sell is proxied by average days_vacant for vacant units.
export const elasticityMetrics = pgTable("elasticity_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  locationId: varchar("location_id").references(() => locations.id), // nullable — keyed primarily by campus name
  locationName: text("location_name").notNull(), // campus name (matches rent_roll_data.location / reference-data campus)
  serviceLine: text("service_line").notNull(),
  roomType: text("room_type").notNull(),
  elasticity: real("elasticity"), // learned (EMA-blended) elasticity; null when insufficient data
  prevElasticity: real("prev_elasticity"), // EMA value snapshotted when the source period last advanced (trend = elasticity − prevElasticity)
  latestSourceMonth: text("latest_source_month"), // most recent upload_month (months[0]) used in the last blend — detects period advances
  rawElasticity: real("raw_elasticity"), // most recent raw period-over-period computation
  daysToSellBefore: real("days_to_sell_before"), // avg days-to-sell in the "before" window
  daysToSellAfter: real("days_to_sell_after"), // avg days-to-sell in the "after" window
  daysToSellChange: real("days_to_sell_change"), // after - before
  rateBefore: real("rate_before"), // avg street rate in the "before" window
  rateAfter: real("rate_after"), // avg street rate in the "after" window
  sampleSize: integer("sample_size").default(0), // number of refinement observations accumulated
  confidence: real("confidence").default(0), // 0-1, grows with sampleSize
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  segmentIdx: uniqueIndex("elasticity_metrics_segment_idx").on(table.clientId, table.locationName, table.serviceLine, table.roomType),
}));

export const insertElasticityMetricsSchema = createInsertSchema(elasticityMetrics).omit({
  id: true,
  updatedAt: true,
});

// ML Training History - Track training runs
export const mlTrainingHistory = pgTable("ml_training_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  trainedAt: timestamp("trained_at").defaultNow(),
  trainingType: text("training_type").notNull(), // 'scheduled', 'manual', 'triggered'
  samplesUsed: integer("samples_used").notNull(),
  modelsUpdated: integer("models_updated").notNull(),
  globalWeightsBefore: jsonb("global_weights_before"),
  globalWeightsAfter: jsonb("global_weights_after"),
  serviceLineUpdates: jsonb("service_line_updates"), // Array of {serviceLine, weightsBefore, weightsAfter}
  trainingMetrics: jsonb("training_metrics"), // R², RMSE, etc.
  status: text("status").notNull(), // 'completed', 'failed', 'partial'
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMlTrainingHistorySchema = createInsertSchema(mlTrainingHistory).omit({
  id: true,
  trainedAt: true,
  createdAt: true,
});

// Room Type Occupancy History - VO "Avg Occ by Room Type" report uploads
export const roomTypeOccupancyHistory = pgTable("room_type_occupancy_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull(),
  locationId: varchar("location_id").references(() => locations.id),
  locationName: text("location_name").notNull(),
  division: text("division"),
  serviceLine: text("service_line").notNull(),
  rawRoomType: text("raw_room_type").notNull(),
  normalizedRoomType: text("normalized_room_type").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  occUnits: real("occ_units"),
  availableUnits: integer("available_units"),
  occPercent: real("occ_percent"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
}, (table) => ({
  clientLocSlRtMonthYearUniq: uniqueIndex("rt_occ_hist_unique_idx").on(
    table.clientId, table.locationName, table.serviceLine, table.normalizedRoomType, table.month, table.year
  ),
}));

export const insertRoomTypeOccupancyHistorySchema = createInsertSchema(roomTypeOccupancyHistory).omit({
  id: true,
  uploadedAt: true,
});

export type RoomTypeOccupancyHistory = typeof roomTypeOccupancyHistory.$inferSelect;
export type InsertRoomTypeOccupancyHistory = z.infer<typeof insertRoomTypeOccupancyHistorySchema>;

/**
 * Capacity as reported by the client's own daily census report.
 *
 * This is a REFERENCE / tie-out source only — it never feeds pricing or the
 * Total Units figure. Occupancy history (`room_type_occupancy_history`) remains
 * the single computational source of truth for both capacity and occupancy.
 * The census report stops at division x department, so it cannot supply the
 * campus- and room-type-level detail the app actually prices on; its job is to
 * tell us when our derived capacity has drifted away from what the client's
 * finance system reports.
 *
 * Health-care lines report AvailableBeds and senior-housing lines report
 * AvailableUnits, so both are stored and capacity is their sum.
 */
export const censusCapacityReference = pgTable("census_capacity_reference", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  // Report date the snapshot was run for (census reports are as-of a single day).
  asOfDate: text("as_of_date"),
  division: text("division").notNull(),
  // Raw department label from the report, e.g. "01-HC", "03-AL Legacy".
  department: text("department").notNull(),
  // Department mapped onto our service lines: HC, HC/MC, AL, AL/MC, VIL, SL.
  serviceLine: text("service_line").notNull(),
  availableBeds: integer("available_beds").notNull().default(0),
  availableUnits: integer("available_units").notNull().default(0),
  sourceFile: text("source_file"),
  importedAt: timestamp("imported_at").defaultNow(),
}, (table) => ({
  censusRefUniq: uniqueIndex("census_capacity_reference_unique_idx").on(
    table.clientId, table.year, table.month, table.division, table.department
  ),
}));

export const insertCensusCapacityReferenceSchema = createInsertSchema(censusCapacityReference).omit({
  id: true,
  importedAt: true,
});

export type CensusCapacityReference = typeof censusCapacityReference.$inferSelect;
export type InsertCensusCapacityReference = z.infer<typeof insertCensusCapacityReferenceSchema>;

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

export interface CompetitorRoomRate {
  roomType: string;
  streetRate: number | null;
  careRate: number | null;
}

export type CompetitorWithRates = Competitor & {
  roomRates: CompetitorRoomRate[];
};
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
export type PricingHistory = typeof pricingHistory.$inferSelect;
export type InsertPricingHistory = z.infer<typeof insertPricingHistorySchema>;
export type RentRollHistory = typeof rentRollHistory.$inferSelect;
export type InsertRentRollHistory = z.infer<typeof insertRentRollHistorySchema>;
export type EnquireData = typeof enquireData.$inferSelect;
export type InsertEnquireData = z.infer<typeof insertEnquireDataSchema>;
export type LocationMapping = typeof locationMappings.$inferSelect;
export type InsertLocationMapping = z.infer<typeof insertLocationMappingsSchema>;
export type CompetitiveSurveyData = typeof competitiveSurveyData.$inferSelect;
export type InsertCompetitiveSurveyData = z.infer<typeof insertCompetitiveSurveyDataSchema>;
export type InquiryMetrics = typeof inquiryMetrics.$inferSelect;
export type InsertInquiryMetrics = z.infer<typeof insertInquiryMetricsSchema>;
export type CompetitorRateJob = typeof competitorRateJobs.$inferSelect;
export type InsertCompetitorRateJob = z.infer<typeof insertCompetitorRateJobSchema>;
export type AiRateOutcome = typeof aiRateOutcomes.$inferSelect;
export type InsertAiRateOutcome = z.infer<typeof insertAiRateOutcomesSchema>;
export type AiWeightVersion = typeof aiWeightVersions.$inferSelect;
export type InsertAiWeightVersion = z.infer<typeof insertAiWeightVersionsSchema>;
export type MlTrainingHistory = typeof mlTrainingHistory.$inferSelect;
export type InsertMlTrainingHistory = z.infer<typeof insertMlTrainingHistorySchema>;
export type RevenueGrowthTarget = typeof revenueGrowthTargets.$inferSelect;
export type InsertRevenueGrowthTarget = z.infer<typeof insertRevenueGrowthTargetsSchema>;
export type ElasticityMetric = typeof elasticityMetrics.$inferSelect;
export type InsertElasticityMetric = z.infer<typeof insertElasticityMetricsSchema>;

// Care Level 2 Rates — posted L2 care rate per location + service line.
// Used only by the competitor adjustment formula so the pricing breakdown shows
// "ours $X" even when rent-roll rows predate the care-level capture fix.
// Never written back to rent roll or RevPOR calculations.
export const careLevelRates = pgTable("care_level_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").references(() => locations.id).notNull(),
  serviceLine: text("service_line").notNull(),
  level2Rate: real("level2_rate").notNull(),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  locationServiceLineIdx: uniqueIndex("care_level_rates_loc_sl_idx").on(table.clientId, table.locationId, table.serviceLine),
}));

export const insertCareLevelRatesSchema = createInsertSchema(careLevelRates).omit({
  id: true,
  createdAt: true,
});

export type CareLevelRate = typeof careLevelRates.$inferSelect;
export type InsertCareLevelRate = z.infer<typeof insertCareLevelRatesSchema>;

// Campus Metrics Snapshot — flexible key-value store for rule designer reference data.
// Stores pre-calculated occupancy, vacancy, competitor variance, payer mix,
// inquiry/tour volume, and avg-days-vacant per campus × service_line × room_type.
// service_line = NULL → campus-level.  room_type = NULL → not dimension-specific.
// metric_name values: 'occupancy_pct', 'vacant_units', 'total_units',
//   'avg_days_vacant', 'competitor_variance_pct', 'private_pay_pct',
//   'medicaid_pct', 'medicare_pct', 'inquiry_count', 'tour_count'.
export const campusMetrics = pgTable("campus_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").notNull().references(() => locations.id),
  serviceLine: text("service_line"),   // NULL = campus-level
  roomType: text("room_type"),         // NULL = not dimension-specific
  metricName: text("metric_name").notNull(),
  value: real("value"),
  clientId: varchar("client_id").references(() => clients.id).notNull().default('demo'),
  calculatedAt: timestamp("calculated_at").defaultNow(),
});
export type CampusMetric = typeof campusMetrics.$inferSelect;

// IH-to-Street Rate Variance — Single Occupant
// Stores pre-calculated variance % between in-house and street rates for single-occupant units.
// SH filter (AL/AL/MC/SL/VIL): occupied + roomType != 'Companion'
// HC filter (HC/HC/MC): occupied + payorType ILIKE '%PRIVATE%'
// HC rates converted to monthly (×30.44) before blending with SH.
// serviceLine = 'ALL' stores the campus-total blended figure.
export const ihStreetVariance = pgTable("ih_street_variance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  locationId: varchar("location_id").notNull().references(() => locations.id),
  serviceLine: text("service_line").notNull(), // 'ALL' = campus total; 'AL', 'HC', etc.
  variancePct: real("variance_pct"),           // (avgIH - avgStreet) / avgStreet * 100
  avgInHouseMonthly: real("avg_in_house_monthly"),
  avgStreetMonthly: real("avg_street_monthly"),
  unitCount: integer("unit_count").default(0),
  clientId: varchar("client_id").references(() => clients.id).notNull().default('demo'),
  calculatedAt: timestamp("calculated_at").defaultNow(),
}, (table) => [
  uniqueIndex("ih_street_variance_client_loc_sl_idx").on(
    table.clientId, table.locationId, table.serviceLine
  ),
]);
export type IhStreetVariance = typeof ihStreetVariance.$inferSelect;

// Persistent geocoding cache so Nominatim is only queried once per address
export const geocodeCache = pgTable("geocode_cache", {
  address: text("address").primaryKey(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type GeocodeCache = typeof geocodeCache.$inferSelect;

// Persistent AI commentary cache — survives server restarts so the Strategy
// Overview loads instantly (stale-while-revalidate refresh in the background)
export const aiCommentaryCache = pgTable("ai_commentary_cache", {
  cacheKey: text("cache_key").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type AiCommentaryCache = typeof aiCommentaryCache.$inferSelect;

// Geocoding job progress tracker — survives server restarts
export const aiInsights = pgTable("ai_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().default('demo'),
  location: text("location").notNull().default('all'),
  serviceLine: text("service_line").notNull().default('all'),
  content: text("content").notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_insights_client_location_sl_idx").on(table.clientId, table.location, table.serviceLine),
]);

export type AiInsight = typeof aiInsights.$inferSelect;

export const geocodingJobs = pgTable("geocoding_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobType: text("job_type").notNull().default('competitor_surveys'), // 'competitor_surveys' | 'locations'
  status: text("status").notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed'
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  updatedRows: integer("updated_rows").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
});

export const insertGeocodingJobSchema = createInsertSchema(geocodingJobs).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});
export type GeocodingJob = typeof geocodingJobs.$inferSelect;
export type InsertGeocodingJob = z.infer<typeof insertGeocodingJobSchema>;

// ── Data Import Subsystem ──────────────────────────────────────────────

// Audit log for every import (manual upload or scheduled SFTP pickup)
export const importRuns = pgTable("import_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull().default('demo'),
  datasetType: text("dataset_type").notNull(), // rent_roll | competitive_survey | inquiry | room_type_occupancy
  source: text("source").notNull().default('manual'), // 'manual' | 'sftp'
  scheduledImportId: varchar("scheduled_import_id"),
  triggeredBy: text("triggered_by"), // username/account that ran a manual import; 'scheduler' for SFTP runs
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash"), // sha256 of file content, for duplicate detection
  period: text("period"), // YYYY-MM
  periodSource: text("period_source"), // 'column' | 'filename' | 'user'
  mode: text("mode"), // 'replace_period' | 'append'
  status: text("status").notNull().default('pending'), // pending | validated | imported | failed | skipped_duplicate | partial
  totalRows: integer("total_rows").default(0),
  validRows: integer("valid_rows").default(0),
  errorRows: integer("error_rows").default(0),
  insertedRows: integer("inserted_rows").default(0),
  deletedRows: integer("deleted_rows").default(0), // rows removed when replacing a period
  validationReport: jsonb("validation_report"), // { columnIssues: [], rowErrors: [...capped], warnings: [] }
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("import_runs_client_idx").on(table.clientId, table.datasetType),
]);

export const insertImportRunSchema = createInsertSchema(importRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});
export type ImportRun = typeof importRuns.$inferSelect;
export type InsertImportRun = z.infer<typeof insertImportRunSchema>;

// Scheduled SFTP import configurations
export const scheduledImports = pgTable("scheduled_imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull().default('demo'),
  name: text("name").notNull(),
  datasetType: text("dataset_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  encryptedPassword: text("encrypted_password"), // AES-256-GCM, key derived from env secret
  remotePath: text("remote_path").notNull(), // directory on the SFTP server
  filePattern: text("file_pattern").notNull().default('*.csv'), // wildcard, e.g. rentroll_*.csv
  scheduleTime: text("schedule_time").notNull().default('06:00'), // HH:MM 24h, server time
  frequency: text("frequency").notNull().default('daily'), // one_time | daily | weekly | monthly
  runDate: text("run_date"), // YYYY-MM-DD for one_time schedules
  dayOfWeek: integer("day_of_week"), // 0-6 for weekly
  dayOfMonth: integer("day_of_month"), // 1-28 for monthly
  deleteAfterImport: boolean("delete_after_import").notNull().default(false),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: text("last_run_status"), // success | failed | no_files | skipped_duplicate | partial
  lastRunMessage: text("last_run_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertScheduledImportSchema = createInsertSchema(scheduledImports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastRunAt: true,
  lastRunStatus: true,
  lastRunMessage: true,
  encryptedPassword: true,
}).extend({
  password: z.string().optional(), // plaintext in API only; encrypted before storage
});
export type ScheduledImport = typeof scheduledImports.$inferSelect;
export type InsertScheduledImport = z.infer<typeof insertScheduledImportSchema>;

// In-app notifications for import outcomes
export const importNotifications = pgTable("import_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull().default('demo'),
  importRunId: varchar("import_run_id"),
  severity: text("severity").notNull().default('info'), // info | warning | error
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("import_notifications_client_idx").on(table.clientId, table.read),
]);
export type ImportNotification = typeof importNotifications.$inferSelect;
