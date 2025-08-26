import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const rentRollData = pgTable("rent_roll_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  unitId: text("unit_id").notNull(),
  occupiedYN: boolean("occupied_yn").notNull(),
  baseRent: real("base_rent").notNull(),
  careFee: real("care_fee"),
  roomType: text("room_type").notNull(),
  competitorBenchmarkRate: real("competitor_benchmark_rate"),
  competitorAvgCareRate: real("competitor_avg_care_rate"),
  daysVacant: integer("days_vacant").default(0),
  attributes: jsonb("attributes"),
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

export const guardrails = pgTable("guardrails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const mlModels = pgTable("ml_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  r2Score: real("r2_score"),
  trainingRows: integer("training_rows"),
  modelData: jsonb("model_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
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

export const insertGuardrailsSchema = createInsertSchema(guardrails).omit({
  id: true,
  createdAt: true,
});

export const insertMlModelSchema = createInsertSchema(mlModels).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
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
export type MlModel = typeof mlModels.$inferSelect;
export type InsertMlModel = z.infer<typeof insertMlModelSchema>;
