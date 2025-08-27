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

// Updated rent roll data table with complete field structure
export const rentRollData = pgTable("rent_roll_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(), // Format: YYYY-MM
  date: text("date").notNull(),
  location: text("location").notNull(),
  roomNumber: text("room_number").notNull(),
  roomType: text("room_type").notNull(),
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
  aiSuggestedRate: real("ai_suggested_rate"),
  promotionAllowance: real("promotion_allowance"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Rate card summary by room type
export const rateCard = pgTable("rate_card", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uploadMonth: text("upload_month").notNull(),
  roomType: text("room_type").notNull(),
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
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  rates: jsonb("rates"),
  avgCareRate: real("avg_care_rate"),
  createdAt: timestamp("created_at").defaultNow(),
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
  totalRecords: integer("total_records"),
  processedAt: timestamp("processed_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Insert schemas

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

export const insertAttributeRatingsSchema = createInsertSchema(attributeRatings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type RentRollData = typeof rentRollData.$inferSelect;
export type InsertRentRollData = z.infer<typeof insertRentRollDataSchema>;
export type Assumptions = typeof assumptions.$inferSelect;
export type InsertAssumptions = z.infer<typeof insertAssumptionsSchema>;
export type PricingWeights = typeof pricingWeights.$inferSelect;
export type InsertPricingWeights = z.infer<typeof insertPricingWeightsSchema>;
export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;
export type Guardrails = typeof guardrails.$inferSelect;
export type InsertGuardrails = z.infer<typeof insertGuardrailsSchema>;
export type RateCard = typeof rateCard.$inferSelect;
export type InsertRateCard = z.infer<typeof insertRateCardSchema>;
export type UploadHistory = typeof uploadHistory.$inferSelect;
export type InsertUploadHistory = z.infer<typeof insertUploadHistorySchema>;
export type AttributeRatings = typeof attributeRatings.$inferSelect;
export type InsertAttributeRatings = z.infer<typeof insertAttributeRatingsSchema>;
