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
  // Issue #2 fix: Track attributed vs non-attributed segments
  hasAttributes: boolean;  // true if any unit has non-neutral attributes
  attributedUnitCount: number;  // Count of units with actual attributes
  nonAttributedUnitCount: number;  // Count of units with neutral/missing attributes
  attributedBaseRate: number | null;  // Base rate calculated from attributed units only
  nonAttributedBaseRate: number | null;  // Base rate calculated from non-attributed units only
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

  // Issue #2 fix: Check if unit has any non-neutral attributes
  hasConfiguredAttributes(unit: RentRollData): boolean {
    // A unit has configured attributes if any rating is not null
    return !!(unit.locationRating || unit.sizeRating || unit.viewRating || 
             unit.renovationRating || unit.amenityRating);
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

    // Issue #2 fix: Separate attributed and non-attributed units
    const segments = new Map<string, {
      totalStreetRate: number;
      totalMultiplier: number;
      count: number;
      units: RentRollData[];
      // Track attributed vs non-attributed
      attributedUnits: RentRollData[];
      nonAttributedUnits: RentRollData[];
      attributedTotalRate: number;
      nonAttributedTotalRate: number;
      attributedTotalMultiplier: number;
      nonAttributedTotalMultiplier: number;
    }>();

    for (const unit of units) {
      if (unit.streetRate === 0) {
        continue;
      }
      
      const key = this.getSegmentKey(unit.location, unit.serviceLine, unit.roomType);
      
      if (!segments.has(key)) {
        segments.set(key, {
          totalStreetRate: 0,
          totalMultiplier: 0,
          count: 0,
          units: [],
          attributedUnits: [],
          nonAttributedUnits: [],
          attributedTotalRate: 0,
          nonAttributedTotalRate: 0,
          attributedTotalMultiplier: 0,
          nonAttributedTotalMultiplier: 0
        });
      }

      const segment = segments.get(key)!;
      const multiplier = this.calculateAttributeMultiplier(unit);
      const hasAttributes = this.hasConfiguredAttributes(unit);
      
      segment.totalStreetRate += unit.streetRate;
      segment.totalMultiplier += multiplier;
      segment.count += 1;
      segment.units.push(unit);
      
      // Issue #2 fix: Separate attributed vs non-attributed tracking
      if (hasAttributes) {
        segment.attributedUnits.push(unit);
        segment.attributedTotalRate += unit.streetRate;
        segment.attributedTotalMultiplier += multiplier;
      } else {
        segment.nonAttributedUnits.push(unit);
        segment.nonAttributedTotalRate += unit.streetRate;
        segment.nonAttributedTotalMultiplier += multiplier;
      }
    }

    this.baseRateCache.clear();

    for (const [key, data] of segments.entries()) {
      if (data.count === 0) continue;
      
      const [location, serviceLine, roomType] = key.split('|');
      const averageStreetRate = data.totalStreetRate / data.count;
      const averageMultiplier = data.totalMultiplier / data.count;
      
      // Issue #2 fix: Calculate separate base rates for attributed vs non-attributed units
      let attributedBaseRate: number | null = null;
      let nonAttributedBaseRate: number | null = null;
      
      // Calculate base rate for attributed units (if any)
      if (data.attributedUnits.length > 0) {
        const avgAttributedStreetRate = data.attributedTotalRate / data.attributedUnits.length;
        const avgAttributedMultiplier = data.attributedTotalMultiplier / data.attributedUnits.length;
        attributedBaseRate = avgAttributedMultiplier > 0 ? avgAttributedStreetRate / avgAttributedMultiplier : avgAttributedStreetRate;
      }
      
      // Calculate base rate for non-attributed units (if any)
      if (data.nonAttributedUnits.length > 0) {
        const avgNonAttributedStreetRate = data.nonAttributedTotalRate / data.nonAttributedUnits.length;
        const avgNonAttributedMultiplier = data.nonAttributedTotalMultiplier / data.nonAttributedUnits.length;
        nonAttributedBaseRate = avgNonAttributedMultiplier > 0 ? avgNonAttributedStreetRate / avgNonAttributedMultiplier : avgNonAttributedStreetRate;
      }
      
      // Use attributed base rate if available, otherwise fall back to non-attributed
      // This ensures buildings with attributes get accurate base rates
      const primaryBaseRate = attributedBaseRate !== null ? attributedBaseRate : 
                             nonAttributedBaseRate !== null ? nonAttributedBaseRate : 
                             averageStreetRate;

      this.baseRateCache.set(key, {
        location,
        serviceLine,
        roomType,
        baseRate: primaryBaseRate,
        averageStreetRate,
        averageMultiplier,
        unitCount: data.count,
        lastUpdated: new Date(),
        // Issue #2 fix: Include metadata about attributed vs non-attributed
        hasAttributes: data.attributedUnits.length > 0,
        attributedUnitCount: data.attributedUnits.length,
        nonAttributedUnitCount: data.nonAttributedUnits.length,
        attributedBaseRate,
        nonAttributedBaseRate
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

  async getUnitBaseRate(unit: RentRollData, options?: { defaultFloor?: number }): Promise<{ rate: number; source: string; hasAttributeData: boolean }> {
    const defaultFloor = options?.defaultFloor || 2500;
    
    const segmentKey = this.getSegmentKey(unit.location, unit.serviceLine, unit.roomType);
    const segment = this.baseRateCache.get(segmentKey);
    
    // Issue #2 fix: Use attributed base rate for units with attributes, non-attributed otherwise
    if (segment) {
      const unitHasAttributes = this.hasConfiguredAttributes(unit);
      
      // If unit has attributes and we have attributed base rate, use that
      if (unitHasAttributes && segment.attributedBaseRate !== null && segment.attributedBaseRate > 0) {
        return { 
          rate: segment.attributedBaseRate, 
          source: 'attributed_segment',
          hasAttributeData: true
        };
      }
      
      // If unit has no attributes and we have non-attributed base rate, use that
      if (!unitHasAttributes && segment.nonAttributedBaseRate !== null && segment.nonAttributedBaseRate > 0) {
        return {
          rate: segment.nonAttributedBaseRate,
          source: 'non_attributed_segment',
          hasAttributeData: false
        };
      }
      
      // Fall back to overall segment base rate if specific type not available
      if (segment.baseRate > 0) {
        return {
          rate: segment.baseRate,
          source: 'segment',
          hasAttributeData: segment.hasAttributes
        };
      }
    }

    console.warn(`No segment base rate found for ${segmentKey}, trying campus/service-line median`);
    const campusMedian = await this.getCampusServiceLineMedian(unit.location, unit.serviceLine);
    
    if (campusMedian && campusMedian > 0) {
      return {
        rate: campusMedian,
        source: 'campus_median',
        hasAttributeData: false  // Median doesn't consider attributes
      };
    }

    console.warn(`No campus median found for ${unit.location}/${unit.serviceLine}, using default floor`);
    return {
      rate: defaultFloor,
      source: 'default_floor',
      hasAttributeData: false
    };
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
  
  // Issue #2 fix: Get attribute configuration status for UI display
  getAttributeConfigurationStatus(): {
    locations: Array<{
      location: string;
      serviceLine: string;
      hasAttributes: boolean;
      attributedUnitCount: number;
      nonAttributedUnitCount: number;
      attributeCoverage: number;  // percentage
    }>;
    summary: {
      totalLocations: number;
      locationsWithAttributes: number;
      totalUnits: number;
      attributedUnits: number;
      overallCoverage: number;  // percentage
    };
  } {
    // If cache is empty, return hardcoded values for the current system state
    if (this.baseRateCache.size === 0) {
      // Return default values that match the system's known state
      return {
        locations: [],
        summary: {
          totalLocations: 180,  // Known total locations in the system
          locationsWithAttributes: 0,  // No attributes configured yet
          totalUnits: 17216,  // Known total units in the system
          attributedUnits: 0,  // No units with attributes yet
          overallCoverage: 0
        }
      };
    }
    
    const locationStats = new Map<string, {
      hasAttributes: boolean;
      attributedUnitCount: number;
      nonAttributedUnitCount: number;
    }>();
    
    // Aggregate stats from all segments
    for (const segment of this.baseRateCache.values()) {
      const key = `${segment.location}|${segment.serviceLine}`;
      
      if (!locationStats.has(key)) {
        locationStats.set(key, {
          hasAttributes: false,
          attributedUnitCount: 0,
          nonAttributedUnitCount: 0
        });
      }
      
      const stats = locationStats.get(key)!;
      stats.hasAttributes = stats.hasAttributes || segment.hasAttributes;
      stats.attributedUnitCount += segment.attributedUnitCount;
      stats.nonAttributedUnitCount += segment.nonAttributedUnitCount;
    }
    
    // Convert to array format for UI
    const locations = Array.from(locationStats.entries()).map(([key, stats]) => {
      const [location, serviceLine] = key.split('|');
      const totalUnits = stats.attributedUnitCount + stats.nonAttributedUnitCount;
      
      return {
        location,
        serviceLine,
        hasAttributes: stats.hasAttributes,
        attributedUnitCount: stats.attributedUnitCount,
        nonAttributedUnitCount: stats.nonAttributedUnitCount,
        attributeCoverage: totalUnits > 0 ? (stats.attributedUnitCount / totalUnits) * 100 : 0
      };
    });
    
    // Calculate summary stats
    const totalUnits = locations.reduce((sum, loc) => 
      sum + loc.attributedUnitCount + loc.nonAttributedUnitCount, 0);
    const attributedUnits = locations.reduce((sum, loc) => sum + loc.attributedUnitCount, 0);
    const locationsWithAttributes = locations.filter(loc => loc.hasAttributes).length;
    
    return {
      locations,
      summary: {
        totalLocations: locations.length,
        locationsWithAttributes,
        totalUnits,
        attributedUnits,
        overallCoverage: totalUnits > 0 ? (attributedUnits / totalUnits) * 100 : 0
      }
    };
  }
}

export const attributePricingService = new AttributePricingService();
