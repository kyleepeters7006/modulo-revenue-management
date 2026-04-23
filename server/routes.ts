/**
 * @fileoverview Modulo Revenue Management API Routes
 * 
 * This file defines all REST API endpoints for the Modulo Revenue Management platform.
 * The platform enables senior living operators to optimize pricing across their portfolio
 * using data-driven algorithms that consider occupancy, competitor rates, market conditions,
 * and room-specific attributes.
 * 
 * ## Major Sections
 * 
 * ### 1. Authentication & Status (Lines ~230-550)
 * - `/api/auth/user` - Mock authentication for demo mode
 * - `/api/status` - Dashboard health check and summary metrics
 * 
 * ### 2. Admin & Data Management (Lines ~265-515)
 * - `/api/admin/*` - Database seeding, competitor rate fixes, location sync
 * - These endpoints are used for initial data setup and maintenance
 * 
 * ### 3. Template Downloads (Lines ~550-880)
 * - `/api/template/*` - Excel templates for data imports (unified, rent-roll, competitor, inquiry)
 * - Provides standardized formats for bulk data uploads
 * 
 * ### 4. Data Import Endpoints (Lines ~920-1255)
 * - `/api/upload/unified` - Combined data upload (rent roll + competitor + performance)
 * - `/api/upload_rent_roll` - Legacy rent roll CSV upload
 * - `/api/upload-rent-roll-mapped` - Flexible column mapping for various source formats
 * - `/api/import-mappings/*` - CRUD for reusable import mapping profiles
 * 
 * ### 5. Pricing Configuration (Lines ~1255-1620)
 * - `/api/weights` - Pricing algorithm weight factors (occupancy, vacancy, seasonality, etc.)
 * - `/api/adjustment-ranges` - Min/max bounds for each pricing adjustment factor
 * - `/api/ai-pricing-weights` - AI-specific pricing configuration
 * - `/api/guardrails` - Floor/ceiling constraints on price recommendations
 * 
 * ### 6. Market Data (Lines ~1690-1825)
 * - `/api/market` - S&P 500 data for economic indicator weighting
 * - `/api/series` - Historical revenue and market index time series for charts
 * 
 * ### 7. Competitor Management (Lines ~1825-1970)
 * - `/api/competitors` - CRUD operations for competitor properties
 * - Supports filtering by region, division, location, and service line
 * - Used to benchmark Trilogy pricing against local market
 * 
 * ### 8. Portfolio & Location Management (Lines ~1970-2350)
 * - `/api/locations` - Campus/property metadata with region/division hierarchy
 * - `/api/portfolio/*` - Bulk operations for multi-campus management
 * 
 * ### 9. Analytics & Overview (Lines ~4450-5400)
 * - `/api/overview` - Dashboard KPIs (occupancy by room type, revenue totals)
 * - `/api/tile-details/:tileType` - Detailed breakdown for dashboard tiles
 * - `/api/analytics/*` - Campus metrics, vacancy analysis, scatter plot data
 * 
 * ### 10. Floor Plans & Room Detection (Lines ~9800-10250)
 * - `/api/campus-maps/*` - Site plan image management
 * - `/api/floor-plans/*` - Building floor plan management with OCR room detection
 * - `/api/unit-polygons/*` - Interactive room polygon mapping for visual pricing
 * 
 * ### 11. Export & Integration (Lines ~2600-2850, 10500-10800)
 * - `/api/export/*` - MatrixCare integration exports, rate cards, rent roll history
 * - `/api/github/*` - Repository backup and version control integration
 * 
 * ## Key Concepts
 * 
 * **Service Lines**: AL (Assisted Living), HC (Health Care/Skilled Nursing), 
 *                    SL (Senior Living), VIL (Independent Living), AL/MC (Memory Care)
 * 
 * **Rate Types**: Street Rate (public pricing), In-House Rate (current resident), 
 *                 Modulo Suggested Rate (algorithm recommendation)
 * 
 * **Competitor Rates**: Imported from competitive surveys, matched to Trilogy units
 *                       by location, service line, and room type
 * 
 * @author Modulo Development Team
 * @version 2.0.0
 * @since December 2025
 */

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { rentRollData, locations, enquireData, adjustmentRanges, guardrails, adjustmentRules, competitiveSurveyData, clients, users, competitors as competitorsTable } from "@shared/schema";
import { sql, and, eq, gte, lt, or, desc, inArray } from "drizzle-orm";
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
import bcrypt from 'bcryptjs';
import { parseNaturalLanguageRule, validateParsedRule } from "./naturalLanguageParser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { callClaude, callClaudeThenGPT } from './aiRouter';
import { 
  insertRentRollDataSchema, 
  insertAssumptionsSchema, 
  insertPricingWeightsSchema,
  insertCompetitorSchema,
  insertGuardrailsSchema
} from "@shared/schema";
import { roomDetectionService, DetectionStrategy } from "./roomDetectionService";
import { calculateModuloPrice } from "./moduloPricingAlgorithm";
import { getSentenceExplanation, generateOverallExplanation } from "./sentenceExplanations";
import { syncLocationsFromRentRoll } from "./syncLocations";
import { importProductionData } from "./importProductionData";
import { calculateAdjustedCompetitorRate } from "./services/competitorAdjustments";
import { processAllUnitsForCompetitorRates, getCompetitorRateSummary } from "./services/competitorRateMatching";
import { startCompetitorRateJob, getJobStatus, getJobsForMonth, resumeInterruptedJobs } from "./services/competitorRateJobService";
import { normalizeRoomType } from "@shared/roomTypes";
import { getGitHubUser, listRepositories, createRepository, getRepository } from "./github-export";
import { calculateAttributedPrice, ensureCacheInitialized, invalidateCache } from "./pricingOrchestrator";
import { attributePricingService } from "./attributePricingService";
import type { PricingInputs } from "./moduloPricingAlgorithm";
import { fetchAndApplyAdjustmentRules } from "./services/adjustmentRulesService";
import { 
  getRevenuePerformanceForScope, 
  calculateGapAnalysis, 
  getSameMonthLastYear 
} from "./services/revenuePerformance";

const upload = multer({ storage: multer.memoryStorage() });

// Building maps storage
let buildingMaps: any[] = [];

// Analytics cache for expensive computations (5 minute TTL)
interface AnalyticsCacheEntry {
  data: any;
  timestamp: number;
}
const analyticsCache = new Map<string, AnalyticsCacheEntry>();
const ANALYTICS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedAnalytics(key: string): any | null {
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ANALYTICS_CACHE_TTL) {
    analyticsCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedAnalytics(key: string, data: any): void {
  analyticsCache.set(key, { data, timestamp: Date.now() });
}

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
  
  // ============================================================================
  // SESSION MIDDLEWARE
  // ============================================================================
  {
    const sessionLib = await import('express-session');
    const connectPg = (await import('connect-pg-simple')).default;
    const pgStore = connectPg(sessionLib.default);
    const sessionStore = new pgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: true,
      ttl: 7 * 24 * 60 * 60,
      tableName: 'sessions',
    });
    app.use(sessionLib.default({
      secret: process.env.SESSION_SECRET || process.env.SEED_SECRET || 'modulo-dev-secret',
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false, // Allow HTTP in dev; set to true in production
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }));
  }

  // ============================================================================
  // MULTI-TENANT AUTHENTICATION
  // ============================================================================

  // clientId middleware — runs before all data routes
  // Unauthenticated requests default to 'demo' client
  app.use((req: any, res, next) => {
    req.clientId = (req.session as any)?.clientId || 'demo';
    next();
  });

  // GET /api/auth/user — returns session user or demo state
  app.get('/api/auth/user', async (req: any, res) => {
    const session = req.session as any;
    if (session?.userId && session?.clientId) {
      try {
        const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
        const clientRows = await db.select().from(clients).where(eq(clients.id, session.clientId)).limit(1);
        if (userRows.length > 0 && clientRows.length > 0) {
          return res.json({
            isAuthenticated: true,
            id: userRows[0].id,
            username: userRows[0].username,
            clientId: clientRows[0].id,
            clientName: clientRows[0].name,
          });
        }
      } catch (e) {
        console.error('Error fetching auth user:', e);
      }
    }
    res.json({ isAuthenticated: false, clientId: 'demo', clientName: 'Demo' });
  });

  // POST /api/auth/login — username + password login
  app.post('/api/auth/login', async (req: any, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    try {
      const userRows = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (userRows.length === 0) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const user = userRows[0];
      if (!user.passwordHash) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const clientRows = await db.select().from(clients).where(eq(clients.id, user.clientId!)).limit(1);
      const client = clientRows[0];
      (req.session as any).userId = user.id;
      (req.session as any).clientId = user.clientId;
      req.session.save(() => {
        res.json({
          isAuthenticated: true,
          id: user.id,
          username: user.username,
          clientId: client.id,
          clientName: client.name,
        });
      });
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // POST /api/auth/logout — destroy session
  app.post('/api/auth/logout', (req: any, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // POST /api/admin/seed-clients — one-time setup of client environments and users
  app.post('/api/admin/seed-clients', async (req: any, res) => {
    const seedSecret = req.headers['x-seed-secret'];
    if (!seedSecret || seedSecret !== process.env.SEED_SECRET) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
      // Upsert the 4 client environments
      const clientDefs = [
        { id: 'demo', name: 'Demo' },
        { id: 'trilogy', name: 'Trilogy Health Services' },
        { id: 'glm', name: 'Great Lakes Management' },
        { id: 'ssmg', name: 'Senior Solutions Management Group' },
      ];
      for (const c of clientDefs) {
        await db.execute(sql`INSERT INTO clients (id, name) VALUES (${c.id}, ${c.name}) ON CONFLICT (id) DO UPDATE SET name = ${c.name}`);
      }

      // Create/update user accounts for each client
      const userDefs = [
        { username: 'trilogy_admin', password: process.env.TRILOGY_PASSWORD!, clientId: 'trilogy', firstName: 'Trilogy', lastName: 'Admin' },
        { username: 'glm_admin', password: process.env.GLM_PASSWORD!, clientId: 'glm', firstName: 'GLM', lastName: 'Admin' },
        { username: 'ssmg_admin', password: process.env.SSMG_PASSWORD!, clientId: 'ssmg', firstName: 'SSMG', lastName: 'Admin' },
      ];
      for (const u of userDefs) {
        if (!u.password) continue;
        const hash = await bcrypt.hash(u.password, 12);
        await db.execute(sql`
          INSERT INTO users (id, username, password_hash, client_id, first_name, last_name)
          VALUES (gen_random_uuid(), ${u.username}, ${hash}, ${u.clientId}, ${u.firstName}, ${u.lastName})
          ON CONFLICT (username) DO UPDATE SET password_hash = ${hash}, client_id = ${u.clientId}
        `);
      }

      // Tag all existing locations + rent roll data as demo if they have no clientId
      await db.execute(sql`UPDATE locations SET client_id = 'demo' WHERE client_id IS NULL`);
      await db.execute(sql`UPDATE rent_roll_data SET client_id = 'demo' WHERE client_id IS NULL`);
      await db.execute(sql`UPDATE competitors SET client_id = 'demo' WHERE client_id IS NULL`);
      await db.execute(sql`UPDATE competitive_survey_data SET client_id = 'demo' WHERE client_id IS NULL`);
      await db.execute(sql`UPDATE inquiry_metrics SET client_id = 'demo' WHERE client_id IS NULL`);

      res.json({ success: true, message: 'Clients and users seeded. Existing data tagged as demo.' });
    } catch (e: any) {
      console.error('Seed error:', e);
      res.status(500).json({ error: e.message });
    }
  });
  
  // POST /api/admin/generate-demo-data — generates 50 synthetic demo locations with full data
  app.post('/api/admin/generate-demo-data', async (req: any, res) => {
    const seedSecret = req.headers['x-seed-secret'];
    if (!seedSecret || seedSecret !== process.env.SEED_SECRET) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
      console.log('[generate-demo-data] Clearing existing demo data...');
      // Clear existing demo data first (idempotent)
      await db.execute(sql`DELETE FROM inquiry_metrics WHERE client_id = 'demo'`);
      await db.execute(sql`DELETE FROM competitive_survey_data WHERE client_id = 'demo'`);
      await db.execute(sql`DELETE FROM rent_roll_data WHERE client_id = 'demo'`);
      await db.execute(sql`DELETE FROM locations WHERE client_id = 'demo'`);
      console.log('[generate-demo-data] Demo data cleared. Generating new data...');

      const { generateDemoData } = await import('./seedDemoData');
      const result = await generateDemoData();

      res.json({
        success: true,
        stats: result,
        message: `Demo data generated: ${result.locations} locations, ${result.rentRoll} rent roll, ${result.competitive} competitive, ${result.inquiry} inquiry records`,
      });
    } catch (e: any) {
      console.error('[generate-demo-data] Error:', e);
      res.status(500).json({ error: e.message });
    }
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

  // POST /api/admin/backfill-companion-room-type
  // Corrects historical rent_roll_data and rent_roll_history rows where room_type
  // was stored as a non-canonical companion variant (e.g., "Companion Suite",
  // "Companion Room") instead of the standard "Companion".
  //
  // Note: Records incorrectly stored as "Studio" due to the parseBedTypeDesc bug
  // (where source BedTypeDesc started with "Compan" but size was not captured)
  // cannot be retroactively identified because the raw BedTypeDesc source value
  // is not persisted in any database column. Those records require re-upload from
  // the original source files. This endpoint corrects all other identifiable cases.
  //
  // Safe to run multiple times (idempotent).
  app.post('/api/admin/backfill-companion-room-type', async (req, res) => {
    try {
      console.log('Running Companion room type backfill...');

      // Pre-check: count rows with non-canonical companion variants
      const preCheckResult = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM rent_roll_data WHERE lower(room_type) LIKE '%compan%' AND room_type != 'Companion') AS rent_roll_data_pre,
          (SELECT count(*)::int FROM rent_roll_history WHERE lower(room_type) LIKE '%compan%' AND room_type != 'Companion') AS rent_roll_history_pre
      `);
      const preCheck = preCheckResult.rows[0] as any;
      console.log(`Pre-backfill: rent_roll_data=${preCheck?.rent_roll_data_pre}, rent_roll_history=${preCheck?.rent_roll_history_pre}`);

      const rentRollResult = await db.execute(sql`
        WITH updated AS (
          UPDATE rent_roll_data
          SET room_type = 'Companion'
          WHERE lower(room_type) LIKE '%compan%'
            AND room_type != 'Companion'
          RETURNING id
        )
        SELECT count(*)::int AS rows_updated FROM updated
      `);

      const historyResult = await db.execute(sql`
        WITH updated AS (
          UPDATE rent_roll_history
          SET room_type = 'Companion'
          WHERE lower(room_type) LIKE '%compan%'
            AND room_type != 'Companion'
          RETURNING id
        )
        SELECT count(*)::int AS rows_updated FROM updated
      `);

      const rentRollUpdated = (rentRollResult.rows[0] as any)?.rows_updated ?? 0;
      const historyUpdated = (historyResult.rows[0] as any)?.rows_updated ?? 0;

      console.log(`Companion backfill complete: rent_roll_data=${rentRollUpdated}, rent_roll_history=${historyUpdated}`);

      res.json({
        success: true,
        rentRollDataRowsUpdated: rentRollUpdated,
        rentRollHistoryRowsUpdated: historyUpdated,
        preCheckCounts: {
          rentRollDataAffected: preCheck?.rent_roll_data_pre ?? 0,
          rentRollHistoryAffected: preCheck?.rent_roll_history_pre ?? 0,
        },
        message: `Backfill complete. Updated ${rentRollUpdated} rent_roll_data rows and ${historyUpdated} rent_roll_history rows.`
      });
    } catch (error) {
      console.error('Error running Companion room type backfill:', error);
      res.status(500).json({ error: 'Failed to run Companion room type backfill' });
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
      
      // Template with description row first, then example data, then empty row, then frequency note
      // Only includes fields that are actually used in the system
      const rentRollTemplate = [
        // Row 1: Field descriptions
        {
          Date: 'DESCRIPTION: Date of rent roll snapshot (YYYY-MM-DD format, use last day of month)',
          Location: 'DESCRIPTION: Facility/campus name (must match Location Data)',
          'Room Number': 'DESCRIPTION: Unit identifier (e.g., 101, 101A, 101B for companion rooms)',
          'Room Type': 'DESCRIPTION: Studio, One Bedroom, Two Bedroom, Companion, Suite',
          'Service Line': 'DESCRIPTION: HC, HC/MC, AL, AL/MC, SL, or VIL',
          'Occupied Y/N': 'DESCRIPTION: Y if occupied, N if vacant',
          'Days Vacant': 'DESCRIPTION: Number of days unit has been vacant (0 if occupied)',
          'Street Rate': 'DESCRIPTION: Monthly rate for new admissions (daily rate for HC/HC-MC)',
          'In-House Rate': 'DESCRIPTION: Current rate being charged (daily for HC/HC-MC)',
          'Care Level': 'DESCRIPTION: Care level tier (Level 1, Level 2, Level 3, Level 4)',
          'Care Rate': 'DESCRIPTION: Monthly care fee based on care level',
          'Payor Type': 'DESCRIPTION: Payment source (Private Pay, Medicaid, Medicare, Managed Care, Hospice)',
          'Location Rating': 'DESCRIPTION: Room location quality rating (A, B, or C)',
          'Size Rating': 'DESCRIPTION: Room size quality rating (A, B, or C)',
          'View Rating': 'DESCRIPTION: Room view quality rating (A, B, or C)',
          'Renovation Rating': 'DESCRIPTION: Room renovation status rating (A, B, or C)',
          'Amenity Rating': 'DESCRIPTION: Room amenity quality rating (A, B, or C)',
          'Move In Date': 'DESCRIPTION: Date resident moved in (YYYY-MM-DD, used for ML training)',
          'Promotion Allowance': 'DESCRIPTION: Dollar amount of any room rate discount applied to the unit — enter as a NEGATIVE number (e.g., -150 for a $150 discount). Enter 0 if no discount. Used for RRA discount trend analytics.'
        },
        // Row 2: Example data
        {
          Date: '2024-01-31',
          Location: 'Anderson - 112',
          'Room Number': '101',
          'Room Type': 'Studio',
          'Service Line': 'AL',
          'Occupied Y/N': 'Y',
          'Days Vacant': 0,
          'Street Rate': 3500,
          'In-House Rate': 3200,
          'Care Level': 'Level 1',
          'Care Rate': 500,
          'Payor Type': 'Private Pay',
          'Location Rating': 'A',
          'Size Rating': 'B',
          'View Rating': 'A',
          'Renovation Rating': 'B',
          'Amenity Rating': 'A',
          'Move In Date': '2023-06-15',
          'Promotion Allowance': -150
        },
        // Row 3: Empty row for spacing
        {},
        // Row 4: Frequency note
        {
          Date: 'FREQUENCY: Monthly upload. Upload one snapshot per month using the last day of each month as the Date.'
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

  // Debug endpoint to test demand data retrieval
  app.get("/api/debug/demand", async (req, res) => {
    try {
      const { location, serviceLine, month } = req.query;
      if (!location || !month) {
        return res.status(400).json({ error: 'location and month are required' });
      }
      
      const demandData = await storage.getDemandDataByLocationServiceLine(
        location as string,
        serviceLine as string || '',
        month as string
      );
      
      res.json({
        location,
        serviceLine,
        month,
        demandData,
        message: demandData.demandHistory.length > 0 
          ? 'Real data found' 
          : 'Using fallback defaults'
      });
    } catch (error) {
      console.error("Error fetching demand data:", error);
      res.status(500).json({ error: "Failed to fetch demand data" });
    }
  });

  // Inquiry Data template download endpoint
  app.get("/api/template/inquiry", async (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      
      // Template with description row first, then example data, then empty row, then frequency note
      const inquiryTemplate = [
        // Row 1: Field descriptions
        {
          Date: 'DESCRIPTION: Date of inquiry data (YYYY-MM-DD format)',
          Location: 'DESCRIPTION: Facility/campus name (must match Location Data)',
          'Service Line': 'DESCRIPTION: HC, HC/MC, AL, AL/MC, SL, or VIL',
          'Lead Source': 'DESCRIPTION: Marketing source (Website, Referral, A Place for Mom, etc.)',
          'Inquiry Count': 'DESCRIPTION: Number of inquiries received (whole number)',
          'Tour Count': 'DESCRIPTION: Number of tours conducted (whole number)'
        },
        // Row 2: Example data
        {
          Date: '2024-01-15',
          Location: 'Anderson - 112',
          'Service Line': 'AL',
          'Lead Source': 'Website',
          'Inquiry Count': 5,
          'Tour Count': 2
        },
        // Row 3: Empty row for spacing
        {},
        // Row 4: Frequency note
        {
          Date: 'FREQUENCY: Daily or monthly upload. System aggregates daily data into monthly totals automatically.'
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

  // Location template download endpoint with description row
  app.get("/api/template/location", async (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      
      // Create template with description row first, then example data, then empty row, then frequency note
      const templateData = [
        // Row 1: Field descriptions
        {
          'Location Name': 'DESCRIPTION: Unique facility/campus name used as the primary identifier',
          'Region': 'DESCRIPTION: Geographic region grouping (e.g., East, West, Central)',
          'Division': 'DESCRIPTION: Sub-region or division within the region',
          'Class': 'DESCRIPTION: Campus classification (e.g., Same Store, New Acquisition)',
          'Address': 'DESCRIPTION: Street address of the facility',
          'City': 'DESCRIPTION: City name',
          'State': 'DESCRIPTION: Two-letter state code (e.g., IN, OH, KY)',
          'Zip Code': 'DESCRIPTION: 5-digit postal code'
        },
        // Row 2: Example data
        {
          'Location Name': 'Anderson - 112',
          'Region': 'East',
          'Division': 'Indiana',
          'Class': 'Same Store',
          'Address': '123 Main Street',
          'City': 'Anderson',
          'State': 'IN',
          'Zip Code': '46011'
        },
        // Row 3: Empty row for spacing
        {},
        // Row 4: Frequency note
        {
          'Location Name': 'FREQUENCY: One upload per data set. System does not account for changes in Regions/Divisions/Classes.'
        }
      ];
      
      const sheet = xlsx.utils.json_to_sheet(templateData);
      xlsx.utils.book_append_sheet(workbook, sheet, 'Locations');
      
      const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="location_template.xlsx"');
      res.send(buffer);
    } catch (error) {
      console.error("Error generating location template:", error);
      res.status(500).json({ error: "Failed to generate template" });
    }
  });

  // Competitive Survey Data template download endpoint
  app.get("/api/template/competitor", async (req, res) => {
    try {
      const workbook = xlsx.utils.book_new();
      
      // Template with description row first, then example data, then empty row, then frequency note
      // Only includes fields that are actually used in competitor matching
      const competitorTemplate = [
        // Row 1: Field descriptions
        {
          'Survey Month': 'DESCRIPTION: Month of survey data (YYYY-MM format, used to select most recent data)',
          'KeyStats Location': 'DESCRIPTION: Your facility name this competitor is near (must match Location Data)',
          'Competitor Name': 'DESCRIPTION: Name of the competing facility',
          'Competitor Address': 'DESCRIPTION: Full address of competitor (used for mapping)',
          'Distance (Miles)': 'DESCRIPTION: Distance from your facility in miles (decimal number)',
          'Competitor Type': 'DESCRIPTION: Service line - HC, HC/MC (or SMC), AL, AL/MC, SL (or IL_IL), VIL (or IL_Villa)',
          'Room Type': 'DESCRIPTION: Studio, One Bedroom, Two Bedroom, Companion',
          'Monthly Rate Avg': 'DESCRIPTION: Average monthly base rent rate (number)',
          'Care Fees Avg': 'DESCRIPTION: Average monthly care fee (number)',
          'Care Level 2 Rate': 'DESCRIPTION: Care Level 2 fee for rate adjustments (used in competitor rate calculations)',
          'Medication Management Fee': 'DESCRIPTION: Medication management fee (used in competitor rate calculations)',
          'Weight': 'DESCRIPTION: Relative importance weight 0-1 (used in rate matching calculations)'
        },
        // Row 2: Example data
        {
          'Survey Month': '2024-01',
          'KeyStats Location': 'Anderson - 112',
          'Competitor Name': 'Sunrise Senior Living',
          'Competitor Address': '123 Main Street, Anderson, IN 46011',
          'Distance (Miles)': 2.5,
          'Competitor Type': 'AL',
          'Room Type': 'Studio',
          'Monthly Rate Avg': 3500,
          'Care Fees Avg': 600,
          'Care Level 2 Rate': 800,
          'Medication Management Fee': 250,
          'Weight': 0.8
        },
        // Row 3: Empty row for spacing
        {},
        // Row 4: Frequency note
        {
          'KeyStats Location': 'FREQUENCY: Periodic upload. Update when new competitive survey data is available (typically quarterly or as market conditions change).'
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

  /* ============================================================================
   * DATA IMPORT ENDPOINTS
   * 
   * These endpoints handle bulk data uploads from various sources including:
   * - Rent roll exports from property management systems
   * - Competitive survey data from market research
   * - Performance metrics from financial systems
   * 
   * Supported formats: CSV, Excel (.xlsx)
   * Data is validated and normalized before storage.
   * 
   * IMPORTANT: Most uploads clear existing data before inserting new records.
   * This ensures a clean state but means partial uploads may result in data loss.
   * ============================================================================ */

  /**
   * POST /api/upload/unified
   * 
   * Accepts a multi-sheet Excel workbook containing combined portfolio data.
   * Processes 'Portfolio Data' sheet containing rent roll + performance metrics.
   * 
   * Expected columns match the unified template format including:
   * Location, Region, Division, Room Number, Room Type, Service Line,
   * Occupied Y/N, Street Rate, In-House Rate, Competitor Rate, etc.
   * 
   * This is the preferred import method as it provides a single source of truth.
   */
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
            roomType: normalizeRoomType(row['Room Type'] || 'Studio'),
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

  /**
   * POST /api/upload_rent_roll (Legacy)
   * 
   * Legacy endpoint for CSV rent roll uploads with fixed column mapping.
   * Expects columns: Unit_ID, Occupied_YN, Base_Rent, Care_Fee, Room_Type,
   * Competitor_Benchmark_Rate, Days_Vacant, Attributes (JSON)
   * 
   * Note: Clears all existing rent roll data before importing.
   * For flexible column mapping, use /api/upload-rent-roll-mapped instead.
   */
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

  // Import Mapping Profiles CRUD
  app.get("/api/import-mappings", async (req, res) => {
    try {
      const { importMappingService } = await import('./services/importMappingService');
      const profiles = await importMappingService.getAllProfiles();
      res.json({ profiles });
    } catch (error) {
      console.error("Error fetching import mappings:", error);
      res.status(500).json({ error: "Failed to fetch import mappings" });
    }
  });

  app.get("/api/import-mappings/:id", async (req, res) => {
    try {
      const { importMappingService } = await import('./services/importMappingService');
      const profile = await importMappingService.getProfileById(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: "Import mapping profile not found" });
      }
      res.json({ profile });
    } catch (error) {
      console.error("Error fetching import mapping:", error);
      res.status(500).json({ error: "Failed to fetch import mapping" });
    }
  });

  app.post("/api/import-mappings", async (req, res) => {
    try {
      const { importMappingService } = await import('./services/importMappingService');
      const profile = await importMappingService.createProfile(req.body);
      res.json({ profile });
    } catch (error) {
      console.error("Error creating import mapping:", error);
      res.status(500).json({ error: "Failed to create import mapping" });
    }
  });

  app.put("/api/import-mappings/:id", async (req, res) => {
    try {
      const { importMappingService } = await import('./services/importMappingService');
      const profile = await importMappingService.updateProfile(req.params.id, req.body);
      if (!profile) {
        return res.status(404).json({ error: "Import mapping profile not found" });
      }
      res.json({ profile });
    } catch (error) {
      console.error("Error updating import mapping:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update import mapping" });
    }
  });

  app.delete("/api/import-mappings/:id", async (req, res) => {
    try {
      const { importMappingService } = await import('./services/importMappingService');
      await importMappingService.deleteProfile(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting import mapping:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete import mapping" });
    }
  });

  // Preview column mappings for a CSV file
  app.post("/api/import-mappings/preview", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { importMappingService } = await import('./services/importMappingService');
      const profileId = req.body.profileId;

      const csvText = req.file.buffer.toString();
      const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      
      if (results.errors.length > 0) {
        return res.status(400).json({ error: "CSV parsing failed", details: results.errors });
      }

      const sourceColumns = results.meta.fields || [];
      const preview = await importMappingService.detectMappings(sourceColumns, profileId);
      
      const sampleRows = (results.data as any[]).slice(0, 5);

      res.json({ 
        preview,
        sourceColumns,
        sampleRows,
        totalRows: results.data.length
      });
    } catch (error) {
      console.error("Error previewing import mappings:", error);
      res.status(500).json({ error: "Failed to preview import mappings" });
    }
  });

  // Upload rent roll with flexible mapping
  app.post("/api/upload-rent-roll-mapped", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { importMappingService, DetectedMapping } = await import('./services/importMappingService');
      const profileId = req.body.profileId;
      const customMappings = req.body.customMappings ? JSON.parse(req.body.customMappings) : null;

      const csvText = req.file.buffer.toString();
      const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      
      if (results.errors.length > 0) {
        return res.status(400).json({ error: "CSV parsing failed", details: results.errors });
      }

      const sourceColumns = results.meta.fields || [];
      let mappings: any[];

      if (customMappings && Array.isArray(customMappings)) {
        mappings = customMappings;
      } else {
        const preview = await importMappingService.detectMappings(sourceColumns, profileId);
        mappings = preview.detectedMappings;
      }

      const unmappedRequired = mappings
        .filter(m => m.isRequired && !m.targetField)
        .map(m => m.sourceColumn);
      
      const requiredFields = importMappingService.getRequiredFields();
      const mappedFields = new Set(mappings.filter(m => m.targetField).map(m => m.targetField));
      const missingRequired = requiredFields.filter(f => !mappedFields.has(f));

      if (missingRequired.length > 0) {
        return res.status(400).json({ 
          error: "Missing required field mappings",
          missingFields: missingRequired
        });
      }

      let processedRows = 0;
      let errorRows = 0;
      const errors: string[] = [];

      for (let i = 0; i < (results.data as any[]).length; i++) {
        const row = (results.data as any[])[i];
        try {
          const mappedRow = importMappingService.applyMappings(row, mappings);
          
          if (!mappedRow.uploadMonth) {
            mappedRow.uploadMonth = new Date().toISOString().substring(0, 7);
          }
          if (!mappedRow.date) {
            mappedRow.date = new Date().toISOString().substring(0, 10);
          }

          const validatedData = insertRentRollDataSchema.parse(mappedRow);
          await storage.createRentRollData(validatedData);
          processedRows++;
        } catch (error) {
          errorRows++;
          if (errors.length < 10) {
            errors.push(`Row ${i + 2}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }

      res.json({ 
        success: true,
        rows: processedRows,
        errorRows,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error("Error uploading mapped rent roll:", error);
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

  /* ============================================================================
   * PRICING CONFIGURATION ENDPOINTS
   * 
   * These endpoints manage the algorithmic pricing parameters that drive
   * Modulo's rate recommendations. Configuration is hierarchical:
   * 
   * 1. Global (portfolio-wide defaults)
   * 2. Location-specific (campus overrides)
   * 3. Location + Service Line specific (most granular)
   * 
   * WEIGHT FACTORS:
   * - occupancyPressure: Adjusts rates based on campus-wide occupancy
   * - daysVacantDecay: Reduces rate recommendations for long-vacant units
   * - seasonality: Accounts for seasonal demand patterns
   * - competitorRates: Weights competitor pricing in recommendations
   * - stockMarket: Economic indicator weighting (S&P 500 correlation)
   * - inquiryTourVolume: Adjusts based on lead activity
   * 
   * GUARDRAILS:
   * - Prevent recommendations from exceeding min/max bounds
   * - Can be set per room type, service line, or campus
   * ============================================================================ */

  // Helper function to format weights response
  const formatWeightsResponse = (weights: any) => ({
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

  // Get weights with path parameters: /api/weights/:locationId/:serviceLine
  app.get("/api/weights/:locationId/:serviceLine", async (req, res) => {
    try {
      const { locationId, serviceLine } = req.params;
      
      // Try to get location+serviceLine specific weights
      let weights = await storage.getWeightsByFilter(locationId, serviceLine);
      
      // Fallback to location-only weights if specific not found
      if (!weights) {
        weights = await storage.getWeightsByFilter(locationId, null);
      }
      
      // Fallback to global weights if no specific weights found
      if (!weights) {
        weights = await storage.getPricingWeights();
      }
      
      if (!weights) {
        return res.status(404).json({ error: "No weights found" });
      }
      
      res.json(formatWeightsResponse(weights));
    } catch (error) {
      console.error("Error fetching weights:", error);
      res.status(500).json({ error: "Failed to fetch weights" });
    }
  });

  // Get weights with path parameter for location only: /api/weights/:locationId
  app.get("/api/weights/:locationId/", async (req, res) => {
    try {
      const { locationId } = req.params;
      
      // Try to get location-level weights
      let weights = await storage.getWeightsByFilter(locationId, null);
      
      // Fallback to global weights if no specific weights found
      if (!weights) {
        weights = await storage.getPricingWeights();
      }
      
      if (!weights) {
        return res.status(404).json({ error: "No weights found" });
      }
      
      res.json(formatWeightsResponse(weights));
    } catch (error) {
      console.error("Error fetching weights:", error);
      res.status(500).json({ error: "Failed to fetch weights" });
    }
  });

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
      
      res.json(formatWeightsResponse(weights));
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

  /**
   * GET /api/series
   * 
   * Generates time series data for the main performance chart showing:
   * - Portfolio revenue over time (from actual rent roll data)
   * - S&P 500 index values (SPY ETF from Alpha Vantage API)
   * - Senior living industry basket: equal-weighted WELL, VTR, BKD, AMH, AGNG
   * 
   * @query timeRange - '1M', '3M', '12M', or '24M' (default: 12M)
   * 
   * Revenue is calculated from stored monthlyRevenue values in rent roll data,
   * converted to annual figures for display (monthly × 12).
   * HC/HC-MC daily rates are multiplied by calendar days per month.
   * 
   * S&P 500 and industry basket require ALPHA_VANTAGE_API_KEY environment variable.
   * Falls back to modeled data if API unavailable.
   * Market data lines return null for the current (incomplete) month.
   */
  app.get("/api/series", async (req: any, res) => {
    try {
      const timeRange = req.query.timeRange as string || '12M';
      const clientId = req.clientId || 'demo';
      const months = timeRange === '1M' ? 1 : timeRange === '3M' ? 3 : timeRange === '12M' ? 12 : 24;
      
      const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

      async function fetchMonthlySeriesFromAlphaVantage(symbol: string): Promise<Record<string, number>> {
        const cached = await storage.getCachedStockData(symbol, 'monthly_series');
        if (cached && cached.metadata) {
          return (cached.metadata as any).series || {};
        }
        if (!apiKey) return {};
        try {
          const url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=${symbol}&apikey=${apiKey}`;
          const response = await fetch(url);
          const data = await response.json();
          if (data["Monthly Time Series"]) {
            const series: Record<string, number> = {};
            Object.keys(data["Monthly Time Series"]).forEach(date => {
              series[date] = parseFloat(data["Monthly Time Series"][date]["4. close"]);
            });
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            await storage.setCachedStockData({
              symbol,
              dataType: 'monthly_series',
              value: 0,
              metadata: { series },
              expiresAt
            });
            console.log(`Fetched ${symbol} monthly series (${Object.keys(series).length} data points) — cached 24h`);
            return series;
          }
          if (data["Note"]) console.warn(`Alpha Vantage rate limit for ${symbol}:`, data["Note"]);
          if (data["Error Message"]) console.error(`Alpha Vantage error for ${symbol}:`, data["Error Message"]);
        } catch (error) {
          console.error(`Failed to fetch ${symbol} monthly series:`, error);
        }
        return {};
      }

      function findClosestPastDate(sortedDates: string[], targetDate: Date, maxDaysBack: number = 45): string | null {
        const targetTime = targetDate.getTime();
        const maxMs = maxDaysBack * 24 * 60 * 60 * 1000;
        let best: string | null = null;
        let bestDiff = Infinity;
        for (const d of sortedDates) {
          const diff = targetTime - new Date(d).getTime();
          if (diff >= 0 && diff <= maxMs && diff < bestDiff) {
            best = d;
            bestDiff = diff;
          }
        }
        return best;
      }

      function isInSameMonth(dateStr: string, targetDate: Date): boolean {
        const d = new Date(dateStr);
        return d.getFullYear() === targetDate.getFullYear() && d.getMonth() === targetDate.getMonth();
      }

      const spyData = await fetchMonthlySeriesFromAlphaVantage('SPY');
      const spySortedDates = Object.keys(spyData).sort();
      const useRealSP500Data = spySortedDates.length > months;

      const INDUSTRY_BASKET = ['WELL', 'VTR', 'BKD', 'AMH', 'AGNG'];
      const basketSeriesMap: Record<string, Record<string, number>> = {};
      for (const symbol of INDUSTRY_BASKET) {
        basketSeriesMap[symbol] = await fetchMonthlySeriesFromAlphaVantage(symbol);
      }
      const hasRealIndustryData = INDUSTRY_BASKET.some(s => Object.keys(basketSeriesMap[s]).length > months);
      
      const currentDate = new Date();
      const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - months + 1, 1);
      
      const monthsToFetch = [];
      for (let i = 0; i < months; i++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthsToFetch.push(monthKey);
      }
      
      const revenueByMonth = await storage.getRevenueByMonths(monthsToFetch, clientId);

      const labels: string[] = [];
      const revenue: (number | null)[] = [];
      const sp500: (number | null)[] = [];
      const industry: (number | null)[] = [];
      
      const industryBaseValues: Record<string, number | null> = {};
      for (const symbol of INDUSTRY_BASKET) {
        const series = basketSeriesMap[symbol];
        const sorted = Object.keys(series).sort();
        if (sorted.length === 0) { industryBaseValues[symbol] = null; continue; }
        const firstMonthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
        const baseMatch = findClosestPastDate(sorted, firstMonthEnd);
        industryBaseValues[symbol] = (baseMatch && isInSameMonth(baseMatch, startDate)) ? series[baseMatch] : null;
      }

      for (let i = 0; i < months; i++) {
        const date = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        labels.push(date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        
        const realRevenue = revenueByMonth[monthKey];
        revenue.push(realRevenue ? Math.round(realRevenue) : null);
        
        const monthEndTarget = new Date(date.getFullYear(), date.getMonth() + 1, 0);

        if (useRealSP500Data) {
          const matchDate = findClosestPastDate(spySortedDates, monthEndTarget);
          if (matchDate && isInSameMonth(matchDate, date)) {
            sp500.push(Math.round(spyData[matchDate]));
          } else {
            sp500.push(null);
          }
        } else {
          sp500.push(null);
        }
        
        if (hasRealIndustryData) {
          const normalizedValues: number[] = [];
          let missingCount = 0;
          for (const symbol of INDUSTRY_BASKET) {
            const series = basketSeriesMap[symbol];
            const sorted = Object.keys(series).sort();
            const baseVal = industryBaseValues[symbol];
            if (sorted.length === 0 || !baseVal) { missingCount++; continue; }
            const matchDate = findClosestPastDate(sorted, monthEndTarget);
            if (matchDate && isInSameMonth(matchDate, date)) {
              normalizedValues.push((series[matchDate] / baseVal) * 100);
            } else {
              missingCount++;
            }
          }
          if (missingCount === 0 && normalizedValues.length === INDUSTRY_BASKET.length) {
            const avg = normalizedValues.reduce((a, b) => a + b, 0) / normalizedValues.length;
            industry.push(Math.round(avg * 100) / 100);
          } else {
            industry.push(null);
          }
        } else {
          industry.push(null);
        }
      }

      res.json({ 
        labels, 
        revenue, 
        sp500, 
        industry,
        dataSource: useRealSP500Data ? "Alpha Vantage (Real Market Data)" : "Market data unavailable (API key not configured)"
      });
    } catch (error) {
      console.error("Error generating series data:", error);
      res.status(500).json({ error: "Failed to generate series data" });
    }
  });

  /* ============================================================================
   * COMPETITOR MANAGEMENT ENDPOINTS
   * 
   * Manages competitor property data used for market positioning analysis.
   * Competitors are matched to Trilogy campuses by location (Trilogy campus name)
   * and compared by room type and service line for pricing benchmarks.
   * 
   * Data sources: Competitive surveys, market research, manual entry
   * Key fields: name, location (Trilogy campus), roomType, streetRate, rating
   * ============================================================================ */

  /**
   * GET /api/competitors
   * 
   * Retrieves competitor properties with optional filtering.
   * Returns top 3 competitors per location unless single location is selected.
   * 
   * @query regions - Comma-separated list of region filters
   * @query divisions - Comma-separated list of division filters  
   * @query locations - Comma-separated list of Trilogy campus names
   * @query serviceLines - Comma-separated service line filters
   * 
   * Response: { items: Competitor[], currentLocation: LocationInfo, totalLocations, totalCompetitors }
   */
  app.get("/api/competitors", async (req: any, res) => {
    try {
      const { regions, divisions, locations, serviceLines } = req.query;
      const clientId = req.clientId || 'demo';
      
      // Build filters object
      const filters: {
        regions?: string[];
        divisions?: string[];
        locations?: string[];
        serviceLines?: string[];
        clientId?: string;
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
      
      filters.clientId = clientId;
      let allCompetitors = hasFilters 
        ? await storage.getCompetitorsWithFilters(filters)
        : await storage.getCompetitors(clientId);
      
      // Get locations for metadata
      const locationData = await storage.getLocations(clientId);
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
  app.get("/api/locations", async (req: any, res) => {
    try {
      const clientId = req.clientId || 'demo';
      const allLocations = await storage.getLocations(clientId);
      
      // Get distinct locations that have rent roll data for this client
      const locationsWithData = await db.selectDistinct({ location: rentRollData.location })
        .from(rentRollData)
        .where(eq(rentRollData.clientId, clientId));
      
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
  app.get("/api/analytics/campus-metrics", async (req: any, res) => {
    try {
      const { region, division, serviceLine } = req.query;
      const clientId = req.clientId || 'demo';
      
      // Check cache first
      const cacheKey = `campus-metrics:${clientId}:${region || 'all'}:${division || 'all'}:${serviceLine || 'all'}`;
      const cached = getCachedAnalytics(cacheKey);
      if (cached) {
        console.log(`Analytics: Serving cached result for ${cacheKey}`);
        return res.json(cached);
      }
      
      // Get all required data - use most recent month (2025-11)
      const currentMonth = '2025-11';  // Fixed to November 2025 which has data
      const [rentRollData, campusData, competitors, pricingWeights, surveyData] = await Promise.all([
        storage.getRentRollDataByMonth(currentMonth, clientId),  // Only get current month data
        storage.getAllCampuses(clientId),
        storage.getCompetitors(clientId),
        storage.getPricingWeights(),
        // Fetch competitive survey data as fallback for market position when units lack competitorFinalRate
        db.select({
          keyStatsLocation: competitiveSurveyData.keyStatsLocation,
          competitorType: competitiveSurveyData.competitorType,
          roomType: competitiveSurveyData.roomType,
          monthlyRateAvg: competitiveSurveyData.monthlyRateAvg,
        }).from(competitiveSurveyData).where(eq(competitiveSurveyData.clientId, clientId))
      ]);

      // Build a lookup map from competitive survey data:
      // location → compType → roomType → avg rate (for fallback market position)
      const surveyRateMap = new Map<string, Map<string, number[]>>();
      for (const row of surveyData) {
        if (!row.keyStatsLocation || !row.monthlyRateAvg || row.monthlyRateAvg <= 0) continue;
        if (!surveyRateMap.has(row.keyStatsLocation)) surveyRateMap.set(row.keyStatsLocation, new Map());
        const locMap = surveyRateMap.get(row.keyStatsLocation)!;
        const key = `${row.competitorType || 'ALL'}:${row.roomType || 'ALL'}`;
        if (!locMap.has(key)) locMap.set(key, []);
        locMap.get(key)!.push(row.monthlyRateAvg);
      }

      // Map service lines to competitor types for survey lookup
      const SL_TO_COMP_TYPE: Record<string, string> = {
        'HC': 'HC', 'HC/MC': 'SMC',
        'AL': 'AL', 'AL/MC': 'AL',
        'SL': 'IL_IL', 'VIL': 'IL_Villa',
      };
      
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

        // Fallback: if no units have competitorFinalRate, use competitive_survey_data
        if (unitsWithCompetitorData === 0) {
          const locSurveyMap = surveyRateMap.get(campusId);
          if (locSurveyMap) {
            metrics.units.forEach((unit: any) => {
              const trilogyRate = unit.streetRate || unit.inHouseRate || 0;
              if (trilogyRate <= 0) return;
              const compType = SL_TO_COMP_TYPE[unit.serviceLine] || null;
              if (!compType) return;
              // Normalize room type to match survey keys
              const rt = (unit.size || unit.roomType || '').replace('Two Bedroom', 'Two Bedroom').replace('One Bedroom', 'One Bedroom');
              const key = `${compType}:${rt}`;
              const fallbackKey = `${compType}:ALL`;
              const rates = locSurveyMap.get(key) || locSurveyMap.get(fallbackKey);
              if (rates && rates.length > 0) {
                const avg = rates.reduce((s: number, r: number) => s + r, 0) / rates.length;
                if (avg > 0) {
                  totalTrilogyRate += trilogyRate;
                  totalCompetitorRate += avg;
                  unitsWithCompetitorData++;
                }
              }
            });
          }
        }
        
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

      const result = {
        campuses: campusesData,
        summary
      };
      
      // Cache the result for 5 minutes
      setCachedAnalytics(cacheKey, result);
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching analytics data:", error);
      res.status(500).json({ error: "Failed to fetch analytics data" });
    }
  });

  // Vacancy scatter plot data endpoint
  app.get("/api/analytics/vacancy-scatter", async (req: any, res) => {
    try {
      const { location, serviceLine } = req.query;
      const clientId = req.clientId || 'demo';
      
      // Check cache first
      const cacheKey = `vacancy-scatter:${clientId}:${location || 'all'}:${serviceLine || 'all'}`;
      const cached = getCachedAnalytics(cacheKey);
      if (cached) {
        console.log(`Vacancy: Serving cached result for ${cacheKey}`);
        return res.json(cached);
      }
      
      // Get the most recent month's data from the database
      const mostRecentMonthResult = await db
        .select({ month: sql<string>`MAX(${rentRollData.uploadMonth})` })
        .from(rentRollData);
      const uploadMonth = mostRecentMonthResult[0]?.month || '2025-11';
      
      console.log('Vacancy analysis using upload month:', uploadMonth);
      
      // Get all rent roll data - getRentRollDataFiltered expects month as first param, filters as second
      const filters: any = { clientId };
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
      
      const result = {
        units: vacancyData,
        summary: {
          totalVacantUnits: vacancyData.filter(u => u.isVacant && !u.isBBed).length,
          totalBBeds: vacancyData.filter(u => u.isBBed).length,
          avgDaysVacant: vacancyData.length > 0 
            ? vacancyData.reduce((sum, u) => sum + u.daysVacant, 0) / vacancyData.length 
            : 0,
          maxDaysVacant: Math.max(...vacancyData.map(u => u.daysVacant), 0)
        }
      };
      
      // Cache the result for 5 minutes
      setCachedAnalytics(cacheKey, result);
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching vacancy scatter data:", error);
      res.status(500).json({ error: "Failed to fetch vacancy scatter data" });
    }
  });

  // Rate breakdown analytics - rates by service line and room type with historical changes
  app.get("/api/analytics/rate-breakdown", async (req: any, res) => {
    try {
      const clientId = req.clientId || 'demo';
      // Get all available months from the database
      const monthsResult = await db
        .select({ month: sql<string>`DISTINCT ${rentRollData.uploadMonth}` })
        .from(rentRollData)
        .where(eq(rentRollData.clientId, clientId))
        .orderBy(sql`${rentRollData.uploadMonth} DESC`);
      
      const availableMonths = monthsResult.map(m => m.month).filter(Boolean).sort().reverse();
      console.log('Rate breakdown: Available months:', availableMonths);
      
      if (availableMonths.length === 0) {
        return res.json({ 
          byServiceLine: [], 
          byServiceLineRoomType: [],
          currentMonth: null 
        });
      }
      
      const currentMonth = availableMonths[0];
      
      // Calculate date references
      const currentDate = new Date(currentMonth + '-01');
      const getMonthStr = (date: Date) => {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      };
      
      // Previous periods
      const previousMonth = new Date(currentDate);
      previousMonth.setMonth(previousMonth.getMonth() - 1);
      const previousMonthStr = getMonthStr(previousMonth);
      
      const t3Month = new Date(currentDate);
      t3Month.setMonth(t3Month.getMonth() - 3);
      const t3MonthStr = getMonthStr(t3Month);
      
      const t6Month = new Date(currentDate);
      t6Month.setMonth(t6Month.getMonth() - 6);
      const t6MonthStr = getMonthStr(t6Month);
      
      const t12Month = new Date(currentDate);
      t12Month.setMonth(t12Month.getMonth() - 12);
      const t12MonthStr = getMonthStr(t12Month);
      
      // YTD - first month of current year
      const ytdMonth = `${currentDate.getFullYear()}-01`;
      
      // Get data for all needed months (only fetch months that exist)
      const monthsToFetch = [currentMonth, previousMonthStr, t3MonthStr, t6MonthStr, t12MonthStr, ytdMonth]
        .filter((m, i, arr) => arr.indexOf(m) === i && availableMonths.includes(m));
      
      console.log('Rate breakdown: Fetching months:', monthsToFetch);
      
      const allData: any[] = [];
      for (const month of monthsToFetch) {
        const monthData = await storage.getRentRollDataByMonth(month, clientId);
        allData.push(...monthData.map((u: any) => ({ ...u, fetchedMonth: month })));
      }
      
      // Helper to calculate average rate for a filter
      const calcAvgRate = (units: any[]) => {
        // Use inHouseRate for occupied, streetRate for all
        const occupiedUnits = units.filter(u => u.occupiedYN === true || u.occupiedYN === 'Y');
        if (occupiedUnits.length === 0) return null;
        
        let totalRate = 0;
        let count = 0;
        
        for (const unit of occupiedUnits) {
          // Normalize to monthly rate for comparison
          const serviceLine = unit.serviceLine || '';
          const isDaily = serviceLine === 'HC' || serviceLine === 'HC/MC';
          const rate = unit.inHouseRate || unit.streetRate || 0;
          const monthlyRate = isDaily ? rate * 30.44 : rate;
          
          if (monthlyRate > 0) {
            totalRate += monthlyRate;
            count++;
          }
        }
        
        return count > 0 ? Math.round(totalRate / count) : null;
      };
      
      // Calculate % change helper
      const calcChange = (current: number | null, previous: number | null): number | null => {
        if (current === null || previous === null || previous === 0) return null;
        return Math.round(((current - previous) / previous) * 1000) / 10; // 1 decimal place
      };
      
      // Get current month data
      const currentData = allData.filter(u => u.uploadMonth === currentMonth);
      
      // Get unique service lines and room types
      const serviceLines = [...new Set(currentData.map(u => u.serviceLine))].filter(Boolean).sort();
      const roomTypes = [...new Set(currentData.map(u => u.roomType))].filter(Boolean).sort();
      
      // Calculate rates by service line
      const byServiceLine = serviceLines.map(sl => {
        const currentUnits = currentData.filter(u => u.serviceLine === sl);
        const prevUnits = allData.filter(u => u.uploadMonth === previousMonthStr && u.serviceLine === sl);
        const t3Units = allData.filter(u => u.uploadMonth === t3MonthStr && u.serviceLine === sl);
        const t6Units = allData.filter(u => u.uploadMonth === t6MonthStr && u.serviceLine === sl);
        const t12Units = allData.filter(u => u.uploadMonth === t12MonthStr && u.serviceLine === sl);
        const ytdUnits = allData.filter(u => u.uploadMonth === ytdMonth && u.serviceLine === sl);
        
        const currentRate = calcAvgRate(currentUnits);
        const prevRate = calcAvgRate(prevUnits);
        const t3Rate = calcAvgRate(t3Units);
        const t6Rate = calcAvgRate(t6Units);
        const t12Rate = calcAvgRate(t12Units);
        const ytdRate = calcAvgRate(ytdUnits);
        
        // Determine if this service line uses daily rates
        const isDaily = sl === 'HC' || sl === 'HC/MC';
        
        return {
          serviceLine: sl,
          currentRate,
          isDaily,
          rateDisplay: currentRate ? (isDaily ? `$${Math.round(currentRate / 30.44)}/day` : `$${currentRate.toLocaleString()}/mo`) : 'N/A',
          unitCount: currentUnits.length,
          occupiedCount: currentUnits.filter(u => u.occupiedYN === true || u.occupiedYN === 'Y').length,
          momChange: calcChange(currentRate, prevRate),
          t3Change: calcChange(currentRate, t3Rate),
          t6Change: calcChange(currentRate, t6Rate),
          t12Change: calcChange(currentRate, t12Rate),
          ytdChange: calcChange(currentRate, ytdRate),
        };
      });
      
      // Calculate rates by service line + room type (limit to top combinations)
      const byServiceLineRoomType: any[] = [];
      
      for (const sl of serviceLines) {
        for (const rt of roomTypes) {
          const currentUnits = currentData.filter(u => u.serviceLine === sl && u.roomType === rt);
          if (currentUnits.length < 3) continue; // Skip combinations with very few units
          
          const prevUnits = allData.filter(u => u.uploadMonth === previousMonthStr && u.serviceLine === sl && u.roomType === rt);
          const t3Units = allData.filter(u => u.uploadMonth === t3MonthStr && u.serviceLine === sl && u.roomType === rt);
          const t6Units = allData.filter(u => u.uploadMonth === t6MonthStr && u.serviceLine === sl && u.roomType === rt);
          const t12Units = allData.filter(u => u.uploadMonth === t12MonthStr && u.serviceLine === sl && u.roomType === rt);
          const ytdUnits = allData.filter(u => u.uploadMonth === ytdMonth && u.serviceLine === sl && u.roomType === rt);
          
          const currentRate = calcAvgRate(currentUnits);
          const prevRate = calcAvgRate(prevUnits);
          const t3Rate = calcAvgRate(t3Units);
          const t6Rate = calcAvgRate(t6Units);
          const t12Rate = calcAvgRate(t12Units);
          const ytdRate = calcAvgRate(ytdUnits);
          
          const isDaily = sl === 'HC' || sl === 'HC/MC';
          
          byServiceLineRoomType.push({
            serviceLine: sl,
            roomType: rt,
            currentRate,
            isDaily,
            rateDisplay: currentRate ? (isDaily ? `$${Math.round(currentRate / 30.44)}/day` : `$${currentRate.toLocaleString()}/mo`) : 'N/A',
            unitCount: currentUnits.length,
            occupiedCount: currentUnits.filter(u => u.occupiedYN === true || u.occupiedYN === 'Y').length,
            momChange: calcChange(currentRate, prevRate),
            t3Change: calcChange(currentRate, t3Rate),
            t6Change: calcChange(currentRate, t6Rate),
            t12Change: calcChange(currentRate, t12Rate),
            ytdChange: calcChange(currentRate, ytdRate),
          });
        }
      }
      
      // Sort by unit count descending
      byServiceLineRoomType.sort((a, b) => b.unitCount - a.unitCount);
      
      res.json({
        byServiceLine,
        byServiceLineRoomType: byServiceLineRoomType.slice(0, 30), // Limit to top 30 combinations
        currentMonth,
        availableMonths: monthsToFetch,
      });
    } catch (error) {
      console.error("Error fetching rate breakdown data:", error);
      res.status(500).json({ error: "Failed to fetch rate breakdown data" });
    }
  });

  // AI Insights
  app.post("/api/ai/suggest", async (req, res) => {
    try {
      const { location, serviceLine } = req.body || {};
      
      let allRentRollData = await storage.getRentRollData();
      let allCompetitors = await storage.getCompetitors();
      
      // Apply filters if provided
      let filteredData = allRentRollData;
      let filteredCompetitors = allCompetitors;
      
      if (location) {
        filteredData = filteredData.filter(u => u.location === location);
        filteredCompetitors = filteredCompetitors.filter(c => c.location === location);
      }
      
      if (serviceLine) {
        filteredData = filteredData.filter(u => u.serviceLine === serviceLine);
        // Competitors may not have service line, so we keep all for the location
      }
      
      // Calculate service line breakdown for context
      const serviceLineBreakdown: Record<string, number> = {};
      filteredData.forEach(u => {
        const sl = u.serviceLine || 'Unknown';
        serviceLineBreakdown[sl] = (serviceLineBreakdown[sl] || 0) + 1;
      });
      
      // Calculate average rates by room type
      const roomTypeRates: Record<string, { total: number; count: number }> = {};
      filteredData.forEach(u => {
        const rt = u.roomType || 'Unknown';
        if (!roomTypeRates[rt]) {
          roomTypeRates[rt] = { total: 0, count: 0 };
        }
        roomTypeRates[rt].total += u.baseRent || 0;
        roomTypeRates[rt].count += 1;
      });
      
      const roomTypeAvgRates = Object.entries(roomTypeRates)
        .map(([type, data]) => `${type}: $${Math.round(data.total / data.count).toLocaleString()}`)
        .join(', ');
      
      // Create context for AI with filtered data
      const totalUnits = filteredData.length;
      const occupiedUnits = filteredData.filter(u => u.occupiedYN).length;
      const occupancyRate = totalUnits > 0 ? occupiedUnits / totalUnits : 0;
      const avgRent = totalUnits > 0 
        ? filteredData.reduce((sum, u) => sum + (u.baseRent || 0), 0) / totalUnits 
        : 0;
      
      const context = {
        totalUnits,
        occupancyRate,
        averageRent: avgRent,
        vacantUnitsOver30Days: filteredData.filter(u => !u.occupiedYN && (u.daysVacant || 0) > 30).length,
        competitorCount: filteredCompetitors.length,
        marketSentiment: marketDataCache.lastMonthReturnPct > 1 ? "bullish" : marketDataCache.lastMonthReturnPct < -1 ? "bearish" : "neutral"
      };

      // Build filter context string for the prompt
      const filterContext = [];
      if (location) filterContext.push(`Location: ${location}`);
      if (serviceLine) filterContext.push(`Service Line: ${serviceLine}`);
      const filterStr = filterContext.length > 0 
        ? `\nFilters Applied: ${filterContext.join(', ')}`
        : '\nScope: All locations and service lines';
      
      const serviceLineStr = Object.entries(serviceLineBreakdown)
        .map(([sl, count]) => `${sl}: ${count} units`)
        .join(', ');

      const prompt = `As a revenue management expert, analyze this senior living property data and provide 3-4 specific pricing recommendations:

Property Context:${filterStr}
- Total Units: ${context.totalUnits}
- Occupancy Rate: ${(context.occupancyRate * 100).toFixed(1)}%
- Average Rent: $${context.averageRent.toFixed(0)}
- Vacant Units (30+ days): ${context.vacantUnitsOver30Days}
- Market Sentiment: ${context.marketSentiment}
- Competitors Tracked: ${context.competitorCount}
- Service Line Distribution: ${serviceLineStr || 'N/A'}
- Avg Rates by Room Type: ${roomTypeAvgRates || 'N/A'}

Provide actionable insights focusing on:
1. Pricing strategy adjustments
2. Occupancy optimization tactics
3. Market positioning recommendations
4. Risk mitigation suggestions

Keep recommendations specific and quantitative when possible.${location ? ` Focus your analysis on ${location}.` : ''}${serviceLine ? ` Consider ${serviceLine}-specific market dynamics.` : ''}`;

      const text = await callClaudeThenGPT(
        'You are a senior living revenue management expert.',
        prompt,
        'Format the following analysis as 3-4 specific, quantitative pricing recommendations for a senior living portfolio dashboard. Be concise, actionable, and reference specific numbers from the data.',
        { label: 'ai-insights', claudeMaxTokens: 1024, gptMaxTokens: 800 }
      );

      res.json({ 
        ok: true, 
        text,
        filters: { location, serviceLine },
        context: {
          totalUnits: context.totalUnits,
          occupancyRate: context.occupancyRate,
          competitorCount: context.competitorCount
        }
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
  app.post("/api/upload/rent-roll", upload.single('file'), async (req: any, res) => {
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

      // Parse Room Rate Adjustment values from various formats: "($10)", "-$20", "-150", numeric
      // Discounts are stored as NEGATIVE numbers (e.g., -150 for a $150 discount)
      const parseRoomRateAdjustment = (value: any): number => {
        if (!value || value === '') return 0;
        const str = String(value).trim();
        
        // Handle parentheses notation for negatives like "($10)" or "(10)" — accounting standard for negative
        const parenMatch = str.match(/\([\$]?(\d+(?:\.\d+)?)\)/);
        if (parenMatch) {
          return -(parseFloat(parenMatch[1]) || 0);
        }
        
        // Handle dollar amounts like "-$20" or "$20"
        const dollarMatch = str.match(/([\-]?)\$(\d+(?:\.\d+)?)/);
        if (dollarMatch) {
          const sign = dollarMatch[1] === '-' ? -1 : 1;
          return sign * (parseFloat(dollarMatch[2]) || 0);
        }
        
        // Handle plain numbers — pass through as-is (negative means discount)
        const numericValue = parseFloat(str.replace(/[^0-9.\-]/g, ''));
        return isNaN(numericValue) ? 0 : numericValue;
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

      // Normalize service line to standard values, preserving Memory Care variants
      // Order matters - check exact compound matches FIRST before checking components
      const normalizeServiceLine = (serviceLine: string): string => {
        if (!serviceLine) return 'AL';
        
        const normalized = serviceLine.toUpperCase().trim();
        
        // Exact matches first (preserves HC/MC and AL/MC)
        if (normalized === 'HC/MC') return 'HC/MC';
        if (normalized === 'AL/MC') return 'AL/MC';
        if (normalized === 'HC/TCU') return 'HC';
        if (normalized === 'HC') return 'HC';
        if (normalized === 'AL') return 'AL';
        if (normalized === 'SL') return 'SL';
        if (normalized === 'VIL') return 'VIL';
        if (normalized === 'IL') return 'SL';
        
        // Pattern matches (check compound patterns before simple ones)
        if (normalized.includes('HC/MC') || normalized.includes('HC-MC')) return 'HC/MC';
        if (normalized.includes('AL/MC') || normalized.includes('AL-MC')) return 'AL/MC';
        if (normalized.includes('HC/TCU') || normalized.includes('TCU')) return 'HC';
        if (normalized.includes('HC') || normalized === 'HEALTH CENTER' || normalized === 'SKILLED NURSING') return 'HC';
        if (normalized.includes('AL') || normalized === 'ASSISTED LIVING') return 'AL';
        if (normalized === 'INDEPENDENT LIVING') return 'SL';
        if (normalized === 'MC' || normalized === 'MEMORY CARE') return 'AL/MC';
        if (normalized === 'SUPPORTIVE LIVING') return 'SL';
        if (normalized.includes('VIL') || normalized.includes('VILLA') || normalized.includes('VILLAGE')) return 'VIL';
        
        // Default to AL if unknown
        return 'AL';
      };

      // Helper to convert Excel serial date numbers to YYYY-MM-DD strings
      // Excel serial for 2000-01-01 = 36526; for 1970-01-01 = 25569
      const convertDate = (val: any): string | null => {
        if (val === null || val === undefined || val === '') return null;
        const num = typeof val === 'number' ? val : Number(val);
        if (!isNaN(num) && num > 36526) {
          const jsDate = new Date((num - 25569) * 86400 * 1000);
          if (!isNaN(jsDate.getTime())) return jsDate.toISOString().split('T')[0];
        }
        const str = val.toString().trim();
        return str || null;
      };

      // Process and store data
      const processedRecords: any[] = [];

      for (const row of jsonData) {
        // Get raw room type with attributes
        const rawRoomType = getRowValue(row, 'BedTypeDesc', 'Room Type', 'room type', 'RoomType', 'roomType') || '';
        
        // Parse attributes from room type
        const { cleanRoomType, viewRating, sizeRating, locationRating, renovationRating, amenityRating } = parseAttributes(rawRoomType);

        // Skip template description/header rows (e.g., rows where room_number is a placeholder like "DESCRIPTION: ...")
        const rawRoomNumber = getRowValue(row, 'Room_Bed', 'Room Number', 'room number', 'RoomNumber', 'roomNumber') || '';
        if (rawRoomNumber.toString().toUpperCase().startsWith('DESCRIPTION:') ||
            rawRoomNumber.toString().toUpperCase().startsWith('EXAMPLE:')) {
          continue;
        }

        // Determine occupancy status with multi-format fallback:
        // 1. MatrixCare/Trilogy: PatientID present → occupied
        // 2. Explicit "Occupied Y/N" column
        // 3. GLM and other formats: in-house rate > 0 → occupied
        const patientId = getRowValue(row, 'PatientID1', 'PatientID', 'patientId', 'patient_id');
        const explicitOccupied = getRowValue(row, 'Occupied Y/N', 'Occupied_YN', 'occupied_yn', 'Occupied', 'Is Occupied');
        const inHouseRateRawForOccupancy = getRowValue(row, 'FinalRate', 'Final Rate', 'final rate', 'In-House Rate', 'in-house rate', 'InHouseRate', 'inHouseRate');
        const inHouseRateNumForOccupancy = parseFloat((inHouseRateRawForOccupancy || '').toString().replace(/[$,()]/g, '').trim()) || 0;
        let isOccupied: boolean;
        if (patientId && patientId.toString().trim() !== '') {
          isOccupied = true;
        } else if (explicitOccupied !== '') {
          isOccupied = ['y', 'yes', 'true', '1', 'occupied'].includes(explicitOccupied.toString().toLowerCase());
        } else {
          isOccupied = inHouseRateNumForOccupancy > 0;
        }
        
        // Get and normalize service line
        const rawServiceLine = getRowValue(row, 'Service1', 'Service Line', 'service line', 'ServiceLine', 'serviceLine') || 'AL';
        const normalizedServiceLine = normalizeServiceLine(rawServiceLine);

        // Parse competitor fields
        const competitorRateValue = getRowValue(row, 'Competitive Rate', 'competitive rate', 'Competitor Rate', 'competitor rate', 'CompetitiveRate', 'CompetitorRate');
        const competitorAvgCareRateValue = getRowValue(row, 'Competitive Average Care Rate', 'competitive average care rate', 'Competitor Average Care Rate', 'competitor average care rate', 'Competitive Avg Care Rate', 'CompetitiveAvgCareRate');
        const competitorFinalRateValue = getRowValue(row, 'Competitive Final Rate', 'competitive final rate', 'Competitor Final Rate', 'competitor final rate', 'CompetitiveFinalRate', 'CompetitorFinalRate');

        // Get street rate: prefer BaseRate1, fall back to Room_Rate when blank
        const parseRate = (raw: string | null | undefined): number => {
          if (!raw) return 0;
          const cleaned = raw.toString().replace(/[$,()]/g, '').trim();
          const parsed = parseFloat(cleaned);
          return isNaN(parsed) ? 0 : parsed;
        };
        const baseRateRaw = getRowValue(row, 'BaseRate1', 'Base Rate', 'base rate', 'Street Rate', 'street rate', 'StreetRate', 'streetRate', 'Rate', 'rate');
        const roomRateRaw = getRowValue(row, 'Room_Rate', 'Room Rate', 'room rate', 'RoomRate');
        const streetRate = parseRate(baseRateRaw) || parseRate(roomRateRaw);

        // Get in-house rate: FinalRate = agreed room charge after special rates (before RRA discounts)
        const finalRateRaw = getRowValue(row, 'FinalRate', 'Final Rate', 'final rate', 'In-House Rate', 'in-house rate', 'InHouseRate', 'inHouseRate');
        const inHouseRate = parseRate(finalRateRaw);

        const rentRollEntry = {
          uploadMonth: uploadMonth,
          date: getRowValue(row, 'Date', 'date') || uploadDate,
          location: getRowValue(row, 'Location', 'location') || '',
          roomNumber: getRowValue(row, 'Room_Bed', 'Room Number', 'room number', 'RoomNumber', 'roomNumber') || '',
          roomType: normalizeRoomType(cleanRoomType),
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
          inHouseRate: inHouseRate,
          discountToStreetRate: parseFloat(getRowValue(row, 'Discount to Street Rate', 'discount to street rate')) || 0,
          careLevel: getRowValue(row, 'Care Level', 'care level') || null,
          careRate: parseFloat(getRowValue(row, 'Care Rate', 'care rate')) || 0,
          rentAndCareRate: parseFloat(getRowValue(row, 'Rent and Care Rate', 'rent and care rate')) || 0,
          competitorRate: parseFloat(competitorRateValue) || 0,
          competitorAvgCareRate: parseFloat(competitorAvgCareRateValue) || 0,
          competitorFinalRate: parseFloat(competitorFinalRateValue) || 0,
          moduloSuggestedRate: null,
          aiSuggestedRate: null,
          promotionAllowance: parseRoomRateAdjustment(getRowValue(row, 'Room_Rate_Adjustments', 'RoomRateAdjustments', 'RRA', 'Promotion Allowance', 'PromotionAllowance')),
          residentId: getRowValue(row, 'Resident ID', 'resident id', 'ResidentID', 'residentId') || null,
          residentName: getRowValue(row, 'Resident Name', 'resident name', 'ResidentName', 'residentName') || null,
          moveInDate: convertDate(getRowValue(row, 'Move In Date', 'move in date', 'MoveInDate', 'moveInDate')) || null,
          moveOutDate: (() => {
            const dv = parseInt(getRowValue(row, 'Textbox18', 'Days Vacant', 'days vacant', 'DaysVacant', 'daysVacant')) || 0;
            if (!isOccupied && dv > 0) {
              const refDate = new Date(getRowValue(row, 'Date', 'date') || uploadDate);
              refDate.setDate(refDate.getDate() - dv);
              return refDate.toISOString().split('T')[0];
            }
            return null;
          })(),
          payorType: getRowValue(row, 'DisplayPayer', 'PayerName', 'Payor Type', 'payor type', 'PayorType', 'payorType', 'Payer', 'payer', 'Payor', 'payor') || null,
          admissionStatus: getRowValue(row, 'Admission Status', 'admission status', 'AdmissionStatus', 'admissionStatus') || null,
          levelOfCare: getRowValue(row, 'Level of Care', 'level of care', 'LevelOfCare', 'levelOfCare') || null,
          medicaidRate: parseFloat(getRowValue(row, 'Medicaid Rate', 'medicaid rate', 'MedicaidRate', 'medicaidRate')) || null,
          medicareRate: parseFloat(getRowValue(row, 'Medicare Rate', 'medicare rate', 'MedicareRate', 'medicareRate')) || null,
          assessmentDate: getRowValue(row, 'Assessment Date', 'assessment date', 'AssessmentDate', 'assessmentDate') || null,
          marketingSource: getRowValue(row, 'Marketing Source', 'marketing source', 'MarketingSource', 'marketingSource') || null,
          inquiryCount: parseInt(getRowValue(row, 'Inquiry Count', 'inquiry count', 'InquiryCount', 'inquiryCount')) || 0,
          tourCount: parseInt(getRowValue(row, 'Tour Count', 'tour count', 'TourCount', 'tourCount')) || 0,
          clientId: req.clientId || 'demo'
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

      const clientId = req.clientId || 'demo';
      const buffer = req.file.buffer;
      let jsonData: any[] = [];

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

      const headers = Object.keys(jsonData[0]);
      const hasEnquireDetail = headers.includes('SaleStage') && headers.includes('Inquiry Date');
      const hasPostAcute = headers.includes('Status') && headers.includes('Referral Date') && !headers.includes('SaleStage');

      const normalizeCareType = (raw: string): string => {
        return raw.trim().replace(/\s*-\s*/g, '-').replace(/\s*\/\s*/g, '/');
      };

      const careToServiceLine: Record<string, string> = {
        'Assisted Living': 'AL',
        'Memory Care-AL': 'AL/MC',
        'SL Apartments': 'SL',
        'IL Patio Homes': 'VIL',
        'Independent Living Apts': 'VIL',
        'Independent Living': 'IL',
        'SNF-Short Term Rehab': 'HC',
        'SNF-Long Term Care': 'HC',
        'Outpatient Therapy': 'HC',
        'Dialysis-SNF': 'HC',
        'Dialysis-Outpatient': 'HC',
        'Memory Care-HC': 'HC/MC',
        'Adult Day/Night-AL': 'AL',
        'Adult Day/Night-HC': 'HC',
      };

      const alServiceLines = ['AL', 'AL/MC', 'SL', 'VIL', 'IL'];
      const hcServiceLines = ['HC', 'HC/MC'];

      let processedRecords: any[] = [];
      let serviceLineScope: string[] = [];
      let detectedFormat = 'generic';

      if (hasEnquireDetail) {
        detectedFormat = 'enquire_detail';
        serviceLineScope = alServiceLines;

        const groups = new Map<string, { inquiries: number; tours: number; conversions: number }>();

        for (const row of jsonData) {
          const dateVal = row['Inquiry Date'];
          if (!dateVal || !row['Location']) continue;

          const care = normalizeCareType(row['Individual Care'] || '');
          const sl = careToServiceLine[care] || (care ? care : 'AL');
          if (hcServiceLines.includes(sl)) continue;

          let month: string;
          if (typeof dateVal === 'number') {
            const excelDate = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
            month = excelDate.toISOString().substring(0, 7);
          } else {
            const d = new Date(dateVal);
            month = d.toISOString().substring(0, 7);
          }

          const location = (row['Location'] || '').trim();
          const leadSource = (row['Individual Market Source'] || '').trim();
          const stage = (row['SaleStage'] || '').trim();

          const key = `${month}|${location}|${sl}|${leadSource}`;
          if (!groups.has(key)) groups.set(key, { inquiries: 0, tours: 0, conversions: 0 });
          const g = groups.get(key)!;

          if (stage === 'Inquiry') g.inquiries++;
          else if (stage === 'Tour' || stage === 'Deposit') g.tours++;
          else if (stage === 'Move In') g.conversions++;
        }

        for (const [key, counts] of groups) {
          const [month, location, sl, leadSource] = key.split('|');
          const yr = parseInt(month.substring(0, 4));
          const mo = parseInt(month.substring(5, 7));
          const lastDay = new Date(yr, mo, 0).getDate();
          const total = counts.inquiries + counts.tours + counts.conversions;

          processedRecords.push({
            uploadMonth: month,
            date: `${month}-${String(lastDay).padStart(2, '0')}`,
            region: '',
            division: '',
            location,
            serviceLine: sl,
            leadSource,
            inquiryCount: counts.inquiries,
            tourCount: counts.tours,
            conversionCount: counts.conversions,
            conversionRate: total > 0 ? Math.round((counts.conversions / total) * 10000) / 100 : 0,
            daysToTour: 0,
            daysToMoveIn: 0,
            clientId,
          });
        }

      } else if (hasPostAcute) {
        detectedFormat = 'post_acute';
        serviceLineScope = hcServiceLines;

        const admitStatuses = new Set(['Admit', 'Discharge', 'LTC - MCD', 'LTC - PP', 'Move In']);
        const groups = new Map<string, { referrals: number; admissions: number }>();

        for (const row of jsonData) {
          const dateVal = row['Referral Date'];
          if (!dateVal || !row['Location']) continue;

          const care = normalizeCareType(row['Individual Care'] || '');
          const sl = careToServiceLine[care] || (care ? care : 'HC');
          if (alServiceLines.includes(sl)) continue;
          const finalSL = care === '' ? 'HC' : sl;

          let month: string;
          if (typeof dateVal === 'number') {
            const excelDate = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
            month = excelDate.toISOString().substring(0, 7);
          } else {
            const d = new Date(dateVal);
            month = d.toISOString().substring(0, 7);
          }

          const location = (row['Location'] || '').trim();
          const leadSource = (row['Individual Market Source'] || '').trim();
          const status = (row['Status'] || '').trim();

          const key = `${month}|${location}|${finalSL}|${leadSource}`;
          if (!groups.has(key)) groups.set(key, { referrals: 0, admissions: 0 });
          const g = groups.get(key)!;

          g.referrals++;
          if (admitStatuses.has(status)) g.admissions++;
        }

        for (const [key, counts] of groups) {
          const [month, location, sl, leadSource] = key.split('|');
          const yr = parseInt(month.substring(0, 4));
          const mo = parseInt(month.substring(5, 7));
          const lastDay = new Date(yr, mo, 0).getDate();

          processedRecords.push({
            uploadMonth: month,
            date: `${month}-${String(lastDay).padStart(2, '0')}`,
            region: '',
            division: '',
            location,
            serviceLine: sl,
            leadSource,
            inquiryCount: counts.referrals,
            tourCount: 0,
            conversionCount: counts.admissions,
            conversionRate: counts.referrals > 0 ? Math.round((counts.admissions / counts.referrals) * 10000) / 100 : 0,
            daysToTour: 0,
            daysToMoveIn: 0,
            clientId,
          });
        }

      } else {
        detectedFormat = 'generic';
        const currentMonth = new Date().toISOString().substring(0, 7);
        for (const row of jsonData) {
          processedRecords.push({
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
            daysToMoveIn: parseInt(row['Days to Move-In'] || row.daysToMoveIn || row['days to move-in']) || 0,
            clientId,
          });
        }
      }

      console.log(`Inquiry data processed (${detectedFormat}): ${processedRecords.length} aggregated records from ${jsonData.length} raw rows`);

      const { insertInquiryMetricsSchema } = await import('@shared/schema');
      const validatedRecords = processedRecords.map(record => insertInquiryMetricsSchema.parse(record));

      const uploadMonth = validatedRecords.length > 0 ? validatedRecords[0].uploadMonth : new Date().toISOString().substring(0, 7);
      await storage.bulkInsertInquiryMetrics(uploadMonth, validatedRecords, {
        clientId,
        serviceLineScope: serviceLineScope.length > 0 ? serviceLineScope : undefined,
      });

      await storage.createUploadHistory({
        uploadMonth,
        fileName: req.file.originalname,
        uploadType: 'inquiry_metrics',
        totalRecords: processedRecords.length
      });

      res.json({
        message: 'Upload successful',
        format: detectedFormat,
        recordsProcessed: processedRecords.length,
        rawRows: jsonData.length,
        serviceLineScope: serviceLineScope.length > 0 ? serviceLineScope : 'all',
      });

    } catch (error) {
      console.error('Inquiry upload error:', error);
      res.status(500).json({ error: 'Failed to process inquiry data upload' });
    }
  });

  // Competitor Data upload endpoint
  app.post("/api/upload/competitor", upload.single('file'), async (req: any, res) => {
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
          clientId: req.clientId || 'demo',
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

  // Location upload endpoint
  app.post("/api/upload/locations", upload.single('file'), async (req, res) => {
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

      // Filter out description rows and frequency rows (rows that start with "DESCRIPTION:" or "FREQUENCY:")
      const dataRows = jsonData.filter((row: any) => {
        const firstValue = Object.values(row)[0];
        if (typeof firstValue !== 'string') return true;
        return !firstValue.startsWith('DESCRIPTION:') && !firstValue.startsWith('FREQUENCY:');
      });

      if (dataRows.length === 0) {
        return res.status(400).json({ error: 'No valid data rows found (only description rows detected)' });
      }

      let created = 0;
      let updated = 0;

      for (const row of dataRows) {
        const locationName = row['Location Name'] || row['location name'] || row['Location'] || row['location'] || row['Name'] || row['name'] || '';
        if (!locationName) continue;

        const locationData = {
          name: locationName,
          region: row['Region'] || row['region'] || null,
          division: row['Division'] || row['division'] || null,
          locationClass: row['Class'] || row['class'] || row['Location Class'] || row['location class'] || null,
          address: row['Address'] || row['address'] || null,
          city: row['City'] || row['city'] || null,
          state: row['State'] || row['state'] || null,
          zipCode: row['Zip Code'] || row['zip code'] || row['ZipCode'] || row['zipcode'] || null,
        };

        // Check if location exists by name
        const existingLocations = await db
          .select()
          .from(locations)
          .where(eq(locations.name, locationName))
          .limit(1);

        if (existingLocations.length > 0) {
          // Update existing location
          await db
            .update(locations)
            .set({
              region: locationData.region,
              division: locationData.division,
              locationClass: locationData.locationClass,
              address: locationData.address,
              city: locationData.city,
              state: locationData.state,
              zipCode: locationData.zipCode,
              updatedAt: new Date(),
            })
            .where(eq(locations.name, locationName));
          updated++;
        } else {
          // Create new location
          await db.insert(locations).values(locationData);
          created++;
        }
      }

      res.json({
        message: 'Location upload successful',
        recordsProcessed: created + updated,
        created,
        updated
      });

    } catch (error) {
      console.error('Location upload error:', error);
      res.status(500).json({ error: 'Failed to process location data upload' });
    }
  });

  /* ============================================================================
   * ANALYTICS & OVERVIEW ENDPOINTS
   * 
   * These endpoints power the main dashboard and provide aggregate portfolio metrics.
   * They calculate real-time KPIs from the rent roll data including occupancy rates,
   * revenue totals, and room type breakdowns.
   * 
   * IMPORTANT: B-bed handling varies by service line:
   * - Senior Housing (AL, IL, SL, VIL, AL/MC): B-beds are EXCLUDED from unit counts
   *   but their REVENUE is included in totals
   * - Health Care (HC, HC/MC, SMC): B-beds ARE included in counts (both beds count)
   * 
   * All analytics use 5-minute caching to reduce database load from repeated queries.
   * ============================================================================ */

  /**
   * GET /api/overview
   * 
   * Returns dashboard summary data including:
   * - Occupancy breakdown by room type and service line
   * - Current vs potential annual revenue
   * - Portfolio-wide unit counts
   * - Average rates for HC (daily) and Senior Housing (monthly)
   * 
   * @query serviceLine - Optional filter: 'AL', 'HC', 'SL', 'VIL', 'IL', 'AL/MC', or 'All'
   * 
   * Response includes:
   * - occupancyByRoomType: Array of room types with occupied/total counts
   * - occupancyByServiceLine: Same breakdown grouped by service line
   * - currentAnnualRevenue: Actual revenue from occupied units (annualized)
   * - potentialAnnualRevenue: Revenue if 100% occupied (annualized)
   * - avgHcRate: Average daily rate for skilled nursing beds
   * - avgSeniorHousingRate: Average monthly rate for AL/IL/SL units
   */
  app.get("/api/overview", async (req: any, res) => {
    try {
      const serviceLineFilter = req.query.serviceLine as string;
      const clientId = req.clientId || 'demo';
      
      // Check cache first (use service line filter and client as part of key)
      const cacheKey = `overview_${clientId}_${serviceLineFilter || 'all'}`;
      const cached = getCachedAnalytics(cacheKey);
      if (cached) {
        return res.json(cached);
      }
      
      // Get the most recent month's data only for this client
      const mostRecentMonthResult = await db
        .select({ month: sql<string>`MAX(${rentRollData.uploadMonth})` })
        .from(rentRollData)
        .where(eq(rentRollData.clientId, clientId));
      const mostRecentMonth = mostRecentMonthResult[0]?.month || '2025-11';
      
      // Filter to most recent month only for this client
      const allRentRollData = await db
        .select()
        .from(rentRollData)
        .where(and(
          sql`${rentRollData.uploadMonth} = ${mostRecentMonth}`,
          eq(rentRollData.clientId, clientId)
        ));
      
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
        // Use competitorFinalRate which is the adjusted rate from the competitor rate matching job
        let avgCompetitorRate = 0;
        if (roomTypeUnits.length > 0) {
          const unitsWithCompetitorData = roomTypeUnits.filter(u => u.competitorFinalRate && u.competitorFinalRate > 0);
          if (unitsWithCompetitorData.length > 0) {
            const normalizedRates = unitsWithCompetitorData.map(u => {
              let rate = u.competitorFinalRate || 0;
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
          // Use competitorFinalRate which is the adjusted rate from the competitor rate matching job
          let slAvgCompetitorRate = 0;
          if (slUnits.length > 0) {
            // Filter to only units with actual competitor rates
            const unitsWithCompetitorData = slUnits.filter(u => u.competitorFinalRate && u.competitorFinalRate > 0);
            
            if (unitsWithCompetitorData.length > 0) {
              const competitorRates = unitsWithCompetitorData.map(u => {
                let rate = u.competitorFinalRate || 0;
                
                // Convert HC/SMC daily rates to monthly (multiply by 30.44)
                // HC rates below $1000 are likely daily rates that need conversion
                if ((serviceLine === 'HC' || serviceLine === 'HC/MC' || serviceLine === 'SMC') && rate > 0 && rate < 1000) {
                  rate = rate * 30.44; // Convert daily to monthly
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
        // Use competitorFinalRate which is the adjusted rate from the competitor rate matching job
        let avgCompetitorRate = 0;
        if (serviceLineUnits.length > 0) {
          const unitsWithCompetitorData = serviceLineUnits.filter(u => u.competitorFinalRate && u.competitorFinalRate > 0);
          if (unitsWithCompetitorData.length > 0) {
            const normalizedRates = unitsWithCompetitorData.map(u => {
              let rate = u.competitorFinalRate || 0;
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
      
      // Use competitorFinalRate which is the adjusted rate from the competitor rate matching job
      const hcUnitsWithCompetitor = hcUnits.filter((u: any) => u.competitorFinalRate && u.competitorFinalRate > 0);
      const avgHcCompetitorRate = hcUnitsWithCompetitor.length > 0
        ? hcUnitsWithCompetitor.reduce((sum: number, u: any) => {
            let rate = u.competitorFinalRate || 0;
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
      
      // Use competitorFinalRate which is the adjusted rate from the competitor rate matching job
      const shUnitsWithCompetitor = shUnits.filter((u: any) => u.competitorFinalRate && u.competitorFinalRate > 0);
      const avgSeniorHousingCompetitorRate = shUnitsWithCompetitor.length > 0
        ? shUnitsWithCompetitor.reduce((sum: number, u: any) => sum + (u.competitorFinalRate || 0), 0) / shUnitsWithCompetitor.length
        : 0;

      const result = {
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
      };
      
      // Cache the result for 5 minutes
      setCachedAnalytics(cacheKey, result);
      res.json(result);

    } catch (error) {
      console.error('Overview data error:', error);
      res.status(500).json({ error: 'Failed to fetch overview data' });
    }
  });

  /**
   * GET /api/tile-details/:tileType
   * 
   * Provides detailed monthly trend data for dashboard KPI tiles.
   * Returns historical values, growth rates, and breakdowns by dimension.
   * 
   * @param tileType - One of: 'units', 'occupancy', 'current-revenue', 'potential-revenue'
   * 
   * Uses SQL aggregation directly in the database to avoid loading all 391,000+
   * rent roll records into memory. Results are grouped by:
   * - Month (for time series)
   * - Service Line (for segment breakdown)
   * - Location (for campus-level detail)
   * - Same Store flag (for comparable growth analysis)
   * 
   * PERFORMANCE: Optimized query avoids full table scans by using indexed uploadMonth
   * and computing aggregates at the database level.
   */
  app.get("/api/tile-details/:tileType", async (req, res) => {
    try {
      const { tileType } = req.params;
      const clientId = req.clientId || 'demo';
      const validTileTypes = ['units', 'occupancy', 'current-revenue', 'potential-revenue'];
      
      if (!validTileTypes.includes(tileType)) {
        return res.status(400).json({ error: `Invalid tile type. Must be one of: ${validTileTypes.join(', ')}` });
      }
      
      // Helper function to calculate growth percentage
      const calculateGrowth = (current: number, previous: number): number => {
        if (previous === 0) return 0;
        return Math.round(((current - previous) / previous) * 100 * 100) / 100;
      };
      
      // Get all available months from the database (last 12 months) for this client
      const availableMonths = await db
        .select({ month: sql<string>`DISTINCT ${rentRollData.uploadMonth}` })
        .from(rentRollData)
        .where(eq(rentRollData.clientId, clientId))
        .orderBy(sql`${rentRollData.uploadMonth} DESC`)
        .limit(12);
      
      const months = availableMonths.map(m => m.month).sort();
      const mostRecentMonth = months[months.length - 1] || '';
      
      // Determine YTD start month (January of current year or first available month)
      const currentYear = mostRecentMonth ? mostRecentMonth.substring(0, 4) : new Date().getFullYear().toString();
      const ytdStartMonth = `${currentYear}-01`;
      
      // Senior housing service lines for B-bed exclusion
      const seniorHousingServiceLines = ['AL', 'SL', 'VIL', 'IL', 'AL/MC'];
      
      // Build SQL aggregation based on tile type using database-level computation
      // This avoids loading all records into memory
      let monthlyAggQuery;
      
      // B-bed exclusion condition for units/occupancy tile types
      const excludeBBeds = sql`NOT (${rentRollData.serviceLine} IN ('AL', 'SL', 'VIL', 'IL', 'AL/MC') 
                       AND ${rentRollData.roomNumber} LIKE '%/B')`;
      
      switch (tileType) {
        case 'units':
          monthlyAggQuery = db
            .select({
              month: rentRollData.uploadMonth,
              serviceLine: rentRollData.serviceLine,
              location: rentRollData.location,
              roomType: rentRollData.roomType,
              sameStore: rentRollData.sameStore,
              value: sql<number>`COUNT(*)::int`,
            })
            .from(rentRollData)
            .where(and(
              eq(rentRollData.clientId, clientId),
              inArray(rentRollData.uploadMonth, months),
              excludeBBeds
            ))
            .groupBy(rentRollData.uploadMonth, rentRollData.serviceLine, rentRollData.location, rentRollData.roomType, rentRollData.sameStore);
          break;
          
        case 'occupancy':
          monthlyAggQuery = db
            .select({
              month: rentRollData.uploadMonth,
              serviceLine: rentRollData.serviceLine,
              location: rentRollData.location,
              roomType: rentRollData.roomType,
              sameStore: rentRollData.sameStore,
              occupied: sql<number>`SUM(CASE WHEN ${rentRollData.occupiedYN} THEN 1 ELSE 0 END)::int`,
              total: sql<number>`COUNT(*)::int`,
            })
            .from(rentRollData)
            .where(and(
              eq(rentRollData.clientId, clientId),
              inArray(rentRollData.uploadMonth, months),
              excludeBBeds
            ))
            .groupBy(rentRollData.uploadMonth, rentRollData.serviceLine, rentRollData.location, rentRollData.roomType, rentRollData.sameStore);
          break;
          
        case 'current-revenue':
          // Only count private pay residents (PRIVATE PAY, LEGACY - PVT PAY, BEDHOLDS)
          monthlyAggQuery = db
            .select({
              month: rentRollData.uploadMonth,
              serviceLine: rentRollData.serviceLine,
              location: rentRollData.location,
              roomType: rentRollData.roomType,
              sameStore: rentRollData.sameStore,
              value: sql<number>`SUM(
                CASE WHEN ${rentRollData.occupiedYN} 
                  AND NOT (
                    UPPER(COALESCE(${rentRollData.payorType}, '')) LIKE '%HOSPICE%'
                    OR UPPER(COALESCE(${rentRollData.payorType}, '')) LIKE '%MEDICAID%'
                    OR UPPER(COALESCE(${rentRollData.payorType}, '')) LIKE '%MEDICARE%'
                    OR UPPER(COALESCE(${rentRollData.payorType}, '')) LIKE '%MANAGED%'
                  )
                THEN
                  CASE 
                    WHEN ${rentRollData.serviceLine} IN ('HC', 'HC/MC', 'SMC') THEN
                      COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 365
                    ELSE 
                      COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 12
                  END
                ELSE 0 END
              )`,
            })
            .from(rentRollData)
            .where(and(eq(rentRollData.clientId, clientId), inArray(rentRollData.uploadMonth, months)))
            .groupBy(rentRollData.uploadMonth, rentRollData.serviceLine, rentRollData.location, rentRollData.roomType, rentRollData.sameStore);
          break;
          
        case 'potential-revenue':
          // For potential revenue: private pay occupied + (vacant units * private pay proportion)
          // We calculate: private pay revenue + (vacant units * avg private pay rate)
          // Using subquery to get private pay proportion per service line
          monthlyAggQuery = db
            .select({
              month: rentRollData.uploadMonth,
              serviceLine: rentRollData.serviceLine,
              location: rentRollData.location,
              roomType: rentRollData.roomType,
              sameStore: rentRollData.sameStore,
              value: sql<number>`SUM(
                CASE 
                  -- For occupied private pay units, use actual rates
                  WHEN ${rentRollData.occupiedYN} AND (
                    ${rentRollData.payorType} IS NULL 
                    OR ${rentRollData.payorType} = ''
                    OR UPPER(${rentRollData.payorType}) LIKE '%PRIVATE%'
                    OR UPPER(${rentRollData.payorType}) LIKE '%PVT%'
                    OR UPPER(${rentRollData.payorType}) LIKE '%BEDHOLD%'
                  ) THEN
                    CASE 
                      WHEN ${rentRollData.serviceLine} IN ('HC', 'HC/MC', 'SMC') THEN
                        COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 365
                      ELSE 
                        COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 12
                    END
                  -- For vacant units, assume same private pay proportion as occupied
                  WHEN NOT ${rentRollData.occupiedYN} THEN
                    CASE 
                      WHEN ${rentRollData.serviceLine} IN ('HC', 'HC/MC', 'SMC') THEN
                        COALESCE(${rentRollData.streetRate}, 0) * 365 * 0.65
                      ELSE 
                        COALESCE(${rentRollData.streetRate}, 0) * 12
                    END
                  ELSE 0
                END
              )`,
            })
            .from(rentRollData)
            .where(and(eq(rentRollData.clientId, clientId), inArray(rentRollData.uploadMonth, months)))
            .groupBy(rentRollData.uploadMonth, rentRollData.serviceLine, rentRollData.location, rentRollData.roomType, rentRollData.sameStore);
          break;
      }
      
      const aggregatedData = await monthlyAggQuery;
      
      // Fetch same-store location names from the locations table (authoritative source)
      const sameStoreLocationRows = await db
        .select({ name: locations.name })
        .from(locations)
        .where(and(eq(locations.clientId, clientId), eq(locations.sameStore, true)));
      const sameStoreLocationNames = new Set<string>(sameStoreLocationRows.map(r => r.name));
      
      // Process aggregated data to build response structures
      type MonthlyTrendItem = { month: string; value: number; byServiceLine: Record<string, number>; };
      const monthlyTrend: MonthlyTrendItem[] = [];
      const serviceLineStats: Record<string, { values: Record<string, number>, currentValue: number }> = {};
      const locationStats: Record<string, number> = {};
      const roomTypeStats: Record<string, number> = {};
      const sameStoreMonthlyValues: Record<string, number> = {};
      
      // Initialize data structures for all months
      const monthlyData: Record<string, { total: number; occupied?: number; byServiceLine: Record<string, { value: number; occupied?: number; total?: number }> }> = {};
      const sameStoreData: Record<string, { total: number; occupied?: number; byServiceLine: Record<string, { value: number; occupied?: number; total?: number }> }> = {};
      
      for (const month of months) {
        monthlyData[month] = { total: 0, occupied: 0, byServiceLine: {} };
        sameStoreData[month] = { total: 0, occupied: 0, byServiceLine: {} };
      }

      // Aggregate the data
      for (const row of aggregatedData) {
        const month = row.month;
        const sl = row.serviceLine;
        const isSameStore = sameStoreLocationNames.has(row.location);
        
        if (!monthlyData[month]) continue;
        
        if (tileType === 'occupancy') {
          const occupied = (row as any).occupied || 0;
          const total = (row as any).total || 0;
          
          monthlyData[month].total = (monthlyData[month].total || 0) + total;
          monthlyData[month].occupied = (monthlyData[month].occupied || 0) + occupied;
          
          if (!monthlyData[month].byServiceLine[sl]) {
            monthlyData[month].byServiceLine[sl] = { value: 0, occupied: 0, total: 0 };
          }
          monthlyData[month].byServiceLine[sl].occupied = (monthlyData[month].byServiceLine[sl].occupied || 0) + occupied;
          monthlyData[month].byServiceLine[sl].total = (monthlyData[month].byServiceLine[sl].total || 0) + total;
          
          if (isSameStore) {
            sameStoreData[month].total = (sameStoreData[month].total || 0) + total;
            sameStoreData[month].occupied = (sameStoreData[month].occupied || 0) + occupied;
            if (!sameStoreData[month].byServiceLine[sl]) {
              sameStoreData[month].byServiceLine[sl] = { value: 0, occupied: 0, total: 0 };
            }
            sameStoreData[month].byServiceLine[sl].occupied = (sameStoreData[month].byServiceLine[sl].occupied || 0) + occupied;
            sameStoreData[month].byServiceLine[sl].total = (sameStoreData[month].byServiceLine[sl].total || 0) + total;
          }
        } else {
          const value = (row as any).value || 0;
          
          monthlyData[month].total = (monthlyData[month].total || 0) + value;
          
          if (!monthlyData[month].byServiceLine[sl]) {
            monthlyData[month].byServiceLine[sl] = { value: 0 };
          }
          monthlyData[month].byServiceLine[sl].value = (monthlyData[month].byServiceLine[sl].value || 0) + value;
          
          if (isSameStore) {
            sameStoreData[month].total = (sameStoreData[month].total || 0) + value;
            if (!sameStoreData[month].byServiceLine[sl]) {
              sameStoreData[month].byServiceLine[sl] = { value: 0 };
            }
            sameStoreData[month].byServiceLine[sl].value = (sameStoreData[month].byServiceLine[sl].value || 0) + value;
          }
        }
        
        // For current month, accumulate location and room type stats
        if (month === mostRecentMonth) {
          const locValue = tileType === 'occupancy' ? ((row as any).occupied || 0) : ((row as any).value || 0);
          locationStats[row.location] = (locationStats[row.location] || 0) + locValue;
          roomTypeStats[row.roomType] = (roomTypeStats[row.roomType] || 0) + locValue;
        }
      }
      
      // Build monthly trend
      for (const month of months) {
        const data = monthlyData[month];
        let monthValue: number;
        const byServiceLine: Record<string, number> = {};
        
        if (tileType === 'occupancy') {
          monthValue = data.total > 0 ? Math.round(((data.occupied || 0) / data.total) * 100 * 100) / 100 : 0;
          
          for (const [sl, slData] of Object.entries(data.byServiceLine)) {
            const slTotal = slData.total || 0;
            const slOccupied = slData.occupied || 0;
            byServiceLine[sl] = slTotal > 0 ? Math.round((slOccupied / slTotal) * 100 * 100) / 100 : 0;
          }
        } else {
          monthValue = data.total;
          for (const [sl, slData] of Object.entries(data.byServiceLine)) {
            byServiceLine[sl] = slData.value || 0;
          }
        }
        
        monthlyTrend.push({ month, value: monthValue, byServiceLine });
        
        // Same store value
        if (tileType === 'occupancy') {
          const ssData = sameStoreData[month];
          sameStoreMonthlyValues[month] = ssData.total > 0 ? 
            Math.round(((ssData.occupied || 0) / ssData.total) * 100 * 100) / 100 : 0;
        } else {
          sameStoreMonthlyValues[month] = sameStoreData[month].total;
        }
        
        // Track service line trends
        for (const [sl, value] of Object.entries(byServiceLine)) {
          if (!serviceLineStats[sl]) {
            serviceLineStats[sl] = { values: {}, currentValue: 0 };
          }
          serviceLineStats[sl].values[month] = value;
          if (month === mostRecentMonth) {
            serviceLineStats[sl].currentValue = value;
          }
        }
      }
      
      // Calculate growth statistics
      const currentValue = monthlyTrend[monthlyTrend.length - 1]?.value || 0;
      const getValueAtIndex = (idx: number) => monthlyTrend[idx]?.value || 0;
      const monthCount = monthlyTrend.length;
      
      const growthStats = {
        t1: monthCount >= 2 ? calculateGrowth(currentValue, getValueAtIndex(monthCount - 2)) : 0,
        t3: monthCount >= 4 ? calculateGrowth(currentValue, getValueAtIndex(monthCount - 4)) : 0,
        t6: monthCount >= 7 ? calculateGrowth(currentValue, getValueAtIndex(monthCount - 7)) : 0,
        t12: monthCount >= 12 ? calculateGrowth(currentValue, getValueAtIndex(0)) : 0,
        ytd: (() => {
          const ytdIndex = monthlyTrend.findIndex(m => m.month >= ytdStartMonth);
          return ytdIndex >= 0 ? calculateGrowth(currentValue, getValueAtIndex(ytdIndex)) : 0;
        })()
      };
      
      // Calculate same store growth statistics
      const sameStoreCurrentValue = sameStoreMonthlyValues[mostRecentMonth] || 0;
      const sameStoreValues = months.map(m => sameStoreMonthlyValues[m] || 0);
      const getSameStoreValueAtIndex = (idx: number) => sameStoreValues[idx] || 0;
      
      const sameStoreGrowthStats = {
        t1: monthCount >= 2 ? calculateGrowth(sameStoreCurrentValue, getSameStoreValueAtIndex(monthCount - 2)) : 0,
        t3: monthCount >= 4 ? calculateGrowth(sameStoreCurrentValue, getSameStoreValueAtIndex(monthCount - 4)) : 0,
        t6: monthCount >= 7 ? calculateGrowth(sameStoreCurrentValue, getSameStoreValueAtIndex(monthCount - 7)) : 0,
        t12: monthCount >= 12 ? calculateGrowth(sameStoreCurrentValue, getSameStoreValueAtIndex(0)) : 0,
        ytd: (() => {
          const ytdIndex = months.findIndex(m => m >= ytdStartMonth);
          return ytdIndex >= 0 ? calculateGrowth(sameStoreCurrentValue, getSameStoreValueAtIndex(ytdIndex)) : 0;
        })()
      };
      
      // Build service line breakdown with trends and growth stats
      const byServiceLine = Object.entries(serviceLineStats).map(([serviceLine, stats]) => {
        const trend = months.map(m => stats.values[m] || 0);
        const currentVal = stats.currentValue;
        const valCount = trend.length;
        
        // Calculate YTD for this service line
        const slYtdIndex = months.findIndex(m => m >= ytdStartMonth);
        const slYtdValue = slYtdIndex >= 0 ? trend[slYtdIndex] || 0 : 0;
        
        return {
          serviceLine,
          value: currentVal,
          trend,
          growthStats: {
            t1: valCount >= 2 ? calculateGrowth(currentVal, trend[valCount - 2] || 0) : 0,
            t3: valCount >= 4 ? calculateGrowth(currentVal, trend[valCount - 4] || 0) : 0,
            t6: valCount >= 7 ? calculateGrowth(currentVal, trend[valCount - 7] || 0) : 0,
            t12: valCount >= 12 ? calculateGrowth(currentVal, trend[0] || 0) : 0,
            ytd: slYtdIndex >= 0 ? calculateGrowth(currentVal, slYtdValue) : 0
          }
        };
      }).sort((a, b) => b.value - a.value);
      
      // Build Same Store service line breakdown with trends and growth stats
      const sameStoreServiceLineStats: Record<string, { values: Record<string, number>, currentValue: number }> = {};
      for (const month of months) {
        const ssData = sameStoreData[month];
        for (const [sl, slData] of Object.entries(ssData.byServiceLine)) {
          if (!sameStoreServiceLineStats[sl]) {
            sameStoreServiceLineStats[sl] = { values: {}, currentValue: 0 };
          }
          let slValue: number;
          if (tileType === 'occupancy') {
            const slTotal = slData.total || 0;
            const slOccupied = slData.occupied || 0;
            slValue = slTotal > 0 ? Math.round((slOccupied / slTotal) * 100 * 100) / 100 : 0;
          } else {
            slValue = slData.value || 0;
          }
          sameStoreServiceLineStats[sl].values[month] = slValue;
          if (month === mostRecentMonth) {
            sameStoreServiceLineStats[sl].currentValue = slValue;
          }
        }
      }
      
      const sameStoreByServiceLine = Object.entries(sameStoreServiceLineStats).map(([serviceLine, stats]) => {
        const trend = months.map(m => stats.values[m] || 0);
        const currentVal = stats.currentValue;
        const valCount = trend.length;
        
        const slYtdIndex = months.findIndex(m => m >= ytdStartMonth);
        const slYtdValue = slYtdIndex >= 0 ? trend[slYtdIndex] || 0 : 0;
        
        return {
          serviceLine,
          value: currentVal,
          trend,
          growthStats: {
            t1: valCount >= 2 ? calculateGrowth(currentVal, trend[valCount - 2] || 0) : 0,
            t3: valCount >= 4 ? calculateGrowth(currentVal, trend[valCount - 4] || 0) : 0,
            t6: valCount >= 7 ? calculateGrowth(currentVal, trend[valCount - 7] || 0) : 0,
            t12: valCount >= 12 ? calculateGrowth(currentVal, trend[0] || 0) : 0,
            ytd: slYtdIndex >= 0 ? calculateGrowth(currentVal, slYtdValue) : 0
          }
        };
      }).sort((a, b) => b.value - a.value);
      
      // Build location breakdown (top 20 for pie chart)
      const byLocation = Object.entries(locationStats)
        .map(([location, value]) => ({ location, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 20);
      
      // Build room type breakdown
      const byRoomType = Object.entries(roomTypeStats)
        .map(([roomType, value]) => ({ roomType, value }))
        .sort((a, b) => b.value - a.value);
      
      // For revenue tiles, also calculate rate growth metrics
      let rateMetrics = null;
      if (tileType === 'current-revenue' || tileType === 'potential-revenue') {
        // Query for rate sums by service line and month (not pre-averaged)
        const rateQuery = await db
          .select({
            month: rentRollData.uploadMonth,
            serviceLine: rentRollData.serviceLine,
            location: rentRollData.location,
            totalRate: sql<number>`SUM(
              CASE 
                WHEN ${rentRollData.serviceLine} IN ('HC', 'HC/MC', 'SMC') THEN
                  COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 30
                ELSE 
                  COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0)
              END
            )`,
            unitCount: sql<number>`COUNT(*)::int`,
          })
          .from(rentRollData)
          .where(and(
            eq(rentRollData.clientId, clientId),
            inArray(rentRollData.uploadMonth, months),
            tileType === 'current-revenue' ? eq(rentRollData.occupiedYN, true) : sql`TRUE`
          ))
          .groupBy(rentRollData.uploadMonth, rentRollData.serviceLine, rentRollData.location);
        
        // Process rate data - accumulate sum of rates and counts
        const rateByMonth: Record<string, { totalRate: number; count: number; byServiceLine: Record<string, { totalRate: number; count: number }> }> = {};
        const sameStoreRateByMonth: Record<string, { totalRate: number; count: number; byServiceLine: Record<string, { totalRate: number; count: number }> }> = {};
        
        for (const month of months) {
          rateByMonth[month] = { totalRate: 0, count: 0, byServiceLine: {} };
          sameStoreRateByMonth[month] = { totalRate: 0, count: 0, byServiceLine: {} };
        }
        
        for (const row of rateQuery) {
          const month = row.month;
          const sl = row.serviceLine;
          const totalRate = row.totalRate || 0;
          const count = row.unitCount || 0;
          
          if (!rateByMonth[month]) continue;
          
          // Accumulate sum of rates and count (not multiplying avgRate by count)
          rateByMonth[month].totalRate += totalRate;
          rateByMonth[month].count += count;
          
          if (!rateByMonth[month].byServiceLine[sl]) {
            rateByMonth[month].byServiceLine[sl] = { totalRate: 0, count: 0 };
          }
          rateByMonth[month].byServiceLine[sl].totalRate += totalRate;
          rateByMonth[month].byServiceLine[sl].count += count;
          
          if (sameStoreLocationNames.has(row.location)) {
            sameStoreRateByMonth[month].totalRate += totalRate;
            sameStoreRateByMonth[month].count += count;
            
            if (!sameStoreRateByMonth[month].byServiceLine[sl]) {
              sameStoreRateByMonth[month].byServiceLine[sl] = { totalRate: 0, count: 0 };
            }
            sameStoreRateByMonth[month].byServiceLine[sl].totalRate += totalRate;
            sameStoreRateByMonth[month].byServiceLine[sl].count += count;
          }
        }
        
        // Build rate trend (average = sum / count)
        const rateMonthlyTrend = months.map(month => {
          const data = rateByMonth[month];
          const avgRate = data.count > 0 ? Math.round(data.totalRate / data.count) : 0;
          const byServiceLine: Record<string, number> = {};
          
          for (const [sl, slData] of Object.entries(data.byServiceLine)) {
            byServiceLine[sl] = slData.count > 0 ? Math.round(slData.totalRate / slData.count) : 0;
          }
          
          return { month, value: avgRate, byServiceLine };
        });
        
        // Calculate rate growth stats
        const currentRate = rateMonthlyTrend[rateMonthlyTrend.length - 1]?.value || 0;
        const getRateAtIndex = (idx: number) => rateMonthlyTrend[idx]?.value || 0;
        
        const rateGrowthStats = {
          t1: monthCount >= 2 ? calculateGrowth(currentRate, getRateAtIndex(monthCount - 2)) : 0,
          t3: monthCount >= 4 ? calculateGrowth(currentRate, getRateAtIndex(monthCount - 4)) : 0,
          t6: monthCount >= 7 ? calculateGrowth(currentRate, getRateAtIndex(monthCount - 7)) : 0,
          t12: monthCount >= 12 ? calculateGrowth(currentRate, getRateAtIndex(0)) : 0,
          ytd: (() => {
            const ytdIndex = rateMonthlyTrend.findIndex(m => m.month >= ytdStartMonth);
            return ytdIndex >= 0 ? calculateGrowth(currentRate, getRateAtIndex(ytdIndex)) : 0;
          })()
        };
        
        // Same store rate stats
        const sameStoreRateValues = months.map(m => {
          const data = sameStoreRateByMonth[m];
          return data.count > 0 ? Math.round(data.totalRate / data.count) : 0;
        });
        const sameStoreCurrentRate = sameStoreRateValues[sameStoreRateValues.length - 1] || 0;
        const getSameStoreRateAtIndex = (idx: number) => sameStoreRateValues[idx] || 0;
        
        const sameStoreRateGrowthStats = {
          t1: monthCount >= 2 ? calculateGrowth(sameStoreCurrentRate, getSameStoreRateAtIndex(monthCount - 2)) : 0,
          t3: monthCount >= 4 ? calculateGrowth(sameStoreCurrentRate, getSameStoreRateAtIndex(monthCount - 4)) : 0,
          t6: monthCount >= 7 ? calculateGrowth(sameStoreCurrentRate, getSameStoreRateAtIndex(monthCount - 7)) : 0,
          t12: monthCount >= 12 ? calculateGrowth(sameStoreCurrentRate, getSameStoreRateAtIndex(0)) : 0,
          ytd: (() => {
            const ytdIndex = months.findIndex(m => m >= ytdStartMonth);
            return ytdIndex >= 0 ? calculateGrowth(sameStoreCurrentRate, getSameStoreRateAtIndex(ytdIndex)) : 0;
          })()
        };
        
        // Build service line rate breakdown with full ServiceLineData structure including trend
        const serviceLines = [...new Set(rateQuery.map(r => r.serviceLine))];
        const rateByServiceLine: Array<{ serviceLine: string; value: number; trend: number[]; growthStats: { t1: number; t3: number; t6: number; t12: number; ytd: number } }> = [];
        
        for (const sl of serviceLines) {
          const slRates = months.map(m => {
            const data = rateByMonth[m].byServiceLine[sl];
            return data && data.count > 0 ? Math.round(data.totalRate / data.count) : 0;
          });
          const slCurrentRate = slRates[slRates.length - 1] || 0;
          const getSlRateAtIndex = (idx: number) => slRates[idx] || 0;
          
          // Calculate YTD for this service line rate
          const slYtdIndex = months.findIndex(m => m >= ytdStartMonth);
          const slYtdRate = slYtdIndex >= 0 ? getSlRateAtIndex(slYtdIndex) : 0;
          
          rateByServiceLine.push({
            serviceLine: sl,
            value: slCurrentRate,
            trend: slRates,
            growthStats: {
              t1: slRates.length >= 2 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(slRates.length - 2)) : 0,
              t3: slRates.length >= 4 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(slRates.length - 4)) : 0,
              t6: slRates.length >= 7 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(slRates.length - 7)) : 0,
              t12: slRates.length >= 12 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(0)) : 0,
              ytd: slYtdIndex >= 0 ? calculateGrowth(slCurrentRate, slYtdRate) : 0
            }
          });
        }
        
        // Build Same Store service line rate breakdown
        const sameStoreRateByServiceLine: Array<{ serviceLine: string; value: number; trend: number[]; growthStats: { t1: number; t3: number; t6: number; t12: number; ytd: number } }> = [];
        
        for (const sl of serviceLines) {
          const slRates = months.map(m => {
            const data = sameStoreRateByMonth[m].byServiceLine[sl];
            return data && data.count > 0 ? Math.round(data.totalRate / data.count) : 0;
          });
          const slCurrentRate = slRates[slRates.length - 1] || 0;
          const getSlRateAtIndex = (idx: number) => slRates[idx] || 0;
          
          const slYtdIndex = months.findIndex(m => m >= ytdStartMonth);
          const slYtdRate = slYtdIndex >= 0 ? getSlRateAtIndex(slYtdIndex) : 0;
          
          sameStoreRateByServiceLine.push({
            serviceLine: sl,
            value: slCurrentRate,
            trend: slRates,
            growthStats: {
              t1: slRates.length >= 2 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(slRates.length - 2)) : 0,
              t3: slRates.length >= 4 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(slRates.length - 4)) : 0,
              t6: slRates.length >= 7 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(slRates.length - 7)) : 0,
              t12: slRates.length >= 12 ? calculateGrowth(slCurrentRate, getSlRateAtIndex(0)) : 0,
              ytd: slYtdIndex >= 0 ? calculateGrowth(slCurrentRate, slYtdRate) : 0
            }
          });
        }
        
        rateMetrics = {
          currentValue: currentRate,
          monthlyTrend: rateMonthlyTrend,
          growthStats: rateGrowthStats,
          byServiceLine: rateByServiceLine.sort((a, b) => b.value - a.value),
          sameStore: {
            currentValue: sameStoreCurrentRate,
            growthStats: sameStoreRateGrowthStats,
            byServiceLine: sameStoreRateByServiceLine.sort((a, b) => b.value - a.value)
          }
        };
      }
      
      // Build service line growth breakdown for portfolio and same store panels
      const serviceLineGrowthBreakdown = byServiceLine.map(sl => ({
        serviceLine: sl.serviceLine,
        value: sl.value,
        t1: sl.growthStats.t1,
        t12: sl.growthStats.t12
      }));
      
      res.json({
        tileType,
        currentValue,
        monthlyTrend,
        growthStats,
        byServiceLine,
        byLocation,
        byRoomType,
        sameStore: {
          currentValue: sameStoreCurrentValue,
          growthStats: sameStoreGrowthStats,
          byServiceLine: sameStoreByServiceLine
        },
        serviceLineGrowthBreakdown,
        rateMetrics
      });
      
    } catch (error) {
      console.error('Tile details error:', error);
      res.status(500).json({ error: 'Failed to fetch tile details' });
    }
  });

  /**
   * GET /api/tile-details/:tileType/drill-down
   * 
   * Provides hierarchical drill-down data for growth percentages.
   * Returns Region → Division → Campus breakdown for the selected period.
   * 
   * @param tileType - One of: 'units', 'occupancy', 'current-revenue', 'potential-revenue'
   * @query period - One of: 't1', 't3', 't6', 't12', 'ytd'
   * @query serviceLine - Optional service line filter
   * @query sameStore - Optional 'true' to filter same-store only
   */
  app.get("/api/tile-details/:tileType/drill-down", async (req, res) => {
    try {
      const { tileType } = req.params;
      const { period = 't12', serviceLine, sameStore } = req.query;
      const clientId = req.clientId || 'demo';
      const validTileTypes = ['units', 'occupancy', 'current-revenue', 'potential-revenue'];
      const validPeriods = ['t1', 't3', 't6', 't12', 'ytd'];
      
      if (!validTileTypes.includes(tileType)) {
        return res.status(400).json({ error: `Invalid tile type. Must be one of: ${validTileTypes.join(', ')}` });
      }
      if (!validPeriods.includes(period as string)) {
        return res.status(400).json({ error: `Invalid period. Must be one of: ${validPeriods.join(', ')}` });
      }
      
      const isSameStoreOnly = sameStore === 'true';
      
      // Get available months for this client
      const availableMonths = await db
        .select({ month: sql<string>`DISTINCT ${rentRollData.uploadMonth}` })
        .from(rentRollData)
        .where(eq(rentRollData.clientId, clientId))
        .orderBy(sql`${rentRollData.uploadMonth} DESC`)
        .limit(13);
      
      const months = availableMonths.map(m => m.month).sort();
      const mostRecentMonth = months[months.length - 1] || '';
      const currentYear = mostRecentMonth ? mostRecentMonth.substring(0, 4) : new Date().getFullYear().toString();
      const ytdStartMonth = `${currentYear}-01`;
      
      // Determine comparison month based on period
      let comparisonMonthIndex: number;
      const monthCount = months.length;
      switch (period) {
        case 't1': comparisonMonthIndex = monthCount - 2; break;
        case 't3': comparisonMonthIndex = monthCount - 4; break;
        case 't6': comparisonMonthIndex = monthCount - 7; break;
        case 't12': comparisonMonthIndex = 0; break;
        case 'ytd':
          comparisonMonthIndex = months.findIndex(m => m >= ytdStartMonth);
          if (comparisonMonthIndex < 0) comparisonMonthIndex = 0;
          break;
        default: comparisonMonthIndex = 0;
      }
      
      const comparisonMonth = months[comparisonMonthIndex] || months[0] || mostRecentMonth;
      
      // Get location data with region/division; also build same-store set from locations table
      const locationsMap = new Map<string, { region: string; division: string }>();
      const drillDownSameStoreNames = new Set<string>();
      const locationsList = await db.select().from(locations).where(eq(locations.clientId, clientId));
      for (const loc of locationsList) {
        locationsMap.set(loc.name, { 
          region: loc.region || 'Unknown Region', 
          division: loc.division || 'Unknown Division' 
        });
        if (loc.sameStore) drillDownSameStoreNames.add(loc.name);
      }
      
      // B-bed exclusion for non-revenue tile types
      const excludeBBeds = sql`NOT (${rentRollData.serviceLine} IN ('AL', 'SL', 'VIL', 'IL', 'AL/MC') 
                       AND ${rentRollData.roomNumber} LIKE '%/B')`;
      
      // Build conditions
      const conditions = [
        eq(rentRollData.clientId, clientId),
        inArray(rentRollData.uploadMonth, [mostRecentMonth, comparisonMonth])
      ];
      
      if (tileType === 'units' || tileType === 'occupancy') {
        conditions.push(excludeBBeds);
      }
      if (serviceLine && serviceLine !== 'all') {
        conditions.push(eq(rentRollData.serviceLine, serviceLine as string));
      }
      if (isSameStoreOnly && drillDownSameStoreNames.size > 0) {
        conditions.push(inArray(rentRollData.location, [...drillDownSameStoreNames]));
      }
      
      // Build the query based on tile type
      let query;
      if (tileType === 'occupancy') {
        query = db
          .select({
            month: rentRollData.uploadMonth,
            location: rentRollData.location,
            occupied: sql<number>`SUM(CASE WHEN ${rentRollData.occupiedYN} THEN 1 ELSE 0 END)::int`,
            total: sql<number>`COUNT(*)::int`,
          })
          .from(rentRollData)
          .where(and(...conditions))
          .groupBy(rentRollData.uploadMonth, rentRollData.location);
      } else if (tileType === 'current-revenue') {
        query = db
          .select({
            month: rentRollData.uploadMonth,
            location: rentRollData.location,
            value: sql<number>`SUM(
              CASE WHEN ${rentRollData.occupiedYN} 
                AND (
                  ${rentRollData.payorType} IS NULL 
                  OR ${rentRollData.payorType} = ''
                  OR UPPER(${rentRollData.payorType}) LIKE '%PRIVATE%'
                  OR UPPER(${rentRollData.payorType}) LIKE '%PVT%'
                  OR UPPER(${rentRollData.payorType}) LIKE '%BEDHOLD%'
                )
              THEN
                CASE 
                  WHEN ${rentRollData.serviceLine} IN ('HC', 'HC/MC', 'SMC') THEN
                    COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 365
                  ELSE 
                    COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 12
                END
              ELSE 0 END
            )`,
          })
          .from(rentRollData)
          .where(and(...conditions))
          .groupBy(rentRollData.uploadMonth, rentRollData.location);
      } else if (tileType === 'potential-revenue') {
        query = db
          .select({
            month: rentRollData.uploadMonth,
            location: rentRollData.location,
            value: sql<number>`SUM(
              CASE 
                WHEN ${rentRollData.occupiedYN} AND (
                  ${rentRollData.payorType} IS NULL 
                  OR ${rentRollData.payorType} = ''
                  OR UPPER(${rentRollData.payorType}) LIKE '%PRIVATE%'
                  OR UPPER(${rentRollData.payorType}) LIKE '%PVT%'
                  OR UPPER(${rentRollData.payorType}) LIKE '%BEDHOLD%'
                ) THEN
                  CASE 
                    WHEN ${rentRollData.serviceLine} IN ('HC', 'HC/MC', 'SMC') THEN
                      COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 365
                    ELSE 
                      COALESCE(NULLIF(${rentRollData.inHouseRate}, 0), ${rentRollData.streetRate}, 0) * 12
                  END
                WHEN NOT ${rentRollData.occupiedYN} THEN
                  CASE 
                    WHEN ${rentRollData.serviceLine} IN ('HC', 'HC/MC', 'SMC') THEN
                      COALESCE(${rentRollData.streetRate}, 0) * 365 * 0.65
                    ELSE 
                      COALESCE(${rentRollData.streetRate}, 0) * 12
                  END
                ELSE 0
              END
            )`,
          })
          .from(rentRollData)
          .where(and(...conditions))
          .groupBy(rentRollData.uploadMonth, rentRollData.location);
      } else {
        // units
        query = db
          .select({
            month: rentRollData.uploadMonth,
            location: rentRollData.location,
            value: sql<number>`COUNT(*)::int`,
          })
          .from(rentRollData)
          .where(and(...conditions))
          .groupBy(rentRollData.uploadMonth, rentRollData.location);
      }
      
      const rawData = await query;
      
      // Calculate growth helper
      const calculateGrowth = (current: number, previous: number): number => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100 * 10) / 10;
      };
      
      // Process data by location, then aggregate to division and region
      const locationData = new Map<string, { current: number; previous: number; currentOccupied?: number; currentTotal?: number; previousOccupied?: number; previousTotal?: number }>();
      
      for (const row of rawData) {
        if (!locationData.has(row.location)) {
          locationData.set(row.location, { 
            current: 0, previous: 0,
            currentOccupied: 0, currentTotal: 0,
            previousOccupied: 0, previousTotal: 0
          });
        }
        const data = locationData.get(row.location)!;
        
        if (tileType === 'occupancy') {
          const occupied = (row as any).occupied || 0;
          const total = (row as any).total || 0;
          if (row.month === mostRecentMonth) {
            data.currentOccupied = (data.currentOccupied || 0) + occupied;
            data.currentTotal = (data.currentTotal || 0) + total;
          } else {
            data.previousOccupied = (data.previousOccupied || 0) + occupied;
            data.previousTotal = (data.previousTotal || 0) + total;
          }
        } else {
          const value = (row as any).value || 0;
          if (row.month === mostRecentMonth) {
            data.current += value;
          } else {
            data.previous += value;
          }
        }
      }
      
      // Build campus-level results
      const campuses: Array<{ 
        name: string; 
        region: string; 
        division: string; 
        current: number; 
        previous: number; 
        growth: number 
      }> = [];
      
      for (const [loc, data] of locationData) {
        const locInfo = locationsMap.get(loc) || { region: 'Unknown Region', division: 'Unknown Division' };
        let current: number, previous: number;
        
        if (tileType === 'occupancy') {
          current = (data.currentTotal || 0) > 0 ? ((data.currentOccupied || 0) / (data.currentTotal || 1)) * 100 : 0;
          previous = (data.previousTotal || 0) > 0 ? ((data.previousOccupied || 0) / (data.previousTotal || 1)) * 100 : 0;
        } else {
          current = data.current;
          previous = data.previous;
        }
        
        campuses.push({
          name: loc,
          region: locInfo.region,
          division: locInfo.division,
          current,
          previous,
          growth: calculateGrowth(current, previous)
        });
      }
      
      // Aggregate to divisions
      const divisionAgg = new Map<string, { 
        region: string; 
        current: number; 
        previous: number; 
        currentOccupied?: number; 
        currentTotal?: number; 
        previousOccupied?: number; 
        previousTotal?: number; 
        campusCount: number 
      }>();
      
      for (const [loc, data] of locationData) {
        const locInfo = locationsMap.get(loc) || { region: 'Unknown Region', division: 'Unknown Division' };
        const divKey = locInfo.division;
        
        if (!divisionAgg.has(divKey)) {
          divisionAgg.set(divKey, { 
            region: locInfo.region, 
            current: 0, 
            previous: 0,
            currentOccupied: 0,
            currentTotal: 0,
            previousOccupied: 0,
            previousTotal: 0,
            campusCount: 0 
          });
        }
        const div = divisionAgg.get(divKey)!;
        div.campusCount++;
        
        if (tileType === 'occupancy') {
          div.currentOccupied = (div.currentOccupied || 0) + (data.currentOccupied || 0);
          div.currentTotal = (div.currentTotal || 0) + (data.currentTotal || 0);
          div.previousOccupied = (div.previousOccupied || 0) + (data.previousOccupied || 0);
          div.previousTotal = (div.previousTotal || 0) + (data.previousTotal || 0);
        } else {
          div.current += data.current;
          div.previous += data.previous;
        }
      }
      
      const divisions: Array<{ 
        name: string; 
        region: string; 
        current: number; 
        previous: number; 
        growth: number; 
        campusCount: number 
      }> = [];
      
      for (const [name, data] of divisionAgg) {
        let current: number, previous: number;
        if (tileType === 'occupancy') {
          current = (data.currentTotal || 0) > 0 ? ((data.currentOccupied || 0) / (data.currentTotal || 1)) * 100 : 0;
          previous = (data.previousTotal || 0) > 0 ? ((data.previousOccupied || 0) / (data.previousTotal || 1)) * 100 : 0;
        } else {
          current = data.current;
          previous = data.previous;
        }
        divisions.push({
          name,
          region: data.region,
          current,
          previous,
          growth: calculateGrowth(current, previous),
          campusCount: data.campusCount
        });
      }
      
      // Aggregate to regions
      const regionAgg = new Map<string, { 
        current: number; 
        previous: number; 
        currentOccupied?: number; 
        currentTotal?: number; 
        previousOccupied?: number; 
        previousTotal?: number;
        divisionCount: number; 
        campusCount: number 
      }>();
      
      for (const div of divisions) {
        if (!regionAgg.has(div.region)) {
          regionAgg.set(div.region, { 
            current: 0, 
            previous: 0, 
            currentOccupied: 0,
            currentTotal: 0,
            previousOccupied: 0,
            previousTotal: 0,
            divisionCount: 0, 
            campusCount: 0 
          });
        }
        const reg = regionAgg.get(div.region)!;
        reg.divisionCount++;
        reg.campusCount += div.campusCount;
        
        if (tileType === 'occupancy') {
          const divData = divisionAgg.get(div.name)!;
          reg.currentOccupied = (reg.currentOccupied || 0) + (divData.currentOccupied || 0);
          reg.currentTotal = (reg.currentTotal || 0) + (divData.currentTotal || 0);
          reg.previousOccupied = (reg.previousOccupied || 0) + (divData.previousOccupied || 0);
          reg.previousTotal = (reg.previousTotal || 0) + (divData.previousTotal || 0);
        } else {
          reg.current += div.current;
          reg.previous += div.previous;
        }
      }
      
      const regions: Array<{ 
        name: string; 
        current: number; 
        previous: number; 
        growth: number; 
        divisionCount: number; 
        campusCount: number 
      }> = [];
      
      for (const [name, data] of regionAgg) {
        let current: number, previous: number;
        if (tileType === 'occupancy') {
          current = (data.currentTotal || 0) > 0 ? ((data.currentOccupied || 0) / (data.currentTotal || 1)) * 100 : 0;
          previous = (data.previousTotal || 0) > 0 ? ((data.previousOccupied || 0) / (data.previousTotal || 1)) * 100 : 0;
        } else {
          current = data.current;
          previous = data.previous;
        }
        regions.push({
          name,
          current,
          previous,
          growth: calculateGrowth(current, previous),
          divisionCount: data.divisionCount,
          campusCount: data.campusCount
        });
      }
      
      // Sort by growth descending
      regions.sort((a, b) => b.growth - a.growth);
      divisions.sort((a, b) => b.growth - a.growth);
      campuses.sort((a, b) => b.growth - a.growth);
      
      res.json({
        tileType,
        period,
        serviceLine: serviceLine || 'all',
        sameStore: isSameStoreOnly,
        currentMonth: mostRecentMonth,
        comparisonMonth,
        regions,
        divisions,
        campuses
      });
      
    } catch (error) {
      console.error('Tile drill-down error:', error);
      res.status(500).json({ error: 'Failed to fetch drill-down data' });
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
  app.get("/api/rate-card", async (req: any, res) => {
    try {
      const { month, regions, divisions, locations, location, page = '1', limit = '1000' } = req.query;
      const clientId = req.clientId || 'demo';
      let targetMonth = month as string || new Date().toISOString().substring(0, 7);
      const pageNum = parseInt(page as string, 10);
      const pageLimit = Math.min(parseInt(limit as string, 10), 5000); // Max 5000 items per page
      
      // Support both 'location' (singular) and 'locations' (plural) for backwards compatibility
      const locationParam = locations || location;
      
      // Get latest month with data if not specified
      if (!month) {
        // Efficient query to get the latest month for this client
        const latestMonthData = await db.select({ uploadMonth: rentRollData.uploadMonth })
          .from(rentRollData)
          .where(eq(rentRollData.clientId, clientId))
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
      // Initialize all 6 service lines to ensure they all appear in the summary
      const ALL_SERVICE_LINES = ['HC', 'HC/MC', 'AL', 'AL/MC', 'SL', 'VIL'];
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
      
      // Initialize all service lines with zeros
      for (const sl of ALL_SERVICE_LINES) {
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
      
      // Sort by the defined service line order
      const rateCardSummary = ALL_SERVICE_LINES.map(sl => {
        const summary = summaryByServiceLine[sl];
        return {
          serviceLine: summary.serviceLine,
          totalUnits: summary.totalUnits,
          occupancyCount: summary.occupancyCount,
          averageStreetRate: summary.totalUnits > 0 ? summary.totalStreetRate / summary.totalUnits : 0,
          averageModuloRate: summary.moduloCount > 0 ? summary.totalModuloRate / summary.moduloCount : null,
          averageAiRate: summary.aiCount > 0 ? summary.totalAiRate / summary.aiCount : null
        };
      });

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
          
          // Fetch real inquiry data for demand signals
          const demandData = await storage.getDemandDataByLocationServiceLine(
            unit.location,
            unit.serviceLine || '',
            month
          );
          
          // Use actual data if available, otherwise fall back to neutral defaults
          const demandHistory = demandData.demandHistory.length > 0 ? demandData.demandHistory : [10, 12, 15, 13, 14, 11];
          const demandCurrent = demandData.currentDemand > 0 ? demandData.currentDemand : 12;
          
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

  // Generate AI pricing suggestions using OpenAI GPT-5 (OPTIMIZED)
  // Optimizations: Single data load, parallel batch processing, pre-cached revenue data
  app.post("/api/pricing/generate-ai", async (req, res) => {
    try {
      const startTime = Date.now();
      const { month, serviceLine, regions, divisions, locations } = req.body;
      const targetMonth = month || new Date().toISOString().substring(0, 7);
      
      console.log('=== Starting OPTIMIZED AI Generation ===');
      console.log('Target month:', targetMonth);
      console.log('Filters:', { serviceLine, regions, divisions, locations });
      
      await ensureCacheInitialized(targetMonth);
      
      // OPTIMIZATION 1: Load ALL rent roll data ONCE at the start
      // This eliminates the duplicate call that was loading 391K+ units twice
      console.log('[AI Pricing] Loading rent roll data (single load)...');
      const allUnits = await storage.getRentRollData();
      console.log(`[AI Pricing] Loaded ${allUnits.length} total units`);
      
      // Get units for target month from the already-loaded data
      let units = allUnits.filter(u => u.uploadMonth === targetMonth);
      
      // Apply filters to units
      if (serviceLine) {
        units = units.filter(unit => unit.serviceLine === serviceLine);
      }
      if (locations && locations.length > 0) {
        const locationSet = new Set(locations);
        units = units.filter(unit => unit.location && locationSet.has(unit.location));
      }
      
      if (units.length === 0) {
        console.log('[AI Pricing] No units to process after filtering');
        return res.json({ success: true, unitsProcessed: 0 });
      }
      
      // Filter out B beds for senior housing service lines when calculating occupancy
      const seniorHousingServiceLines = new Set(['AL', 'AL/MC', 'SL', 'VIL', 'IL']);
      const allUnitsForOccupancy = units.filter(unit => {
        if (seniorHousingServiceLines.has(unit.serviceLine || '')) {
          const roomNumber = unit.roomNumber || '';
          if (roomNumber.endsWith('/B') || roomNumber.endsWith('B')) {
            return false;
          }
        }
        return true;
      });
      
      console.log(`[AI Pricing] Processing ${units.length} units (${allUnitsForOccupancy.length} for occupancy calc)`);
      
      // Calculate service-line-specific occupancy using already-loaded data (no second query!)
      const serviceLineOccupancy = new Map<string, number>();
      const serviceLineStats = new Map<string, { occupied: number; total: number }>();
      
      for (const unit of allUnits) {
        const sl = unit.serviceLine || 'Unknown';
        if (!serviceLineStats.has(sl)) {
          serviceLineStats.set(sl, { occupied: 0, total: 0 });
        }
        const stats = serviceLineStats.get(sl)!;
        stats.total++;
        if (unit.occupiedYN) {
          stats.occupied++;
        }
      }
      
      for (const [sl, stats] of serviceLineStats) {
        serviceLineOccupancy.set(sl, stats.total > 0 ? stats.occupied / stats.total : 0.87);
      }
      
      // Load all supporting data in parallel
      const [currentWeights, guardrailsData, revenueGrowthTargets, competitors] = await Promise.all([
        storage.getAiPricingWeights().then(w => w || {
          occupancyPressure: 30,
          daysVacantDecay: 25,
          competitorRates: 10,
          seasonality: 5,
          stockMarket: 5,
          inquiryTourVolume: 10
        }),
        storage.getCurrentGuardrails(),
        storage.getRevenueGrowthTargets(),
        storage.getCompetitors()
      ]);
      
      // Build market context for OpenAI
      const totalUnits = units.length;
      const vacantUnits = units.filter(u => !u.occupiedYN).length;
      const avgStreetRate = units.reduce((sum, u) => sum + (u.streetRate || 0), 0) / Math.max(totalUnits, 1);
      const avgDaysVacant = units.filter(u => !u.occupiedYN).reduce((sum, u) => sum + (u.daysVacant || 0), 0) / Math.max(vacantUnits, 1);
      const unitsOver30DaysVacant = units.filter(u => !u.occupiedYN && (u.daysVacant || 0) > 30).length;
      
      const avgCompetitorRate = competitors.length > 0 
        ? competitors.reduce((sum, c) => sum + (c.baseRate || 0), 0) / competitors.length 
        : avgStreetRate;
      
      // Build service line breakdown
      const serviceLineBreakdown: Record<string, { total: number; vacant: number; avgRate: number }> = {};
      units.forEach(u => {
        const sl = u.serviceLine || 'Unknown';
        if (!serviceLineBreakdown[sl]) {
          serviceLineBreakdown[sl] = { total: 0, vacant: 0, avgRate: 0 };
        }
        serviceLineBreakdown[sl].total++;
        if (!u.occupiedYN) serviceLineBreakdown[sl].vacant++;
        serviceLineBreakdown[sl].avgRate += u.streetRate || 0;
      });
      Object.keys(serviceLineBreakdown).forEach(sl => {
        serviceLineBreakdown[sl].avgRate = serviceLineBreakdown[sl].avgRate / serviceLineBreakdown[sl].total;
      });
      
      const slBreakdownStr = Object.entries(serviceLineBreakdown)
        .map(([sl, data]) => `${sl}: ${data.total} units, ${data.vacant} vacant (${Math.round((1 - data.vacant/data.total) * 100)}% occ), avg $${Math.round(data.avgRate)}`)
        .join('\n');
      
      // Call OpenAI GPT-5 for weight suggestions
      console.log('[AI Pricing] Calling OpenAI GPT-5 for weight suggestions...');
      
      const weightPrompt = `You are an expert senior living revenue management AI. Analyze the following market data and suggest optimal pricing factor weights for maximizing revenue while maintaining competitive occupancy.

CURRENT MARKET DATA:
- Total Units: ${totalUnits}
- Vacant Units: ${vacantUnits} (${Math.round((1 - vacantUnits/totalUnits) * 100)}% occupancy)
- Average Street Rate: $${Math.round(avgStreetRate)}
- Average Days Vacant: ${Math.round(avgDaysVacant)} days
- Units Vacant 30+ Days: ${unitsOver30DaysVacant}
- Average Competitor Rate: $${Math.round(avgCompetitorRate)}
- Market Month: ${targetMonth}

SERVICE LINE BREAKDOWN:
${slBreakdownStr}

CURRENT WEIGHTS (must sum to 100):
- Occupancy Pressure: ${currentWeights.occupancyPressure}% (higher = more aggressive pricing when occupancy is low)
- Days Vacant Decay: ${currentWeights.daysVacantDecay}% (higher = faster price reduction for long-vacant units)
- Competitor Rates: ${currentWeights.competitorRates}% (higher = more sensitivity to competitor pricing)
- Seasonality: ${currentWeights.seasonality}% (higher = more seasonal adjustments)
- Stock Market: ${currentWeights.stockMarket}% (higher = more macro-economic sensitivity)
- Inquiry/Tour Volume: ${currentWeights.inquiryTourVolume}% (higher = more demand-responsive)

Based on this data, provide optimized weights that will maximize revenue. Consider:
1. If occupancy is low, increase occupancy pressure and days vacant weights
2. If we're priced above competitors, increase competitor weight
3. If many units are vacant 30+ days, increase days vacant decay
4. Seasonal patterns for senior living (typically higher demand in spring/fall)

Respond with ONLY a JSON object in this exact format:
{
  "occupancyPressure": <number>,
  "daysVacantDecay": <number>,
  "competitorRates": <number>,
  "seasonality": <number>,
  "stockMarket": <number>,
  "inquiryTourVolume": <number>,
  "reasoning": "<brief explanation of your weight choices>"
}

Ensure all weights are positive integers and sum to exactly 100.`;

      let aiSuggestedWeights = currentWeights;
      let aiReasoning = '';
      
      try {
        const rawText = await callClaudeThenGPT(
          'You are an expert senior living revenue management AI.',
          weightPrompt,
          'Based on the analysis, produce ONLY a JSON object with fields: occupancyPressure, daysVacantDecay, competitorRates, seasonality, stockMarket, inquiryTourVolume (positive integers summing to exactly 100), and reasoning (brief string). No other text.',
          { label: 'pricing-weights', claudeMaxTokens: 512, gptMaxTokens: 500 }
        );
        const parsed = JSON.parse(rawText);
        aiSuggestedWeights = {
          occupancyPressure: parsed.occupancyPressure || currentWeights.occupancyPressure,
          daysVacantDecay: parsed.daysVacantDecay || currentWeights.daysVacantDecay,
          competitorRates: parsed.competitorRates || currentWeights.competitorRates,
          seasonality: parsed.seasonality || currentWeights.seasonality,
          stockMarket: parsed.stockMarket || currentWeights.stockMarket,
          inquiryTourVolume: parsed.inquiryTourVolume || currentWeights.inquiryTourVolume
        };
        aiReasoning = parsed.reasoning || '';
        console.log('[AI Pricing] Suggested weights:', aiSuggestedWeights);
        console.log('[AI Pricing] Reasoning:', aiReasoning);
      } catch (parseError) {
        console.warn('[AI Pricing] Failed to parse AI response, using current weights:', parseError);
      }
      
      // OPTIMIZATION 2: Pre-compute ALL revenue performance data in a Map for O(1) lookup
      console.log('[AI Pricing] Pre-computing revenue performance cache...');
      const revenuePerformanceCache = new Map<string, { yoyGrowth: number }>();
      
      // Build location name -> locationId map from locations table (not from rent_roll_data)
      // This ensures we always have the correct locationId even if some units have null locationId
      const allLocations = await storage.getLocations();
      const locationIdMap = new Map<string, string | undefined>();
      for (const loc of allLocations) {
        locationIdMap.set(loc.name, loc.id);
      }
      console.log(`[AI Pricing] Built locationIdMap from ${allLocations.length} locations`);
      
      // Build unique location/serviceLine combinations
      const uniqueCombinations = new Set<string>();
      for (const unit of units) {
        const key = `${unit.location || ''}|${unit.serviceLine || ''}`;
        uniqueCombinations.add(key);
      }
      
      // Pre-compute revenue performance for all unique combinations
      for (const combo of uniqueCombinations) {
        const [locationName, sl] = combo.split('|');
        const result = getRevenuePerformanceForScope(allUnits, locationName, sl, targetMonth);
        revenuePerformanceCache.set(combo, { yoyGrowth: result.performance.yoyGrowth });
      }
      console.log(`[AI Pricing] Pre-computed revenue performance for ${revenuePerformanceCache.size} location/serviceLine combinations`);
      
      // Helper function for O(1) revenue gap lookup - returns full revenue target info for calculation display
      const getRevenueGap = (locationName: string, sl: string): { 
        gap: number | undefined; 
        target: number | undefined;
        actualYOY: number | undefined;
        adjustmentApplied: number | undefined;
      } => {
        const cacheKey = `${locationName}|${sl}`;
        const performance = revenuePerformanceCache.get(cacheKey);
        
        if (!performance) {
          return { gap: undefined, target: undefined, actualYOY: undefined, adjustmentApplied: undefined };
        }
        
        const locationId = locationIdMap.get(locationName);
        const target = revenueGrowthTargets.find(
          t => t.locationId === locationId && t.serviceLine === sl
        );
        
        if (!target) {
          // Debug: Log why target was not found
          console.log(`[AI Pricing] No revenue target found for location='${locationName}' (id=${locationId}) sl='${sl}'`);
          return { gap: undefined, target: undefined, actualYOY: performance.yoyGrowth, adjustmentApplied: undefined };
        }
        
        const gap = performance.yoyGrowth - target.targetGrowthPercent;
        
        // Calculate the adjustment that will be applied (matches signalRevenueGrowthTarget logic)
        let adjustmentApplied = 0;
        if (gap >= 0) {
          // Ahead of target - slight positive signal (max 0.2)
          const signal = Math.min(0.2, gap / 10);
          adjustmentApplied = signal * 0.05; // cfg.revenueGrowthSpan = 0.05 (5%)
        } else {
          // Behind target - upward pricing pressure
          const signal = Math.min(1.0, Math.abs(gap) / 10);
          adjustmentApplied = signal * 0.05;
        }
        
        return { 
          gap, 
          target: target.targetGrowthPercent, 
          actualYOY: performance.yoyGrowth,
          adjustmentApplied 
        };
      };
      
      console.log(`[AI Pricing] Loaded ${revenueGrowthTargets.length} revenue growth targets`);
      
      // OPTIMIZATION 3: Pre-cache competitor data like the Modulo endpoint
      const competitorCache = new Map<string, { competitor: any; trilogyCareLevel2Rate: number | null }>();
      const uniqueCampusServiceLines = new Set<string>();
      
      for (const unit of units) {
        if (unit.campus && unit.serviceLine) {
          uniqueCampusServiceLines.add(`${unit.campus}|${unit.serviceLine}`);
        }
      }
      
      // Fetch all competitor data in parallel
      const competitorPromises = Array.from(uniqueCampusServiceLines).map(async (key) => {
        const [campus, sl] = key.split('|');
        try {
          const [topCompetitor, trilogyCareLevel2Rate] = await Promise.all([
            storage.getTopCompetitorByWeight(campus, sl),
            storage.getTrilogyCareLevel2Rate(campus, sl)
          ]);
          competitorCache.set(key, { competitor: topCompetitor, trilogyCareLevel2Rate });
        } catch {
          competitorCache.set(key, { competitor: undefined, trilogyCareLevel2Rate: null });
        }
      });
      
      await Promise.all(competitorPromises);
      console.log(`[AI Pricing] Pre-cached competitor data for ${competitorCache.size} campus/serviceLine combinations`);
      
      // OPTIMIZATION 4: Process units in parallel batches (like the Modulo endpoint)
      const BATCH_SIZE = 500;
      const MAX_CONCURRENT_BATCHES = 8;
      const monthIndex = new Date().getMonth() + 1;
      
      console.log(`[AI Pricing] Processing ${units.length} units in batches of ${BATCH_SIZE}...`);
      
      // Helper function to process a single unit
      const processUnit = async (unit: any): Promise<{ id: string; aiSuggestedRate: number; aiCalculationDetails: string }> => {
        const serviceLineOcc = serviceLineOccupancy.get(unit.serviceLine) || 0.87;
        const revenueGapData = getRevenueGap(unit.location || '', unit.serviceLine || '');
        
        // Get competitor prices from cache or fallback
        let competitorPrices: number[];
        const competitorKey = `${unit.campus}|${unit.serviceLine}`;
        const cachedCompetitor = competitorCache.get(competitorKey);
        
        if (cachedCompetitor?.competitor?.streetRate) {
          const adjustmentResult = calculateAdjustedCompetitorRate({
            competitorBaseRate: cachedCompetitor.competitor.streetRate,
            competitorCareLevel2Rate: cachedCompetitor.competitor.careLevel2Rate || 0,
            competitorMedicationManagementFee: cachedCompetitor.competitor.medicationManagementFee || 0,
            trilogyCareLevel2Rate: cachedCompetitor.trilogyCareLevel2Rate || 0
          });
          competitorPrices = [adjustmentResult.adjustedRate];
        } else if (unit.competitorRate && unit.competitorRate > 0) {
          competitorPrices = [unit.competitorRate];
        } else {
          competitorPrices = [unit.streetRate * 0.95, unit.streetRate * 1.05];
        }
        
        const pricingInputs: PricingInputs = {
          occupancy: serviceLineOcc,
          daysVacant: unit.daysVacant || 0,
          monthIndex,
          competitorPrices,
          marketReturn: 0.03,
          demandCurrent: 32,
          demandHistory: [15, 20, 30, 18, 35, 22, 28, 16],
          serviceLine: unit.serviceLine,
          revenueGrowthGap: revenueGapData.gap,
          targetRevenueGrowth: revenueGapData.target
        };
        
        const pricingWeights = {
          ...aiSuggestedWeights,
          id: 0,
          locationId: unit.locationId,
          serviceLine: unit.serviceLine
        };
        
        const orchestratorResult = await calculateAttributedPrice(unit, pricingWeights, pricingInputs, guardrailsData || undefined);
        
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
          weights: aiSuggestedWeights,
          aiReasoning: aiReasoning,
          totalAdjustment: orchestratorResult.moduloDetails.totalAdjustment,
          finalRate: orchestratorResult.finalPrice,
          moduloRate: orchestratorResult.moduloRate,
          signals: orchestratorResult.moduloDetails.signals,
          blendedSignal: orchestratorResult.moduloDetails.blendedSignal,
          explanation: generateOverallExplanation(orchestratorResult.moduloDetails, pricingInputs),
          guardrailsApplied: orchestratorResult.guardrailsApplied,
          poweredByGPT5: true,
          // Revenue Target Strategy - shows how targets influence pricing
          revenueTarget: {
            targetGrowthPercent: revenueGapData.target,
            actualYOYGrowth: revenueGapData.actualYOY,
            gap: revenueGapData.gap,
            adjustmentApplied: revenueGapData.adjustmentApplied,
            status: revenueGapData.gap !== undefined 
              ? (revenueGapData.gap >= 0 ? 'exceeding' : (revenueGapData.gap >= -2 ? 'on_target' : (revenueGapData.gap >= -5 ? 'slightly_behind' : 'significantly_behind')))
              : 'no_target'
          }
        };
        
        return {
          id: unit.id,
          aiSuggestedRate: Math.round(orchestratorResult.finalPrice),
          aiCalculationDetails: JSON.stringify(aiCalculationDetails)
        };
      };
      
      // Process in parallel batches
      const allUpdates: Array<{ id: string; aiSuggestedRate: number; aiCalculationDetails: string }> = [];
      
      for (let i = 0; i < units.length; i += BATCH_SIZE * MAX_CONCURRENT_BATCHES) {
        const batchPromises = [];
        
        for (let j = 0; j < MAX_CONCURRENT_BATCHES && (i + j * BATCH_SIZE) < units.length; j++) {
          const start = i + j * BATCH_SIZE;
          const end = Math.min(start + BATCH_SIZE, units.length);
          const batch = units.slice(start, end);
          
          if (batch.length > 0) {
            const batchPromise = Promise.allSettled(batch.map(processUnit));
            batchPromises.push(batchPromise);
          }
        }
        
        const batchResults = await Promise.all(batchPromises);
        
        for (const results of batchResults) {
          for (const result of results) {
            if (result.status === 'fulfilled') {
              allUpdates.push(result.value);
            }
          }
        }
        
        const progress = Math.min(i + BATCH_SIZE * MAX_CONCURRENT_BATCHES, units.length);
        console.log(`[AI Pricing] Progress: ${progress}/${units.length} units (${Math.round((progress / units.length) * 100)}%)`);
      }
      
      console.log(`[AI Pricing] Calculated ${allUpdates.length} AI suggestions, starting bulk update...`);
      
      // Perform bulk update
      await storage.bulkUpdateAIRates(allUpdates);
      
      console.log(`[AI Pricing] Bulk update complete, regenerating rate card...`);
      
      // Regenerate rate card with AI suggestions
      await storage.generateRateCard(targetMonth);
      
      const elapsed = Date.now() - startTime;
      console.log(`[AI Pricing] Generation complete for ${allUpdates.length} units in ${elapsed}ms`);
      
      res.json({ 
        success: true, 
        unitsProcessed: allUpdates.length,
        aiWeights: aiSuggestedWeights,
        aiReasoning: aiReasoning,
        processingTimeMs: elapsed
      });
    } catch (error) {
      console.error('AI generation error:', error);
      res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
  });

  // Helper function to analyze a single scope (location + service line) with GPT
  async function analyzeIndividualScope(
    scopeUnits: any[],
    allUnitsForPrevMonth: any[],
    scopeLabel: string,
    locationId: number | undefined,
    locationName: string,
    serviceLine: string,
    targets: Record<string, number>,
    currentMonth: string,
    previousMonth: string | null,
    currentWeights: any,
    currentGuardrails: any,
    currentAdjustmentRanges: any,
    competitors: any[],
    allUnits: any[],
    savedRevenueTargets: any[]
  ): Promise<any> {
    // Calculate revenue performance for this scope
    const { performance: revenuePerformance, hasHistoricalData } = getRevenuePerformanceForScope(
      allUnits,
      locationName,
      serviceLine,
      currentMonth
    );
    
    // Get saved revenue growth target for this location/service line
    const savedTarget = savedRevenueTargets.find(
      t => t.locationId === locationId && t.serviceLine === serviceLine
    );
    const targetGrowthPercent = savedTarget?.targetGrowthPercent || targets[serviceLine] || targets['All'] || 5;
    
    // Calculate gap analysis
    const gapAnalysis = calculateGapAnalysis(targetGrowthPercent, revenuePerformance.yoyGrowth);
    
    console.log(`[Revenue Performance] ${scopeLabel}: Current=$${revenuePerformance.currentMonthRevenue.toFixed(0)}, ` +
      `MOM=${revenuePerformance.momGrowth.toFixed(1)}%, YOY=${revenuePerformance.yoyGrowth.toFixed(1)}%, ` +
      `Target=${targetGrowthPercent}%, Gap=${gapAnalysis.yoyGap.toFixed(1)}%`);
    
    // Calculate metrics for this specific scope
    const totalUnits = scopeUnits.length;
    const occupiedUnits = scopeUnits.filter(u => u.occupiedYN).length;
    const vacantUnits = totalUnits - occupiedUnits;
    const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
    
    const vacantUnitsList = scopeUnits.filter(u => !u.occupiedYN);
    const avgDaysVacant = vacantUnitsList.length > 0 
      ? vacantUnitsList.reduce((sum, u) => sum + (u.daysVacant || 0), 0) / vacantUnitsList.length 
      : 0;
    const unitsOver30DaysVacant = vacantUnitsList.filter(u => (u.daysVacant || 0) > 30).length;
    const unitsOver60DaysVacant = vacantUnitsList.filter(u => (u.daysVacant || 0) > 60).length;
    
    // Calculate average rates
    const avgPortfolioRate = scopeUnits.length > 0 
      ? scopeUnits.reduce((sum, u) => sum + (u.streetRate || 0), 0) / scopeUnits.length 
      : 0;
    
    // Filter competitors by location and service line
    const scopeCompetitors = competitors.filter(c => 
      c.location === locationName && 
      (c.serviceLine === serviceLine || !c.serviceLine)
    );
    const validCompetitorRates = scopeCompetitors
      .map(c => c.finalRate || c.baseRate || 0)
      .filter(r => r > 0);
    let effectiveCompetitorRate = validCompetitorRates.length > 0 
      ? validCompetitorRates.reduce((sum, r) => sum + r, 0) / validCompetitorRates.length 
      : 0;
    
    // Fallback to rent roll competitor data
    if (effectiveCompetitorRate === 0 && scopeUnits.length > 0) {
      const unitsWithCompetitor = scopeUnits.filter(u => (u.competitorFinalRate || u.competitorRate || 0) > 0);
      if (unitsWithCompetitor.length > 0) {
        effectiveCompetitorRate = unitsWithCompetitor.reduce((sum, u) => sum + (u.competitorFinalRate || u.competitorRate || 0), 0) / unitsWithCompetitor.length;
      }
    }
    
    // Calculate sales velocity for this scope
    let salesVelocity = { moveIns30: 0, moveOuts30: 0, netChange: 0 };
    if (previousMonth) {
      const previousScopeUnits = allUnitsForPrevMonth.filter(u => 
        u.location === locationName && u.serviceLine === serviceLine
      );
      const currentOccupied = new Set(scopeUnits.filter(u => u.occupiedYN).map(u => u.roomNumber + '|' + u.location));
      const previousOccupied = new Set(previousScopeUnits.filter(u => u.occupiedYN).map(u => u.roomNumber + '|' + u.location));
      
      salesVelocity.moveIns30 = [...currentOccupied].filter(x => !previousOccupied.has(x)).length;
      salesVelocity.moveOuts30 = [...previousOccupied].filter(x => !currentOccupied.has(x)).length;
      salesVelocity.netChange = salesVelocity.moveIns30 - salesVelocity.moveOuts30;
    }
    
    const recentMoveins = scopeUnits.filter(u => u.occupiedYN && (u.daysVacant || 0) <= 30).length;
    if (salesVelocity.moveIns30 === 0) {
      salesVelocity.moveIns30 = recentMoveins;
    }
    
    // Build the GPT prompt for this scope with revenue performance data
    const revenuePerformanceSection = hasHistoricalData ? `
REVENUE PERFORMANCE ANALYSIS:
- Current Month Revenue: $${revenuePerformance.currentMonthRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month
- Previous Month Revenue: $${revenuePerformance.previousMonthRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month
- Same Month Last Year Revenue: $${revenuePerformance.sameMonthLastYearRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}/month
- Month-over-Month (MOM) Growth: ${revenuePerformance.momGrowth >= 0 ? '+' : ''}${revenuePerformance.momGrowth.toFixed(1)}%
- Year-over-Year (YOY) Growth: ${revenuePerformance.yoyGrowth >= 0 ? '+' : ''}${revenuePerformance.yoyGrowth.toFixed(1)}%

GAP ANALYSIS (Target vs Actual):
- Target Annual Growth: ${targetGrowthPercent}%
- Actual YOY Growth: ${revenuePerformance.yoyGrowth >= 0 ? '+' : ''}${revenuePerformance.yoyGrowth.toFixed(1)}%
- Gap: ${gapAnalysis.yoyGap >= 0 ? '+' : ''}${gapAnalysis.yoyGap.toFixed(1)}% (${gapAnalysis.onTrack ? 'ON TRACK or EXCEEDING' : 'BEHIND TARGET'})
- Performance Status: ${gapAnalysis.gapSeverity.replace('_', ' ').toUpperCase()}

PRICING STRATEGY GUIDANCE based on gap analysis and occupancy:
${(() => {
  const isHighOccupancy = occupancyRate >= 90;
  const isMediumOccupancy = occupancyRate >= 75 && occupancyRate < 90;
  const isLowOccupancy = occupancyRate < 75;
  
  if (gapAnalysis.gapSeverity === 'significantly_behind') {
    if (isLowOccupancy) {
      return `- VOLUME FIRST STRATEGY: Behind target with LOW occupancy (${occupancyRate.toFixed(1)}%). Prioritize FILLING UNITS over rate increases. Match or slightly undercut competitor rates to accelerate move-ins. Revenue grows faster by filling units first, then raising rates once occupancy reaches 85%+. Higher vacancy decay weight, lower competitor resistance.`;
    } else if (isMediumOccupancy) {
      return `- BALANCED URGENCY: Behind target with MODERATE occupancy (${occupancyRate.toFixed(1)}%). Mix strategy: discount long-vacant units while maintaining rates on desirable units. Target filling the 30+ day vacancies aggressively while holding premium rates on newer vacancies.`;
    } else {
      return `- RATE INCREASE STRATEGY: Behind target but HIGH occupancy (${occupancyRate.toFixed(1)}%). You have pricing power - increase rates to grow revenue. Focus on premium positioning and attribute-based premiums. Reduce discounting since demand is strong.`;
    }
  } else if (gapAnalysis.gapSeverity === 'slightly_behind') {
    if (isLowOccupancy) {
      return `- COMPETITIVE MATCHING: Slightly behind target with occupancy at ${occupancyRate.toFixed(1)}%. Consider matching new competitor rates to protect market share. Fill units first, then gradually increase rates. Modest vacancy discounts.`;
    } else if (isMediumOccupancy) {
      return `- MODERATE URGENCY: Slightly behind target at ${occupancyRate.toFixed(1)}% occupancy. Balanced adjustments with slight bias toward competitive pricing and vacancy urgency.`;
    } else {
      return `- PREMIUM PUSH: Slightly behind but at ${occupancyRate.toFixed(1)}% occupancy. You can afford to raise rates modestly. Focus on attribute premiums and slight rate increases.`;
    }
  } else if (gapAnalysis.gapSeverity === 'on_target') {
    return `- BALANCED: On target at ${occupancyRate.toFixed(1)}% occupancy. Maintain current strategy with balanced weights. Monitor competitor moves.`;
  } else {
    return `- PREMIUM POSITIONING: Exceeding target at ${occupancyRate.toFixed(1)}% occupancy. Focus on premium attributes, allow more flexibility in rate increases, and optimize for rate over occupancy.`;
  }
})()}

OCCUPANCY-RATE TRADEOFF PRINCIPLES:
- Low occupancy (<75%): Volume before rate. Filling units generates more total revenue than maximizing rate per unit.
- Medium occupancy (75-90%): Balance discounting long vacancies with maintaining rates on desirable units.
- High occupancy (>90%): You have pricing power. Focus on rate increases and premium positioning.
- New competitors: Consider matching their rates to protect occupancy, then grow revenue once stabilized.
` : `
REVENUE PERFORMANCE ANALYSIS:
- No historical data available for YOY/MOM comparison. Use default growth assumptions.
- Target Annual Growth: ${targetGrowthPercent}%
`;
    
    const prompt = `You are an expert senior living revenue management AI. Analyze the data for "${scopeLabel}" and target revenue growth, then suggest optimal pricing settings.

TARGET ANNUAL REVENUE GROWTH: ${targetGrowthPercent}%
${revenuePerformanceSection}
CURRENT METRICS FOR "${scopeLabel}" (${currentMonth}):
- Total Units: ${totalUnits}
- Occupied Units: ${occupiedUnits} (${occupancyRate.toFixed(1)}% occupancy)
- Vacant Units: ${vacantUnits}
- Average Days Vacant: ${avgDaysVacant.toFixed(0)} days
- Units Vacant 30+ Days: ${unitsOver30DaysVacant}
- Units Vacant 60+ Days: ${unitsOver60DaysVacant}
- Average Rate: $${avgPortfolioRate.toFixed(0)}/month
- Average Competitor Rate: $${effectiveCompetitorRate.toFixed(0)}/month${effectiveCompetitorRate === 0 ? ' (no competitor data available)' : ''}
- Rate Position vs Competitors: ${effectiveCompetitorRate > 0 ? (avgPortfolioRate > effectiveCompetitorRate ? `+${((avgPortfolioRate/effectiveCompetitorRate - 1) * 100).toFixed(1)}% premium` : `${((avgPortfolioRate/effectiveCompetitorRate - 1) * 100).toFixed(1)}% discount`) : 'N/A - no competitor data'}

SALES VELOCITY (Month-over-Month):
- Move-ins (30 days): ${salesVelocity.moveIns30}
- Move-outs (30 days): ${salesVelocity.moveOuts30}
- Net Change: ${salesVelocity.netChange > 0 ? '+' : ''}${salesVelocity.netChange}
- Velocity Assessment: ${salesVelocity.moveIns30 > 5 ? 'HIGH - strong demand' : salesVelocity.moveIns30 > 2 ? 'MODERATE - balanced approach' : 'LOW - focus on competitive pricing'}

CURRENT SETTINGS:
Weights (must sum to 100):
- Occupancy Pressure: ${currentWeights?.occupancyPressure || 25}%
- Days Vacant Decay: ${currentWeights?.daysVacantDecay || 20}%
- Competitor Rates: ${currentWeights?.competitorRates || 15}%
- Seasonality: ${currentWeights?.seasonality || 10}%
- Stock Market: ${currentWeights?.stockMarket || 10}%
- Inquiry Volume: ${currentWeights?.inquiryTourVolume || 20}%

Current Guardrails:
- Max Increase: ${currentGuardrails?.maxIncreasePercent || 10}%
- Max Decrease: ${currentGuardrails?.maxDecreasePercent || 5}%
- Min Street Rate: $${currentGuardrails?.minStreetRate || 2500}
- Max Street Rate: $${currentGuardrails?.maxStreetRate || 8000}

Current Adjustment Ranges (as decimals):
- Occupancy: ${currentAdjustmentRanges?.occupancyMin || -0.10} to ${currentAdjustmentRanges?.occupancyMax || 0.05}
- Vacancy: ${currentAdjustmentRanges?.vacancyMin || -0.15} to ${currentAdjustmentRanges?.vacancyMax || 0}
- Attributes: ${currentAdjustmentRanges?.attributesMin || -0.05} to ${currentAdjustmentRanges?.attributesMax || 0.10}
- Seasonality: ${currentAdjustmentRanges?.seasonalityMin || -0.05} to ${currentAdjustmentRanges?.seasonalityMax || 0.08}
- Competitor: ${currentAdjustmentRanges?.competitorMin || -0.08} to ${currentAdjustmentRanges?.competitorMax || 0.08}

Based on the targets and data, suggest optimal settings. Respond with ONLY a JSON object:
{
  "weights": {
    "occupancyPressure": <number 0-50>,
    "daysVacantDecay": <number 0-50>,
    "competitorRates": <number 0-30>,
    "seasonality": <number 0-20>,
    "stockMarket": <number 0-15>,
    "inquiryTourVolume": <number 0-30>
  },
  "guardrails": {
    "maxIncreasePercent": <number 1-20>,
    "maxDecreasePercent": <number 1-15>,
    "minStreetRate": <number 1500-6000>,
    "maxStreetRate": <number 6000-15000>
  },
  "adjustmentRanges": {
    "occupancyMin": <decimal -0.20 to 0>,
    "occupancyMax": <decimal 0 to 0.20>,
    "vacancyMin": <decimal -0.30 to 0>,
    "vacancyMax": <decimal -0.10 to 0.05>,
    "attributesMin": <decimal -0.10 to 0>,
    "attributesMax": <decimal 0 to 0.25>,
    "seasonalityMin": <decimal -0.10 to 0>,
    "seasonalityMax": <decimal 0 to 0.15>,
    "competitorMin": <decimal -0.15 to 0>,
    "competitorMax": <decimal 0 to 0.15>
  },
  "attributeAdjustments": {
    "premiumView": <number -10 to 15>,
    "renovated": <number -5 to 20>,
    "cornerUnit": <number -5 to 10>,
    "groundFloor": <number -5 to 10>,
    "largeSize": <number -5 to 15>
  },
  "reasoning": "<1-2 sentence explanation for ${scopeLabel} referencing revenue growth gap, occupancy %, and pricing strategy adjustment>"
}

IMPORTANT: 
- Weights must sum to exactly 100.
- If revenue growth is BEHIND target, prioritize occupancy pressure and vacancy discounts to accelerate leasing.
- If revenue growth EXCEEDS target, prioritize premium positioning and attribute adjustments.`;

    const rawText = await callClaudeThenGPT(
      'You are an expert senior living revenue management AI.',
      prompt,
      'Based on the analysis, produce ONLY a valid JSON object following the exact schema in the analysis prompt (weights, guardrails, adjustmentRanges, attributeAdjustments, reasoning). No other text.',
      { label: `target-settings:${scopeLabel}`, claudeMaxTokens: 512, gptMaxTokens: 800 }
    );
    const generatedSettings = JSON.parse(rawText);
    
    // Validate and clamp weights
    const weights = generatedSettings.weights;
    const weightSum = Object.values(weights).reduce((a: number, b: any) => a + Number(b), 0);
    if (Math.abs(weightSum - 100) > 1) {
      const factor = 100 / weightSum;
      Object.keys(weights).forEach(k => {
        weights[k] = Math.round(weights[k] * factor);
      });
    }
    
    // Clamp guardrails
    const guardrailsResult = generatedSettings.guardrails;
    guardrailsResult.maxIncreasePercent = Math.max(1, Math.min(20, guardrailsResult.maxIncreasePercent));
    guardrailsResult.maxDecreasePercent = Math.max(1, Math.min(15, guardrailsResult.maxDecreasePercent));
    guardrailsResult.minStreetRate = Math.max(1500, Math.min(4000, guardrailsResult.minStreetRate));
    guardrailsResult.maxStreetRate = Math.max(6000, Math.min(15000, guardrailsResult.maxStreetRate));
    
    return {
      locationId,
      locationName,
      serviceLine,
      weights: generatedSettings.weights,
      guardrails: generatedSettings.guardrails,
      adjustmentRanges: generatedSettings.adjustmentRanges,
      attributeAdjustments: generatedSettings.attributeAdjustments,
      reasoning: generatedSettings.reasoning,
      metrics: {
        occupancyRate: parseFloat(occupancyRate.toFixed(1)),
        avgDaysVacant: parseFloat(avgDaysVacant.toFixed(0)),
        competitorRate: parseFloat(effectiveCompetitorRate.toFixed(0)),
        avgPortfolioRate: parseFloat(avgPortfolioRate.toFixed(0)),
        salesVelocity: salesVelocity.moveIns30,
        netChange: salesVelocity.netChange,
        totalUnits,
        vacantUnits,
        unitsOver30DaysVacant,
        unitsOver60DaysVacant
      },
      revenuePerformance: {
        currentMonthRevenue: revenuePerformance.currentMonthRevenue,
        previousMonthRevenue: revenuePerformance.previousMonthRevenue,
        sameMonthLastYearRevenue: revenuePerformance.sameMonthLastYearRevenue,
        momGrowth: revenuePerformance.momGrowth,
        yoyGrowth: revenuePerformance.yoyGrowth,
        hasHistoricalData
      },
      gapAnalysis: {
        targetGrowth: gapAnalysis.targetGrowth,
        actualYOYGrowth: gapAnalysis.actualYOYGrowth,
        yoyGap: gapAnalysis.yoyGap,
        onTrack: gapAnalysis.onTrack,
        gapSeverity: gapAnalysis.gapSeverity
      }
    };
  }

  // Concurrency-limited Promise pool for parallel execution
  async function executeWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    concurrencyLimit: number
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];
    
    for (const task of tasks) {
      const p = Promise.resolve().then(() => task()).then(result => {
        results.push(result);
      });
      executing.push(p);
      
      if (executing.length >= concurrencyLimit) {
        await Promise.race(executing);
        // Remove completed promises
        for (let i = executing.length - 1; i >= 0; i--) {
          const status = await Promise.race([executing[i].then(() => 'fulfilled'), Promise.resolve('pending')]);
          if (status === 'fulfilled') {
            executing.splice(i, 1);
          }
        }
      }
    }
    
    await Promise.all(executing);
    return results;
  }

  // Generate optimal settings from revenue growth targets using Claude→GPT-5.4
  app.post("/api/pricing/targets/generate", async (req, res) => {
    try {
      const { targets, filters, analyzeIndividually } = req.body;
      
      console.log('[Target Generation] Starting with targets:', targets, 'filters:', filters, 'analyzeIndividually:', analyzeIndividually);
      
      // Get available months and use the most recent one with data
      const monthsResult = await db
        .selectDistinct({ uploadMonth: rentRollData.uploadMonth })
        .from(rentRollData)
        .where(sql`${rentRollData.uploadMonth} IS NOT NULL`)
        .orderBy(sql`${rentRollData.uploadMonth} DESC`);
      
      const availableMonths = monthsResult.map(r => r.uploadMonth).filter(Boolean) as string[];
      const currentMonth = availableMonths.length > 0 ? availableMonths[0] : new Date().toISOString().substring(0, 7);
      const previousMonth = availableMonths.length > 1 ? availableMonths[1] : null;
      
      console.log('[Target Generation] Using month:', currentMonth, 'Previous:', previousMonth);
      
      // Get all rent roll data (not filtered by month initially to get more data)
      let allUnits = await storage.getRentRollData();
      
      // Get current month units (use uploadMonth field)
      let units = allUnits.filter(u => u.uploadMonth === currentMonth);
      
      // If no data for current month, use all available data
      if (units.length === 0) {
        units = allUnits;
        console.log('[Target Generation] No data for current month, using all available:', units.length, 'units');
      }
      
      // Get all locations for ID lookup
      const allLocations = await storage.getLocations();
      
      // Apply location/region/division filters
      if (filters?.locations && filters.locations.length > 0) {
        units = units.filter(u => u.location && filters.locations.includes(u.location));
      }
      if (filters?.regions && filters.regions.length > 0) {
        const regionLocations = allLocations.filter(loc => loc.region && filters.regions.includes(loc.region)).map(loc => loc.name);
        units = units.filter(u => u.location && regionLocations.includes(u.location));
      }
      if (filters?.divisions && filters.divisions.length > 0) {
        const divisionLocations = allLocations.filter(loc => loc.division && filters.divisions.includes(loc.division)).map(loc => loc.name);
        units = units.filter(u => u.location && divisionLocations.includes(u.location));
      }
      
      // Apply service line filter only for service line stats, not total count
      let filteredUnits = units;
      if (filters?.serviceLine && filters.serviceLine !== 'All') {
        filteredUnits = units.filter(u => u.serviceLine === filters.serviceLine);
      }
      
      console.log('[Target Generation] Filtered units:', filteredUnits.length, 'from total:', units.length);

      // Get all competitors for filtering later
      const allCompetitors = await storage.getCompetitors();
      
      // Get current weights, guardrails, and adjustment ranges
      const currentWeights = await storage.getPricingWeights();
      const currentGuardrails = await storage.getCurrentGuardrails();
      const currentAdjustmentRanges = await storage.getAdjustmentRanges();

      // Fetch saved revenue growth targets for comparison with actual performance
      const savedRevenueTargets = await storage.getRevenueGrowthTargets();
      console.log('[Target Generation] Fetched', savedRevenueTargets.length, 'saved revenue growth targets');

      // Branch based on analyzeIndividually flag
      if (analyzeIndividually) {
        console.log('[Target Generation] Individual analysis mode enabled');
        
        // Get unique location + service line combinations from filtered data
        const scopeMap = new Map<string, { locationId: number | undefined; locationName: string; serviceLine: string; units: any[] }>();
        
        for (const unit of filteredUnits) {
          const locationName = unit.location || 'Unknown';
          const serviceLine = unit.serviceLine || 'Unknown';
          const key = `${locationName}|${serviceLine}`;
          
          if (!scopeMap.has(key)) {
            const location = allLocations.find(l => l.name === locationName);
            scopeMap.set(key, {
              locationId: location?.id,
              locationName,
              serviceLine,
              units: []
            });
          }
          scopeMap.get(key)!.units.push(unit);
        }
        
        const scopes = Array.from(scopeMap.values());
        console.log(`[Target Generation] Found ${scopes.length} unique location/service line combinations`);
        
        if (scopes.length === 0) {
          return res.status(400).json({ error: 'No location/service line combinations found in filtered data' });
        }
        
        // Get previous month units for velocity calculation
        const previousMonthUnits = previousMonth 
          ? allUnits.filter(u => u.uploadMonth === previousMonth)
          : [];
        
        // Create tasks for parallel execution
        const tasks = scopes.map(scope => async () => {
          const scopeLabel = `${scope.locationName} - ${scope.serviceLine}`;
          console.log(`[Individual Analysis] Starting analysis for ${scopeLabel}`);
          
          try {
            const result = await analyzeIndividualScope(
              scope.units,
              previousMonthUnits,
              scopeLabel,
              scope.locationId,
              scope.locationName,
              scope.serviceLine,
              targets,
              currentMonth,
              previousMonth,
              currentWeights,
              currentGuardrails,
              currentAdjustmentRanges,
              allCompetitors,
              allUnits,
              savedRevenueTargets
            );
            console.log(`[Individual Analysis] Completed analysis for ${scopeLabel}`);
            return result;
          } catch (error) {
            console.error(`[Individual Analysis] Error analyzing ${scopeLabel}:`, error);
            throw error;
          }
        });
        
        // Execute with concurrency limit of 3
        console.log('[Target Generation] Starting parallel GPT calls with concurrency limit of 3...');
        const individualResults = await executeWithConcurrency(tasks, 3);
        console.log(`[Target Generation] Completed ${individualResults.length} individual analyses`);
        
        // Calculate averages across all individual results
        const avgWeights = {
          occupancyPressure: 0,
          daysVacantDecay: 0,
          competitorRates: 0,
          seasonality: 0,
          stockMarket: 0,
          inquiryTourVolume: 0
        };
        const avgGuardrails = {
          maxIncreasePercent: 0,
          maxDecreasePercent: 0,
          minStreetRate: 0,
          maxStreetRate: 0
        };
        const avgAdjustmentRanges = {
          occupancyMin: 0,
          occupancyMax: 0,
          vacancyMin: 0,
          vacancyMax: 0,
          attributesMin: 0,
          attributesMax: 0,
          seasonalityMin: 0,
          seasonalityMax: 0,
          competitorMin: 0,
          competitorMax: 0
        };
        const avgAttributeAdjustments = {
          premiumView: 0,
          renovated: 0,
          cornerUnit: 0,
          groundFloor: 0,
          largeSize: 0
        };
        
        // Sum up all values
        for (const result of individualResults) {
          // Weights
          avgWeights.occupancyPressure += result.weights.occupancyPressure || 0;
          avgWeights.daysVacantDecay += result.weights.daysVacantDecay || 0;
          avgWeights.competitorRates += result.weights.competitorRates || 0;
          avgWeights.seasonality += result.weights.seasonality || 0;
          avgWeights.stockMarket += result.weights.stockMarket || 0;
          avgWeights.inquiryTourVolume += result.weights.inquiryTourVolume || 0;
          
          // Guardrails
          avgGuardrails.maxIncreasePercent += result.guardrails.maxIncreasePercent || 0;
          avgGuardrails.maxDecreasePercent += result.guardrails.maxDecreasePercent || 0;
          avgGuardrails.minStreetRate += result.guardrails.minStreetRate || 0;
          avgGuardrails.maxStreetRate += result.guardrails.maxStreetRate || 0;
          
          // Adjustment Ranges
          if (result.adjustmentRanges) {
            avgAdjustmentRanges.occupancyMin += result.adjustmentRanges.occupancyMin || 0;
            avgAdjustmentRanges.occupancyMax += result.adjustmentRanges.occupancyMax || 0;
            avgAdjustmentRanges.vacancyMin += result.adjustmentRanges.vacancyMin || 0;
            avgAdjustmentRanges.vacancyMax += result.adjustmentRanges.vacancyMax || 0;
            avgAdjustmentRanges.attributesMin += result.adjustmentRanges.attributesMin || 0;
            avgAdjustmentRanges.attributesMax += result.adjustmentRanges.attributesMax || 0;
            avgAdjustmentRanges.seasonalityMin += result.adjustmentRanges.seasonalityMin || 0;
            avgAdjustmentRanges.seasonalityMax += result.adjustmentRanges.seasonalityMax || 0;
            avgAdjustmentRanges.competitorMin += result.adjustmentRanges.competitorMin || 0;
            avgAdjustmentRanges.competitorMax += result.adjustmentRanges.competitorMax || 0;
          }
          
          // Attribute Adjustments
          if (result.attributeAdjustments) {
            avgAttributeAdjustments.premiumView += result.attributeAdjustments.premiumView || 0;
            avgAttributeAdjustments.renovated += result.attributeAdjustments.renovated || 0;
            avgAttributeAdjustments.cornerUnit += result.attributeAdjustments.cornerUnit || 0;
            avgAttributeAdjustments.groundFloor += result.attributeAdjustments.groundFloor || 0;
            avgAttributeAdjustments.largeSize += result.attributeAdjustments.largeSize || 0;
          }
        }
        
        // Divide by count to get averages
        const count = individualResults.length;
        Object.keys(avgWeights).forEach(k => {
          (avgWeights as any)[k] = Math.round((avgWeights as any)[k] / count);
        });
        Object.keys(avgGuardrails).forEach(k => {
          (avgGuardrails as any)[k] = Math.round((avgGuardrails as any)[k] / count);
        });
        Object.keys(avgAdjustmentRanges).forEach(k => {
          (avgAdjustmentRanges as any)[k] = parseFloat(((avgAdjustmentRanges as any)[k] / count).toFixed(3));
        });
        Object.keys(avgAttributeAdjustments).forEach(k => {
          (avgAttributeAdjustments as any)[k] = Math.round((avgAttributeAdjustments as any)[k] / count);
        });
        
        // Ensure weights sum to 100
        const weightSum = Object.values(avgWeights).reduce((a, b) => a + b, 0);
        if (Math.abs(weightSum - 100) > 1) {
          const factor = 100 / weightSum;
          Object.keys(avgWeights).forEach(k => {
            (avgWeights as any)[k] = Math.round((avgWeights as any)[k] * factor);
          });
        }
        
        // Calculate aggregate metrics across all scopes
        const aggregateMetrics = {
          occupancyRate: 0,
          avgDaysVacant: 0,
          competitorRate: 0,
          avgPortfolioRate: 0,
          salesVelocity: 0,
          netChange: 0,
          totalUnits: 0,
          vacantUnits: 0,
          unitsOver30DaysVacant: 0,
          unitsOver60DaysVacant: 0
        };
        
        for (const result of individualResults) {
          aggregateMetrics.totalUnits += result.metrics.totalUnits;
          aggregateMetrics.vacantUnits += result.metrics.vacantUnits;
          aggregateMetrics.unitsOver30DaysVacant += result.metrics.unitsOver30DaysVacant;
          aggregateMetrics.unitsOver60DaysVacant += result.metrics.unitsOver60DaysVacant;
          aggregateMetrics.salesVelocity += result.metrics.salesVelocity;
          aggregateMetrics.netChange += result.metrics.netChange;
        }
        
        // Calculate weighted averages for rates
        if (aggregateMetrics.totalUnits > 0) {
          let totalRate = 0;
          let totalCompRate = 0;
          let compCount = 0;
          for (const result of individualResults) {
            totalRate += result.metrics.avgPortfolioRate * result.metrics.totalUnits;
            if (result.metrics.competitorRate > 0) {
              totalCompRate += result.metrics.competitorRate * result.metrics.totalUnits;
              compCount += result.metrics.totalUnits;
            }
          }
          aggregateMetrics.avgPortfolioRate = Math.round(totalRate / aggregateMetrics.totalUnits);
          aggregateMetrics.competitorRate = compCount > 0 ? Math.round(totalCompRate / compCount) : 0;
          aggregateMetrics.occupancyRate = parseFloat(((aggregateMetrics.totalUnits - aggregateMetrics.vacantUnits) / aggregateMetrics.totalUnits * 100).toFixed(1));
          aggregateMetrics.avgDaysVacant = Math.round(individualResults.reduce((sum, r) => sum + r.metrics.avgDaysVacant, 0) / count);
        }
        
        const response = {
          mode: 'individual' as const,
          weights: avgWeights,
          guardrails: avgGuardrails,
          adjustmentRanges: avgAdjustmentRanges,
          attributeAdjustments: avgAttributeAdjustments,
          reasoning: `Analyzed ${individualResults.length} location/service line combinations. Recommendations are averaged across all scopes to provide balanced settings.`,
          metrics: aggregateMetrics,
          individuals: individualResults,
          scopeCount: individualResults.length
        };
        
        console.log('[Target Generation] Individual analysis complete, returning averaged results');
        return res.json(response);
      }
      
      // PORTFOLIO MODE (existing logic)
      console.log('[Target Generation] Portfolio analysis mode');
      
      // Build scope label based on filters
      let scopeLabel = 'Portfolio';
      const scopeParts: string[] = [];
      if (filters?.locations && filters.locations.length === 1) {
        scopeParts.push(filters.locations[0]);
      } else if (filters?.locations && filters.locations.length > 1) {
        scopeParts.push(`${filters.locations.length} locations`);
      } else if (filters?.regions && filters.regions.length > 0) {
        scopeParts.push(filters.regions.length === 1 ? `${filters.regions[0]} region` : `${filters.regions.length} regions`);
      } else if (filters?.divisions && filters.divisions.length > 0) {
        scopeParts.push(filters.divisions.length === 1 ? `${filters.divisions[0]} division` : `${filters.divisions.length} divisions`);
      }
      if (filters?.serviceLine && filters.serviceLine !== 'All') {
        scopeParts.push(filters.serviceLine);
      }
      if (scopeParts.length > 0) {
        scopeLabel = scopeParts.join(' - ');
      }
      
      console.log('[Target Generation] Scope label:', scopeLabel);
      
      // Calculate portfolio metrics from filtered units
      const totalUnits = filteredUnits.length;
      const occupiedUnits = filteredUnits.filter(u => u.occupiedYN).length;
      const vacantUnits = totalUnits - occupiedUnits;
      const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
      
      // Calculate vacancy metrics
      const vacantUnitsList = filteredUnits.filter(u => !u.occupiedYN);
      const avgDaysVacant = vacantUnitsList.length > 0 
        ? vacantUnitsList.reduce((sum, u) => sum + (u.daysVacant || 0), 0) / vacantUnitsList.length 
        : 0;
      const unitsOver30DaysVacant = vacantUnitsList.filter(u => (u.daysVacant || 0) > 30).length;
      const unitsOver60DaysVacant = vacantUnitsList.filter(u => (u.daysVacant || 0) > 60).length;
      
      // Calculate service line breakdown from ALL units (not filtered by service line)
      const serviceLineStats: Record<string, { total: number; occupied: number; avgRate: number; avgDaysVacant: number }> = {};
      units.forEach(u => {
        const sl = u.serviceLine || 'Unknown';
        if (!serviceLineStats[sl]) {
          serviceLineStats[sl] = { total: 0, occupied: 0, avgRate: 0, avgDaysVacant: 0 };
        }
        serviceLineStats[sl].total++;
        if (u.occupiedYN) serviceLineStats[sl].occupied++;
        serviceLineStats[sl].avgRate += u.streetRate || 0;
        if (!u.occupiedYN) serviceLineStats[sl].avgDaysVacant += u.daysVacant || 0;
      });
      Object.keys(serviceLineStats).forEach(sl => {
        if (serviceLineStats[sl].total > 0) {
          serviceLineStats[sl].avgRate = serviceLineStats[sl].avgRate / serviceLineStats[sl].total;
          const vacantCount = serviceLineStats[sl].total - serviceLineStats[sl].occupied;
          if (vacantCount > 0) {
            serviceLineStats[sl].avgDaysVacant = serviceLineStats[sl].avgDaysVacant / vacantCount;
          }
        }
      });
      
      // Get competitor data filtered by location and service line
      const competitorFilters: any = {};
      if (filters?.locations && filters.locations.length > 0) {
        competitorFilters.locations = filters.locations;
      }
      if (filters?.serviceLine && filters.serviceLine !== 'All') {
        competitorFilters.serviceLines = [filters.serviceLine];
      }
      const competitors = Object.keys(competitorFilters).length > 0 
        ? await storage.getCompetitorsWithFilters(competitorFilters)
        : allCompetitors;
      
      // Calculate average competitor rate - use finalRate if available, otherwise baseRate
      const validCompetitorRates = competitors
        .map(c => c.finalRate || c.baseRate || 0)
        .filter(r => r > 0);
      const avgCompetitorRate = validCompetitorRates.length > 0 
        ? validCompetitorRates.reduce((sum, r) => sum + r, 0) / validCompetitorRates.length 
        : 0;
      
      // Also get rates from rent roll competitor data if no survey data
      let competitorRateFromRentRoll = 0;
      if (avgCompetitorRate === 0 && filteredUnits.length > 0) {
        const unitsWithCompetitor = filteredUnits.filter(u => (u.competitorFinalRate || u.competitorRate || 0) > 0);
        if (unitsWithCompetitor.length > 0) {
          competitorRateFromRentRoll = unitsWithCompetitor.reduce((sum, u) => sum + (u.competitorFinalRate || u.competitorRate || 0), 0) / unitsWithCompetitor.length;
        }
      }
      const effectiveCompetitorRate = avgCompetitorRate > 0 ? avgCompetitorRate : competitorRateFromRentRoll;
      
      // Calculate actual sales velocity by comparing months
      let salesVelocity = { moveIns30: 0, moveOuts30: 0, netChange: 0 };
      if (previousMonth) {
        const previousUnits = allUnits.filter(u => u.uploadMonth === previousMonth);
        const currentOccupied = new Set(filteredUnits.filter(u => u.occupiedYN).map(u => u.roomNumber + '|' + u.location));
        const previousOccupied = new Set(previousUnits.filter(u => u.occupiedYN).map(u => u.roomNumber + '|' + u.location));
        
        // Count move-ins (occupied now but not before)
        salesVelocity.moveIns30 = [...currentOccupied].filter(x => !previousOccupied.has(x)).length;
        // Count move-outs (was occupied but not now)
        salesVelocity.moveOuts30 = [...previousOccupied].filter(x => !currentOccupied.has(x)).length;
        salesVelocity.netChange = salesVelocity.moveIns30 - salesVelocity.moveOuts30;
      }
      
      // Fallback velocity calculation from daysVacant if no previous month
      const recentMoveins = filteredUnits.filter(u => u.occupiedYN && (u.daysVacant || 0) <= 30).length;
      const moveinsLast60 = filteredUnits.filter(u => u.occupiedYN && (u.daysVacant || 0) <= 60).length;
      if (salesVelocity.moveIns30 === 0) {
        salesVelocity.moveIns30 = recentMoveins;
      }
      
      // Build the Claude→GPT-5.4 prompt with comprehensive portfolio data
      const avgPortfolioRate = filteredUnits.length > 0 
        ? filteredUnits.reduce((sum, u) => sum + (u.streetRate || 0), 0) / filteredUnits.length 
        : 0;
      
      const prompt = `You are an expert senior living revenue management AI. Analyze the data for "${scopeLabel}" and target revenue growth, then suggest optimal pricing settings for ALL pricing controls.

TARGET ANNUAL REVENUE GROWTH BY SERVICE LINE:
${Object.entries(targets).map(([sl, pct]) => `- ${sl}: ${pct}%`).join('\n')}

CURRENT METRICS FOR "${scopeLabel}" (${currentMonth}):
- Total Units: ${totalUnits}
- Occupied Units: ${occupiedUnits} (${occupancyRate.toFixed(1)}% occupancy)
- Vacant Units: ${vacantUnits}
- Average Days Vacant: ${avgDaysVacant.toFixed(0)} days
- Units Vacant 30+ Days: ${unitsOver30DaysVacant}
- Units Vacant 60+ Days: ${unitsOver60DaysVacant}
- Average Rate: $${avgPortfolioRate.toFixed(0)}/month
- Average Competitor Rate: $${effectiveCompetitorRate.toFixed(0)}/month${effectiveCompetitorRate === 0 ? ' (no competitor data available)' : ''}
- Rate Position vs Competitors: ${effectiveCompetitorRate > 0 ? (avgPortfolioRate > effectiveCompetitorRate ? `+${((avgPortfolioRate/effectiveCompetitorRate - 1) * 100).toFixed(1)}% premium` : `${((avgPortfolioRate/effectiveCompetitorRate - 1) * 100).toFixed(1)}% discount`) : 'N/A - no competitor data'}

SALES VELOCITY (Month-over-Month):
- Move-ins (30 days): ${salesVelocity.moveIns30}
- Move-outs (30 days): ${salesVelocity.moveOuts30}
- Net Change: ${salesVelocity.netChange > 0 ? '+' : ''}${salesVelocity.netChange}
- Recent Move-ins (from vacancy data): ${recentMoveins}
- Velocity Assessment: ${salesVelocity.moveIns30 > 15 ? 'HIGH - strong demand, can push rates aggressively' : salesVelocity.moveIns30 > 8 ? 'MODERATE - balanced approach recommended' : salesVelocity.moveIns30 > 3 ? 'LOW - focus on competitive pricing' : 'MINIMAL - prioritize occupancy over rate'}

SERVICE LINE BREAKDOWN:
${Object.entries(serviceLineStats).map(([sl, stats]) => 
  `- ${sl}: ${stats.total} units, ${stats.occupied} occupied (${((stats.occupied/stats.total)*100).toFixed(1)}%), avg rate $${stats.avgRate.toFixed(0)}, avg days vacant ${stats.avgDaysVacant.toFixed(0)}`
).join('\n')}

CURRENT SETTINGS:
Weights (must sum to 100):
- Occupancy Pressure: ${currentWeights?.occupancyPressure || 25}%
- Days Vacant Decay: ${currentWeights?.daysVacantDecay || 20}%
- Competitor Rates: ${currentWeights?.competitorRates || 15}%
- Seasonality: ${currentWeights?.seasonality || 10}%
- Stock Market: ${currentWeights?.stockMarket || 10}%
- Inquiry Volume: ${currentWeights?.inquiryTourVolume || 20}%

Current Guardrails:
- Max Increase: ${currentGuardrails?.maxIncreasePercent || 10}%
- Max Decrease: ${currentGuardrails?.maxDecreasePercent || 5}%
- Min Street Rate: $${currentGuardrails?.minStreetRate || 2500}
- Max Street Rate: $${currentGuardrails?.maxStreetRate || 8000}

Current Adjustment Ranges (as decimals, e.g., 0.10 = 10%):
- Occupancy: ${currentAdjustmentRanges?.occupancyMin || -0.10} to ${currentAdjustmentRanges?.occupancyMax || 0.05}
- Vacancy: ${currentAdjustmentRanges?.vacancyMin || -0.15} to ${currentAdjustmentRanges?.vacancyMax || 0}
- Attributes: ${currentAdjustmentRanges?.attributesMin || -0.05} to ${currentAdjustmentRanges?.attributesMax || 0.10}
- Seasonality: ${currentAdjustmentRanges?.seasonalityMin || -0.05} to ${currentAdjustmentRanges?.seasonalityMax || 0.08}
- Competitor: ${currentAdjustmentRanges?.competitorMin || -0.08} to ${currentAdjustmentRanges?.competitorMax || 0.08}

OCCUPANCY-RATE TRADEOFF PRINCIPLES (Critical for strategy selection):
- Low occupancy (<75%): VOLUME BEFORE RATE. Filling units generates more total revenue than maximizing rate per unit. Match or slightly undercut competitor rates to accelerate move-ins. Revenue grows faster by filling units first.
- Medium occupancy (75-90%): BALANCED APPROACH. Discount long-vacant units (30+ days) aggressively while maintaining rates on desirable, newly vacant units. Mix of volume and rate optimization.
- High occupancy (>90%): RATE INCREASE OPPORTUNITY. You have pricing power - focus on rate increases and premium positioning. Reduce discounting since demand supports current pricing.
- New competitor entry: Consider matching their rates initially to protect occupancy and market share, then grow revenue once position is stabilized.

Based on the targets and portfolio data, suggest optimal settings to achieve the revenue growth targets. Additional considerations:
1. High sales velocity = can increase rates without losing move-ins
2. Low sales velocity = focus on competitive pricing
3. Long vacancy times = need aggressive decay to fill units faster
4. Seasonal patterns (spring/fall typically higher demand in senior living)
5. Rate position vs competitors - if already premium, may need moderation

Respond with ONLY a JSON object in this exact format:
{
  "weights": {
    "occupancyPressure": <number 0-50>,
    "daysVacantDecay": <number 0-50>,
    "competitorRates": <number 0-30>,
    "seasonality": <number 0-20>,
    "stockMarket": <number 0-15>,
    "inquiryTourVolume": <number 0-30>
  },
  "guardrails": {
    "maxIncreasePercent": <number 1-20>,
    "maxDecreasePercent": <number 1-15>,
    "minStreetRate": <number 1500-6000>,
    "maxStreetRate": <number 6000-15000>
  },
  "adjustmentRanges": {
    "occupancyMin": <decimal -0.20 to 0>,
    "occupancyMax": <decimal 0 to 0.20>,
    "vacancyMin": <decimal -0.30 to 0>,
    "vacancyMax": <decimal -0.10 to 0.05>,
    "attributesMin": <decimal -0.10 to 0>,
    "attributesMax": <decimal 0 to 0.25>,
    "seasonalityMin": <decimal -0.10 to 0>,
    "seasonalityMax": <decimal 0 to 0.15>,
    "competitorMin": <decimal -0.15 to 0>,
    "competitorMax": <decimal 0 to 0.15>
  },
  "attributeAdjustments": {
    "premiumView": <number -10 to 15>,
    "renovated": <number -5 to 20>,
    "cornerUnit": <number -5 to 10>,
    "groundFloor": <number -5 to 10>,
    "largeSize": <number -5 to 15>
  },
  "reasoning": "<2-3 sentence explanation starting with '${scopeLabel} occupancy is...' and referencing the actual metrics (occupancy %, units, sales velocity, rate position) for this specific scope and how they influenced your recommendations>"
}

IMPORTANT: Weights must sum to exactly 100. Reference specific numbers from the portfolio data in your reasoning.`;

      console.log('[Target Generation] Calling Claude→GPT-5.4...');
      
      const rawText = await callClaudeThenGPT(
        'You are an expert senior living revenue management AI.',
        prompt,
        'Based on the analysis, produce ONLY a valid JSON object following the exact schema in the analysis prompt (weights, guardrails, adjustmentRanges, attributeAdjustments, reasoning). No other text.',
        { label: 'target-settings:portfolio', claudeMaxTokens: 512, gptMaxTokens: 800 }
      );

      let generatedSettings;
      
      try {
        generatedSettings = JSON.parse(rawText);
        console.log('[Target Generation] Claude→GPT response received');
        
        // Validate and clamp weights to ensure they sum to 100
        const weights = generatedSettings.weights;
        const weightSum = Object.values(weights).reduce((a: number, b: any) => a + Number(b), 0);
        if (Math.abs(weightSum - 100) > 1) {
          const factor = 100 / weightSum;
          Object.keys(weights).forEach(k => {
            weights[k] = Math.round(weights[k] * factor);
          });
        }
        
        // Clamp guardrails to safe ranges
        const guardrailsResponse = generatedSettings.guardrails;
        guardrailsResponse.maxIncreasePercent = Math.max(1, Math.min(20, guardrailsResponse.maxIncreasePercent));
        guardrailsResponse.maxDecreasePercent = Math.max(1, Math.min(15, guardrailsResponse.maxDecreasePercent));
        guardrailsResponse.minStreetRate = Math.max(1500, Math.min(4000, guardrailsResponse.minStreetRate));
        guardrailsResponse.maxStreetRate = Math.max(6000, Math.min(15000, guardrailsResponse.maxStreetRate));
        
      } catch (parseError) {
        console.error('[Target Generation] Failed to parse AI response:', parseError);
        throw new Error('Failed to parse AI response');
      }
      
      console.log('[Target Generation] Successfully generated settings');
      
      // Add mode and metrics to response for frontend
      generatedSettings.mode = 'portfolio';
      generatedSettings.metrics = {
        occupancyRate: parseFloat(occupancyRate.toFixed(1)),
        avgDaysVacant: parseFloat(avgDaysVacant.toFixed(0)),
        competitorRate: parseFloat(effectiveCompetitorRate.toFixed(0)),
        avgPortfolioRate: parseFloat(avgPortfolioRate.toFixed(0)),
        salesVelocity: salesVelocity.moveIns30,
        netChange: salesVelocity.netChange,
        totalUnits,
        vacantUnits,
        unitsOver30DaysVacant,
        unitsOver60DaysVacant
      };
      
      res.json(generatedSettings);
    } catch (error) {
      console.error('[Target Generation] Error:', error);
      res.status(500).json({ error: 'Failed to generate settings from targets' });
    }
  });

  // Apply AI-generated recommendations to database
  app.post("/api/pricing/targets/apply", async (req, res) => {
    try {
      const { recommendations, filters } = req.body;
      const mode = recommendations.mode || 'portfolio';
      
      console.log('[Apply Recommendations] Starting with mode:', mode, 'filters:', filters);
      
      // Get all locations data
      const allLocations = await storage.getLocations();
      
      let weightsUpdated = 0;
      let guardrailsUpdated = 0;
      let adjustmentRangesUpdated = 0;
      let locationsAffected = 0;
      
      // INDIVIDUAL MODE: Apply specific settings for each location/service line
      if (mode === 'individual' && recommendations.individuals && recommendations.individuals.length > 0) {
        console.log(`[Apply Recommendations] Processing ${recommendations.individuals.length} individual scopes`);
        
        const processedLocations = new Set<string>();
        
        for (const individual of recommendations.individuals) {
          const location = allLocations.find(loc => loc.id === individual.locationId);
          if (!location) {
            console.warn(`[Apply Recommendations] Location not found: ${individual.locationId}`);
            continue;
          }
          
          // Skip if no categories to apply
          const hasContent = individual.weights || individual.guardrails || individual.adjustmentRanges;
          if (!hasContent) continue;
          
          const serviceLine = individual.serviceLine;
          processedLocations.add(location.id);
          
          // Apply weights for this specific scope
          if (individual.weights) {
            const weights = individual.weights;
            await storage.createOrUpdateWeightsByFilter({
              occupancyPressure: weights.occupancyPressure,
              daysVacantDecay: weights.daysVacantDecay,
              competitorRates: weights.competitorRates,
              seasonality: weights.seasonality,
              stockMarket: weights.stockMarket,
              inquiryTourVolume: weights.inquiryTourVolume
            }, location.id, serviceLine);
            weightsUpdated++;
          }
          
          // Apply guardrails for this specific scope
          if (individual.guardrails) {
            const g = individual.guardrails;
            await storage.createOrUpdateGuardrailsByFilter({
              maxRateIncrease: g.maxIncreasePercent / 100,
              minRateDecrease: g.maxDecreasePercent / 100
            }, location.id, serviceLine);
            guardrailsUpdated++;
          }
          
          // Apply adjustment ranges for this specific scope
          if (individual.adjustmentRanges) {
            const ranges = individual.adjustmentRanges;
            await storage.createOrUpdateAdjustmentRangesByFilter({
              occupancyMin: ranges.occupancyMin,
              occupancyMax: ranges.occupancyMax,
              vacancyMin: ranges.vacancyMin,
              vacancyMax: ranges.vacancyMax,
              attributesMin: ranges.attributesMin,
              attributesMax: ranges.attributesMax,
              seasonalityMin: ranges.seasonalityMin,
              seasonalityMax: ranges.seasonalityMax,
              competitorMin: ranges.competitorMin,
              competitorMax: ranges.competitorMax
            }, location.id, serviceLine);
            adjustmentRangesUpdated++;
          }
        }
        
        locationsAffected = processedLocations.size;
        
      } else {
        // PORTFOLIO MODE: Apply same settings to all filtered locations/service lines
        let targetLocations = allLocations;
        if (filters?.locations && filters.locations.length > 0) {
          targetLocations = allLocations.filter(loc => filters.locations.includes(loc.name));
        }
        if (filters?.regions && filters.regions.length > 0) {
          targetLocations = targetLocations.filter(loc => loc.region && filters.regions.includes(loc.region));
        }
        if (filters?.divisions && filters.divisions.length > 0) {
          targetLocations = targetLocations.filter(loc => loc.division && filters.divisions.includes(loc.division));
        }
        
        // Determine which service lines to apply to
        const serviceLinesToApply = filters?.serviceLine && filters.serviceLine !== 'All' 
          ? [filters.serviceLine] 
          : ['AL', 'HC', 'IL', 'AL/MC', 'HC/MC', 'SL'];
        
        // Apply weights for each location/service line combination
        if (recommendations.weights) {
          const weights = recommendations.weights;
          for (const location of targetLocations) {
            for (const serviceLine of serviceLinesToApply) {
              await storage.createOrUpdateWeightsByFilter({
                occupancyPressure: weights.occupancyPressure,
                daysVacantDecay: weights.daysVacantDecay,
                competitorRates: weights.competitorRates,
                seasonality: weights.seasonality,
                stockMarket: weights.stockMarket,
                inquiryTourVolume: weights.inquiryTourVolume
              }, location.id, serviceLine);
              weightsUpdated++;
            }
          }
        }
        
        // Apply guardrails for each location/service line combination
        if (recommendations.guardrails) {
          const g = recommendations.guardrails;
          for (const location of targetLocations) {
            for (const serviceLine of serviceLinesToApply) {
              await storage.createOrUpdateGuardrailsByFilter({
                maxRateIncrease: g.maxIncreasePercent / 100,
                minRateDecrease: g.maxDecreasePercent / 100
              }, location.id, serviceLine);
              guardrailsUpdated++;
            }
          }
        }
        
        // Apply adjustment ranges for each location/service line combination
        if (recommendations.adjustmentRanges) {
          const ranges = recommendations.adjustmentRanges;
          for (const location of targetLocations) {
            for (const serviceLine of serviceLinesToApply) {
              await storage.createOrUpdateAdjustmentRangesByFilter({
                occupancyMin: ranges.occupancyMin,
                occupancyMax: ranges.occupancyMax,
                vacancyMin: ranges.vacancyMin,
                vacancyMax: ranges.vacancyMax,
                attributesMin: ranges.attributesMin,
                attributesMax: ranges.attributesMax,
                seasonalityMin: ranges.seasonalityMin,
                seasonalityMax: ranges.seasonalityMax,
                competitorMin: ranges.competitorMin,
                competitorMax: ranges.competitorMax
              }, location.id, serviceLine);
              adjustmentRangesUpdated++;
            }
          }
        }
        
        locationsAffected = targetLocations.length;
      }
      
      console.log(`[Apply Recommendations] Mode: ${mode}, Applied: ${weightsUpdated} weights, ${guardrailsUpdated} guardrails, ${adjustmentRangesUpdated} adjustment ranges`);
      
      res.json({ 
        success: true, 
        mode,
        weightsUpdated,
        guardrailsUpdated,
        adjustmentRangesUpdated,
        locationsAffected
      });
    } catch (error) {
      console.error('[Apply Recommendations] Error:', error);
      res.status(500).json({ error: 'Failed to apply AI recommendations' });
    }
  });

  // Save revenue growth targets by location and service line
  app.post("/api/pricing/targets/save", async (req, res) => {
    try {
      const { targets, filters } = req.body;
      
      console.log('[Save Targets] Starting with targets:', targets, 'filters:', filters);
      
      // Get all locations data
      const allLocations = await storage.getLocations();
      
      // Filter locations based on filters
      let targetLocations = allLocations;
      if (filters?.locations && filters.locations.length > 0) {
        targetLocations = allLocations.filter(loc => filters.locations.includes(loc.name));
      }
      if (filters?.regions && filters.regions.length > 0) {
        targetLocations = targetLocations.filter(loc => loc.region && filters.regions.includes(loc.region));
      }
      if (filters?.divisions && filters.divisions.length > 0) {
        targetLocations = targetLocations.filter(loc => loc.division && filters.divisions.includes(loc.division));
      }
      
      // Determine which service lines to save
      const serviceLinesToSave = filters?.serviceLine && filters.serviceLine !== 'All' 
        ? [filters.serviceLine] 
        : Object.keys(targets);
      
      // Build all target records for bulk insert
      const targetRecords: { locationId: string; serviceLine: string; targetGrowthPercent: number }[] = [];
      for (const location of targetLocations) {
        for (const serviceLine of serviceLinesToSave) {
          const targetPercent = parseFloat(targets[serviceLine] || '0');
          if (!isNaN(targetPercent)) {
            targetRecords.push({
              locationId: location.id,
              serviceLine,
              targetGrowthPercent: targetPercent
            });
          }
        }
      }
      
      // Bulk upsert all targets at once
      const savedCount = await storage.bulkUpsertRevenueGrowthTargets(targetRecords);
      
      console.log(`[Save Targets] Saved ${savedCount} targets across ${targetLocations.length} locations`);
      
      res.json({ 
        success: true, 
        savedCount,
        locationsAffected: targetLocations.length,
        serviceLines: serviceLinesToSave
      });
    } catch (error) {
      console.error('[Save Targets] Error:', error);
      res.status(500).json({ error: 'Failed to save revenue growth targets' });
    }
  });

  // Get revenue growth targets based on filters (with averaging for conflicts)
  app.get("/api/pricing/targets", async (req, res) => {
    try {
      const { serviceLine, regions, divisions, locations } = req.query;
      
      // Get all locations data
      const allLocations = await storage.getLocations();
      
      // Filter locations based on query params
      let targetLocations = allLocations;
      if (locations && typeof locations === 'string' && locations.length > 0) {
        const locationList = locations.split(',');
        targetLocations = allLocations.filter(loc => locationList.includes(loc.name));
      }
      if (regions && typeof regions === 'string' && regions.length > 0) {
        const regionList = regions.split(',');
        targetLocations = targetLocations.filter(loc => loc.region && regionList.includes(loc.region));
      }
      if (divisions && typeof divisions === 'string' && divisions.length > 0) {
        const divisionList = divisions.split(',');
        targetLocations = targetLocations.filter(loc => loc.division && divisionList.includes(loc.division));
      }
      
      // Get all saved targets
      const allTargets = await storage.getRevenueGrowthTargets();
      
      // Filter targets by matching locations
      const locationIds = new Set(targetLocations.map(loc => loc.id));
      const matchingTargets = allTargets.filter(t => t.locationId && locationIds.has(t.locationId));
      
      // Aggregate by service line (average if multiple locations have different values)
      const serviceLineAggregates: Record<string, { sum: number; count: number }> = {};
      
      for (const target of matchingTargets) {
        if (!serviceLineAggregates[target.serviceLine]) {
          serviceLineAggregates[target.serviceLine] = { sum: 0, count: 0 };
        }
        serviceLineAggregates[target.serviceLine].sum += target.targetGrowthPercent;
        serviceLineAggregates[target.serviceLine].count += 1;
      }
      
      // Calculate averages
      const targets: Record<string, string> = {};
      for (const [sl, agg] of Object.entries(serviceLineAggregates)) {
        const avg = agg.count > 0 ? agg.sum / agg.count : 0;
        targets[sl] = avg.toFixed(1);
      }
      
      res.json({ 
        targets,
        locationsMatched: targetLocations.length,
        hasData: Object.keys(targets).length > 0
      });
    } catch (error) {
      console.error('[Get Targets] Error:', error);
      res.status(500).json({ error: 'Failed to get revenue growth targets' });
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
  
  // Competitor Rate Comparison - Get competitor data by service line and room type with Trilogy comparison
  app.get("/api/competitor-rate-comparison", async (req: any, res) => {
    try {
      const { location, serviceLines } = req.query;
      const clientId = req.clientId || 'demo';
      
      if (!location) {
        return res.json({ data: [], trilogyRates: {} });
      }
      
      const locationName = location as string;
      const serviceLineFilter = serviceLines ? (Array.isArray(serviceLines) ? serviceLines : [serviceLines]) : [];
      
      // Map service lines to competitor types
      const SERVICE_LINE_TO_COMPETITOR_TYPE: Record<string, string> = {
        'HC': 'HC',
        'HC/MC': 'SMC',
        'AL': 'AL',
        'AL/MC': 'AL',  // AL/MC uses AL competitor data
        'SL': 'IL_IL',
        'VIL': 'IL_Villa'
      };
      
      // Get competitor types to query
      let competitorTypes: string[] = [];
      if (serviceLineFilter.length > 0) {
        competitorTypes = serviceLineFilter.map(sl => SERVICE_LINE_TO_COMPETITOR_TYPE[sl as string]).filter(Boolean);
      } else {
        competitorTypes = Object.values(SERVICE_LINE_TO_COMPETITOR_TYPE);
      }
      
      // Remove duplicates
      competitorTypes = [...new Set(competitorTypes)];
      
      // Fetch competitive survey data for this location
      const surveyData = await db.select()
        .from(competitiveSurveyData)
        .where(and(
          eq(competitiveSurveyData.keyStatsLocation, locationName),
          eq(competitiveSurveyData.clientId, clientId),
          competitorTypes.length > 0 ? inArray(competitiveSurveyData.competitorType, competitorTypes) : sql`1=1`
        ))
        .orderBy(competitiveSurveyData.competitorType, competitiveSurveyData.roomType, competitiveSurveyData.competitorName);
      
      // Get latest month for Trilogy rates
      const latestMonthData = await db.select({ uploadMonth: rentRollData.uploadMonth })
        .from(rentRollData)
        .orderBy(desc(rentRollData.uploadMonth))
        .limit(1);
      const latestMonth = latestMonthData.length > 0 ? latestMonthData[0].uploadMonth : null;
      
      // Get Trilogy's average rates by service line and room type for this location
      const trilogyRates: Record<string, Record<string, number>> = {};
      if (latestMonth) {
        const trilogyData = await db.select({
          serviceLine: rentRollData.serviceLine,
          roomType: rentRollData.roomType,
          avgRate: sql<number>`AVG(${rentRollData.streetRate})`
        })
          .from(rentRollData)
          .where(and(
            eq(rentRollData.uploadMonth, latestMonth),
            eq(rentRollData.location, locationName)
          ))
          .groupBy(rentRollData.serviceLine, rentRollData.roomType);
        
        for (const row of trilogyData) {
          if (!trilogyRates[row.serviceLine]) {
            trilogyRates[row.serviceLine] = {};
          }
          trilogyRates[row.serviceLine][row.roomType] = row.avgRate || 0;
        }
      }
      
      // Transform survey data with market position calculations
      const COMPETITOR_TYPE_TO_SERVICE_LINE: Record<string, string> = {
        'HC': 'HC',
        'SMC': 'HC/MC',
        'AL': 'AL',  // Note: AL serves both AL and AL/MC
        'IL_IL': 'SL',
        'IL_Villa': 'VIL'
      };
      
      // Convert daily rates to monthly for HC/SMC
      const DAYS_PER_MONTH = 30.44;
      
      const transformedData = surveyData.map(record => {
        const serviceLine = COMPETITOR_TYPE_TO_SERVICE_LINE[record.competitorType || ''] || record.competitorType;
        let baseRate = record.monthlyRateAvg || 0;
        let careLevel2 = record.careLevel2Rate || 0;
        let medMgmt = record.medicationManagementFee || 0;
        
        // Convert HC/SMC daily rates to monthly if they appear to be daily (< $1000)
        if ((record.competitorType === 'HC' || record.competitorType === 'SMC') && baseRate > 0 && baseRate < 1000) {
          baseRate = baseRate * DAYS_PER_MONTH;
          if (careLevel2 > 0 && careLevel2 < 500) careLevel2 = careLevel2 * DAYS_PER_MONTH;
          if (medMgmt > 0 && medMgmt < 100) medMgmt = medMgmt * DAYS_PER_MONTH;
        }
        
        const adjustedRate = baseRate + careLevel2 + medMgmt;
        
        // Get Trilogy rate for comparison
        const trilogyServiceLine = serviceLine === 'AL' ? 'AL' : serviceLine;
        const trilogyRate = trilogyRates[trilogyServiceLine]?.[record.roomType || ''] || 
                          trilogyRates[trilogyServiceLine]?.['Studio'] || 0;
        
        // Calculate market position (Trilogy rate / Competitor rate * 100)
        const marketPosition = adjustedRate > 0 ? Math.round((trilogyRate / adjustedRate) * 100) : 0;
        
        return {
          id: record.id,
          competitorName: record.competitorName,
          competitorType: record.competitorType,
          serviceLine,
          roomType: record.roomType,
          distanceMiles: record.distanceMiles,
          baseRate: Math.round(baseRate),
          careLevel2Adjustment: Math.round(careLevel2),
          medMgmtAdjustment: Math.round(medMgmt),
          adjustedRate: Math.round(adjustedRate),
          trilogyRate: Math.round(trilogyRate),
          marketPosition,
          occupancyRate: record.occupancyRate
        };
      });
      
      res.json({
        data: transformedData,
        trilogyRates,
        location: locationName
      });
    } catch (error) {
      console.error('Error fetching competitor rate comparison:', error);
      res.status(500).json({ error: 'Failed to fetch competitor rate comparison' });
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
      const { proposedRatings, filters } = req.body;
      const locations = filters?.locations || [];
      const serviceLine = filters?.serviceLine || "All";
      
      // Build query conditions based on filters
      const conditions = [];
      if (locations.length > 0) {
        conditions.push(inArray(rentRollData.location, locations));
      }
      if (serviceLine && serviceLine !== "All") {
        conditions.push(eq(rentRollData.serviceLine, serviceLine));
      }
      
      // Get units based on filters (limit to 500 for performance)
      let query = db.select().from(rentRollData);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      const sampleUnits = await query.limit(500);
      
      const previews: Array<{
        unitId: string;
        roomNumber: string;
        location: string;
        serviceLine: string;
        roomType: string;
        currentPrice: number;
        newPrice: number;
        change: number;
        changePercent: number;
      }> = [];
      
      // Track by service line
      const byServiceLine: Map<string, { count: number; totalChange: number }> = new Map();
      
      for (const unit of sampleUnits) {
        if (!unit.streetRate || unit.streetRate <= 0) continue;
        
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
              const currentAdj = attributePricingService.getAttributeAdjustmentPercent(attr, rating);
              proposedMultiplier += currentAdj / 100;
            }
          }
        }
        
        const proposedAttributedRate = unit.streetRate * proposedMultiplier;
        const change = proposedAttributedRate - currentAttributedRate;
        const changePercent = currentAttributedRate > 0 ? (change / currentAttributedRate) * 100 : 0;
        
        previews.push({
          unitId: unit.id,
          roomNumber: unit.roomNumber || '',
          location: unit.location || '',
          serviceLine: unit.serviceLine || '',
          roomType: unit.roomType || '',
          currentPrice: Math.round(currentAttributedRate),
          newPrice: Math.round(proposedAttributedRate),
          change: Math.round(change),
          changePercent
        });
        
        // Aggregate by service line
        const sl = unit.serviceLine || 'Unknown';
        if (!byServiceLine.has(sl)) {
          byServiceLine.set(sl, { count: 0, totalChange: 0 });
        }
        const slData = byServiceLine.get(sl)!;
        slData.count++;
        slData.totalChange += changePercent;
      }
      
      // Calculate summary statistics
      const totalChangeAmount = previews.reduce((sum, p) => sum + p.change, 0);
      const avgChangePercent = previews.length > 0 
        ? previews.reduce((sum, p) => sum + p.changePercent, 0) / previews.length 
        : 0;
      const affectedUnits = previews.filter(p => Math.abs(p.change) > 0).length;
      
      // Format by service line
      const byServiceLineArray = Array.from(byServiceLine.entries()).map(([sl, data]) => ({
        serviceLine: sl,
        count: data.count,
        avgChange: data.count > 0 ? data.totalChange / data.count : 0
      }));
      
      // Get top 10 changes (by absolute change amount)
      const topChanges = [...previews]
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
        .slice(0, 10);
      
      res.json({
        summary: {
          unitsAnalyzed: previews.length,
          avgChangePercent: Math.round(avgChangePercent * 100) / 100,
          totalChangeAmount: Math.round(totalChangeAmount),
          affectedUnits
        },
        byServiceLine: byServiceLineArray,
        topChanges
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
  
  // Get attribute configuration status - queries DB directly for accuracy
  app.get("/api/attribute-ratings/status", async (req, res) => {
    try {
      const clientId = (req as any).clientId || 'demo';

      const result = await db.execute(sql`
        SELECT
          COUNT(*) AS total_units,
          COUNT(CASE WHEN
            size_rating IS NOT NULL OR
            view_rating IS NOT NULL OR
            renovation_rating IS NOT NULL OR
            location_rating IS NOT NULL OR
            amenity_rating IS NOT NULL
          THEN 1 END) AS attributed_units,
          COUNT(DISTINCT location) AS total_locations,
          COUNT(DISTINCT CASE WHEN
            size_rating IS NOT NULL OR
            view_rating IS NOT NULL OR
            renovation_rating IS NOT NULL OR
            location_rating IS NOT NULL OR
            amenity_rating IS NOT NULL
          THEN location END) AS locations_with_attributes
        FROM rent_roll_data
        WHERE client_id = ${clientId}
          AND upload_month = (
            SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = ${clientId}
          )
      `);

      const row = result.rows[0] as Record<string, unknown>;
      const totalUnits = parseInt(String(row.total_units)) || 0;
      const attributedUnits = parseInt(String(row.attributed_units)) || 0;
      const totalLocations = parseInt(String(row.total_locations)) || 0;
      const locationsWithAttributes = parseInt(String(row.locations_with_attributes)) || 0;
      const overallCoverage = totalUnits > 0 ? Math.round(attributedUnits / totalUnits * 100) : 0;

      res.json({
        locations: [],
        summary: {
          totalLocations,
          locationsWithAttributes,
          totalUnits,
          attributedUnits,
          overallCoverage
        }
      });
    } catch (error) {
      console.error('Error getting attribute configuration status:', error);
      res.status(500).json({ error: 'Failed to get attribute configuration status' });
    }
  });
  
  // Room Type Base Prices endpoints
  app.get("/api/room-type-base-prices", async (req, res) => {
    try {
      const basePrices = await storage.getRoomTypeBasePrices();
      res.json(basePrices);
    } catch (error) {
      console.error('Error fetching room type base prices:', error);
      res.status(500).json({ error: 'Failed to fetch room type base prices' });
    }
  });

  app.put("/api/room-type-base-prices", async (req, res) => {
    try {
      const { roomType, basePrice } = req.body;
      if (!roomType || typeof roomType !== 'string') {
        return res.status(400).json({ error: 'roomType is required' });
      }
      if (typeof basePrice !== 'number' || basePrice < 0) {
        return res.status(400).json({ error: 'basePrice must be a non-negative number' });
      }
      const result = await storage.upsertRoomTypeBasePrice(roomType, basePrice);
      res.json(result);
    } catch (error) {
      console.error('Error upserting room type base price:', error);
      res.status(500).json({ error: 'Failed to save room type base price' });
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

  // Room Rate Adjustment (RRA) Analytics - T3 Discounts
  app.get("/api/analytics/rra", async (req: any, res) => {
    try {
      const { location, serviceLine } = req.query;
      const clientId = req.clientId || 'demo';
      
      // Get last 3 months of data
      const now = new Date();
      const months: string[] = [];
      for (let i = 0; i < 3; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
      }
      
      // Build where conditions
      const conditions: any[] = [
        inArray(rentRollData.uploadMonth, months),
        eq(rentRollData.occupiedYN, true),
        eq(rentRollData.clientId, clientId)
      ];
      
      if (location && location !== 'all') {
        conditions.push(eq(rentRollData.location, location as string));
      }
      if (serviceLine && serviceLine !== 'all') {
        conditions.push(eq(rentRollData.serviceLine, serviceLine as string));
      }
      
      // Query for RRA data aggregated by month, location, and service line
      const rraData = await db
        .select({
          month: rentRollData.uploadMonth,
          location: rentRollData.location,
          serviceLine: rentRollData.serviceLine,
          totalUnits: sql<number>`COUNT(*)::int`,
          unitsWithDiscount: sql<number>`SUM(CASE WHEN ${rentRollData.promotionAllowance} < 0 THEN 1 ELSE 0 END)::int`,
          totalDiscountAmount: sql<number>`ABS(SUM(COALESCE(${rentRollData.promotionAllowance}, 0)))`,
          avgDiscount: sql<number>`ABS(AVG(CASE WHEN ${rentRollData.promotionAllowance} < 0 THEN ${rentRollData.promotionAllowance} END))`,
          avgStreetRate: sql<number>`AVG(${rentRollData.streetRate})`,
          avgInHouseRate: sql<number>`AVG(${rentRollData.inHouseRate})`,
        })
        .from(rentRollData)
        .where(and(...conditions))
        .groupBy(rentRollData.uploadMonth, rentRollData.location, rentRollData.serviceLine);
      
      // Aggregate by service line for summary
      const byServiceLine: Record<string, {
        totalUnits: number;
        unitsWithDiscount: number;
        totalDiscountAmount: number;
        avgDiscount: number;
        discountRate: number;
      }> = {};
      
      // Aggregate by location for breakdown
      const byLocation: Record<string, {
        totalUnits: number;
        unitsWithDiscount: number;
        totalDiscountAmount: number;
        avgDiscount: number;
        discountRate: number;
      }> = {};
      
      // Monthly trend
      const monthlyTrend: Array<{
        month: string;
        discountRate: number;
        avgDiscount: number;
        totalDiscountAmount: number;
      }> = [];
      
      const monthlyAgg: Record<string, { units: number; withDiscount: number; totalAmount: number }> = {};
      
      for (const row of rraData) {
        const sl = row.serviceLine || 'Unknown';
        const loc = row.location || 'Unknown';
        const month = row.month;
        
        // By service line
        if (!byServiceLine[sl]) {
          byServiceLine[sl] = { totalUnits: 0, unitsWithDiscount: 0, totalDiscountAmount: 0, avgDiscount: 0, discountRate: 0 };
        }
        byServiceLine[sl].totalUnits += row.totalUnits || 0;
        byServiceLine[sl].unitsWithDiscount += row.unitsWithDiscount || 0;
        byServiceLine[sl].totalDiscountAmount += row.totalDiscountAmount || 0;
        
        // By location
        if (!byLocation[loc]) {
          byLocation[loc] = { totalUnits: 0, unitsWithDiscount: 0, totalDiscountAmount: 0, avgDiscount: 0, discountRate: 0 };
        }
        byLocation[loc].totalUnits += row.totalUnits || 0;
        byLocation[loc].unitsWithDiscount += row.unitsWithDiscount || 0;
        byLocation[loc].totalDiscountAmount += row.totalDiscountAmount || 0;
        
        // Monthly
        if (!monthlyAgg[month]) {
          monthlyAgg[month] = { units: 0, withDiscount: 0, totalAmount: 0 };
        }
        monthlyAgg[month].units += row.totalUnits || 0;
        monthlyAgg[month].withDiscount += row.unitsWithDiscount || 0;
        monthlyAgg[month].totalAmount += row.totalDiscountAmount || 0;
      }
      
      // Calculate averages and rates
      Object.values(byServiceLine).forEach(sl => {
        sl.discountRate = sl.totalUnits > 0 ? (sl.unitsWithDiscount / sl.totalUnits) * 100 : 0;
        sl.avgDiscount = sl.unitsWithDiscount > 0 ? sl.totalDiscountAmount / sl.unitsWithDiscount : 0;
      });
      
      Object.values(byLocation).forEach(loc => {
        loc.discountRate = loc.totalUnits > 0 ? (loc.unitsWithDiscount / loc.totalUnits) * 100 : 0;
        loc.avgDiscount = loc.unitsWithDiscount > 0 ? loc.totalDiscountAmount / loc.unitsWithDiscount : 0;
      });
      
      // Build monthly trend sorted by month
      Object.entries(monthlyAgg)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([month, data]) => {
          monthlyTrend.push({
            month,
            discountRate: data.units > 0 ? (data.withDiscount / data.units) * 100 : 0,
            avgDiscount: data.withDiscount > 0 ? data.totalAmount / data.withDiscount : 0,
            totalDiscountAmount: data.totalAmount,
          });
        });
      
      // Calculate T3 summary
      const t3TotalUnits = Object.values(byServiceLine).reduce((sum, sl) => sum + sl.totalUnits, 0);
      const t3UnitsWithDiscount = Object.values(byServiceLine).reduce((sum, sl) => sum + sl.unitsWithDiscount, 0);
      const t3TotalDiscountAmount = Object.values(byServiceLine).reduce((sum, sl) => sum + sl.totalDiscountAmount, 0);
      
      res.json({
        summary: {
          t3TotalUnits,
          t3UnitsWithDiscount,
          t3DiscountRate: t3TotalUnits > 0 ? (t3UnitsWithDiscount / t3TotalUnits) * 100 : 0,
          t3TotalDiscountAmount,
          t3AvgDiscount: t3UnitsWithDiscount > 0 ? t3TotalDiscountAmount / t3UnitsWithDiscount : 0,
        },
        byServiceLine,
        byLocation,
        monthlyTrend,
        months,
      });
    } catch (error) {
      console.error("Error fetching RRA analytics:", error);
      res.status(500).json({ error: "Failed to fetch RRA analytics" });
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
          promotionAllowance: -100
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
          promotionAllowance: -150
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
          promotionAllowance: -50
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
          promotionAllowance: -200
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
          promotionAllowance: -300
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
      
      if (preview) {
        try {
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

          const rawText = await callClaude(
            'You are a senior living pricing expert. Always respond with valid JSON.',
            prompt,
            { maxTokens: 500, label: 'pricing-rule-validation' }
          );

          const result = JSON.parse(rawText || '{}');
          reasonabilityCheck = {
            isReasonable: result.isReasonable !== false,
            explanation: result.explanation || reasonabilityCheck.explanation,
            suggestedAdjustment: result.suggestedAdjustment,
            risk: result.risk || "low"
          };
          
        } catch (error) {
          console.error('AI validation error:', error);
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
      const clientId = req.clientId || 'demo';

      // Get the latest upload month for this client
      const latestMonthResult = await db
        .select({ uploadMonth: rentRollData.uploadMonth })
        .from(rentRollData)
        .where(and(
          sql`${rentRollData.uploadMonth} IS NOT NULL`,
          eq(rentRollData.clientId, clientId)
        ))
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
        .where(and(
          eq(rentRollData.uploadMonth, latestMonth),
          eq(rentRollData.clientId, clientId)
        ));
      
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
  
  app.post("/api/import/competitive-survey", upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      const { surveyMonth } = req.body;
      if (!surveyMonth) {
        return res.status(400).json({ error: "Survey month is required" });
      }
      
      const clientId = req.clientId || 'demo';
      const { importCompetitiveSurveyExcel } = await import('./dataImport');
      
      const importStats = await importCompetitiveSurveyExcel(
        req.file.buffer,
        surveyMonth,
        clientId
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

  // GitHub Export Endpoints
  app.get("/api/github/user", async (req, res) => {
    try {
      const user = await getGitHubUser();
      res.json({ success: true, user });
    } catch (error: any) {
      console.error('Error getting GitHub user:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to get GitHub user' });
    }
  });

  app.get("/api/github/repositories", async (req, res) => {
    try {
      const repos = await listRepositories();
      res.json({ success: true, repositories: repos });
    } catch (error: any) {
      console.error('Error listing repositories:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to list repositories' });
    }
  });

  app.post("/api/github/create-repository", async (req, res) => {
    try {
      const { name, description, isPrivate } = req.body;
      
      if (!name) {
        return res.status(400).json({ success: false, error: 'Repository name is required' });
      }
      
      const repo = await createRepository(name, description || 'Modulo Revenue Management Dashboard', isPrivate !== false);
      res.json({ success: true, repository: repo });
    } catch (error: any) {
      console.error('Error creating repository:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to create repository' });
    }
  });

  app.get("/api/github/repository/:owner/:repo", async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const repository = await getRepository(owner, repo);
      
      if (!repository) {
        return res.status(404).json({ success: false, error: 'Repository not found' });
      }
      
      res.json({ success: true, repository });
    } catch (error: any) {
      console.error('Error getting repository:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to get repository' });
    }
  });

  // ==========================================
  // ML Learning API Endpoints
  // ==========================================
  
  // Get ML learning statistics for dashboard
  app.get("/api/ml/statistics", async (req, res) => {
    try {
      const { getMlStatistics } = await import('./services/mlTrainingService');
      const statistics = await getMlStatistics();
      res.json({ success: true, statistics });
    } catch (error) {
      console.error('Error fetching ML statistics:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch ML statistics' });
    }
  });
  
  // Get learned weights for a specific service line
  app.get("/api/ml/weights/:serviceLine", async (req, res) => {
    try {
      const { getLearnedWeightsForUnit } = await import('./services/mlTrainingService');
      const { serviceLine } = req.params;
      const weights = await getLearnedWeightsForUnit(null, serviceLine);
      res.json({ success: true, serviceLine, weights });
    } catch (error) {
      console.error('Error fetching learned weights:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch learned weights' });
    }
  });
  
  // Detect AI rate adoptions for a specific month
  app.post("/api/ml/detect-adoptions", async (req, res) => {
    try {
      const { detectAiRateAdoptions } = await import('./services/mlTrainingService');
      const { uploadMonth } = req.body;
      
      if (!uploadMonth || !/^\d{4}-\d{2}$/.test(uploadMonth)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid uploadMonth format. Expected YYYY-MM' 
        });
      }
      
      const adoptionsDetected = await detectAiRateAdoptions(uploadMonth);
      res.json({ 
        success: true, 
        uploadMonth, 
        adoptionsDetected,
        message: `Detected ${adoptionsDetected} AI rate adoptions` 
      });
    } catch (error) {
      console.error('Error detecting adoptions:', error);
      res.status(500).json({ success: false, error: 'Failed to detect adoptions' });
    }
  });
  
  // Update sale tracking for adopted AI rates
  app.post("/api/ml/update-sales", async (req, res) => {
    try {
      const { updateSaleTracking } = await import('./services/mlTrainingService');
      const salesTracked = await updateSaleTracking();
      res.json({ 
        success: true, 
        salesTracked,
        message: `Tracked ${salesTracked} sales within 30 days` 
      });
    } catch (error) {
      console.error('Error updating sale tracking:', error);
      res.status(500).json({ success: false, error: 'Failed to update sale tracking' });
    }
  });
  
  // Manually trigger ML training
  app.post("/api/ml/train", async (req, res) => {
    try {
      const { trainAndUpdateWeights } = await import('./services/mlTrainingService');
      const trainingType = req.body.trainingType || 'manual';
      
      if (!['scheduled', 'manual', 'triggered'].includes(trainingType)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid trainingType. Expected scheduled, manual, or triggered' 
        });
      }
      
      const result = await trainAndUpdateWeights(trainingType);
      res.json({ 
        success: result.success, 
        modelsUpdated: result.modelsUpdated,
        message: result.message 
      });
    } catch (error) {
      console.error('Error during ML training:', error);
      res.status(500).json({ success: false, error: 'Failed to train ML model' });
    }
  });
  
  // Get active weight versions for all service lines
  app.get("/api/ml/weight-versions", async (req, res) => {
    try {
      const { aiWeightVersions } = await import('@shared/schema');
      const versions = await db.select()
        .from(aiWeightVersions)
        .where(eq(aiWeightVersions.isActive, true))
        .orderBy(desc(aiWeightVersions.createdAt));
      
      res.json({ success: true, versions });
    } catch (error) {
      console.error('Error fetching weight versions:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch weight versions' });
    }
  });
  
  // Get training history
  app.get("/api/ml/training-history", async (req, res) => {
    try {
      const { mlTrainingHistory } = await import('@shared/schema');
      const limit = parseInt(req.query.limit as string) || 10;
      
      const history = await db.select()
        .from(mlTrainingHistory)
        .orderBy(desc(mlTrainingHistory.trainedAt))
        .limit(limit);
      
      res.json({ success: true, history });
    } catch (error) {
      console.error('Error fetching training history:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch training history' });
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
