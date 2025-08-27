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
  type InsertAttributeRatings
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
  
  // Rent roll data operations
  getRentRollData(): Promise<RentRollData[]>;
  getRentRollDataByMonth(uploadMonth: string): Promise<RentRollData[]>;
  createRentRollData(data: InsertRentRollData): Promise<RentRollData>;
  bulkInsertRentRollData(data: any[]): Promise<void>;
  clearRentRollData(): Promise<void>;
  
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
  createCompetitor(data: InsertCompetitor): Promise<Competitor>;
  createOrUpdateCompetitor(data: InsertCompetitor): Promise<Competitor>;
  clearCompetitors(): Promise<void>;
  
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

  // Rent roll data operations
  async getRentRollData(): Promise<RentRollData[]> {
    return await db.select().from(rentRollData);
  }

  async getRentRollDataByMonth(uploadMonth: string): Promise<RentRollData[]> {
    return await db.select().from(rentRollData).where(eq(rentRollData.uploadMonth, uploadMonth));
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

  // Rate card operations
  async getRateCardByMonth(uploadMonth: string): Promise<RateCard[]> {
    return await db.select().from(rateCard).where(eq(rateCard.uploadMonth, uploadMonth));
  }

  async generateRateCard(uploadMonth: string): Promise<void> {
    // Get rent roll data for the month
    const units = await this.getRentRollDataByMonth(uploadMonth);
    
    // Group by room type and calculate averages
    const roomTypeStats = units.reduce((acc: any, unit: any) => {
      if (!acc[unit.roomType]) {
        acc[unit.roomType] = {
          streetRates: [],
          moduloRates: [],
          aiRates: [],
          occupied: 0,
          total: 0
        };
      }
      
      acc[unit.roomType].streetRates.push(unit.streetRate);
      if (unit.moduloSuggestedRate) acc[unit.roomType].moduloRates.push(unit.moduloSuggestedRate);
      if (unit.aiSuggestedRate) acc[unit.roomType].aiRates.push(unit.aiSuggestedRate);
      acc[unit.roomType].total++;
      if (unit.occupiedYN) acc[unit.roomType].occupied++;
      
      return acc;
    }, {});

    // Delete existing rate cards for this month and insert new ones
    await db.delete(rateCard).where(eq(rateCard.uploadMonth, uploadMonth));
    
    for (const [roomType, stats] of Object.entries(roomTypeStats) as [string, any][]) {
      const avgStreet = stats.streetRates.reduce((sum: number, rate: number) => sum + rate, 0) / stats.streetRates.length;
      const avgModulo = stats.moduloRates.length > 0 ? stats.moduloRates.reduce((sum: number, rate: number) => sum + rate, 0) / stats.moduloRates.length : null;
      const avgAi = stats.aiRates.length > 0 ? stats.aiRates.reduce((sum: number, rate: number) => sum + rate, 0) / stats.aiRates.length : null;
      
      await db.insert(rateCard).values({
        uploadMonth,
        roomType,
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

  async createCompetitor(data: InsertCompetitor): Promise<Competitor> {
    const [competitor] = await db.insert(competitors).values(data).returning();
    return competitor;
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