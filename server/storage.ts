import { 
  users,
  rentRollData,
  rateCard,
  uploadHistory,
  assumptions,
  pricingWeights,
  competitors,
  guardrails,
  adjustmentRanges,
  stockMarketCache,
  attributeRatings,
  locations,
  portfolioCompetitors,
  targetsAndTrends,
  aiPricingWeights,
  aiAdjustmentRanges,
  adjustmentRules,
  adjustmentRuleLog,
  campusMaps,
  floorPlans,
  unitPolygons,
  pricingHistory,
  rentRollHistory,
  enquireData,
  locationMappings,
  competitiveSurveyData,
  inquiryMetrics,
  type User, 
  type UpsertUser,
  type RentRollData,
  type InsertRentRollData,
  type RateCard,
  type InsertRateCard,
  type UploadHistory,
  type InsertUploadHistory,
  type Assumptions,
  type InsertAssumptions,
  type PricingWeights,
  type InsertPricingWeights,
  type Competitor,
  type InsertCompetitor,
  type Guardrails,
  type InsertGuardrails,
  type AdjustmentRanges,
  type InsertAdjustmentRanges,
  type StockMarketCache,
  type InsertStockMarketCache,
  type AttributeRatings,
  type InsertAttributeRatings,
  type Location,
  type InsertLocation,
  type PortfolioCompetitor,
  type InsertPortfolioCompetitor,
  type TargetsAndTrends,
  type InsertTargetsAndTrends,
  type AiPricingWeights,
  type InsertAiPricingWeights,
  type AiAdjustmentRanges,
  type InsertAiAdjustmentRanges,
  type AdjustmentRules,
  type InsertAdjustmentRules,
  type AdjustmentRuleLog,
  type InsertAdjustmentRuleLog,
  type CampusMap,
  type InsertCampusMap,
  type FloorPlan,
  type InsertFloorPlan,
  type UnitPolygon,
  type InsertUnitPolygon,
  type PricingHistory,
  type InsertPricingHistory,
  type LocationMapping,
  type InsertLocationMapping,
  type InquiryMetrics,
  type InsertInquiryMetrics
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import OpenAI from "openai";
import { calculateAttributedPrice, ensureCacheInitialized } from "./pricingOrchestrator";
import type { PricingInputs } from "./moduloPricingAlgorithm";

// Initialize OpenAI if API key is available
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Interface for storage operations
export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Location operations
  getLocations(): Promise<Location[]>;
  getAllCampuses(): Promise<Location[]>;
  getLocationById(id: string): Promise<Location | undefined>;
  getLocationByName(name: string): Promise<Location | undefined>;
  createLocation(data: InsertLocation): Promise<Location>;
  createOrUpdateLocation(data: InsertLocation): Promise<Location>;
  updateLocationUnits(locationId: string, unitCount: number): Promise<void>;
  
  // Rent roll data operations
  getRentRollData(): Promise<RentRollData[]>;
  getTotalUnits(): Promise<number>;
  getRentRollDataByMonth(uploadMonth: string): Promise<RentRollData[]>;
  getRentRollDataByLocation(location: string): Promise<RentRollData[]>;
  createRentRollData(data: InsertRentRollData): Promise<RentRollData>;
  uploadRentRollData(month: string, data: any[]): Promise<void>;
  bulkInsertRentRollData(data: any[]): Promise<void>;
  bulkUpdateModuloRates(updates: Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }>): Promise<void>;
  bulkUpdateAIRates(updates: Array<{ id: string; aiSuggestedRate: number; aiCalculationDetails: string }>): Promise<void>;
  clearRentRollData(): Promise<void>;
  clearRentRollDataByLocation(location: string): Promise<void>;
  
  // Rate card operations
  getRateCardByMonth(uploadMonth: string): Promise<RateCard[]>;
  createRateCard(data: any): Promise<void>;
  generateRateCard(uploadMonth: string): Promise<void>;
  
  // Upload history
  createUploadHistory(data: InsertUploadHistory): Promise<UploadHistory>;
  
  // Inquiry metrics
  bulkInsertInquiryMetrics(uploadMonth: string, data: InsertInquiryMetrics[]): Promise<void>;
  getInquiryMetricsByMonth(uploadMonth: string): Promise<InquiryMetrics[]>;
  
  // Assumptions
  getAssumptions(): Promise<Assumptions[]>;
  getCurrentAssumptions(): Promise<Assumptions | undefined>;
  updateAssumptions(data: any): Promise<void>;
  createOrUpdateAssumptions(data: InsertAssumptions): Promise<Assumptions>;
  
  // Pricing weights
  getPricingWeights(): Promise<PricingWeights | undefined>;
  updatePricingWeights(data: any): Promise<void>;
  getCurrentWeights(): Promise<PricingWeights | undefined>;
  createOrUpdateWeights(data: InsertPricingWeights): Promise<PricingWeights>;
  getWeightsByFilter(locationId?: string | null, serviceLine?: string | null): Promise<PricingWeights | undefined>;
  createOrUpdateWeightsByFilter(data: InsertPricingWeights, locationId?: string | null, serviceLine?: string | null): Promise<PricingWeights>;
  getAllWeightsGrouped(): Promise<PricingWeights[]>;
  bulkCreateOrUpdateWeights(weightsList: Array<InsertPricingWeights & { locationId?: string | null; serviceLine?: string | null }>): Promise<PricingWeights[]>;
  
  // Competitors
  getCompetitors(): Promise<Competitor[]>;
  getCompetitorsByLocation(location: string): Promise<Competitor[]>;
  createCompetitor(data: InsertCompetitor): Promise<Competitor>;
  updateCompetitor(id: string, data: InsertCompetitor): Promise<Competitor>;
  deleteCompetitor(id: string): Promise<void>;
  createOrUpdateCompetitor(data: InsertCompetitor): Promise<Competitor>;
  clearCompetitors(): Promise<void>;
  clearCompetitorsByLocation(location: string): Promise<void>;
  getTopCompetitorByWeight(location: string, serviceLine?: string): Promise<Competitor | undefined>;
  getTrilogyCareLevel2Rate(location: string, serviceLine: string): Promise<number | null>;
  
  // Portfolio Competitors
  getPortfolioCompetitors(): Promise<PortfolioCompetitor[]>;
  createOrUpdatePortfolioCompetitor(data: InsertPortfolioCompetitor): Promise<PortfolioCompetitor>;
  
  // Stock Market Cache
  getCachedStockData(symbol: string, dataType: string): Promise<StockMarketCache | undefined>;
  setCachedStockData(data: InsertStockMarketCache): Promise<StockMarketCache>;
  
  // Adjustment Ranges
  getAdjustmentRanges(): Promise<AdjustmentRanges | undefined>;
  updateAdjustmentRanges(data: InsertAdjustmentRanges): Promise<void>;
  createOrUpdateAdjustmentRanges(data: InsertAdjustmentRanges): Promise<AdjustmentRanges>;
  
  // Guardrails
  getGuardrails(): Promise<Guardrails[]>;
  updateGuardrails(data: any): Promise<void>;
  getCurrentGuardrails(): Promise<Guardrails | undefined>;
  createOrUpdateGuardrails(data: InsertGuardrails): Promise<Guardrails>;
  
  // Pricing suggestions
  generateModuloPricingSuggestions(units: any[], weights: PricingWeights, guardrails: Guardrails): Promise<any[]>;
  generateAIPricingSuggestions(units: any[], weights: PricingWeights, guardrails: Guardrails): Promise<any[]>;
  acceptPricingSuggestions(unitIds: string[], suggestionType: string): Promise<number>;
  
  // Clear all data
  clearAllData(): Promise<void>;
  
  // Get sample unit for calculation details
  getSampleUnitByRoomType(roomType: string): Promise<any>;
  
  // Adjustment Rules methods
  getAdjustmentRules(): Promise<AdjustmentRules[]>;
  getActiveAdjustmentRules(): Promise<AdjustmentRules[]>;
  createAdjustmentRule(rule: InsertAdjustmentRules): Promise<AdjustmentRules>;
  updateAdjustmentRule(id: string, rule: Partial<InsertAdjustmentRules>): Promise<AdjustmentRules>;
  deleteAdjustmentRule(id: string): Promise<void>;
  logRuleExecution(log: InsertAdjustmentRuleLog): Promise<AdjustmentRuleLog>;
  getRuleExecutionHistory(ruleId?: string): Promise<AdjustmentRuleLog[]>;
  
  // Floor Plans methods
  getCampusMaps(): Promise<any[]>;
  getCampusMapById(id: string): Promise<any | undefined>;
  getCampusMapByLocation(locationId: string): Promise<any | undefined>;
  createCampusMap(data: any): Promise<any>;
  updateCampusMap(id: string, data: any): Promise<any>;
  deleteCampusMap(id: string): Promise<void>;
  
  getFloorPlans(locationId?: string): Promise<any[]>;
  getFloorPlanById(id: string): Promise<any | undefined>;
  createFloorPlan(data: any): Promise<any>;
  updateFloorPlan(id: string, data: any): Promise<any>;
  deleteFloorPlan(id: string): Promise<void>;
  
  getUnitPolygons(campusMapId?: string): Promise<any[]>;
  getUnitPolygonById(id: string): Promise<any | undefined>;
  createUnitPolygon(data: any): Promise<any>;
  updateUnitPolygon(id: string, data: any): Promise<any>;
  deleteUnitPolygon(id: string): Promise<void>;
  
  // Pricing History methods
  createPricingHistory(data: InsertPricingHistory): Promise<PricingHistory>;
  getPricingHistory(limit: number): Promise<PricingHistory[]>;
  getPricingHistoryById(id: string): Promise<PricingHistory | undefined>;
  
  // Data Import methods
  getLocationMappings(): Promise<LocationMapping[]>;
  createLocationMapping(data: InsertLocationMapping): Promise<LocationMapping>;
  getRentRollHistorySummary(): Promise<{ months: string[]; totalRecords: number }>;
  getEnquireDataSummary(): Promise<{ totalRecords: number; mappedRecords: number; unmappedRecords: number }>;
  getCompetitiveSurveySummary(): Promise<{ months: string[]; totalRecords: number }>;
  getLocationMappingSummary(): Promise<{ totalMappings: number; autoMapped: number; manualMapped: number }>;
}

export class DatabaseStorage implements IStorage {
  // Clear all data
  async clearAllData(): Promise<void> {
    await db.delete(rentRollData);
    await db.delete(rateCard);
    await db.delete(uploadHistory);
    await db.delete(competitors);
    await db.delete(portfolioCompetitors);
    await db.delete(targetsAndTrends);
    await db.delete(locations);
    await db.delete(attributeRatings);
    await db.delete(assumptions);
    await db.delete(pricingWeights);
    await db.delete(guardrails);
  }

  async getSampleUnitByRoomType(roomType: string): Promise<any> {
    // Get the current month (latest upload)
    const currentMonth = new Date().toISOString().substring(0, 7);
    const units = await this.getRentRollDataByMonth(currentMonth);
    
    // If no units for current month, try previous month
    if (units.length === 0) {
      const previousMonth = '2024-11'; // Fallback to November 2024
      const fallbackUnits = await this.getRentRollDataByMonth(previousMonth);
      const matchingUnits = fallbackUnits.filter(unit => unit.roomType === roomType);
      
      if (matchingUnits.length === 0) {
        return fallbackUnits[0]; // Fallback to first unit if no matching type
      }
      
      // Return the unit with the highest street rate that has a modulo rate
      const unitsWithModulo = matchingUnits.filter(unit => unit.moduloSuggestedRate !== null);
      if (unitsWithModulo.length > 0) {
        return unitsWithModulo.reduce((highest, current) => {
          const highestRate = highest.streetRate || 0;
          const currentRate = current.streetRate || 0;
          return currentRate > highestRate ? current : highest;
        });
      }
      
      // If no units have modulo rates, return highest street rate unit
      return matchingUnits.reduce((highest, current) => {
        const highestRate = highest.streetRate || 0;
        const currentRate = current.streetRate || 0;
        return currentRate > highestRate ? current : highest;
      });
    }
    
    const matchingUnits = units.filter(unit => unit.roomType === roomType);
    
    if (matchingUnits.length === 0) {
      return units[0]; // Fallback to first unit if no matching type
    }
    
    // Return the unit with the highest street rate that has a modulo rate
    const unitsWithModulo = matchingUnits.filter(unit => unit.moduloSuggestedRate !== null);
    if (unitsWithModulo.length > 0) {
      return unitsWithModulo.reduce((highest, current) => {
        const highestRate = highest.streetRate || 0;
        const currentRate = current.streetRate || 0;
        return currentRate > highestRate ? current : highest;
      });
    }
    
    // If no units have modulo rates, return highest street rate unit
    return matchingUnits.reduce((highest, current) => {
      const highestRate = highest.streetRate || 0;
      const currentRate = current.streetRate || 0;
      return currentRate > highestRate ? current : highest;
    });
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Location operations
  async createLocation(data: InsertLocation): Promise<Location> {
    const [location] = await db.insert(locations).values(data).returning();
    return location;
  }

  async getLocations(): Promise<Location[]> {
    return await db.select().from(locations);
  }

  async getAllCampuses(): Promise<Location[]> {
    return await db.select().from(locations);
  }

  async getLocationById(id: string): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.id, id));
    return location;
  }

  async getLocationByName(name: string): Promise<Location | undefined> {
    const [location] = await db.select().from(locations).where(eq(locations.name, name));
    return location;
  }

  async createOrUpdateLocation(data: InsertLocation): Promise<Location> {
    const existing = await this.getLocationByName(data.name);
    if (existing) {
      const [updated] = await db
        .update(locations)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(locations.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(locations).values(data).returning();
    return created;
  }

  async updateLocationUnits(locationId: string, unitCount: number): Promise<void> {
    await db
      .update(locations)
      .set({ totalUnits: unitCount, updatedAt: new Date() })
      .where(eq(locations.id, locationId));
  }

  // Rent roll data operations
  async getRentRollData(): Promise<RentRollData[]> {
    return await db.select().from(rentRollData);
  }

  async getTotalUnits(): Promise<number> {
    const units = await db.select().from(rentRollData);
    return units.length;
  }

  async getRentRollDataByMonth(uploadMonth: string): Promise<RentRollData[]> {
    return await db.select().from(rentRollData).where(eq(rentRollData.uploadMonth, uploadMonth));
  }

  async getRentRollDataByLocation(location: string): Promise<RentRollData[]> {
    return await db.select().from(rentRollData).where(eq(rentRollData.location, location));
  }

  async createRentRollData(data: InsertRentRollData): Promise<RentRollData> {
    const [rentRoll] = await db.insert(rentRollData).values(data).returning();
    return rentRoll;
  }

  async bulkInsertRentRollData(data: any[]): Promise<void> {
    if (data.length === 0) return;
    await db.insert(rentRollData).values(data);
  }

  async clearRentRollData(): Promise<void> {
    await db.delete(rentRollData);
  }

  async clearRentRollDataByLocation(location: string): Promise<void> {
    await db.delete(rentRollData).where(eq(rentRollData.location, location));
  }

  async uploadRentRollData(month: string, data: any[]): Promise<void> {
    // Clear existing data for this month
    await db.delete(rentRollData).where(eq(rentRollData.uploadMonth, month));
    
    // Insert new data
    if (data.length > 0) {
      const dataWithMonth = data.map(item => ({ 
        ...item, 
        uploadMonth: month,
        roomNumber: item.roomNumber || item.unitId || 'N/A' // Ensure roomNumber is always set
      }));
      await db.insert(rentRollData).values(dataWithMonth);
    }
  }

  // Rate card operations
  async getRateCardByMonth(uploadMonth: string): Promise<RateCard[]> {
    return await db.select().from(rateCard).where(eq(rateCard.uploadMonth, uploadMonth));
  }

  async createRateCard(data: any): Promise<void> {
    await db.insert(rateCard).values(data);
  }

  async generateRateCard(uploadMonth: string): Promise<void> {
    // Get rent roll data for the month
    const units = await this.getRentRollDataByMonth(uploadMonth);
    
    // Group by service line and calculate averages
    const serviceLineStats = units.reduce((acc: any, unit: any) => {
      const serviceLine = unit.serviceLine || 'AL'; // Default to AL if not specified
      if (!acc[serviceLine]) {
        acc[serviceLine] = {
          streetRates: [],
          moduloRates: [],
          aiRates: [],
          occupied: 0,
          total: 0,
          roomTypes: new Set() // Track room types within this service line
        };
      }
      
      acc[serviceLine].streetRates.push(unit.streetRate);
      if (unit.moduloSuggestedRate) acc[serviceLine].moduloRates.push(unit.moduloSuggestedRate);
      if (unit.aiSuggestedRate) acc[serviceLine].aiRates.push(unit.aiSuggestedRate);
      acc[serviceLine].total++;
      if (unit.occupiedYN) acc[serviceLine].occupied++;
      acc[serviceLine].roomTypes.add(unit.roomType);
      
      return acc;
    }, {});

    // Delete existing rate cards for this month and insert new ones
    await db.delete(rateCard).where(eq(rateCard.uploadMonth, uploadMonth));
    
    for (const [serviceLine, stats] of Object.entries(serviceLineStats) as [string, any][]) {
      const avgStreet = stats.streetRates.reduce((sum: number, rate: number) => sum + rate, 0) / stats.streetRates.length;
      const avgModulo = stats.moduloRates.length > 0 ? stats.moduloRates.reduce((sum: number, rate: number) => sum + rate, 0) / stats.moduloRates.length : null;
      const avgAi = stats.aiRates.length > 0 ? stats.aiRates.reduce((sum: number, rate: number) => sum + rate, 0) / stats.aiRates.length : null;
      
      // Use service line as the primary grouping, with representative room type
      const roomTypesList = Array.from(stats.roomTypes);
      const primaryRoomType = roomTypesList[0] || 'Studio'; // Use first room type as representative
      
      await db.insert(rateCard).values({
        uploadMonth,
        roomType: primaryRoomType, // Keep for compatibility, but now it's just representative
        serviceLine: serviceLine,
        averageStreetRate: avgStreet,
        averageModuloRate: avgModulo,
        averageAiRate: avgAi,
        occupancyCount: stats.occupied,
        totalUnits: stats.total
      });
    }
  }

  // Additional methods needed for pricing suggestions
  async getLatestWeights(): Promise<PricingWeights | undefined> {
    return await this.getCurrentWeights();
  }

  async getRentRollDataById(id: string): Promise<RentRollData | undefined> {
    const [unit] = await db.select().from(rentRollData).where(eq(rentRollData.id, id));
    return unit;
  }

  async updateRentRollData(id: string, data: Partial<RentRollData>): Promise<void> {
    await db.update(rentRollData).set(data).where(eq(rentRollData.id, id));
  }

  async bulkUpdateModuloRates(updates: Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }>): Promise<void> {
    // Process in batches of 50 and run updates in parallel within each batch
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      // Run all updates in this batch in parallel
      await Promise.all(
        batch.map(update => 
          db.update(rentRollData)
            .set({
              moduloSuggestedRate: update.moduloSuggestedRate,
              moduloCalculationDetails: update.moduloCalculationDetails
            })
            .where(eq(rentRollData.id, update.id))
        )
      );
      
      console.log(`Updated Modulo batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(updates.length / batchSize)} (${batch.length} units)`);
    }
  }

  async bulkUpdateAIRates(updates: Array<{ id: string; aiSuggestedRate: number; aiCalculationDetails: string }>): Promise<void> {
    // Process in batches of 50 and run updates in parallel within each batch
    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      
      // Run all updates in this batch in parallel
      await Promise.all(
        batch.map(update => 
          db.update(rentRollData)
            .set({
              aiSuggestedRate: update.aiSuggestedRate,
              aiCalculationDetails: update.aiCalculationDetails
            })
            .where(eq(rentRollData.id, update.id))
        )
      );
      
      console.log(`Updated AI batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(updates.length / batchSize)} (${batch.length} units)`);
    }
  }

  // Attribute ratings operations
  async getAttributeRatings(): Promise<any[]> {
    return await db.select().from(attributeRatings);
  }

  async updateAttributeRating(attributeType: string, ratingLevel: string, adjustmentPercent: number, description?: string): Promise<void> {
    const existing = await db.select().from(attributeRatings)
      .where(and(eq(attributeRatings.attributeType, attributeType), eq(attributeRatings.ratingLevel, ratingLevel)));
    
    if (existing.length > 0) {
      await db.update(attributeRatings)
        .set({ adjustmentPercent, description, updatedAt: new Date() })
        .where(and(eq(attributeRatings.attributeType, attributeType), eq(attributeRatings.ratingLevel, ratingLevel)));
    } else {
      await db.insert(attributeRatings).values({
        attributeType,
        ratingLevel,
        adjustmentPercent,
        description
      });
    }
  }

  async initializeDefaultAttributeRatings(): Promise<void> {
    const defaultRatings = [
      // Location ratings
      { attributeType: 'location', ratingLevel: 'A', adjustmentPercent: 5, description: 'Premium location (Main Building, close to amenities)' },
      { attributeType: 'location', ratingLevel: 'B', adjustmentPercent: 0, description: 'Standard location' },
      { attributeType: 'location', ratingLevel: 'C', adjustmentPercent: -3, description: 'Less desirable location' },
      
      // Size ratings
      { attributeType: 'size', ratingLevel: 'A', adjustmentPercent: 8, description: 'Large units (Two Bedroom)' },
      { attributeType: 'size', ratingLevel: 'B', adjustmentPercent: 3, description: 'Medium units (One Bedroom)' },
      { attributeType: 'size', ratingLevel: 'C', adjustmentPercent: 0, description: 'Smaller units (Studio)' },
      
      // View ratings
      { attributeType: 'view', ratingLevel: 'A', adjustmentPercent: 4, description: 'Premium views (Garden, Courtyard)' },
      { attributeType: 'view', ratingLevel: 'B', adjustmentPercent: 1, description: 'Partial view' },
      { attributeType: 'view', ratingLevel: 'C', adjustmentPercent: 0, description: 'Standard/No view' },
      
      // Renovation ratings
      { attributeType: 'renovation', ratingLevel: 'A', adjustmentPercent: 6, description: 'Recently renovated (within 2 years)' },
      { attributeType: 'renovation', ratingLevel: 'B', adjustmentPercent: 2, description: 'Some updates' },
      { attributeType: 'renovation', ratingLevel: 'C', adjustmentPercent: 0, description: 'No recent renovation' },
      
      // Amenity ratings  
      { attributeType: 'amenity', ratingLevel: 'A', adjustmentPercent: 3, description: 'Premium amenities' },
      { attributeType: 'amenity', ratingLevel: 'B', adjustmentPercent: 1, description: 'Standard amenities' },
      { attributeType: 'amenity', ratingLevel: 'C', adjustmentPercent: 0, description: 'Basic amenities' }
    ];

    for (const rating of defaultRatings) {
      await this.updateAttributeRating(rating.attributeType, rating.ratingLevel, rating.adjustmentPercent, rating.description);
    }
  }

  // Upload history
  async createUploadHistory(data: InsertUploadHistory): Promise<UploadHistory> {
    const [history] = await db.insert(uploadHistory).values(data).returning();
    return history;
  }

  // Inquiry metrics
  async bulkInsertInquiryMetrics(uploadMonth: string, data: InsertInquiryMetrics[]): Promise<void> {
    await db.delete(inquiryMetrics).where(eq(inquiryMetrics.uploadMonth, uploadMonth));
    if (data.length > 0) {
      await db.insert(inquiryMetrics).values(data);
    }
  }

  async getInquiryMetricsByMonth(uploadMonth: string): Promise<InquiryMetrics[]> {
    return await db.select().from(inquiryMetrics).where(eq(inquiryMetrics.uploadMonth, uploadMonth));
  }

  // Assumptions
  async getAssumptions(): Promise<Assumptions[]> {
    return await db.select().from(assumptions);
  }

  async getCurrentAssumptions(): Promise<Assumptions | undefined> {
    const [assumption] = await db.select().from(assumptions).limit(1);
    return assumption;
  }

  async updateAssumptions(data: any): Promise<void> {
    await db.delete(assumptions);
    await db.insert(assumptions).values(data);
  }

  async createOrUpdateAssumptions(data: InsertAssumptions): Promise<Assumptions> {
    // Delete existing and insert new
    await db.delete(assumptions);
    const [assumption] = await db.insert(assumptions).values(data).returning();
    return assumption;
  }

  // Pricing weights
  async getPricingWeights(): Promise<PricingWeights | undefined> {
    const [weights] = await db.select().from(pricingWeights).limit(1);
    return weights;
  }

  async updatePricingWeights(data: any): Promise<void> {
    await db.delete(pricingWeights);
    await db.insert(pricingWeights).values(data);
  }

  async getCurrentWeights(): Promise<PricingWeights | undefined> {
    const [weights] = await db.select().from(pricingWeights).limit(1);
    return weights;
  }

  async createOrUpdateWeights(data: InsertPricingWeights): Promise<PricingWeights> {
    await db.delete(pricingWeights);
    const [weights] = await db.insert(pricingWeights).values(data).returning();
    return weights;
  }

  async getWeightsByFilter(locationId?: string | null, serviceLine?: string | null): Promise<PricingWeights | undefined> {
    let query = db.select().from(pricingWeights);
    
    if (locationId === undefined && serviceLine === undefined) {
      query = query.where(and(isNull(pricingWeights.locationId), isNull(pricingWeights.serviceLine)));
    } else if (locationId && !serviceLine) {
      query = query.where(and(eq(pricingWeights.locationId, locationId), isNull(pricingWeights.serviceLine)));
    } else if (locationId && serviceLine) {
      query = query.where(and(eq(pricingWeights.locationId, locationId), eq(pricingWeights.serviceLine, serviceLine)));
    } else {
      query = query.where(and(isNull(pricingWeights.locationId), isNull(pricingWeights.serviceLine)));
    }
    
    const [weights] = await query.limit(1);
    return weights;
  }

  async createOrUpdateWeightsByFilter(data: InsertPricingWeights, locationId?: string | null, serviceLine?: string | null): Promise<PricingWeights> {
    const weightData = {
      ...data,
      locationId: locationId || null,
      serviceLine: serviceLine || null,
    };
    
    let deleteQuery = db.delete(pricingWeights);
    
    if (locationId === undefined && serviceLine === undefined) {
      deleteQuery = deleteQuery.where(and(isNull(pricingWeights.locationId), isNull(pricingWeights.serviceLine)));
    } else if (locationId && !serviceLine) {
      deleteQuery = deleteQuery.where(and(eq(pricingWeights.locationId, locationId), isNull(pricingWeights.serviceLine)));
    } else if (locationId && serviceLine) {
      deleteQuery = deleteQuery.where(and(eq(pricingWeights.locationId, locationId), eq(pricingWeights.serviceLine, serviceLine)));
    } else {
      deleteQuery = deleteQuery.where(and(isNull(pricingWeights.locationId), isNull(pricingWeights.serviceLine)));
    }
    
    await deleteQuery;
    const [weights] = await db.insert(pricingWeights).values(weightData).returning();
    return weights;
  }

  async getAllWeightsGrouped(): Promise<PricingWeights[]> {
    return await db.select().from(pricingWeights);
  }

  async bulkCreateOrUpdateWeights(weightsList: Array<InsertPricingWeights & { locationId?: string | null; serviceLine?: string | null }>): Promise<PricingWeights[]> {
    const results: PricingWeights[] = [];
    
    for (const weightData of weightsList) {
      const result = await this.createOrUpdateWeightsByFilter(weightData, weightData.locationId, weightData.serviceLine);
      results.push(result);
    }
    
    return results;
  }

  // Competitors
  async getCompetitors(): Promise<Competitor[]> {
    return await db.select().from(competitors);
  }

  async getCompetitorsByLocation(location: string): Promise<Competitor[]> {
    return await db.select().from(competitors).where(eq(competitors.location, location));
  }

  async createCompetitor(data: InsertCompetitor): Promise<Competitor> {
    const [competitor] = await db.insert(competitors).values(data).returning();
    return competitor;
  }

  async updateCompetitor(id: string, data: InsertCompetitor): Promise<Competitor> {
    const [updated] = await db.update(competitors)
      .set(data)
      .where(eq(competitors.id, id))
      .returning();
    return updated;
  }

  async deleteCompetitor(id: string): Promise<void> {
    await db.delete(competitors).where(eq(competitors.id, id));
  }

  async createOrUpdateCompetitor(data: InsertCompetitor): Promise<Competitor> {
    const existing = await db.select().from(competitors).where(eq(competitors.name, data.name));
    if (existing.length > 0) {
      const [updated] = await db.update(competitors)
        .set(data)
        .where(eq(competitors.name, data.name))
        .returning();
      return updated;
    } else {
      return await this.createCompetitor(data);
    }
  }

  async clearCompetitors(): Promise<void> {
    await db.delete(competitors);
  }

  async clearCompetitorsByLocation(location: string): Promise<void> {
    await db.delete(competitors).where(eq(competitors.location, location));
  }

  async getTopCompetitorByWeight(location: string, serviceLine?: string): Promise<Competitor | undefined> {
    const locationCompetitors = await db.select()
      .from(competitors)
      .where(eq(competitors.location, location));
    
    if (locationCompetitors.length === 0) {
      return undefined;
    }
    
    // Map service line to facility types for filtering
    const servicLineToFacilityType: Record<string, string[]> = {
      'AL': ['Assisted Living', 'Senior Living'],
      'AL/MC': ['Memory Care', 'Alzheimers Care'],
      'HC': ['Skilled Nursing', 'Nursing Home'],
      'IL': ['Independent Living', 'Senior Living'],
      'SL': ['Skilled Nursing', 'Senior Living']
    };
    
    let filteredCompetitors = locationCompetitors;
    
    // If service line provided, try to filter by matching facility type
    if (serviceLine && servicLineToFacilityType[serviceLine]) {
      const matchingTypes = servicLineToFacilityType[serviceLine];
      const matchedByType = locationCompetitors.filter(c => {
        const attrs = c.attributes as any;
        return attrs?.facility_type && matchingTypes.some(type => 
          attrs.facility_type.toLowerCase().includes(type.toLowerCase())
        );
      });
      
      // Use filtered list if we found matches, otherwise fall back to all
      if (matchedByType.length > 0) {
        filteredCompetitors = matchedByType;
      }
    }
    
    const validCompetitors = filteredCompetitors.filter(
      c => c.weight != null && c.streetRate != null
    );
    
    if (validCompetitors.length === 0) {
      return filteredCompetitors.find(c => c.streetRate != null) || filteredCompetitors[0];
    }
    
    return validCompetitors.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
  }

  async getTrilogyCareLevel2Rate(location: string, serviceLine: string): Promise<number | null> {
    const result = await db.select({
      careRate: rentRollData.careRate
    })
      .from(rentRollData)
      .where(
        and(
          eq(rentRollData.location, location),
          eq(rentRollData.serviceLine, serviceLine),
          sql`${rentRollData.careLevel} = '2' OR ${rentRollData.careLevel} ILIKE '%level 2%' OR ${rentRollData.careLevel} ILIKE '%L2%'`
        )
      )
      .limit(10);
    
    if (result.length === 0) {
      return null;
    }
    
    const validRates = result.map(r => r.careRate).filter((rate): rate is number => rate != null);
    
    if (validRates.length === 0) {
      return null;
    }
    
    const avgRate = validRates.reduce((sum, rate) => sum + rate, 0) / validRates.length;
    return avgRate;
  }

  // Targets and Trends operations
  async getTargetsAndTrends(): Promise<TargetsAndTrends[]> {
    return await db.select().from(targetsAndTrends);
  }

  async getTargetsAndTrendsByMonth(month: string): Promise<TargetsAndTrends[]> {
    return await db.select().from(targetsAndTrends).where(eq(targetsAndTrends.month, month));
  }

  async getTargetsAndTrendsByCampus(campus: string): Promise<TargetsAndTrends[]> {
    return await db.select().from(targetsAndTrends).where(eq(targetsAndTrends.campus, campus));
  }

  async createTargetsAndTrends(data: InsertTargetsAndTrends): Promise<TargetsAndTrends> {
    // Auto-calculate conversion rate
    const processedData = {
      ...data,
      conversionRate: data.inquiries > 0 ? (data.moveIns / data.inquiries) * 100 : 0
    };
    const [result] = await db.insert(targetsAndTrends).values(processedData).returning();
    return result;
  }

  async bulkInsertTargetsAndTrends(data: any[]): Promise<void> {
    if (data.length === 0) return;
    // Auto-calculate conversion rate for each record
    const processedData = data.map(record => ({
      ...record,
      conversionRate: record.inquiries > 0 ? (record.moveIns / record.inquiries) * 100 : 0
    }));
    await db.insert(targetsAndTrends).values(processedData);
  }

  async clearTargetsAndTrendsByCampus(campus: string): Promise<void> {
    await db.delete(targetsAndTrends).where(eq(targetsAndTrends.campus, campus));
  }

  // Portfolio Competitors
  async getPortfolioCompetitors(): Promise<PortfolioCompetitor[]> {
    return await db.select().from(portfolioCompetitors);
  }

  async createOrUpdatePortfolioCompetitor(data: InsertPortfolioCompetitor): Promise<PortfolioCompetitor> {
    const existing = await db.select().from(portfolioCompetitors).where(eq(portfolioCompetitors.name, data.name));
    if (existing.length > 0) {
      const [updated] = await db.update(portfolioCompetitors)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(portfolioCompetitors.name, data.name))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(portfolioCompetitors).values(data).returning();
      return created;
    }
  }

  // Stock Market Cache
  async getCachedStockData(symbol: string, dataType: string): Promise<StockMarketCache | undefined> {
    const now = new Date();
    const [cached] = await db.select()
      .from(stockMarketCache)
      .where(
        and(
          eq(stockMarketCache.symbol, symbol),
          eq(stockMarketCache.dataType, dataType)
        )
      );
    
    // Return cached data only if it hasn't expired
    if (cached && cached.expiresAt > now) {
      return cached;
    }
    return undefined;
  }

  async setCachedStockData(data: InsertStockMarketCache): Promise<StockMarketCache> {
    // Delete old cache for this symbol/dataType combo
    await db.delete(stockMarketCache)
      .where(
        and(
          eq(stockMarketCache.symbol, data.symbol),
          eq(stockMarketCache.dataType, data.dataType)
        )
      );
    
    // Insert new cache entry
    const [cache] = await db.insert(stockMarketCache).values(data).returning();
    return cache;
  }

  // Adjustment Ranges
  async getAdjustmentRanges(): Promise<AdjustmentRanges | undefined> {
    const [ranges] = await db.select().from(adjustmentRanges).limit(1);
    return ranges;
  }

  async updateAdjustmentRanges(data: InsertAdjustmentRanges): Promise<void> {
    await db.delete(adjustmentRanges);
    await db.insert(adjustmentRanges).values(data);
  }

  async createOrUpdateAdjustmentRanges(data: InsertAdjustmentRanges): Promise<AdjustmentRanges> {
    await db.delete(adjustmentRanges);
    const [ranges] = await db.insert(adjustmentRanges).values(data).returning();
    return ranges;
  }
  
  // AI-specific Pricing Weights
  async getAiPricingWeights(): Promise<AiPricingWeights | undefined> {
    const [weights] = await db.select().from(aiPricingWeights).limit(1);
    return weights;
  }
  
  async createOrUpdateAiPricingWeights(data: InsertAiPricingWeights): Promise<AiPricingWeights> {
    await db.delete(aiPricingWeights);
    const [weights] = await db.insert(aiPricingWeights).values(data).returning();
    return weights;
  }
  
  // AI-specific Adjustment Ranges  
  async getAiAdjustmentRanges(): Promise<AiAdjustmentRanges | undefined> {
    const [ranges] = await db.select().from(aiAdjustmentRanges).limit(1);
    return ranges;
  }
  
  async createOrUpdateAiAdjustmentRanges(data: InsertAiAdjustmentRanges): Promise<AiAdjustmentRanges> {
    await db.delete(aiAdjustmentRanges);
    const [ranges] = await db.insert(aiAdjustmentRanges).values(data).returning();
    return ranges;
  }

  // Guardrails
  async getGuardrails(): Promise<Guardrails[]> {
    return await db.select().from(guardrails);
  }

  async updateGuardrails(data: any): Promise<void> {
    await db.delete(guardrails);
    await db.insert(guardrails).values(data);
  }

  async getCurrentGuardrails(): Promise<Guardrails | undefined> {
    const [guardrail] = await db.select().from(guardrails).limit(1);
    return guardrail;
  }

  async createOrUpdateGuardrails(data: InsertGuardrails): Promise<Guardrails> {
    await db.delete(guardrails);
    const [guardrail] = await db.insert(guardrails).values(data).returning();
    return guardrail;
  }

  // Pricing suggestions
  async generateModuloPricingSuggestions(units: any[], weights: PricingWeights, guardrails: Guardrails): Promise<any[]> {
    await ensureCacheInitialized();
    
    const updatedUnits = [];
    
    const occupiedCount = units.filter(u => u.occupiedYN).length;
    const actualOccupancyRate = units.length > 0 ? occupiedCount / units.length : 0.85;
    
    const currentMonth = new Date().getMonth() + 1;
    const marketReturn = 0.023;
    
    const locationInquiries = await this.getInquiryMetricsByMonth(units[0]?.uploadMonth || new Date().toISOString().slice(0, 7));
    const demandCurrent = locationInquiries.length > 0 ? locationInquiries[0].inquiries || 50 : 50;
    const demandHistory = [45, 52, 48, 55, 50, 47];
    
    for (const unit of units) {
      const competitorPrices = unit.competitorRate ? [unit.competitorRate] : [];
      
      const pricingInputs: PricingInputs = {
        occupancy: actualOccupancyRate,
        daysVacant: unit.daysVacant || 0,
        monthIndex: currentMonth,
        competitorPrices,
        marketReturn,
        demandCurrent,
        demandHistory,
        serviceLine: unit.serviceLine
      };
      
      const calculationDetails = await calculateAttributedPrice(unit, weights, pricingInputs, guardrails);
      
      // Issue 2 fix: Store all rate values for complete audit trail
      // - finalPrice (after guardrails) -> moduloSuggestedRate field
      // - All rates (finalPrice, attributedRate, moduloRate, baseRate) -> calculation details JSON
      const suggestedRate = calculationDetails.finalPrice;
      const calculationDetailsJson = JSON.stringify(calculationDetails);

      await db.update(rentRollData)
        .set({ 
          moduloSuggestedRate: suggestedRate,
          moduloCalculationDetails: calculationDetailsJson
        })
        .where(eq(rentRollData.id, unit.id));

      updatedUnits.push({...unit, moduloSuggestedRate: suggestedRate, moduloCalculationDetails: calculationDetailsJson});
    }

    return updatedUnits;
  }

  async generateAIPricingSuggestions(units: any[], weights: PricingWeights, guardrails: Guardrails): Promise<any[]> {
    await ensureCacheInitialized();
    
    const updatedUnits = [];
    
    const occupiedCount = units.filter(u => u.occupiedYN).length;
    const actualOccupancyRate = units.length > 0 ? occupiedCount / units.length : 0.85;
    
    const currentMonth = new Date().getMonth() + 1;
    const marketReturn = 0.023;
    
    const locationInquiries = await this.getInquiryMetricsByMonth(units[0]?.uploadMonth || new Date().toISOString().slice(0, 7));
    const demandCurrent = locationInquiries.length > 0 ? locationInquiries[0].inquiries || 50 : 50;
    const demandHistory = [45, 52, 48, 55, 50, 47];
    
    for (const unit of units) {
      const competitorPrices = unit.competitorRate ? [unit.competitorRate] : [];
      
      const pricingInputs: PricingInputs = {
        occupancy: actualOccupancyRate,
        daysVacant: unit.daysVacant || 0,
        monthIndex: currentMonth,
        competitorPrices,
        marketReturn,
        demandCurrent,
        demandHistory,
        serviceLine: unit.serviceLine
      };
      
      const calculationDetails = await calculateAttributedPrice(unit, weights, pricingInputs, guardrails);
      
      // Issue 2 fix: Store all rate values for complete audit trail
      // - finalPrice (after guardrails) -> aiSuggestedRate field
      // - All rates (finalPrice, attributedRate, moduloRate, baseRate) -> calculation details JSON
      const suggestedRate = calculationDetails.finalPrice;
      const calculationDetailsJson = JSON.stringify(calculationDetails);

      await db.update(rentRollData)
        .set({ 
          aiSuggestedRate: suggestedRate,
          aiCalculationDetails: calculationDetailsJson
        })
        .where(eq(rentRollData.id, unit.id));

      updatedUnits.push({...unit, aiSuggestedRate: suggestedRate, aiCalculationDetails: calculationDetailsJson});
    }

    return updatedUnits;
  }

  async acceptPricingSuggestions(unitIds: string[], suggestionType: string): Promise<number> {
    let updatedCount = 0;
    
    for (const unitId of unitIds) {
      const [unit] = await db.select().from(rentRollData).where(eq(rentRollData.id, unitId));
      
      if (unit) {
        const newRate = suggestionType === 'modulo' ? unit.moduloSuggestedRate : unit.aiSuggestedRate;
        
        if (newRate) {
          await db.update(rentRollData)
            .set({ streetRate: newRate })
            .where(eq(rentRollData.id, unitId));
          updatedCount++;
        }
      }
    }

    return updatedCount;
  }
  
  // Adjustment Rules methods implementation
  async getAdjustmentRules(): Promise<AdjustmentRules[]> {
    return await db.select().from(adjustmentRules);
  }

  async getActiveAdjustmentRules(): Promise<AdjustmentRules[]> {
    return await db.select().from(adjustmentRules).where(eq(adjustmentRules.isActive, true));
  }

  async createAdjustmentRule(rule: InsertAdjustmentRules): Promise<AdjustmentRules> {
    const [newRule] = await db.insert(adjustmentRules).values(rule).returning();
    return newRule;
  }

  async updateAdjustmentRule(id: string, rule: Partial<InsertAdjustmentRules>): Promise<AdjustmentRules> {
    const [updatedRule] = await db.update(adjustmentRules)
      .set({ ...rule, updatedAt: new Date() })
      .where(eq(adjustmentRules.id, id))
      .returning();
    return updatedRule;
  }

  async deleteAdjustmentRule(id: string): Promise<void> {
    await db.delete(adjustmentRules).where(eq(adjustmentRules.id, id));
  }

  async logRuleExecution(log: InsertAdjustmentRuleLog): Promise<AdjustmentRuleLog> {
    const [newLog] = await db.insert(adjustmentRuleLog).values(log).returning();
    return newLog;
  }

  async getRuleExecutionHistory(ruleId?: string): Promise<AdjustmentRuleLog[]> {
    if (ruleId) {
      return await db.select().from(adjustmentRuleLog).where(eq(adjustmentRuleLog.ruleId, ruleId));
    }
    return await db.select().from(adjustmentRuleLog);
  }
  
  // Floor Plans methods implementation
  async getCampusMaps(): Promise<CampusMap[]> {
    return await db.select().from(campusMaps);
  }

  async getCampusMapById(id: string): Promise<CampusMap | undefined> {
    const [map] = await db.select().from(campusMaps).where(eq(campusMaps.id, id));
    return map;
  }

  async getCampusMapByLocation(locationId: string): Promise<CampusMap | undefined> {
    const [map] = await db.select().from(campusMaps).where(eq(campusMaps.locationId, locationId));
    return map;
  }

  async createCampusMap(data: InsertCampusMap): Promise<CampusMap> {
    const [newMap] = await db.insert(campusMaps).values(data).returning();
    return newMap;
  }

  async updateCampusMap(id: string, data: Partial<InsertCampusMap>): Promise<CampusMap> {
    const [updatedMap] = await db.update(campusMaps)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(campusMaps.id, id))
      .returning();
    return updatedMap;
  }

  async deleteCampusMap(id: string): Promise<void> {
    // Also delete associated polygons
    await db.delete(unitPolygons).where(eq(unitPolygons.campusMapId, id));
    await db.delete(campusMaps).where(eq(campusMaps.id, id));
  }

  async getFloorPlans(locationId?: string): Promise<FloorPlan[]> {
    if (locationId) {
      return await db.select().from(floorPlans).where(eq(floorPlans.locationId, locationId));
    }
    return await db.select().from(floorPlans);
  }

  async getFloorPlanById(id: string): Promise<FloorPlan | undefined> {
    const [plan] = await db.select().from(floorPlans).where(eq(floorPlans.id, id));
    return plan;
  }

  async createFloorPlan(data: InsertFloorPlan): Promise<FloorPlan> {
    const [newPlan] = await db.insert(floorPlans).values(data).returning();
    return newPlan;
  }

  async updateFloorPlan(id: string, data: Partial<InsertFloorPlan>): Promise<FloorPlan> {
    const [updatedPlan] = await db.update(floorPlans)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(floorPlans.id, id))
      .returning();
    return updatedPlan;
  }

  async deleteFloorPlan(id: string): Promise<void> {
    await db.delete(floorPlans).where(eq(floorPlans.id, id));
  }

  async getUnitPolygons(campusMapId?: string): Promise<UnitPolygon[]> {
    if (campusMapId) {
      return await db.select().from(unitPolygons).where(eq(unitPolygons.campusMapId, campusMapId));
    }
    return await db.select().from(unitPolygons);
  }

  async getUnitPolygonById(id: string): Promise<UnitPolygon | undefined> {
    const [polygon] = await db.select().from(unitPolygons).where(eq(unitPolygons.id, id));
    return polygon;
  }

  async createUnitPolygon(data: InsertUnitPolygon): Promise<UnitPolygon> {
    const [newPolygon] = await db.insert(unitPolygons).values(data).returning();
    return newPolygon;
  }

  async updateUnitPolygon(id: string, data: Partial<InsertUnitPolygon>): Promise<UnitPolygon> {
    const [updatedPolygon] = await db.update(unitPolygons)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(unitPolygons.id, id))
      .returning();
    return updatedPolygon;
  }

  async deleteUnitPolygon(id: string): Promise<void> {
    await db.delete(unitPolygons).where(eq(unitPolygons.id, id));
  }

  // Pricing History implementations
  async createPricingHistory(data: InsertPricingHistory): Promise<PricingHistory> {
    const result = await db.insert(pricingHistory).values(data).returning();
    return result[0];
  }

  async getPricingHistory(limit: number): Promise<PricingHistory[]> {
    return await db.select()
      .from(pricingHistory)
      .orderBy(desc(pricingHistory.appliedAt))
      .limit(limit);
  }

  async getPricingHistoryById(id: string): Promise<PricingHistory | undefined> {
    const result = await db.select()
      .from(pricingHistory)
      .where(eq(pricingHistory.id, id))
      .limit(1);
    return result[0];
  }

  // Data Import implementations
  async getLocationMappings(): Promise<LocationMapping[]> {
    return await db.select().from(locationMappings);
  }

  async createLocationMapping(data: InsertLocationMapping): Promise<LocationMapping> {
    const [newMapping] = await db.insert(locationMappings).values(data).returning();
    return newMapping;
  }

  async getRentRollHistorySummary(): Promise<{ months: string[]; totalRecords: number }> {
    const records = await db.selectDistinct({ month: rentRollHistory.uploadMonth })
      .from(rentRollHistory)
      .orderBy(rentRollHistory.uploadMonth);
    
    const totalCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(rentRollHistory);
    
    return {
      months: records.map(r => r.month),
      totalRecords: totalCount[0]?.count || 0
    };
  }

  async getEnquireDataSummary(): Promise<{ totalRecords: number; mappedRecords: number; unmappedRecords: number }> {
    const total = await db.select({ count: sql<number>`count(*)::int` })
      .from(enquireData);
    
    const mapped = await db.select({ count: sql<number>`count(*)::int` })
      .from(enquireData)
      .where(sql`${enquireData.mappedLocationId} IS NOT NULL`);
    
    const totalCount = total[0]?.count || 0;
    const mappedCount = mapped[0]?.count || 0;
    
    return {
      totalRecords: totalCount,
      mappedRecords: mappedCount,
      unmappedRecords: totalCount - mappedCount
    };
  }

  async getCompetitiveSurveySummary(): Promise<{ months: string[]; totalRecords: number }> {
    const records = await db.selectDistinct({ month: competitiveSurveyData.surveyMonth })
      .from(competitiveSurveyData)
      .orderBy(competitiveSurveyData.surveyMonth);
    
    const totalCount = await db.select({ count: sql<number>`count(*)::int` })
      .from(competitiveSurveyData);
    
    return {
      months: records.map(r => r.month),
      totalRecords: totalCount[0]?.count || 0
    };
  }

  async getLocationMappingSummary(): Promise<{ totalMappings: number; autoMapped: number; manualMapped: number }> {
    const total = await db.select({ count: sql<number>`count(*)::int` })
      .from(locationMappings);
    
    const manual = await db.select({ count: sql<number>`count(*)::int` })
      .from(locationMappings)
      .where(eq(locationMappings.isManualMapping, true));
    
    const totalCount = total[0]?.count || 0;
    const manualCount = manual[0]?.count || 0;
    
    return {
      totalMappings: totalCount,
      autoMapped: totalCount - manualCount,
      manualMapped: manualCount
    };
  }
}

export const storage = new DatabaseStorage();