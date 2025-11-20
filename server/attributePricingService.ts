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
  private cacheMonth: string | null = null; // Issue 3 fix: Track which month the cache is for

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
      if (unit.streetRate === 0) {
        continue;
      }
      
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
      if (data.count === 0) continue;
      
      const [location, serviceLine, roomType] = key.split('|');
      const averageStreetRate = data.totalStreetRate / data.count;
      const averageMultiplier = data.totalMultiplier / data.count;
      
      const baseRate = averageMultiplier > 0 ? averageStreetRate / averageMultiplier : averageStreetRate;

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
    this.cacheMonth = month; // Issue 3 fix: Store which month this cache is for
    
    console.log(`Base rates refreshed for ${this.baseRateCache.size} segments (${units.length} total units) for month: ${month}`);
  }

  async getCampusServiceLineMedian(location: string, serviceLine: string): Promise<number | null> {
    const units = await db.select()
      .from(rentRollData)
      .where(and(
        eq(rentRollData.location, location),
        eq(rentRollData.serviceLine, serviceLine)
      ));

    const validRates = units
      .filter(u => u.streetRate > 0)
      .map(u => u.streetRate)
      .sort((a, b) => a - b);

    if (validRates.length === 0) {
      return null;
    }

    const medianIndex = Math.floor(validRates.length / 2);
    return validRates.length % 2 === 0
      ? (validRates[medianIndex - 1] + validRates[medianIndex]) / 2
      : validRates[medianIndex];
  }

  async getUnitBaseRate(unit: RentRollData, options?: { defaultFloor?: number }): Promise<{ rate: number; source: string }> {
    const defaultFloor = options?.defaultFloor || 2500;
    
    const segmentKey = this.getSegmentKey(unit.location, unit.serviceLine, unit.roomType);
    const segment = this.baseRateCache.get(segmentKey);
    
    if (segment && segment.baseRate > 0) {
      return { rate: segment.baseRate, source: 'segment' };
    }

    console.warn(`No segment base rate found for ${segmentKey}, trying campus/service-line median`);
    const campusMedian = await this.getCampusServiceLineMedian(unit.location, unit.serviceLine);
    
    if (campusMedian && campusMedian > 0) {
      return { rate: campusMedian, source: 'campus_median' };
    }

    console.warn(`No campus median found for ${unit.location}/${unit.serviceLine}, using default floor`);
    return { rate: defaultFloor, source: 'default_floor' };
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

  getCacheMonth(): string | null {
    return this.cacheMonth; // Issue 3 fix: Return which month the cache is for
  }

  getCacheStatus(): { cached: number; timestamp: Date | null; month: string | null } {
    return {
      cached: this.baseRateCache.size,
      timestamp: this.cacheTimestamp,
      month: this.cacheMonth // Issue 3 fix: Include month in cache status
    };
  }
}

export const attributePricingService = new AttributePricingService();
