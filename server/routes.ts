import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { rentRollData, locations, enquireData, adjustmentRanges, guardrails, adjustmentRules } from "@shared/schema";
import { sql, and, eq, gte, lt, or, desc } from "drizzle-orm";
import { pricingAlgorithm, PricingAlgorithm } from "./pricingAlgorithm";
import multer from "multer";
import Papa from "papaparse";
import * as xlsx from "xlsx";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import express from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as fs from 'fs';
import * as cron from 'node-cron';
import { parseNaturalLanguageRule, validateParsedRule } from "./naturalLanguageParser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import OpenAI from "openai";
import { 
  insertRentRollDataSchema, 
  insertAssumptionsSchema, 
  insertPricingWeightsSchema,
  insertCompetitorSchema,
  insertGuardrailsSchema
} from "@shared/schema";
// Demo data imports removed - using production data only
import { roomDetectionService, DetectionStrategy } from "./roomDetectionService";
import { calculateModuloPrice } from "./moduloPricingAlgorithm";
import { getSentenceExplanation, generateOverallExplanation } from "./sentenceExplanations";
import { syncLocationsFromRentRoll } from "./syncLocations";
import { importProductionData } from "./importProductionData";
import { calculateAdjustedCompetitorRate } from "./services/competitorAdjustments";
import { processAllUnitsForCompetitorRates, getCompetitorRateSummary } from "./services/competitorRateMatching";
import { startCompetitorRateJob, getJobStatus, getJobsForMonth, resumeInterruptedJobs } from "./services/competitorRateJobService";
import { calculateAttributedPrice, ensureCacheInitialized, invalidateCache } from "./pricingOrchestrator";
import { attributePricingService } from "./attributePricingService";
import type { PricingInputs } from "./moduloPricingAlgorithm";
import { fetchAndApplyAdjustmentRules } from "./services/adjustmentRulesService";

const upload = multer({ storage: multer.memoryStorage() });

// Building maps storage
let buildingMaps: any[] = [];

// Function to process image and detect room numbers using OCR
async function processImageForRooms(imageBuffer: Buffer): Promise<any[]> {
  try {
    // Preprocess image for better OCR results
    const processedImage = await sharp(imageBuffer)
      .grayscale()
      .normalize()
      .sharpen()
      .jpeg({ quality: 90 })
      .toBuffer();

    // Use Tesseract OCR to detect text
    const { data } = await Tesseract.recognize(processedImage, 'eng', {
      logger: m => console.log('OCR progress:', m)
    });

    const detectedRooms: any[] = [];
    const words = data.words || [];

    // Look for room number patterns (e.g., AL101, MC01, 101, A-101, etc.)
    const roomNumberRegex = /^(AL|MC|[A-Z]{0,2})?-?(\d{2,4}[A-Z]?)$/i;
    
    words.forEach((word) => {
      const text = word.text.trim();
      if (roomNumberRegex.test(text) && word.confidence > 30) {
        // Calculate position as percentage of image dimensions
        const x = ((word.bbox.x0 + word.bbox.x1) / 2 / data.words[0]?.page?.width || 1) * 100;
        const y = ((word.bbox.y0 + word.bbox.y1) / 2 / data.words[0]?.page?.height || 1) * 100;
        
        detectedRooms.push({
          roomNumber: text.toUpperCase(),
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          confidence: word.confidence / 100,
          matched: false
        });
      }
    });

    console.log(`Detected ${detectedRooms.length} potential room numbers:`, 
      detectedRooms.map(r => r.roomNumber));
    
    return detectedRooms;
  } catch (error) {
    console.error("Error processing image for room detection:", error);
    return [];
  }
}

// Cache for S&P 500 data
let marketDataCache = {
  lastMonthReturnPct: 2.3,
  lastFetched: 0,
  currentPrice: 0,
  previousMonthPrice: 0
};

// Fetch real S&P 500 data from Alpha Vantage with database caching
export async function fetchSP500Data() {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.warn("Alpha Vantage API key not found, using mock data");
    return marketDataCache.lastMonthReturnPct;
  }

  // Check database cache first
  const cached = await storage.getCachedStockData('SPY', 'monthly_return');
  if (cached) {
    console.log("Using cached S&P 500 data from database");
    marketDataCache.lastMonthReturnPct = cached.value;
    marketDataCache.currentPrice = (cached.metadata as any)?.currentPrice || 0;
    marketDataCache.previousMonthPrice = (cached.metadata as any)?.previousMonthPrice || 0;
    return cached.value;
  }

  try {
    // Use SPY ETF as S&P 500 proxy (more reliable data)
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=SPY&apikey=${apiKey}`;
    console.log("Fetching fresh S&P 500 data from Alpha Vantage...");
    
    const response = await fetch(url);
    const data = await response.json();

    if (data["Monthly Time Series"]) {
      const timeSeries = data["Monthly Time Series"];
      const dates = Object.keys(timeSeries).sort().reverse();
      
      if (dates.length >= 2) {
        // Get the last two completed months
        const currentMonth = parseFloat(timeSeries[dates[0]]["4. close"]);
        const previousMonth = parseFloat(timeSeries[dates[1]]["4. close"]);
        
        const monthlyReturn = ((currentMonth - previousMonth) / previousMonth) * 100;
        const returnValue = Math.round(monthlyReturn * 100) / 100;
        
        // Cache in database for 24 hours
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await storage.setCachedStockData({
          symbol: 'SPY',
          dataType: 'monthly_return',
          value: returnValue,
          metadata: {
            currentPrice: currentMonth,
            previousMonthPrice: previousMonth,
            fullResponse: data
          },
          expiresAt
        });
        
        marketDataCache.currentPrice = currentMonth;
        marketDataCache.previousMonthPrice = previousMonth;
        marketDataCache.lastMonthReturnPct = returnValue;
        marketDataCache.lastFetched = Date.now();
        
        console.log(`S&P 500 (SPY ETF) Monthly Return: ${returnValue}% (${previousMonth.toFixed(2)} -> ${currentMonth.toFixed(2)}) - Cached for 24 hours`);
      }
    } else if (data["Note"]) {
      console.warn("Alpha Vantage API limit reached:", data["Note"]);
    } else if (data["Error Message"]) {
      console.error("Alpha Vantage API error:", data["Error Message"]);
    }
  } catch (error) {
    console.error("Failed to fetch S&P 500 data:", error);
  }

  return marketDataCache.lastMonthReturnPct;
}

// Check if database needs initialization on startup
async function checkAndInitializeDatabase() {
  try {
    const unitCount = await storage.getTotalUnits();
    console.log(`Database has ${unitCount} units`);
    
    // Only initialize if database is completely empty
    if (unitCount === 0) {
      console.log('⚠️  Database is empty. Please import production data via POST /api/admin/import-production-data');
    }
    
    // Location sync is now only done when rent roll data is uploaded, not on every startup
    // This saves 50+ seconds on startup by avoiding 544+ database queries
  } catch (error) {
    console.error('Error checking/initializing database:', error);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize database on startup if needed
  await checkAndInitializeDatabase();
  
  // Serve attached assets statically
  app.use('/attached_assets', express.static(path.resolve('attached_assets')));
  
  // Mock auth user endpoint (no authentication required)
  app.get('/api/auth/user', async (req: any, res) => {
    res.json({
      id: 'demo-user',
      email: 'demo@example.com',
      firstName: 'Demo',
      lastName: 'User'
    });
  });
  
  // Test endpoint to verify competitor distances
  app.get('/api/test/competitor-distances', async (req, res) => {
    try {
      const competitors = await storage.getCompetitors();
      const locations = await storage.getLocations();
      
      const distanceReport = locations.map(location => {
        const locationCompetitors = competitors.filter(c => c.location === location.name);
        return {
          location: location.name,
          competitors: locationCompetitors.map(comp => ({
            name: comp.name,
            distance_miles: comp.attributes?.distance_miles || 'N/A',
            drive_time_minutes: comp.attributes?.drive_time_minutes || 'N/A',
            rating: comp.rating
          }))
        };
      });
      
      res.json({ report: distanceReport, totalCompetitors: competitors.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate distance report' });
    }
  });
  
  // Endpoint to fix competitor rates in the database directly
  app.post('/api/admin/fix-competitor-rates', async (req, res) => {
    try {
      console.log('🔧 Fixing competitor rates in database...');
      
      const { fixCompetitorRates } = await import('./fixCompetitorRates');
      const result = await fixCompetitorRates();
      
      // After fixing the database, trigger recalculation
      console.log('📊 Now recalculating competitor rates for rent roll...');
      const { processAllUnitsForCompetitorRates } = await import('./services/competitorRateMatching');
      
      // Process only the latest month for efficiency
      const latestMonth = '2025-11';
      const matchingStats = await processAllUnitsForCompetitorRates(latestMonth);
      
      res.json({
        success: true,
        message: 'Competitor rates fixed successfully',
        fixResults: result,
        recalculationStats: {
          processed: matchingStats.processed,
          updated: matchingStats.updated,
          errors: matchingStats.errors
        }
      });
      
    } catch (error) {
      console.error('Error fixing competitor rates:', error);
      res.status(500).json({
        error: 'Failed to fix competitor rates',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // Endpoint to recalculate competitor rates with fixed daily-to-monthly conversion
  app.post('/api/admin/recalculate-competitor-rates', async (req, res) => {
    try {
      console.log('🔄 Starting competitor rate recalculation with fixed conversion logic...');
      
      // Get optional filters from request
      const { location, serviceLine, uploadMonth } = req.body;
      
      // Import the processing function
      const { processAllUnitsForCompetitorRates } = await import('./services/competitorRateMatching');
      
      // Build filter conditions
      const conditions: any[] = [];
      if (location) {
        conditions.push(eq(rentRollData.location, location));
        console.log(`Filtering by location: ${location}`);
      }
      if (serviceLine) {
        conditions.push(eq(rentRollData.serviceLine, serviceLine));
        console.log(`Filtering by service line: ${serviceLine}`);
      }
      if (uploadMonth) {
        conditions.push(eq(rentRollData.uploadMonth, uploadMonth));
        console.log(`Filtering by upload month: ${uploadMonth}`);
      }
      
      // Get units to process
      const unitsQuery = conditions.length > 0 
        ? db.select().from(rentRollData).where(and(...conditions))
        : db.select().from(rentRollData);
        
      const units = await unitsQuery;
      console.log(`Found ${units.length} units to process`);
      
      // Process in batches to avoid overwhelming the system
      const batchSize = 100;
      let totalProcessed = 0;
      let totalUpdated = 0;
      let totalErrors = 0;
      const updates: any[] = [];
      
      for (let i = 0; i < units.length; i += batchSize) {
        const batch = units.slice(i, i + batchSize);
        console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(units.length/batchSize)}`);
        
        // Process this batch
        const stats = await processAllUnitsForCompetitorRates(uploadMonth || null);
        totalProcessed += stats.processed;
        totalUpdated += stats.updated;
        totalErrors += stats.errors;
        
        // Track updates for response
        if (stats.updates && stats.updates.length > 0) {
          updates.push(...stats.updates);
        }
      }
      
      // Get summary of changes
      const changedUnits = await db.select({
        location: rentRollData.location,
        serviceLine: rentRollData.serviceLine,
        roomType: rentRollData.roomType,
        competitorRate: rentRollData.competitorRate,
        competitorFinalRate: rentRollData.competitorFinalRate
      })
      .from(rentRollData)
      .where(and(
        sql`${rentRollData.competitorRate} IS NOT NULL`,
        sql`${rentRollData.competitorRate} > 0`
      ))
      .limit(20);
      
      console.log('✅ Competitor rate recalculation complete');
      
      res.json({
        success: true,
        message: 'Competitor rates recalculated with fixed daily-to-monthly conversion',
        stats: {
          totalUnits: units.length,
          processed: totalProcessed,
          updated: totalUpdated,
          errors: totalErrors
        },
        conversionRules: {
          HC: 'Rates < $1000 converted from daily to monthly (×30.44)',
          SMC: 'Rates < $1000 converted from daily to monthly (×30.44)',
          AL: 'Rates < $500 converted from daily to monthly (×30.44)',
          SL: 'Rates < $500 converted from daily to monthly (×30.44)',
          VIL: 'Rates < $500 converted from daily to monthly (×30.44)'
        },
        sampleUpdates: changedUnits.slice(0, 10),
        filters: { location, serviceLine, uploadMonth }
      });
      
    } catch (error) {
      console.error('Error recalculating competitor rates:', error);
      res.status(500).json({ 
        error: 'Failed to recalculate competitor rates',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Re-seed database with updated occupancy rates
  app.post('/api/admin/reseed-database', async (req, res) => {
    try {
      console.log('Manually re-seeding database with updated occupancy rates...');
      const { seedTrilogyRentRoll } = await import('./seedTrilogyRentRoll');
      await seedTrilogyRentRoll();
      
      const unitCount = await storage.getTotalUnits();
      console.log(`Database re-seeded successfully with ${unitCount} units`);
      
      res.json({ 
        success: true, 
        message: `Database re-seeded with ${unitCount} units using updated occupancy rates`,
        occupancyRates: {
          HC: '90%',
          AL: '92%',
          IL: '93%',
          secondCampus: 'Low occupancy (60-65%)'
        }
      });
    } catch (error) {
      console.error('Error re-seeding database:', error);
      res.status(500).json({ error: 'Failed to re-seed database' });
    }
  });

  // Re-seed competitor data with updated market positioning
  app.post('/api/admin/reseed-competitors', async (req, res) => {
    try {
      console.log('Manually re-seeding competitor data with updated market positioning...');
      const { seedCompetitorData } = await import('./seedCompetitorData');
      await seedCompetitorData();
      
      const competitors = await storage.getCompetitors();
      console.log(`Competitor data re-seeded successfully with ${competitors.length} competitors`);
      
      res.json({ 
        success: true, 
        message: `Competitor data re-seeded with ${competitors.length} competitors`,
        marketPosition: 'Target: 18% average (22% North, 14% South)'
      });
    } catch (error) {
      console.error('Error re-seeding competitor data:', error);
      res.status(500).json({ error: 'Failed to re-seed competitor data' });
    }
  });

  // Sync locations from rent roll data
  app.post('/api/admin/sync-locations', async (req, res) => {
    try {
      console.log('Syncing locations from rent roll data...');
      const result = await syncLocationsFromRentRoll();
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `Locations synced successfully: ${result.created} created, ${result.updated} updated`,
          ...result
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: result.error || 'Failed to sync locations'
        });
      }
    } catch (error) {
      console.error('Error syncing locations:', error);
      res.status(500).json({ error: 'Failed to sync locations' });
    }
  });

  // Import production data from attached assets
  app.post('/api/admin/import-production-data', async (req, res) => {
    try {
      console.log('Importing production data from attached assets...');
      const result = await importProductionData();
      
      if (result.success) {
        // After import, sync locations
        await syncLocationsFromRentRoll();
        
        res.json({ 
          success: true, 
          message: result.message
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: result.error || 'Failed to import production data'
        });
      }
    } catch (error) {
      console.error('Error importing production data:', error);
      res.status(500).json({ error: 'Failed to import production data' });
    }
  });
  
  // Test endpoint: Import only competitive survey data
  app.post('/api/admin/import-competitive-survey-only', async (req, res) => {
    try {
      console.log('Importing competitive survey only (test endpoint)...');
      const { importCompetitiveSurveyOnly } = await import('./importProductionData');
      const result = await importCompetitiveSurveyOnly();
      res.json(result);
    } catch (error) {
      console.error('Error importing competitive survey:', error);
      res.status(500).json({ error: 'Failed to import competitive survey', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
  
  // Status endpoint - get dashboard overview
  app.get("/api/status", async (req, res) => {
    try {
      const rentRollData = await storage.getRentRollData();
      const assumptions = await storage.getCurrentAssumptions();
      const weights = await storage.getCurrentWeights();
      
      const startingRevenue = rentRollData.reduce((sum, unit) => sum + (unit.baseRent + (unit.careFee || 0)), 0);
      const occupiedUnits = rentRollData.filter(unit => unit.occupiedYN).length;
      const occupancy = rentRollData.length > 0 ? occupiedUnits / rentRollData.length : 0;

      res.json({
        starting_revenue: startingRevenue,
        occupancy,
        assumptions: assumptions ? {
          start_period: assumptions.startPeriod,
          months: assumptions.months,
          revenue_monthly_growth_pct: assumptions.revenueMonthlyGrowthPct,
          sp500_monthly_return_pct: assumptions.sp500MonthlyReturnPct,
          target_occupancy: assumptions.targetOccupancy
        } : null,
        weights: weights ? {
          occupancy_pressure: weights.occupancyPressure,
          days_vacant_decay: weights.daysVacantDecay,
          seasonality: weights.seasonality,
          competitor_rates: weights.competitorRates,
          stock_market: weights.stockMarket,
          inquiry_tour_volume: weights.inquiryTourVolume || 0
        } : null
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get status" });
    }
  });

  // Upload rent roll CSV
  // Unified template download endpoint
  app.get("/api/template/unified", async (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      
      // Single unified template with all data combined
      const unifiedTemplate = [
        {
          Date: '2024-01-31',
          Region: 'East',
          Division: 'Mid-Atlantic',
          Location: 'Louisville East',
          'Room Number': '101',
          'Room Type': 'Studio',
          'Service Line': 'AL',
          'Occupied Y/N': 'Y',
          'Days Vacant': 0,
          'Preferred Location': 'Y',
          Size: 'Studio',
          View: 'Garden View',
          Renovated: 'Y',
          'Other Premium Feature': '',
          'Location Rating': 'A',
          'Size Rating': 'B',
          'View Rating': 'A',
          'Renovation Rating': 'A',
          'Amenity Rating': 'B',
          'Street Rate': 3500,
          'In-House Rate': 3200,
          'Discount to Street Rate': 300,
          'Care Level': 'Level 1',
          'Care Rate': 500,
          'Rent and Care Rate': 3700,
          'Competitor Rate': 3600,
          'Competitor Average Care Rate': 450,
          'Competitor Final Rate': 4050,
          'Modulo Suggested Rate': 3650,
          'AI Suggested Rate': 3700,
          'Promotion Allowance': 100,
          Census: 85,
          'Occupancy %': 88.5,
          'Move-ins': 5,
          'Move-outs': 3,
          Revenue: 425000,
          RevPAR: 5000,
          RevPOR: 5650,
          ADR: 4200,
          'Budget Revenue': 420000,
          'Budget RevPOR': 5600,
          'Budget ADR': 4150,
          'Market Rate': 3550
        },
        {
          Date: '2024-01-31',
          Region: 'East',
          Division: 'Mid-Atlantic',
          Location: 'Louisville East',
          'Room Number': '102',
          'Room Type': '1 Bedroom',
          'Service Line': 'AL',
          'Occupied Y/N': 'N',
          'Days Vacant': 15,
          'Preferred Location': 'N',
          Size: '1 Bedroom',
          View: 'Courtyard View',
          Renovated: 'N',
          'Other Premium Feature': 'Balcony',
          'Location Rating': 'B',
          'Size Rating': 'A',
          'View Rating': 'B',
          'Renovation Rating': 'C',
          'Amenity Rating': 'A',
          'Street Rate': 4200,
          'In-House Rate': 3800,
          'Discount to Street Rate': 400,
          'Care Level': 'Level 2',
          'Care Rate': 750,
          'Rent and Care Rate': 4550,
          'Competitor Rate': 4100,
          'Competitor Average Care Rate': 700,
          'Competitor Final Rate': 4800,
          'Modulo Suggested Rate': 4050,
          'AI Suggested Rate': 4150,
          'Promotion Allowance': 200,
          Census: 42,
          'Occupancy %': 95.5,
          'Move-ins': 2,
          'Move-outs': 1,
          Revenue: 115000,
          RevPAR: 2738,
          RevPOR: 2865,
          ADR: 2600,
          'Budget Revenue': 112000,
          'Budget RevPOR': 2800,
          'Budget ADR': 2650,
          'Market Rate': 2750
        },
        {
          Date: '2024-01-31',
          Region: 'Central',
          Division: 'Ohio Valley',
          Location: 'Creasy Springs',
          'Room Number': '201',
          'Room Type': 'Studio',
          'Service Line': 'HC',
          'Occupied Y/N': 'Y',
          'Days Vacant': 0,
          'Preferred Location': 'Y',
          Size: 'Studio',
          View: 'Park View',
          Renovated: 'Y',
          'Other Premium Feature': 'Corner Unit',
          'Location Rating': 'A',
          'Size Rating': 'B',
          'View Rating': 'A',
          'Renovation Rating': 'A',
          'Amenity Rating': 'A',
          'Street Rate': 4800,
          'In-House Rate': 4400,
          'Discount to Street Rate': 400,
          'Care Level': 'Level 3',
          'Care Rate': 1200,
          'Rent and Care Rate': 5600,
          'Competitor Rate': 4900,
          'Competitor Average Care Rate': 1100,
          'Competitor Final Rate': 6000,
          'Modulo Suggested Rate': 4750,
          'AI Suggested Rate': 4850,
          'Promotion Allowance': 150,
          Census: 38,
          'Occupancy %': 84.4,
          'Move-ins': 3,
          'Move-outs': 4,
          Revenue: 285000,
          RevPAR: 7500,
          RevPOR: 8895,
          ADR: 5600,
          'Budget Revenue': 290000,
          'Budget RevPOR': 9000,
          'Budget ADR': 5750,
          'Market Rate': 4900
        },
        {
          Date: '2024-01-31',
          Region: 'Central',
          Division: 'Ohio Valley',
          Location: 'Creasy Springs',
          'Room Number': '202',
          'Room Type': '2 Bedroom',
          'Service Line': 'SL',
          'Occupied Y/N': 'Y',
          'Days Vacant': 0,
          'Preferred Location': 'Y',
          Size: '2 Bedroom',
          View: 'Garden View',
          Renovated: 'N',
          'Other Premium Feature': 'Kitchen Upgrade',
          'Location Rating': 'A',
          'Size Rating': 'A',
          'View Rating': 'A',
          'Renovation Rating': 'B',
          'Amenity Rating': 'A',
          'Street Rate': 2800,
          'In-House Rate': 2600,
          'Discount to Street Rate': 200,
          'Care Level': 'Independent',
          'Care Rate': 0,
          'Rent and Care Rate': 2600,
          'Competitor Rate': 2750,
          'Competitor Average Care Rate': 0,
          'Competitor Final Rate': 2750,
          'Modulo Suggested Rate': 2700,
          'AI Suggested Rate': 2750,
          'Promotion Allowance': 100,
          Census: 65,
          'Occupancy %': 92.9,
          'Move-ins': 4,
          'Move-outs': 2,
          Revenue: 170000,
          RevPAR: 2429,
          RevPOR: 2615,
          ADR: 2600,
          'Budget Revenue': 168000,
          'Budget RevPOR': 2600,
          'Budget ADR': 2580,
          'Market Rate': 2750
        }
      ];
      
      // Create single worksheet
      const unifiedSheet = xlsx.utils.json_to_sheet(unifiedTemplate);
      
      // Add worksheet to workbook
      xlsx.utils.book_append_sheet(workbook, unifiedSheet, 'Portfolio Data');
      
      // Generate buffer
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="unified_portfolio_template.xlsx"');
      res.send(buffer);
    } catch (error) {
      console.error("Error generating unified template:", error);
      res.status(500).json({ error: "Failed to generate template" });
    }
  });

  // Rent Roll template download endpoint
  app.get("/api/template/rent-roll", async (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      
      const rentRollTemplate = [
        {
          Date: '2024-01-31',
          Region: 'East',
          Division: 'Mid-Atlantic',
          Location: 'Louisville East',
          'Room Number': '101',
          'Room Type': 'Studio',
          'Service Line': 'AL',
          'Occupied Y/N': 'Y',
          'Days Vacant': 0,
          'Preferred Location': 'Y',
          Size: 'Studio',
          View: 'Garden View',
          Renovated: 'Y',
          'Other Premium Feature': '',
          'Location Rating': 'A',
          'Size Rating': 'B',
          'View Rating': 'A',
          'Renovation Rating': 'A',
          'Amenity Rating': 'B',
          'Street Rate': 3500,
          'In-House Rate': 3200,
          'Discount to Street Rate': 300,
          'Care Level': 'Level 1',
          'Care Rate': 500,
          'Rent and Care Rate': 3700
        }
      ];
      
      const sheet = xlsx.utils.json_to_sheet(rentRollTemplate);
      xlsx.utils.book_append_sheet(workbook, sheet, 'Rent Roll');
      
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="rent_roll_template.xlsx"');
      res.send(buffer);
    } catch (error) {
      console.error("Error generating rent roll template:", error);
      res.status(500).json({ error: "Failed to generate template" });
    }
  });

  // Inquiry Data template download endpoint
  app.get("/api/template/inquiry", async (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      
      const inquiryTemplate = [
        {
          Date: '2024-01-31',
          Region: 'East',
          Division: 'Mid-Atlantic',
          Location: 'Louisville East',
          'Service Line': 'AL',
          'Lead Source': 'Website',
          'Inquiry Count': 15,
          'Tour Count': 8,
          'Conversion Count': 3,
          'Conversion Rate': 37.5,
          'Days to Tour': 5,
          'Days to Move-In': 21
        }
      ];
      
      const sheet = xlsx.utils.json_to_sheet(inquiryTemplate);
      xlsx.utils.book_append_sheet(workbook, sheet, 'Inquiry Data');
      
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="inquiry_data_template.xlsx"');
      res.send(buffer);
    } catch (error) {
      console.error("Error generating inquiry template:", error);
      res.status(500).json({ error: "Failed to generate template" });
    }
  });

  // Competitive Survey Data template download endpoint
  app.get("/api/template/competitor", async (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      
      // Template matches the importCompetitiveSurveyExcel expected format
      const competitorTemplate = [
        {
          'KeyStats Location': 'Anderson - 112',
          'Competitor Name': 'Sunrise Senior Living',
          'Competitor Address': '123 Main Street, Louisville, KY 40202',
          'Distance (Miles)': 2.5,
          'Competitor Type': 'AL',
          'Room Type': 'Studio',
          'Square Footage': 350,
          'Monthly Rate Low': 3200,
          'Monthly Rate High': 3800,
          'Monthly Rate Avg': 3500,
          'Care Fees Low': 400,
          'Care Fees High': 800,
          'Care Fees Avg': 600,
          'Total Monthly Low': 3600,
          'Total Monthly High': 4600,
          'Total Monthly Avg': 4100,
          'Community Fee': 500,
          'Pet Fee': 50,
          'Other Fees': 0,
          'Incentives': 'First month free',
          'Total Units': 85,
          'Occupancy Rate': 92.5,
          'Year Built': 2015,
          'Last Renovation': 2020,
          'Amenities': 'Pool, Fitness Center, Beauty Salon',
          'Notes': 'Competitor offers memory care in separate building'
        }
      ];
      
      const sheet = xlsx.utils.json_to_sheet(competitorTemplate);
      xlsx.utils.book_append_sheet(workbook, sheet, 'Competitive Survey');
      
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="competitive_survey_template.xlsx"');
      res.send(buffer);
    } catch (error) {
      console.error("Error generating competitive survey template:", error);
      res.status(500).json({ error: "Failed to generate template" });
    }
  });

  // Unified upload endpoint
  app.post("/api/upload/unified", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      
      let rentRollRecords = 0;
      let competitorRecords = 0;
      let targetsRecords = 0;
      
      // Process unified Portfolio Data sheet
      if (workbook.SheetNames.includes('Portfolio Data')) {
        const portfolioSheet = workbook.Sheets['Portfolio Data'];
        const portfolioData = xlsx.utils.sheet_to_json(portfolioSheet);
        
        // Clear existing data
        await storage.clearRentRollData();
        
        // Process each row (contains rent roll + performance data combined)
        for (const row of portfolioData as any[]) {
          const locationName = row.Location || 'Unknown';
          
          // Create or update location with region and division
          const location = await storage.createOrUpdateLocation({
            name: locationName,
            region: row.Region || null,
            division: row.Division || null,
            totalUnits: 1,
          });
          
          // Insert rent roll data with all combined fields
          await storage.createRentRollData({
            uploadMonth: new Date().toISOString().slice(0, 7),
            date: row.Date || new Date().toISOString().split('T')[0],
            location: locationName,
            locationId: location.id,
            roomNumber: row['Room Number'] || '',
            roomType: row['Room Type'] || 'Studio',
            serviceLine: row['Service Line'] || 'AL',
            occupiedYN: row['Occupied Y/N'] === 'Y',
            daysVacant: parseInt(row['Days Vacant']) || 0,
            preferredLocation: row['Preferred Location'],
            size: row.Size || 'Studio',
            view: row.View,
            renovated: row.Renovated === 'Y',
            otherPremiumFeature: row['Other Premium Feature'],
            locationRating: row['Location Rating'],
            sizeRating: row['Size Rating'],
            viewRating: row['View Rating'],
            renovationRating: row['Renovation Rating'],
            amenityRating: row['Amenity Rating'],
            streetRate: parseFloat(row['Street Rate']) || 0,
            inHouseRate: parseFloat(row['In-House Rate']) || 0,
            discountToStreetRate: parseFloat(row['Discount to Street Rate']) || 0,
            careLevel: row['Care Level'],
            careRate: parseFloat(row['Care Rate']) || 0,
            rentAndCareRate: parseFloat(row['Rent and Care Rate']) || 0,
            competitorRate: parseFloat(row['Competitor Rate']) || 0,
            competitorAvgCareRate: parseFloat(row['Competitor Average Care Rate']) || 0,
            competitorFinalRate: parseFloat(row['Competitor Final Rate']) || 0,
            moduloSuggestedRate: parseFloat(row['Modulo Suggested Rate']) || 0,
            aiSuggestedRate: parseFloat(row['AI Suggested Rate']) || 0,
            promotionAllowance: parseFloat(row['Promotion Allowance']) || 0,
          });
          
          rentRollRecords++;
          
          // If row contains performance data, create targets & trends record
          if (row.Census || row['Occupancy %'] || row.Revenue) {
            await storage.createTargetsAndTrends({
              month: row.Date ? new Date(row.Date).toISOString().slice(0, 7) : new Date().toISOString().slice(0, 7),
              region: '',
              division: '',
              campus: locationName,
              serviceLine: row['Service Line'] || 'AL',
              budgetedOccupancy: parseFloat(row['Occupancy %']) || null,
              budgetedRate: parseFloat(row['Budget ADR']) || null,
              roomRateAdjustment: null,
              roomRateAdjustmentNote: '',
              budgetedRevPOR: parseFloat(row['Budget RevPOR']) || null,
              communityFeeCollection: null,
              inquiries: 0,
              tours: 0,
              moveIns: parseInt(row['Move-ins']) || 0,
              avgDaysToMoveIn: null,
              notes: '',
              locationId: location.id,
            });
            
            targetsRecords++;
          }
        }
      }
      
      res.json({
        ok: true,
        rentRollRecords,
        competitorRecords,
        targetsRecords,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error processing unified upload:", error);
      res.status(500).json({ error: "Failed to process unified upload" });
    }
  });

  app.post("/api/upload_rent_roll", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const csvText = req.file.buffer.toString();
      const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      
      if (results.errors.length > 0) {
        return res.status(400).json({ error: "CSV parsing failed", details: results.errors });
      }

      // Clear existing data
      await storage.clearRentRollData();

      // Process and validate each row
      let processedRows = 0;
      for (const row of results.data as any[]) {
        try {
          const validatedData = insertRentRollDataSchema.parse({
            unitId: row.Unit_ID || row.unit_id,
            occupiedYN: row.Occupied_YN === 'Y' || row.Occupied_YN === 'Yes' || row.occupied_yn === true,
            baseRent: parseFloat(row.Base_Rent || row.base_rent),
            careFee: row.Care_Fee ? parseFloat(row.Care_Fee) : null,
            roomType: row.Room_Type || row.room_type,
            competitorBenchmarkRate: row.Competitor_Benchmark_Rate ? parseFloat(row.Competitor_Benchmark_Rate) : null,
            competitorAvgCareRate: row.Competitor_Avg_Care_Rate ? parseFloat(row.Competitor_Avg_Care_Rate) : null,
            daysVacant: row.Days_Vacant ? parseInt(row.Days_Vacant) : 0,
            attributes: row.Attributes ? JSON.parse(row.Attributes) : null
          });
          
          await storage.createRentRollData(validatedData);
          processedRows++;
        } catch (error) {
          console.warn(`Skipping invalid row: ${error}`);
        }
      }

      res.json({ rows: processedRows });
    } catch (error) {
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // Assumptions CRUD
  app.post("/api/assumptions", async (req, res) => {
    try {
      const validatedData = insertAssumptionsSchema.parse(req.body);
      const assumptions = await storage.createOrUpdateAssumptions(validatedData);
      res.json({ ok: true, assumptions });
    } catch (error) {
      res.status(400).json({ error: "Invalid assumptions data" });
    }
  });

  // Pricing weights CRUD
  app.get("/api/weights", async (req, res) => {
    try {
      const locationId = req.query.locationId as string | undefined;
      const serviceLine = req.query.serviceLine as string | undefined;
      
      let weights;
      if (locationId || serviceLine) {
        weights = await storage.getWeightsByFilter(locationId, serviceLine);
      } else {
        weights = await storage.getPricingWeights();
      }
      
      if (!weights) {
        weights = await storage.getPricingWeights();
      }
      
      if (!weights) {
        return res.status(404).json({ error: "No weights found" });
      }
      
      res.json({
        ok: true,
        weights: {
          id: weights.id,
          location_id: weights.locationId,
          service_line: weights.serviceLine,
          enable_weights: weights.enableWeights,
          occupancy_pressure: weights.occupancyPressure,
          days_vacant_decay: weights.daysVacantDecay,
          seasonality: weights.seasonality,
          competitor_rates: weights.competitorRates,
          stock_market: weights.stockMarket,
          inquiry_tour_volume: weights.inquiryTourVolume || 0
        }
      });
    } catch (error) {
      console.error("Error fetching weights:", error);
      res.status(500).json({ error: "Failed to fetch weights" });
    }
  });

  app.post("/api/weights", async (req, res) => {
    try {
      const locationId = req.body.location_id || req.query.locationId as string | undefined;
      const serviceLine = req.body.service_line || req.query.serviceLine as string | undefined;
      const applyToAllServiceLines = req.body.apply_to_all_service_lines === true;
      
      const transformedData = {
        enableWeights: req.body.enable_weights !== undefined ? req.body.enable_weights : true,
        occupancyPressure: req.body.occupancy_pressure,
        daysVacantDecay: req.body.days_vacant_decay,
        seasonality: req.body.seasonality,
        competitorRates: req.body.competitor_rates,
        stockMarket: req.body.stock_market,
        inquiryTourVolume: req.body.inquiry_tour_volume || 0,
      };
      
      const total = transformedData.occupancyPressure + transformedData.daysVacantDecay + 
                    transformedData.seasonality + 
                    transformedData.competitorRates + transformedData.stockMarket + 
                    transformedData.inquiryTourVolume;
      
      if (total !== 100) {
        return res.status(400).json({ error: `Weights must total 100%, currently ${total}%` });
      }
      
      const validatedData = insertPricingWeightsSchema.parse(transformedData);
      
      if (applyToAllServiceLines && locationId) {
        const serviceLines = ['AL', 'HC', 'AL/MC', 'HC/MC', 'SL', 'VIL'];
        const weightsList = serviceLines.map(sl => ({
          ...validatedData,
          locationId,
          serviceLine: sl
        }));
        
        await storage.bulkCreateOrUpdateWeights(weightsList);
        
        return res.json({ 
          ok: true, 
          message: `Weights saved for all service lines at location ${locationId}`,
          count: serviceLines.length
        });
      }
      
      const weights = await storage.createOrUpdateWeightsByFilter(validatedData, locationId, serviceLine);
      
      res.json({ 
        ok: true, 
        weights: {
          id: weights.id,
          location_id: weights.locationId,
          service_line: weights.serviceLine,
          enable_weights: weights.enableWeights,
          occupancy_pressure: weights.occupancyPressure,
          days_vacant_decay: weights.daysVacantDecay,
          seasonality: weights.seasonality,
          competitor_rates: weights.competitorRates,
          stock_market: weights.stockMarket,
          inquiry_tour_volume: weights.inquiryTourVolume || 0
        }
      });
    } catch (error) {
      res.status(400).json({ error: "Invalid weights data" });
    }
  });

  // Adjustment ranges endpoints
  app.get("/api/adjustment-ranges", async (req, res) => {
    try {
      const { locationId, serviceLine } = req.query;
      
      // 3-tier fallback: specific → location-only → global
      let ranges;
      
      // Try location + serviceLine specific
      if (locationId && serviceLine) {
        [ranges] = await db.select().from(adjustmentRanges)
          .where(and(
            eq(adjustmentRanges.locationId, locationId as string),
            eq(adjustmentRanges.serviceLine, serviceLine as string)
          ))
          .limit(1);
      }
      
      // Fall back to location-only (serviceLine=NULL)
      if (!ranges && locationId) {
        [ranges] = await db.select().from(adjustmentRanges)
          .where(and(
            eq(adjustmentRanges.locationId, locationId as string),
            sql`${adjustmentRanges.serviceLine} IS NULL`
          ))
          .limit(1);
      }
      
      // Fall back to global default (both NULL)
      if (!ranges) {
        [ranges] = await db.select().from(adjustmentRanges)
          .where(and(
            sql`${adjustmentRanges.locationId} IS NULL`,
            sql`${adjustmentRanges.serviceLine} IS NULL`
          ))
          .limit(1);
      }
      
      if (ranges) {
        res.json(ranges);
      } else {
        // Return default ranges if none exist in database
        const defaultRanges = {
          occupancyMin: -0.10,
          occupancyMax: 0.05,
          vacancyMin: -0.15,
          vacancyMax: 0.00,
          attributesMin: -0.05,
          attributesMax: 0.10,
          seasonalityMin: -0.05,
          seasonalityMax: 0.10,
          competitorMin: -0.10,
          competitorMax: 0.10,
          marketMin: -0.05,
          marketMax: 0.05,
        };
        res.json(defaultRanges);
      }
    } catch (error) {
      console.error('Error fetching adjustment ranges:', error);
      res.status(500).json({ error: 'Failed to fetch adjustment ranges' });
    }
  });

  app.put("/api/adjustment-ranges", async (req, res) => {
    try {
      const { locationId, serviceLine, id, createdAt, updatedAt, ...rangeData } = req.body;
      
      // Delete existing entry for this scope
      if (locationId && serviceLine) {
        await db.delete(adjustmentRanges).where(and(
          eq(adjustmentRanges.locationId, locationId),
          eq(adjustmentRanges.serviceLine, serviceLine)
        ));
      } else if (locationId) {
        await db.delete(adjustmentRanges).where(and(
          eq(adjustmentRanges.locationId, locationId),
          sql`${adjustmentRanges.serviceLine} IS NULL`
        ));
      } else {
        await db.delete(adjustmentRanges).where(and(
          sql`${adjustmentRanges.locationId} IS NULL`,
          sql`${adjustmentRanges.serviceLine} IS NULL`
        ));
      }
      
      // Insert new values (timestamps are auto-generated)
      const [newRanges] = await db.insert(adjustmentRanges).values({
        locationId: locationId || null,
        serviceLine: serviceLine || null,
        ...rangeData
      }).returning();
      
      res.json(newRanges);
    } catch (error) {
      console.error('Error updating adjustment ranges:', error);
      res.status(500).json({ error: 'Failed to update adjustment ranges' });
    }
  });

  app.put("/api/adjustment-ranges-old", async (req, res) => {
    try {
      const { insertAdjustmentRangesSchema } = await import('@shared/schema');
      const validatedData = insertAdjustmentRangesSchema.parse(req.body);
      await storage.createOrUpdateAdjustmentRanges(validatedData);
      res.json({ ok: true });
    } catch (error) {
      console.error('Error updating adjustment ranges:', error);
      res.status(400).json({ error: 'Invalid adjustment ranges data' });
    }
  });

  // AI-specific pricing weights endpoints
  app.get("/api/ai-pricing-weights", async (req, res) => {
    try {
      const weights = await storage.getAiPricingWeights();
      if (weights) {
        res.json(weights);
      } else {
        // Return default AI weights if none exist
        res.json({
          occupancyPressure: 20,
          daysVacantDecay: 20,
          competitorRates: 15,
          seasonality: 15,
          stockMarket: 15
        });
      }
    } catch (error) {
      console.error('Error fetching AI pricing weights:', error);
      res.status(500).json({ error: 'Failed to fetch AI pricing weights' });
    }
  });

  app.put("/api/ai-pricing-weights", async (req, res) => {
    try {
      const { insertAiPricingWeightsSchema } = await import('@shared/schema');
      const validatedData = insertAiPricingWeightsSchema.parse(req.body);
      const weights = await storage.createOrUpdateAiPricingWeights(validatedData);
      res.json(weights);
    } catch (error) {
      console.error('Error updating AI pricing weights:', error);
      res.status(400).json({ error: 'Invalid AI pricing weights data' });
    }
  });

  // AI-specific adjustment ranges endpoints  
  app.get("/api/ai-adjustment-ranges", async (req, res) => {
    try {
      const ranges = await storage.getAiAdjustmentRanges();
      if (ranges) {
        res.json(ranges);
      } else {
        // Return default AI ranges if none exist
        res.json({
          occupancyMin: -0.15,
          occupancyMax: 0.15,
          vacancyMin: -0.30,
          vacancyMax: 0.00,
          attributesMin: 0.00,
          attributesMax: 0.20,
          competitorMin: -0.15,
          competitorMax: 0.15,
          seasonalMin: -0.08,
          seasonalMax: 0.08,
          marketMin: 0.00,
          marketMax: 0.05
        });
      }
    } catch (error) {
      console.error('Error fetching AI adjustment ranges:', error);
      res.status(500).json({ error: 'Failed to fetch AI adjustment ranges' });
    }
  });

  app.put("/api/ai-adjustment-ranges", async (req, res) => {
    try {
      const { insertAiAdjustmentRangesSchema } = await import('@shared/schema');
      const validatedData = insertAiAdjustmentRangesSchema.parse(req.body);
      const ranges = await storage.createOrUpdateAiAdjustmentRanges(validatedData);
      res.json(ranges);
    } catch (error) {
      console.error('Error updating AI adjustment ranges:', error);
      res.status(400).json({ error: 'Invalid AI adjustment ranges data' });
    }
  });

  // Building maps endpoints
  app.get("/api/building-maps", async (req, res) => {
    res.json({ items: buildingMaps });
  });

  app.post("/api/upload-building-map", upload.single("buildingMap"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileId = Date.now().toString();
      const imageUrl = `/api/building-maps/${fileId}/image`;
      
      // Process image with OCR to detect room numbers
      const detectedRooms = await processImageForRooms(req.file.buffer);
      
      // Match detected rooms with rent roll data
      const rentRollData = await storage.getRentRollData();
      const matchedRooms = detectedRooms.map(room => {
        const match = rentRollData.find(unit => 
          unit.unitId.toLowerCase().includes(room.roomNumber.toLowerCase()) ||
          room.roomNumber.toLowerCase().includes(unit.unitId.toLowerCase())
        );
        return {
          ...room,
          matched: !!match,
          rentData: match
        };
      });

      const buildingMap = {
        id: fileId,
        filename: req.file.originalname,
        imageUrl,
        detectedRooms: matchedRooms,
        createdAt: new Date().toISOString(),
        imageBuffer: req.file.buffer
      };

      buildingMaps.push(buildingMap);

      res.json({
        id: fileId,
        filename: req.file.originalname,
        roomsDetected: matchedRooms.length,
        matchedRooms: matchedRooms.filter(r => r.matched).length
      });
    } catch (error) {
      console.error("Error processing building map:", error);
      res.status(500).json({ error: "Failed to process building map" });
    }
  });

  app.get("/api/building-maps/:id/image", async (req, res) => {
    const buildingMap = buildingMaps.find(map => map.id === req.params.id);
    if (!buildingMap) {
      return res.status(404).json({ error: "Building map not found" });
    }

    res.set('Content-Type', 'image/jpeg');
    res.send(buildingMap.imageBuffer);
  });

  app.delete("/api/building-maps/:id", async (req, res) => {
    const index = buildingMaps.findIndex(map => map.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: "Building map not found" });
    }

    buildingMaps.splice(index, 1);
    res.json({ success: true });
  });

  // Market data endpoint
  app.get("/api/market", async (req, res) => {
    const sp500Return = await fetchSP500Data();
    res.json({
      last_month_return_pct: sp500Return,
      source: process.env.ALPHA_VANTAGE_API_KEY ? "Alpha Vantage (Real)" : "Mock Data",
      current_price: marketDataCache.currentPrice,
      previous_month_price: marketDataCache.previousMonthPrice
    });
  });

  app.post("/api/market/refresh", async (req, res) => {
    // Force refresh the cache
    marketDataCache.lastFetched = 0;
    const sp500Return = await fetchSP500Data();
    res.json({
      last_month_return_pct: sp500Return,
      source: process.env.ALPHA_VANTAGE_API_KEY ? "Alpha Vantage (Real)" : "Mock Data"
    });
  });

  // Revenue series for chart
  app.get("/api/series", async (req, res) => {
    try {
      const timeRange = req.query.timeRange as string || '12M';
      const months = timeRange === '1M' ? 1 : timeRange === '3M' ? 3 : timeRange === '12M' ? 12 : 24;
      
      const assumptions = await storage.getCurrentAssumptions();
      
      // Fetch REAL S&P 500 data from Alpha Vantage
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
      let realSP500Data: Record<string, number> = {};
      
      if (apiKey) {
        try {
          const url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=SPY&apikey=${apiKey}`;
          const response = await fetch(url);
          const data = await response.json();
          
          if (data["Monthly Time Series"]) {
            const timeSeries = data["Monthly Time Series"];
            // Convert to map of date -> closing price
            Object.keys(timeSeries).forEach(date => {
              realSP500Data[date] = parseFloat(timeSeries[date]["4. close"]);
            });
          }
        } catch (error) {
          console.error("Failed to fetch S&P 500 data for chart:", error);
        }
      }
      
      const labels = [];
      const revenue = [];
      const sp500 = [];
      const industry = [];
      
      // Get real historical dates and S&P 500 values
      const sortedDates = Object.keys(realSP500Data).sort();
      const useRealSP500Data = sortedDates.length > months;
      
      // Calculate REAL revenue from rent roll data across ALL months
      // We need to get data for each month separately to show actual growth
      const currentDate = new Date();
      const startDate = new Date();
      startDate.setMonth(currentDate.getMonth() - months + 1);
      
      // Generate list of months to fetch
      const monthsToFetch = [];
      for (let i = 0; i < months; i++) {
        const date = new Date(startDate);
        date.setMonth(date.getMonth() + i);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthsToFetch.push(monthKey);
      }
      
      // Get revenue aggregated by month directly from database
      // This is much more memory efficient than loading all 391,030 records
      const revenueByMonth = await storage.getRevenueByMonths(monthsToFetch);
      
      // Convert monthly revenue to annual (multiply by 12) for display
      Object.keys(revenueByMonth).forEach(month => {
        revenueByMonth[month] = revenueByMonth[month] * 12;
      });
      
      // Generate data points for the chart
      for (let i = 0; i < months; i++) {
        const date = new Date(startDate);
        date.setMonth(date.getMonth() + i);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        labels.push(date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        
        // Use REAL revenue if available for this month, otherwise null
        const realRevenue = revenueByMonth[monthKey];
        revenue.push(realRevenue ? Math.round(realRevenue) : null);
        
        // S&P 500: Use REAL data if available
        if (useRealSP500Data) {
          const closestDate = sortedDates.reduce((prev, curr) => {
            const prevDiff = Math.abs(new Date(prev).getTime() - date.getTime());
            const currDiff = Math.abs(new Date(curr).getTime() - date.getTime());
            return currDiff < prevDiff ? curr : prev;
          });
          sp500.push(Math.round(realSP500Data[closestDate]));
        } else {
          // Fallback to realistic pattern if API unavailable
          const baseSP500 = 5800;
          const avgMonthlyReturn = 0.008;
          sp500.push(Math.round(baseSP500 * Math.pow(1 + avgMonthlyReturn, i)));
        }
        
        // Industry: Use senior living industry benchmarks
        // Senior living has shown ~3-5% annual growth historically
        // Convert to monthly growth: 4% annual = 0.327% monthly
        const baseIndustryValue = revenue[0] || 600000000; // Use first revenue value as base
        const monthlyIndustryGrowth = 0.00327; // 4% annual / 12 months
        const industryValue = baseIndustryValue * Math.pow(1 + monthlyIndustryGrowth, i);
        industry.push(Math.round(industryValue));
      }

      res.json({ 
        labels, 
        revenue, 
        sp500, 
        industry,
        dataSource: useRealSP500Data ? "Alpha Vantage (Real Market Data)" : "Mock Data (API Key Not Set)"
      });
    } catch (error) {
      console.error("Error generating series data:", error);
      res.status(500).json({ error: "Failed to generate series data" });
    }
  });

  // Competitors CRUD
  app.get("/api/competitors", async (req, res) => {
    try {
      const { regions, divisions, locations, serviceLines } = req.query;
      
      // Build filters object
      const filters: {
        regions?: string[];
        divisions?: string[];
        locations?: string[];
        serviceLines?: string[];
      } = {};
      
      // Parse filters from query params
      if (regions && regions !== '') {
        filters.regions = (regions as string).split(',');
      }
      if (divisions && divisions !== '') {
        filters.divisions = (divisions as string).split(',');
      }
      if (locations && locations !== '') {
        filters.locations = (locations as string).split(',');
      }
      if (serviceLines && serviceLines !== '') {
        filters.serviceLines = (serviceLines as string).split(',');
      }
      
      // Get filtered competitors using the new method
      const hasFilters = !!(filters.regions?.length || filters.divisions?.length || 
                           filters.locations?.length || filters.serviceLines?.length);
      
      let allCompetitors = hasFilters 
        ? await storage.getCompetitorsWithFilters(filters)
        : await storage.getCompetitors();
      
      // Get locations for metadata
      const locationData = await storage.getLocations();
      const locationIdToName = new Map<string, string>();
      locationData.forEach(loc => {
        locationIdToName.set(loc.id, loc.name);
      });
      
      // Group competitors by location and get top 3 per location
      const competitorsByLocation = new Map<string, any[]>();
      allCompetitors.forEach(comp => {
        // Get location name from either location field or location_id mapping
        const loc = comp.location || (comp.locationId ? locationIdToName.get(comp.locationId) : null) || 'Unknown';
        if (!competitorsByLocation.has(loc)) {
          competitorsByLocation.set(loc, []);
        }
        competitorsByLocation.get(loc)!.push(comp);
      });
      
      // Get top 3 competitors per location (sorted by rating or distance)  
      const topCompetitors: any[] = [];
      
      // If no filters are applied, return all competitors (up to reasonable limit)
      if (!hasFilters) {
        // Return all competitors, sorted by rating
        topCompetitors.push(...allCompetitors.sort((a, b) => {
          const ratingDiff = (parseFloat(b.rating || '0') - parseFloat(a.rating || '0'));
          if (ratingDiff !== 0) return ratingDiff;
          return (a.distanceMiles || 999) - (b.distanceMiles || 999);
        }));
      } else {
        // When filtered, check if single location or multiple
        const isSingleLocation = filters.locations?.length === 1 && 
                                !filters.regions?.length && 
                                !filters.divisions?.length;
        
        competitorsByLocation.forEach((comps, location) => {
          const sorted = comps
            .sort((a, b) => {
              // Sort by rating (higher is better) then by distance (closer is better)
              const ratingDiff = (parseFloat(b.rating || '0') - parseFloat(a.rating || '0'));
              if (ratingDiff !== 0) return ratingDiff;
              return (a.distanceMiles || 999) - (b.distanceMiles || 999);
            });
          
          // If single location selected, show all competitors. Otherwise, limit to top 3 per location
          const finalList = isSingleLocation ? sorted : sorted.slice(0, 3);
          topCompetitors.push(...finalList);
        });
      }
      
      // Get current location info for map centering
      let currentLocation = null;
      if (locations) {
        const locList = (locations as string).split(',');
        if (locList.length === 1) {
          const loc = locationData.find(l => l.name === locList[0]);
          if (loc) {
            currentLocation = {
              name: loc.name,
              lat: loc.latitude,
              lng: loc.longitude,
              address: `${loc.address}, ${loc.city}, ${loc.state}`
            };
          }
        }
      }
      
      res.json({ 
        items: topCompetitors,
        currentLocation,
        totalLocations: competitorsByLocation.size,
        totalCompetitors: allCompetitors.length
      });
    } catch (error) {
      console.error('Error fetching competitors:', error);
      res.status(500).json({ error: "Failed to get competitors" });
    }
  });

  app.post("/api/competitors", async (req, res) => {
    try {
      const validatedData = insertCompetitorSchema.parse(req.body);
      const competitor = await storage.createCompetitor(validatedData);
      res.json({ ok: true, competitor });
    } catch (error) {
      res.status(400).json({ error: "Invalid competitor data" });
    }
  });

  app.put("/api/competitors/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertCompetitorSchema.parse(req.body);
      const competitor = await storage.updateCompetitor(id, validatedData);
      res.json({ ok: true, competitor });
    } catch (error) {
      res.status(400).json({ error: "Invalid competitor data" });
    }
  });

  app.delete("/api/competitors/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteCompetitor(id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete competitor" });
    }
  });

  // Portfolio Management Routes
  app.get("/api/portfolio/locations", async (req, res) => {
    try {
      const locations = await storage.getLocations();
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // API endpoint for location filter data
  app.get("/api/locations", async (req, res) => {
    try {
      const allLocations = await storage.getLocations();
      
      // Get distinct locations that have rent roll data
      const locationsWithData = await db.selectDistinct({ location: rentRollData.location })
        .from(rentRollData);
      
      const locationsWithDataSet = new Set(locationsWithData.map(item => item.location));
      
      // Filter to only include locations that:
      // 1. Have rent roll data
      // 2. Have region AND division mappings (both non-null)
      const filteredLocations = allLocations.filter(loc => 
        locationsWithDataSet.has(loc.name) && 
        loc.region && 
        loc.division
      );
      
      // Extract unique regions and divisions from filtered locations
      const regions = [...new Set(filteredLocations.map(loc => loc.region).filter(Boolean))];
      const divisions = [...new Set(filteredLocations.map(loc => loc.division).filter(Boolean))];
      
      res.json({
        locations: filteredLocations,
        regions: regions,
        divisions: divisions
      });
    } catch (error) {
      console.error("Error fetching location filter data:", error);
      res.status(500).json({ error: "Failed to fetch location data" });
    }
  });

  app.post("/api/portfolio/mass-upload", upload.array('file', 50), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      const { uploadType, region, division } = req.body;
      
      let totalRecords = 0;
      let locationsCreated = 0;
      const locationMap = new Map<string, any[]>();
      
      // Process each file
      for (const file of files) {
        const results = Papa.parse(file.buffer.toString(), {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => header.trim().replace(/\s+/g, '_'),
        });
        
        // Group data by location
        for (const row of results.data as any[]) {
          const locationName = row.Location || row.location || 'Unknown';
          if (!locationMap.has(locationName)) {
            locationMap.set(locationName, []);
          }
          locationMap.get(locationName)?.push(row);
          totalRecords++;
        }
      }
      
      // Process each location
      for (const [locationName, data] of locationMap) {
        // Create or update location
        const location = await storage.createOrUpdateLocation({
          name: locationName,
          region: region || undefined,
          division: division || undefined,
          totalUnits: data.length,
        });
        locationsCreated++;
        
        if (uploadType === 'rent_roll') {
          // Clear existing data for this location
          await storage.clearRentRollDataByLocation(locationName);
          
          // Process and insert rent roll data
          const processedData = data.map((row: any) => ({
            uploadMonth: new Date().toISOString().slice(0, 7),
            date: row.Date || new Date().toISOString().split('T')[0],
            location: locationName,
            locationId: location.id,
            roomNumber: row.Room_Number || row.Unit_Number || '',
            roomType: row.Room_Type || row.Unit_Type || 'Studio',
            serviceLine: row.Service_Line || 'AL',
            occupiedYN: row.Occupied_YN === 'Y' || row.Occupied === 'Y',
            daysVacant: parseInt(row.Days_Vacant) || 0,
            preferredLocation: row.Preferred_Location,
            size: row.Size || 'Studio',
            view: row.View,
            renovated: row.Renovated === 'Y',
            otherPremiumFeature: row.Other_Premium_Feature,
            locationRating: row.Location_Rating,
            sizeRating: row.Size_Rating,
            viewRating: row.View_Rating,
            renovationRating: row.Renovation_Rating,
            amenityRating: row.Amenity_Rating,
            streetRate: parseFloat(row.Street_Rate) || 0,
            inHouseRate: parseFloat(row.In_House_Rate) || 0,
            discountToStreetRate: parseFloat(row.Discount_To_Street_Rate) || 0,
            careLevel: row.Care_Level,
            careRate: parseFloat(row.Care_Rate) || 0,
            rentAndCareRate: parseFloat(row.Rent_And_Care_Rate) || 0,
            competitorRate: parseFloat(row.Competitor_Rate) || 0,
            competitorAvgCareRate: parseFloat(row.Competitor_Avg_Care_Rate) || 0,
            competitorFinalRate: parseFloat(row.Competitor_Final_Rate) || 0,
            moduloSuggestedRate: parseFloat(row.Modulo_Suggested_Rate) || 0,
            aiSuggestedRate: parseFloat(row.AI_Suggested_Rate) || 0,
            promotionAllowance: parseFloat(row.Promotion_Allowance) || 0,
          }));
          
          await storage.bulkInsertRentRollData(processedData);
          
          // Update location unit count
          await storage.updateLocationUnits(location.id, data.length);
        } else if (uploadType === 'competitors') {
          // Clear existing competitors for this location
          await storage.clearCompetitorsByLocation(locationName);
          
          // Process competitor data
          for (const row of data) {
            await storage.createCompetitor({
              name: row.Competitor_Name || row.Name || 'Unknown Competitor',
              location: locationName,
              locationId: location.id,
              lat: parseFloat(row.Latitude) || 38.2527,
              lng: parseFloat(row.Longitude) || -85.7585,
              streetRate: parseFloat(row.Street_Rate) || 0,
              avgCareRate: parseFloat(row.Avg_Care_Rate) || 0,
              roomType: row.Room_Type,
              rating: row.Rating,
              address: row.Address,
              rank: parseInt(row.Rank) || 1,
              weight: parseFloat(row.Weight) || 1.0,
              rates: row.Rates ? JSON.parse(row.Rates) : null,
              attributes: row.Attributes ? JSON.parse(row.Attributes) : null,
            });
          }
        } else if (uploadType === 'targets_trends') {
          // Clear existing targets & trends for this campus
          await storage.clearTargetsAndTrendsByCampus(locationName);
          
          // Process targets & trends data
          const processedData = data.map((row: any) => ({
            month: row.Month || new Date().toISOString().slice(0, 7),
            region: row.Region || region,
            division: row.Division || division,
            campus: locationName,
            serviceLine: row.Service_Line || 'AL',
            budgetedOccupancy: parseFloat(row.Budgeted_Occupancy) || null,
            budgetedRate: parseFloat(row.Budgeted_Rate) || null,
            roomRateAdjustment: parseFloat(row.Room_Rate_Adjustment) || null,
            roomRateAdjustmentNote: row.Room_Rate_Adjustment_Note,
            budgetedRevPOR: parseFloat(row.Budgeted_RevPOR) || null,
            communityFeeCollection: parseFloat(row.Community_Fee_Collection) || null,
            inquiries: parseInt(row.Inquiries) || 0,
            tours: parseInt(row.Tours) || 0,
            moveIns: parseInt(row.Move_Ins) || 0,
            avgDaysToMoveIn: parseInt(row.Avg_Days_To_Move_In) || null,
            notes: row.Notes,
            locationId: location.id,
          }));
          
          await storage.bulkInsertTargetsAndTrends(processedData);
        }
        
        // Create upload history
        await storage.createUploadHistory({
          uploadMonth: new Date().toISOString().slice(0, 7),
          fileName: files.map(f => f.originalname).join(', '),
          uploadType,
          location: locationName,
          locationId: location.id,
          totalRecords: data.length,
        });
      }
      
      res.json({
        ok: true,
        filesProcessed: files.length,
        totalRecords,
        locationsCreated,
        locations: Array.from(locationMap.keys()),
      });
    } catch (error) {
      console.error("Error processing mass upload:", error);
      res.status(500).json({ error: "Failed to process mass upload" });
    }
  });

  app.post("/api/portfolio/competitor-upload", upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const results = Papa.parse(file.buffer.toString(), {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string) => header.trim().replace(/\s+/g, '_'),
      });
      
      let competitorsImported = 0;
      let totalLocations = 0;
      
      // Group by portfolio name
      const portfolioMap = new Map<string, any[]>();
      for (const row of results.data as any[]) {
        const portfolioName = row.Portfolio_Name || row.Competitor_Portfolio || 'Unknown';
        if (!portfolioMap.has(portfolioName)) {
          portfolioMap.set(portfolioName, []);
        }
        portfolioMap.get(portfolioName)?.push(row);
      }
      
      // Process each portfolio
      for (const [portfolioName, locations] of portfolioMap) {
        const locationData = locations.map(loc => ({
          name: loc.Location_Name || loc.Location,
          rate: parseFloat(loc.Rate) || 0,
          units: parseInt(loc.Units) || 0,
          lat: parseFloat(loc.Latitude) || 0,
          lng: parseFloat(loc.Longitude) || 0,
        }));
        
        const avgRate = locationData.reduce((sum, loc) => sum + loc.rate, 0) / locationData.length;
        const totalUnits = locationData.reduce((sum, loc) => sum + loc.units, 0);
        
        await storage.createOrUpdatePortfolioCompetitor({
          name: `${portfolioName}_${Date.now()}`,
          portfolioName,
          locations: locationData,
          avgPortfolioRate: avgRate,
          totalUnits,
          marketShare: parseFloat(locations[0]?.Market_Share) || 0,
        });
        
        competitorsImported++;
        totalLocations += locationData.length;
      }
      
      res.json({
        ok: true,
        competitorsImported,
        totalLocations,
      });
    } catch (error) {
      console.error("Error processing competitor upload:", error);
      res.status(500).json({ error: "Failed to process competitor upload" });
    }
  });

  app.get("/api/portfolio/competitors", async (req, res) => {
    try {
      const competitors = await storage.getPortfolioCompetitors();
      res.json(competitors);
    } catch (error) {
      console.error("Error fetching portfolio competitors:", error);
      res.status(500).json({ error: "Failed to fetch portfolio competitors" });
    }
  });

  app.get("/api/portfolio/download-template/:type", async (req, res) => {
    try {
      const { type } = req.params;
      
      let template;
      let filename;
      
      if (type === 'rent_roll') {
        template = [
          {
            Date: '2024-01-01',
            Location: 'Louisville East',
            Room_Number: '101',
            Room_Type: 'Studio',
            Service_Line: 'AL',
            Occupied_YN: 'Y',
            Days_Vacant: 0,
            Preferred_Location: 'Y',
            Size: 'Studio',
            View: 'Garden View',
            Renovated: 'Y',
            Other_Premium_Feature: '',
            Location_Rating: 'A',
            Size_Rating: 'B',
            View_Rating: 'A',
            Renovation_Rating: 'A',
            Amenity_Rating: 'B',
            Street_Rate: 3500,
            In_House_Rate: 3200,
            Discount_To_Street_Rate: 300,
            Care_Level: 'Level 1',
            Care_Rate: 500,
            Rent_And_Care_Rate: 3700,
            Competitor_Rate: 3600,
            Competitor_Avg_Care_Rate: 450,
            Competitor_Final_Rate: 4050,
            Modulo_Suggested_Rate: 3650,
            AI_Suggested_Rate: 3700,
            Promotion_Allowance: 100,
            Inquiry_Count: 5,
            Tour_Count: 3,
          },
        ];
        filename = 'rent_roll_template.csv';
      } else if (type === 'competitor') {
        template = [
          {
            Portfolio_Name: 'Brookdale',
            Location_Name: 'Brookdale Louisville',
            Competitor_Name: 'Brookdale Senior Living',
            Latitude: 38.2527,
            Longitude: -85.7585,
            Street_Rate: 3800,
            Avg_Care_Rate: 600,
            Room_Type: 'Studio',
            Rating: 'A',
            Address: '123 Main St, Louisville, KY',
            Rank: 1,
            Weight: 1.0,
            Units: 120,
            Market_Share: 15,
          },
        ];
        filename = 'competitor_template.csv';
      } else if (type === 'targets_trends') {
        template = [
          {
            Month: '2025-01',
            Region: 'North Central Indiana',
            Division: 'East',
            Campus: 'Creasy Springs',
            Service_Line: 'AL',
            Budgeted_Occupancy: 92.5,
            Budgeted_Rate: 4200,
            Room_Rate_Adjustment: 3.0,
            Room_Rate_Adjustment_Note: 'Annual increase',
            Budgeted_RevPOR: 4500,
            Community_Fee_Collection: 95.0,
            Inquiries: 45,
            Tours: 28,
            Move_Ins: 8,
            Conversion_Rate: 17.8,
            Avg_Days_To_Move_In: 32,
            Notes: 'Q1 marketing push underway',
          },
        ];
        filename = 'targets_trends_template.csv';
      } else {
        return res.status(400).json({ error: 'Invalid template type' });
      }
      
      const csv = Papa.unparse(template);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error("Error generating template:", error);
      res.status(500).json({ error: "Failed to generate template" });
    }
  });

  // Guardrails CRUD
  app.get("/api/guardrails", async (req, res) => {
    try {
      const { locationId, serviceLine } = req.query;
      
      // 3-tier fallback: specific → location-only → global
      let guardrail;
      
      // Try location + serviceLine specific
      if (locationId && serviceLine) {
        [guardrail] = await db.select().from(guardrails)
          .where(and(
            eq(guardrails.locationId, locationId as string),
            eq(guardrails.serviceLine, serviceLine as string)
          ))
          .limit(1);
      }
      
      // Fall back to location-only (serviceLine=NULL)
      if (!guardrail && locationId) {
        [guardrail] = await db.select().from(guardrails)
          .where(and(
            eq(guardrails.locationId, locationId as string),
            sql`${guardrails.serviceLine} IS NULL`
          ))
          .limit(1);
      }
      
      // Fall back to global default (both NULL)
      if (!guardrail) {
        [guardrail] = await db.select().from(guardrails)
          .where(and(
            sql`${guardrails.locationId} IS NULL`,
            sql`${guardrails.serviceLine} IS NULL`
          ))
          .limit(1);
      }
      
      res.json(guardrail || {});
    } catch (error) {
      console.error('Error fetching guardrails:', error);
      res.status(500).json({ error: "Failed to get guardrails" });
    }
  });

  app.post("/api/guardrails", async (req, res) => {
    try {
      const { locationId, serviceLine, id, createdAt, ...guardrailData } = req.body;
      
      // Delete existing entry for this scope
      if (locationId && serviceLine) {
        await db.delete(guardrails).where(and(
          eq(guardrails.locationId, locationId),
          eq(guardrails.serviceLine, serviceLine)
        ));
      } else if (locationId) {
        await db.delete(guardrails).where(and(
          eq(guardrails.locationId, locationId),
          sql`${guardrails.serviceLine} IS NULL`
        ));
      } else {
        await db.delete(guardrails).where(and(
          sql`${guardrails.locationId} IS NULL`,
          sql`${guardrails.serviceLine} IS NULL`
        ));
      }
      
      // Insert new values (createdAt is auto-generated)
      const [newGuardrail] = await db.insert(guardrails).values({
        locationId: locationId || null,
        serviceLine: serviceLine || null,
        ...guardrailData
      }).returning();
      
      res.json({ ok: true, guardrails: newGuardrail });
    } catch (error) {
      console.error('Error saving guardrails:', error);
      res.status(400).json({ error: "Invalid guardrails data" });
    }
  });

  // Pricing recommendations
  app.get("/api/recommendations", async (req, res) => {
    try {
      let rentRollData = await storage.getRentRollData();
      
      // If no rent roll data exists, return error
      if (rentRollData.length === 0) {
        return res.status(404).json({ error: "No rent roll data available. Please import production data." });
      }
      
      const weights = await storage.getCurrentWeights();
      const competitors = await storage.getCompetitors();
      
      // Generate recommendations based on algorithm
      const recommendations = await Promise.all(rentRollData.map(async unit => {
        let recommendedRent = unit.baseRent;
        let rationale = "Base rent";
        let mlConfidence = Math.floor(Math.random() * 30) + 70; // 70-99% confidence
        const factors = [];

        // Apply occupancy pressure
        if (!unit.occupiedYN && (unit.daysVacant || 0) > 60) {
          recommendedRent *= 0.92; // 8% reduction for very long vacancy
          factors.push("long vacancy discount");
          mlConfidence -= 5;
        } else if (!unit.occupiedYN && (unit.daysVacant || 0) > 30) {
          recommendedRent *= 0.96; // 4% reduction for moderate vacancy
          factors.push("vacancy adjustment");
        } else if (unit.occupiedYN) {
          recommendedRent *= 1.03; // 3% increase for occupied units
          factors.push("occupancy premium");
          mlConfidence += 5;
        }

        // Apply unit attributes
        if (unit.attributes) {
          if (unit.attributes.view) {
            recommendedRent *= 1.05;
            factors.push("premium view");
            mlConfidence += 3;
          }
          if (unit.attributes.renovated) {
            recommendedRent *= 1.08;
            factors.push("recently renovated");
            mlConfidence += 5;
          }
          if (unit.attributes.corner) {
            recommendedRent *= 1.02;
            factors.push("corner unit");
            mlConfidence += 2;
          }
        }

        // Apply competitor rates
        if (unit.competitorBenchmarkRate) {
          const competitorDiff = (unit.competitorBenchmarkRate - unit.baseRent) / unit.baseRent;
          if (Math.abs(competitorDiff) > 0.1) { // Significant difference
            recommendedRent += (competitorDiff * recommendedRent * 0.3);
            factors.push(competitorDiff > 0 ? "market premium opportunity" : "competitive pricing");
            mlConfidence += 8;
          }
        }

        // Apply market sentiment using real S&P 500 data
        const sp500Return = await fetchSP500Data();
        if (sp500Return > 2) {
          recommendedRent *= 1.025; // Strong market allows premium
          factors.push("strong market conditions");
          mlConfidence += 3;
        } else if (sp500Return < -2) {
          recommendedRent *= 0.975; // Weak market requires discount
          factors.push("market headwinds");
          mlConfidence -= 3;
        }

        // Apply room type adjustments
        if (unit.roomType === "Memory Care") {
          recommendedRent *= 1.02; // Premium care commands higher rates
          factors.push("specialized care premium");
          mlConfidence += 5;
        }

        // Generate ML suggested rent (slightly different from algorithm)
        const mlVariance = (Math.random() - 0.5) * 0.06; // ±3% variance
        const mlSuggestedRent = Math.round(recommendedRent * (1 + mlVariance));

        // Cap confidence at 95%
        mlConfidence = Math.min(mlConfidence, 95);

        // Create rationale
        rationale = factors.length > 0 ? factors.join(", ") : "market rate analysis";

        return {
          Unit_ID: unit.unitId,
          Room_Type: unit.roomType,
          Occupied_YN: unit.occupiedYN ? 'Y' : 'N',
          Days_Vacant: unit.daysVacant || 0,
          Fence_Price: unit.baseRent,
          Competitor_Benchmark_Rate: unit.competitorBenchmarkRate,
          Recommended_Rent: Math.round(recommendedRent),
          ML_Suggested_Rent: mlSuggestedRent,
          ML_Confidence: mlConfidence,
          Rationale: rationale
        };
      }));

      res.json({ items: recommendations });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate recommendations" });
    }
  });

  // Room type comparison
  app.get("/api/compare", async (req, res) => {
    try {
      const rentRollData = await storage.getRentRollData();
      const competitors = await storage.getCompetitors();
      
      // Group by room type
      const roomTypes = new Map();
      
      for (const unit of rentRollData) {
        if (!roomTypes.has(unit.roomType)) {
          roomTypes.set(unit.roomType, {
            units: [],
            totalRent: 0,
            competitorRates: [],
            competitorCareRates: []
          });
        }
        
        const roomData = roomTypes.get(unit.roomType);
        roomData.units.push(unit);
        roomData.totalRent += unit.baseRent + (unit.careFee || 0);
        
        if (unit.competitorBenchmarkRate) {
          roomData.competitorRates.push(unit.competitorBenchmarkRate);
        }
        
        if (unit.competitorAvgCareRate) {
          roomData.competitorCareRates.push(unit.competitorAvgCareRate);
        }
      }

      const comparison = Array.from(roomTypes.entries()).map(([roomType, data]) => {
        const yourCurrentAvg = data.totalRent / data.units.length;
        const marketAvg = data.competitorRates.length > 0 
          ? data.competitorRates.reduce((sum, rate) => sum + rate, 0) / data.competitorRates.length 
          : yourCurrentAvg;
        const competitorAvgCare = data.competitorCareRates.length > 0
          ? data.competitorCareRates.reduce((sum, rate) => sum + rate, 0) / data.competitorCareRates.length
          : 0;

        return {
          Room_Type: roomType,
          Your_Current_Avg: yourCurrentAvg,
          Market_Avg: marketAvg,
          Competitor_Avg_Care: competitorAvgCare,
          Net_vs_Market: yourCurrentAvg - marketAvg,
          Modulo_Recommended: marketAvg * 1.05 // 5% premium over market
        };
      });

      res.json({ rows: comparison });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate comparison" });
    }
  });

  // Publish rates to CSV
  app.post("/api/publish", async (req, res) => {
    try {
      // Generate CSV content
      const recommendations = await fetch(`${req.protocol}://${req.get('host')}/api/recommendations`);
      const data = await recommendations.json();
      
      const csvContent = Papa.unparse(data.items);
      const filename = `pricing_recommendations_${new Date().toISOString().split('T')[0]}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      res.status(500).json({ error: "Failed to publish CSV" });
    }
  });

  // MatrixCare Street Rates Export (for new admissions)
  app.get("/api/export/street-rates", async (req, res) => {
    try {
      const { campuses } = req.query;
      const selectedCampuses = campuses ? (campuses as string).split(',') : undefined;
      
      // Import the export function
      const { generateStreetRatesExport, validateStreetRatesExport } = await import('./matrixCareStreetRatesExport');
      
      // Generate the export file
      const filepath = await generateStreetRatesExport(selectedCampuses);
      
      // Validate the export
      const validation = await validateStreetRatesExport(filepath);
      
      // Read the file content
      const fs = await import('fs');
      const fileContent = await fs.promises.readFile(filepath, 'utf8');
      
      // Set headers for download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=CORPORATEROOMCHARGESEXPORT_Trilogy_${timestamp}.CSV`);
      res.setHeader('X-Validation-Status', validation.isValid ? 'valid' : 'invalid');
      res.setHeader('X-Validation-Summary', JSON.stringify(validation.summary));
      
      // Clean up temp file
      await fs.promises.unlink(filepath);
      
      res.send(fileContent);
    } catch (error) {
      console.error('Error generating street rates export:', error);
      res.status(500).json({ error: 'Failed to generate street rates export' });
    }
  });
  
  // MatrixCare Special Rates Export (for current residents)
  app.get("/api/export/special-rates", async (req, res) => {
    try {
      const { campuses } = req.query;
      const selectedCampuses = campuses ? (campuses as string).split(',') : undefined;
      
      // Import the export function
      const { generateSpecialRatesExport, validateSpecialRatesExport } = await import('./matrixCareSpecialRatesExport');
      
      // Generate the export file
      const filepath = await generateSpecialRatesExport(selectedCampuses);
      
      // Validate the export
      const validation = await validateSpecialRatesExport(filepath);
      
      // Read the file content
      const fs = await import('fs');
      const fileContent = await fs.promises.readFile(filepath, 'utf8');
      
      // Set headers for download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=SPECIALROOMRATESEXPORT_Trilogy_${timestamp}.CSV`);
      res.setHeader('X-Validation-Status', validation.isValid ? 'valid' : 'invalid');
      res.setHeader('X-Validation-Summary', JSON.stringify(validation.summary));
      
      // Clean up temp file
      await fs.promises.unlink(filepath);
      
      res.send(fileContent);
    } catch (error) {
      console.error('Error generating special rates export:', error);
      res.status(500).json({ error: 'Failed to generate special rates export' });
    }
  });

  // Pricing Strategy Documentation endpoints
  app.get("/api/pricing-strategy-documentation", async (req, res) => {
    try {
      const { campus, serviceLine } = req.query;
      
      // Fetch all required data
      const [weights, ranges, guardrails, rentRollData] = await Promise.all([
        storage.getPricingWeights(),
        storage.getAdjustmentRanges(),
        storage.getGuardrails(),
        storage.getRentRollData()
      ]);
      
      // Get active rules
      const activeRules = await storage.getAdjustmentRules ? await storage.getAdjustmentRules() : [];
      
      // Import the generator function
      const { generatePricingStrategyDocumentation } = await import('./pricingStrategyGenerator');
      
      // Generate documentation
      const documentation = generatePricingStrategyDocumentation(
        {
          weights: weights ? [weights] : [],
          ranges: ranges ? [ranges] : [],
          guardrails: guardrails || [],
          activeRules: activeRules.filter((r: any) => r.isActive),
          rentRollData: rentRollData || []
        },
        campus as string | undefined,
        serviceLine as string | undefined
      );
      
      res.json(documentation);
    } catch (error) {
      console.error('Error generating pricing strategy documentation:', error);
      res.status(500).json({ error: 'Failed to generate pricing strategy documentation' });
    }
  });
  
  // Export pricing strategy documentation
  app.get("/api/pricing-strategy-documentation/export", async (req, res) => {
    try {
      const { campus, serviceLine, format = 'text' } = req.query;
      
      // Fetch all required data
      const [weights, ranges, guardrails, rentRollData] = await Promise.all([
        storage.getPricingWeights(),
        storage.getAdjustmentRanges(),
        storage.getGuardrails(),
        storage.getRentRollData()
      ]);
      
      // Get active rules
      const activeRules = await storage.getAdjustmentRules ? await storage.getAdjustmentRules() : [];
      
      // Import the generator functions
      const { generatePricingStrategyDocumentation, exportAsText, exportAsJSON } = await import('./pricingStrategyGenerator');
      
      // Generate documentation
      const documentation = generatePricingStrategyDocumentation(
        {
          weights: weights ? [weights] : [],
          ranges: ranges ? [ranges] : [],
          guardrails: guardrails || [],
          activeRules: activeRules.filter((r: any) => r.isActive),
          rentRollData: rentRollData || []
        },
        campus as string | undefined,
        serviceLine as string | undefined
      );
      
      // Export based on format
      let content: string;
      let contentType: string;
      let extension: string;
      
      switch (format) {
        case 'json':
          content = exportAsJSON(documentation);
          contentType = 'application/json';
          extension = 'json';
          break;
        case 'text':
        default:
          content = exportAsText(documentation);
          contentType = 'text/plain';
          extension = 'txt';
          break;
      }
      
      const filename = `pricing_strategy_${campus || 'all'}_${new Date().toISOString().split('T')[0]}.${extension}`;
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      console.error('Error exporting pricing strategy documentation:', error);
      res.status(500).json({ error: 'Failed to export pricing strategy documentation' });
    }
  });
  
  // MatrixCare Export - Export data in MatrixCare format
  app.get("/api/export/matrixcare", async (req, res) => {
    try {
      const { format = 'xlsx' } = req.query;
      
      // Get all rent roll data
      const rentRollData = await storage.getRentRollData();
      
      if (!rentRollData || rentRollData.length === 0) {
        return res.status(404).json({ error: "No rent roll data available for export" });
      }
      
      // Import the MatrixCare export functions
      const { generateMatrixCareExcel, generateMatrixCareCSV } = await import('./matrixCareExport');
      
      if (format === 'csv') {
        // Generate CSV with validation
        const { csv, validation } = await generateMatrixCareCSV(rentRollData);
        
        // Log validation warnings if any
        if (!validation.isValid) {
          console.error('MatrixCare CSV export has validation issues:', validation.issues);
        }
        
        const filename = `MatrixCare_Upload_${new Date().toISOString().split('T')[0]}.csv`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Validation-Status', validation.isValid ? 'valid' : 'invalid');
        if (validation.suggestions.length > 0) {
          res.setHeader('X-Validation-Suggestions', validation.suggestions.join('; '));
        }
        res.send(csv);
      } else {
        // Generate Excel with validation
        const { buffer, validation } = await generateMatrixCareExcel(rentRollData);
        
        // Log validation warnings if any
        if (!validation.isValid) {
          console.error('MatrixCare Excel export has validation issues:', validation.issues);
        }
        
        const filename = `MatrixCare_Upload_${new Date().toISOString().split('T')[0]}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Validation-Status', validation.isValid ? 'valid' : 'invalid');
        if (validation.suggestions.length > 0) {
          res.setHeader('X-Validation-Suggestions', validation.suggestions.join('; '));
        }
        res.send(buffer);
      }
    } catch (error) {
      console.error('MatrixCare export failed:', error);
      res.status(500).json({ error: "Failed to export MatrixCare template" });
    }
  });

  // Attribute Pricing Configuration
  app.post("/api/attribute-pricing", async (req, res) => {
    try {
      // In a real implementation, would save settings to database
      // For now, just return success
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update attribute pricing" });
    }
  });

  // Analytics - Campus Metrics for Scatter Plots
  app.get("/api/analytics/campus-metrics", async (req, res) => {
    try {
      const { region, division, serviceLine } = req.query;
      
      // Get all required data - use most recent month (2025-11)
      const currentMonth = '2025-11';  // Fixed to November 2025 which has data
      const [rentRollData, campusData, competitors, pricingWeights] = await Promise.all([
        storage.getRentRollDataByMonth(currentMonth),  // Only get current month data
        storage.getAllCampuses(),
        storage.getCompetitors(),
        storage.getPricingWeights()
      ]);
      
      console.log(`Analytics: Processing ${rentRollData.length} units for ${currentMonth}`);

      // Create a map of campus data for O(1) lookups instead of O(n) searches
      const campusDataMap = new Map();
      campusData.forEach((campus: any) => {
        campusDataMap.set(campus.name, campus);
      });

      // Filter rent roll data by service line first if needed
      let filteredRentRollData = rentRollData;
      if (serviceLine && serviceLine !== 'all') {
        filteredRentRollData = rentRollData.filter((unit: any) => unit.serviceLine === serviceLine);
      }

      // Group rent roll data by campus
      const campusMetrics = new Map();
      let debugTotalUnits = 0;
      let debugFilteredUnits = 0;
      let debugBBedsSkipped = 0;
      
      filteredRentRollData.forEach((unit: any) => {
        const campusId = unit.location || 'Unknown';
        debugTotalUnits++;
        
        // Filter out B-beds for senior housing service lines (AL, MC, IL)
        // Only count A-beds (room numbers NOT ending with /B)
        // Note: Drizzle ORM camelCases the field names
        const roomNum = unit.roomNumber || unit.room_number || '';
        const isABed = !roomNum || !roomNum.endsWith('/B');
        const isHC = unit.serviceLine === 'HC';
        
        // Skip B-beds for non-HC service lines
        if (!isHC && !isABed) {
          debugBBedsSkipped++;
          return; // Skip this unit
        }
        debugFilteredUnits++;
        
        if (!campusMetrics.has(campusId)) {
          campusMetrics.set(campusId, {
            campusId,
            campusName: campusId,
            units: [],
            totalUnits: 0,
            occupiedUnits: 0,
            totalRent: 0,
            vacantUnits: 0,
            avgLOS: 0,
            region: 'Unknown'
          });
        }
        
        const campus = campusMetrics.get(campusId);
        campus.units.push(unit);
        campus.totalUnits++;
        if (unit.occupiedYN) {
          campus.occupiedUnits++;
          // Use streetRate consistently for calculations, fallback to inHouseRate
          const rate = unit.streetRate || unit.inHouseRate || 0;
          campus.totalRent += rate;
        } else {
          campus.vacantUnits++;
        }
      });
      
      console.log(`Analytics Debug: Total=${debugTotalUnits}, Filtered=${debugFilteredUnits}, B-beds skipped=${debugBBedsSkipped}`);
      console.log(`Analytics Debug: Found ${campusMetrics.size} unique campuses`);

      // Calculate portfolio-wide medians by room type as fallback when competitor data is missing
      const portfolioMediansByRoomType = new Map<string, number>();
      const ratesByRoomType = new Map<string, number[]>();
      
      rentRollData.forEach((unit: any) => {
        let roomType = unit.roomType || 'Unknown';
        // Normalize to competitor format
        if (roomType === 'One Bedroom') roomType = '1BR';
        else if (roomType === 'Two Bedroom') roomType = '2BR';
        
        const rate = unit.inHouseRate || unit.streetRate || 0;
        if (rate > 0) {
          if (!ratesByRoomType.has(roomType)) {
            ratesByRoomType.set(roomType, []);
          }
          ratesByRoomType.get(roomType)!.push(rate);
        }
      });
      
      // Calculate medians
      ratesByRoomType.forEach((rates, roomType) => {
        rates.sort((a, b) => a - b);
        const mid = Math.floor(rates.length / 2);
        const median = rates.length % 2 === 0
          ? (rates[mid - 1] + rates[mid]) / 2
          : rates[mid];
        portfolioMediansByRoomType.set(roomType, median);
      });
      
      // Group competitors by campus and room type for apples-to-apples comparison
      const competitorsByLocationAndType = new Map<string, Map<string, number[]>>();
      
      competitors.forEach((comp: any) => {
        const campusId = comp.location || 'Unknown';
        const roomType = comp.roomType || 'Unknown';
        
        if (!competitorsByLocationAndType.has(campusId)) {
          competitorsByLocationAndType.set(campusId, new Map());
        }
        
        const locationMap = competitorsByLocationAndType.get(campusId)!;
        if (!locationMap.has(roomType)) {
          locationMap.set(roomType, []);
        }
        
        // Filter out unrealistically low rates (likely data import errors)
        // Senior living monthly rates below $1000 are clearly errors (daily rates imported as monthly)
        const MIN_REALISTIC_MONTHLY_RATE = 1000;
        if (comp.streetRate && comp.streetRate > MIN_REALISTIC_MONTHLY_RATE) {
          locationMap.get(roomType)!.push(comp.streetRate);
        }
      });

      // Calculate metrics for each campus
      const campusesData: any[] = [];
      
      campusMetrics.forEach((metrics, campusId) => {
        const occupancy = metrics.occupiedUnits / metrics.totalUnits;
        const avgRate = metrics.occupiedUnits > 0 ? metrics.totalRent / metrics.occupiedUnits : 0;
        
        // Calculate rates by service line type for meaningful display
        let hcUnits = 0;
        let hcRate = 0;
        let seniorHousingUnits = 0;
        let seniorHousingRate = 0;
        
        metrics.units.forEach((unit: any) => {
          const rate = unit.streetRate || unit.inHouseRate || 0;
          if (unit.serviceLine === 'HC' || unit.serviceLine === 'HC/MC') {
            // HC rates are daily
            if (rate > 0) {
              hcRate += rate;
              hcUnits++;
            }
          } else {
            // Senior Housing rates are monthly (AL, IL, MC, SL, VIL)
            if (rate > 0) {
              seniorHousingRate += rate;
              seniorHousingUnits++;
            }
          }
        });
        
        // Calculate average rates by type
        const avgHcDailyRate = hcUnits > 0 ? hcRate / hcUnits : 0;
        const avgSeniorHousingMonthlyRate = seniorHousingUnits > 0 ? seniorHousingRate / seniorHousingUnits : 0;
        
        // Calculate market position using adjusted competitor rates from rent roll data
        // Use competitorFinalRate which already has all adjustments applied
        let totalTrilogyRate = 0;
        let totalCompetitorRate = 0;
        let unitsWithCompetitorData = 0;
        
        metrics.units.forEach((unit: any) => {
          // Only include units that have competitor data
          if (unit.competitorFinalRate && unit.competitorFinalRate > 0) {
            const trilogyRate = unit.streetRate || unit.inHouseRate || 0;
            if (trilogyRate > 0) {
              totalTrilogyRate += trilogyRate;
              totalCompetitorRate += unit.competitorFinalRate;
              unitsWithCompetitorData++;
            }
          }
        });
        
        // Calculate average rates for units with competitor data
        const avgTrilogyRateWithComp = unitsWithCompetitorData > 0 
          ? totalTrilogyRate / unitsWithCompetitorData 
          : 0;
        const avgCompetitorRate = unitsWithCompetitorData > 0 
          ? totalCompetitorRate / unitsWithCompetitorData 
          : 0;
        
        // Calculate price position using adjusted competitor rates
        // This gives us the actual market position using properly adjusted rates
        let pricePosition = 0;
        if (avgCompetitorRate > 0 && avgTrilogyRateWithComp > 0) {
          pricePosition = ((avgTrilogyRateWithComp - avgCompetitorRate) / avgCompetitorRate) * 100;
        }
          
        // Calculate revenue impact (simplified)
        const currentMonthlyRevenue = avgRate * metrics.occupiedUnits * 30;
        const potentialRevenue = avgRate * metrics.totalUnits * 30 * 0.95; // Assume 95% max occupancy
        const revenueImpact = potentialRevenue - currentMonthlyRevenue;

        // Find campus info for region and division (name field is the KeyStats name)
        const campusInfo = campusDataMap.get(campusId);
        const campusRegion = campusInfo?.region || 'Unknown';
        const campusDivision = campusInfo?.division || 'Unknown';
        
        // Apply filters
        if (region && region !== 'all' && campusRegion !== region) {
          return;
        }
        
        if (division && division !== 'all' && campusDivision !== division) {
          return;
        }

        // Determine primary service line for this campus
        const serviceLineCounts = metrics.units.reduce((acc: any, u: any) => {
          const sl = u.serviceLine || 'Unknown';
          acc[sl] = (acc[sl] || 0) + 1;
          return acc;
        }, {});
        const primaryServiceLine = Object.entries(serviceLineCounts)
          .sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'All';

        campusesData.push({
          campusId,
          campusName: campusInfo?.name || campusId,
          region: campusRegion,
          division: campusDivision,
          serviceLine: primaryServiceLine,
          avgRate: Math.round(avgRate),
          avgHcDailyRate: Math.round(avgHcDailyRate), // HC daily rate
          avgSeniorHousingMonthlyRate: Math.round(avgSeniorHousingMonthlyRate), // Senior Housing monthly rate
          hcUnits,
          seniorHousingUnits,
          occupancy,
          occupiedUnits: metrics.occupiedUnits,  // Add occupied units for weighted avg
          competitorAvgRate: Math.round(avgCompetitorRate), // Use adjusted competitor rate
          pricePosition,
          revenueImpact,
          potentialRevenue,
          unitsCount: metrics.totalUnits,
          vacantUnits: metrics.vacantUnits,
          avgLOS: 0, // Would calculate from actual data
          marketShareScore: occupancy * 100
        });
      });

      // Calculate portfolio summary with proper weighted averages
      const totalOccupiedUnits = campusesData.reduce((sum, c) => sum + (c.occupiedUnits || 0), 0);
      const totalRentRevenue = campusesData.reduce((sum, c) => 
        sum + (c.avgRate * (c.occupiedUnits || 0)), 0);
      const totalUnits = campusesData.reduce((sum, c) => sum + c.unitsCount, 0);
      
      // Calculate weighted average price position (by number of units with competitor data)
      let totalWeightedPosition = 0;
      let totalUnitsWithData = 0;
      campusesData.forEach(campus => {
        // Only include campuses with actual competitor data in the average
        if (campus.pricePosition !== 0 && campus.competitorAvgRate > 0) {
          totalWeightedPosition += campus.pricePosition * campus.unitsCount;
          totalUnitsWithData += campus.unitsCount;
        }
      });
      
      // Calculate average rates by service line type for portfolio summary
      const totalHcUnits = campusesData.reduce((sum, c) => sum + (c.hcUnits || 0), 0);
      const totalSeniorHousingUnits = campusesData.reduce((sum, c) => sum + (c.seniorHousingUnits || 0), 0);
      
      const avgHcDailyRate = totalHcUnits > 0 ?
        campusesData.reduce((sum, c) => sum + (c.avgHcDailyRate * (c.hcUnits || 0)), 0) / totalHcUnits : 0;
      
      const avgSeniorHousingMonthlyRate = totalSeniorHousingUnits > 0 ?
        campusesData.reduce((sum, c) => sum + (c.avgSeniorHousingMonthlyRate * (c.seniorHousingUnits || 0)), 0) / totalSeniorHousingUnits : 0;
      
      const summary = {
        avgPortfolioRate: totalOccupiedUnits > 0 
          ? Math.round(totalRentRevenue / totalOccupiedUnits)
          : 0,
        avgHcDailyRate: Math.round(avgHcDailyRate),  // HC daily rate average
        avgSeniorHousingMonthlyRate: Math.round(avgSeniorHousingMonthlyRate),  // Senior Housing monthly rate average
        avgOccupancy: totalUnits > 0
          ? campusesData.reduce((sum, c) => sum + (c.occupiedUnits || 0), 0) / totalUnits
          : 0,
        avgPricePosition: totalUnitsWithData > 0
          ? totalWeightedPosition / totalUnitsWithData
          : 0,
        totalRevenueOpportunity: campusesData.reduce((sum, c) => sum + c.revenueImpact, 0),
        totalOccupiedUnits,  // Add for dialog display
        totalRentRevenue: Math.round(totalRentRevenue * 30),  // Monthly revenue
        campusesWithCompetitorData: campusesData.filter(c => c.pricePosition !== 0).length
      };

      res.json({
        campuses: campusesData,
        summary
      });
    } catch (error) {
      console.error("Error fetching analytics data:", error);
      res.status(500).json({ error: "Failed to fetch analytics data" });
    }
  });

  // Vacancy scatter plot data endpoint
  app.get("/api/analytics/vacancy-scatter", async (req, res) => {
    try {
      const { location, serviceLine } = req.query;
      
      // Get the most recent month's data from the database
      const mostRecentMonthResult = await db
        .select({ month: sql<string>`MAX(${rentRollData.uploadMonth})` })
        .from(rentRollData);
      const uploadMonth = mostRecentMonthResult[0]?.month || '2025-11';
      
      console.log('Vacancy analysis using upload month:', uploadMonth);
      
      // Get all rent roll data - getRentRollDataFiltered expects month as first param, filters as second
      const filters: any = {};
      if (location) {
        filters.locations = [location as string];
      }
      // Note: getRentRollDataFiltered doesn't support serviceLine filter directly
      // We'll filter by serviceLine in memory after fetching
      let allRentRollData = await storage.getRentRollDataFiltered(uploadMonth, filters);
      
      // Filter by service line if provided
      if (serviceLine) {
        allRentRollData = allRentRollData.filter(unit => unit.serviceLine === serviceLine);
      }
      
      // Calculate campus occupancy by location
      const campusMetrics = new Map<string, { occupied: number; total: number; occupancy: number }>();
      
      allRentRollData.forEach(unit => {
        const campus = unit.location;
        if (!campusMetrics.has(campus)) {
          campusMetrics.set(campus, { occupied: 0, total: 0, occupancy: 0 });
        }
        const metrics = campusMetrics.get(campus)!;
        
        // For senior housing, count units (A-beds only), for HC count all beds
        const isHC = unit.serviceLine === 'HC' || unit.serviceLine === 'HC/MC';
        const isBBed = unit.roomNumber?.toString().toUpperCase().endsWith('B');
        
        if (isHC || !isBBed) {  // Count all HC beds, but only A-beds for senior housing
          metrics.total++;
          if (unit.occupiedYN) {
            metrics.occupied++;
          }
        }
      });
      
      // Calculate occupancy for each campus
      campusMetrics.forEach((metrics, campus) => {
        metrics.occupancy = metrics.total > 0 ? (metrics.occupied / metrics.total) : 0;
      });
      
      // Get vacant units and B-beds
      const vacancyData: any[] = [];
      
      allRentRollData.forEach(unit => {
        const isHC = unit.serviceLine === 'HC' || unit.serviceLine === 'HC/MC';
        const isBBed = unit.roomNumber?.toString().toUpperCase().endsWith('B');
        
        // Include if:
        // 1. Unit is vacant (not occupied)
        // 2. OR it's a B-bed in HC (always show B-beds)
        if (!unit.occupiedYN || (isHC && isBBed)) {
          const campusOccupancy = campusMetrics.get(unit.location)?.occupancy || 0;
          
          vacancyData.push({
            id: `${unit.location}-${unit.roomNumber}`,
            location: unit.location,
            serviceLine: unit.serviceLine,
            roomNumber: unit.roomNumber,
            roomType: unit.roomType,
            daysVacant: unit.daysVacant || 0,
            campusOccupancy: campusOccupancy * 100, // Convert to percentage
            streetRate: unit.streetRate || 0,
            isBBed,
            isVacant: !unit.occupiedYN,
            unitType: isBBed ? 'B-Bed' : 'A-Bed'
          });
        }
      });
      
      // Sort by days vacant descending for better visualization
      vacancyData.sort((a, b) => b.daysVacant - a.daysVacant);
      
      res.json({
        units: vacancyData,
        summary: {
          totalVacantUnits: vacancyData.filter(u => u.isVacant && !u.isBBed).length,
          totalBBeds: vacancyData.filter(u => u.isBBed).length,
          avgDaysVacant: vacancyData.length > 0 
            ? vacancyData.reduce((sum, u) => sum + u.daysVacant, 0) / vacancyData.length 
            : 0,
          maxDaysVacant: Math.max(...vacancyData.map(u => u.daysVacant), 0)
        }
      });
    } catch (error) {
      console.error("Error fetching vacancy scatter data:", error);
      res.status(500).json({ error: "Failed to fetch vacancy scatter data" });
    }
  });

  // AI Insights
  app.post("/api/ai/suggest", async (req, res) => {
    try {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return res.status(400).json({ error: "OPENAI_API_KEY not configured" });
      }

      const rentRollData = await storage.getRentRollData();
      const competitors = await storage.getCompetitors();
      
      // Create context for AI
      const context = {
        totalUnits: rentRollData.length,
        occupancyRate: rentRollData.filter(u => u.occupiedYN).length / rentRollData.length,
        averageRent: rentRollData.reduce((sum, u) => sum + u.baseRent, 0) / rentRollData.length,
        vacantUnitsOver30Days: rentRollData.filter(u => !u.occupiedYN && (u.daysVacant || 0) > 30).length,
        competitorCount: competitors.length,
        marketSentiment: marketDataCache.lastMonthReturnPct > 1 ? "bullish" : marketDataCache.lastMonthReturnPct < -1 ? "bearish" : "neutral"
      };

      const prompt = `As a revenue management expert, analyze this senior living property data and provide 3-4 specific pricing recommendations:

Property Context:
- Total Units: ${context.totalUnits}
- Occupancy Rate: ${(context.occupancyRate * 100).toFixed(1)}%
- Average Rent: $${context.averageRent.toFixed(0)}
- Vacant Units (30+ days): ${context.vacantUnitsOver30Days}
- Market Sentiment: ${context.marketSentiment}
- Competitors Tracked: ${context.competitorCount}

Provide actionable insights focusing on:
1. Pricing strategy adjustments
2. Occupancy optimization tactics
3. Market positioning recommendations
4. Risk mitigation suggestions

Keep recommendations specific and quantitative when possible.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800,
          temperature: 0.7
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const result = await response.json();
      res.json({ 
        ok: true, 
        text: result.choices[0].message.content 
      });

    } catch (error) {
      res.status(500).json({ error: `AI analysis failed: ${error.message}` });
    }
  });

  // Smart Analytics Training (formerly ML)
  app.post("/api/ai/train", upload.single("file"), async (req, res) => {
    try {
      let trainingData = [];
      let rows = 0;

      if (req.file) {
        // Use uploaded file
        const csvText = req.file.buffer.toString();
        const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        trainingData = results.data;
        rows = trainingData.length;
      } else {
        // Use current rent roll data as training set
        const rentRollData = await storage.getRentRollData();
        trainingData = rentRollData.map(unit => ({
          rent: unit.baseRent,
          room_type: unit.roomType,
          occupied: unit.occupiedYN ? 1 : 0,
          days_vacant: unit.daysVacant || 0,
          competitor_rate: unit.competitorBenchmarkRate || unit.baseRent
        }));
        rows = trainingData.length;
      }

      if (rows < 10) {
        return res.status(400).json({ error: "Need at least 10 rows for training" });
      }

      // Mock ML training (in real app would use scikit-learn via Python service or TensorFlow.js)
      const r2Score = 0.75 + Math.random() * 0.2; // Mock R² between 0.75-0.95

      const model = await storage.createMlModel({
        name: "PricingModel_v" + Date.now(),
        r2Score,
        trainingRows: rows,
        modelData: { 
          type: "linear_regression",
          features: ["room_type", "occupied", "days_vacant", "competitor_rate"],
          trainedAt: new Date().toISOString()
        }
      });

      res.json({ 
        ok: true, 
        r2: r2Score,
        rows,
        model_id: model.id
      });

    } catch (error) {
      res.status(500).json({ error: "Analytics training failed" });
    }
  });

  // Seed demo data endpoint - DISABLED (using production data only)
  app.post("/api/seed-demo-DISABLED", async (req, res) => {
    return res.status(410).json({ error: "Demo seed endpoint disabled. Use production data import instead." });
    /* OLD DEMO CODE:
    try {
      // Clear existing data
      await storage.clearRentRollData();
      await storage.clearCompetitors();
      
      // Get all locations first
      const allLocations = await storage.getLocations();
      
      // Generate 3 competitors per location with proper location matching
      const competitorNames = [
        "Golden Years", "Harmony House", "Serenity Springs", "Willows Care",
        "Garden Plaza", "Autumn Leaves", "Crystal Springs", "Haven Health",
        "Comfort Care", "Liberty Lodge", "Peaceful Pines", "Caring Hands",
        "Meadowbrook", "Riverside", "Summit View", "Cornerstone", "Bridgeview"
      ];
      
      for (const location of allLocations) {
        for (let i = 0; i < 3; i++) {
          // Generate nearby coordinates (within ~20 minutes driving)
          const angle = (Math.random() * 2 * Math.PI);
          const distance = 0.05 + (Math.random() * 0.15); // 3-12 miles radius
          const latOffset = Math.cos(angle) * distance;
          const lngOffset = Math.sin(angle) * distance;
          
          // Generate A/B/C rating
          const qualityRatings = ['A', 'B', 'C'];
          const qualityWeights = [0.25, 0.50, 0.25]; // 25% A, 50% B, 25% C
          let rating = 'B';
          const rand = Math.random();
          if (rand < qualityWeights[0]) rating = 'A';
          else if (rand > qualityWeights[0] + qualityWeights[1]) rating = 'C';
          
          const competitorName = competitorNames[(allLocations.indexOf(location) * 3 + i) % competitorNames.length] + ' Senior Living';
          
          const competitorRates = {
            "Studio": Math.round(3400 + (Math.random() - 0.5) * 400),
            "One Bedroom": Math.round(4400 + (Math.random() - 0.5) * 500), 
            "Two Bedroom": Math.round(5400 + (Math.random() - 0.5) * 600),
            "Memory Care": Math.round(6400 + (Math.random() - 0.5) * 700)
          };
          
          await storage.createCompetitor({
            name: competitorName,
            location: location.name, // Match our property location names for filtering
            lat: location.latitude + latOffset,
            lng: location.longitude + lngOffset,
            rating: rating,
            avgCareRate: Math.round(800 + (Math.random() - 0.5) * 300),
            rates: competitorRates
          });
        }
      }
      
      // Add demo rent roll data for "Sunset Manor" 
      const currentMonth = new Date().toISOString().slice(0, 7); // Format: YYYY-MM
      const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      
      for (const unit of demoRentRoll) {
        await storage.createRentRollData({
          uploadMonth: currentMonth,
          date: currentDate,
          location: "Main Building",
          roomNumber: unit.unitId,
          roomType: unit.roomType,
          serviceLine: unit.serviceLine,
          occupiedYN: unit.occupiedYN,
          daysVacant: unit.daysVacant,
          preferredLocation: null,
          size: unit.roomType,
          view: unit.attributes?.view ? "Garden View" : null,
          renovated: unit.attributes?.renovated || false,
          otherPremiumFeature: null,
          locationRating: "A",
          sizeRating: "A", 
          viewRating: unit.attributes?.view ? "A" : "C",
          renovationRating: unit.attributes?.renovated ? "A" : "C",
          amenityRating: "B",
          streetRate: unit.baseRent,
          inHouseRate: unit.baseRent * 0.9,
          discountToStreetRate: null,
          careLevel: unit.careFee ? "Assisted" : "Independent",
          careRate: unit.careFee,
          rentAndCareRate: unit.baseRent + (unit.careFee || 0),
          competitorRate: unit.competitorBenchmarkRate,
          competitorAvgCareRate: null,
          competitorFinalRate: unit.competitorBenchmarkRate,
          moduloSuggestedRate: null,
          aiSuggestedRate: null,
          promotionAllowance: null
        });
      }
      
      // Set default assumptions
      await storage.createOrUpdateAssumptions({
        startPeriod: "2024-01",
        months: 12,
        revenueMonthlyGrowthPct: 2.0,
        sp500MonthlyReturnPct: 1.5,
        targetOccupancy: 0.92
      });
      
      // Set default weights (convert to integers - percentages)
      await storage.createOrUpdateWeights({
        occupancyPressure: 25, // 25%
        daysVacantDecay: 20,   // 20%
        seasonality: 10,       // 10%
        competitorRates: 20,   // 20%
        stockMarket: 10        // 10%
      });
      
      // Add guardrails
      await storage.createOrUpdateGuardrails({
        roomType: "Studio",
        minRent: 2800,
        maxRent: 3500,
        attributeModifiers: {
          view: { min: 50, max: 200 },
          renovated: { min: 50, max: 150 },
          corner: { min: 25, max: 100 }
        }
      });
      
      await storage.createOrUpdateGuardrails({
        roomType: "One Bedroom",
        minRent: 3800,
        maxRent: 4800,
        attributeModifiers: {
          view: { min: 75, max: 250 },
          renovated: { min: 75, max: 200 },
          corner: { min: 50, max: 150 }
        }
      });
      
      await storage.createOrUpdateGuardrails({
        roomType: "Two Bedroom",
        minRent: 4800,
        maxRent: 6000,
        attributeModifiers: {
          view: { min: 100, max: 300 },
          renovated: { min: 100, max: 250 },
          corner: { min: 75, max: 200 }
        }
      });
      
      await storage.createOrUpdateGuardrails({
        roomType: "Memory Care",
        minRent: 4500,
        maxRent: 5500,
        attributeModifiers: {}
      });
      
      // Generate rate card summary after seeding
      await storage.generateRateCard(currentMonth);
      
      // Also generate rate card for September 2025 (current default month in UI)
      const currentDefaultMonth = "2025-09";
      if (currentDefaultMonth !== currentMonth) {
        const septemberUnits = await storage.getRentRollDataByMonth(currentDefaultMonth);
        if (septemberUnits.length > 0) {
          await storage.generateRateCard(currentDefaultMonth);
        }
      }
      
      res.json({ 
        ok: true, 
        message: "Demo data seeded successfully",
        competitors: allLocations.length * 3,
        units: 0
      });
    } catch (error) {
      console.error("Seed error:", error);
      res.status(500).json({ error: "Failed to seed demo data" });
    }
    */
  });

  // Template download endpoint - exports current portfolio data as template
  app.get("/api/template/download", async (req, res) => {
    try {
      // Get all rent roll data to export as template
      const portfolioData = await storage.getRentRollData();
      
      let templateData;
      
      if (portfolioData.length > 0) {
        // Export actual portfolio data
        templateData = portfolioData.map(unit => ({
          Date: unit.date || '2024-01-01',
          Region: unit.region || 'East',
          Division: unit.division || 'Mid-Atlantic',
          Location: unit.location,
          'Room Number': unit.roomNumber,
          'Room Type': unit.roomType,
          'Service Line': unit.serviceLine || 'AL',
          'Occupied Y/N': unit.occupiedYN ? 'Y' : 'N',
          'Days Vacant': unit.daysVacant || 0,
          'Preferred Location': unit.preferredLocation || 'N',
          Size: unit.size || unit.roomType,
          View: unit.view || 'Standard',
          Renovated: unit.renovated || 'N',
          'Other Premium Feature': unit.otherPremiumFeature || '',
          'Location Rating': unit.locationRating || 'B',
          'Size Rating': unit.sizeRating || 'B',
          'View Rating': unit.viewRating || 'B',
          'Renovation Rating': unit.renovationRating || 'B',
          'Amenity Rating': unit.amenityRating || 'B',
          'Street Rate': unit.streetRate || 0,
          'In-House Rate': unit.inHouseRate || 0,
          'Discount to Street Rate': unit.discountToStreetRate || 0,
          'Care Level': unit.careLevel || 'Level 1',
          'Care Rate': unit.careRate || 0,
          'Rent and Care Rate': unit.rentAndCareRate || 0,
          'Competitor Rate': unit.competitorRate || 0,
          'Competitor Avg Care Rate': unit.competitorAvgCareRate || 0,
          'Competitor Final Rate': unit.competitorFinalRate || 0,
          'Modulo Suggested Rate': unit.moduloSuggestedRate || 0,
          'AI Suggested Rate': unit.aiSuggestedRate || 0,
          'Promotion Allowance': unit.promotionAllowance || 0
        }));
      } else {
        // If no data, provide template with example row
        templateData = [
          {
            date: '2024-01-01',
            region: 'North',
            division: 'Northeast',
            location: 'Example Campus',
            'room number': 'AL101',
            'room type': 'Studio',
            'service line': 'AL',
            'occupied Y/N': 'Y',
            'days vacant': 0,
            'preferred location': 'Yes',
            size: 'Studio',
            view: 'Garden View',
            renovated: 'Yes',
            'other premium feature': 'Kitchenette, Walk-in Shower',
            'location rating': 'A',
            'size rating': 'B',
            'view rating': 'A',
            'renovation rating': 'A',
            'amenity rating': 'B',
            'street rate': 3200,
            'in-house rate': 3000,
            'discount to street rate': 200,
            'care level': 'Level 1',
            'care rate': 500,
            'rent and care rate': 3500,
            'competitor rate': 3150,
            'competitor average care rate': 480,
            'competitor final rate': 3630,
            'modulo suggested rate': 3250,
            'ai suggested rate': 3300,
            'promotion allowance': 100
          }
        ];
      }

      const worksheet = xlsx.utils.json_to_sheet(templateData);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, 'Portfolio Data');

      // Write to buffer
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=portfolio_template.xlsx');
      res.send(buffer);
    } catch (error) {
      console.error('Template download error:', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  });

  // Data upload endpoint
  app.post("/api/upload/rent-roll", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Get upload date from request body (format: YYYY-MM-DD)
      const uploadDate = req.body.uploadDate;
      if (!uploadDate) {
        return res.status(400).json({ error: 'Upload date is required' });
      }

      // Extract year-month from upload date (YYYY-MM format)
      const uploadMonth = uploadDate.substring(0, 7);

      const buffer = req.file.buffer;
      let jsonData: any[] = [];

      // Parse file based on type
      if (req.file.originalname.endsWith('.csv')) {
        const csvText = buffer.toString();
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        jsonData = parsed.data as any[];
      } else if (req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls')) {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        jsonData = xlsx.utils.sheet_to_json(worksheet);
      } else {
        return res.status(400).json({ error: 'Unsupported file format. Please use CSV or Excel files.' });
      }

      if (jsonData.length === 0) {
        return res.status(400).json({ error: 'No data found in file' });
      }

      // Helper function to normalize column names for robust matching
      // Handles Unicode spaces (U+00A0), extra whitespace, case differences, punctuation
      const normalizeColumnName = (name: string): string => {
        if (!name) return '';
        return name
          .toLowerCase()
          .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ') // Replace Unicode spaces with regular space
          .replace(/[^\w\s]/g, '') // Remove punctuation
          .replace(/\s+/g, '') // Remove all whitespace
          .trim();
      };

      // Create a normalized column map for efficient lookup
      const columnMap = new Map<string, string>();
      if (jsonData.length > 0) {
        const originalHeaders = Object.keys(jsonData[0]);
        console.log('=== CSV HEADER DEBUG ===');
        console.log('Original headers:', originalHeaders);
        
        // Build normalized column map
        for (const header of originalHeaders) {
          const normalized = normalizeColumnName(header);
          columnMap.set(normalized, header);
          console.log(`  "${header}" → normalized: "${normalized}"`);
        }
        
        // Debug: Show sample of first row
        console.log('First row sample (first 5 fields):');
        originalHeaders.slice(0, 5).forEach(header => {
          console.log(`  ${header}: ${jsonData[0][header]}`);
        });
        console.log('======================');
      }

      // Helper function to get value from row with robust column name matching
      const getRowValue = (row: any, ...columnNames: string[]): any => {
        // Try exact match first (fast path)
        for (const colName of columnNames) {
          if (row[colName] !== undefined && row[colName] !== null && row[colName] !== '') {
            return row[colName];
          }
        }
        
        // Try normalized matching (handles Unicode spaces, extra whitespace, case, punctuation)
        for (const colName of columnNames) {
          const normalized = normalizeColumnName(colName);
          const actualColName = columnMap.get(normalized);
          if (actualColName && row[actualColName] !== undefined && row[actualColName] !== null && row[actualColName] !== '') {
            return row[actualColName];
          }
        }
        
        return '';
      };

      // Function to parse attributes from room type field
      // Examples: "Studio;A Vw;A Loc;B Sz" or "Studio;;;A Vw;B Sz"
      const parseAttributes = (roomTypeString: string): {
        cleanRoomType: string;
        viewRating: string | null;
        sizeRating: string | null;
        locationRating: string | null;
        renovationRating: string | null;
        amenityRating: string | null;
      } => {
        if (!roomTypeString) {
          return {
            cleanRoomType: '',
            viewRating: null,
            sizeRating: null,
            locationRating: null,
            renovationRating: null,
            amenityRating: null
          };
        }

        // Split by semicolon to handle format like "Studio;A Vw;A Loc;B Sz"
        const parts = roomTypeString.split(';').map(part => part.trim()).filter(part => part);
        
        // First part is usually the room type (e.g., "Studio", "1 Bedroom")
        let cleanType = parts.length > 0 ? parts[0] : '';
        let viewRating = null;
        let sizeRating = null;
        let locationRating = null;
        let renovationRating = null;
        let amenityRating = null;

        // Process each part for attribute ratings
        for (const part of parts) {
          // Skip empty parts and the room type (first part)
          if (!part || part === cleanType) continue;

          // Pattern: Letter + space/no-space + attribute code (e.g., "A Vw", "B Sz", "A loc")
          // Extract view rating (Vw)
          const viewMatch = part.match(/^([A-F])\s*Vw$/i);
          if (viewMatch) {
            viewRating = viewMatch[1].toUpperCase();
            continue;
          }

          // Extract size rating (Sz)
          const sizeMatch = part.match(/^([A-F])\s*Sz$/i);
          if (sizeMatch) {
            sizeRating = sizeMatch[1].toUpperCase();
            continue;
          }

          // Extract location rating (Loc)
          const locationMatch = part.match(/^([A-F])\s*Loc$/i);
          if (locationMatch) {
            locationRating = locationMatch[1].toUpperCase();
            continue;
          }

          // Extract renovation rating (Reno)
          const renovationMatch = part.match(/^([A-F])\s*Reno$/i);
          if (renovationMatch) {
            renovationRating = renovationMatch[1].toUpperCase();
            continue;
          }

          // Extract amenity rating (Amen)
          const amenityMatch = part.match(/^([A-F])\s*Amen$/i);
          if (amenityMatch) {
            amenityRating = amenityMatch[1].toUpperCase();
            continue;
          }
        }

        return {
          cleanRoomType: cleanType.trim(),
          viewRating,
          sizeRating,
          locationRating,
          renovationRating,
          amenityRating
        };
      };

      // Normalize service line to standard values (AL, HC, IL, MC, SL)
      const normalizeServiceLine = (serviceLine: string): string => {
        if (!serviceLine) return 'AL';
        
        const normalized = serviceLine.toUpperCase().trim();
        
        // Map compound service lines to primary service line
        if (normalized.includes('HC') || normalized.includes('TCU')) return 'HC';
        if (normalized.includes('AL') && normalized.includes('MC')) return 'AL';
        if (normalized === 'AL' || normalized === 'ASSISTED LIVING') return 'AL';
        if (normalized === 'HC' || normalized === 'HEALTH CENTER' || normalized === 'SKILLED NURSING') return 'HC';
        if (normalized === 'IL' || normalized === 'INDEPENDENT LIVING') return 'SL';
        if (normalized === 'MC' || normalized === 'MEMORY CARE') return 'MC';
        if (normalized === 'SL' || normalized === 'SUPPORTIVE LIVING') return 'SL';
        
        // Default to original value if no match
        return normalized;
      };

      // Process and store data
      const processedRecords: any[] = [];

      for (const row of jsonData) {
        // Get raw room type with attributes
        const rawRoomType = getRowValue(row, 'BedTypeDesc', 'Room Type', 'room type', 'RoomType', 'roomType') || '';
        
        // Parse attributes from room type
        const { cleanRoomType, viewRating, sizeRating, locationRating, renovationRating, amenityRating } = parseAttributes(rawRoomType);

        // Get patient ID to determine vacancy
        const patientId = getRowValue(row, 'PatientID1', 'PatientID', 'patientId', 'patient_id');
        const isOccupied = patientId ? (patientId.toString().trim() !== '') : false;
        
        // Get and normalize service line
        const rawServiceLine = getRowValue(row, 'Service1', 'Service Line', 'service line', 'ServiceLine', 'serviceLine') || 'AL';
        const normalizedServiceLine = normalizeServiceLine(rawServiceLine);

        // Parse competitor fields
        const competitorRateValue = getRowValue(row, 'Competitive Rate', 'competitive rate', 'Competitor Rate', 'competitor rate', 'CompetitiveRate', 'CompetitorRate');
        const competitorAvgCareRateValue = getRowValue(row, 'Competitive Average Care Rate', 'competitive average care rate', 'Competitor Average Care Rate', 'competitor average care rate', 'Competitive Avg Care Rate', 'CompetitiveAvgCareRate');
        const competitorFinalRateValue = getRowValue(row, 'Competitive Final Rate', 'competitive final rate', 'Competitor Final Rate', 'competitor final rate', 'CompetitiveFinalRate', 'CompetitorFinalRate');

        // Get BaseRate1 and handle currency formatting
        const baseRateRaw = getRowValue(row, 'BaseRate1', 'Base Rate', 'base rate', 'Street Rate', 'street rate', 'StreetRate', 'streetRate', 'Rate', 'rate');
        let streetRate = 0;
        if (baseRateRaw) {
          // Remove dollar signs, commas, and parse
          const cleanedValue = baseRateRaw.toString().replace(/[$,]/g, '').trim();
          const parsedRate = parseFloat(cleanedValue);
          streetRate = isNaN(parsedRate) ? 0 : parsedRate;
        }

        const rentRollEntry = {
          uploadMonth: uploadMonth,
          date: getRowValue(row, 'Date', 'date') || uploadDate,
          location: getRowValue(row, 'Location', 'location') || '',
          roomNumber: getRowValue(row, 'Room_Bed', 'Room Number', 'room number', 'RoomNumber', 'roomNumber') || '',
          roomType: cleanRoomType,
          serviceLine: normalizedServiceLine,
          occupiedYN: isOccupied,
          daysVacant: parseInt(getRowValue(row, 'Textbox18', 'Days Vacant', 'days vacant', 'DaysVacant', 'daysVacant')) || 0,
          preferredLocation: getRowValue(row, 'Preferred Location', 'preferred location') || null,
          size: getRowValue(row, 'Size', 'size') || '',
          view: getRowValue(row, 'View', 'view') || null,
          renovated: (getRowValue(row, 'Renovated', 'renovated') || '').toString().toLowerCase() === 'y' || (getRowValue(row, 'Renovated', 'renovated') || '').toString().toLowerCase() === 'yes',
          otherPremiumFeature: getRowValue(row, 'Other Premium Feature', 'other premium feature') || null,
          locationRating: locationRating,
          sizeRating: sizeRating,
          viewRating: viewRating,
          renovationRating: renovationRating,
          amenityRating: amenityRating,
          streetRate: streetRate,
          inHouseRate: parseFloat(getRowValue(row, 'In-House Rate', 'in-house rate', 'InHouseRate', 'inHouseRate')) || 0,
          discountToStreetRate: parseFloat(getRowValue(row, 'Discount to Street Rate', 'discount to street rate')) || 0,
          careLevel: getRowValue(row, 'Care Level', 'care level') || null,
          careRate: parseFloat(getRowValue(row, 'Care Rate', 'care rate')) || 0,
          rentAndCareRate: parseFloat(getRowValue(row, 'Rent and Care Rate', 'rent and care rate')) || 0,
          competitorRate: parseFloat(competitorRateValue) || 0,
          competitorAvgCareRate: parseFloat(competitorAvgCareRateValue) || 0,
          competitorFinalRate: parseFloat(competitorFinalRateValue) || 0,
          moduloSuggestedRate: null,
          aiSuggestedRate: null,
          promotionAllowance: 0,
          residentId: getRowValue(row, 'Resident ID', 'resident id', 'ResidentID', 'residentId') || null,
          residentName: getRowValue(row, 'Resident Name', 'resident name', 'ResidentName', 'residentName') || null,
          moveInDate: getRowValue(row, 'Move In Date', 'move in date', 'MoveInDate', 'moveInDate') || null,
          moveOutDate: getRowValue(row, 'Move Out Date', 'move out date', 'MoveOutDate', 'moveOutDate') || null,
          payorType: getRowValue(row, 'Payor Type', 'payor type', 'PayorType', 'payorType') || null,
          admissionStatus: getRowValue(row, 'Admission Status', 'admission status', 'AdmissionStatus', 'admissionStatus') || null,
          levelOfCare: getRowValue(row, 'Level of Care', 'level of care', 'LevelOfCare', 'levelOfCare') || null,
          medicaidRate: parseFloat(getRowValue(row, 'Medicaid Rate', 'medicaid rate', 'MedicaidRate', 'medicaidRate')) || null,
          medicareRate: parseFloat(getRowValue(row, 'Medicare Rate', 'medicare rate', 'MedicareRate', 'medicareRate')) || null,
          assessmentDate: getRowValue(row, 'Assessment Date', 'assessment date', 'AssessmentDate', 'assessmentDate') || null,
          marketingSource: getRowValue(row, 'Marketing Source', 'marketing source', 'MarketingSource', 'marketingSource') || null,
          inquiryCount: parseInt(getRowValue(row, 'Inquiry Count', 'inquiry count', 'InquiryCount', 'inquiryCount')) || 0,
          tourCount: parseInt(getRowValue(row, 'Tour Count', 'tour count', 'TourCount', 'tourCount')) || 0
        };

        processedRecords.push(rentRollEntry);
      }

      // Log for debugging
      console.log(`Processing ${processedRecords.length} records for upload month: ${uploadMonth}`);
      console.log('Sample record:', processedRecords[0]);
      
      // Debug street rate parsing
      const recordsWithStreetRate = processedRecords.filter(r => r.streetRate > 0).length;
      console.log(`=== STREET RATE VALIDATION ===`);
      console.log(`Records with streetRate > 0: ${recordsWithStreetRate}/${processedRecords.length}`);
      if (recordsWithStreetRate === 0) {
        console.warn('⚠️ WARNING: No street rate data found in CSV. Check BaseRate1 column!');
        // Log first row's BaseRate1 value for debugging
        if (jsonData.length > 0) {
          console.log('First row BaseRate1 raw value:', jsonData[0]['BaseRate1']);
          console.log('Available columns in first row:', Object.keys(jsonData[0]));
        }
      }
      console.log(`===================================`);
      
      // Validate competitor fields were found
      const recordsWithCompRates = processedRecords.filter(r => r.competitorRate > 0).length;
      const recordsWithCompAvgCare = processedRecords.filter(r => r.competitorAvgCareRate > 0).length;
      const recordsWithCompFinal = processedRecords.filter(r => r.competitorFinalRate > 0).length;
      
      console.log('=== COMPETITOR FIELD VALIDATION ===');
      console.log(`Records with competitorRate > 0: ${recordsWithCompRates}/${processedRecords.length}`);
      console.log(`Records with competitorAvgCareRate > 0: ${recordsWithCompAvgCare}/${processedRecords.length}`);
      console.log(`Records with competitorFinalRate > 0: ${recordsWithCompFinal}/${processedRecords.length}`);
      
      if (recordsWithCompRates === 0) {
        console.warn('⚠️ WARNING: No competitor rate data found in CSV. Check column names!');
      }
      console.log('===================================');
      
      // Delete existing data for this upload month and insert new data
      // This prevents duplicates when re-uploading the same month
      console.log(`Deleting existing records for ${uploadMonth}...`);
      await storage.uploadRentRollData(uploadMonth, processedRecords);
      
      // Track upload history
      await storage.createUploadHistory({
        uploadMonth: uploadMonth,
        fileName: req.file.originalname,
        uploadType: 'rent_roll',
        totalRecords: processedRecords.length
      });

      // Generate rate card summary
      await storage.generateRateCard(uploadMonth);

      // Issue 1 fix: Invalidate cache for the uploaded month to force refresh
      // This ensures attribute pricing base rates are recalculated when same month is re-imported
      await invalidateCache(uploadMonth);
      console.log(`Attribute pricing cache invalidated for month: ${uploadMonth}`);

      // Auto-trigger competitor rate matching using the job-based system
      // This is resumable and won't be interrupted by server restarts
      console.log(`Triggering automatic competitor rate matching for ${uploadMonth}...`);
      startCompetitorRateJob(uploadMonth).then(result => {
        console.log(`✅ Competitor rate job started: ${result.jobId} for ${uploadMonth}`);
      }).catch(error => {
        console.error('❌ Error starting competitor rate job:', error);
      });

      res.json({
        message: 'Upload successful',
        recordsProcessed: processedRecords.length,
        uploadMonth: uploadMonth,
        uploadDate: uploadDate
      });

    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to process upload' });
    }
  });

  // Inquiry Data upload endpoint
  app.post("/api/upload/inquiry", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const buffer = req.file.buffer;
      let jsonData: any[] = [];

      // Parse file based on type
      if (req.file.originalname.endsWith('.csv')) {
        const csvText = buffer.toString();
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        jsonData = parsed.data as any[];
      } else if (req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls')) {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        jsonData = xlsx.utils.sheet_to_json(worksheet);
      } else {
        return res.status(400).json({ error: 'Unsupported file format. Please use CSV or Excel files.' });
      }

      if (jsonData.length === 0) {
        return res.status(400).json({ error: 'No data found in file' });
      }

      // Process inquiry data (placeholder - actual storage implementation would go here)
      const currentMonth = new Date().toISOString().substring(0, 7);
      const processedRecords: any[] = [];

      for (const row of jsonData) {
        const inquiryEntry = {
          uploadMonth: currentMonth,
          date: row.Date || row.date || new Date().toISOString().split('T')[0],
          region: row.Region || row.region || '',
          division: row.Division || row.division || '',
          location: row.Location || row.location || '',
          serviceLine: row['Service Line'] || row.serviceLine || row['service line'] || '',
          leadSource: row['Lead Source'] || row.leadSource || row['lead source'] || '',
          inquiryCount: parseInt(row['Inquiry Count'] || row.inquiryCount || row['inquiry count']) || 0,
          tourCount: parseInt(row['Tour Count'] || row.tourCount || row['tour count']) || 0,
          conversionCount: parseInt(row['Conversion Count'] || row.conversionCount || row['conversion count']) || 0,
          conversionRate: parseFloat(row['Conversion Rate'] || row.conversionRate || row['conversion rate']) || 0,
          daysToTour: parseInt(row['Days to Tour'] || row.daysToTour || row['days to tour']) || 0,
          daysToMoveIn: parseInt(row['Days to Move-In'] || row.daysToMoveIn || row['days to move-in']) || 0
        };

        processedRecords.push(inquiryEntry);
      }

      console.log('Inquiry data processed:', processedRecords.length, 'records');

      const { insertInquiryMetricsSchema } = await import('@shared/schema');
      const validatedRecords = processedRecords.map(record => {
        return insertInquiryMetricsSchema.parse(record);
      });

      await storage.bulkInsertInquiryMetrics(currentMonth, validatedRecords);

      await storage.createUploadHistory({
        uploadMonth: currentMonth,
        fileName: req.file.originalname,
        uploadType: 'inquiry_metrics',
        totalRecords: processedRecords.length
      });

      res.json({
        message: 'Upload successful',
        recordsProcessed: processedRecords.length,
        uploadMonth: currentMonth
      });

    } catch (error) {
      console.error('Inquiry upload error:', error);
      res.status(500).json({ error: 'Failed to process inquiry data upload' });
    }
  });

  // Competitor Data upload endpoint
  app.post("/api/upload/competitor", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const buffer = req.file.buffer;
      let jsonData: any[] = [];

      // Parse file based on type
      if (req.file.originalname.endsWith('.csv')) {
        const csvText = buffer.toString();
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        jsonData = parsed.data as any[];
      } else if (req.file.originalname.endsWith('.xlsx') || req.file.originalname.endsWith('.xls')) {
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        jsonData = xlsx.utils.sheet_to_json(worksheet);
      } else {
        return res.status(400).json({ error: 'Unsupported file format. Please use CSV or Excel files.' });
      }

      if (jsonData.length === 0) {
        return res.status(400).json({ error: 'No data found in file' });
      }

      // Process competitor data
      const processedRecords: any[] = [];

      for (const row of jsonData) {
        // Parse lat/lng as null if not provided or 0
        const lat = parseFloat(row.Latitude || row.latitude);
        const lng = parseFloat(row.Longitude || row.longitude);
        
        const competitorEntry = {
          name: row['Competitor Name'] || row.name || row.competitorName || '',
          location: row.Location || row.location || '', // Trilogy location this competitor is for
          roomType: row['Room Type'] || row.roomType || row['room type'] || '',
          streetRate: parseFloat(row['Base Rate'] || row.baseRate || row['base rate'] || row['Street Rate'] || row.streetRate) || 0,
          careLevel2Rate: parseFloat(row['Care Level 2'] || row.careLevel2 || row['care level 2']) || null,
          medicationManagementFee: parseFloat(row['Medication Management Fee'] || row.medicationManagementFee || row['medication management fee']) || null,
          address: row.Address || row.address || '',
          lat: !isNaN(lat) && lat !== 0 ? lat : null,
          lng: !isNaN(lng) && lng !== 0 ? lng : null,
          rank: parseInt(row.Rank || row.rank) || null,
          weight: parseFloat(row.Weight || row.weight) || null,
          rating: row.Rating || row.rating || null,
        };

        processedRecords.push(competitorEntry);
      }

      // Store in database using existing storage interface
      for (const record of processedRecords) {
        await storage.createCompetitor(record);
      }

      res.json({
        message: 'Upload successful',
        recordsProcessed: processedRecords.length
      });

    } catch (error) {
      console.error('Competitor upload error:', error);
      res.status(500).json({ error: 'Failed to process competitor data upload' });
    }
  });

  // Overview dashboard endpoint - Real Trilogy Portfolio Data
  app.get("/api/overview", async (req, res) => {
    try {
      const serviceLineFilter = req.query.serviceLine as string;
      
      // Get the most recent month's data only
      const mostRecentMonthResult = await db
        .select({ month: sql<string>`MAX(${rentRollData.uploadMonth})` })
        .from(rentRollData);
      const mostRecentMonth = mostRecentMonthResult[0]?.month || '2025-11';
      
      // Filter to most recent month only
      const allRentRollData = await db
        .select()
        .from(rentRollData)
        .where(sql`${rentRollData.uploadMonth} = ${mostRecentMonth}`);
      
      // Filter by service line if specified
      const rentRollDataFiltered = serviceLineFilter && serviceLineFilter !== 'All' 
        ? allRentRollData.filter((unit: any) => unit.serviceLine === serviceLineFilter)
        : allRentRollData;
      
      // Get unique campus count
      const uniqueCampuses = new Set(allRentRollData.map((u: any) => u.location)).size;
      
      // Log the actual portfolio size for monitoring
      console.log(`Trilogy Portfolio (${mostRecentMonth}): ${allRentRollData.length} total units across ${uniqueCampuses} campuses`);

      // Calculate room type statistics with service line breakdown for filtered data
      const roomTypeStats = rentRollDataFiltered.reduce((acc: any, unit: any) => {
        // Initialize room type if not exists
        if (!acc[unit.roomType]) {
          acc[unit.roomType] = { 
            overall: { occupied: 0, total: 0 },
            byServiceLine: {}
          };
        }
        
        // Overall stats for room type
        acc[unit.roomType].overall.total++;
        if (unit.occupiedYN) {
          acc[unit.roomType].overall.occupied++;
        }
        
        // Service line specific stats within room type
        if (!acc[unit.roomType].byServiceLine[unit.serviceLine]) {
          acc[unit.roomType].byServiceLine[unit.serviceLine] = { occupied: 0, total: 0 };
        }
        acc[unit.roomType].byServiceLine[unit.serviceLine].total++;
        if (unit.occupiedYN) {
          acc[unit.roomType].byServiceLine[unit.serviceLine].occupied++;
        }
        
        return acc;
      }, {});

      const occupancyByRoomType = Object.entries(roomTypeStats).map(([roomType, stats]: [string, any]) => {
        const roomTypeUnits = rentRollDataFiltered.filter(u => u.roomType === roomType);
        
        // Calculate overall stats for the room type
        const avgRate = roomTypeUnits.length > 0 ? 
          roomTypeUnits.reduce((sum, u) => sum + (u.streetRate || u.inHouseRate || 0), 0) / roomTypeUnits.length : 0;
        
        // Calculate competitor rate - normalize HC daily rates to monthly before averaging
        let avgCompetitorRate = 0;
        if (roomTypeUnits.length > 0) {
          const unitsWithCompetitorData = roomTypeUnits.filter(u => u.competitorRate && u.competitorRate > 0);
          if (unitsWithCompetitorData.length > 0) {
            const normalizedRates = unitsWithCompetitorData.map(u => {
              let rate = u.competitorRate || 0;
              // Convert HC daily rates to monthly (HC rates below $1000 are daily)
              if ((u.serviceLine === 'HC' || u.serviceLine === 'HC/MC') && rate > 0 && rate < 1000) {
                rate = rate * 30.44; // Convert daily to monthly
              }
              return rate;
            });
            avgCompetitorRate = normalizedRates.reduce((sum, rate) => sum + rate, 0) / normalizedRates.length;
          }
        }
        
        // Use stored Modulo rates - same logic as rate card generation
        let avgModuloSuggested = 0;
        if (roomTypeUnits.length > 0) {
          const moduloRates = roomTypeUnits
            .map(u => u.moduloSuggestedRate || 0)
            .filter(rate => rate > 0); // Only include units that have modulo rates
          
          if (moduloRates.length > 0) {
            avgModuloSuggested = moduloRates.reduce((sum, rate) => sum + rate, 0) / moduloRates.length;
          } else {
            // If no stored modulo rates, fall back to street rates
            avgModuloSuggested = avgRate;
          }
        }
        
        // Calculate monthly remainder: Additional Revenue from filling vacant units to reach 95% occupancy
        const currentMonthlyRevenue = avgRate * stats.overall.occupied;
        const targetOccupancy = Math.round(stats.overall.total * 0.95);
        const additionalUnits = Math.max(0, targetOccupancy - stats.overall.occupied);
        // Use the higher of avgModuloSuggested or avgRate for filling vacant units
        const rateForVacantUnits = Math.max(avgModuloSuggested, avgRate);
        const potentialMonthlyRevenue = currentMonthlyRevenue + (rateForVacantUnits * additionalUnits);
        const monthlyRemainder = potentialMonthlyRevenue - currentMonthlyRevenue;
        
        // Calculate service line breakdown for this room type
        const serviceLineBreakdown = Object.entries(stats.byServiceLine).map(([serviceLine, slStats]: [string, any]) => {
          const slUnits = roomTypeUnits.filter(u => u.serviceLine === serviceLine);
          const slAvgRate = slUnits.length > 0 ?
            slUnits.reduce((sum, u) => sum + (u.streetRate || u.inHouseRate || 0), 0) / slUnits.length : 0;
          // Calculate competitor rate - ONLY average units that have competitor data
          let slAvgCompetitorRate = 0;
          if (slUnits.length > 0) {
            // Filter to only units with actual competitor rates
            const unitsWithCompetitorData = slUnits.filter(u => u.competitorRate && u.competitorRate > 0);
            
            if (unitsWithCompetitorData.length > 0) {
              const competitorRates = unitsWithCompetitorData.map(u => {
                let rate = u.competitorRate || 0;
                
                // Convert HC/SMC daily rates to monthly (multiply by 30.44)
                // HC rates below $1000 are likely daily rates that need conversion
                if ((serviceLine === 'HC' || serviceLine === 'HC/MC' || serviceLine === 'SMC') && rate > 0 && rate < 1000) {
                  rate = rate * 30.44; // Convert daily to monthly
                  console.log(`Converting ${serviceLine} daily rate $${(u.competitorRate || 0).toFixed(2)} to monthly: $${rate.toFixed(2)}`);
                }
                
                return rate;
              });
              
              slAvgCompetitorRate = competitorRates.reduce((sum, rate) => sum + rate, 0) / competitorRates.length;
            }
            // If no units have competitor data, slAvgCompetitorRate remains 0
          }
          
          // Calculate modulo rate for this service line
          let slAvgModuloSuggested = 0;
          if (slUnits.length > 0) {
            const slModuloRates = slUnits
              .map(u => u.moduloSuggestedRate || 0)
              .filter(rate => rate > 0);
            
            if (slModuloRates.length > 0) {
              slAvgModuloSuggested = slModuloRates.reduce((sum, rate) => sum + rate, 0) / slModuloRates.length;
            } else {
              slAvgModuloSuggested = slAvgRate;
            }
          }
          
          // Calculate monthly remainder for this service line
          const slCurrentMonthlyRevenue = slAvgRate * slStats.occupied;
          const slTargetOccupancy = Math.round(slStats.total * 0.95);
          const slAdditionalUnits = Math.max(0, slTargetOccupancy - slStats.occupied);
          // Use the higher of avgModuloSuggested or avgRate for filling vacant units
          const slRateForVacantUnits = Math.max(slAvgModuloSuggested, slAvgRate);
          const slPotentialMonthlyRevenue = slCurrentMonthlyRevenue + (slRateForVacantUnits * slAdditionalUnits);
          const slMonthlyRemainder = slPotentialMonthlyRevenue - slCurrentMonthlyRevenue;
          
          return {
            serviceLine,
            occupied: slStats.occupied,
            total: slStats.total,
            occupancyRate: slStats.total > 0 ? Math.round((slStats.occupied / slStats.total) * 100) : 0,
            avgRate: slAvgRate,
            avgCompetitorRate: slAvgCompetitorRate,
            avgModuloRate: slAvgModuloSuggested,
            monthlyRemainder: slMonthlyRemainder
          };
        });
        
        return {
          roomType,
          occupied: stats.overall.occupied,
          total: stats.overall.total,
          occupancyRate: Math.round((stats.overall.occupied / stats.overall.total) * 100),
          avgRate,
          avgCompetitorRate,
          avgModuloRate: avgModuloSuggested,
          monthlyRemainder,
          serviceLineBreakdown  // New field containing breakdown by service line
        };
      });

      // Calculate service line statistics for all data (not filtered)
      // For senior housing (AL, SL, VIL), only count A-beds (units)
      // For HC, count all beds
      const seniorHousingServiceLines = ['AL', 'SL', 'VIL', 'IL', 'AL/MC'];
      const serviceLineStats = allRentRollData.reduce((acc: any, unit: any) => {
        // For senior housing, skip B-beds
        const isSeniorHousing = seniorHousingServiceLines.includes(unit.serviceLine);
        const isBBed = unit.roomNumber && unit.roomNumber.endsWith('/B');
        
        if (isSeniorHousing && isBBed) {
          // Skip B-beds for senior housing
          return acc;
        }
        
        if (!acc[unit.serviceLine]) {
          acc[unit.serviceLine] = { occupied: 0, total: 0 };
        }
        acc[unit.serviceLine].total++;
        if (unit.occupiedYN) {
          acc[unit.serviceLine].occupied++;
        }
        return acc;
      }, {});

      const occupancyByServiceLine = Object.entries(serviceLineStats).map(([serviceLine, stats]: [string, any]) => {
        // Filter units based on service line, excluding B-beds for senior housing
        const isSeniorHousing = seniorHousingServiceLines.includes(serviceLine);
        const serviceLineUnits = allRentRollData.filter(u => {
          if (u.serviceLine !== serviceLine) return false;
          // For senior housing, exclude B-beds
          if (isSeniorHousing && u.roomNumber && u.roomNumber.endsWith('/B')) {
            return false;
          }
          return true;
        });
        
        const avgRate = serviceLineUnits.length > 0 ? 
          serviceLineUnits.reduce((sum, u) => sum + (u.streetRate || u.inHouseRate || 0), 0) / serviceLineUnits.length : 0;
        
        // Calculate competitor rate - normalize HC daily rates to monthly before averaging
        let avgCompetitorRate = 0;
        if (serviceLineUnits.length > 0) {
          const unitsWithCompetitorData = serviceLineUnits.filter(u => u.competitorRate && u.competitorRate > 0);
          if (unitsWithCompetitorData.length > 0) {
            const normalizedRates = unitsWithCompetitorData.map(u => {
              let rate = u.competitorRate || 0;
              // Convert HC daily rates to monthly (HC rates below $1000 are daily)
              if ((serviceLine === 'HC' || serviceLine === 'HC/MC') && rate > 0 && rate < 1000) {
                rate = rate * 30.44; // Convert daily to monthly
              }
              return rate;
            });
            avgCompetitorRate = normalizedRates.reduce((sum, rate) => sum + rate, 0) / normalizedRates.length;
          }
        }
        
        // Use same logic as rate card generation - use stored moduloSuggestedRate values
        let avgModuloSuggested = 0;
        if (serviceLineUnits.length > 0) {
          const moduloRates = serviceLineUnits
            .map(u => u.moduloSuggestedRate || 0)
            .filter(rate => rate > 0); // Only include units that have modulo rates
          
          if (moduloRates.length > 0) {
            avgModuloSuggested = moduloRates.reduce((sum, rate) => sum + rate, 0) / moduloRates.length;
          } else {
            // If no stored modulo rates, fall back to street rates
            avgModuloSuggested = avgRate;
          }
        }
        
        // Calculate monthly remainder: Additional Revenue from filling vacant units to reach 95% occupancy
        const currentMonthlyRevenue = avgRate * stats.occupied;
        const targetOccupancy = Math.round(stats.total * 0.95);
        const additionalUnits = Math.max(0, targetOccupancy - stats.occupied);
        // Use the higher of avgModuloSuggested or avgRate for filling vacant units
        const rateForVacantUnits = Math.max(avgModuloSuggested, avgRate);
        const potentialMonthlyRevenue = currentMonthlyRevenue + (rateForVacantUnits * additionalUnits);
        const monthlyRemainder = potentialMonthlyRevenue - currentMonthlyRevenue;
        
        return {
          serviceLine,
          occupied: stats.occupied,
          total: stats.total,
          occupancyRate: Math.round((stats.occupied / stats.total) * 100),
          avgRate,
          avgCompetitorRate,
          avgModuloRate: avgModuloSuggested,
          monthlyRemainder
        };
      });

      // Get portfolio-wide statistics from locations table
      const portfolioStats = await db
        .select({
          totalLocations: sql<number>`COUNT(*)::int`
        })
        .from(locations);
      
      const portfolioTotalLocations = portfolioStats[0]?.totalLocations || 0;
      
      // Calculate actual units from rent roll data, excluding B beds for senior housing
      // For AL, IL, SL, AL/MC: only count A beds (exclude rooms ending with "/B")
      // For HC: count both A and B beds
      const actualUnits = allRentRollData.filter(unit => {
        const isSeniorHousing = seniorHousingServiceLines.includes(unit.serviceLine);
        const isBBed = unit.roomNumber.endsWith('/B');
        
        // For senior housing, exclude B beds. For HC, include all beds.
        return !isSeniorHousing || !isBBed;
      });
      
      const portfolioTotalUnits = actualUnits.length;
      
      // Units with rent roll data uploaded
      const unitsWithData = actualUnits.length;
      const locationsWithData = uniqueCampuses;
      const occupiedUnits = actualUnits.filter(u => u.occupiedYN).length;
      
      // Import rate normalization service
      const { calculateUnitAnnualRevenue } = await import('./services/rateNormalization');
      
      // IMPORTANT: Use allRentRollData for revenue calculations to include B-bed revenue
      // B-beds are excluded from occupancy counts but their revenue should be counted
      // HC rates are stored as DAILY rates and need conversion to monthly
      const currentAnnualRevenue = allRentRollData.reduce((sum, u) => {
        return sum + calculateUnitAnnualRevenue(u, true); // occupied revenue
      }, 0);
      
      // Potential revenue also includes ALL units including B-beds
      const potentialAnnualRevenue = allRentRollData.reduce((sum, u) => {
        return sum + calculateUnitAnnualRevenue(u, false); // potential revenue at 100% occupancy
      }, 0);

      // Calculate split rates for HC and Senior Housing
      const hcServiceLines = ['HC', 'HC/MC', 'SMC'];
      const seniorServiceLines = ['AL', 'AL/MC', 'SL', 'VIL', 'IL'];
      
      // HC rates
      const hcUnits = allRentRollData.filter((u: any) => hcServiceLines.includes(u.serviceLine));
      const avgHcRate = hcUnits.length > 0
        ? hcUnits.reduce((sum: number, u: any) => sum + (u.streetRate || 0), 0) / hcUnits.length
        : 0;
      
      const hcUnitsWithCompetitor = hcUnits.filter((u: any) => u.competitorRate && u.competitorRate > 0);
      const avgHcCompetitorRate = hcUnitsWithCompetitor.length > 0
        ? hcUnitsWithCompetitor.reduce((sum: number, u: any) => {
            let rate = u.competitorRate || 0;
            // Convert HC daily rates to monthly
            if (rate > 0 && rate < 1000) {
              rate = rate * 30.44;
            }
            return sum + rate;
          }, 0) / hcUnitsWithCompetitor.length
        : 0;
      
      // Senior Housing rates
      const shUnits = allRentRollData.filter((u: any) => {
        if (!seniorServiceLines.includes(u.serviceLine)) return false;
        // Exclude B beds for senior housing
        if (u.roomNumber && u.roomNumber.endsWith('/B')) return false;
        return true;
      });
      
      const avgSeniorHousingRate = shUnits.length > 0
        ? shUnits.reduce((sum: number, u: any) => sum + (u.streetRate || 0), 0) / shUnits.length
        : 0;
      
      const shUnitsWithCompetitor = shUnits.filter((u: any) => u.competitorRate && u.competitorRate > 0);
      const avgSeniorHousingCompetitorRate = shUnitsWithCompetitor.length > 0
        ? shUnitsWithCompetitor.reduce((sum: number, u: any) => sum + (u.competitorRate || 0), 0) / shUnitsWithCompetitor.length
        : 0;

      res.json({
        occupancyByRoomType,
        occupancyByServiceLine,
        currentAnnualRevenue,
        potentialAnnualRevenue,
        totalUnits: portfolioTotalUnits,  // Total across entire portfolio
        unitsWithData,  // Units that have rent roll data
        totalLocations: portfolioTotalLocations,  // Total campuses in portfolio
        locationsWithData,  // Campuses with rent roll data
        occupiedUnits,
        mostRecentMonth,  // Include the month for context
        // Split rates for dashboard display
        avgHcRate,
        avgSeniorHousingRate,
        avgHcCompetitorRate,
        avgSeniorHousingCompetitorRate
      });

    } catch (error) {
      console.error('Overview data error:', error);
      res.status(500).json({ error: 'Failed to fetch overview data' });
    }
  });


  // Census Summary endpoint - provides database vs census view comparison
  app.get("/api/overview/census", async (req, res) => {
    try {
      // Get the most recent month's data only
      const mostRecentMonthResult = await db
        .select({ month: sql<string>`MAX(${rentRollData.uploadMonth})` })
        .from(rentRollData);
      const mostRecentMonth = mostRecentMonthResult[0]?.month || '2025-11';
      
      // Get all rent roll data for most recent month
      const allRentRollData = await db
        .select()
        .from(rentRollData)
        .where(sql`${rentRollData.uploadMonth} = ${mostRecentMonth}`);
      
      // Get total campus count from locations table
      const portfolioStats = await db
        .select({
          totalLocations: sql<number>`COUNT(*)::int`
        })
        .from(locations);
      
      const totalCampuses = 131; // Total Trilogy campuses
      const campusesWithData = new Set(allRentRollData.map(u => u.location)).size;
      const portfolioCoverage = (campusesWithData / totalCampuses) * 100;
      
      // Senior housing service lines (A-beds only for census)
      const seniorHousingServiceLines = ['AL', 'SL', 'VIL', 'AL/MC'];
      
      // Calculate database totals (all beds including A and B)
      const totalBeds = allRentRollData.length;
      const aBeds = allRentRollData.filter(unit => !unit.roomNumber.endsWith('/B')).length;
      const bBeds = allRentRollData.filter(unit => unit.roomNumber.endsWith('/B')).length;
      const occupiedBeds = allRentRollData.filter(unit => unit.occupiedYN).length;
      const databaseOccupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;
      
      // Calculate census totals (filtered for rate card eligible units)
      const censusUnits = allRentRollData.filter(unit => {
        const isSeniorHousing = seniorHousingServiceLines.includes(unit.serviceLine);
        const isBBed = unit.roomNumber.endsWith('/B');
        // For senior housing, exclude B beds. For HC, include all beds.
        return !isSeniorHousing || !isBBed;
      });
      
      const censusTotalBeds = censusUnits.length;
      const censusOccupiedBeds = censusUnits.filter(unit => unit.occupiedYN).length;
      const censusOccupancyRate = censusTotalBeds > 0 ? (censusOccupiedBeds / censusTotalBeds) * 100 : 0;
      
      // Calculate service line breakdown
      const serviceLineBreakdown: any[] = [];
      const serviceLines = [...new Set(allRentRollData.map(u => u.serviceLine))];
      
      for (const serviceLine of serviceLines) {
        const serviceLineUnits = allRentRollData.filter(u => u.serviceLine === serviceLine);
        const slTotalBeds = serviceLineUnits.length;
        const slABeds = serviceLineUnits.filter(unit => !unit.roomNumber.endsWith('/B')).length;
        const slBBeds = serviceLineUnits.filter(unit => unit.roomNumber.endsWith('/B')).length;
        const slOccupiedBeds = serviceLineUnits.filter(unit => unit.occupiedYN).length;
        const slOccupancyRate = slTotalBeds > 0 ? (slOccupiedBeds / slTotalBeds) * 100 : 0;
        
        // Census calculation for this service line
        const isSeniorHousing = seniorHousingServiceLines.includes(serviceLine);
        const censusBeds = isSeniorHousing ? slABeds : slTotalBeds; // A-beds only for senior housing, all beds for HC
        const censusOccupied = serviceLineUnits.filter(unit => {
          if (isSeniorHousing) {
            return unit.occupiedYN && !unit.roomNumber.endsWith('/B');
          }
          return unit.occupiedYN;
        }).length;
        const censusOccupancyRate = censusBeds > 0 ? (censusOccupied / censusBeds) * 100 : 0;
        
        serviceLineBreakdown.push({
          serviceLine,
          totalBeds: slTotalBeds,
          aBeds: slABeds,
          bBeds: slBBeds,
          occupiedBeds: slOccupiedBeds,
          occupancyRate: slOccupancyRate,
          censusBeds,
          censusOccupied,
          censusOccupancyRate
        });
      }
      
      // Sort service lines for consistent display
      serviceLineBreakdown.sort((a, b) => {
        const order = ['AL', 'HC', 'SL', 'VIL', 'IL', 'MC', 'AL/MC'];
        return order.indexOf(a.serviceLine) - order.indexOf(b.serviceLine);
      });
      
      res.json({
        databaseTotals: {
          totalBeds,
          aBeds,
          bBeds,
          occupiedBeds,
          occupancyRate: databaseOccupancyRate
        },
        censusTotals: {
          totalBeds: censusTotalBeds,
          occupiedBeds: censusOccupiedBeds,
          occupancyRate: censusOccupancyRate
        },
        serviceLineBreakdown,
        totalCampuses,
        campusesWithData,
        portfolioCoverage,
        mostRecentMonth
      });
      
    } catch (error) {
      console.error('Census summary error:', error);
      res.status(500).json({ error: 'Failed to fetch census summary data' });
    }
  });

  // Rate card endpoint - shows summary and unit-level view
  app.get("/api/rate-card", async (req, res) => {
    try {
      const { month, regions, divisions, locations, location, page = '1', limit = '1000' } = req.query;
      let targetMonth = month as string || new Date().toISOString().substring(0, 7);
      const pageNum = parseInt(page as string, 10);
      const pageLimit = Math.min(parseInt(limit as string, 10), 5000); // Max 5000 items per page
      
      // Support both 'location' (singular) and 'locations' (plural) for backwards compatibility
      const locationParam = locations || location;
      
      // Get latest month with data if not specified
      if (!month) {
        // Efficient query to get the latest month
        const latestMonthData = await db.select({ uploadMonth: rentRollData.uploadMonth })
          .from(rentRollData)
          .orderBy(desc(rentRollData.uploadMonth))
          .limit(1);
        
        if (latestMonthData.length > 0) {
          targetMonth = latestMonthData[0].uploadMonth;
        }
      }
      
      // Build optimized query with filters applied in database
      let unitLevelData = await storage.getRentRollDataFiltered(targetMonth, {
        regions: Array.isArray(regions) ? regions : (regions ? [regions] : []),
        divisions: Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []),
        locations: Array.isArray(locationParam) ? locationParam : (locationParam ? [locationParam] : []),
        offset: (pageNum - 1) * pageLimit,
        limit: pageLimit
      });
      
      // NOTE: Removed legacy competitor fetching and calculation code
      // Competitor rates are now stored directly in rent_roll_data by the
      // competitor rate matching service and should not be recalculated here
      
      // Filter out B beds for senior housing service lines (AL, IL, SL)
      const seniorHousingServiceLines = ['AL', 'AL/MC', 'SL', 'VIL'];
      unitLevelData = unitLevelData.filter(unit => {
        // If this is a senior housing service line, exclude B beds
        if (seniorHousingServiceLines.includes(unit.serviceLine || '')) {
          const roomNumber = unit.roomNumber || '';
          // Exclude if room number ends with /B or just B (e.g., "501/B" or "501B")
          if (roomNumber.endsWith('/B') || roomNumber.endsWith('B')) {
            return false; // Exclude this unit
          }
        }
        return true; // Include all other units
      });
      
      // NOTE: Competitor rates are already calculated and stored in rent_roll_data by the 
      // competitor rate matching service (processAllUnitsForCompetitorRates).
      // The database already contains:
      //   - competitor_name
      //   - competitor_base_rate
      //   - competitor_rate (adjusted)
      //   - competitor_final_rate (adjusted)
      //   - competitor_care_level2_adjustment
      //   - competitor_med_management_adjustment
      //   - competitor_adjustment_explanation
      // DO NOT recalculate or overwrite these values here - use the database data as-is.

      // NOTE: Modulo rates are already calculated and stored in the database
      // We should NOT recalculate them here as it overrides the correct values
      // The sophisticated pricing algorithm with proper guardrails has already run
      // and saved the results when "Generate Modulo Suggestions" was clicked

      // NOTE: AI rates are also calculated and stored in the database
      // We should NOT recalculate them here as it overrides the correct values
      // The AI pricing algorithm has already run and saved the results
      // Use the database values as-is without modification

      // Calculate summary dynamically from filtered units
      // This ensures the summary respects location/region/division filters
      const summaryByServiceLine: Record<string, {
        serviceLine: string;
        totalUnits: number;
        occupancyCount: number;
        totalStreetRate: number;
        totalModuloRate: number;
        totalAiRate: number;
        moduloCount: number;
        aiCount: number;
      }> = {};
      
      for (const unit of unitLevelData) {
        const sl = unit.serviceLine || 'Unknown';
        if (!summaryByServiceLine[sl]) {
          summaryByServiceLine[sl] = {
            serviceLine: sl,
            totalUnits: 0,
            occupancyCount: 0,
            totalStreetRate: 0,
            totalModuloRate: 0,
            totalAiRate: 0,
            moduloCount: 0,
            aiCount: 0
          };
        }
        
        summaryByServiceLine[sl].totalUnits++;
        if (unit.occupiedYN) {
          summaryByServiceLine[sl].occupancyCount++;
        }
        
        const rate = unit.occupiedYN ? (unit.inHouseRate || unit.streetRate || 0) : (unit.streetRate || 0);
        summaryByServiceLine[sl].totalStreetRate += rate;
        
        if (unit.moduloSuggestedRate && unit.moduloSuggestedRate > 0) {
          summaryByServiceLine[sl].totalModuloRate += unit.moduloSuggestedRate;
          summaryByServiceLine[sl].moduloCount++;
        }
        
        if (unit.aiSuggestedRate && unit.aiSuggestedRate > 0) {
          summaryByServiceLine[sl].totalAiRate += unit.aiSuggestedRate;
          summaryByServiceLine[sl].aiCount++;
        }
      }
      
      const rateCardSummary = Object.values(summaryByServiceLine).map(summary => ({
        serviceLine: summary.serviceLine,
        totalUnits: summary.totalUnits,
        occupancyCount: summary.occupancyCount,
        averageStreetRate: summary.totalUnits > 0 ? summary.totalStreetRate / summary.totalUnits : 0,
        averageModuloRate: summary.moduloCount > 0 ? summary.totalModuloRate / summary.moduloCount : null,
        averageAiRate: summary.aiCount > 0 ? summary.totalAiRate / summary.aiCount : null
      }));

      res.json({
        summary: rateCardSummary,
        units: unitLevelData,
        month: targetMonth
      });
    } catch (error) {
      console.error('Rate card error:', error);
      res.status(500).json({ error: 'Failed to fetch rate card data' });
    }
  });

  // Import optimized Modulo endpoint
  const { generateModuloOptimized } = await import('./optimizedModuloEndpoint');
  
  // Generate Modulo pricing suggestions - OPTIMIZED VERSION
  app.post("/api/pricing/generate-modulo", async (req, res) => {
    // Use the optimized implementation for better performance with large datasets
    return generateModuloOptimized(req, res);
  });
  
  // Scheduled calculation endpoint - for automated daily runs at 6am
  app.post("/api/pricing/scheduled-calculation", async (req, res) => {
    try {
      // Get the current date to determine target month
      const now = new Date();
      const targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      console.log(`[Scheduled Calculation] Starting scheduled calculation for month: ${targetMonth}`);
      
      // Check if we already have a completed calculation today
      const existingCalc = await storage.getLatestCalculationHistory(null);
      if (existingCalc) {
        const calcDate = new Date(existingCalc.startedAt);
        const today = new Date();
        if (calcDate.toDateString() === today.toDateString() && existingCalc.status === 'completed') {
          console.log(`[Scheduled Calculation] Already completed today at ${calcDate.toISOString()}`);
          return res.json({
            success: true,
            message: 'Calculation already completed today',
            calculationId: existingCalc.id,
            completedAt: existingCalc.completedAt
          });
        }
      }
      
      // Import the job manager
      const { pricingJobManager } = await import('./pricingJobManager');
      
      // Create a calculation history entry for scheduled run
      const historyEntry = await storage.createCalculationHistory({
        calculationType: 'scheduled',
        status: 'started',
        startedAt: new Date(),
        completedAt: null,
        locationId: null, // Portfolio-wide calculation
        uploadMonth: targetMonth,
        totalUnits: null,
        unitsCalculated: null,
        averageModuloRate: null,
        averageAIRate: null,
        errorMessage: null,
        metadata: { triggeredAt: new Date().toISOString() }
      });
      
      // Create a new background job for portfolio-wide calculation
      const jobId = pricingJobManager.createJob({
        month: targetMonth,
        calculationHistoryId: historyEntry.id
      });
      
      console.log(`[Scheduled Calculation] Created pricing job ${jobId} for scheduled calculation`);
      
      res.json({
        success: true,
        message: 'Scheduled calculation started',
        jobId,
        calculationHistoryId: historyEntry.id,
        targetMonth
      });
      
    } catch (error) {
      console.error('[Scheduled Calculation] Error:', error);
      res.status(500).json({ 
        error: 'Failed to start scheduled calculation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // Get calculation history endpoint
  app.get("/api/pricing/calculation-history", async (req, res) => {
    try {
      const { month, locationId } = req.query;
      
      let history;
      if (month) {
        history = await storage.getCalculationHistoryByMonth(month as string);
      } else {
        history = await storage.getLatestCalculationHistory(locationId as string || null);
        history = history ? [history] : [];
      }
      
      res.json({
        success: true,
        history
      });
    } catch (error) {
      console.error('Error fetching calculation history:', error);
      res.status(500).json({ error: 'Failed to fetch calculation history' });
    }
  });
  
  // Original Modulo endpoint (kept for reference, but not used)
  app.post("/api/pricing/generate-modulo-legacy", async (req, res) => {
    try {
      const { month, serviceLine, regions, divisions, locations } = req.body;
      // Default to November 2025 which has the latest data
      const targetMonth = month || '2025-11';
      
      await ensureCacheInitialized(targetMonth);
      
      console.log('DEBUG Modulo Generate - Received month:', month, 'Using targetMonth:', targetMonth, 'serviceLine:', serviceLine);
      
      // Get global default weights for fallback
      const defaultWeights = {
        occupancyPressure: 25,
        daysVacantDecay: 20,
        seasonality: 10,
        competitorRates: 10,
        stockMarket: 10,
        enableWeights: true
      };
      const globalWeights = await storage.getCurrentWeights() || defaultWeights;
      
      // Get guardrails for smart adjustments
      const guardrailsData = await storage.getCurrentGuardrails();
      
      // Get active adjustment rules
      const activeRules = await storage.getAdjustmentRules ? 
        (await storage.getAdjustmentRules()).filter((r: any) => r.isActive) : [];
      
      // Get REAL stock market performance from Alpha Vantage API
      const stockMarketChange = await fetchSP500Data(); // Real S&P 500 monthly return %
      
      // Get all units for the month - always process ALL units regardless of filters
      // This ensures pricing is generated for the entire portfolio
      let units = await storage.getRentRollDataByMonth(targetMonth);
      
      // Filter out B beds for senior housing service lines when calculating occupancy
      // This is important for accurate occupancy-based pricing calculations
      const seniorHousingServiceLines = ['AL', 'AL/MC', 'SL', 'VIL'];
      const allUnitsForOccupancy = units.filter(unit => {
        // For senior housing service lines, exclude B beds from occupancy calculation
        if (seniorHousingServiceLines.includes(unit.serviceLine || '')) {
          const roomNumber = unit.roomNumber || '';
          if (roomNumber.endsWith('/B') || roomNumber.endsWith('B')) {
            return false; // Exclude B beds
          }
        }
        return true; // Include all other units
      });
      
      // Pre-fetch all weights for unique location+serviceLine combinations AND location-only to optimize
      const uniqueCombinations = new Set<string>();
      const uniqueLocations = new Set<string>();
      units.forEach(unit => {
        if (unit.locationId) {
          uniqueLocations.add(unit.locationId);
          if (unit.serviceLine) {
            const key = `${unit.locationId}|${unit.serviceLine}`;
            uniqueCombinations.add(key);
          }
        }
      });
      
      // Build weights cache with 3-tier fallback: specific → location → global
      const weightsCache = new Map<string, any>();
      const locationWeightsCache = new Map<string, any>();
      
      // First, cache location-level weights (serviceLine = NULL)
      for (const locationId of uniqueLocations) {
        const locationWeights = await storage.getWeightsByFilter(locationId, null);
        if (locationWeights) {
          locationWeightsCache.set(locationId, locationWeights);
        }
      }
      
      // Then, cache location+serviceLine-specific weights
      for (const combo of uniqueCombinations) {
        const [locationId, serviceLine] = combo.split('|');
        if (locationId && serviceLine) {
          const specificWeights = await storage.getWeightsByFilter(locationId, serviceLine);
          if (specificWeights) {
            weightsCache.set(combo, specificWeights);
          }
        }
      }
      
      // Helper function to get weights for a specific unit with 3-tier fallback
      const getWeightsForUnit = (unit: any) => {
        if (!unit.locationId) return globalWeights;
        
        // Try location+serviceLine specific first
        if (unit.serviceLine) {
          const specificKey = `${unit.locationId}|${unit.serviceLine}`;
          const specificWeights = weightsCache.get(specificKey);
          if (specificWeights) return specificWeights;
        }
        
        // Fallback to location-level weights
        const locationWeights = locationWeightsCache.get(unit.locationId);
        if (locationWeights) return locationWeights;
        
        // Final fallback to global
        return globalWeights;
      };
      
      // Check if Modulo algorithm is globally enabled (can be overridden per location/service line)
      const weightsEnabled = globalWeights?.enableWeights !== false; // Default to true
      
      console.log('DEBUG Global weights enabled:', weightsEnabled);
      console.log('DEBUG Weights cache size:', weightsCache.size);
      
      console.log(`Generating Modulo for ${units.length} units (Weights ${weightsEnabled ? 'ENABLED' : 'DISABLED'})`);
      
      // Calculate service-line-specific benchmarks using internal street rates
      // Since competitor data may not be service-line-specific, use each service line's
      // own median street rate as the competitive benchmark for that service line
      const serviceLineMedians: Record<string, number> = {};
      const serviceLineStreetRates = units.reduce((groups: any, unit: any) => {
        const sl = unit.serviceLine || 'Unknown';
        if (!groups[sl]) groups[sl] = [];
        if (unit.streetRate && unit.streetRate > 0) {
          groups[sl].push(unit.streetRate);
        }
        return groups;
      }, {});
      
      for (const [serviceLine, rates] of Object.entries(serviceLineStreetRates)) {
        const rateArray = rates as number[];
        if (rateArray.length > 0) {
          const sorted = [...rateArray].sort((a, b) => a - b);
          // Use median street rate as the competitive benchmark for this service line
          serviceLineMedians[serviceLine] = sorted[Math.floor(sorted.length / 2)];
        }
      }
      
      console.log('Service line internal medians (used as competitive benchmark):', serviceLineMedians);
      
      // Calculate service-line-specific occupancy rates using filtered units for senior housing
      const serviceLineOccupancy: Record<string, number> = {};
      const serviceLineStats = allUnitsForOccupancy.reduce((acc: any, unit: any) => {
        const sl = unit.serviceLine || 'Unknown';
        if (!acc[sl]) {
          acc[sl] = { occupied: 0, total: 0 };
        }
        acc[sl].total++;
        if (unit.occupiedYN) {
          acc[sl].occupied++;
        }
        return acc;
      }, {});
      
      for (const [serviceLine, stats] of Object.entries(serviceLineStats)) {
        const { occupied, total } = stats as { occupied: number; total: number };
        serviceLineOccupancy[serviceLine] = total > 0 ? occupied / total : 0;
      }
      
      console.log('Service line occupancy rates (excluding B beds for senior housing):', serviceLineOccupancy);
      
      // Collect all updates in memory first for bulk processing
      const updates: Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }> = [];
      
      // Import the new sophisticated algorithm and explanations
      const moduloPricingModule = await import('./moduloPricingAlgorithm');
      const sentenceExplanationsModule = await import('./sentenceExplanations');
      const { calculateModuloPrice } = moduloPricingModule;
      const { getSentenceExplanation, generateOverallExplanation } = sentenceExplanationsModule;
      
      // Generate Modulo suggestions using sophisticated algorithm
      for (const unit of units) {
        const baseRate = unit.streetRate;
        let suggestion = baseRate;
        let calculationDetails: any;
        let manualRuleApplied = false; // Track if a manual rule matched this unit
        
        // DEBUG: Log for specific HC unit
        const isDebugUnit = unit.streetRate === 11460 && unit.serviceLine === 'HC';
        if (isDebugUnit) {
          console.log('DEBUG HC unit:', unit.id, 'baseRate:', baseRate, 'serviceLine:', unit.serviceLine);
        }
        
        // Get unit-specific weights to check if enabled for this specific unit
        const unitWeights = getWeightsForUnit(unit);
        const unitWeightsEnabled = unitWeights?.enableWeights !== false; // Default to true
        
        // Only run Modulo algorithm if weights are enabled for this unit
        if (unitWeightsEnabled && !manualRuleApplied) {
          // Prepare inputs for sophisticated algorithm
          // Use service-line-specific occupancy instead of campus-level occupancy
          const serviceLineOcc = serviceLineOccupancy[unit.serviceLine] || 0.87;
          const daysVacant = unit.daysVacant || 0;
          
          const monthIndex = new Date(targetMonth).getMonth() + 1;
          
          // Use service-line-specific competitor median with care level 2 and medication management adjustments
          const serviceLineMedian = serviceLineMedians[unit.serviceLine];
          let competitorPrices: number[];
          
          // Try to get adjusted competitor rate using top competitor by weight
          try {
            const topCompetitor = await storage.getTopCompetitorByWeight(unit.campus, unit.serviceLine);
            const trilogyCareLevel2Rate = await storage.getTrilogyCareLevel2Rate(unit.campus, unit.serviceLine);
            
            if (topCompetitor && topCompetitor.streetRate) {
              const { calculateAdjustedCompetitorRate } = await import('./services/competitorAdjustments');
              const adjustmentResult = calculateAdjustedCompetitorRate({
                competitorBaseRate: topCompetitor.streetRate,
                competitorCareLevel2Rate: topCompetitor.careLevel2Rate || 0,
                competitorMedicationManagementFee: topCompetitor.medicationManagementFee || 0,
                trilogyCareLevel2Rate: trilogyCareLevel2Rate || 0
              });
              
              // Use adjusted rate for fairer comparison
              competitorPrices = [adjustmentResult.adjustedRate];
              
              // Store adjustment details for transparency
              if (isDebugUnit) {
                console.log('Competitor adjustment:', adjustmentResult);
              }
            } else if (serviceLineMedian && serviceLineMedian > 0) {
              // Fallback to service-line median without adjustment
              competitorPrices = [serviceLineMedian];
            } else if (unit.competitorRate && unit.competitorRate > 0) {
              // Fallback to unit's specific competitor rate
              competitorPrices = [unit.competitorRate];
            } else {
              // Final fallback: assume competitors are within ±5% of base rate
              competitorPrices = [baseRate * 0.95, baseRate * 1.05];
            }
          } catch (error) {
            // If adjustment fails, use standard logic
            console.error('Competitor adjustment failed:', error);
            if (serviceLineMedian && serviceLineMedian > 0) {
              competitorPrices = [serviceLineMedian];
            } else if (unit.competitorRate && unit.competitorRate > 0) {
              competitorPrices = [unit.competitorRate];
            } else {
              competitorPrices = [baseRate * 0.95, baseRate * 1.05];
            }
          }
          
          // Fetch real Enquire data for demand signals
          // Note: Enquire data table may be empty - using fallback defaults if no data
          let currentDemand = 0;
          let historicalMonths = [];
          
          const demandHistory = historicalMonths.length > 0 ? historicalMonths : [10, 12, 15, 13, 14, 11];
          const demandCurrent = currentDemand > 0 ? currentDemand : 12;
          
          // Use the pricing orchestrator with attribute-based pricing
          const pricingInputs: PricingInputs = {
            occupancy: serviceLineOcc,
            daysVacant,
            monthIndex,
            competitorPrices,
            marketReturn: stockMarketChange / 100,
            demandCurrent,
            demandHistory,
            serviceLine: unit.serviceLine
          };
          
          // Use the unitWeights already fetched from database (Issue 1 fix: no manual construction)
          if (!unitWeights) {
            console.warn(`No weights found for unit ${unit.id}, skipping`);
            continue;
          }
          
          const orchestratorResult = await calculateAttributedPrice(unit, unitWeights, pricingInputs, guardrailsData || undefined);
          suggestion = orchestratorResult.finalPrice;
          
          // Build calculation details with attribute breakdown (Issue 2: all rates preserved)
          calculationDetails = {
            baseRate: orchestratorResult.baseRate,
            baseRateSource: orchestratorResult.baseRateSource,
            attributedRate: orchestratorResult.attributedRate,
            attributeBreakdown: orchestratorResult.attributeBreakdown,
            adjustments: orchestratorResult.moduloDetails.adjustments?.map((adj: any) => ({
              ...adj,
              formula: adj.calculation,
              description: getSentenceExplanation(adj.factor.toLowerCase(), pricingInputs, adj)
            })) || [],
            weights: {
              occupancyPressure: unitWeights.occupancyPressure,
              daysVacantDecay: unitWeights.daysVacantDecay,
              seasonality: unitWeights.seasonality,
              competitorRates: unitWeights.competitorRates,
              stockMarket: unitWeights.stockMarket,
              inquiryTourVolume: unitWeights.inquiryTourVolume
            },
            totalAdjustment: orchestratorResult.moduloDetails.totalAdjustment,
            finalRate: orchestratorResult.finalPrice,
            moduloRate: orchestratorResult.moduloRate,
            appliedRules: [] as string[],
            signals: orchestratorResult.moduloDetails.signals,
            blendedSignal: orchestratorResult.moduloDetails.blendedSignal,
            explanation: generateOverallExplanation(orchestratorResult.moduloDetails, pricingInputs),
            guardrailsApplied: orchestratorResult.guardrailsApplied
          };
        } else if (!manualRuleApplied) {
          // Weights disabled AND no manual rule - start with base rate
          if (isDebugUnit) {
            console.log('DEBUG hit ELSE block - manualRuleApplied:', manualRuleApplied, 'unitWeightsEnabled:', unitWeightsEnabled);
          }
          calculationDetails = {
            baseRate,
            adjustments: [],
            weights: {},
            totalAdjustment: 0,
            finalRate: baseRate,
            appliedRules: [] as string[],
            guardrailsApplied: [],
            weightsDisabled: true
          };
        }
        // If manualRuleApplied is true, calculationDetails was already set above, so don't overwrite it
        
        // Ensure suggestions are different from street rates (minimum 1% change) - only if no manual rule
        if (!manualRuleApplied) {
          const minChange = unit.streetRate * 0.01;
          if (Math.abs(suggestion - unit.streetRate) < minChange) {
            suggestion = unit.streetRate + (Math.random() > 0.5 ? minChange : -minChange);
          }
        }
        
        // Debug final suggestion for HC unit
        if (unit.streetRate === 11460) {
          console.log('DEBUG HC-305 Final values:', {
            streetRate: unit.streetRate,
            finalSuggestion: suggestion,
            roundedSuggestion: Math.round(suggestion),
            guardrailsApplied,
            calculationDetails: {
              finalRate: calculationDetails.finalRate,
              totalAdjustment: calculationDetails.totalAdjustment
            }
          });
        }
        
        // Add to bulk update array
        updates.push({
          id: unit.id,
          moduloSuggestedRate: Math.round(suggestion),
          moduloCalculationDetails: JSON.stringify(calculationDetails)
        });
      }
      
      console.log(`Calculated ${updates.length} Modulo suggestions, applying adjustment rules...`);
      
      // Apply adjustment rules to Modulo rates
      const unitsWithModuloRates = updates.map((update) => {
        const unit = units.find(u => u.id === update.id);
        return {
          id: update.id,
          unit: unit,
          moduloSuggestedRate: update.moduloSuggestedRate
        };
      });
      
      const adjustmentResults = await fetchAndApplyAdjustmentRules(unitsWithModuloRates);
      
      // Merge adjustment results with Modulo updates
      const finalUpdates = updates.map((update, index) => {
        const adjustment = adjustmentResults[index];
        return {
          ...update,
          ruleAdjustedRate: adjustment.ruleAdjustedRate,
          appliedRuleName: adjustment.appliedRuleName
        };
      });
      
      // Count how many units had rules applied
      const rulesAppliedCount = adjustmentResults.filter(r => r.ruleAdjustedRate !== null).length;
      if (rulesAppliedCount > 0) {
        console.log(`Applied adjustment rules to ${rulesAppliedCount} units`);
      }
      
      // Perform bulk update in batches with adjustment rules
      console.log(`Starting bulk database update with Modulo rates and adjustment rules...`);
      await storage.bulkUpdateModuloRates(finalUpdates);
      
      console.log(`Modulo bulk update complete, regenerating rate card...`);
      
      // Regenerate rate card with new suggestions
      await storage.generateRateCard(targetMonth);
      
      console.log(`Modulo generation complete for ${updates.length} units`);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Modulo generation error:', error);
      res.status(500).json({ error: 'Failed to generate Modulo suggestions' });
    }
  });

  // Get modulo calculation details for a specific unit
  app.get("/api/units/:id/modulo-calculation", async (req, res) => {
    try {
      const { id } = req.params;
      const unit = await storage.getRentRollDataById(id);
      
      if (!unit) {
        return res.status(404).json({ error: "Unit not found" });
      }
      
      if (!unit.moduloCalculationDetails) {
        return res.json(null);
      }
      
      // Parse and return calculation details
      const details = JSON.parse(unit.moduloCalculationDetails);
      res.json(details);
    } catch (error) {
      console.error('Error fetching modulo calculation:', error);
      res.status(500).json({ error: "Failed to fetch calculation details" });
    }
  });

  // Generate AI pricing suggestions  
  app.post("/api/pricing/generate-ai", async (req, res) => {
    try {
      const { month, serviceLine, regions, divisions, locations } = req.body;
      const targetMonth = month || new Date().toISOString().substring(0, 7);
      
      await ensureCacheInitialized(targetMonth);
      
      // Get all units for the month
      let units = await storage.getRentRollDataByMonth(targetMonth);
      
      // Apply filters to units
      if (serviceLine) {
        units = units.filter(unit => unit.serviceLine === serviceLine);
      }
      // Skip region/division filtering as these fields don't exist in our data
      // Only apply location filtering if specified
      if (locations && locations.length > 0) {
        units = units.filter(unit => unit.location && locations.includes(unit.location));
      }
      
      // Filter out B beds for senior housing service lines when calculating occupancy
      const seniorHousingServiceLines = ['AL', 'AL/MC', 'SL', 'VIL'];
      const allUnitsForOccupancy = units.filter(unit => {
        // For senior housing service lines, exclude B beds from occupancy calculation
        if (seniorHousingServiceLines.includes(unit.serviceLine || '')) {
          const roomNumber = unit.roomNumber || '';
          if (roomNumber.endsWith('/B') || roomNumber.endsWith('B')) {
            return false; // Exclude B beds
          }
        }
        return true; // Include all other units
      });
      
      console.log(`Generating AI suggestions for ${units.length} units (${allUnitsForOccupancy.length} for occupancy calc)`);
      
      // Collect all updates in memory first for bulk processing
      const aiUpdates: Array<{ id: string; aiSuggestedRate: number; aiCalculationDetails: string }> = [];
      
      // Get AI-specific weights - more aggressive than Modulo
      const weights = await storage.getAiPricingWeights() || {
        occupancyPressure: 30,
        daysVacantDecay: 25,
        competitorRates: 10,
        seasonality: 5,
        stockMarket: 5,
        inquiryTourVolume: 10
      };
      
      // Calculate service-line-specific occupancy for AI adjustments
      const allUnits = await storage.getRentRollData();
      const serviceLineOccupancy: Record<string, number> = {};
      const serviceLineStats = allUnits.reduce((acc: any, unit: any) => {
        const sl = unit.serviceLine || 'Unknown';
        if (!acc[sl]) {
          acc[sl] = { occupied: 0, total: 0 };
        }
        acc[sl].total++;
        if (unit.occupiedYN) {
          acc[sl].occupied++;
        }
        return acc;
      }, {});
      
      for (const [serviceLine, stats] of Object.entries(serviceLineStats)) {
        const { occupied, total } = stats as { occupied: number; total: number };
        serviceLineOccupancy[serviceLine] = total > 0 ? occupied / total : 0.87;
      }
      
      console.log('AI calculation - Service line occupancy rates:', serviceLineOccupancy);
      
      // Get guardrails for AI pricing
      const guardrailsData = await storage.getCurrentGuardrails();
      
      // Generate AI suggestions using sophisticated algorithm with more aggressive parameters
      for (const unit of units) {
        const monthIndex = new Date().getMonth() + 1;
        const competitorPrices = unit.competitorRate ? 
          [unit.competitorRate] : 
          [unit.streetRate * 0.95, unit.streetRate * 1.05];
        
        // AI sees more volatile demand patterns
        const demandHistory = [15, 20, 30, 18, 35, 22, 28, 16];
        const demandCurrent = 32;
        
        // Use service-line-specific occupancy instead of campus-level
        const serviceLineOcc = serviceLineOccupancy[unit.serviceLine] || 0.87;
        
        const pricingInputs: PricingInputs = {
          occupancy: serviceLineOcc,
          daysVacant: unit.daysVacant || 0,
          monthIndex,
          competitorPrices,
          marketReturn: 0.03,
          demandCurrent,
          demandHistory,
          serviceLine: unit.serviceLine
        };
        
        // Get appropriate weights for AI pricing from database (Issue 1 fix: use actual DB weights)
        const pricingWeights = await storage.getWeightsByFilter(unit.locationId, unit.serviceLine) || 
                                await storage.getWeightsByFilter(unit.locationId, null) || 
                                await storage.getPricingWeights();
        
        if (!pricingWeights) {
          console.warn(`No weights found for AI pricing of unit ${unit.id}, skipping`);
          continue;
        }
        
        // Use the pricing orchestrator with attribute-based pricing
        const orchestratorResult = await calculateAttributedPrice(unit, pricingWeights, pricingInputs, guardrailsData || undefined);
        const aiSuggestion = orchestratorResult.finalPrice;
        
        // Store calculation details with attribute breakdown (Issue 2: all rates preserved)
        const aiCalculationDetails = {
          baseRate: orchestratorResult.baseRate,
          baseRateSource: orchestratorResult.baseRateSource,
          attributedRate: orchestratorResult.attributedRate,
          attributeBreakdown: orchestratorResult.attributeBreakdown,
          adjustments: orchestratorResult.moduloDetails.adjustments?.map((adj: any) => ({
            ...adj,
            formula: adj.calculation,
            description: getSentenceExplanation(adj.factor.toLowerCase(), pricingInputs, adj)
          })) || [],
          weights: {
            occupancyPressure: pricingWeights.occupancyPressure,
            daysVacantDecay: pricingWeights.daysVacantDecay,
            seasonality: pricingWeights.seasonality,
            competitorRates: pricingWeights.competitorRates,
            stockMarket: pricingWeights.stockMarket,
            inquiryTourVolume: pricingWeights.inquiryTourVolume
          },
          totalAdjustment: orchestratorResult.moduloDetails.totalAdjustment,
          finalRate: orchestratorResult.finalPrice,
          moduloRate: orchestratorResult.moduloRate,
          signals: orchestratorResult.moduloDetails.signals,
          blendedSignal: orchestratorResult.moduloDetails.blendedSignal,
          explanation: generateOverallExplanation(orchestratorResult.moduloDetails, pricingInputs),
          guardrailsApplied: orchestratorResult.guardrailsApplied
        };
        
        // Add to bulk update array
        aiUpdates.push({
          id: unit.id,
          aiSuggestedRate: Math.round(aiSuggestion),
          aiCalculationDetails: JSON.stringify(aiCalculationDetails)
        });
      }
      
      console.log(`Calculated ${aiUpdates.length} AI suggestions, starting bulk update...`);
      
      // Perform bulk update in batches
      await storage.bulkUpdateAIRates(aiUpdates);
      
      console.log(`AI bulk update complete, regenerating rate card...`);
      
      // Regenerate rate card with AI suggestions
      await storage.generateRateCard(targetMonth);
      
      console.log(`AI generation complete for ${aiUpdates.length} units`);
      
      res.json({ success: true });
    } catch (error) {
      console.error('AI generation error:', error);
      res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
  });

  // Accept pricing suggestions
  app.post("/api/pricing/accept-suggestions", async (req, res) => {
    try {
      const { unitIds, suggestionType, serviceLine } = req.body;
      
      // Track which months need rate card regeneration and changes for history
      const affectedMonths = new Set<string>();
      const changesSnapshot: any[] = [];
      
      for (const unitId of unitIds) {
        const unit = await storage.getRentRollDataById(unitId);
        if (!unit) continue;
        
        const newRate = suggestionType === 'modulo' ? 
          unit.moduloSuggestedRate : unit.aiSuggestedRate;
          
        if (newRate) {
          // Record the change for history
          changesSnapshot.push({
            roomNumber: unit.roomNumber,
            location: unit.location,
            oldRate: unit.streetRate,
            newRate: newRate,
            serviceLine: unit.serviceLine,
            unitId: unit.id
          });
          
          await storage.updateRentRollData(unitId, {
            streetRate: newRate
          });
          
          // Track the upload month for rate card regeneration
          if (unit.uploadMonth) {
            affectedMonths.add(unit.uploadMonth);
          }
        }
      }
      
      // Regenerate rate cards for affected months
      for (const month of affectedMonths) {
        await storage.generateRateCard(month);
      }
      
      // Create pricing history record
      if (changesSnapshot.length > 0) {
        await storage.createPricingHistory({
          actionType: suggestionType === 'modulo' ? 'accept_modulo' : 'accept_ai',
          serviceLine: serviceLine || null,
          unitsAffected: changesSnapshot.length,
          changesSnapshot: changesSnapshot,
          description: `Applied ${suggestionType === 'modulo' ? 'Modulo' : 'AI'} suggestions to ${changesSnapshot.length} units${serviceLine ? ` (${serviceLine})` : ''}`,
          userId: null // Can be populated from session if needed
        });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Accept suggestions error:', error);
      res.status(500).json({ error: 'Failed to accept suggestions' });
    }
  });

  // Pricing history endpoints
  app.get("/api/pricing-history", async (req, res) => {
    try {
      const history = await storage.getPricingHistory(10); // Get last 10 changes
      res.json(history);
    } catch (error) {
      console.error('Error fetching pricing history:', error);
      res.status(500).json({ error: 'Failed to fetch pricing history' });
    }
  });

  app.post("/api/pricing-history/:id/revert", async (req, res) => {
    try {
      const { id } = req.params;
      const historyRecord = await storage.getPricingHistoryById(id);
      
      if (!historyRecord) {
        return res.status(404).json({ error: 'History record not found' });
      }
      
      // Revert the changes
      const changesSnapshot = historyRecord.changesSnapshot as any[];
      const affectedMonths = new Set<string>();
      
      for (const change of changesSnapshot) {
        const unit = await storage.getRentRollDataById(change.unitId);
        if (unit) {
          await storage.updateRentRollData(change.unitId, {
            streetRate: change.oldRate
          });
          
          if (unit.uploadMonth) {
            affectedMonths.add(unit.uploadMonth);
          }
        }
      }
      
      // Regenerate rate cards for affected months
      for (const month of affectedMonths) {
        await storage.generateRateCard(month);
      }
      
      // Create a new history record for the revert action
      await storage.createPricingHistory({
        actionType: 'manual',
        serviceLine: historyRecord.serviceLine,
        unitsAffected: changesSnapshot.length,
        changesSnapshot: changesSnapshot.map(c => ({
          ...c,
          oldRate: c.newRate,
          newRate: c.oldRate
        })),
        description: `Reverted: ${historyRecord.description}`,
        userId: null
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error reverting pricing changes:', error);
      res.status(500).json({ error: 'Failed to revert pricing changes' });
    }
  });

  // Calculate and populate competitor rates - Enhanced version
  app.post("/api/competitor-rates/calculate", async (req, res) => {
    try {
      const { uploadMonth } = req.body;
      
      // Use the comprehensive competitor rate matching service
      const result = await processAllUnitsForCompetitorRates(uploadMonth);
      
      res.json({ 
        success: true,
        processed: result.processed,
        updated: result.updated,
        errors: result.errors,
        summary: {
          totalUnits: result.processed,
          updatedUnits: result.updated,
          failedUnits: result.errors,
          successRate: result.processed > 0 ? ((result.updated / result.processed) * 100).toFixed(2) + '%' : '0%'
        }
      });
    } catch (error) {
      console.error('Error calculating competitor rates:', error);
      res.status(500).json({ error: 'Failed to calculate competitor rates' });
    }
  });
  
  // New endpoint: Calculate competitor rates for specific units
  app.post("/api/pricing/calculate-competitor-rates", async (req, res) => {
    try {
      const { uploadMonth, location, serviceLine } = req.body;
      
      // Use the comprehensive competitor rate matching service
      const result = await processAllUnitsForCompetitorRates(uploadMonth);
      
      // Get summary statistics
      const summary = await getCompetitorRateSummary(uploadMonth);
      
      res.json({ 
        success: true,
        statistics: {
          processed: result.processed,
          updated: result.updated,
          errors: result.errors,
          successRate: result.processed > 0 ? ((result.updated / result.processed) * 100).toFixed(2) + '%' : '0%'
        },
        summary: summary,
        message: `Successfully calculated competitor rates for ${result.updated} units out of ${result.processed} total units.`
      });
    } catch (error) {
      console.error('Error calculating competitor rates:', error);
      res.status(500).json({ error: 'Failed to calculate competitor rates' });
    }
  });
  
  // Get competitor rate summary
  app.get("/api/competitor-rates/summary", async (req, res) => {
    try {
      const { uploadMonth } = req.query;
      const summary = await getCompetitorRateSummary(uploadMonth as string);
      
      res.json({
        success: true,
        summary: summary
      });
    } catch (error) {
      console.error('Error getting competitor rate summary:', error);
      res.status(500).json({ error: 'Failed to get competitor rate summary' });
    }
  });
  
  // Job-based competitor rate matching - Start a new job
  app.post("/api/competitor-rates/job/start", async (req, res) => {
    try {
      const { uploadMonth } = req.body;
      const targetMonth = uploadMonth || '2025-11';
      
      const result = await startCompetitorRateJob(targetMonth);
      
      res.json({
        success: true,
        jobId: result.jobId,
        status: result.status,
        message: `Competitor rate job started for ${targetMonth}. Processing in background.`
      });
    } catch (error) {
      console.error('Error starting competitor rate job:', error);
      res.status(500).json({ error: 'Failed to start competitor rate job' });
    }
  });
  
  // Job-based competitor rate matching - Get job status
  app.get("/api/competitor-rates/job/:jobId", async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await getJobStatus(jobId);
      
      if (!status) {
        return res.status(404).json({ error: 'Job not found' });
      }
      
      res.json({
        success: true,
        job: status
      });
    } catch (error) {
      console.error('Error getting job status:', error);
      res.status(500).json({ error: 'Failed to get job status' });
    }
  });
  
  // Job-based competitor rate matching - Get all jobs for a month
  app.get("/api/competitor-rates/jobs/:uploadMonth", async (req, res) => {
    try {
      const { uploadMonth } = req.params;
      const jobs = await getJobsForMonth(uploadMonth);
      
      res.json({
        success: true,
        jobs: jobs
      });
    } catch (error) {
      console.error('Error getting jobs for month:', error);
      res.status(500).json({ error: 'Failed to get jobs' });
    }
  });
  
  // OPTIMIZED Modulo pricing generation endpoint - uses background processing
  // This endpoint returns immediately with a job ID and processes units in background
  app.post("/api/pricing/generate-modulo-optimized", async (req, res) => {
    try {
      const { month, serviceLine, regions, divisions, locations } = req.body;
      
      // Import the job manager
      const { pricingJobManager } = await import('./pricingJobManager');
      
      // Create a new background job
      const jobId = pricingJobManager.createJob({
        month: month || '2025-10',
        serviceLine,
        regions,
        divisions,
        locations
      });
      
      console.log(`[API] Created pricing job ${jobId} for month: ${month || '2025-10'}`);
      
      // Return immediately with job ID
      res.json({
        success: true,
        jobId,
        message: 'Pricing calculation started in background. Use the job status endpoint to check progress.',
        statusUrl: `/api/pricing/job-status/${jobId}`
      });
    } catch (error) {
      console.error('Error creating pricing job:', error);
      res.status(500).json({ error: 'Failed to start pricing calculation' });
    }
  });
  
  // Get status of a pricing calculation job
  app.get("/api/pricing/job-status/:jobId", async (req, res) => {
    try {
      const { jobId } = req.params;
      
      // Import the job manager
      const { pricingJobManager } = await import('./pricingJobManager');
      
      const job = pricingJobManager.getJob(jobId);
      
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }
      
      res.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        result: job.result,
        params: job.params
      });
    } catch (error) {
      console.error('Error fetching job status:', error);
      res.status(500).json({ error: 'Failed to fetch job status' });
    }
  });
  
  // Get all pricing jobs (for monitoring)
  app.get("/api/pricing/jobs", async (req, res) => {
    try {
      // Import the job manager
      const { pricingJobManager } = await import('./pricingJobManager');
      
      const jobs = pricingJobManager.getAllJobs();
      
      // Sort by startedAt descending (most recent first)
      const sortedJobs = jobs.sort((a, b) => {
        return b.startedAt.getTime() - a.startedAt.getTime();
      });
      
      res.json({
        jobs: sortedJobs,
        hasActiveJobs: pricingJobManager.hasActiveJobs()
      });
    } catch (error) {
      console.error('Error fetching jobs list:', error);
      res.status(500).json({ error: 'Failed to fetch jobs list' });
    }
  });
  
  // Test endpoint: Calculate competitor rates for a small sample
  app.post("/api/competitor-rates/test", async (req, res) => {
    try {
      const { limit = 5, location } = req.body;
      
      // Get a small sample of units for testing
      let units = [];
      if (location) {
        // Test with specific location
        units = await db.select().from(rentRollData)
          .where(eq(rentRollData.location, location))
          .limit(limit);
      } else {
        // Test with locations that have competitors
        const locationsWithCompetitors = ['Batesville - 120', 'Columbus - 107', 'Cynthiana - 114'];
        units = await db.select().from(rentRollData)
          .where(sql`${rentRollData.location} IN (${sql.join(locationsWithCompetitors.map(l => sql`${l}`), sql`,`)})`)
          .limit(limit);
      }
      
      console.log(`Testing competitor rate calculation for ${units.length} units...`);
      
      // Import the function from the service
      const { calculateCompetitorRateForUnit } = await import('./services/competitorRateMatching.js');
      
      const results = [];
      for (const unit of units) {
        const result = await calculateCompetitorRateForUnit(unit);
        
        // Update the database if calculation was successful
        if (result.competitorAdjustedRate !== null) {
          await db.update(rentRollData)
            .set({
              competitorRate: result.competitorAdjustedRate,
              competitorFinalRate: result.competitorAdjustedRate
            })
            .where(eq(rentRollData.id, unit.id));
        }
        
        results.push({
          ...result,
          unitDetails: {
            location: unit.location,
            roomNumber: unit.roomNumber,
            roomType: unit.roomType,
            serviceLine: unit.serviceLine,
            streetRate: unit.streetRate
          }
        });
      }
      
      // Count successes and errors
      const successful = results.filter(r => !r.error).length;
      const failed = results.filter(r => r.error).length;
      
      res.json({
        success: true,
        tested: units.length,
        successful,
        failed,
        results,
        message: `Test completed: ${successful} units calculated successfully, ${failed} failed.`
      });
    } catch (error) {
      console.error('Error in competitor rate test:', error);
      res.status(500).json({ error: 'Failed to test competitor rates' });
    }
  });

  // Attribute ratings endpoints
  app.get("/api/attribute-ratings", async (req, res) => {
    try {
      const ratings = await storage.getAttributeRatings();
      res.json(ratings);
    } catch (error) {
      console.error('Error fetching attribute ratings:', error);
      res.status(500).json({ error: 'Failed to fetch attribute ratings' });
    }
  });

  app.post("/api/attribute-ratings/initialize", async (req, res) => {
    try {
      await storage.initializeDefaultAttributeRatings();
      res.json({ success: true, message: 'Default attribute ratings initialized' });
    } catch (error) {
      console.error('Error initializing attribute ratings:', error);
      res.status(500).json({ error: 'Failed to initialize attribute ratings' });
    }
  });

  app.put("/api/attribute-ratings", async (req, res) => {
    try {
      const { attributeType, ratingLevel, adjustmentPercent, description } = req.body;
      await storage.updateAttributeRating(attributeType, ratingLevel, adjustmentPercent, description);
      res.json({ success: true, message: 'Attribute rating updated' });
    } catch (error) {
      console.error('Error updating attribute rating:', error);
      res.status(500).json({ error: 'Failed to update attribute rating' });
    }
  });
  
  // Issue #3 fix: Preview attribute weight changes
  app.post("/api/attribute-ratings/preview", async (req, res) => {
    try {
      const { proposedRatings } = req.body; // Array of { attributeType, ratingLevel, adjustmentPercent }
      
      // Get sample units to show impact
      const sampleUnits = await db.select()
        .from(rentRollData)
        .limit(20); // Get a sample of units
      
      const previews = [];
      
      for (const unit of sampleUnits) {
        // Calculate current attributed rate
        const currentMultiplier = attributePricingService.calculateAttributeMultiplier(unit);
        const currentAttributedRate = unit.streetRate * currentMultiplier;
        
        // Calculate proposed attributed rate using proposed ratings
        let proposedMultiplier = 1.0;
        const attributes = ['location', 'size', 'view', 'renovation', 'amenity'];
        
        for (const attr of attributes) {
          const ratingKey = `${attr}Rating` as keyof typeof unit;
          const rating = unit[ratingKey] as string | null;
          
          if (rating) {
            const proposed = proposedRatings.find((r: any) => 
              r.attributeType === attr && r.ratingLevel === rating
            );
            
            if (proposed) {
              proposedMultiplier += proposed.adjustmentPercent / 100;
            } else {
              // Use existing rating if not in proposed changes
              const currentAdj = attributePricingService.getAttributeAdjustmentPercent(attr, rating);
              proposedMultiplier += currentAdj / 100;
            }
          }
        }
        
        const proposedAttributedRate = unit.streetRate * proposedMultiplier;
        
        previews.push({
          unitId: unit.id,
          roomNumber: unit.roomNumber,
          location: unit.location,
          serviceLine: unit.serviceLine,
          roomType: unit.roomType,
          streetRate: unit.streetRate,
          currentMultiplier: Math.round(currentMultiplier * 1000) / 1000,
          currentAttributedRate: Math.round(currentAttributedRate),
          proposedMultiplier: Math.round(proposedMultiplier * 1000) / 1000,
          proposedAttributedRate: Math.round(proposedAttributedRate),
          changeAmount: Math.round(proposedAttributedRate - currentAttributedRate),
          changePercent: Math.round(((proposedAttributedRate - currentAttributedRate) / currentAttributedRate) * 100)
        });
      }
      
      // Calculate summary statistics
      const totalCurrentRevenue = previews.reduce((sum, p) => sum + p.currentAttributedRate, 0);
      const totalProposedRevenue = previews.reduce((sum, p) => sum + p.proposedAttributedRate, 0);
      const avgChangePercent = previews.reduce((sum, p) => sum + p.changePercent, 0) / previews.length;
      
      res.json({
        previews,
        summary: {
          unitsAnalyzed: previews.length,
          totalCurrentRevenue: Math.round(totalCurrentRevenue),
          totalProposedRevenue: Math.round(totalProposedRevenue),
          totalChangeAmount: Math.round(totalProposedRevenue - totalCurrentRevenue),
          avgChangePercent: Math.round(avgChangePercent * 10) / 10
        }
      });
    } catch (error) {
      console.error('Error previewing attribute ratings:', error);
      res.status(500).json({ error: 'Failed to preview attribute ratings' });
    }
  });
  
  // Issue #3 fix: Accept proposed attribute weights and refresh pricing
  app.post("/api/attribute-ratings/accept", async (req, res) => {
    try {
      const { proposedRatings } = req.body; // Array of { attributeType, ratingLevel, adjustmentPercent, description }
      
      // Update all proposed ratings
      for (const rating of proposedRatings) {
        await storage.updateAttributeRating(
          rating.attributeType,
          rating.ratingLevel,
          rating.adjustmentPercent,
          rating.description
        );
      }
      
      // Refresh the pricing cache to reflect new weights
      await attributePricingService.initializeAttributeRatings(); // Reload ratings from DB
      await invalidateCache(); // Refresh base rate calculations
      
      res.json({
        success: true,
        message: 'Attribute ratings updated and pricing cache refreshed',
        updatedCount: proposedRatings.length
      });
    } catch (error) {
      console.error('Error accepting attribute ratings:', error);
      res.status(500).json({ error: 'Failed to accept attribute ratings' });
    }
  });
  
  // Issue #3 fix: Get attribute configuration status
  app.get("/api/attribute-ratings/status", async (req, res) => {
    try {
      const status = attributePricingService.getAttributeConfigurationStatus();
      res.json(status);
    } catch (error) {
      console.error('Error getting attribute configuration status:', error);
      res.status(500).json({ error: 'Failed to get attribute configuration status' });
    }
  });
  
  // Add the missing room-attributes endpoint
  app.get("/api/room-attributes", async (req, res) => {
    try {
      // Get attribute configuration status from the attribute pricing service
      const status = attributePricingService.getAttributeConfigurationStatus();
      
      // Get attribute ratings for display
      const ratings = await storage.getAttributeRatings();
      
      // Fixed to November 2025 which has data
      const currentMonth = '2025-11';
      
      // Get all locations
      const locations = await storage.getLocations();
      
      // Sample the data - get units from first 10 locations to estimate attributes
      const sampleUnits = [];
      let totalUnitsEstimate = 0;
      
      for (let i = 0; i < Math.min(10, locations.length); i++) {
        const locationUnits = await storage.getRentRollDataByLocation(locations[i].id, currentMonth);
        sampleUnits.push(...locationUnits);
        totalUnitsEstimate += locationUnits.length;
      }
      
      // Extrapolate total units based on sample
      if (locations.length > 10) {
        totalUnitsEstimate = Math.round(totalUnitsEstimate * (locations.length / 10));
      }
      
      // Count units and locations with attributes from sample
      const unitsWithAttributesInSample = sampleUnits.filter(unit => 
        unit.sizeRating || unit.viewRating || unit.renovationRating || 
        unit.locationRating || unit.amenityRating
      ).length;
      
      const locationsWithAttributesSet = new Set();
      sampleUnits.forEach(unit => {
        if (unit.sizeRating || unit.viewRating || unit.renovationRating || 
            unit.locationRating || unit.amenityRating) {
          locationsWithAttributesSet.add(unit.locationId);
        }
      });
      
      // Extrapolate units with attributes
      const unitsWithAttributesEstimate = locations.length > 10 
        ? Math.round(unitsWithAttributesInSample * (locations.length / 10))
        : unitsWithAttributesInSample;
      
      // Transform the data for the frontend with expected field names
      const response = {
        summary: status.summary,
        locations: status.locations,
        attributeRatings: ratings,
        totalUnits: totalUnitsEstimate > 0 ? totalUnitsEstimate : 17216, // Use known total as fallback
        unitsWithAttributes: unitsWithAttributesEstimate,
        totalLocations: locations.length,
        locationsWithAttributes: locationsWithAttributesSet.size
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error fetching room attributes:', error);
      res.status(500).json({ error: 'Failed to fetch room attributes' });
    }
  });

  // Analysis endpoint
  app.get("/api/analysis", async (req, res) => {
    try {
      const { location = "all", period = "3M" } = req.query;
      
      // Calculate date range based on period
      const months = parseInt(period.toString().replace('M', ''));
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);
      
      // Get rent roll data
      const rentRollData = location === "all" 
        ? await storage.getRentRollData()
        : await storage.getRentRollDataByLocation(location as string);
      
      // Get targets and trends data
      const targetsData = location === "all"
        ? await storage.getTargetsAndTrends()
        : await storage.getTargetsAndTrendsByCampus(location as string);
      
      // Calculate RevPOR data
      const revporData = [];
      const monthlyData = new Map();
      
      // Group rent roll data by month
      rentRollData.forEach(unit => {
        const month = unit.uploadMonth || '2025-09';
        if (!monthlyData.has(month)) {
          monthlyData.set(month, {
            totalRevenue: 0,
            occupiedRooms: 0,
            totalRooms: 0,
            totalBaseRent: 0,
            totalCareRate: 0,
          });
        }
        const data = monthlyData.get(month);
        data.totalRooms++;
        if (unit.occupiedYN) {
          data.occupiedRooms++;
          data.totalRevenue += (unit.rentAndCareRate || unit.streetRate || 0);
          data.totalBaseRent += (unit.streetRate || 0);
          data.totalCareRate += (unit.careRate || 0);
        }
      });
      
      // Build RevPOR chart data
      Array.from(monthlyData.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-months)
        .forEach(([month, data]) => {
          const target = targetsData.find(t => t.month === month);
          const revpor = data.occupiedRooms > 0 ? data.totalRevenue / data.occupiedRooms : 0;
          revporData.push({
            month: month.slice(5),
            actual: Math.round(revpor),
            budgeted: target?.budgetedRevPOR || Math.round(revpor * 0.95),
            competitor: Math.round(revpor * 0.97),
          });
        });
      
      // Calculate Rate data
      const rateData = [];
      Array.from(monthlyData.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-months)
        .forEach(([month, data]) => {
          const target = targetsData.find(t => t.month === month);
          const adr = data.occupiedRooms > 0 ? data.totalBaseRent / data.occupiedRooms : 0;
          const budget = target?.budgetedRate || adr * 0.95;
          rateData.push({
            month: month.slice(5),
            adr: Math.round(adr),
            budget: Math.round(budget),
            adjustment: target?.roomRateAdjustment || 0,
            variance: Math.round(adr - budget),
          });
        });
      
      // Calculate Occupancy by Service Line
      const serviceLineMap = new Map();
      rentRollData.forEach(unit => {
        const serviceLine = unit.serviceLine || 'AL';
        if (!serviceLineMap.has(serviceLine)) {
          serviceLineMap.set(serviceLine, {
            occupied: 0,
            total: 0,
          });
        }
        const data = serviceLineMap.get(serviceLine);
        data.total++;
        if (unit.occupiedYN) data.occupied++;
      });
      
      const occupancyData = Array.from(serviceLineMap.entries()).map(([serviceLine, data]) => {
        const target = targetsData.find(t => t.serviceLine === serviceLine);
        return {
          serviceLine,
          actual: (data.occupied / data.total) * 100,
          budgeted: target?.budgetedOccupancy || 90,
          trend: Math.random() * 5 - 2.5, // Mock trend
        };
      });
      
      // Calculate Remainder Metrics
      const currentOccupancyRate = monthlyData.get(Array.from(monthlyData.keys()).pop() || '');
      const currentOccupancy = currentOccupancyRate ? (currentOccupancyRate.occupiedRooms / currentOccupancyRate.totalRooms) * 100 : 0;
      const targetOccupancy = 92; // Target occupancy
      
      // Identify underpriced units
      const underpricedUnits = rentRollData.filter(unit => {
        const competitorRate = unit.competitorRate || 0;
        const currentRate = unit.streetRate || 0;
        return currentRate < competitorRate * 0.95; // Units priced 5%+ below competitor
      });
      
      const underpricedImpact = underpricedUnits.reduce((sum, unit) => {
        const gap = (unit.competitorRate || 0) - (unit.streetRate || 0);
        return sum + gap;
      }, 0);
      
      // Calculate occupancy gap
      const occupancyGap = Math.max(0, targetOccupancy - currentOccupancy);
      const totalUnits = currentOccupancyRate?.totalRooms || 0;
      const unitsNeeded = Math.round((occupancyGap / 100) * totalUnits);
      const avgRate = currentOccupancyRate && currentOccupancyRate.occupiedRooms > 0 
        ? currentOccupancyRate.totalRevenue / currentOccupancyRate.occupiedRooms 
        : 4500;
      const occupancyImpact = unitsNeeded * avgRate;
      
      // Calculate collection gap
      const targetCollection = 95; // 95% collection rate target
      const currentCollection = 91; // Mock current collection
      const collectionGap = targetCollection - currentCollection;
      const monthlyRevenue = currentOccupancyRate?.totalRevenue || 0;
      const collectionImpact = (collectionGap / 100) * monthlyRevenue;
      
      const remainderMetrics = {
        underpricedUnits: {
          count: underpricedUnits.length,
          monthlyImpact: Math.round(underpricedImpact),
          details: underpricedUnits.slice(0, 5).map(unit => ({
            unit: unit.roomNumber || 'Unknown',
            currentRate: unit.streetRate || 0,
            optimalRate: unit.competitorRate || 0,
            gap: (unit.competitorRate || 0) - (unit.streetRate || 0),
          })),
        },
        occupancyGap: {
          percentage: occupancyGap,
          monthlyImpact: Math.round(occupancyImpact),
          unitsNeeded,
        },
        collectionGap: {
          percentage: collectionGap,
          monthlyImpact: Math.round(collectionImpact),
        },
        totalOpportunity: Math.round(underpricedImpact + occupancyImpact + collectionImpact),
      };
      
      // Calculate KPIs
      const latestMonth = Array.from(monthlyData.keys()).pop() || '';
      const previousMonth = Array.from(monthlyData.keys()).slice(-2, -1)[0] || '';
      const latestData = monthlyData.get(latestMonth);
      const previousData = monthlyData.get(previousMonth);
      
      const currentRevPOR = latestData && latestData.occupiedRooms > 0 
        ? latestData.totalRevenue / latestData.occupiedRooms 
        : 0;
      const previousRevPOR = previousData && previousData.occupiedRooms > 0
        ? previousData.totalRevenue / previousData.occupiedRooms
        : currentRevPOR;
      
      const currentADR = latestData && latestData.occupiedRooms > 0
        ? latestData.totalBaseRent / latestData.occupiedRooms
        : 0;
      const previousADR = previousData && previousData.occupiedRooms > 0
        ? previousData.totalBaseRent / previousData.occupiedRooms
        : currentADR;
      
      const previousOccupancy = previousData 
        ? (previousData.occupiedRooms / previousData.totalRooms) * 100
        : currentOccupancy;
      
      const kpis = {
        currentRevPOR: Math.round(currentRevPOR),
        revPORChange: currentRevPOR ? ((currentRevPOR - previousRevPOR) / previousRevPOR) * 100 : 0,
        currentADR: Math.round(currentADR),
        adrChange: currentADR ? ((currentADR - previousADR) / previousADR) * 100 : 0,
        currentOccupancy,
        occupancyChange: currentOccupancy - previousOccupancy,
        capturedRemainder: Math.round(Math.random() * 50000 + 25000), // Mock captured value
        remainderChange: Math.random() * 10 - 5,
      };
      
      res.json({
        revporData,
        rateData,
        occupancyData,
        remainderMetrics,
        kpis,
      });
    } catch (error) {
      console.error("Error fetching analysis data:", error);
      res.status(500).json({ error: "Failed to fetch analysis data" });
    }
  });

  // Targets & Trends endpoints
  app.get("/api/targets-and-trends", async (req, res) => {
    try {
      const { campus, month } = req.query;
      let data;
      
      if (campus) {
        data = await storage.getTargetsAndTrendsByCampus(campus as string);
      } else if (month) {
        data = await storage.getTargetsAndTrendsByMonth(month as string);
      } else {
        data = await storage.getTargetsAndTrends();
      }
      
      res.json(data);
    } catch (error) {
      console.error("Error fetching targets and trends:", error);
      res.status(500).json({ error: "Failed to fetch targets and trends" });
    }
  });

  // Update unit attribute ratings
  app.put("/api/units/:id/attributes", async (req, res) => {
    try {
      const { id } = req.params;
      const { locationRating, sizeRating, viewRating, renovationRating, amenityRating } = req.body;
      
      await storage.updateRentRollData(id, {
        locationRating,
        sizeRating, 
        viewRating,
        renovationRating,
        amenityRating
      });
      
      res.json({ success: true, message: 'Unit attributes updated' });
    } catch (error) {
      console.error('Error updating unit attributes:', error);
      res.status(500).json({ error: 'Failed to update unit attributes' });
    }
  });

  // Get detailed calculation for a specific unit's AI rate
  app.get("/api/ai-calculation/:unitId", async (req, res) => {
    try {
      const { unitId } = req.params;
      const unit = await storage.getRentRollDataById(unitId);
      
      if (!unit) {
        return res.status(404).json({ error: 'Unit not found' });
      }
      
      // Use stored calculation details if available (like Modulo does)
      if (unit.aiCalculationDetails) {
        try {
          const storedDetails = JSON.parse(unit.aiCalculationDetails);
          return res.json({
            unitId: unit.id,
            roomType: unit.roomType,
            streetRate: unit.streetRate,
            aiSuggestedRate: unit.aiSuggestedRate,
            calculation: storedDetails
          });
        } catch (e) {
          console.error('Error parsing stored AI calculation details:', e);
        }
      }
      
      // Import sophisticated algorithm and explanations
      const { calculateModuloPrice } = await import('./moduloPricingAlgorithm');
      const { getSentenceExplanation, generateOverallExplanation } = await import('./sentenceExplanations');
      
      // Fallback to dynamic calculation if no stored details
      const storedAiRate = unit.aiSuggestedRate;
      const streetRate = unit.streetRate || 3185;
      
      // Get AI-specific weights - more aggressive than Modulo
      const aiWeights = await storage.getAiPricingWeights() || {
        occupancyPressure: 30,
        daysVacantDecay: 25,
        competitorRates: 10,
        seasonality: 5,
        stockMarket: 5,
        inquiryTourVolume: 10
      };
      
      // Calculate service-line-specific occupancy rate
      const allUnits = await storage.getRentRollData();
      const serviceLineOccupancy: Record<string, number> = {};
      const serviceLineStats = allUnits.reduce((acc: any, u: any) => {
        const sl = u.serviceLine || 'Unknown';
        if (!acc[sl]) {
          acc[sl] = { occupied: 0, total: 0 };
        }
        acc[sl].total++;
        if (u.occupiedYN) {
          acc[sl].occupied++;
        }
        return acc;
      }, {});
      
      for (const [serviceLine, stats] of Object.entries(serviceLineStats)) {
        const { occupied, total } = stats as { occupied: number; total: number };
        serviceLineOccupancy[serviceLine] = total > 0 ? occupied / total : 0.87;
      }
      
      // Use service-line-specific occupancy for this unit
      const serviceLineOcc = serviceLineOccupancy[unit.serviceLine] || 0.87;
      
      // Prepare inputs for sophisticated AI algorithm (more aggressive than Modulo)
      const daysVacant = unit.daysVacant || 0;
      
      // Calculate attribute score
      let attrScore = 0.5;
      if (unit.attributes) {
        if (unit.attributes.view) attrScore += 0.1;
        if (unit.attributes.renovated) attrScore += 0.15;
        if (unit.attributes.corner) attrScore += 0.1;
      }
      if (unit.roomType === 'Private') attrScore += 0.1;
      attrScore = Math.min(1.0, attrScore);
      
      const monthIndex = new Date().getMonth() + 1;
      const competitorPrices = unit.competitorBenchmarkRate ? 
        [unit.competitorBenchmarkRate] : 
        [streetRate * 0.95, streetRate * 1.05];
      
      // Mock demand data - AI sees higher volatility
      const demandHistory = [15, 20, 30, 18, 35, 22, 28, 16];
      const demandCurrent = 32;
      
      const aiInputs = {
        occupancy: serviceLineOcc,
        daysVacant,
        attrScore,
        monthIndex,
        competitorPrices,
        marketReturn: 0.03, // AI is more optimistic
        demandCurrent,
        demandHistory,
        serviceLine: unit.serviceLine  // Pass service line for market positioning targets
      };
      
      // Convert AI weights to algorithm format
      const algorithmWeights = {
        occupancy: aiWeights.occupancyPressure || 30,
        daysVacant: aiWeights.daysVacantDecay || 25,
        seasonality: aiWeights.seasonality || 5,
        competitors: aiWeights.competitorRates || 10,
        market: aiWeights.stockMarket || 5,
        demand: aiWeights.inquiryTourVolume || 10
      };
      
      // Calculate using sophisticated algorithm
      const result = calculateModuloPrice(streetRate, algorithmWeights, aiInputs);
      const aiSuggestedRate = storedAiRate || result.finalPrice;
      
      // Build adjustments with both formulas and sentence explanations
      const adjustments = result.adjustments?.map((adj: any) => ({
        ...adj,
        formula: adj.calculation, // This comes from getCalculationString in the algorithm
        description: getSentenceExplanation(adj.factor.toLowerCase(), aiInputs, adj)
      })) || [];
      
      res.json({
        unitId: unit.id,
        roomType: unit.roomType,
        streetRate: streetRate,
        aiSuggestedRate: aiSuggestedRate,
        calculation: {
          baseRate: streetRate,
          adjustments,
          weights: {
            occupancyPressure: algorithmWeights.occupancy,
            daysVacantDecay: algorithmWeights.daysVacant,
            seasonality: algorithmWeights.seasonality,
            competitorRates: algorithmWeights.competitors,
            stockMarket: algorithmWeights.market,
            inquiryTourVolume: algorithmWeights.demand
          },
          totalAdjustment: result.totalAdjustment,
          finalRate: aiSuggestedRate,
          signals: result.signals,
          blendedSignal: result.blendedSignal,
          explanation: generateOverallExplanation(result, aiInputs),
          actualOccupancyRate: serviceLineOcc,
          serviceLine: unit.serviceLine,
          unitData: {
            unitId: unit.id,
            isOccupied: unit.occupiedYN,
            daysVacant: unit.daysVacant,
            competitorRate: unit.competitorBenchmarkRate
          }
        }
      });
    } catch (error) {
      console.error('AI calculation fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch AI calculation details' });
    }
  });

  // Test data seeding endpoint (for demo purposes)
  app.post("/api/test-data/seed", async (req, res) => {
    try {
      const currentMonth = new Date().toISOString().substring(0, 7);
      
      // Sample rent roll data
      const testData = [
        {
          uploadMonth: currentMonth,
          date: new Date().toISOString().split('T')[0],
          location: "Main Building",
          roomNumber: "101",
          roomType: "Studio", 
          occupiedYN: true,
          daysVacant: 0,
          size: "Studio",
          view: "Garden View",
          renovated: true,
          streetRate: 4200,
          inHouseRate: 3800,
          careLevel: "Independent",
          careRate: 850,
          competitorRate: 4100,
          competitorAvgCareRate: 900,
          promotionAllowance: 100
        },
        {
          uploadMonth: currentMonth,
          date: new Date().toISOString().split('T')[0],
          location: "Main Building",
          roomNumber: "102", 
          roomType: "Studio",
          occupiedYN: false,
          daysVacant: 45,
          size: "Studio",
          view: null,
          renovated: false,
          streetRate: 3800,
          inHouseRate: 3400,
          careLevel: "Assisted", 
          careRate: 1200,
          competitorRate: 3850,
          competitorAvgCareRate: 950,
          promotionAllowance: 150
        },
        {
          uploadMonth: currentMonth,
          date: new Date().toISOString().split('T')[0],
          location: "East Wing",
          roomNumber: "201",
          roomType: "One Bedroom",
          occupiedYN: true,
          daysVacant: 0,
          size: "One Bedroom",
          view: "Courtyard View", 
          renovated: false,
          streetRate: 4800,
          inHouseRate: 4200,
          careLevel: "Independent",
          careRate: 800,
          competitorRate: 4750,
          competitorAvgCareRate: 850,
          promotionAllowance: 50
        },
        {
          uploadMonth: currentMonth,
          date: new Date().toISOString().split('T')[0],
          location: "West Wing",
          roomNumber: "301",
          roomType: "Two Bedroom",
          occupiedYN: false,
          daysVacant: 78,
          size: "Two Bedroom",
          view: "Garden View",
          renovated: true,
          streetRate: 5800,
          inHouseRate: 5200,
          careLevel: "Assisted",
          careRate: 1300,
          competitorRate: 5750,
          competitorAvgCareRate: 1250,
          promotionAllowance: 200
        },
        {
          uploadMonth: currentMonth,
          date: new Date().toISOString().split('T')[0],
          location: "East Wing", 
          roomNumber: "202",
          roomType: "Studio",
          occupiedYN: false,
          daysVacant: 156,
          size: "Studio",
          view: null,
          renovated: false,
          streetRate: 3300,
          inHouseRate: 2900,
          careLevel: "Memory Care",
          careRate: 1900,
          competitorRate: 3400,
          competitorAvgCareRate: 1850,
          promotionAllowance: 300
        }
      ];

      // Clear existing data and insert test data
      await storage.clearRentRollData();
      for (const unit of testData) {
        await storage.createRentRollData(unit);
      }

      // Generate rate card summary
      await storage.generateRateCard(currentMonth);

      res.json({ 
        success: true, 
        recordsProcessed: testData.length,
        uploadMonth: currentMonth,
        message: "Test data seeded successfully"
      });
    } catch (error) {
      console.error('Test data seeding error:', error);
      res.status(500).json({ error: 'Failed to seed test data' });
    }
  });

  // Generate demo data endpoint
  app.post("/api/generate-demo-data", async (req, res) => {
    try {
      const { processDemoData } = await import('./processDemoData');
      const result = await processDemoData();
      res.json({
        success: true,
        message: "Demo data generated and processed successfully",
        details: result
      });
    } catch (error) {
      console.error('Error generating demo data:', error);
      res.status(500).json({
        success: false,
        message: "Failed to generate demo data",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get detailed calculation for a specific unit's Modulo rate
  app.get("/api/calculation/:roomType", async (req, res) => {
    try {
      const { roomType } = req.params;
      const { unitId, currentRate } = req.query;
      
      // Get the actual pricing weights, ranges, and assumptions
      let weights = await storage.getPricingWeights();
      let ranges = await storage.getAdjustmentRanges();
      const assumptions = await storage.getAssumptions();
      
      // If no weights exist, create default weights
      if (!weights) {
        weights = await storage.createOrUpdateWeights({
          occupancyPressure: 25,
          daysVacantDecay: 20,
          seasonality: 15,
          competitorRates: 10,
          stockMarket: 10
        });
      }
      
      // If no ranges exist, create default ranges
      if (!ranges) {
        ranges = await storage.createOrUpdateAdjustmentRanges({
          occupancyMin: -0.10,
          occupancyMax: 0.10,
          vacancyMin: -0.15,
          vacancyMax: 0.00,
          attributesMin: -0.05,
          attributesMax: 0.10,
          seasonalityMin: -0.05,
          seasonalityMax: 0.10,
          competitorMin: -0.10,
          competitorMax: 0.10,
          marketMin: -0.02,
          marketMax: 0.05
        });
      }
      
      // Get actual unit data from database instead of using hardcoded values
      let sampleUnit;
      if (unitId) {
        // If unitId provided, get that specific unit from all data
        const allUnits = await storage.getRentRollData();
        sampleUnit = allUnits.find(unit => unit.id === unitId);
      }
      
      // Fallback to getting a sample unit of this room type
      if (!sampleUnit) {
        sampleUnit = await storage.getSampleUnitByRoomType(roomType);
      }
      
      // Use the actual street rate from the unit data, not hardcoded floor plan values
      const streetRate = sampleUnit?.streetRate || (currentRate ? parseFloat(currentRate as string) : 3185);
      
      // Get all units to calculate actual occupancy rate
      const allUnits = await storage.getRentRollData();
      const occupiedUnits = allUnits.filter(unit => unit.occupiedYN);
      const actualOccupancyRate = occupiedUnits.length / allUnits.length;
      
      // Get weight percentages (0-100)
      const occupancyWeight = weights?.occupancyPressure ?? 25;
      const vacancyWeight = weights?.daysVacantDecay ?? 20;
      const seasonalWeight = weights?.seasonality ?? 10;
      const competitorWeight = weights?.competitorRates ?? 10;
      const marketWeight = weights?.stockMarket ?? 10;
      
      // Get adjustment ranges, using defaults if not configured
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
      
      // CONDITIONAL LOGIC: Only apply adjustments when criteria are met
      
      // 1. Occupancy Pressure - only adjust if occupancy is outside target range (85-95%)
      let occupancyAdjustment = 0;
      if (occupancyWeight > 0) {
        if (actualOccupancyRate < 0.85) {
          // Low occupancy - apply downward pressure (toward min range)
          const severity = Math.min((0.85 - actualOccupancyRate) / 0.15, 1); // 0-1 based on how low
          occupancyAdjustment = occupancyMin * severity * (occupancyWeight / 100);
        } else if (actualOccupancyRate > 0.95) {
          // High occupancy - apply upward pressure (toward max range)
          const severity = Math.min((actualOccupancyRate - 0.95) / 0.05, 1); // 0-1 based on how high
          occupancyAdjustment = occupancyMax * severity * (occupancyWeight / 100);
        }
        // If occupancy is 85-95%, no adjustment is applied
      }
      
      // 2. Days Vacant - only apply to vacant units with days vacant > threshold
      let vacancyAdjustment = 0;
      if (vacancyWeight > 0 && sampleUnit && !sampleUnit.occupiedYN && sampleUnit.daysVacant > 30) {
        // Only vacant units with >30 days vacant get adjustment
        const severity = Math.min(sampleUnit.daysVacant / 90, 1); // 0-1 based on days vacant (max at 90 days)
        vacancyAdjustment = vacancyMin * severity * (vacancyWeight / 100);
      }
      // If unit is occupied or vacant <30 days, no adjustment is applied
      
      // 3. Room Attributes - only apply if unit has documented attributes
      let attributeAdjustment = 0;
      if (attributeWeight > 0 && sampleUnit?.attributes) {
        let attributeScore = 0;
        const attrs = sampleUnit.attributes;
        
        // Calculate attribute score based on actual premium features
        if (attrs.view) attributeScore += 0.3;
        if (attrs.renovated) attributeScore += 0.4;
        if (attrs.corner) attributeScore += 0.3;
        
        // Only apply adjustment if unit has premium attributes (score > 0)
        if (attributeScore > 0) {
          const direction = attributeScore > 0.5 ? 1 : -0.5;
          const range = direction > 0 ? attributesMax : attributesMin;
          attributeAdjustment = range * attributeScore * (attributeWeight / 100);
        }
      }
      
      // 4. Competitor Rates - only apply if competitor rate exists and differs significantly
      let competitorAdjustment = 0;
      if (competitorWeight > 0 && sampleUnit?.competitorBenchmarkRate) {
        const competitorRate = sampleUnit.competitorBenchmarkRate;
        const priceDifference = (streetRate - competitorRate) / competitorRate;
        
        // Only adjust if price difference is >5%
        if (Math.abs(priceDifference) > 0.05) {
          const severity = Math.min(Math.abs(priceDifference) / 0.20, 1); // Cap at 20% difference
          const direction = priceDifference > 0 ? -1 : 1; // If we're higher, adjust down; if lower, adjust up
          const range = direction > 0 ? competitorMax : competitorMin;
          competitorAdjustment = range * severity * (competitorWeight / 100);
        }
      }
      
      // 5. Seasonality - only applies if we have actual seasonal data
      let seasonalAdjustment = 0;
      // Removed because no real seasonal data exists
      
      // 6. Market Conditions - only applies if we have actual market data
      let marketAdjustment = 0;
      // Removed because no real market data exists
      
      
      // Calculate total adjustment
      const totalAdjustment = occupancyAdjustment + vacancyAdjustment + attributeAdjustment + 
                             seasonalAdjustment + competitorAdjustment + marketAdjustment;
      
      // Always recalculate based on current algorithm settings
      const recommendedRate = Math.round(streetRate * (1 + totalAdjustment));
      
      res.json({
        recommendedRate,
        calculation: {
          baseRate: streetRate,
          occupancyAdjustment,
          vacancyAdjustment,
          attributeAdjustment,
          seasonalAdjustment,
          competitorAdjustment,
          marketAdjustment,
          totalAdjustment,
          guardrailsApplied: [],
          // Additional debug info
          actualOccupancyRate,
          unitData: {
            unitId: sampleUnit?.unitId,
            isOccupied: sampleUnit?.occupiedYN,
            daysVacant: sampleUnit?.daysVacant,
            attributes: sampleUnit?.attributes,
            competitorRate: sampleUnit?.competitorBenchmarkRate
          }
        }
      });
    } catch (error) {
      console.error('Calculation error:', error);
      res.status(500).json({ error: "Failed to calculate pricing details" });
    }
  });

  // Natural Language Adjustment Rules endpoints
  app.post("/api/adjustment-rules", async (req, res) => {
    try {
      const { description, preview, locationId, serviceLine } = req.body;
      
      // Parse the natural language rule
      const parsedRule = parseNaturalLanguageRule(description);
      
      if (!parsedRule) {
        return res.status(400).json({ 
          error: "Could not understand the rule. Please try rephrasing." 
        });
      }
      
      // Validate the parsed rule
      const validation = validateParsedRule(parsedRule);
      if (!validation.isValid) {
        return res.status(400).json({ 
          error: "Invalid rule", 
          details: validation.errors 
        });
      }
      
      // Calculate estimated impact
      const units = await storage.getRentRollData();
      let affectedUnits = 0;
      let totalImpact = 0;
      
      // Track per-campus breakdown
      const campusBreakdown: { [campus: string]: { units: number; monthlyImpact: number; annualImpact: number; volumeAdjustedAnnual: number } } = {};
      
      // Filter units based on rule filters
      for (const unit of units) {
        let isAffected = true;
        
        if (parsedRule.action.filters) {
          const filters = parsedRule.action.filters;
          
          if (filters.roomType && !filters.roomType.includes(unit.roomType)) {
            isAffected = false;
          }
          if (filters.serviceLine && !filters.serviceLine.includes(unit.serviceLine)) {
            isAffected = false;
          }
          if (filters.location && !filters.location.includes(unit.location)) {
            isAffected = false;
          }
          if (filters.occupancyStatus === 'vacant' && unit.occupiedYN) {
            isAffected = false;
          }
          if (filters.occupancyStatus === 'occupied' && !unit.occupiedYN) {
            isAffected = false;
          }
          if (filters.vacancyDuration && unit.daysVacant !== null) {
            const days = filters.vacancyDuration.days;
            const meetsCondition = filters.vacancyDuration.operator === '>' 
              ? unit.daysVacant > days 
              : unit.daysVacant >= days;
            if (!meetsCondition) {
              isAffected = false;
            }
          }
        }
        
        if (isAffected) {
          affectedUnits++;
          
          // Calculate impact on this unit
          const currentRate = parsedRule.action.target === 'care_rate' 
            ? unit.careRate || 0
            : unit.streetRate || 0;
          
          let adjustment = 0;
          if (parsedRule.action.adjustmentType === 'percentage') {
            adjustment = currentRate * (parsedRule.action.adjustmentValue / 100);
          } else {
            adjustment = parsedRule.action.adjustmentValue;
          }
          
          totalImpact += adjustment;
          
          // Track per-campus impact
          const campus = unit.location || 'Unknown';
          if (!campusBreakdown[campus]) {
            campusBreakdown[campus] = { units: 0, monthlyImpact: 0, annualImpact: 0, volumeAdjustedAnnual: 0 };
          }
          campusBreakdown[campus].units += 1;
          campusBreakdown[campus].monthlyImpact += adjustment;
        }
      }
      
      // Calculate annual impacts for each campus
      const volumeIncreaseFactor = 1.05; // 5% volume increase
      for (const campus in campusBreakdown) {
        campusBreakdown[campus].annualImpact = campusBreakdown[campus].monthlyImpact * 12;
        campusBreakdown[campus].volumeAdjustedAnnual = campusBreakdown[campus].annualImpact * volumeIncreaseFactor;
      }
      
      // Calculate total annual impacts
      const monthlyImpact = totalImpact;
      const annualImpact = monthlyImpact * 12; // Base annual impact
      const volumeAdjustedAnnualImpact = annualImpact * volumeIncreaseFactor;
      
      // Use ChatGPT to validate if the impact is reasonable
      let reasonabilityCheck = {
        isReasonable: true,
        explanation: "Impact appears reasonable based on standard pricing adjustments.",
        suggestedAdjustment: null as number | null,
        risk: "low" as "low" | "medium" | "high"
      };
      
      if (preview && process.env.OPENAI_API_KEY) {
        try {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          
          const avgImpactPerUnit = totalImpact / affectedUnits;
          const percentageChange = parsedRule.action.adjustmentType === 'percentage' 
            ? parsedRule.action.adjustmentValue 
            : (avgImpactPerUnit / 3000) * 100; // Assume average rate of $3000
          
          const prompt = `As a senior living pricing expert, evaluate this pricing rule:
          
Rule Description: "${description}"
Affected Units: ${affectedUnits}
Monthly Impact: $${Math.round(monthlyImpact).toLocaleString()}
Annual Impact (with 5% volume increase): $${Math.round(volumeAdjustedAnnualImpact).toLocaleString()}
Average Impact per Unit: $${Math.round(avgImpactPerUnit)}
Estimated Percentage Change: ${percentageChange.toFixed(1)}%

Campus Breakdown:
${Object.entries(campusBreakdown).map(([campus, data]) => 
  `- ${campus}: ${data.units} units, $${Math.round(data.monthlyImpact).toLocaleString()}/month`
).join('\n')}

Please evaluate if this pricing adjustment is reasonable for a senior living portfolio. Consider:
1. Is the percentage change appropriate for the market?
2. Could this impact occupancy negatively?
3. Is the rule too aggressive or too conservative?
4. What risks might this create?

Respond in JSON format:
{
  "isReasonable": boolean,
  "explanation": "brief explanation",
  "suggestedAdjustment": null or number (suggested percentage if current is unreasonable),
  "risk": "low" | "medium" | "high"
}`;

          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.3,
            max_tokens: 500
          });

          const result = JSON.parse(response.choices[0].message.content || '{}');
          reasonabilityCheck = {
            isReasonable: result.isReasonable !== false,
            explanation: result.explanation || reasonabilityCheck.explanation,
            suggestedAdjustment: result.suggestedAdjustment,
            risk: result.risk || "low"
          };
          
        } catch (error) {
          console.error('ChatGPT validation error:', error);
          // Continue with default reasonability check if AI fails
        }
      }
      
      if (preview) {
        // Just return preview info without creating the rule
        return res.json({
          affectedUnits,
          estimatedImpact: Math.round(totalImpact),
          monthlyImpact: Math.round(monthlyImpact),
          annualImpact: Math.round(annualImpact),
          volumeAdjustedAnnualImpact: Math.round(volumeAdjustedAnnualImpact),
          campusBreakdown,
          reasonabilityCheck,
          previewRule: parsedRule,
        });
      }
      
      // Create the rule in database
      const rule = await storage.createAdjustmentRule({
        locationId: locationId || null,
        serviceLine: serviceLine || null,
        name: parsedRule.name,
        description: parsedRule.description,
        trigger: parsedRule.trigger,
        action: parsedRule.action,
        isActive: true,
        createdBy: 'user',
        monthlyImpact: Math.round(monthlyImpact),
        annualImpact: Math.round(annualImpact),
        volumeAdjustedAnnualImpact: Math.round(volumeAdjustedAnnualImpact),
      });
      
      res.json({
        rule,
        affectedUnits,
        estimatedImpact: Math.round(totalImpact),
        monthlyImpact: Math.round(monthlyImpact),
        annualImpact: Math.round(annualImpact),
        volumeAdjustedAnnualImpact: Math.round(volumeAdjustedAnnualImpact),
      });
    } catch (error) {
      console.error('Error creating adjustment rule:', error);
      res.status(500).json({ error: "Failed to create adjustment rule" });
    }
  });
  
  app.get("/api/adjustment-rules", async (req, res) => {
    try {
      const { locationId, serviceLine } = req.query;
      
      let query = db.select().from(adjustmentRules);
      
      // Filter by location and service line if provided
      const conditions = [];
      if (locationId) {
        conditions.push(or(
          eq(adjustmentRules.locationId, locationId as string),
          sql`${adjustmentRules.locationId} IS NULL`
        ));
      }
      if (serviceLine) {
        conditions.push(or(
          eq(adjustmentRules.serviceLine, serviceLine as string),
          sql`${adjustmentRules.serviceLine} IS NULL`
        ));
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      const rules = await query;
      res.json(rules);
    } catch (error) {
      console.error('Error fetching adjustment rules:', error);
      res.status(500).json({ error: "Failed to fetch adjustment rules" });
    }
  });
  
  app.patch("/api/adjustment-rules/:id/toggle", async (req, res) => {
    try {
      const { id } = req.params;
      const rules = await storage.getAdjustmentRules();
      const rule = rules.find(r => r.id === id);
      
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      
      const updated = await storage.updateAdjustmentRule(id, {
        isActive: !rule.isActive,
      });
      
      res.json(updated);
    } catch (error) {
      console.error('Error toggling adjustment rule:', error);
      res.status(500).json({ error: "Failed to toggle adjustment rule" });
    }
  });
  
  app.delete("/api/adjustment-rules/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteAdjustmentRule(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting adjustment rule:', error);
      res.status(500).json({ error: "Failed to delete adjustment rule" });
    }
  });
  
  app.get("/api/adjustment-rules/:id/history", async (req, res) => {
    try {
      const { id } = req.params;
      const history = await storage.getRuleExecutionHistory(id);
      res.json(history);
    } catch (error) {
      console.error('Error fetching rule history:', error);
      res.status(500).json({ error: "Failed to fetch rule history" });
    }
  });
  
  // Execute rules manually (can be triggered by cron job in production)
  app.post("/api/adjustment-rules/execute", async (req, res) => {
    try {
      const activeRules = await storage.getActiveAdjustmentRules();
      const executionResults = [];
      
      for (const rule of activeRules) {
        try {
          // Check if rule should execute based on trigger
          let shouldExecute = false;
          
          if (rule.trigger.type === 'immediate') {
            shouldExecute = true;
          } else if (rule.trigger.type === 'time') {
            // Check if enough time has passed since last execution
            const lastExecuted = rule.lastExecuted ? new Date(rule.lastExecuted) : new Date(0);
            const now = new Date();
            const timeDiff = now.getTime() - lastExecuted.getTime();
            
            const interval = rule.trigger.timeInterval;
            if (interval) {
              const msPerUnit = {
                'day': 24 * 60 * 60 * 1000,
                'week': 7 * 24 * 60 * 60 * 1000,
                'month': 30 * 24 * 60 * 60 * 1000,
                'quarter': 90 * 24 * 60 * 60 * 1000,
                'year': 365 * 24 * 60 * 60 * 1000,
              };
              
              const requiredMs = msPerUnit[interval.unit] * interval.value;
              shouldExecute = timeDiff >= requiredMs;
            }
          }
          // For condition and event triggers, would need external event system
          
          if (!shouldExecute) {
            continue;
          }
          
          // Execute the rule
          const units = await storage.getRentRollData();
          let affectedCount = 0;
          let totalBefore = 0;
          let totalAfter = 0;
          
          for (const unit of units) {
            let isAffected = true;
            
            // Apply filters (same logic as preview)
            if (rule.action.filters) {
              const filters = rule.action.filters;
              
              if (filters.roomType && !filters.roomType.includes(unit.roomType)) {
                isAffected = false;
              }
              if (filters.serviceLine && !filters.serviceLine.includes(unit.serviceLine)) {
                isAffected = false;
              }
              if (filters.location && !filters.location.includes(unit.location)) {
                isAffected = false;
              }
              if (filters.occupancyStatus === 'vacant' && unit.occupiedYN) {
                isAffected = false;
              }
              if (filters.occupancyStatus === 'occupied' && !unit.occupiedYN) {
                isAffected = false;
              }
            }
            
            if (isAffected) {
              affectedCount++;
              
              // Apply adjustment
              const currentRate = rule.action.target === 'care_rate' 
                ? unit.careRate || 0
                : unit.streetRate || 0;
              
              totalBefore += currentRate;
              
              let newRate = currentRate;
              if (rule.action.adjustmentType === 'percentage') {
                newRate = currentRate * (1 + rule.action.adjustmentValue / 100);
              } else {
                newRate = currentRate + rule.action.adjustmentValue;
              }
              
              totalAfter += newRate;
              
              // Update the unit in database
              // Note: In production, this would update the actual rates
              // For now, we're just calculating the impact
            }
          }
          
          // Log execution
          const log = await storage.logRuleExecution({
            ruleId: rule.id,
            affectedUnits: affectedCount,
            adjustmentType: rule.action.target,
            adjustmentAmount: rule.action.adjustmentValue,
            beforeValue: totalBefore / Math.max(affectedCount, 1),
            afterValue: totalAfter / Math.max(affectedCount, 1),
            impactSummary: {
              totalRevenueDelta: totalAfter - totalBefore,
              unitsAffected: affectedCount,
            },
            status: 'success',
          });
          
          // Update rule's last executed time
          await storage.updateAdjustmentRule(rule.id, {
            lastExecuted: new Date(),
            executionCount: (rule.executionCount || 0) + 1,
          });
          
          executionResults.push({
            ruleId: rule.id,
            ruleName: rule.name,
            affectedUnits: affectedCount,
            impact: totalAfter - totalBefore,
            status: 'success',
          });
          
        } catch (ruleError) {
          console.error(`Error executing rule ${rule.id}:`, ruleError);
          
          await storage.logRuleExecution({
            ruleId: rule.id,
            affectedUnits: 0,
            adjustmentType: rule.action.target,
            adjustmentAmount: 0,
            status: 'failed',
            errorMessage: String(ruleError),
          });
          
          executionResults.push({
            ruleId: rule.id,
            ruleName: rule.name,
            status: 'failed',
            error: String(ruleError),
          });
        }
      }
      
      res.json({
        executedRules: executionResults.length,
        results: executionResults,
      });
    } catch (error) {
      console.error('Error executing adjustment rules:', error);
      res.status(500).json({ error: "Failed to execute adjustment rules" });
    }
  });

  // ============================================
  // FLOOR PLANS API ENDPOINTS
  // ============================================

  // Campus Maps endpoints
  app.get("/api/campus-maps/:locationId", async (req, res) => {
    try {
      const { locationId } = req.params;
      const { uploadMonth } = req.query;
      
      console.log(`[Campus Maps API] Fetching floor plan for location ${locationId}, uploadMonth: ${uploadMonth || 'latest'}`);
      
      const { getFloorPlanDataForLocation } = await import('./globalFloorPlanService');
      const result = await getFloorPlanDataForLocation(
        locationId,
        uploadMonth as string | undefined
      );
      
      // If no floor plan exists, auto-generate a demo floor plan
      if (!result.campusMap) {
        console.log(`[Campus Maps API] No floor plan found for location ${locationId}, attempting to generate demo floor plan...`);
        const { generateOrGetDemoFloorPlan } = await import('./demoFloorPlanService');
        try {
          console.log(`[Demo Generation] Starting demo floor plan generation for location ${locationId}`);
          const demoFloorPlan = await generateOrGetDemoFloorPlan(locationId);
          
          if (demoFloorPlan) {
            console.log(`[Demo Generation] Successfully generated demo floor plan for location ${locationId}, floorPlanId: ${demoFloorPlan.id}`);
            // Fetch the newly created demo floor plan data
            const updatedResult = await getFloorPlanDataForLocation(
              locationId,
              uploadMonth as string | undefined
            );
            console.log(`[Demo Generation] Returning updated result with ${updatedResult.stats.totalRooms} rooms`);
            return res.json(updatedResult);
          } else {
            console.error(`[Demo Generation] Failed to generate demo floor plan for location ${locationId} - no floor plan returned`);
            return res.status(404).json({ 
              error: "No floor plan available",
              message: `No floor plan data found for location ${locationId} and demo generation failed. Please ensure rent roll data exists for this location.`
            });
          }
        } catch (demoError) {
          console.error('[Demo Generation] Error generating demo floor plan:', demoError);
          console.error('Stack trace:', demoError instanceof Error ? demoError.stack : 'No stack trace available');
          return res.status(404).json({ 
            error: "Floor plan generation failed",
            message: `Unable to generate floor plan for location ${locationId}. Please contact support.`
          });
        }
      }
      
      console.log(`[Campus Maps API] Returning floor plan data for location ${locationId} with ${result.stats.totalRooms} total rooms`);
      res.json(result);
    } catch (error) {
      console.error('[Campus Maps API] Error fetching campus maps:', error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
      res.status(500).json({ 
        error: "Failed to fetch campus maps",
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  });

  app.post("/api/campus-maps", async (req, res) => {
    try {
      const { name, svgContent, campusId } = req.body;
      
      // Validate required fields
      if (!name || !svgContent || !campusId) {
        return res.status(400).json({ error: "Missing required fields: name, svgContent, campusId" });
      }

      // Validate SVG content (basic check)
      if (!svgContent.trim().toLowerCase().startsWith('<svg')) {
        return res.status(400).json({ error: "Invalid SVG content" });
      }

      // Limit SVG size to prevent DoS (1MB max)
      if (svgContent.length > 1024 * 1024) {
        return res.status(400).json({ error: "SVG file too large (max 1MB)" });
      }
      
      // Extract dimensions from SVG viewBox
      const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/);
      let width = 1000;
      let height = 1000;
      
      if (viewBoxMatch) {
        const parts = viewBoxMatch[1].split(/\s+/);
        if (parts.length >= 4) {
          width = parseInt(parts[2]) || 1000;
          height = parseInt(parts[3]) || 1000;
        }
      }

      // Validate and create using schema
      const mapData = {
        locationId: campusId,
        name,
        svgContent,
        width,
        height,
        isPublished: false,
      };

      const map = await storage.createCampusMap(mapData);
      
      res.json(map);
    } catch (error) {
      console.error('Error creating campus map:', error);
      res.status(500).json({ error: "Failed to create campus map" });
    }
  });

  app.post("/api/campus-maps/upload-image", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      const { name, locationId, width, height, isTemplate, autoDetect } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: "Missing required field: name" });
      }

      const timestamp = Date.now();
      const filename = `floor-plan-${timestamp}${path.extname(req.file.originalname)}`;
      const filepath = path.join('attached_assets', 'floor_plans', filename);
      
      const fs = await import('fs/promises');
      await fs.mkdir(path.join('attached_assets', 'floor_plans'), { recursive: true });
      await fs.writeFile(filepath, req.file.buffer);

      const mapData = {
        locationId: isTemplate === 'true' || isTemplate === true ? null : locationId,
        name,
        baseImageUrl: `/${filepath}`,
        width: parseInt(width) || 1024,
        height: parseInt(height) || 683,
        isTemplate: isTemplate === 'true' || isTemplate === true,
        isPublished: true,
      };

      const map = await storage.createCampusMap(mapData);
      
      if ((autoDetect === 'true' || autoDetect === true) && map.isTemplate) {
        const { detectAndStoreTemplateRooms } = await import('./globalFloorPlanService');
        const detectionResult = await detectAndStoreTemplateRooms(map.id);
        
        res.json({
          map,
          detection: detectionResult
        });
      } else {
        res.json({ map });
      }
    } catch (error) {
      console.error('Error uploading floor plan image:', error);
      res.status(500).json({ error: "Failed to upload floor plan image" });
    }
  });

  app.post("/api/campus-maps/:id/detect-rooms", async (req, res) => {
    try {
      const { id } = req.params;
      const { detectAndStoreTemplateRooms } = await import('./globalFloorPlanService');
      const result = await detectAndStoreTemplateRooms(id);
      res.json(result);
    } catch (error) {
      console.error('Error detecting rooms:', error);
      res.status(500).json({ error: "Failed to detect rooms" });
    }
  });

  app.put("/api/campus-maps/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const map = await storage.updateCampusMap(id, req.body);
      res.json(map);
    } catch (error) {
      console.error('Error updating campus map:', error);
      res.status(500).json({ error: "Failed to update campus map" });
    }
  });

  app.delete("/api/campus-maps/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteCampusMap(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting campus map:', error);
      res.status(500).json({ error: "Failed to delete campus map" });
    }
  });

  // Floor Plans endpoints
  app.get("/api/floor-plans/:locationId", async (req, res) => {
    try {
      const { locationId } = req.params;
      const plans = await storage.getFloorPlans(locationId);
      res.json(plans);
    } catch (error) {
      console.error('Error fetching floor plans:', error);
      res.status(500).json({ error: "Failed to fetch floor plans" });
    }
  });

  app.post("/api/floor-plans", async (req, res) => {
    try {
      const plan = await storage.createFloorPlan(req.body);
      res.json(plan);
    } catch (error) {
      console.error('Error creating floor plan:', error);
      res.status(500).json({ error: "Failed to create floor plan" });
    }
  });

  app.put("/api/floor-plans/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const plan = await storage.updateFloorPlan(id, req.body);
      res.json(plan);
    } catch (error) {
      console.error('Error updating floor plan:', error);
      res.status(500).json({ error: "Failed to update floor plan" });
    }
  });

  app.delete("/api/floor-plans/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteFloorPlan(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting floor plan:', error);
      res.status(500).json({ error: "Failed to delete floor plan" });
    }
  });

  // AI-powered room detection endpoint with hybrid OpenCV + OpenAI strategy
  app.post("/api/floor-plans/detect-rooms", upload.single('image'), async (req, res) => {
    try {
      const { campusMapId, strategy = 'hybrid' } = req.body;
      let imagePath: string;
      let tempFile: string | null = null;

      // Get image path from either uploaded file or campusMapId (validated)
      if (req.file) {
        // Save uploaded file temporarily
        const fs = await import('fs/promises');
        tempFile = path.join(process.cwd(), `temp_${Date.now()}.png`);
        await fs.writeFile(tempFile, req.file.buffer);
        imagePath = tempFile;
      } else if (campusMapId) {
        // Fetch the campus map to get the base image URL - validates ownership/existence
        const campusMap = await storage.getCampusMapById(campusMapId);
        if (!campusMap || !campusMap.baseImageUrl) {
          return res.status(404).json({ error: "Campus map or image not found" });
        }
        
        // Validate that the path doesn't contain traversal attempts
        const normalizedPath = campusMap.baseImageUrl.startsWith('/') 
          ? campusMap.baseImageUrl.substring(1) 
          : campusMap.baseImageUrl;
          
        if (campusMap.baseImageUrl.includes('..') || !normalizedPath.startsWith('attached_assets/')) {
          return res.status(400).json({ error: "Invalid image path" });
        }
        
        imagePath = path.join(process.cwd(), normalizedPath);
      } else {
        return res.status(400).json({ error: "No image provided. Please provide either campusMapId or upload an image file" });
      }

      console.log(`Starting room detection (strategy: ${strategy}) for campus map ${campusMapId}...`);
      
      // Use the room detection service with specified strategy
      const result = await roomDetectionService.detect(
        imagePath,
        strategy as DetectionStrategy
      );
      
      // Clean up temp file if created
      if (tempFile) {
        try {
          const fs = await import('fs/promises');
          await fs.unlink(tempFile);
        } catch (err) {
          console.warn('Failed to delete temp file:', err);
        }
      }
      
      console.log(`Room detection completed: ${result.metadata.totalRoomsDetected} rooms detected using ${result.metadata.strategyUsed}${result.metadata.fallbackUsed ? ' (fallback)' : ''}`);
      
      res.json({
        success: result.success,
        detected: result.rooms,
        metadata: result.metadata
      });
    } catch (error) {
      console.error('Error detecting rooms:', error);
      res.status(500).json({ 
        error: "Failed to detect rooms",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Batch process multiple campuses with room detection
  app.post("/api/floor-plans/batch-detect-rooms", async (req, res) => {
    try {
      const { limit = 5, strategy = 'hybrid' } = req.body;
      
      // Get campus maps with images (limit to first N)
      const allMaps = await storage.getCampusMaps();
      const mapsWithImages = allMaps
        .filter(map => map.baseImageUrl && map.baseImageUrl.endsWith('.png'))
        .slice(0, limit);
      
      console.log(`Starting batch processing of ${mapsWithImages.length} campus maps...`);
      
      const results = [];
      
      for (const map of mapsWithImages) {
        try {
          const normalizedPath = map.baseImageUrl.startsWith('/') 
            ? map.baseImageUrl.substring(1) 
            : map.baseImageUrl;
          const imagePath = path.join(process.cwd(), normalizedPath);
          
          console.log(`Processing ${map.id} - ${map.locationId}...`);
          
          const detectionResult = await roomDetectionService.detect(
            imagePath,
            strategy as DetectionStrategy
          );
          
          // Save detected polygons to database
          let savedCount = 0;
          for (const room of detectionResult.rooms) {
            try {
              await storage.createUnitPolygon({
                campusMapId: map.id,
                rentRollDataId: null, // Will be mapped later
                label: room.label,
                polygonCoordinates: room.polygon,
                fillColor: "#4CAF50",
                strokeColor: "#2E7D32",
              });
              savedCount++;
            } catch (err) {
              console.warn(`Failed to save polygon for room ${room.label}:`, err);
            }
          }
          
          results.push({
            campusMapId: map.id,
            locationId: map.locationId,
            success: detectionResult.success,
            roomsDetected: detectionResult.metadata.totalRoomsDetected,
            roomsSaved: savedCount,
            strategyUsed: detectionResult.metadata.strategyUsed,
            fallbackUsed: detectionResult.metadata.fallbackUsed || false,
          });
          
          console.log(`✓ Completed ${map.locationId}: ${savedCount}/${detectionResult.metadata.totalRoomsDetected} rooms saved`);
          
        } catch (error) {
          console.error(`Error processing ${map.id}:`, error);
          results.push({
            campusMapId: map.id,
            locationId: map.locationId,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      console.log(`Batch processing complete. Processed ${results.length} campus maps.`);
      
      res.json({
        success: true,
        processed: results.length,
        results,
      });
    } catch (error) {
      console.error('Error in batch room detection:', error);
      res.status(500).json({ 
        error: "Failed to batch process rooms",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Unit Polygons endpoints
  app.get("/api/unit-polygons/:campusMapId", async (req, res) => {
    try {
      const { campusMapId } = req.params;
      const polygons = await storage.getUnitPolygons(campusMapId);
      res.json(polygons);
    } catch (error) {
      console.error('Error fetching unit polygons:', error);
      res.status(500).json({ error: "Failed to fetch unit polygons" });
    }
  });

  // Get unit polygons by map ID (alternative endpoint structure)
  app.get("/api/unit-polygons/map/:mapId", async (req, res) => {
    try {
      const { mapId } = req.params;
      const polygons = await storage.getUnitPolygons(mapId);
      res.json(polygons);
    } catch (error) {
      console.error('Error fetching unit polygons for map:', error);
      res.status(500).json({ error: "Failed to fetch unit polygons" });
    }
  });

  app.post("/api/unit-polygons", async (req, res) => {
    try {
      const { campusMapId, rentRollDataId, label, polygonCoordinates, fillColor, strokeColor } = req.body;
      
      if (!campusMapId || !polygonCoordinates) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const polygon = await storage.createUnitPolygon({
        campusMapId,
        rentRollDataId,
        label,
        polygonCoordinates,
        fillColor: fillColor || "#4CAF50",
        strokeColor: strokeColor || "#2E7D32",
      });

      res.json(polygon);
    } catch (error) {
      console.error('Error creating unit polygon:', error);
      res.status(500).json({ error: "Failed to create unit polygon" });
    }
  });

  app.delete("/api/unit-polygons/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteUnitPolygon(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting unit polygon:', error);
      res.status(500).json({ error: "Failed to delete unit polygon" });
    }
  });

  // Get all rent roll data
  app.get("/api/rent-roll", async (req, res) => {
    try {
      // Get the latest upload month to avoid fetching all historical data
      const latestMonthResult = await db
        .select({ uploadMonth: rentRollData.uploadMonth })
        .from(rentRollData)
        .where(sql`${rentRollData.uploadMonth} IS NOT NULL`)
        .orderBy(sql`${rentRollData.uploadMonth} DESC`)
        .limit(1);
      
      const latestMonth = latestMonthResult[0]?.uploadMonth || '2025-11';
      
      // Fetch only current month's data with necessary fields for the Room Attributes page
      const currentMonthData = await db
        .select({
          id: rentRollData.id,
          location: rentRollData.location,
          serviceLine: rentRollData.serviceLine,
          roomNumber: rentRollData.roomNumber,
          roomType: rentRollData.roomType,
          sizeRating: rentRollData.sizeRating,
          viewRating: rentRollData.viewRating,
          renovationRating: rentRollData.renovationRating,
          locationRating: rentRollData.locationRating,
          amenityRating: rentRollData.amenityRating,
          streetRate: rentRollData.streetRate,
          inHouseRate: rentRollData.inHouseRate,
          occupiedYN: rentRollData.occupiedYN
        })
        .from(rentRollData)
        .where(eq(rentRollData.uploadMonth, latestMonth));
      
      res.json(currentMonthData);
    } catch (error) {
      console.error('Error fetching rent roll data:', error);
      res.status(500).json({ error: "Failed to fetch rent roll data" });
    }
  });

  // Get available upload months
  app.get("/api/rent-roll/available-months", async (req, res) => {
    try {
      const result = await db
        .selectDistinct({ uploadMonth: rentRollData.uploadMonth })
        .from(rentRollData)
        .where(sql`${rentRollData.uploadMonth} IS NOT NULL`)
        .orderBy(sql`${rentRollData.uploadMonth} DESC`);
      
      const months = result.map(r => r.uploadMonth).filter(Boolean);
      res.json(months);
    } catch (error) {
      console.error('Error fetching available months:', error);
      res.status(500).json({ error: "Failed to fetch available months" });
    }
  });

  // Get all rent roll data for a location
  app.get("/api/rent-roll-data/location/:locationId", async (req, res) => {
    try {
      const { locationId } = req.params;
      
      // Get the location name from the ID
      const location = await storage.getLocationById(locationId);
      if (!location) {
        return res.status(404).json({ error: "Location not found" });
      }
      
      // Get units by location name
      const units = await storage.getRentRollDataByLocation(location.name);
      res.json(units);
    } catch (error) {
      console.error('Error fetching rent roll data for location:', error);
      res.status(500).json({ error: "Failed to fetch rent roll data" });
    }
  });

  // Get individual rent roll unit data by ID
  app.get("/api/rent-roll-data/:unitId", async (req, res) => {
    try {
      const { unitId } = req.params;
      const unit = await storage.getRentRollDataById(unitId);
      
      if (!unit) {
        return res.status(404).json({ error: "Unit not found" });
      }
      
      res.json(unit);
    } catch (error) {
      console.error('Error fetching rent roll data:', error);
      res.status(500).json({ error: "Failed to fetch unit data" });
    }
  });

  app.post("/api/unit-polygons", async (req, res) => {
    try {
      const polygon = await storage.createUnitPolygon(req.body);
      res.json(polygon);
    } catch (error) {
      console.error('Error creating unit polygon:', error);
      res.status(500).json({ error: "Failed to create unit polygon" });
    }
  });

  app.put("/api/unit-polygons/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const polygon = await storage.updateUnitPolygon(id, req.body);
      res.json(polygon);
    } catch (error) {
      console.error('Error updating unit polygon:', error);
      res.status(500).json({ error: "Failed to update unit polygon" });
    }
  });

  app.patch("/api/unit-polygons/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const polygon = await storage.updateUnitPolygon(id, req.body);
      res.json(polygon);
    } catch (error) {
      console.error('Error updating unit polygon:', error);
      res.status(500).json({ error: "Failed to update unit polygon" });
    }
  });

  app.delete("/api/unit-polygons/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteUnitPolygon(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting unit polygon:', error);
      res.status(500).json({ error: "Failed to delete unit polygon" });
    }
  });

  // =====================================================
  // Data Import Routes for Production Data Migration
  // =====================================================
  
  app.post("/api/import/rent-roll", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const { uploadMonth } = req.body;
      if (!uploadMonth) {
        return res.status(400).json({ error: "Upload month is required" });
      }
      
      const { 
        importRentRollCSV,
        importMatrixCareRentRollCSV,
        syncHistoryToCurrentRentRoll
      } = await import('./dataImport');
      
      // Auto-detect MatrixCare format by checking for Room_Bed column
      const sampleText = req.file.buffer.toString('utf-8', 0, 500);
      const isMatrixCare = sampleText.includes('Room_Bed') || sampleText.includes('Service1');
      
      console.log(`Importing rent roll for ${uploadMonth}, MatrixCare format: ${isMatrixCare}`);
      
      const importStats = isMatrixCare 
        ? await importMatrixCareRentRollCSV(req.file.buffer, uploadMonth, req.file.originalname)
        : await importRentRollCSV(req.file.buffer, uploadMonth, req.file.originalname);
      
      // If this is the most recent month, sync to current rent roll
      const currentMonth = new Date().toISOString().slice(0, 7);
      if (uploadMonth === currentMonth) {
        const syncResult = await syncHistoryToCurrentRentRoll(uploadMonth);
        return res.json({
          ...importStats,
          syncedToCurrent: true,
          syncedRecords: syncResult.synced
        });
      }
      
      res.json({
        ...importStats,
        syncedToCurrent: false
      });
    } catch (error) {
      console.error('Error importing rent roll:', error);
      res.status(500).json({ error: "Failed to import rent roll data" });
    }
  });
  
  app.post("/api/import/enquire", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const { dataSource } = req.body;
      if (!dataSource || !['Senior Housing', 'Post Acute'].includes(dataSource)) {
        return res.status(400).json({ 
          error: "Data source must be 'Senior Housing' or 'Post Acute'" 
        });
      }
      
      const { importEnquireCSV } = await import('./dataImport');
      
      const importStats = await importEnquireCSV(
        req.file.buffer,
        dataSource as 'Senior Housing' | 'Post Acute'
      );
      
      res.json(importStats);
    } catch (error) {
      console.error('Error importing Enquire data:', error);
      res.status(500).json({ error: "Failed to import Enquire data" });
    }
  });
  
  app.post("/api/import/batch-rent-rolls", async (req, res) => {
    try {
      const assetsDir = path.join(__dirname, '..', 'attached_assets');
      
      const fileMonthMapping: Record<string, string> = {
        'THS_Pricing_RentRoll 1.31.25_1763249338678.csv': '2025-01',
        'THS_Pricing_RentRoll 2.25.25_1763249338678.csv': '2025-02',
        'THS_Pricing_RentRoll 3.31.25_1763249338677.csv': '2025-03',
        'THS_Pricing_RentRoll 4.30.25_1763249338679.csv': '2025-04',
        'THS_Pricing_RentRoll 5.31.25_1763249338679.csv': '2025-05',
        'THS_Pricing_RentRoll 6.30.25_1763249338680.csv': '2025-06',
        'THS_Pricing_RentRoll 7.31.25_1763249338680.csv': '2025-07',
        'THS_Pricing_RentRoll 8.31.25_1763249338680.csv': '2025-08',
        'THS_Pricing_RentRoll 9.30.25_1763249338681.csv': '2025-09',
        'THS_Pricing_RentRoll 10.31.25_1763249338681.csv': '2025-10',
        'THS_Pricing_RentRoll 11.15.25_1763249338681.csv': '2025-11',
      };
      
      const { importMatrixCareRentRollCSV, syncHistoryToCurrentRentRoll } = await import('./dataImport');
      
      const results: any[] = [];
      let totalImported = 0;
      
      for (const [filename, uploadMonth] of Object.entries(fileMonthMapping)) {
        const filePath = path.join(assetsDir, filename);
        
        if (!fs.existsSync(filePath)) {
          console.log(`File not found: ${filename}`);
          continue;
        }
        
        try {
          const fileBuffer = fs.readFileSync(filePath);
          const stats = await importMatrixCareRentRollCSV(fileBuffer, uploadMonth, filename);
          
          // Sync to current rent roll table for the latest month
          const currentMonth = new Date().toISOString().slice(0, 7);
          if (uploadMonth === currentMonth) {
            const syncResult = await syncHistoryToCurrentRentRoll(uploadMonth);
            stats.syncedRecords = syncResult.synced;
          }
          
          totalImported += stats.successfulImports;
          results.push({
            month: uploadMonth,
            filename,
            ...stats
          });
          
        } catch (error: any) {
          console.error(`Error importing ${filename}:`, error);
          results.push({
            month: uploadMonth,
            filename,
            error: error.message
          });
        }
      }
      
      res.json({
        success: true,
        totalImported,
        monthsProcessed: results.length,
        results
      });
    } catch (error) {
      console.error('Error in batch import:', error);
      res.status(500).json({ error: "Failed to batch import rent rolls" });
    }
  });
  
  app.post("/api/import/competitive-survey", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const { surveyMonth } = req.body;
      if (!surveyMonth) {
        return res.status(400).json({ error: "Survey month is required" });
      }
      
      const { importCompetitiveSurveyExcel } = await import('./dataImport');
      
      const importStats = await importCompetitiveSurveyExcel(
        req.file.buffer,
        surveyMonth
      );
      
      // Auto-trigger competitor rate matching after successful import
      console.log('Triggering automatic competitor rate matching...');
      const { processAllUnitsForCompetitorRates } = await import('./services/competitorRateMatching');
      
      // Run in background - don't wait for completion
      processAllUnitsForCompetitorRates(surveyMonth).then(matchingStats => {
        console.log('Competitor rate matching completed:', {
          processed: matchingStats.processed,
          updated: matchingStats.updated,
          errors: matchingStats.errors
        });
      }).catch(error => {
        console.error('Error in automatic competitor matching:', error);
      });
      
      res.json({
        ...importStats,
        message: 'Import successful. Competitor rate matching is running in the background.'
      });
    } catch (error) {
      console.error('Error importing competitive survey:', error);
      res.status(500).json({ error: "Failed to import competitive survey data" });
    }
  });
  
  // Manually trigger competitor rate matching
  app.post("/api/competitor-matching/process", async (req, res) => {
    try {
      const { uploadMonth } = req.body;
      
      console.log(`Starting competitor rate matching for month: ${uploadMonth || 'all'}...`);
      const { processAllUnitsForCompetitorRates } = await import('./services/competitorRateMatching');
      
      const stats = await processAllUnitsForCompetitorRates(uploadMonth);
      
      console.log('Competitor rate matching completed:', stats);
      res.json({
        success: true,
        ...stats,
        message: `Processed ${stats.processed} units, updated ${stats.updated} units with competitor rates`
      });
    } catch (error) {
      console.error('Error processing competitor rates:', error);
      res.status(500).json({ error: "Failed to process competitor rates" });
    }
  });

  app.get("/api/import/location-mappings", async (req, res) => {
    try {
      const mappings = await storage.getLocationMappings();
      res.json(mappings);
    } catch (error) {
      console.error('Error fetching location mappings:', error);
      res.status(500).json({ error: "Failed to fetch location mappings" });
    }
  });
  
  app.post("/api/import/location-mappings", async (req, res) => {
    try {
      const mapping = await storage.createLocationMapping(req.body);
      res.json(mapping);
    } catch (error) {
      console.error('Error creating location mapping:', error);
      res.status(500).json({ error: "Failed to create location mapping" });
    }
  });
  
  app.post("/api/import/auto-map-locations", async (req, res) => {
    try {
      const { autoMapLocations } = await import('./dataImport');
      const results = await autoMapLocations();
      res.json(results);
    } catch (error) {
      console.error('Error auto-mapping locations:', error);
      res.status(500).json({ error: "Failed to auto-map locations" });
    }
  });
  
  app.post("/api/import/sync-to-current/:month", async (req, res) => {
    try {
      const { month } = req.params;
      const { syncHistoryToCurrentRentRoll } = await import('./dataImport');
      const result = await syncHistoryToCurrentRentRoll(month);
      res.json(result);
    } catch (error) {
      console.error('Error syncing to current rent roll:', error);
      res.status(500).json({ error: "Failed to sync to current rent roll" });
    }
  });
  
  // Data Export Routes  
  app.get('/api/export/rent-roll-history/:month', async (req, res) => {
    try {
      const month = req.params.month;
      const monthDate = new Date(month + '-01');
      
      const data = await db
        .select()
        .from(rentRollHistory)
        .where(eq(rentRollHistory.uploadMonth, monthDate));
      
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data found for this month' });
      }
      
      // Use optimized export utility
      const { formatExportData, generateOptimizedCSV, generateExportFilename } = await import('./exportUtils');
      const formattedData = formatExportData(data, 'rentRollHistory');
      const csvContent = generateOptimizedCSV(formattedData, 'rentRollHistory');
      const filename = generateExportFilename(`rent-roll-${month}`);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  app.get('/api/export/enquire-data', async (req, res) => {
    try {
      const { dataSource, startDate, endDate } = req.query;
      
      let query = db.select().from(enquireData);
      const conditions = [];
      
      if (dataSource) {
        conditions.push(eq(enquireData.dataSource, dataSource as string));
      }
      
      if (startDate) {
        conditions.push(gte(enquireData.activityDate, new Date(startDate as string)));
      }
      
      if (endDate) {
        conditions.push(lte(enquireData.activityDate, new Date(endDate as string)));
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }
      
      const data = await query;
      
      // Use optimized export utility
      const { formatExportData, generateOptimizedCSV, generateExportFilename } = await import('./exportUtils');
      const formattedData = formatExportData(data, 'enquireData');
      const csvContent = generateOptimizedCSV(formattedData, 'enquireData');
      const filename = generateExportFilename('enquire-data-export');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  app.get('/api/export/competitive-survey/:month', async (req, res) => {
    try {
      const month = req.params.month;
      const monthDate = new Date(month + '-01');
      
      const data = await db
        .select()
        .from(competitiveSurveyData)
        .where(eq(competitiveSurveyData.surveyMonth, monthDate));
      
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data found for this month' });
      }
      
      // Use optimized export utility
      const { formatExportData, generateOptimizedCSV, generateExportFilename } = await import('./exportUtils');
      const formattedData = formatExportData(data, 'competitiveSurvey');
      const csvContent = generateOptimizedCSV(formattedData, 'competitiveSurvey');
      const filename = generateExportFilename(`competitive-survey-${month}`);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  app.get('/api/export/location-mappings', async (req, res) => {
    try {
      const data = await db
        .select()
        .from(locationMappings);
      
      // Use optimized export utility
      const { formatExportData, generateOptimizedCSV, generateExportFilename } = await import('./exportUtils');
      const formattedData = formatExportData(data, 'locationMappings');
      const csvContent = generateOptimizedCSV(formattedData, 'locationMappings');
      const filename = generateExportFilename('location-mappings');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  // Rate card export endpoint - optimized with essential fields only
  app.get('/api/export/rate-card', async (req, res) => {
    try {
      const { month, regions, divisions, locations } = req.query;
      let targetMonth = month as string || new Date().toISOString().substring(0, 7);
      
      // Get latest month with data if not specified
      if (!month) {
        const latestMonthData = await db.select({ uploadMonth: rentRollData.uploadMonth })
          .from(rentRollData)
          .orderBy(desc(rentRollData.uploadMonth))
          .limit(1);
        
        if (latestMonthData.length > 0) {
          targetMonth = latestMonthData[0].uploadMonth;
        }
      }
      
      // Get filtered data using the optimized method
      const data = await storage.getRentRollDataFiltered(targetMonth, {
        regions: Array.isArray(regions) ? regions : (regions ? [regions] : []),
        divisions: Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []),
        locations: Array.isArray(locations) ? locations : (locations ? [locations] : []),
        limit: 10000 // Large limit for export
      });
      
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data found for the selected filters' });
      }
      
      // Use optimized export utility - only export essential fields
      const { formatExportData, generateOptimizedCSV, generateExportFilename } = await import('./exportUtils');
      const formattedData = formatExportData(data, 'rateCard');
      const csvContent = generateOptimizedCSV(formattedData, 'rateCard');
      const filename = generateExportFilename(`rate-card-${targetMonth}`);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error('Rate card export error:', error);
      res.status(500).json({ error: 'Export failed' });
    }
  });
  
  // AI Floor Plan Auto-Mapping (simplified grid-based approach)
  app.post("/api/campus-maps/:campusId/auto-map", async (req, res) => {
    try {
      const { campusId } = req.params;
      const { autoGenerateFloorPlanForCampus } = await import('./autoGenerateFloorMaps');
      
      const result = await autoGenerateFloorPlanForCampus(campusId);
      
      res.json({
        success: result.created > 0,
        message: result.message,
        stats: {
          detected: result.created,
          created: result.created,
          matched: result.created,
          unmatched: []
        }
      });
    } catch (error) {
      console.error('Auto-mapping error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to auto-map campus' 
      });
    }
  });
  
  // Save unit positions for simplified floor plan
  app.post("/api/campus-maps/unit-positions", async (req, res) => {
    try {
      const { campusMapId, positions } = req.body;
      
      if (!campusMapId || !positions) {
        return res.status(400).json({ error: "Missing required fields: campusMapId, positions" });
      }
      
      // Store positions in the campus map metadata or a separate table
      // For now, we'll store it in the campusMap svgContent as a JSON string
      const positionsJson = JSON.stringify({
        type: 'simplified',
        positions: positions,
        updatedAt: new Date()
      });
      
      await storage.updateCampusMap(campusMapId, {
        svgContent: positionsJson,
        updatedAt: new Date()
      });
      
      res.json({
        success: true,
        message: "Unit positions saved successfully"
      });
    } catch (error) {
      console.error('Error saving unit positions:', error);
      res.status(500).json({ error: "Failed to save unit positions" });
    }
  });
  
  // Clear uploaded floor plan images and regenerate as SVG
  app.post("/api/campus-maps/clear-and-regenerate", async (req, res) => {
    try {
      // First, clear all baseImageUrl values to force SVG generation
      const allMaps = await storage.getCampusMaps();
      let clearedCount = 0;
      
      for (const map of allMaps) {
        if (map.baseImageUrl && !map.isTemplate) {
          await storage.updateCampusMap(map.id, {
            baseImageUrl: null,
            updatedAt: new Date()
          });
          clearedCount++;
        }
      }
      
      // Now regenerate all floor plans as SVG
      const { autoGenerateAllFloorPlans } = await import('./autoGenerateFloorMaps');
      const results = await autoGenerateAllFloorPlans();
      const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
      
      res.json({
        success: true,
        message: `Cleared ${clearedCount} uploaded images and generated ${totalCreated} SVG floor plans`,
        clearedImages: clearedCount,
        generatedFloorPlans: totalCreated,
        results
      });
    } catch (error) {
      console.error('Error clearing and regenerating floor plans:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to clear and regenerate floor plans' 
      });
    }
  });
  
  // Generate floor plans for all campuses at once
  app.post("/api/campus-maps/auto-generate-all", async (req, res) => {
    try {
      const { autoGenerateAllFloorPlans } = await import('./autoGenerateFloorMaps');
      
      const results = await autoGenerateAllFloorPlans();
      const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
      
      res.json({
        success: true,
        message: `Generated floor plans for ${results.length} campuses with ${totalCreated} total units`,
        results
      });
    } catch (error) {
      console.error('Auto-generation error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to generate floor plans' 
      });
    }
  });

  app.get("/api/import/status", async (req, res) => {
    try {
      const rentRollHistory = await storage.getRentRollHistorySummary();
      const enquireData = await storage.getEnquireDataSummary();
      const competitiveSurvey = await storage.getCompetitiveSurveySummary();
      const locationMappings = await storage.getLocationMappingSummary();
      
      res.json({
        rentRollHistory,
        enquireData,
        competitiveSurvey,
        locationMappings
      });
    } catch (error) {
      console.error('Error fetching import status:', error);
      res.status(500).json({ error: "Failed to fetch import status" });
    }
  });

  // Set up scheduled daily calculation at 6am
  const triggerScheduledCalculation = async () => {
    try {
      console.log('[Cron Job] Triggering scheduled calculation at:', new Date().toISOString());
      
      // Get the current date to determine target month
      const now = new Date();
      const targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      // Check if we already have a completed calculation today
      const existingCalc = await storage.getLatestCalculationHistory(null);
      if (existingCalc) {
        const calcDate = new Date(existingCalc.startedAt);
        const today = new Date();
        if (calcDate.toDateString() === today.toDateString() && existingCalc.status === 'completed') {
          console.log(`[Cron Job] Calculation already completed today at ${calcDate.toISOString()}`);
          return;
        }
      }
      
      // Import the job manager
      const { pricingJobManager } = await import('./pricingJobManager');
      
      // Create a calculation history entry for scheduled run
      const historyEntry = await storage.createCalculationHistory({
        calculationType: 'scheduled',
        status: 'started',
        startedAt: new Date(),
        completedAt: null,
        locationId: null, // Portfolio-wide calculation
        uploadMonth: targetMonth,
        totalUnits: null,
        unitsCalculated: null,
        averageModuloRate: null,
        averageAIRate: null,
        errorMessage: null,
        metadata: { 
          triggeredBy: 'cron',
          triggeredAt: new Date().toISOString() 
        }
      });
      
      // Create a new background job for portfolio-wide calculation
      const jobId = pricingJobManager.createJob({
        month: targetMonth,
        calculationHistoryId: historyEntry.id
      });
      
      console.log(`[Cron Job] Created pricing job ${jobId} for scheduled calculation`);
      
    } catch (error) {
      console.error('[Cron Job] Error triggering scheduled calculation:', error);
    }
  };
  
  // Schedule the job to run at 6:00 AM every day
  // Format: minute hour day month dayOfWeek
  // '0 6 * * *' = At 6:00 AM every day
  const scheduledTask = cron.schedule('0 6 * * *', triggerScheduledCalculation, {
    scheduled: true,
    timezone: 'America/New_York' // Adjust timezone as needed
  });
  
  console.log('✅ Daily portfolio calculation scheduled for 6:00 AM EST');
  
  // Optional: Run immediately on startup if no calculation exists for today
  (async () => {
    try {
      const existingCalc = await storage.getLatestCalculationHistory(null);
      if (!existingCalc) {
        console.log('[Startup] No calculations found, running initial calculation...');
        await triggerScheduledCalculation();
      } else {
        const calcDate = new Date(existingCalc.startedAt);
        const hoursSinceLastCalc = (Date.now() - calcDate.getTime()) / (1000 * 60 * 60);
        console.log(`[Startup] Last calculation was ${hoursSinceLastCalc.toFixed(1)} hours ago`);
      }
    } catch (error) {
      console.error('[Startup] Error checking for existing calculations:', error);
    }
  })();
  
  const httpServer = createServer(app);
  return httpServer;
}
