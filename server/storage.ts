import { 
  type User, 
  type InsertUser,
  type RentRollData,
  type InsertRentRollData,
  type Assumptions,
  type InsertAssumptions,
  type PricingWeights,
  type InsertPricingWeights,
  type Competitor,
  type InsertCompetitor,
  type Guardrails,
  type InsertGuardrails,
  type MlModel,
  type InsertMlModel
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Rent roll data
  getRentRollData(): Promise<RentRollData[]>;
  createRentRollData(data: InsertRentRollData): Promise<RentRollData>;
  clearRentRollData(): Promise<void>;
  
  // Assumptions
  getCurrentAssumptions(): Promise<Assumptions | undefined>;
  createOrUpdateAssumptions(data: InsertAssumptions): Promise<Assumptions>;
  
  // Pricing weights
  getCurrentWeights(): Promise<PricingWeights | undefined>;
  createOrUpdateWeights(data: InsertPricingWeights): Promise<PricingWeights>;
  
  // Competitors
  getCompetitors(): Promise<Competitor[]>;
  createCompetitor(data: InsertCompetitor): Promise<Competitor>;
  createOrUpdateCompetitor(data: InsertCompetitor): Promise<Competitor>;
  clearCompetitors(): Promise<void>;
  
  // Guardrails
  getCurrentGuardrails(): Promise<Guardrails | undefined>;
  createOrUpdateGuardrails(data: InsertGuardrails): Promise<Guardrails>;
  
  // ML Models
  getMlModels(): Promise<MlModel[]>;
  createMlModel(data: InsertMlModel): Promise<MlModel>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private rentRollData: Map<string, RentRollData>;
  private assumptions: Assumptions | undefined;
  private weights: PricingWeights | undefined;
  private competitors: Map<string, Competitor>;
  private guardrails: Guardrails | undefined;
  private mlModels: Map<string, MlModel>;

  constructor() {
    this.users = new Map();
    this.rentRollData = new Map();
    this.competitors = new Map();
    this.mlModels = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
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

export const storage = new MemStorage();
