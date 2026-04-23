import { storage } from './storage';
import { 
  calculateModuloPrice, 
  PricingInputs as ModuloPricingInputs, 
  PricingWeights as ModuloPricingWeights
} from './moduloPricingAlgorithm';

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
    
    // Set default weights if none configured (using 0-100 scale)
    const defaultWeights = {
      occupancyPressure: 25,
      daysVacantDecay: 15,
      seasonality: 5,
      competitorRates: 10,
      stockMarket: 5,
      inquiryTourVolume: 20
    };
    
    const activeWeights = weights || defaultWeights;
    const baseRate = inputs.competitorRate || inputs.currentRate;
    
    // Calculate attribute score (0-1 normalized)
    let attrScore = 0.5; // Default to midpoint
    if (inputs.attributes) {
      // Simple scoring based on presence of premium features
      let score = 0.5;
      if (inputs.attributes.view === 'city' || inputs.attributes.view === 'garden') score += 0.1;
      if (inputs.attributes.renovation === 'recent') score += 0.15;
      if (inputs.attributes.location === 'corner' || inputs.attributes.location === 'end') score += 0.1;
      if (inputs.attributes.size === 'large') score += 0.1;
      if (inputs.attributes.amenity === 'premium') score += 0.05;
      attrScore = Math.min(1.0, score);
    }
    
    // Get competitor prices (if available)
    const competitorPrices: number[] = inputs.competitorRate ? [inputs.competitorRate] : [];
    
    // Generate demand history (mock for now - should be fetched from DB)
    const demandHistory = [18, 22, 25, 21, 27, 24, 23, 19]; // Historical inquiries/tours
    const demandCurrent = 25; // Current period inquiries/tours
    
    // Use the new sophisticated algorithm
    const moduloInputs: ModuloPricingInputs = {
      occupancy: inputs.occupancyRate,
      daysVacant: inputs.daysVacant,
      attrScore,
      monthIndex: new Date().getMonth() + 1, // 1-12
      competitorPrices,
      marketReturn: 0.02, // Static 2% for now (should be fetched from market API)
      demandCurrent,
      demandHistory
    };
    
    const moduloWeights: ModuloPricingWeights = {
      occupancy: activeWeights.occupancyPressure || 25,
      daysVacant: activeWeights.daysVacantDecay || 15,
      seasonality: activeWeights.seasonality || 5,
      competitors: activeWeights.competitorRates || 10,
      market: activeWeights.stockMarket || 5,
      demand: activeWeights.inquiryTourVolume || 20
    };
    
    const result = calculateModuloPrice(baseRate, moduloWeights, moduloInputs);
    
    // Apply guardrails to the final price
    let recommendedRate = result.finalPrice;
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
    
    // Map the new result format to the expected format
    // Factor names are capitalized versions of the weight keys
    const adjustments = result.adjustments || [];
    const occupancyAdj = adjustments.find(a => a.factor === 'Occupancy');
    const vacancyAdj = adjustments.find(a => a.factor === 'DaysVacant');
    const attrAdj = adjustments.find(a => a.factor === 'RoomAttributes');
    const seasonalAdj = adjustments.find(a => a.factor === 'Seasonality');
    const competitorAdj = adjustments.find(a => a.factor === 'Competitors');
    const marketAdj = adjustments.find(a => a.factor === 'Market');
    
    return {
      recommendedRate,
      calculation: {
        baseRate,
        occupancyAdjustment: occupancyAdj?.adjustment || 0,
        vacancyAdjustment: vacancyAdj?.adjustment || 0,
        attributeAdjustment: attrAdj?.adjustment || 0,
        seasonalAdjustment: seasonalAdj?.adjustment || 0,
        competitorAdjustment: competitorAdj?.adjustment || 0,
        marketAdjustment: marketAdj?.adjustment || 0,
        totalAdjustment: result.totalAdjustment,
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
    // Simple market adjustment (static for calculation display)
    // Avoid external API calls during individual calculations
    return 0.02; // 2% general market growth (static)
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