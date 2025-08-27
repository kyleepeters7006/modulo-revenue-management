import { 
  users,
  rentRollData,
  rateCard,
  uploadHistory,
  assumptions,
  pricingWeights,
  competitors,
  guardrails,
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
  type InsertGuardrails
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// Interface for storage operations
export interface IStorage {
  // User operations
  // (IMPORTANT) these user operations are mandatory for Replit Auth.
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
  // (IMPORTANT) these user operations are mandatory for Replit Auth.

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

  // Other operations - keeping in-memory for now
  private rentRollData: Map<string, RentRollData>;
  private assumptions: Assumptions | undefined;
  private weights: PricingWeights | undefined;
  private competitors: Map<string, Competitor>;
  private guardrails: Guardrails | undefined;
  private mlModels: Map<string, MlModel>;

  constructor() {
    this.rentRollData = new Map();
    this.competitors = new Map();
    this.mlModels = new Map();
  }

  async getRentRollData(): Promise<RentRollData[]> {
    return Array.from(this.rentRollData.values());
  }

  async createRentRollData(data: InsertRentRollData): Promise<RentRollData> {
    const id = randomUUID();
    const rentRoll: RentRollData = { ...data, id };
    this.rentRollData.set(id, rentRoll);
    return rentRoll;
  }

  async clearRentRollData(): Promise<void> {
    this.rentRollData.clear();
  }

  async getCurrentAssumptions(): Promise<Assumptions | undefined> {
    return this.assumptions;
  }

  async createOrUpdateAssumptions(data: InsertAssumptions): Promise<Assumptions> {
    const id = randomUUID();
    const assumptions: Assumptions = { 
      ...data, 
      id, 
      createdAt: new Date()
    };
    this.assumptions = assumptions;
    return assumptions;
  }

  async getCurrentWeights(): Promise<PricingWeights | undefined> {
    return this.weights;
  }

  async createOrUpdateWeights(data: InsertPricingWeights): Promise<PricingWeights> {
    const id = randomUUID();
    const weights: PricingWeights = { 
      ...data, 
      id, 
      createdAt: new Date()
    };
    this.weights = weights;
    return weights;
  }

  async getCompetitors(): Promise<Competitor[]> {
    return Array.from(this.competitors.values());
  }

  async createCompetitor(data: InsertCompetitor): Promise<Competitor> {
    const id = randomUUID();
    const competitor: Competitor = { 
      ...data, 
      id, 
      createdAt: new Date()
    };
    this.competitors.set(id, competitor);
    return competitor;
  }

  async createOrUpdateCompetitor(data: InsertCompetitor): Promise<Competitor> {
    // Check if competitor exists by name
    const existing = Array.from(this.competitors.values()).find(c => c.name === data.name);
    
    if (existing) {
      // Update existing competitor
      const updated: Competitor = { 
        ...existing, 
        ...data, 
        rates: { ...existing.rates, ...data.rates }
      };
      this.competitors.set(existing.id, updated);
      return updated;
    } else {
      // Create new competitor
      return this.createCompetitor(data);
    }
  }

  async clearCompetitors(): Promise<void> {
    this.competitors.clear();
  }

  async getCurrentGuardrails(): Promise<Guardrails | undefined> {
    return this.guardrails;
  }

  async createOrUpdateGuardrails(data: InsertGuardrails): Promise<Guardrails> {
    const id = randomUUID();
    const guardrails: Guardrails = { 
      ...data, 
      id, 
      createdAt: new Date()
    };
    this.guardrails = guardrails;
    return guardrails;
  }

  async getMlModels(): Promise<MlModel[]> {
    return Array.from(this.mlModels.values());
  }

  async createMlModel(data: InsertMlModel): Promise<MlModel> {
    const id = randomUUID();
    const model: MlModel = { 
      ...data, 
      id, 
      createdAt: new Date()
    };
    this.mlModels.set(id, model);
    return model;
  }
}

export const storage = new DatabaseStorage();