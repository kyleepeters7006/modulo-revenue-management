import { db } from "./db";
import { rentRollData, attributeRatings, type RentRollData, type AttributeRatings } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface AttributeMultipliers {
  location: number;
  size: number;
  view: number;
  renovation: number;
  amenity: number;
}

interface BaseRateSegment {
  location: string;
  serviceLine: string;
  roomType: string;
  baseRate: number;
  averageStreetRate: number;
  averageMultiplier: number;
  unitCount: number;
  lastUpdated: Date;
}

class AttributePricingService {
  private baseRateCache: Map<string, BaseRateSegment> = new Map();
  private attributeRatingCache: Map<string, number> = new Map();
  private cacheTimestamp: Date | null = null;

  constructor() {
    this.initializeAttributeRatings();
  }

  private async initializeAttributeRatings() {
    const ratings = await db.select().from(attributeRatings);
    
    for (const rating of ratings) {
      const key = `${rating.attributeType}:${rating.ratingLevel}`;
      this.attributeRatingCache.set(key, rating.adjustmentPercent);
    }
  }

  private getSegmentKey(location: string, serviceLine: string, roomType: string): string {
    return `${location}|${serviceLine}|${roomType}`;
  }

  getAttributeAdjustmentPercent(attributeType: string, ratingLevel: string | null): number {
    if (!ratingLevel) return 0; // Neutral for missing ratings
    
    const key = `${attributeType}:${ratingLevel}`;
    return this.attributeRatingCache.get(key) || 0;
  }

  calculateAttributeMultiplier(unit: RentRollData): number {
    const locationAdj = this.getAttributeAdjustmentPercent('location', unit.locationRating);
    const sizeAdj = this.getAttributeAdjustmentPercent('size', unit.sizeRating);
    const viewAdj = this.getAttributeAdjustmentPercent('view', unit.viewRating);
    const renovationAdj = this.getAttributeAdjustmentPercent('renovation', unit.renovationRating);
    const amenityAdj = this.getAttributeAdjustmentPercent('amenity', unit.amenityRating);

    const totalAdjustmentPercent = locationAdj + sizeAdj + viewAdj + renovationAdj + amenityAdj;
    
    return 1 + (totalAdjustmentPercent / 100);
  }

  getAttributeBreakdown(unit: RentRollData): {
    multipliers: AttributeMultipliers;
    totalMultiplier: number;
    breakdown: Array<{ type: string; rating: string | null; adjustmentPercent: number }>;
  } {
    const multipliers: AttributeMultipliers = {
      location: this.getAttributeAdjustmentPercent('location', unit.locationRating),
      size: this.getAttributeAdjustmentPercent('size', unit.sizeRating),
      view: this.getAttributeAdjustmentPercent('view', unit.viewRating),
      renovation: this.getAttributeAdjustmentPercent('renovation', unit.renovationRating),
      amenity: this.getAttributeAdjustmentPercent('amenity', unit.amenityRating)
    };

    const breakdown = [
      { type: 'Location', rating: unit.locationRating, adjustmentPercent: multipliers.location },
      { type: 'Size', rating: unit.sizeRating, adjustmentPercent: multipliers.size },
      { type: 'View', rating: unit.viewRating, adjustmentPercent: multipliers.view },
      { type: 'Renovation', rating: unit.renovationRating, adjustmentPercent: multipliers.renovation },
      { type: 'Amenity', rating: unit.amenityRating, adjustmentPercent: multipliers.amenity }
    ];

    const totalMultiplier = this.calculateAttributeMultiplier(unit);

    return { multipliers, totalMultiplier, breakdown };
  }

  async refreshBaseRates(uploadMonth?: string): Promise<void> {
    console.log('Refreshing attribute pricing base rates...');
    
    const month = uploadMonth || new Date().toISOString().slice(0, 7);
    
    const units = await db.select()
      .from(rentRollData)
      .where(eq(rentRollData.uploadMonth, month));

    if (units.length === 0) {
      console.log('No units found for month:', month);
      return;
    }

    const segments = new Map<string, { totalStreetRate: number; totalMultiplier: number; count: number; units: RentRollData[] }>();

    for (const unit of units) {
      const key = this.getSegmentKey(unit.location, unit.serviceLine, unit.roomType);
      
      if (!segments.has(key)) {
        segments.set(key, { totalStreetRate: 0, totalMultiplier: 0, count: 0, units: [] });
      }

      const segment = segments.get(key)!;
      const multiplier = this.calculateAttributeMultiplier(unit);
      
      segment.totalStreetRate += unit.streetRate;
      segment.totalMultiplier += multiplier;
      segment.count += 1;
      segment.units.push(unit);
    }

    this.baseRateCache.clear();

    for (const [key, data] of segments.entries()) {
      const [location, serviceLine, roomType] = key.split('|');
      const averageStreetRate = data.totalStreetRate / data.count;
      const averageMultiplier = data.totalMultiplier / data.count;
      
      const baseRate = averageStreetRate / averageMultiplier;

      this.baseRateCache.set(key, {
        location,
        serviceLine,
        roomType,
        baseRate,
        averageStreetRate,
        averageMultiplier,
        unitCount: data.count,
        lastUpdated: new Date()
      });
    }

    this.cacheTimestamp = new Date();
    
    console.log(`Base rates refreshed for ${this.baseRateCache.size} segments (${units.length} total units)`);
  }

  getBaseRate(location: string, serviceLine: string, roomType: string): number | null {
    const key = this.getSegmentKey(location, serviceLine, roomType);
    const segment = this.baseRateCache.get(key);
    return segment ? segment.baseRate : null;
  }

  getBaseRateWithFallback(location: string, serviceLine: string, roomType: string, streetRate: number): number {
    const baseRate = this.getBaseRate(location, serviceLine, roomType);
    
    if (baseRate !== null) {
      return baseRate;
    }

    return streetRate * 0.85;
  }

  getAllSegments(): BaseRateSegment[] {
    return Array.from(this.baseRateCache.values());
  }

  getCacheTimestamp(): Date | null {
    return this.cacheTimestamp;
  }

  getCacheStatus(): { cached: number; timestamp: Date | null } {
    return {
      cached: this.baseRateCache.size,
      timestamp: this.cacheTimestamp
    };
  }
}

export const attributePricingService = new AttributePricingService();
