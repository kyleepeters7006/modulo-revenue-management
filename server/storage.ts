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
  calculationHistory,
  revenueGrowthTargets,
  aiRateOutcomes,
  roomTypeBasePrices,
  careLevelRates,
  type CareLevelRate,
  type InsertCareLevelRate,
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
  type CompetitorWithRates,
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
  type InsertInquiryMetrics,
  type CalculationHistory,
  type InsertCalculationHistory,
  type RevenueGrowthTarget,
  type InsertRevenueGrowthTarget
} from "@shared/schema";
import { compareRoomTypes } from "@shared/roomTypes";
import { db } from "./db";
import { eq, and, asc, desc, sql, isNull, inArray, or } from "drizzle-orm";
import { calculateAttributedPrice, ensureCacheInitialized } from "./pricingOrchestrator";
import type { PricingInputs } from "./moduloPricingAlgorithm";
import { calculateDistance } from "./geocoding";

// Interface for storage operations
export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Location operations
  getLocations(clientId?: string): Promise<Location[]>;
  getAllCampuses(clientId?: string): Promise<Location[]>;
  getLocationById(id: string): Promise<Location | undefined>;
  getLocationByName(name: string): Promise<Location | undefined>;
  createLocation(data: InsertLocation): Promise<Location>;
  createOrUpdateLocation(data: InsertLocation): Promise<Location>;
  updateLocationUnits(locationId: string, unitCount: number): Promise<void>;
  
  // Rent roll data operations
  getRentRollData(clientId?: string): Promise<RentRollData[]>;
  getTotalUnits(): Promise<number>;
  getRentRollDataByMonth(uploadMonth: string, clientId?: string): Promise<RentRollData[]>;
  getRentRollDataFiltered(month: string, filters: {
    regions?: string[];
    divisions?: string[];
    locations?: string[];
    offset?: number;
    limit?: number;
    clientId?: string;
  }): Promise<RentRollData[]>;
  getRentRollDataByLocation(location: string, clientId?: string): Promise<RentRollData[]>;
  getRevenueByMonths(months: string[], clientId?: string, sameStoreOnly?: boolean): Promise<Record<string, number>>;
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
  
  // Calculation history
  createCalculationHistory(data: InsertCalculationHistory): Promise<CalculationHistory>;
  updateCalculationHistory(id: string, data: Partial<InsertCalculationHistory>): Promise<void>;
  getLatestCalculationHistory(locationId?: string | null): Promise<CalculationHistory | undefined>;
  getCalculationHistoryByMonth(uploadMonth: string): Promise<CalculationHistory[]>;
  getRecentSftpPricingHistory(limit?: number, clientId?: string): Promise<CalculationHistory[]>;
  
  // Inquiry metrics
  bulkInsertInquiryMetrics(uploadMonth: string, data: InsertInquiryMetrics[], options?: { clientId?: string; serviceLineScope?: string[] }): Promise<void>;
  getInquiryMetricsByMonth(uploadMonth: string): Promise<InquiryMetrics[]>;
  getDemandDataByLocationServiceLine(location: string, serviceLine: string, currentMonth: string): Promise<{
    currentDemand: number;
    demandHistory: number[];
  }>;
  
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
  getCompetitors(clientId?: string): Promise<Competitor[]>;
  getCompetitorsByLocation(location: string): Promise<Competitor[]>;
  getCompetitorsByLocationAndServiceLine(location: string, serviceLine: string): Promise<Competitor[]>;
  getCompetitorsWithFilters(filters: {
    regions?: string[];
    divisions?: string[];
    locations?: string[];
    serviceLines?: string[];
    clientId?: string;
  }): Promise<{ competitors: CompetitorWithRates[]; usingDistanceFallback: boolean }>;
  createCompetitor(data: InsertCompetitor): Promise<Competitor>;
  updateCompetitor(id: string, data: InsertCompetitor): Promise<Competitor>;
  deleteCompetitor(id: string): Promise<void>;
  createOrUpdateCompetitor(data: InsertCompetitor): Promise<Competitor>;
  clearCompetitors(): Promise<void>;
  clearCompetitorsByLocation(location: string): Promise<void>;
  getTopCompetitorByWeight(location: string, serviceLine?: string): Promise<Competitor | undefined>;
  getTrilogyCareLevel2Rate(location: string, serviceLine: string, clientId?: string): Promise<number | null>;
  getTrilogyMedicationManagementFee(location: string, serviceLine: string): Promise<number>;
  getTopSurveyCompetitorForLocation(locationName: string, serviceLine: string, roomType: string | undefined, clientId: string): Promise<Array<{
    competitorName: string;
    roomType: string;
    monthlyRateAvg: number;
    careLevel2Rate: number | null;
    medicationManagementFee: number | null;
    weight: number;
    distanceMiles: number | null;
  }> | null>;
  
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
  
  // Revenue Growth Targets
  upsertRevenueGrowthTarget(data: InsertRevenueGrowthTarget): Promise<RevenueGrowthTarget>;
  bulkUpsertRevenueGrowthTargets(data: InsertRevenueGrowthTarget[]): Promise<number>;
  getRevenueGrowthTargets(locationId?: string): Promise<RevenueGrowthTarget[]>;

  // AI Insights persistence
  getAiInsight(clientId: string, location: string, serviceLine: string): Promise<import("@shared/schema").AiInsight | null>;
  upsertAiInsight(clientId: string, location: string, serviceLine: string, content: string): Promise<import("@shared/schema").AiInsight>;

  // Room Type Base Prices
  getRoomTypeBasePrices(): Promise<import("@shared/schema").RoomTypeBasePrice[]>;
  upsertRoomTypeBasePrice(roomType: string, serviceLine: string, basePrice: number): Promise<import("@shared/schema").RoomTypeBasePrice>;

  // Care Level 2 Rates
  getCareLevel2Rates(clientId: string): Promise<CareLevelRate[]>;
  upsertCareLevel2Rate(locationId: string, serviceLine: string, level2Rate: number, clientId: string): Promise<CareLevelRate>;
  backfillCareLevelRatesFromHistory(clientId: string): Promise<{ upserted: number; skipped: number }>;
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
    // Populate lat/lng from real geocoding if an address is present and
    // coordinates were not explicitly supplied by the caller.
    if (!data.lat && !data.lng) {
      const parts = [data.address, data.city, data.state].filter(Boolean);
      if (parts.length > 0) {
        try {
          const { geocodeAddress } = await import('./geocoding');
          const coords = await geocodeAddress(parts.join(', '));
          if (coords) {
            data = { ...data, lat: coords.lat, lng: coords.lng };
          }
        } catch (err) {
          console.error('[storage] Geocoding failed for new location:', err);
        }
      }
    }
    const [location] = await db.insert(locations).values(data).returning();
    return location;
  }

  async getLocations(clientId?: string): Promise<Location[]> {
    if (clientId) {
      return await db.select().from(locations).where(eq(locations.clientId, clientId)).orderBy(asc(locations.name));
    }
    return await db.select().from(locations).orderBy(asc(locations.name));
  }

  async getAllCampuses(clientId?: string): Promise<Location[]> {
    if (clientId) {
      return await db.select().from(locations).where(eq(locations.clientId, clientId)).orderBy(asc(locations.name));
    }
    return await db.select().from(locations).orderBy(asc(locations.name));
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
    // Populate lat/lng from real geocoding if address present and not already set by caller.
    if (!data.lat && !data.lng) {
      const parts = [data.address, data.city, data.state].filter(Boolean);
      if (parts.length > 0) {
        try {
          const { geocodeAddress } = await import('./geocoding');
          const coords = await geocodeAddress(parts.join(', '));
          if (coords) {
            data = { ...data, lat: coords.lat, lng: coords.lng };
          }
        } catch (err) {
          console.error('[storage] Geocoding failed for location upsert:', err);
        }
      }
    }
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
  async getRentRollData(clientId?: string): Promise<RentRollData[]> {
    if (clientId) {
      return await db.select().from(rentRollData).where(eq(rentRollData.clientId, clientId));
    }
    return await db.select().from(rentRollData);
  }

  async getTotalUnits(): Promise<number> {
    const result = await db.select({ count: sql<number>`COUNT(*)::int` }).from(rentRollData);
    return result[0]?.count ?? 0;
  }

  async getRentRollDataByMonth(uploadMonth: string, clientId?: string): Promise<RentRollData[]> {
    const conditions: any[] = [eq(rentRollData.uploadMonth, uploadMonth)];
    if (clientId) conditions.push(eq(rentRollData.clientId, clientId));
    return await db.select().from(rentRollData).where(and(...conditions));
  }

  async getRentRollDataFiltered(month: string, filters: {
    regions?: string[];
    divisions?: string[];
    locations?: string[];
    offset?: number;
    limit?: number;
    clientId?: string;
  }): Promise<RentRollData[]> {
    // Build optimized query with filters
    let query = db.select().from(rentRollData);
    const conditions: any[] = [eq(rentRollData.uploadMonth, month)];
    if (filters.clientId) conditions.push(eq(rentRollData.clientId, filters.clientId));
    
    // If regions/divisions are specified, we need to join with locations table
    if ((filters.regions && filters.regions.length > 0) || 
        (filters.divisions && filters.divisions.length > 0)) {
      // Get location IDs for the specified regions/divisions
      let locationQuery = db.select({ id: locations.id }).from(locations);
      const locationConditions: any[] = [];
      
      if (filters.regions && filters.regions.length > 0) {
        locationConditions.push(inArray(locations.region, filters.regions));
      }
      if (filters.divisions && filters.divisions.length > 0) {
        locationConditions.push(inArray(locations.division, filters.divisions));
      }
      
      if (locationConditions.length > 0) {
        const locationResults = await locationQuery.where(and(...locationConditions));
        const locationIds = locationResults.map(l => l.id);
        
        if (locationIds.length > 0) {
          conditions.push(inArray(rentRollData.locationId, locationIds));
        }
      }
    }
    
    // Filter by location names directly
    if (filters.locations && filters.locations.length > 0) {
      conditions.push(inArray(rentRollData.location, filters.locations));
    }
    
    // Apply all conditions
    query = query.where(and(...conditions));
    
    // Add pagination
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    if (filters.offset) {
      query = query.offset(filters.offset);
    }
    
    return await query;
  }

  async getRentRollDataByLocation(location: string, clientId?: string): Promise<RentRollData[]> {
    // First get the latest upload month for this location
    const monthConditions: any[] = [eq(rentRollData.location, location)];
    if (clientId) monthConditions.push(eq(rentRollData.clientId, clientId));
    const latestMonthResult = await db
      .select({ maxMonth: sql<string>`MAX(${rentRollData.uploadMonth})` })
      .from(rentRollData)
      .where(and(...monthConditions));
    
    const latestMonth = latestMonthResult[0]?.maxMonth;
    
    if (!latestMonth) {
      return [];
    }
    
    // Return only units from the latest month for this location
    const conditions: any[] = [
      eq(rentRollData.location, location),
      eq(rentRollData.uploadMonth, latestMonth)
    ];
    if (clientId) conditions.push(eq(rentRollData.clientId, clientId));
    return await db
      .select()
      .from(rentRollData)
      .where(and(...conditions));
  }

  async getRevenueByMonths(months: string[], clientId?: string, sameStoreOnly: boolean = true): Promise<Record<string, number>> {
    const clientFilter = clientId ? eq(rentRollData.clientId, clientId) : undefined;
    const monthFilter = inArray(rentRollData.uploadMonth, months);
    const sameStoreFilter = sameStoreOnly ? eq(rentRollData.sameStore, true) : undefined;
    const whereClause = and(monthFilter, clientFilter, sameStoreFilter);
    const result = await db
      .select({
        uploadMonth: rentRollData.uploadMonth,
        totalRevenue: sql<number>`SUM(
          CASE 
            WHEN ${rentRollData.occupiedYN} = true THEN 
              CASE 
                WHEN ${rentRollData.inHouseRate} > 0 THEN
                  CASE WHEN ${rentRollData.serviceLine} IN ('HC','HC/MC') 
                    THEN ${rentRollData.inHouseRate} * EXTRACT(days FROM (DATE_TRUNC('month', TO_DATE(${rentRollData.uploadMonth} || '-01', 'YYYY-MM-DD')) + INTERVAL '1 month' - INTERVAL '1 day'))
                    ELSE ${rentRollData.inHouseRate}
                  END
                ELSE
                  CASE WHEN ${rentRollData.serviceLine} IN ('HC','HC/MC')
                    THEN COALESCE(${rentRollData.streetRate}, 0) * EXTRACT(days FROM (DATE_TRUNC('month', TO_DATE(${rentRollData.uploadMonth} || '-01', 'YYYY-MM-DD')) + INTERVAL '1 month' - INTERVAL '1 day'))
                    ELSE COALESCE(${rentRollData.streetRate}, 0)
                  END
              END
            ELSE 0
          END
        )`.as('totalRevenue')
      })
      .from(rentRollData)
      .where(whereClause)
      .groupBy(rentRollData.uploadMonth);
    
    // Convert to Record<string, number>
    const revenueByMonth: Record<string, number> = {};
    result.forEach((row) => {
      if (row.uploadMonth) {
        revenueByMonth[row.uploadMonth] = row.totalRevenue || 0;
      }
    });
    
    return revenueByMonth;
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
    // Get IDs of rent_roll_data records we're about to delete
    const recordsToDelete = await db
      .select({ id: rentRollData.id })
      .from(rentRollData)
      .where(eq(rentRollData.uploadMonth, month));
    
    const idsToDelete = recordsToDelete.map(r => r.id);
    
    // Process in batches to avoid stack overflow with large datasets
    if (idsToDelete.length > 0) {
      const batchSize = 500; // Process 500 IDs at a time
      
      // First, delete any ai_rate_outcomes that reference these rent_roll_data records
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batchIds = idsToDelete.slice(i, i + batchSize);
        await db.delete(aiRateOutcomes).where(
          inArray(aiRateOutcomes.rentRollDataId, batchIds)
        );
      }
      
      // Second, delete any unit_polygons that reference these rent_roll_data records
      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batchIds = idsToDelete.slice(i, i + batchSize);
        await db.delete(unitPolygons).where(
          inArray(unitPolygons.rentRollDataId, batchIds)
        );
      }
    }
    
    // Now safe to delete the rent_roll_data records
    await db.delete(rentRollData).where(eq(rentRollData.uploadMonth, month));
    
    // Insert new data in batches to avoid stack overflow
    if (data.length > 0) {
      const dataWithMonth = data.map(item => ({ 
        ...item, 
        uploadMonth: month,
        roomNumber: item.roomNumber || item.unitId || 'N/A' // Ensure roomNumber is always set
      }));
      
      // Process insertions in batches of 500 records
      const insertBatchSize = 500;
      for (let i = 0; i < dataWithMonth.length; i += insertBatchSize) {
        const batch = dataWithMonth.slice(i, i + insertBatchSize);
        await db.insert(rentRollData).values(batch);
      }
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
    
    // Define senior housing service lines
    const seniorHousingServiceLines = ['AL', 'AL/MC', 'SL', 'VIL'];
    
    // Group by service line and calculate averages
    const serviceLineStats = units.reduce((acc: any, unit: any) => {
      const serviceLine = unit.serviceLine || 'AL'; // Default to AL if not specified
      
      // For senior housing, skip B-bed companion rows (room_number ending in /letter)
      if (seniorHousingServiceLines.includes(serviceLine)) {
        const roomNumber = unit.roomNumber || '';
        if (/\/[B-Zb-z]$/.test(roomNumber)) {
          return acc; // Skip this unit
        }
      }
      
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

  async bulkUpdateModuloRates(updates: Array<{ 
    id: string; 
    moduloSuggestedRate: number; 
    moduloCalculationDetails: string;
    ruleAdjustedRate?: number | null;
    appliedRuleName?: string | null;
  }>): Promise<void> {
    // Optimized bulk update using single SQL query with CASE statements
    // Process in batches of 500 for optimal performance
    const batchSize = 500;
    const totalBatches = Math.ceil(updates.length / batchSize);
    
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      if (batch.length === 0) continue;
      
      // Build a single UPDATE query with CASE statements for bulk update
      // This is much faster than individual updates
      const ids = batch.map(u => u.id);
      
      // Create CASE statements for each field
      const rateCases = batch.map(u => 
        sql`WHEN id = ${u.id} THEN ${u.moduloSuggestedRate}`
      );
      const detailsCases = batch.map(u => 
        sql`WHEN id = ${u.id} THEN ${u.moduloCalculationDetails}::text`
      );
      // Preserve existing rule data when a caller omits it.
      //
      // `undefined` means "this caller does not compute rule rates" -> keep whatever is
      // already stored. `null` is a meaningful value ("no rule matched this unit") and
      // must still clear the column. Previously undefined was coerced to null, so any
      // caller that skipped rule evaluation (e.g. the background pricing job) silently
      // wiped rule_adjusted_rate for every unit in its batch.
      const ruleRateCases = batch.map(u =>
        u.ruleAdjustedRate !== undefined
          ? sql`WHEN id = ${u.id} THEN ${u.ruleAdjustedRate}`
          : sql`WHEN id = ${u.id} THEN rule_adjusted_rate`
      );
      const ruleNameCases = batch.map(u =>
        u.appliedRuleName !== undefined
          ? sql`WHEN id = ${u.id} THEN ${u.appliedRuleName}`
          : sql`WHEN id = ${u.id} THEN applied_rule_name`
      );

      // Only stamp the rule-calculation timestamp when this batch actually carried rule data.
      const batchHasRuleData = batch.some(u => u.ruleAdjustedRate !== undefined);
      
      // Execute single bulk update query
      const now = new Date();
      await db.execute(sql`
        UPDATE ${rentRollData}
        SET 
          modulo_suggested_rate = CASE 
            ${sql.join(rateCases, sql.raw(' '))}
            ELSE modulo_suggested_rate
          END,
          modulo_calculation_details = CASE
            ${sql.join(detailsCases, sql.raw(' '))}
            ELSE modulo_calculation_details
          END,
          rule_adjusted_rate = CASE
            ${sql.join(ruleRateCases, sql.raw(' '))}
            ELSE rule_adjusted_rate
          END,
          applied_rule_name = CASE
            ${sql.join(ruleNameCases, sql.raw(' '))}
            ELSE applied_rule_name
          END,
          rule_rate_calculated_at = ${batchHasRuleData ? sql`${now}` : sql`rule_rate_calculated_at`}
        WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      `);
      
      console.log(`Updated Modulo batch ${batchNumber}/${totalBatches} (${batch.length} units) - ${Math.round((batchNumber/totalBatches) * 100)}% complete`);
    }
  }

  async bulkUpdateAIRates(updates: Array<{ id: string; aiSuggestedRate: number; aiCalculationDetails: string }>): Promise<void> {
    // Optimized bulk update using single SQL query with CASE statements
    // Process in batches of 500 for optimal performance
    const batchSize = 500;
    const totalBatches = Math.ceil(updates.length / batchSize);
    
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      if (batch.length === 0) continue;
      
      // Build a single UPDATE query with CASE statements for bulk update
      const ids = batch.map(u => u.id);
      
      // Create CASE statements for each field
      const rateCases = batch.map(u => 
        sql`WHEN id = ${u.id} THEN ${u.aiSuggestedRate}`
      );
      const detailsCases = batch.map(u => 
        sql`WHEN id = ${u.id} THEN ${u.aiCalculationDetails}::text`
      );
      
      // Execute single bulk update query
      await db.execute(sql`
        UPDATE ${rentRollData}
        SET 
          ai_suggested_rate = CASE 
            ${sql.join(rateCases, sql.raw(' '))}
            ELSE ai_suggested_rate
          END,
          ai_calculation_details = CASE
            ${sql.join(detailsCases, sql.raw(' '))}
            ELSE ai_calculation_details
          END
        WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      `);
      
      console.log(`Updated AI batch ${batchNumber}/${totalBatches} (${batch.length} units) - ${Math.round((batchNumber/totalBatches) * 100)}% complete`);
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
  
  // Calculation history implementation
  async createCalculationHistory(data: InsertCalculationHistory): Promise<CalculationHistory> {
    const [history] = await db.insert(calculationHistory).values(data).returning();
    return history;
  }
  
  async updateCalculationHistory(id: string, data: Partial<InsertCalculationHistory>): Promise<void> {
    await db.update(calculationHistory)
      .set(data)
      .where(eq(calculationHistory.id, id));
  }
  
  async getLatestCalculationHistory(locationId?: string | null): Promise<CalculationHistory | undefined> {
    const conditions = [];
    conditions.push(eq(calculationHistory.status, 'completed'));
    
    if (locationId) {
      conditions.push(eq(calculationHistory.locationId, locationId));
    } else {
      conditions.push(isNull(calculationHistory.locationId));
    }
    
    const [result] = await db
      .select()
      .from(calculationHistory)
      .where(and(...conditions))
      .orderBy(desc(calculationHistory.completedAt))
      .limit(1);
    
    return result;
  }
  
  async getCalculationHistoryByMonth(uploadMonth: string): Promise<CalculationHistory[]> {
    return await db
      .select()
      .from(calculationHistory)
      .where(eq(calculationHistory.uploadMonth, uploadMonth))
      .orderBy(desc(calculationHistory.startedAt));
  }

  async getRecentSftpPricingHistory(limit = 10, clientId?: string): Promise<CalculationHistory[]> {
    // Filter to entries whose metadata contains triggeredBy = 'sftp_import',
    // scoped to the requesting tenant via metadata.clientId when provided.
    const conditions: any[] = [
      sql`(${calculationHistory.metadata}->>'triggeredBy') = 'sftp_import'`,
    ];
    if (clientId) {
      conditions.push(sql`(${calculationHistory.metadata}->>'clientId') = ${clientId}`);
    }
    return await db
      .select()
      .from(calculationHistory)
      .where(and(...conditions))
      .orderBy(desc(calculationHistory.startedAt))
      .limit(limit);
  }

  // Inquiry metrics
  async bulkInsertInquiryMetrics(uploadMonth: string, data: InsertInquiryMetrics[], options?: { clientId?: string; serviceLineScope?: string[] }): Promise<void> {
    if (options?.clientId && options?.serviceLineScope && options.serviceLineScope.length > 0) {
      await db.delete(inquiryMetrics).where(
        and(
          eq(inquiryMetrics.clientId, options.clientId),
          inArray(inquiryMetrics.serviceLine, options.serviceLineScope)
        )
      );
    } else {
      await db.delete(inquiryMetrics).where(eq(inquiryMetrics.uploadMonth, uploadMonth));
    }
    if (data.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        await db.insert(inquiryMetrics).values(batch);
      }
    }
  }

  async getInquiryMetricsByMonth(uploadMonth: string): Promise<InquiryMetrics[]> {
    return await db.select().from(inquiryMetrics).where(eq(inquiryMetrics.uploadMonth, uploadMonth));
  }

  async getDemandDataByLocationServiceLine(location: string, serviceLine: string, currentMonth: string): Promise<{
    currentDemand: number;
    demandHistory: number[];
  }> {
    const allMetrics = await db
      .select()
      .from(inquiryMetrics)
      .where(
        and(
          eq(inquiryMetrics.location, location),
          serviceLine ? eq(inquiryMetrics.serviceLine, serviceLine) : undefined
        )
      )
      .orderBy(inquiryMetrics.uploadMonth);
    
    if (allMetrics.length === 0) {
      return {
        currentDemand: 0,
        demandHistory: []
      };
    }
    
    const monthlyDemand: Record<string, number> = {};
    for (const metric of allMetrics) {
      const month = metric.uploadMonth;
      if (!monthlyDemand[month]) {
        monthlyDemand[month] = 0;
      }
      monthlyDemand[month] += (metric.inquiryCount || 0) + (metric.tourCount || 0);
    }
    
    const sortedMonths = Object.keys(monthlyDemand).sort();
    const currentDemand = monthlyDemand[currentMonth] || 0;
    const demandHistory = sortedMonths
      .filter(m => m !== currentMonth)
      .map(m => monthlyDemand[m]);
    
    return {
      currentDemand,
      demandHistory
    };
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
    const [weights] = await db
      .select()
      .from(pricingWeights)
      .where(and(isNull(pricingWeights.locationId), isNull(pricingWeights.serviceLine)))
      .limit(1);
    return weights;
  }

  async updatePricingWeights(data: any): Promise<void> {
    await this.createOrUpdateWeightsByFilter(data, null, null);
  }

  async getCurrentWeights(): Promise<PricingWeights | undefined> {
    const [weights] = await db
      .select()
      .from(pricingWeights)
      .where(and(isNull(pricingWeights.locationId), isNull(pricingWeights.serviceLine)))
      .limit(1);
    return weights;
  }

  async createOrUpdateWeights(data: InsertPricingWeights): Promise<PricingWeights> {
    return this.createOrUpdateWeightsByFilter(data, null, null);
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
  async getCompetitors(clientId?: string): Promise<Competitor[]> {
    // Query competitive survey data instead of old competitors table
    const surveyData = clientId
      ? await db.select().from(competitiveSurveyData).where(eq(competitiveSurveyData.clientId, clientId))
      : await db.select().from(competitiveSurveyData);
    
    const CARE_ELIGIBLE_GC = new Set(['HC', 'HC/MC', 'SMC', 'AL', 'AL/MC']);

    // Group by competitor and location to aggregate room types
    const competitorMap = new Map<string, any>();
    
    for (const record of surveyData) {
      const key = `${record.keyStatsLocation}|${record.competitorName}`;
      
      if (!competitorMap.has(key)) {
        const initCareLevels: number[] = [];
        if (record.competitorType && CARE_ELIGIBLE_GC.has(record.competitorType)) {
          for (const v of [record.careLevel1Rate, record.careLevel2Rate, record.careLevel3Rate, record.careLevel4Rate]) {
            if (v != null && v > 0) initCareLevels.push(v);
          }
        }
        competitorMap.set(key, {
          id: record.id,
          name: record.competitorName,
          location: record.keyStatsLocation,
          locationId: null,
          lat: record.lat ?? null,
          lng: record.lng ?? null,
          address: record.competitorAddress,
          distanceMiles: record.distanceMiles,
          streetRate: record.monthlyRateAvg,
          avgCareRate: record.careFeesAvg,
          rating: null,
          weight: null,
          rank: null,
          roomType: record.roomType,
          serviceLines: record.competitorType ? [record.competitorType] : [],
          rates: null,
          attributes: null,
          careLevel2Rate: record.careLevel2Rate,
          medicationManagementFee: record.medicationManagementFee,
          createdAt: null,
          // Per-room-type rows, mirroring getCompetitorsWithFilters. The map popup's
          // per-service-line breakdown is built from these, so the unfiltered
          // (All Locations) path has to supply them too or the breakdown silently
          // comes back empty and the popup drops to the legacy summary. The
          // top-level careLevel2Rate above only reflects whichever record was seen
          // first, which is not necessarily the right service line.
          roomRates: [{
            roomType: record.roomType,
            streetRate: record.monthlyRateAvg,
            careRate: record.careFeesAvg,
            competitorType: record.competitorType,
            careLevel2Rate: record.careLevel2Rate,
          }],
          _careLevelValues: initCareLevels,
        });
      } else {
        // Update with better data if available
        const existing = competitorMap.get(key);
        if (!existing.streetRate && record.monthlyRateAvg) {
          existing.streetRate = record.monthlyRateAvg;
        }
        if (!existing.avgCareRate && record.careFeesAvg) {
          existing.avgCareRate = record.careFeesAvg;
        }
        // Collect unique service lines
        if (record.competitorType && !existing.serviceLines.includes(record.competitorType)) {
          existing.serviceLines.push(record.competitorType);
        }
        existing.roomRates.push({
          roomType: record.roomType,
          streetRate: record.monthlyRateAvg,
          careRate: record.careFeesAvg,
          competitorType: record.competitorType,
          careLevel2Rate: record.careLevel2Rate,
        });
        // Accumulate care level values
        if (record.competitorType && CARE_ELIGIBLE_GC.has(record.competitorType)) {
          for (const v of [record.careLevel1Rate, record.careLevel2Rate, record.careLevel3Rate, record.careLevel4Rate]) {
            if (v != null && v > 0) existing._careLevelValues.push(v);
          }
        }
      }
    }

    // Compute computedAvgCareRate for each competitor
    for (const comp of competitorMap.values()) {
      const vals: number[] = comp._careLevelValues || [];
      if (vals.length > 0) {
        comp.computedAvgCareRate = Math.round(vals.reduce((a: number, b: number) => a + b, 0) / vals.length);
      } else {
        comp.computedAvgCareRate = null;
      }
      delete comp._careLevelValues;
    }
    
    return Array.from(competitorMap.values());
  }

  async getCompetitorsByLocationAndServiceLine(location: string, serviceLine: string): Promise<Competitor[]> {
    // Query competitive survey data for specific location and service line
    const surveyData = await db.select()
      .from(competitiveSurveyData)
      .where(and(
        eq(competitiveSurveyData.keyStatsLocation, location),
        eq(competitiveSurveyData.competitorType, serviceLine)
      ));
    
    // Group and transform to Competitor format
    const competitorMap = new Map<string, any>();
    
    for (const record of surveyData) {
      const key = `${record.keyStatsLocation}|${record.competitorName}`;
      
      if (!competitorMap.has(key)) {
        competitorMap.set(key, {
          id: record.id,
          name: record.competitorName,
          location: record.keyStatsLocation,
          locationId: null,
          streetRate: record.monthlyRateAvg,
          avgCareRate: record.careFeesAvg,
          serviceLine: record.competitorType,
          careLevel2Rate: record.careLevel2Rate,
          medicationManagementFee: record.medicationManagementFee,
          weight: record.weight || null,
          distanceMiles: record.distanceMiles
        });
      }
    }
    
    return Array.from(competitorMap.values());
  }

  async getCompetitorsByLocation(location: string): Promise<Competitor[]> {
    // First try to find the location by name
    const [locationRecord] = await db.select()
      .from(locations)
      .where(eq(locations.name, location));
    
    if (locationRecord) {
      // Query by location_id
      return await db.select()
        .from(competitors)
        .where(eq(competitors.locationId, locationRecord.id));
    }
    
    // Fallback to old location field for backward compatibility
    return await db.select()
      .from(competitors)
      .where(eq(competitors.location, location));
  }

  async getCompetitorsWithFilters(filters: {
    regions?: string[];
    divisions?: string[];
    locations?: string[];
    serviceLines?: string[];
    clientId?: string;
  }): Promise<{ competitors: Competitor[]; usingDistanceFallback: boolean }> {
    // Build query for competitive survey data
    let query = db.select().from(competitiveSurveyData);
    const conditions: any[] = [];
    if (filters.clientId) conditions.push(eq(competitiveSurveyData.clientId, filters.clientId));
    
    // If locations are specified, filter by keystats location names
    if (filters.locations && filters.locations.length > 0) {
      conditions.push(inArray(competitiveSurveyData.keyStatsLocation, filters.locations));
    }
    
    // For regions/divisions, we need to get matching location names first
    if (filters.regions && filters.regions.length > 0) {
      const locationRecords = await db.select()
        .from(locations)
        .where(inArray(locations.region, filters.regions));
      
      const locationNames = locationRecords.map(loc => loc.name);
      
      if (locationNames.length > 0) {
        conditions.push(inArray(competitiveSurveyData.keyStatsLocation, locationNames));
      }
    }
    
    if (filters.divisions && filters.divisions.length > 0) {
      const locationRecords = await db.select()
        .from(locations)
        .where(inArray(locations.division, filters.divisions));
      
      const locationNames = locationRecords.map(loc => loc.name);
      
      if (locationNames.length > 0) {
        conditions.push(inArray(competitiveSurveyData.keyStatsLocation, locationNames));
      }
    }
    
    // Apply all conditions
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    // Get all survey data matching the filters
    const surveyData = await query;
    
    // Helper to parse weight from notes JSON
    const parseRecordWeight = (record: any): number => {
      try {
        const notes = typeof record.notes === 'string' ? JSON.parse(record.notes) : (record.notes || {});
        return parseFloat(String(notes?.weight ?? '0')) || 0;
      } catch {
        return 0;
      }
    };

    // Map service line filter values to competitor types stored in the DB.
    // HC/MC includes legacy 'SMC' records imported before the rename.
    const SERVICE_LINE_TO_COMPETITOR_TYPE: Record<string, string[]> = {
      'HC': ['HC'],
      'HC/MC': ['HC/MC', 'SMC'],
      'AL': ['AL'],
      'AL/MC': ['AL/MC'],
      'SL': ['IL_IL'],
      'VIL': ['IL_Villa']
    };

    // Apply service line filter and weight-based filtering BEFORE aggregation
    let workingData = surveyData;
    let usingDistanceFallback = false;

    if (filters.serviceLines && filters.serviceLines.length > 0) {
      const competitorTypes = filters.serviceLines
        .flatMap(sl => SERVICE_LINE_TO_COMPETITOR_TYPE[sl] || [sl])
        .filter(Boolean);

      // Filter to matching service line types (includes SMC for HC/MC)
      workingData = surveyData.filter(record =>
        record.competitorType && competitorTypes.includes(record.competitorType)
      );

      // Apply weight filter per location
      const byLocation = new Map<string, typeof workingData>();
      for (const record of workingData) {
        const loc = record.keyStatsLocation || 'unknown';
        if (!byLocation.has(loc)) byLocation.set(loc, []);
        byLocation.get(loc)!.push(record);
      }

      const finalData: typeof workingData = [];

      for (const [, records] of byLocation) {
        const weighted = records.filter(r => parseRecordWeight(r) > 0);

        if (weighted.length > 0) {
          finalData.push(...weighted);
        } else if (records.length > 0) {
          // Fall back to top-5 closest unique competitors
          usingDistanceFallback = true;
          const sorted = [...records].sort((a, b) => (a.distanceMiles || 999) - (b.distanceMiles || 999));
          const top5Names = new Set<string>();
          for (const r of sorted) {
            const name = r.competitorName || '';
            if (!top5Names.has(name)) {
              top5Names.add(name);
              if (top5Names.size >= 5) break;
            }
          }
          finalData.push(...records.filter(r => top5Names.has(r.competitorName || '')));
        }
      }

      workingData = finalData;
    }

    // Filter to only the most recent survey month per keyStatsLocation
    const latestMonthByLocation = new Map<string, string>();
    for (const record of workingData) {
      const loc = record.keyStatsLocation || '';
      const month = record.surveyMonth || '';
      const current = latestMonthByLocation.get(loc);
      if (!current || month > current) {
        latestMonthByLocation.set(loc, month);
      }
    }
    workingData = workingData.filter(record => {
      const loc = record.keyStatsLocation || '';
      const latest = latestMonthByLocation.get(loc);
      return !latest || !record.surveyMonth || record.surveyMonth === latest;
    });

    // Group by competitor and location to aggregate room types
    const competitorMap = new Map<string, any>();
    
    for (const record of workingData) {
      const key = `${record.keyStatsLocation}|${record.competitorName}`;
      const recordWeight = parseRecordWeight(record);
      
      if (!competitorMap.has(key)) {
        // Use Studio as the primary/fallback rate for backward compat
        const initWeightsByServiceLine: Record<string, number> = {};
        if (record.competitorType && recordWeight > 0) {
          initWeightsByServiceLine[record.competitorType] = recordWeight;
        }
        // Collect care level values for computing average (care-eligible types only)
        const CARE_ELIGIBLE_TYPES = new Set(['HC', 'HC/MC', 'SMC', 'AL', 'AL/MC']);
        const initCareLevelValues: number[] = [];
        if (record.competitorType && CARE_ELIGIBLE_TYPES.has(record.competitorType)) {
          for (const v of [record.careLevel1Rate, record.careLevel2Rate, record.careLevel3Rate, record.careLevel4Rate]) {
            if (v != null && v > 0) initCareLevelValues.push(v);
          }
        }
        competitorMap.set(key, {
          id: record.id,
          name: record.competitorName,
          location: record.keyStatsLocation,
          locationId: null,
          lat: record.lat ?? null,
          lng: record.lng ?? null,
          address: record.competitorAddress,
          distanceMiles: record.distanceMiles,
          streetRate: record.monthlyRateAvg,
          avgCareRate: record.careFeesAvg,
          rating: null,
          weight: recordWeight > 0 ? recordWeight : null,
          weightsByServiceLine: initWeightsByServiceLine,
          rank: null,
          roomType: record.roomType,
          serviceLines: record.competitorType ? [record.competitorType] : [],
          rates: null,
          attributes: null,
          careLevel2Rate: record.careLevel2Rate,
          medicationManagementFee: record.medicationManagementFee,
          createdAt: null,
          roomRates: record.roomType ? [{
            roomType: record.roomType,
            streetRate: record.monthlyRateAvg,
            careRate: record.careFeesAvg,
            competitorType: record.competitorType ?? null,
            // Kept per row so consumers can build a per-service-line care
            // adjustment; the top-level careLevel2Rate only reflects whichever
            // record happened to be seen first.
            careLevel2Rate: record.careLevel2Rate ?? null,
          }] : [],
          _careLevelValues: initCareLevelValues,
        });
      } else {
        const existing = competitorMap.get(key);
        // Update fallback single-rate fields only if not yet set
        if (!existing.streetRate && record.monthlyRateAvg) {
          existing.streetRate = record.monthlyRateAvg;
        }
        if (!existing.avgCareRate && record.careFeesAvg) {
          existing.avgCareRate = record.careFeesAvg;
        }
        if (recordWeight > 0 && !existing.weight) {
          existing.weight = recordWeight;
        }
        // Store per-service-line weight
        if (record.competitorType && recordWeight > 0 && !existing.weightsByServiceLine[record.competitorType]) {
          existing.weightsByServiceLine[record.competitorType] = recordWeight;
        }
        // Collect unique service lines
        if (record.competitorType && !existing.serviceLines.includes(record.competitorType)) {
          existing.serviceLines.push(record.competitorType);
        }
        // Accumulate care level values for care-eligible service lines
        const CARE_ELIGIBLE_TYPES_EL = new Set(['HC', 'HC/MC', 'SMC', 'AL', 'AL/MC']);
        if (record.competitorType && CARE_ELIGIBLE_TYPES_EL.has(record.competitorType)) {
          for (const v of [record.careLevel1Rate, record.careLevel2Rate, record.careLevel3Rate, record.careLevel4Rate]) {
            if (v != null && v > 0) existing._careLevelValues.push(v);
          }
        }
        // Accumulate per-room-type rates — one entry per distinct room type + service line
        if (record.roomType) {
          const alreadyHas = existing.roomRates.some(
            (r: any) => r.roomType === record.roomType && r.competitorType === (record.competitorType ?? null)
          );
          if (!alreadyHas) {
            existing.roomRates.push({
              roomType: record.roomType,
              streetRate: record.monthlyRateAvg,
              careRate: record.careFeesAvg,
              competitorType: record.competitorType ?? null,
              // Must mirror the init branch above. Omitting this left every room
              // row after the first without a care rate, so a competitor's second
              // and later room types silently lost their care adjustment.
              careLevel2Rate: record.careLevel2Rate ?? null,
            });
          }
        }
      }
    }
    
    // Post-process: derive top-level streetRate/roomType/avgCareRate from Studio row
    // if present, for deterministic backward-compat across consumers.
    // Also compute computedAvgCareRate from accumulated care level values.
    for (const comp of competitorMap.values()) {
      if (comp.roomRates && comp.roomRates.length > 0) {
        // Sort room types into canonical order before any consumer reads them
        comp.roomRates.sort((a: any, b: any) => compareRoomTypes(a.roomType ?? '', b.roomType ?? ''));
        const studioRow = comp.roomRates.find((r: any) => r.roomType === 'Studio');
        const preferred = studioRow ?? comp.roomRates[0];
        comp.streetRate = preferred.streetRate ?? comp.streetRate;
        comp.avgCareRate = preferred.careRate ?? comp.avgCareRate;
        comp.roomType = preferred.roomType ?? comp.roomType;
      }
      // Compute average of all care level values across care-eligible service lines
      const careLevelValues: number[] = comp._careLevelValues || [];
      if (careLevelValues.length > 0) {
        const sum = careLevelValues.reduce((a: number, b: number) => a + b, 0);
        comp.computedAvgCareRate = Math.round(sum / careLevelValues.length);
      } else {
        comp.computedAvgCareRate = null;
      }
      delete comp._careLevelValues;
    }

    const results = Array.from(competitorMap.values()) as CompetitorWithRates[];
    
    return { competitors: results, usingDistanceFallback };
  }

  async createCompetitor(data: InsertCompetitor): Promise<Competitor> {
    // Populate lat/lng from real geocoding if address present and not already set.
    if (!data.lat && !data.lng && data.address) {
      try {
        const { geocodeAddress } = await import('./geocoding');
        const coords = await geocodeAddress(data.address);
        if (coords) {
          data = { ...data, lat: coords.lat, lng: coords.lng };
        }
      } catch (err) {
        console.error('[storage] Geocoding failed for new competitor:', err);
      }
    }
    const [competitor] = await db.insert(competitors).values(data).returning();
    return competitor;
  }

  async updateCompetitor(id: string, data: InsertCompetitor): Promise<Competitor> {
    // Re-geocode if address is being updated and no coordinates explicitly supplied.
    if (!data.lat && !data.lng && data.address) {
      try {
        const { geocodeAddress } = await import('./geocoding');
        const coords = await geocodeAddress(data.address);
        if (coords) {
          data = { ...data, lat: coords.lat, lng: coords.lng };
        }
      } catch (err) {
        console.error('[storage] Geocoding failed for competitor update:', err);
      }
    }
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
    // First try to find the location by name
    const [locationRecord] = await db.select()
      .from(locations)
      .where(eq(locations.name, location));
    
    if (locationRecord) {
      // Delete by location_id
      await db.delete(competitors).where(eq(competitors.locationId, locationRecord.id));
    } else {
      // Fallback to old location field for backward compatibility
      await db.delete(competitors).where(eq(competitors.location, location));
    }
  }

  async getTopCompetitorByWeight(location: string, serviceLine?: string): Promise<Competitor | undefined> {
    // First try to find the location by name
    const [locationRecord] = await db.select()
      .from(locations)
      .where(eq(locations.name, location));
    
    const locationCompetitors = locationRecord
      ? await db.select()
          .from(competitors)
          .where(eq(competitors.locationId, locationRecord.id))
      : await db.select()
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
      'SL': ['Senior Living'],
      'VIL': ['Village', 'Independent Living']
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

  async getTrilogyCareLevel2Rate(location: string, serviceLine: string, clientId?: string): Promise<number | null> {
    // Return the posted Level 2 care rate for this location + service line.
    //
    // Priority order:
    //   Pass 0: care_level_rates config table (admin-entered posted rate — preferred)
    //   Pass 1: rentRollData (current state after sync)
    //   Pass 2: rentRollHistory (all historical uploads, most-recent first)

    // Pass 0 — care_level_rates config table (look up by locationId via locations join, scoped to tenant)
    const [configRow] = await db
      .select({ level2Rate: careLevelRates.level2Rate })
      .from(careLevelRates)
      .innerJoin(locations, eq(careLevelRates.locationId, locations.id))
      .where(
        clientId
          ? and(
              eq(locations.name, location),
              eq(careLevelRates.serviceLine, serviceLine),
              eq(careLevelRates.clientId, clientId),
              eq(locations.clientId, clientId)
            )
          : and(
              eq(locations.name, location),
              eq(careLevelRates.serviceLine, serviceLine)
            )
      )
      .limit(1);

    // If a config row exists, always use it (even if $0 — admin is explicitly saying the rate is 0)
    if (configRow !== undefined && configRow.level2Rate != null) {
      return configRow.level2Rate;
    }

    // Pass 1 — rentRollData (tenant-scoped when clientId provided)
    const [currentRow] = await db.select({ careRate: rentRollData.careRate })
      .from(rentRollData)
      .where(
        and(
          eq(rentRollData.location, location),
          eq(rentRollData.serviceLine, serviceLine),
          ...(clientId ? [eq(rentRollData.clientId, clientId)] : []),
          sql`(${rentRollData.careLevel} = '2' OR ${rentRollData.careLevel} ILIKE '%level 2%' OR ${rentRollData.careLevel} ILIKE '%L2%')`,
          sql`${rentRollData.careRate} > 0`
        )
      )
      .orderBy(sql`${rentRollData.uploadMonth} DESC NULLS LAST`)
      .limit(1);

    if (currentRow?.careRate != null && currentRow.careRate > 0) {
      return currentRow.careRate;
    }

    // Pass 2 — rentRollHistory (all historical uploads; rent_roll_history has no client_id column,
    // scoping is implicit via location name which is seeded per-tenant)
    const [historyRow] = await db.select({ careRate: rentRollHistory.careRate })
      .from(rentRollHistory)
      .where(
        and(
          eq(rentRollHistory.location, location),
          eq(rentRollHistory.serviceLine, serviceLine),
          sql`(${rentRollHistory.careLevel} = '2' OR ${rentRollHistory.careLevel} ILIKE '%level 2%' OR ${rentRollHistory.careLevel} ILIKE '%L2%')`,
          sql`${rentRollHistory.careRate} > 0`
        )
      )
      .orderBy(sql`${rentRollHistory.uploadMonth} DESC NULLS LAST`)
      .limit(1);

    if (historyRow?.careRate != null && historyRow.careRate > 0) {
      return historyRow.careRate;
    }

    return null;
  }

  async getTrilogyMedicationManagementFee(_location: string, _serviceLine: string): Promise<number> {
    // Trilogy includes medication management at no charge (fee = $0).
    // This method exists so callers can explicitly pass ourMedMgmt into the formula:
    //   adjustedRate = base + (theirCareL2 - ourCareL2) + (theirMedMgmt - ourMedMgmt)
    // If Trilogy ever begins charging, this method can query rent_roll_data.
    return 0;
  }

  /**
   * Look up the top-weighted competitor from competitive_survey_data for a given
   * location name and service line. Returns one row per room type for the top competitor,
   * so callers can do a room-type-specific rate lookup.
   *
   * Lookback: current month + up to 3 prior months (4 total).
   * Selection: highest-weight competitor (weight > 0 required). When all weights are ≤ 0,
   *   distance fallback prefers nearest competitor with a rate for the requested roomType
   *   (if provided), then nearest with a core rate, then nearest with any usable rate.
   * Sentinel: when the selected competitor has no usable room-type rates, returns a single
   *   row with monthlyRateAvg=0 so callers can name the competitor in explanations.
   */
  async getTopSurveyCompetitorForLocation(
    locationName: string,
    serviceLine: string,
    roomType: string | undefined,
    clientId: string
  ): Promise<Array<{
    competitorName: string;
    roomType: string;
    monthlyRateAvg: number;
    careLevel2Rate: number | null;
    medicationManagementFee: number | null;
    weight: number;
    distanceMiles: number | null;
  }> | null> {
    // Map service line to the competitorType stored in the DB
    const SERVICE_LINE_TO_COMPETITOR_TYPE: Record<string, string> = {
      'HC': 'HC',
      'HC/MC': 'HC/MC',
      'AL': 'AL',
      'AL/MC': 'AL/MC',
      'SL': 'IL_IL',
      'VIL': 'IL_Villa',
    };
    const mappedType = SERVICE_LINE_TO_COMPETITOR_TYPE[serviceLine];
    if (!mappedType) return null; // Unrecognized service line — no survey data

    // Fetch the portfolio location's coordinates once so we can compute distance
    // on-the-fly for any survey rows whose distanceMiles column is still null.
    const [locationRow] = await db
      .select({ lat: locations.lat, lng: locations.lng })
      .from(locations)
      .where(eq(locations.name, locationName))
      .limit(1);
    const locationLatLng = (locationRow?.lat != null && locationRow?.lng != null)
      ? { lat: locationRow.lat, lng: locationRow.lng }
      : null;

    const clientIdConditions = [eq(competitiveSurveyData.clientId, clientId)];

    // For HC/MC: query HC/MC rows first; fall back to legacy SMC rows only when none exist,
    // so locations with older-format imports still resolve until Task #88 renames them.
    let rows: (typeof competitiveSurveyData.$inferSelect)[] = [];
    if (mappedType === 'HC/MC') {
      rows = await db.select()
        .from(competitiveSurveyData)
        .where(and(
          eq(competitiveSurveyData.keyStatsLocation, locationName),
          eq(competitiveSurveyData.competitorType, 'HC/MC'),
          ...clientIdConditions
        ))
        .orderBy(sql`survey_month DESC`);
      if (rows.length === 0) {
        rows = await db.select()
          .from(competitiveSurveyData)
          .where(and(
            eq(competitiveSurveyData.keyStatsLocation, locationName),
            eq(competitiveSurveyData.competitorType, 'SMC'),
            ...clientIdConditions
          ))
          .orderBy(sql`survey_month DESC`);
      }
    } else {
      rows = await db.select()
        .from(competitiveSurveyData)
        .where(and(
          eq(competitiveSurveyData.keyStatsLocation, locationName),
          eq(competitiveSurveyData.competitorType, mappedType),
          ...clientIdConditions
        ))
        .orderBy(sql`survey_month DESC`);
    }

    if (!rows.length) return null;

    // Restrict to the single most recent survey month across all rows for this
    // client/location/type. No multi-month lookback — stale prior-month values
    // must not bleed into competitor selection or rate extraction.
    const latestSurveyMonth = [...new Set(rows.map(r => r.surveyMonth).filter(Boolean) as string[])]
      .sort().reverse()[0];
    if (latestSurveyMonth) {
      rows = rows.filter(r => r.surveyMonth === latestSurveyMonth);
    }
    // If no rows carry a surveyMonth (legacy data with null months), rows is unchanged — all
    // legacy rows are treated as a single implicit month so behaviour is preserved.

    // Parse weights from notes JSON; first occurrence per competitor name wins.
    // If distanceMiles is null but lat/lng are present, compute it on-the-fly
    // so the distance-based fallback always has something to work with.
    const competitorMeta = new Map<string, { weight: number; distanceMiles: number | null }>();
    for (const row of rows) {
      if (!competitorMeta.has(row.competitorName)) {
        let weight = 0;
        try {
          const notes = JSON.parse(row.notes || '{}');
          weight = parseFloat(notes.weight) || 0;
        } catch { /* ignore parse errors */ }

        let distMiles: number | null = row.distanceMiles;
        if (distMiles == null && locationLatLng && row.lat != null && row.lng != null) {
          distMiles = calculateDistance(locationLatLng.lat, locationLatLng.lng, row.lat, row.lng);
        }

        competitorMeta.set(row.competitorName, { weight, distanceMiles: distMiles });
      }
    }

    // Select a single top competitor:
    //   • Primary: highest weight among competitors with weight > 0 (room-type agnostic)
    //   • Fallback (all weights ≤ 0, room-type-aware when roomType provided):
    //       1. Nearest with a non-zero rate for the exact requested roomType
    //       2. Nearest with a core rate (Studio / Studio Dlx / Companion)
    //       3. Nearest with any usable rate
    // Only that one competitor's rows are returned; the caller applies the room-type
    // fallback chain within those rows.
    const nameHasRateForRoomType = (name: string, rt: string) =>
      rows.some(r => r.competitorName === name && r.roomType === rt && r.monthlyRateAvg && r.monthlyRateAvg > 0);
    const nameHasUsableRate = (name: string) =>
      rows.some(r => r.competitorName === name && r.monthlyRateAvg && r.monthlyRateAvg > 0);
    const coreRoomTypes = new Set(['Studio', 'Studio Dlx', 'Companion']);
    const nameHasCoreRate = (name: string) =>
      rows.some(r => r.competitorName === name && coreRoomTypes.has(r.roomType) && r.monthlyRateAvg && r.monthlyRateAvg > 0);

    // Weight pass — pick highest-weight competitor (weight must be > 0)
    // Ties are broken by distance: the nearest competitor wins.
    let topName: string | null = null;
    let maxWeight = 0;
    let bestDist = Infinity;
    for (const [name, { weight, distanceMiles }] of competitorMeta) {
      const d = distanceMiles ?? Infinity;
      if (weight > maxWeight || (weight === maxWeight && weight > 0 && d < bestDist)) {
        maxWeight = weight;
        bestDist = d;
        topName = name;
      }
    }

    // Distance fallback — only runs when no competitor has weight > 0
    if (!topName) {
      let minDist = Infinity;
      // First pass: nearest with a non-zero rate for the exact requested room type (if known)
      if (roomType) {
        for (const [name, { distanceMiles }] of competitorMeta) {
          if (!nameHasRateForRoomType(name, roomType)) continue;
          const d = distanceMiles ?? Infinity;
          if (d < minDist) { minDist = d; topName = name; }
        }
      }
      // Second pass: nearest with a core room-type rate
      if (!topName) {
        for (const [name, { distanceMiles }] of competitorMeta) {
          if (!nameHasCoreRate(name)) continue;
          const d = distanceMiles ?? Infinity;
          if (d < minDist) { minDist = d; topName = name; }
        }
      }
      // Third pass: any usable rate
      if (!topName) {
        for (const [name, { distanceMiles }] of competitorMeta) {
          if (!nameHasUsableRate(name)) continue;
          const d = distanceMiles ?? Infinity;
          if (d < minDist) { minDist = d; topName = name; }
        }
      }
    }

    if (!topName) return null;

    const topWeight = competitorMeta.get(topName)?.weight ?? 0;
    const topDist = competitorMeta.get(topName)?.distanceMiles ?? null;

    // rows is already restricted to the single most recent survey month (see above).
    // Simply filter to the selected competitor's rows from that month.
    const recentRows = rows.filter(r => r.competitorName === topName);

    // Competitor-level care/med data (shared across room types)
    let sharedCareLevel2Rate: number | null = null;
    let sharedMedMgmtFee: number | null = null;
    for (const row of recentRows) {
      if (!sharedCareLevel2Rate && row.careLevel2Rate && row.careLevel2Rate > 0) sharedCareLevel2Rate = row.careLevel2Rate;
      if (!sharedMedMgmtFee && row.medicationManagementFee && row.medicationManagementFee > 0) sharedMedMgmtFee = row.medicationManagementFee;
    }

    // Build one entry per room type (most-recent valid rate wins)
    const roomTypeRates = new Map<string, number>();
    for (const row of recentRows) {
      if (row.roomType && row.monthlyRateAvg && row.monthlyRateAvg > 0 && !roomTypeRates.has(row.roomType)) {
        roomTypeRates.set(row.roomType, row.monthlyRateAvg);
      }
    }

    // When the selected competitor has no usable rates, return a sentinel row (monthlyRateAvg: 0)
    // so the caller can still name this competitor in the explanation.
    if (roomTypeRates.size === 0) {
      return [{
        competitorName: topName,
        roomType: '',
        monthlyRateAvg: 0,
        careLevel2Rate: null,
        medicationManagementFee: null,
        weight: topWeight,
        distanceMiles: topDist,
      }];
    }

    return Array.from(roomTypeRates.entries()).map(([rt, monthlyRateAvg]) => ({
      competitorName: topName!,
      roomType: rt,
      monthlyRateAvg,
      careLevel2Rate: sharedCareLevel2Rate,
      medicationManagementFee: sharedMedMgmtFee,
      weight: topWeight,
      distanceMiles: topDist,
    }));
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

  async createOrUpdateAdjustmentRangesByFilter(data: any, locationId?: string | null, serviceLine?: string | null): Promise<AdjustmentRanges> {
    const rangeData = {
      ...data,
      locationId: locationId || null,
      serviceLine: serviceLine || null,
    };
    
    // Delete existing entry for this location/serviceLine combination
    if (locationId && serviceLine) {
      await db.delete(adjustmentRanges).where(and(eq(adjustmentRanges.locationId, locationId), eq(adjustmentRanges.serviceLine, serviceLine)));
    } else if (locationId) {
      await db.delete(adjustmentRanges).where(and(eq(adjustmentRanges.locationId, locationId), isNull(adjustmentRanges.serviceLine)));
    } else if (serviceLine) {
      await db.delete(adjustmentRanges).where(and(isNull(adjustmentRanges.locationId), eq(adjustmentRanges.serviceLine, serviceLine)));
    } else {
      await db.delete(adjustmentRanges).where(and(isNull(adjustmentRanges.locationId), isNull(adjustmentRanges.serviceLine)));
    }
    
    const [ranges] = await db.insert(adjustmentRanges).values(rangeData).returning();
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

  async createOrUpdateGuardrailsByFilter(data: any, locationId?: string | null, serviceLine?: string | null): Promise<Guardrails> {
    const guardrailData = {
      ...data,
      locationId: locationId || null,
      serviceLine: serviceLine || null,
    };
    
    // Delete existing entry for this location/serviceLine combination
    if (locationId && serviceLine) {
      await db.delete(guardrails).where(and(eq(guardrails.locationId, locationId), eq(guardrails.serviceLine, serviceLine)));
    } else if (locationId) {
      await db.delete(guardrails).where(and(eq(guardrails.locationId, locationId), isNull(guardrails.serviceLine)));
    } else if (serviceLine) {
      await db.delete(guardrails).where(and(isNull(guardrails.locationId), eq(guardrails.serviceLine, serviceLine)));
    } else {
      await db.delete(guardrails).where(and(isNull(guardrails.locationId), isNull(guardrails.serviceLine)));
    }
    
    const [guardrail] = await db.insert(guardrails).values(guardrailData).returning();
    return guardrail;
  }

  async generateAIPricingSuggestions(units: any[], weights: PricingWeights, guardrails: Guardrails): Promise<any[]> {
    await ensureCacheInitialized();
    
    const updatedUnits = [];
    
    // Filter units for occupancy calculation - exclude B beds for senior housing
    const seniorHousingServiceLines = ['AL', 'AL/MC', 'SL', 'VIL'];
    const unitsForOccupancy = units.filter(unit => {
      if (seniorHousingServiceLines.includes(unit.serviceLine || '')) {
        const roomNumber = unit.roomNumber || '';
        if (/\/[B-Zb-z]$/.test(roomNumber)) {
          return false; // Exclude B-bed companion rows from occupancy calculation
        }
      }
      return true;
    });
    
    // Calculate occupancy rate as a ratio (using filtered units for senior housing)
    const occupiedCount = unitsForOccupancy.filter(u => u.occupiedYN).length;
    const actualOccupancyRate = unitsForOccupancy.length > 0 ? occupiedCount / unitsForOccupancy.length : 0.85;
    
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
        // For modulo type, use ruleAdjustedRate if available, otherwise use moduloSuggestedRate
        const newRate = suggestionType === 'modulo' 
          ? (unit.ruleAdjustedRate || unit.moduloSuggestedRate) 
          : unit.aiSuggestedRate;
        
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
    // Active = toggled on AND already past its effective date (NULL = effective immediately).
    // Historical records (is_historical=true) document past pricing changes and are never applied.
    return await db.select().from(adjustmentRules).where(
      and(
        eq(adjustmentRules.isActive, true),
        sql`${adjustmentRules.isHistorical} IS NOT TRUE`,
        sql`(${adjustmentRules.effectiveDate} IS NULL OR ${adjustmentRules.effectiveDate} <= CURRENT_DATE)`
      )
    );
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

  async upsertRevenueGrowthTarget(data: InsertRevenueGrowthTarget): Promise<RevenueGrowthTarget> {
    const [result] = await db.insert(revenueGrowthTargets)
      .values({
        ...data,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [revenueGrowthTargets.locationId, revenueGrowthTargets.serviceLine],
        set: {
          targetGrowthPercent: data.targetGrowthPercent,
          updatedAt: new Date()
        }
      })
      .returning();
    return result;
  }

  async bulkUpsertRevenueGrowthTargets(data: InsertRevenueGrowthTarget[]): Promise<number> {
    if (data.length === 0) return 0;
    
    const now = new Date();
    const valuesWithTimestamp = data.map(d => ({
      ...d,
      updatedAt: now
    }));
    
    // Process in batches of 500 for better performance
    const batchSize = 500;
    let totalInserted = 0;
    
    for (let i = 0; i < valuesWithTimestamp.length; i += batchSize) {
      const batch = valuesWithTimestamp.slice(i, i + batchSize);
      await db.insert(revenueGrowthTargets)
        .values(batch)
        .onConflictDoUpdate({
          target: [revenueGrowthTargets.locationId, revenueGrowthTargets.serviceLine],
          set: {
            targetGrowthPercent: sql`excluded.target_growth_percent`,
            updatedAt: now
          }
        });
      totalInserted += batch.length;
    }
    
    return totalInserted;
  }

  async getRevenueGrowthTargets(locationId?: string): Promise<RevenueGrowthTarget[]> {
    if (locationId) {
      return db.select().from(revenueGrowthTargets).where(eq(revenueGrowthTargets.locationId, locationId));
    }
    return db.select().from(revenueGrowthTargets);
  }

  async getAiInsight(clientId: string, location: string, serviceLine: string): Promise<import("@shared/schema").AiInsight | null> {
    const { aiInsights } = await import("@shared/schema");
    const [row] = await db.select().from(aiInsights).where(
      and(
        eq(aiInsights.clientId, clientId),
        eq(aiInsights.location, location),
        eq(aiInsights.serviceLine, serviceLine),
      )
    ).limit(1);
    return row ?? null;
  }

  async upsertAiInsight(clientId: string, location: string, serviceLine: string, content: string): Promise<import("@shared/schema").AiInsight> {
    const { aiInsights } = await import("@shared/schema");
    const now = new Date();
    const [row] = await db
      .insert(aiInsights)
      .values({ clientId, location, serviceLine, content, generatedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [aiInsights.clientId, aiInsights.location, aiInsights.serviceLine],
        set: { content, updatedAt: now },
      })
      .returning();
    return row;
  }

  async getRoomTypeBasePrices(): Promise<import("@shared/schema").RoomTypeBasePrice[]> {
    return db.select().from(roomTypeBasePrices);
  }

  async upsertRoomTypeBasePrice(roomType: string, serviceLine: string, basePrice: number): Promise<import("@shared/schema").RoomTypeBasePrice> {
    const [result] = await db
      .insert(roomTypeBasePrices)
      .values({ roomType, serviceLine, basePrice, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [roomTypeBasePrices.roomType, roomTypeBasePrices.serviceLine],
        set: { basePrice, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async getCareLevel2Rates(clientId: string): Promise<CareLevelRate[]> {
    return db.select().from(careLevelRates).where(eq(careLevelRates.clientId, clientId));
  }

  async upsertCareLevel2Rate(locationId: string, serviceLine: string, level2Rate: number, clientId: string): Promise<CareLevelRate> {
    const [result] = await db
      .insert(careLevelRates)
      .values({ locationId, serviceLine, level2Rate, clientId })
      .onConflictDoUpdate({
        target: [careLevelRates.clientId, careLevelRates.locationId, careLevelRates.serviceLine],
        set: { level2Rate },
      })
      .returning();
    return result;
  }

  /**
   * Backfill care_level_rates from rent_roll_history for a given client.
   *
   * Scans all history rows where careLevel matches a Level 2 pattern and careRate > 0.
   * Groups by (location, serviceLine), takes the highest careRate from the most recent
   * uploadMonth. Inserts only when no existing entry exists for that location + service
   * line combination (DO NOTHING on conflict to preserve admin-entered values).
   *
   * Returns { upserted, skipped } summary.
   */
  async backfillCareLevelRatesFromHistory(clientId: string): Promise<{ upserted: number; skipped: number }> {
    // Get all locations for this client so we can resolve locationId from location name.
    // rent_roll_history has no client_id column; tenant scoping is done via the locations join below.
    // Also include global (client_id IS NULL) locations as a fallback, matching the convention used
    // in /api/upload/rent-roll.
    const clientLocations = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(or(eq(locations.clientId, clientId), isNull(locations.clientId)));
    // Build map using trimmed lowercase name; client-scoped entries take precedence over global ones
    // if both share the same name (insert client-scoped last so they win).
    const locationMap = new Map<string, string>();
    for (const loc of clientLocations) {
      locationMap.set(loc.name.toLowerCase().trim(), loc.id);
    }

    // For each (location, serviceLine), choose the MOST RECENT uploadMonth that has any
    // Level 2 rows, then take the max care_rate within that month.
    //
    // We UNION two sources:
    //   1. rent_roll_history — written by importMatrixCareRentRollCSV (/api/import/rent-roll)
    //      Tenant safety via INNER JOIN with locations filtered by clientId (history has no client_id).
    //   2. rent_roll_data — written by /api/upload/rent-roll (legacy/generic upload path)
    //      Directly client_id-scoped; no join needed.
    //
    // ROW_NUMBER() picks the latest uploadMonth per (location, serviceLine) combination;
    // WHERE rn = 1 keeps only the most-recent month's aggregate.
    const historyRows = await db.execute(sql`
      WITH combined AS (
        -- Source 1: rent_roll_history (scoped via locations join)
        SELECT
          rrh.location,
          rrh.service_line,
          rrh.upload_month,
          rrh.care_rate
        FROM rent_roll_history rrh
        INNER JOIN locations loc
          ON LOWER(loc.name) = LOWER(rrh.location)
          AND loc.client_id = ${clientId}
        WHERE (
          rrh.care_level = '2'
          OR rrh.care_level ILIKE '%level 2%'
          OR rrh.care_level ILIKE '%lvl 2%'
        )
        AND rrh.care_rate > 0

        UNION ALL

        -- Source 2: rent_roll_data (directly client_id-scoped)
        SELECT
          rrd.location,
          rrd.service_line,
          rrd.upload_month,
          rrd.care_rate
        FROM rent_roll_data rrd
        WHERE rrd.client_id = ${clientId}
          AND (
            rrd.care_level = '2'
            OR rrd.care_level ILIKE '%level 2%'
            OR rrd.care_level ILIKE '%lvl 2%'
          )
          AND rrd.care_rate > 0
      ),
      ranked_months AS (
        SELECT
          location,
          service_line,
          upload_month,
          MAX(care_rate) AS max_care_rate,
          ROW_NUMBER() OVER (
            PARTITION BY location, service_line
            ORDER BY upload_month DESC
          ) AS rn
        FROM combined
        GROUP BY location, service_line, upload_month
      )
      SELECT location, service_line, max_care_rate
      FROM ranked_months
      WHERE rn = 1
    `);

    const rows = historyRows.rows as { location: string; service_line: string; max_care_rate: number }[];

    // Get existing care_level_rates entries for this client to avoid overwriting them
    const existingEntries = await db
      .select({ locationId: careLevelRates.locationId, serviceLine: careLevelRates.serviceLine })
      .from(careLevelRates)
      .where(eq(careLevelRates.clientId, clientId));
    const existingSet = new Set(existingEntries.map(e => `${e.locationId}|${e.serviceLine}`));

    let upserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const locationId = locationMap.get((row.location || '').toLowerCase().trim());
      if (!locationId) {
        skipped++;
        continue;
      }
      const key = `${locationId}|${row.service_line}`;
      if (existingSet.has(key)) {
        // Admin entry already exists — preserve it
        skipped++;
        continue;
      }
      const rate = Number(row.max_care_rate);
      if (!rate || rate <= 0) {
        skipped++;
        continue;
      }
      const inserted = await db
        .insert(careLevelRates)
        .values({ locationId, serviceLine: row.service_line, level2Rate: rate, clientId })
        .onConflictDoNothing()
        .returning({ id: careLevelRates.locationId });
      // Only count rows that were actually written (not silently skipped by conflict guard)
      if (inserted.length > 0) {
        upserted++;
      } else {
        skipped++;
      }
    }

    return { upserted, skipped };
  }
}

export const storage = new DatabaseStorage();