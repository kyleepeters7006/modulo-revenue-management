import { storage } from './storage';

interface PricingInputs {
  unitId: string;
  roomType: string;
  serviceLine: string;
  currentRate: number;
  competitorRate: number;
  daysVacant: number;
  occupancyRate: number;
  totalUnits: number;
  occupiedUnits: number;
  attributes?: {
    location?: string;
    size?: string; 
    view?: string;
    renovation?: string;
    amenity?: string;
  };
}

interface PricingResult {
  recommendedRate: number;
  calculation: {
    baseRate: number;
    occupancyAdjustment: number;
    vacancyAdjustment: number;
    attributeAdjustment: number;
    seasonalAdjustment: number;
    competitorAdjustment: number;
    marketAdjustment: number;
    totalAdjustment: number;
    guardrailsApplied: string[];
  };
}

export class PricingAlgorithm {
  
  async calculateModuloRate(inputs: PricingInputs): Promise<PricingResult> {
    // Get current algorithm configuration
    const weights = await storage.getPricingWeights();
    const guardrails = await storage.getGuardrails();
    const attributeRatings = await storage.getAttributeRatings();
    
    // Set default weights if none configured
    const defaultWeights = {
      occupancyPressure: 25,
      daysVacantDecay: 20,
      roomAttributes: 25,
      seasonality: 10,
      competitorRates: 10,
      stockMarket: 10
    };
    
    const activeWeights = weights || defaultWeights;
    
    // Base rate (current market rate or competitor rate)
    const baseRate = inputs.competitorRate || inputs.currentRate;
    
    // Calculate individual adjustments based on weights
    const occupancyAdjustment = this.calculateOccupancyAdjustment(
      inputs.occupancyRate, 
      inputs.totalUnits, 
      activeWeights.occupancyPressure
    );
    
    const vacancyAdjustment = this.calculateVacancyAdjustment(
      inputs.daysVacant, 
      activeWeights.daysVacantDecay
    );
    
    const attributeAdjustment = await this.calculateAttributeAdjustment(
      inputs.attributes, 
      attributeRatings, 
      activeWeights.roomAttributes
    );
    
    const seasonalAdjustment = this.calculateSeasonalAdjustment(
      activeWeights.seasonality
    );
    
    const competitorAdjustment = this.calculateCompetitorAdjustment(
      inputs.currentRate, 
      inputs.competitorRate, 
      activeWeights.competitorRates
    );
    
    const marketAdjustment = this.calculateMarketAdjustment(
      activeWeights.stockMarket
    );
    
    // Sum all adjustments weighted by algorithm percentages
    const totalAdjustment = (
      occupancyAdjustment * (activeWeights.occupancyPressure / 100) +
      vacancyAdjustment * (activeWeights.daysVacantDecay / 100) +
      attributeAdjustment * (activeWeights.roomAttributes / 100) +
      seasonalAdjustment * (activeWeights.seasonality / 100) +
      competitorAdjustment * (activeWeights.competitorRates / 100) +
      marketAdjustment * (activeWeights.stockMarket / 100)
    );
    
    // Calculate recommended rate
    let recommendedRate = baseRate * (1 + totalAdjustment);
    
    // Apply guardrails
    const guardrailsApplied: string[] = [];
    if (guardrails) {
      const { rate: finalRate, appliedRules } = this.applyGuardrails(
        recommendedRate, 
        inputs.currentRate, 
        inputs.competitorRate, 
        guardrails
      );
      recommendedRate = finalRate;
      guardrailsApplied.push(...appliedRules);
    }
    
    return {
      recommendedRate,
      calculation: {
        baseRate,
        occupancyAdjustment,
        vacancyAdjustment,
        attributeAdjustment,
        seasonalAdjustment,
        competitorAdjustment,
        marketAdjustment,
        totalAdjustment,
        guardrailsApplied
      }
    };
  }
  
  private calculateOccupancyAdjustment(occupancyRate: number, totalUnits: number, weight: number): number {
    // Target 95% occupancy - adjust rates based on current vs target
    const targetOccupancy = 0.95;
    const occupancyDelta = occupancyRate - targetOccupancy;
    
    // If below target, reduce rates to attract residents
    // If above target, increase rates to optimize revenue
    return occupancyDelta * 0.5; // 50% adjustment per occupancy point difference
  }
  
  private calculateVacancyAdjustment(daysVacant: number, weight: number): number {
    // Longer vacancy = lower rate to attract residents faster
    if (daysVacant <= 30) return 0;
    if (daysVacant <= 60) return -0.05; // 5% reduction
    if (daysVacant <= 90) return -0.10; // 10% reduction
    return -0.15; // 15% reduction for 90+ days vacant
  }
  
  private async calculateAttributeAdjustment(
    attributes: any, 
    attributeRatings: any[], 
    weight: number
  ): Promise<number> {
    if (!attributes || !attributeRatings.length) return 0;
    
    let totalAdjustment = 0;
    const attributeTypes = ['location', 'size', 'view', 'renovation', 'amenity'];
    
    for (const type of attributeTypes) {
      const value = attributes[type];
      if (value) {
        const rating = attributeRatings.find(r => 
          r.attributeType === type && r.ratingLevel === value
        );
        if (rating) {
          totalAdjustment += rating.adjustmentPercent / 100;
        }
      }
    }
    
    return totalAdjustment / attributeTypes.length; // Average adjustment
  }
  
  private calculateSeasonalAdjustment(weight: number): number {
    // Simple seasonal adjustment based on month
    const month = new Date().getMonth();
    
    // Peak season: Sept-Nov (move-in season)
    if (month >= 8 && month <= 10) return 0.05; // 5% increase
    
    // Low season: Dec-Feb  
    if (month >= 11 || month <= 1) return -0.03; // 3% decrease
    
    // Regular season
    return 0;
  }
  
  private calculateCompetitorAdjustment(currentRate: number, competitorRate: number, weight: number): number {
    if (!competitorRate || competitorRate === 0) return 0;
    
    // Adjust based on competitor positioning
    const competitorDelta = (competitorRate - currentRate) / currentRate;
    
    // Move towards competitive positioning but not exactly match
    return competitorDelta * 0.8; // 80% of competitor gap
  }
  
  private calculateMarketAdjustment(weight: number): number {
    // Simple market adjustment (could be enhanced with real market data)
    // For now, small positive adjustment for general market growth
    return 0.02; // 2% general market growth
  }
  
  private applyGuardrails(
    recommendedRate: number, 
    currentRate: number, 
    competitorRate: number, 
    guardrails: any
  ): { rate: number; appliedRules: string[] } {
    let finalRate = recommendedRate;
    const appliedRules: string[] = [];
    
    // Min/Max rate change limits
    if (guardrails.minRateDecrease) {
      const minRate = currentRate * (1 - guardrails.minRateDecrease);
      if (finalRate < minRate) {
        finalRate = minRate;
        appliedRules.push(`Minimum rate decrease limit applied (${(guardrails.minRateDecrease * 100).toFixed(1)}%)`);
      }
    }
    
    if (guardrails.maxRateIncrease) {
      const maxRate = currentRate * (1 + guardrails.maxRateIncrease);
      if (finalRate > maxRate) {
        finalRate = maxRate;
        appliedRules.push(`Maximum rate increase limit applied (${(guardrails.maxRateIncrease * 100).toFixed(1)}%)`);
      }
    }
    
    // Competitor variance limits
    if (guardrails.competitorVarianceLimit && competitorRate) {
      const maxVariance = competitorRate * guardrails.competitorVarianceLimit;
      const minCompetitorRate = competitorRate - maxVariance;
      const maxCompetitorRate = competitorRate + maxVariance;
      
      if (finalRate < minCompetitorRate) {
        finalRate = minCompetitorRate;
        appliedRules.push(`Competitor variance floor applied (${(guardrails.competitorVarianceLimit * 100).toFixed(1)}%)`);
      }
      
      if (finalRate > maxCompetitorRate) {
        finalRate = maxCompetitorRate;
        appliedRules.push(`Competitor variance ceiling applied (${(guardrails.competitorVarianceLimit * 100).toFixed(1)}%)`);
      }
    }
    
    return { rate: finalRate, appliedRules };
  }
}

export const pricingAlgorithm = new PricingAlgorithm();