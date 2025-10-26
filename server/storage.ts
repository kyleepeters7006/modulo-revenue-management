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
  type InsertPricingHistory
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import OpenAI from "openai";

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
  
  // Competitors
  getCompetitors(): Promise<Competitor[]>;
  getCompetitorsByLocation(location: string): Promise<Competitor[]>;
  createCompetitor(data: InsertCompetitor): Promise<Competitor>;
  updateCompetitor(id: string, data: InsertCompetitor): Promise<Competitor>;
  deleteCompetitor(id: string): Promise<void>;
  createOrUpdateCompetitor(data: InsertCompetitor): Promise<Competitor>;
  clearCompetitors(): Promise<void>;
  clearCompetitorsByLocation(location: string): Promise<void>;
  
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
  generateAIPricingSuggestions(units: any[]): Promise<any[]>;
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
    const updatedUnits = [];
    
    // Get adjustment ranges, using same defaults as real-time calculation
    const ranges = await this.getAdjustmentRanges();
    const occupancyMin = ranges?.occupancyMin ?? -0.10;
    const occupancyMax = ranges?.occupancyMax ?? 0.05;
    const vacancyMin = ranges?.vacancyMin ?? -0.15;
    const vacancyMax = ranges?.vacancyMax ?? 0.00;
    const attributesMin = ranges?.attributesMin ?? -0.05;
    const attributesMax = ranges?.attributesMax ?? 0.10;
    const seasonalityMin = ranges?.seasonalityMin ?? -0.05;
    const seasonalityMax = ranges?.seasonalityMax ?? 0.10;
    const competitorMin = ranges?.competitorMin ?? -0.10;
    const competitorMax = ranges?.competitorMax ?? 0.10;
    const marketMin = ranges?.marketMin ?? -0.05;
    const marketMax = ranges?.marketMax ?? 0.05;
    
    // Calculate actual occupancy rate
    const actualOccupancyRate = units.filter(u => u.occupiedYN).length / units.length;
    
    for (const unit of units) {
      const streetRate = unit.streetRate;
      
      // Use the same conditional logic as the real-time calculation endpoint
      
      // 1. Occupancy Pressure - only adjust if occupancy is outside target range (85-95%)
      let occupancyAdjustment = 0;
      if (weights.occupancyPressure > 0) {
        if (actualOccupancyRate < 0.85) {
          // Low occupancy - apply downward pressure
          const severity = Math.min((0.85 - actualOccupancyRate) / 0.15, 1);
          occupancyAdjustment = occupancyMin * severity * (weights.occupancyPressure / 100);
        } else if (actualOccupancyRate > 0.95) {
          // High occupancy - apply upward pressure
          const severity = Math.min((actualOccupancyRate - 0.95) / 0.05, 1);
          occupancyAdjustment = occupancyMax * severity * (weights.occupancyPressure / 100);
        }
      }
      
      // 2. Days Vacant - only apply to vacant units with days vacant > 30
      let vacancyAdjustment = 0;
      if (weights.daysVacantDecay > 0 && !unit.occupiedYN && unit.daysVacant > 30) {
        const severity = Math.min(unit.daysVacant / 90, 1);
        vacancyAdjustment = vacancyMin * severity * (weights.daysVacantDecay / 100);
      }
      
      // 3. Room Attributes - only apply if unit has premium attributes
      let attributeAdjustment = 0;
      if (weights.roomAttributes > 0) {
        let attributeScore = 0;
        if (unit.view) attributeScore += 0.3;
        if (unit.renovated) attributeScore += 0.4;
        if (unit.otherPremiumFeature) attributeScore += 0.3;
        
        if (attributeScore > 0) {
          const direction = attributeScore > 0.5 ? 1 : -0.5;
          const range = direction > 0 ? attributesMax : attributesMin;
          attributeAdjustment = range * attributeScore * (weights.roomAttributes / 100);
        }
      }
      
      // 4. Competitor Rates - only apply if competitor rate exists and differs significantly
      let competitorAdjustment = 0;
      if (weights.competitorRates > 0 && unit.competitorRate) {
        const competitorRate = unit.competitorRate;
        const priceDifference = (streetRate - competitorRate) / competitorRate;
        
        if (Math.abs(priceDifference) > 0.05) {
          const severity = Math.min(Math.abs(priceDifference) / 0.20, 1);
          const direction = priceDifference > 0 ? -1 : 1;
          const range = direction > 0 ? competitorMax : competitorMin;
          competitorAdjustment = range * severity * (weights.competitorRates / 100);
        }
      }
      
      // 5. Seasonality - apply based on current month
      let seasonalAdjustment = 0;
      if (weights.seasonality > 0) {
        const currentMonth = new Date().getMonth();
        const isPeakSeason = (currentMonth >= 2 && currentMonth <= 4) || (currentMonth >= 8 && currentMonth <= 10);
        
        if (isPeakSeason) {
          seasonalAdjustment = seasonalityMax * 0.8 * (weights.seasonality / 100);
        } else {
          seasonalAdjustment = seasonalityMin * 0.5 * (weights.seasonality / 100);
        }
      }
      
      // 6. Market Conditions
      let marketAdjustment = 0;
      if (weights.stockMarket > 0) {
        marketAdjustment = marketMax * 0.3 * (weights.stockMarket / 100);
      }
      
      // Calculate total adjustment
      const totalAdjustment = occupancyAdjustment + vacancyAdjustment + attributeAdjustment + 
                             seasonalAdjustment + competitorAdjustment + marketAdjustment;
      
      // Apply the adjustment to get the recommended rate
      const suggestedRate = Math.round(streetRate * (1 + totalAdjustment));

      // Update unit
      await db.update(rentRollData)
        .set({ moduloSuggestedRate: suggestedRate })
        .where(eq(rentRollData.id, unit.id));

      updatedUnits.push({...unit, moduloSuggestedRate: suggestedRate});
    }

    return updatedUnits;
  }

  async generateAIPricingSuggestions(units: any[]): Promise<any[]> {
    if (!openai) {
      throw new Error('OpenAI API key not configured');
    }

    const updatedUnits = [];

    // Process in batches of 5 units
    for (let i = 0; i < units.length; i += 5) {
      const batch = units.slice(i, i + 5);
      
      const prompt = `As a senior living pricing expert, analyze these units and suggest optimal monthly rent rates. Consider:
- Current market rates and occupancy
- Unit attributes (size, view, renovation status, amenities)
- Competitor pricing
- Market conditions

Units to analyze:
${batch.map(unit => `
Unit ${unit.roomNumber} (${unit.roomType}):
- Current rate: $${unit.streetRate}
- Occupied: ${unit.occupiedYN ? 'Yes' : 'No'}
- Days vacant: ${unit.daysVacant}
- Size: ${unit.size}
- View: ${unit.view || 'Standard'}
- Renovated: ${unit.renovated ? 'Yes' : 'No'}
- Premium features: ${unit.otherPremiumFeature || 'None'}
- Competitor rate: $${unit.competitorRate || 'N/A'}
`).join('')}

Respond with JSON format: {"suggestions": [{"roomNumber": "101", "suggestedRate": 3250, "reasoning": "brief explanation"}, ...]}`;

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.3
        });

        const result = JSON.parse(response.choices[0].message.content || '{"suggestions": []}');
        
        // Update database with AI suggestions
        for (const suggestion of result.suggestions) {
          const unit = batch.find(u => u.roomNumber === suggestion.roomNumber);
          if (unit) {
            await db.update(rentRollData)
              .set({ aiSuggestedRate: suggestion.suggestedRate })
              .where(eq(rentRollData.id, unit.id));
            
            updatedUnits.push({...unit, aiSuggestedRate: suggestion.suggestedRate});
          }
        }
      } catch (error) {
        console.error('AI pricing error for batch:', error);
        // Continue with next batch even if one fails
      }
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
}

export const storage = new DatabaseStorage();