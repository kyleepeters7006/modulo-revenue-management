import { 
  users,
  rentRollData,
  rateCard,
  uploadHistory,
  assumptions,
  pricingWeights,
  competitors,
  guardrails,
  attributeRatings,
  locations,
  portfolioCompetitors,
  targetsAndTrends,
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
  type AttributeRatings,
  type InsertAttributeRatings,
  type Location,
  type InsertLocation,
  type PortfolioCompetitor,
  type InsertPortfolioCompetitor,
  type TargetsAndTrends,
  type InsertTargetsAndTrends
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
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
  getLocationByName(name: string): Promise<Location | undefined>;
  createOrUpdateLocation(data: InsertLocation): Promise<Location>;
  updateLocationUnits(locationId: string, unitCount: number): Promise<void>;
  
  // Rent roll data operations
  getRentRollData(): Promise<RentRollData[]>;
  getRentRollDataByMonth(uploadMonth: string): Promise<RentRollData[]>;
  getRentRollDataByLocation(location: string): Promise<RentRollData[]>;
  createRentRollData(data: InsertRentRollData): Promise<RentRollData>;
  bulkInsertRentRollData(data: any[]): Promise<void>;
  clearRentRollData(): Promise<void>;
  clearRentRollDataByLocation(location: string): Promise<void>;
  
  // Rate card operations
  getRateCardByMonth(uploadMonth: string): Promise<RateCard[]>;
  generateRateCard(uploadMonth: string): Promise<void>;
  
  // Upload history
  createUploadHistory(data: InsertUploadHistory): Promise<UploadHistory>;
  
  // Assumptions
  getCurrentAssumptions(): Promise<Assumptions | undefined>;
  createOrUpdateAssumptions(data: InsertAssumptions): Promise<Assumptions>;
  
  // Pricing weights
  getPricingWeights(): Promise<PricingWeights[]>;
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
  
  // Guardrails
  getGuardrails(): Promise<Guardrails[]>;
  getCurrentGuardrails(): Promise<Guardrails | undefined>;
  createOrUpdateGuardrails(data: InsertGuardrails): Promise<Guardrails>;
  
  // Pricing suggestions
  generateModuloPricingSuggestions(units: any[], weights: PricingWeights, guardrails: Guardrails): Promise<any[]>;
  generateAIPricingSuggestions(units: any[]): Promise<any[]>;
  acceptPricingSuggestions(unitIds: string[], suggestionType: string): Promise<number>;
}

export class DatabaseStorage implements IStorage {
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
  async getLocations(): Promise<Location[]> {
    return await db.select().from(locations);
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

  // Rate card operations
  async getRateCardByMonth(uploadMonth: string): Promise<RateCard[]> {
    return await db.select().from(rateCard).where(eq(rateCard.uploadMonth, uploadMonth));
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
  async getCurrentAssumptions(): Promise<Assumptions | undefined> {
    const [assumption] = await db.select().from(assumptions).limit(1);
    return assumption;
  }

  async createOrUpdateAssumptions(data: InsertAssumptions): Promise<Assumptions> {
    // Delete existing and insert new
    await db.delete(assumptions);
    const [assumption] = await db.insert(assumptions).values(data).returning();
    return assumption;
  }

  // Pricing weights
  async getPricingWeights(): Promise<PricingWeights[]> {
    return await db.select().from(pricingWeights);
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

  // Guardrails
  async getGuardrails(): Promise<Guardrails[]> {
    return await db.select().from(guardrails);
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
    
    for (const unit of units) {
      // Apply Modulo pricing algorithm
      let baseRate = unit.streetRate;
      let adjustment = 0;

      // Occupancy pressure adjustment
      const occupancyRate = units.filter(u => u.occupiedYN).length / units.length;
      if (occupancyRate < 0.8) {
        adjustment -= baseRate * 0.02 * (weights.occupancyPressure / 100);
      } else if (occupancyRate > 0.95) {
        adjustment += baseRate * 0.03 * (weights.occupancyPressure / 100);
      }

      // Days vacant adjustment
      if (unit.daysVacant > 30) {
        adjustment -= baseRate * 0.01 * Math.min(unit.daysVacant / 30, 5) * (weights.daysVacantDecay / 100);
      }

      // Attribute adjustments
      if (unit.renovated) {
        adjustment += baseRate * 0.05 * (weights.roomAttributes / 100);
      }
      if (unit.view && unit.view.includes('Garden')) {
        adjustment += baseRate * 0.03 * (weights.roomAttributes / 100);
      }

      // Competitor rate adjustment
      if (unit.competitorRate && unit.competitorRate > 0) {
        const competitorDiff = (unit.competitorRate - baseRate) / baseRate;
        adjustment += baseRate * competitorDiff * 0.5 * (weights.competitorRates / 100);
      }

      // Apply guardrails
      const suggestedRate = Math.max(
        baseRate * (1 - (guardrails.minRateDecrease || 0.05)),
        Math.min(
          baseRate * (1 + (guardrails.maxRateIncrease || 0.15)),
          baseRate + adjustment
        )
      );

      // Update unit
      await db.update(rentRollData)
        .set({ moduloSuggestedRate: Math.round(suggestedRate) })
        .where(eq(rentRollData.id, unit.id));

      updatedUnits.push({...unit, moduloSuggestedRate: Math.round(suggestedRate)});
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
}

export const storage = new DatabaseStorage();