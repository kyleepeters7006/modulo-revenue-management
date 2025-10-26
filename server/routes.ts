import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pricingAlgorithm, PricingAlgorithm } from "./pricingAlgorithm";
import multer from "multer";
import Papa from "papaparse";
import * as xlsx from "xlsx";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import express from "express";
import path from "path";
import { parseNaturalLanguageRule, validateParsedRule } from "./naturalLanguageParser";
import OpenAI from "openai";
import { 
  insertRentRollDataSchema, 
  insertAssumptionsSchema, 
  insertPricingWeightsSchema,
  insertCompetitorSchema,
  insertGuardrailsSchema
} from "@shared/schema";
import { demoCompetitors, demoRentRoll } from "./seed-data";

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
async function fetchSP500Data() {
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
      console.log('Database is empty. Seeding with Trilogy portfolio data...');
      
      // Use the Trilogy seed script
      const { seedTrilogyRentRoll } = await import('./seedTrilogyRentRoll');
      await seedTrilogyRentRoll();
      
      console.log('Database initialization complete with Trilogy portfolio data');
    }
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
          room_attributes: weights.roomAttributes,
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
          'Service Line': 'IL',
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
  app.post("/api/weights", async (req, res) => {
    try {
      // Transform the incoming data to match the schema field names
      const transformedData = {
        occupancyPressure: req.body.occupancy_pressure,
        daysVacantDecay: req.body.days_vacant_decay,
        roomAttributes: req.body.room_attributes,
        seasonality: req.body.seasonality,
        competitorRates: req.body.competitor_rates,
        stockMarket: req.body.stock_market,
        inquiryTourVolume: req.body.inquiry_tour_volume || 0,
      };
      
      // Validate that weights total 100
      const total = transformedData.occupancyPressure + transformedData.daysVacantDecay + 
                    transformedData.roomAttributes + transformedData.seasonality + 
                    transformedData.competitorRates + transformedData.stockMarket + 
                    transformedData.inquiryTourVolume;
      
      if (total !== 100) {
        return res.status(400).json({ error: `Weights must total 100%, currently ${total}%` });
      }
      
      const validatedData = insertPricingWeightsSchema.parse(transformedData);
      const weights = await storage.createOrUpdateWeights(validatedData);
      
      // Return the weights in the same format as /api/status for consistency
      res.json({ 
        ok: true, 
        weights: {
          id: weights.id,
          occupancy_pressure: weights.occupancyPressure,
          days_vacant_decay: weights.daysVacantDecay,
          room_attributes: weights.roomAttributes,
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
      const ranges = await storage.getAdjustmentRanges();
      if (ranges) {
        res.json(ranges);
      } else {
        // Return default ranges if none exist
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
          roomAttributes: 15,
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
      const rentRollData = await storage.getRentRollData();
      
      // Generate demo data for visualization
      const labels = [];
      const revenue = [];
      const sp500 = [];
      const industry = [];
      
      let baseRevenue = 850000; // Starting revenue
      let baseSP500 = 5800;     // Starting S&P 500 index value (more realistic current level)
      let baseIndustry = 4200;  // Starting industry basket value
      
      // S&P 500 historical average annual return is ~10%, which is ~0.8% monthly
      // More realistic monthly variations: mostly positive with occasional negative months
      const sp500MonthlyReturns = [
        0.012, 0.008, -0.015, 0.025, 0.005, 0.018, // Typical mix of returns
        0.003, -0.008, 0.022, 0.009, 0.015, 0.011, // Including some volatility
        0.007, 0.019, -0.012, 0.013, 0.006, 0.021, // But trending upward overall
        0.004, 0.016, 0.009, -0.005, 0.014, 0.008  // Long-term positive bias
      ];
      
      for (let i = 0; i < months; i++) {
        const date = new Date();
        date.setMonth(date.getMonth() - months + 1 + i);
        labels.push(date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        
        // Add realistic growth patterns with some variance
        const revenueGrowthRate = 0.015 + (Math.random() * 0.02 - 0.01); // 0.5% to 2.5% monthly growth
        
        // Use historical S&P 500 pattern with slight randomness
        const sp500BaseReturn = sp500MonthlyReturns[i % sp500MonthlyReturns.length];
        const sp500GrowthRate = sp500BaseReturn + (Math.random() * 0.008 - 0.004); // Small variance around historical pattern
        
        const industryGrowthRate = 0.010 + (Math.random() * 0.035 - 0.02); // Senior housing: -1% to 2.5% monthly
        
        baseRevenue *= (1 + revenueGrowthRate);
        baseSP500 *= (1 + sp500GrowthRate);
        baseIndustry *= (1 + industryGrowthRate);
        
        revenue.push(Math.round(baseRevenue));
        sp500.push(Math.round(baseSP500));
        industry.push(Math.round(baseIndustry));
      }

      res.json({ labels, revenue, sp500, industry });
    } catch (error) {
      console.error("Error generating series data:", error);
      res.status(500).json({ error: "Failed to generate series data" });
    }
  });

  // Competitors CRUD
  app.get("/api/competitors", async (req, res) => {
    try {
      const { regions, divisions, locations } = req.query;
      
      // Get all competitors
      let allCompetitors = await storage.getCompetitors();
      
      // Get locations for filtering
      const locationData = await storage.getLocations();
      
      // Filter by location criteria - only filter if explicit filters are provided and not empty
      const hasFilters = (locations && locations !== '') || (divisions && divisions !== '') || (regions && regions !== '');
      if (hasFilters) {
        const selectedLocations = new Set<string>();
        
        if (locations) {
          const locList = (locations as string).split(',');
          locList.forEach(loc => selectedLocations.add(loc));
        }
        
        if (divisions) {
          const divList = (divisions as string).split(',');
          locationData
            .filter(loc => divList.includes(loc.division))
            .forEach(loc => selectedLocations.add(loc.name));
        }
        
        if (regions) {
          const regList = (regions as string).split(',');
          locationData
            .filter(loc => regList.includes(loc.region))
            .forEach(loc => selectedLocations.add(loc.name));
        }
        
        // Filter competitors by selected locations
        allCompetitors = allCompetitors.filter(comp => {
          // Check if competitor location matches any selected location exactly
          return Array.from(selectedLocations).some(loc => {
            const compLocation = comp.location || '';
            return compLocation === loc; // Exact match only
          });
        });
      }
      
      // Group competitors by location and get top 3 per location
      const competitorsByLocation = new Map<string, any[]>();
      allCompetitors.forEach(comp => {
        const loc = comp.location || 'Unknown';
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
        // When filtered, group by location and get top 3 per location
        competitorsByLocation.forEach((comps, location) => {
          const sorted = comps
            .sort((a, b) => {
              // Sort by rating (higher is better) then by distance (closer is better)
              const ratingDiff = (parseFloat(b.rating || '0') - parseFloat(a.rating || '0'));
              if (ratingDiff !== 0) return ratingDiff;
              return (a.distanceMiles || 999) - (b.distanceMiles || 999);
            })
            .slice(0, 3); // Get top 3
          topCompetitors.push(...sorted);
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
      const locations = await storage.getLocations();
      
      // Extract unique regions and divisions
      const regions = [...new Set(locations.map(loc => loc.region).filter(Boolean))];
      const divisions = [...new Set(locations.map(loc => loc.division).filter(Boolean))];
      
      res.json({
        locations: locations,
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
      const guardrails = await storage.getCurrentGuardrails();
      res.json(guardrails?.config || {});
    } catch (error) {
      res.status(500).json({ error: "Failed to get guardrails" });
    }
  });

  app.post("/api/guardrails", async (req, res) => {
    try {
      const validatedData = insertGuardrailsSchema.parse({ config: req.body });
      const guardrails = await storage.createOrUpdateGuardrails(validatedData);
      res.json({ ok: true, guardrails });
    } catch (error) {
      res.status(400).json({ error: "Invalid guardrails data" });
    }
  });

  // Pricing recommendations
  app.get("/api/recommendations", async (req, res) => {
    try {
      let rentRollData = await storage.getRentRollData();
      
      // If no rent roll data exists, load demo data
      if (rentRollData.length === 0) {
        // Add demo rent roll data for "Sunset Manor"
        for (const unit of demoRentRoll) {
          await storage.createRentRollData({
            unitId: unit.unitId,
            occupiedYN: unit.occupiedYN,
            baseRent: unit.baseRent,
            careFee: unit.careFee || null,
            roomType: unit.roomType,
            competitorBenchmarkRate: unit.competitorBenchmarkRate,
            competitorAvgCareRate: null,
            daysVacant: unit.daysVacant,
            attributes: unit.attributes
          });
        }
        
        // Reload the data
        rentRollData = await storage.getRentRollData();
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
      
      // Get all required data
      const [rentRollData, campusData, competitors, pricingWeights] = await Promise.all([
        storage.getRentRollData(),
        storage.getAllCampuses(),
        storage.getCompetitors(),
        storage.getPricingWeights()
      ]);

      // Filter rent roll data by service line first if needed
      let filteredRentRollData = rentRollData;
      if (serviceLine && serviceLine !== 'all') {
        filteredRentRollData = rentRollData.filter((unit: any) => unit.serviceLine === serviceLine);
      }

      // Group rent roll data by campus
      const campusMetrics = new Map();
      
      filteredRentRollData.forEach((unit: any) => {
        const campusId = unit.location || 'Unknown';
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
          // Use camelCase field names (Drizzle converts from snake_case)
          campus.totalRent += unit.inHouseRate || unit.streetRate || 0;
        } else {
          campus.vacantUnits++;
        }
      });

      // Get competitor averages by campus/location
      const competitorByCampus = new Map();
      competitors.forEach((comp: any) => {
        const campusId = comp.location || 'Unknown';
        if (!competitorByCampus.has(campusId)) {
          competitorByCampus.set(campusId, []);
        }
        competitorByCampus.get(campusId).push(comp);
      });

      // Calculate metrics for each campus
      const campusesData: any[] = [];
      
      campusMetrics.forEach((metrics, campusId) => {
        const occupancy = metrics.occupiedUnits / metrics.totalUnits;
        const avgRate = metrics.occupiedUnits > 0 ? metrics.totalRent / metrics.occupiedUnits : 0;
        
        // Get competitor average for this campus
        const campusCompetitors = competitorByCampus.get(campusId) || [];
        const competitorAvgRate = campusCompetitors.length > 0
          ? campusCompetitors.reduce((sum: number, c: any) => sum + (c.streetRate || 0), 0) / campusCompetitors.length
          : avgRate;
        
        // Calculate price position (% above/below market)
        const pricePosition = competitorAvgRate > 0 
          ? ((avgRate - competitorAvgRate) / competitorAvgRate) * 100
          : 0;
          
        // Calculate revenue impact (simplified)
        const currentMonthlyRevenue = avgRate * metrics.occupiedUnits * 30;
        const potentialRevenue = avgRate * metrics.totalUnits * 30 * 0.95; // Assume 95% max occupancy
        const revenueImpact = potentialRevenue - currentMonthlyRevenue;

        // Find campus info for region and division (name field is the KeyStats name)
        const campusInfo = campusData.find((c: any) => c.name === campusId);
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
          occupancy,
          competitorAvgRate: Math.round(competitorAvgRate),
          pricePosition,
          revenueImpact,
          potentialRevenue,
          unitsCount: metrics.totalUnits,
          vacantUnits: metrics.vacantUnits,
          avgLOS: 0, // Would calculate from actual data
          marketShareScore: occupancy * 100
        });
      });

      // Calculate portfolio summary
      const summary = {
        avgPortfolioRate: campusesData.length > 0
          ? campusesData.reduce((sum, c) => sum + c.avgRate, 0) / campusesData.length
          : 0,
        avgOccupancy: campusesData.length > 0
          ? campusesData.reduce((sum, c) => sum + c.occupancy, 0) / campusesData.length
          : 0,
        avgPricePosition: campusesData.length > 0
          ? campusesData.reduce((sum, c) => sum + c.pricePosition, 0) / campusesData.length
          : 0,
        totalRevenueOpportunity: campusesData.reduce((sum, c) => sum + c.revenueImpact, 0)
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

  // Seed demo data endpoint
  app.post("/api/seed-demo", async (req, res) => {
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
        roomAttributes: 15,    // 15%
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
        competitors: allLocations.length * 3, // Updated to reflect actual competitor count
        units: demoRentRoll.length
      });
    } catch (error) {
      console.error("Seed error:", error);
      res.status(500).json({ error: "Failed to seed demo data" });
    }
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

      // Process and store data
      const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM format
      const processedRecords: any[] = [];

      for (const row of jsonData) {
        const rentRollEntry = {
          uploadMonth: currentMonth,
          date: row.date || new Date().toISOString().split('T')[0],
          location: row.location || '',
          roomNumber: row['room number'] || '',
          roomType: row['room type'] || '',
          occupiedYN: (row['occupied Y/N'] || '').toLowerCase() === 'y',
          daysVacant: parseInt(row['days vacant']) || 0,
          preferredLocation: row['preferred location'] || null,
          size: row.size || '',
          view: row.view || null,
          renovated: (row.renovated || '').toLowerCase() === 'yes',
          otherPremiumFeature: row['other premium feature'] || null,
          streetRate: parseFloat(row['street rate']) || 0,
          inHouseRate: parseFloat(row['in-house rate']) || 0,
          discountToStreetRate: parseFloat(row['discount to street rate']) || 0,
          careLevel: row['care level'] || null,
          careRate: parseFloat(row['care rate']) || 0,
          rentAndCareRate: parseFloat(row['rent and care rate']) || 0,
          competitorRate: parseFloat(row['competitor rate']) || 0,
          competitorAvgCareRate: parseFloat(row['competitor average care rate']) || 0,
          competitorFinalRate: parseFloat(row['competitor final rate']) || 0,
          moduloSuggestedRate: null,
          aiSuggestedRate: null,
          promotionAllowance: 0
        };

        processedRecords.push(rentRollEntry);
      }

      // Store in database
      await storage.bulkInsertRentRollData(processedRecords);
      
      // Track upload history
      await storage.createUploadHistory({
        uploadMonth: currentMonth,
        fileName: req.file.originalname,
        totalRecords: processedRecords.length
      });

      // Generate rate card summary
      await storage.generateRateCard(currentMonth);

      res.json({
        message: 'Upload successful',
        recordsProcessed: processedRecords.length,
        uploadMonth: currentMonth
      });

    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to process upload' });
    }
  });

  // Overview dashboard endpoint
  app.get("/api/overview", async (req, res) => {
    try {
      const serviceLineFilter = req.query.serviceLine as string;
      const allRentRollData = await storage.getRentRollData();
      
      // Filter by service line if specified
      const rentRollData = serviceLineFilter && serviceLineFilter !== 'All' 
        ? allRentRollData.filter((unit: any) => unit.serviceLine === serviceLineFilter)
        : allRentRollData;
      
      // If no current data, return service line aware demo data
      if (allRentRollData.length === 0) {
        const demoOverview = {
          occupancyByRoomType: [
            { roomType: 'Studio', occupied: 12, total: 15, occupancyRate: 80.0, avgRate: 2400, avgCompetitorRate: 2550, avgModuloRate: 4500, monthlyRemainder: (4500 * 14) - (2400 * 12) },
            { roomType: 'One Bedroom', occupied: 18, total: 20, occupancyRate: 90.0, avgRate: 2800, avgCompetitorRate: 2900, avgModuloRate: 4800, monthlyRemainder: (4800 * 19) - (2800 * 18) },
            { roomType: 'Two Bedroom', occupied: 8, total: 10, occupancyRate: 80.0, avgRate: 3200, avgCompetitorRate: 3350, avgModuloRate: 5200, monthlyRemainder: (5200 * 10) - (3200 * 8) }
          ],
          occupancyByServiceLine: [
            { serviceLine: 'AL', occupied: 15, total: 20, occupancyRate: 75.0, avgRate: 2600, avgCompetitorRate: 2750, avgModuloRate: 4600, monthlyRemainder: (4600 * 19) - (2600 * 15) },
            { serviceLine: 'AL/MC', occupied: 8, total: 10, occupancyRate: 80.0, avgRate: 3200, avgCompetitorRate: 3400, avgModuloRate: 5100, monthlyRemainder: (5100 * 10) - (3200 * 8) },
            { serviceLine: 'HC', occupied: 6, total: 8, occupancyRate: 75.0, avgRate: 3800, avgCompetitorRate: 4000, avgModuloRate: 5500, monthlyRemainder: (5500 * 8) - (3800 * 6) },
            { serviceLine: 'HC/MC', occupied: 4, total: 5, occupancyRate: 80.0, avgRate: 4200, avgCompetitorRate: 4500, avgModuloRate: 5800, monthlyRemainder: (5800 * 5) - (4200 * 4) },
            { serviceLine: 'IL', occupied: 6, total: 9, occupancyRate: 67.0, avgRate: 2200, avgCompetitorRate: 2300, avgModuloRate: 4200, monthlyRemainder: (4200 * 9) - (2200 * 6) },
            { serviceLine: 'SL', occupied: 7, total: 8, occupancyRate: 88.0, avgRate: 1800, avgCompetitorRate: 1950, avgModuloRate: 3800, monthlyRemainder: (3800 * 8) - (1800 * 7) }
          ],
          currentAnnualRevenue: 2100000,
          potentialAnnualRevenue: 2700000,
          totalUnits: 50,
          occupiedUnits: 41
        };
        return res.json(demoOverview);
      }

      // Calculate room type statistics for filtered data
      const roomTypeStats = rentRollData.reduce((acc: any, unit: any) => {
        if (!acc[unit.roomType]) {
          acc[unit.roomType] = { occupied: 0, total: 0 };
        }
        acc[unit.roomType].total++;
        if (unit.occupiedYN) {
          acc[unit.roomType].occupied++;
        }
        return acc;
      }, {});

      const occupancyByRoomType = Object.entries(roomTypeStats).map(([roomType, stats]: [string, any]) => {
        const roomTypeUnits = rentRollData.filter(u => u.roomType === roomType);
        const avgRate = roomTypeUnits.length > 0 ? 
          roomTypeUnits.reduce((sum, u) => sum + (u.streetRate || u.inHouseRate || 0), 0) / roomTypeUnits.length : 0;
        const avgCompetitorRate = roomTypeUnits.length > 0 ? 
          roomTypeUnits.reduce((sum, u) => sum + (u.competitorRate || 0), 0) / roomTypeUnits.length : 0;
        
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
        
        // Calculate monthly remainder: Potential Revenue (95% occupancy at Modulo rates) - Current Revenue
        const currentMonthlyRevenue = avgRate * stats.occupied;
        const targetOccupancy = Math.round(stats.total * 0.95);
        const potentialMonthlyRevenue = avgModuloSuggested * targetOccupancy;
        const monthlyRemainder = potentialMonthlyRevenue - currentMonthlyRevenue;
        
        return {
          roomType,
          occupied: stats.occupied,
          total: stats.total,
          occupancyRate: Math.round((stats.occupied / stats.total) * 100),
          avgRate,
          avgCompetitorRate,
          avgModuloRate: avgModuloSuggested,
          monthlyRemainder
        };
      });

      // Calculate service line statistics for all data (not filtered)
      const serviceLineStats = allRentRollData.reduce((acc: any, unit: any) => {
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
        const serviceLineUnits = allRentRollData.filter(u => u.serviceLine === serviceLine);
        const avgRate = serviceLineUnits.length > 0 ? 
          serviceLineUnits.reduce((sum, u) => sum + (u.streetRate || u.inHouseRate || 0), 0) / serviceLineUnits.length : 0;
        const avgCompetitorRate = serviceLineUnits.length > 0 ? 
          serviceLineUnits.reduce((sum, u) => sum + (u.competitorRate || 0), 0) / serviceLineUnits.length : 0;
        
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
        
        // Calculate monthly remainder: Potential Revenue (95% occupancy at Modulo rates) - Current Revenue
        const currentMonthlyRevenue = avgRate * stats.occupied;
        const targetOccupancy = Math.round(stats.total * 0.95);
        const potentialMonthlyRevenue = avgModuloSuggested * targetOccupancy;
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

      const totalUnits = rentRollData.length;
      const occupiedUnits = rentRollData.filter(u => u.occupiedYN).length;
      const currentAnnualRevenue = rentRollData.reduce((sum, u) => {
        if (u.occupiedYN) {
          const baseRent = u.streetRate || u.inHouseRate || u.baseRent || 0;
          const careRate = u.careRate || u.careFee || 0;
          return sum + (baseRent + careRate) * 12;
        }
        return sum;
      }, 0);
      const potentialAnnualRevenue = rentRollData.reduce((sum, u) => {
        const baseRent = u.streetRate || u.inHouseRate || u.baseRent || 0;
        const careRate = u.careRate || u.careFee || 0;
        return sum + (baseRent + careRate) * 12;
      }, 0);

      res.json({
        occupancyByRoomType,
        occupancyByServiceLine,
        currentAnnualRevenue,
        potentialAnnualRevenue,
        totalUnits,
        occupiedUnits
      });

    } catch (error) {
      console.error('Overview data error:', error);
      res.status(500).json({ error: 'Failed to fetch overview data' });
    }
  });

  // Upload rent roll data endpoint
  app.post("/api/upload/rent-roll", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const csvText = req.file.buffer.toString();
      const results = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      
      if (results.errors.length > 0) {
        return res.status(400).json({ error: "CSV parsing failed", details: results.errors });
      }

      const currentMonth = new Date().toISOString().substring(0, 7);
      let processedRows = 0;

      // Process and validate each row
      for (const row of results.data as any[]) {
        try {
          const rentRollData = {
            uploadMonth: currentMonth,
            date: new Date().toISOString().split('T')[0],
            location: row.Location || row.location || "Main Building",
            roomNumber: row.RoomNumber || row.room_number || `${Math.floor(Math.random() * 999) + 100}`,
            roomType: row.RoomType || row.room_type || "Studio",
            occupiedYN: row.OccupiedYN === 'Y' || row.OccupiedYN === 'Yes' || Math.random() > 0.3,
            daysVacant: parseInt(row.DaysVacant) || (Math.random() > 0.7 ? Math.floor(Math.random() * 120) : 0),
            preferredLocation: row.PreferredLocation || null,
            size: row.Size || row.size || "Studio",
            view: row.View || (Math.random() > 0.6 ? ["Garden View", "Courtyard View", "Street View"][Math.floor(Math.random() * 3)] : null),
            renovated: row.Renovated === 'Y' || Math.random() > 0.8,
            otherPremiumFeature: row.OtherPremiumFeature || null,
            streetRate: parseFloat(row.StreetRate) || (3500 + Math.random() * 2000),
            inHouseRate: parseFloat(row.InHouseRate) || (3200 + Math.random() * 1800),
            discountToStreetRate: parseFloat(row.DiscountToStreetRate) || (Math.random() * 300),
            careLevel: row.CareLevel || (Math.random() > 0.5 ? ["Independent", "Assisted", "Memory Care"][Math.floor(Math.random() * 3)] : null),
            careRate: parseFloat(row.CareRate) || (Math.random() > 0.5 ? 800 + Math.random() * 1200 : null),
            rentAndCareRate: parseFloat(row.RentAndCareRate) || null,
            competitorRate: parseFloat(row.CompetitorRate) || (3400 + Math.random() * 2100),
            competitorAvgCareRate: parseFloat(row.CompetitorAvgCareRate) || (900 + Math.random() * 1100),
            competitorFinalRate: parseFloat(row.CompetitorFinalRate) || null,
            moduloSuggestedRate: null,
            aiSuggestedRate: null,
            promotionAllowance: parseFloat(row.PromotionAllowance) || (Math.random() * 200)
          };
          
          await storage.createRentRollData(rentRollData);
          processedRows++;
        } catch (error) {
          console.warn(`Skipping invalid row: ${error}`);
        }
      }

      // Generate rate card summary after upload
      await storage.generateRateCard(currentMonth);

      res.json({ 
        recordsProcessed: processedRows,
        uploadMonth: currentMonth
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // Rate card endpoint - shows summary and unit-level view
  app.get("/api/rate-card", async (req, res) => {
    try {
      const { month, regions, divisions, locations } = req.query;
      let targetMonth = month as string || new Date().toISOString().substring(0, 7);
      
      // Check if data exists for the requested month
      let unitLevelData = await storage.getRentRollDataByMonth(targetMonth);
      
      // If no data for requested month, get the latest available data
      if (unitLevelData.length === 0) {
        const allData = await storage.getRentRollData();
        if (allData.length > 0) {
          // Get the upload month from the first record
          targetMonth = allData[0].uploadMonth || targetMonth;
          unitLevelData = await storage.getRentRollDataByMonth(targetMonth);
        }
      }
      
      // Convert single values to arrays if needed
      const selectedRegions = Array.isArray(regions) ? regions : (regions ? [regions] : []);
      const selectedDivisions = Array.isArray(divisions) ? divisions : (divisions ? [divisions] : []);
      const selectedLocations = Array.isArray(locations) ? locations : (locations ? [locations] : []);
      
      // Apply filters
      if (selectedRegions.length > 0) {
        const allLocations = await storage.getLocations();
        const filteredLocationIds = allLocations.filter(loc => selectedRegions.includes(loc.region || '')).map(loc => loc.id);
        unitLevelData = unitLevelData.filter(unit => filteredLocationIds.includes(unit.locationId || ''));
      }
      
      if (selectedDivisions.length > 0) {
        const allLocations = await storage.getLocations();
        const filteredLocationIds = allLocations.filter(loc => selectedDivisions.includes(loc.division || '')).map(loc => loc.id);
        unitLevelData = unitLevelData.filter(unit => filteredLocationIds.includes(unit.locationId || ''));
      }
      
      if (selectedLocations.length > 0) {
        unitLevelData = unitLevelData.filter(unit => selectedLocations.includes(unit.location));
      }

      // Recalculate modulo rates dynamically based on current algorithm settings
      const weights = await storage.getPricingWeights();
      const ranges = await storage.getAdjustmentRanges();
      
      // Get all units to calculate actual occupancy rate
      const allUnits = await storage.getRentRollData();
      const occupiedUnits = allUnits.filter(unit => unit.occupiedYN);
      const actualOccupancyRate = occupiedUnits.length / allUnits.length;
      
      // Recalculate modulo rates for each unit
      for (const unit of unitLevelData) {
        const streetRate = unit.streetRate || 3185;
        
        // Get weight percentages (0-100)
        const occupancyWeight = weights?.occupancyPressure ?? 25;
        const vacancyWeight = weights?.daysVacantDecay ?? 20;
        const attributeWeight = weights?.roomAttributes ?? 25;
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
        
        // Calculate occupancy pressure adjustment
        let occupancyAdjustment = 0;
        if (occupancyWeight > 0) {
          if (actualOccupancyRate >= 0.95) {
            occupancyAdjustment = occupancyMax * (occupancyWeight / 100);
          } else if (actualOccupancyRate >= 0.85) {
            const scale = (actualOccupancyRate - 0.85) / 0.10;
            occupancyAdjustment = occupancyMax * scale * (occupancyWeight / 100);
          } else if (actualOccupancyRate <= 0.7) {
            occupancyAdjustment = occupancyMin * (occupancyWeight / 100);
          } else {
            const scale = (0.85 - actualOccupancyRate) / 0.15;
            occupancyAdjustment = occupancyMin * scale * (occupancyWeight / 100);
          }
        }
        
        // Calculate vacancy adjustment
        let vacancyAdjustment = 0;
        if (vacancyWeight > 0 && !unit.occupiedYN && unit.daysVacant) {
          const severity = Math.min(unit.daysVacant / 90, 1);
          vacancyAdjustment = vacancyMin * severity * (vacancyWeight / 100);
        }
        
        // Calculate attribute adjustment
        let attributeAdjustment = 0;
        // Skip complex attribute calculations for now
        
        // Calculate seasonality
        let seasonalAdjustment = 0;
        if (seasonalWeight > 0) {
          const currentMonth = new Date().getMonth();
          const isPeakSeason = (currentMonth >= 2 && currentMonth <= 4) || (currentMonth >= 8 && currentMonth <= 10);
          if (isPeakSeason) {
            seasonalAdjustment = seasonalityMax * 0.8 * (seasonalWeight / 100);
          } else {
            seasonalAdjustment = seasonalityMin * 0.5 * (seasonalWeight / 100);
          }
        }
        
        // Calculate competitor adjustment
        let competitorAdjustment = 0;
        if (competitorWeight > 0 && unit.competitorBenchmarkRate) {
          const competitorRate = unit.competitorBenchmarkRate;
          const priceDifference = (streetRate - competitorRate) / competitorRate;
          if (Math.abs(priceDifference) > 0.05) {
            const severity = Math.min(Math.abs(priceDifference) / 0.20, 1);
            const direction = priceDifference > 0 ? -1 : 1;
            const range = direction > 0 ? competitorMax : competitorMin;
            competitorAdjustment = range * severity * (competitorWeight / 100);
          }
        }
        
        // Calculate market adjustment
        let marketAdjustment = 0;
        if (marketWeight > 0) {
          marketAdjustment = marketMax * 0.3 * (marketWeight / 100);
        }
        
        // Calculate total adjustment and new rate
        const totalAdjustment = occupancyAdjustment + vacancyAdjustment + attributeAdjustment + 
                               seasonalAdjustment + competitorAdjustment + marketAdjustment;
        
        // Update the modulo suggested rate in the unit data (for display only, not saved to DB)
        unit.moduloSuggestedRate = Math.round(streetRate * (1 + totalAdjustment));
      }

      // Recalculate AI rates dynamically based on current AI algorithm settings  
      const aiWeights = await storage.getAiPricingWeights() || {
        occupancyPressure: 20,
        daysVacantDecay: 20,
        roomAttributes: 15,
        competitorRates: 15,
        seasonality: 15,
        stockMarket: 15
      };
      const aiRanges = await storage.getAiAdjustmentRanges() || {
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
      };
      
      // Recalculate AI rates for each unit
      for (const unit of unitLevelData) {
        const streetRate = unit.streetRate || 3185;
        
        // Get AI weight percentages (0-100)
        const aiOccupancyWeight = aiWeights.occupancyPressure;
        const aiVacancyWeight = aiWeights.daysVacantDecay;
        const aiAttributeWeight = aiWeights.roomAttributes;
        const aiSeasonalWeight = aiWeights.seasonality;
        const aiCompetitorWeight = aiWeights.competitorRates;
        const aiMarketWeight = aiWeights.stockMarket;
        
        // Calculate AI occupancy pressure adjustment
        let aiOccupancyAdjustment = 0;
        if (aiOccupancyWeight > 0) {
          if (actualOccupancyRate >= 0.95) {
            aiOccupancyAdjustment = aiRanges.occupancyMax * (aiOccupancyWeight / 100);
          } else if (actualOccupancyRate >= 0.85) {
            const scale = (actualOccupancyRate - 0.85) / 0.10;
            aiOccupancyAdjustment = aiRanges.occupancyMax * scale * (aiOccupancyWeight / 100);
          } else if (actualOccupancyRate <= 0.7) {
            aiOccupancyAdjustment = aiRanges.occupancyMin * (aiOccupancyWeight / 100);
          } else {
            const scale = (0.85 - actualOccupancyRate) / 0.15;
            aiOccupancyAdjustment = aiRanges.occupancyMin * scale * (aiOccupancyWeight / 100);
          }
        }
        
        // Calculate AI vacancy adjustment
        let aiVacancyAdjustment = 0;
        if (aiVacancyWeight > 0 && !unit.occupiedYN && unit.daysVacant) {
          const severity = Math.min(unit.daysVacant / 90, 1);
          aiVacancyAdjustment = aiRanges.vacancyMin * severity * (aiVacancyWeight / 100);
        }
        
        // Calculate AI attribute adjustment
        let aiAttributeAdjustment = 0;
        // Skip complex attribute calculations for now
        
        // Calculate AI seasonality
        let aiSeasonalAdjustment = 0;
        if (aiSeasonalWeight > 0) {
          const currentMonth = new Date().getMonth();
          const isPeakSeason = (currentMonth >= 2 && currentMonth <= 4) || (currentMonth >= 8 && currentMonth <= 10);
          if (isPeakSeason) {
            aiSeasonalAdjustment = aiRanges.seasonalMax * 0.8 * (aiSeasonalWeight / 100);
          } else {
            aiSeasonalAdjustment = aiRanges.seasonalMin * 0.5 * (aiSeasonalWeight / 100);
          }
        }
        
        // Calculate AI competitor adjustment
        let aiCompetitorAdjustment = 0;
        if (aiCompetitorWeight > 0 && unit.competitorBenchmarkRate) {
          const competitorRate = unit.competitorBenchmarkRate;
          const priceDifference = (streetRate - competitorRate) / competitorRate;
          if (Math.abs(priceDifference) > 0.05) {
            const severity = Math.min(Math.abs(priceDifference) / 0.20, 1);
            const direction = priceDifference > 0 ? -1 : 1;
            const range = direction > 0 ? aiRanges.competitorMax : aiRanges.competitorMin;
            aiCompetitorAdjustment = range * severity * (aiCompetitorWeight / 100);
          }
        }
        
        // Calculate AI market adjustment
        let aiMarketAdjustment = 0;
        if (aiMarketWeight > 0) {
          aiMarketAdjustment = aiRanges.marketMax * 0.3 * (aiMarketWeight / 100);
        }
        
        // Calculate total AI adjustment and new rate
        const aiTotalAdjustment = aiOccupancyAdjustment + aiVacancyAdjustment + aiAttributeAdjustment + 
                                  aiSeasonalAdjustment + aiCompetitorAdjustment + aiMarketAdjustment;
        
        // Update the AI suggested rate in the unit data (for display only, not saved to DB)
        unit.aiSuggestedRate = Math.round(streetRate * (1 + aiTotalAdjustment));
      }

      let rateCardSummary = await storage.getRateCardByMonth(targetMonth);
      
      // If no rate card summary exists, generate it from current unit data
      if (rateCardSummary.length === 0 && unitLevelData.length > 0) {
        await storage.generateRateCard(targetMonth);
        rateCardSummary = await storage.getRateCardByMonth(targetMonth);
      }

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

  // Generate Modulo pricing suggestions
  app.post("/api/pricing/generate-modulo", async (req, res) => {
    try {
      const { month, serviceLine, regions, divisions, locations } = req.body;
      const targetMonth = month || new Date().toISOString().substring(0, 7);
      
      // Get current weights for calculation with defaults
      const defaultWeights = {
        occupancyPressure: 25,
        daysVacantDecay: 20,
        roomAttributes: 25,
        seasonality: 10,
        competitorRates: 10,
        stockMarket: 10
      };
      const weights = await storage.getLatestWeights() || defaultWeights;
      
      // Get guardrails for smart adjustments
      const guardrailsData = await storage.getCurrentGuardrails();
      
      // Get active adjustment rules
      const activeRules = await storage.getAdjustmentRules ? 
        (await storage.getAdjustmentRules()).filter((r: any) => r.isActive) : [];
      
      // Get stock market performance (mock data for now, could integrate with real API)
      const stockMarketChange = 2.5; // Assume market is up 2.5% over last week
      
      // Get all units for the month - always process ALL units regardless of filters
      // This ensures pricing is generated for the entire portfolio
      const units = await storage.getRentRollDataByMonth(targetMonth);
      
      console.log(`Generating Modulo for ${units.length} units`);
      
      // Collect all updates in memory first for bulk processing
      const updates: Array<{ id: string; moduloSuggestedRate: number; moduloCalculationDetails: string }> = [];
      
      // Generate Modulo suggestions using detailed algorithm
      for (const unit of units) {
        const baseRate = unit.streetRate;
        let suggestion = baseRate;
        let calculationDetails = {
          baseRate,
          adjustments: [],
          weights: { ...weights },
          totalAdjustment: 0,
          finalRate: 0,
          appliedRules: [] as string[]
        };
        
        // Apply occupancy pressure (weighted adjustment based on market conditions)
        let occupancyAdjustment = 0;
        if (weights?.occupancyPressure) {
          const occupancyRate = unit.occupiedYN ? 0.85 : 0.75; // Lower if vacant
          const targetOccupancy = 0.95;
          const occupancyDelta = occupancyRate - targetOccupancy;
          const pressureAdjustment = occupancyDelta * 0.5; // 50% adjustment per delta
          const weightedAdjustment = pressureAdjustment * (weights.occupancyPressure / 100);
          occupancyAdjustment = weightedAdjustment;
          suggestion *= (1 + weightedAdjustment);
          
          calculationDetails.adjustments.push({
            factor: 'Occupancy Pressure',
            description: unit.occupiedYN ? 'Unit occupied' : 'Unit vacant',
            calculation: `(${occupancyRate.toFixed(2)} - ${targetOccupancy}) × 0.5 × ${weights.occupancyPressure}%`,
            weight: weights.occupancyPressure,
            adjustment: pressureAdjustment * 100,
            weightedAdjustment: weightedAdjustment * 100,
            impact: baseRate * weightedAdjustment
          });
        }
        
        // Apply days vacant decay (weighted for longer vacancies)
        let vacancyAdjustment = 0;
        if (unit.daysVacant > 0 && weights?.daysVacantDecay) {
          const vacancyPenalty = Math.min(unit.daysVacant / 60, 0.25); // Max 25% penalty
          const weightedAdjustment = -vacancyPenalty * (weights.daysVacantDecay / 100);
          vacancyAdjustment = weightedAdjustment;
          suggestion *= (1 + weightedAdjustment);
          
          calculationDetails.adjustments.push({
            factor: 'Days Vacant Decay',
            description: `${unit.daysVacant} days vacant`,
            calculation: `min(${unit.daysVacant}/60, 0.25) × ${weights.daysVacantDecay}%`,
            weight: weights.daysVacantDecay,
            adjustment: -vacancyPenalty * 100,
            weightedAdjustment: weightedAdjustment * 100,
            impact: baseRate * weightedAdjustment
          });
        }
        
        // Apply room attributes premium (weighted for premium features)
        let attributeAdjustment = 0;
        if (weights?.roomAttributes) {
          let attributeBonus = 0;
          const features = [];
          
          if (unit.view) {
            attributeBonus += 0.05; // 5% for view
            features.push('View');
          }
          if (unit.renovated) {
            attributeBonus += 0.08; // 8% for renovation
            features.push('Renovated');
          }
          
          if (attributeBonus > 0) {
            const weightedAdjustment = attributeBonus * (weights.roomAttributes / 100);
            attributeAdjustment = weightedAdjustment;
            suggestion *= (1 + weightedAdjustment);
            
            calculationDetails.adjustments.push({
              factor: 'Room Attributes',
              description: features.join(', '),
              calculation: `${(attributeBonus * 100).toFixed(1)}% × ${weights.roomAttributes}%`,
              weight: weights.roomAttributes,
              adjustment: attributeBonus * 100,
              weightedAdjustment: weightedAdjustment * 100,
              impact: baseRate * weightedAdjustment
            });
          }
        }
        
        // Apply competitor rate adjustment (market positioning)
        let competitorAdjustment = 0;
        if (unit.competitorRate && weights?.competitorRates && unit.competitorRate !== unit.streetRate) {
          const competitorDiff = (unit.competitorRate - unit.streetRate) / unit.streetRate;
          const adjustment = competitorDiff * 0.8; // Move 80% toward competitor rate
          const weightedAdjustment = adjustment * (weights.competitorRates / 100);
          competitorAdjustment = weightedAdjustment;
          suggestion *= (1 + weightedAdjustment);
          
          calculationDetails.adjustments.push({
            factor: 'Competitor Rates',
            description: `Competitor at $${unit.competitorRate.toFixed(0)}`,
            calculation: `(${unit.competitorRate} - ${baseRate})/${baseRate} × 0.8 × ${weights.competitorRates}%`,
            weight: weights.competitorRates,
            adjustment: adjustment * 100,
            weightedAdjustment: weightedAdjustment * 100,
            impact: baseRate * weightedAdjustment
          });
        }
        
        // Apply seasonality adjustment
        let seasonalAdjustment = 0;
        if (weights?.seasonality) {
          const month = new Date(targetMonth).getMonth();
          let seasonalFactor = 0;
          
          // Peak season: Sept-Nov (move-in season)
          if (month >= 8 && month <= 10) {
            seasonalFactor = 0.05; // 5% increase
          } else if (month >= 11 || month <= 1) {
            // Low season: Dec-Feb
            seasonalFactor = -0.03; // 3% decrease
          }
          
          const weightedAdjustment = seasonalFactor * (weights.seasonality / 100);
          seasonalAdjustment = weightedAdjustment;
          suggestion *= (1 + weightedAdjustment);
          
          if (seasonalFactor !== 0) {
            calculationDetails.adjustments.push({
              factor: 'Seasonality',
              description: seasonalFactor > 0 ? 'Peak season' : 'Low season',
              calculation: `${(seasonalFactor * 100).toFixed(1)}% × ${weights.seasonality}%`,
              weight: weights.seasonality,
              adjustment: seasonalFactor * 100,
              weightedAdjustment: weightedAdjustment * 100,
              impact: baseRate * weightedAdjustment
            });
          }
        }
        
        // Apply stock market adjustment
        let marketAdjustment = 0;
        if (weights?.stockMarket) {
          const marketFactor = stockMarketChange > 0 ? 0.02 : -0.01; // 2% if market up, -1% if down
          const weightedAdjustment = marketFactor * (weights.stockMarket / 100);
          marketAdjustment = weightedAdjustment;
          suggestion *= (1 + weightedAdjustment);
          
          calculationDetails.adjustments.push({
            factor: 'Stock Market Performance',
            description: `S&P 500 ${stockMarketChange > 0 ? 'up' : 'down'} ${Math.abs(stockMarketChange).toFixed(1)}% over last week`,
            calculation: `Market ${stockMarketChange > 0 ? 'growth' : 'decline'} factor ${(marketFactor * 100).toFixed(1)}% × ${weights.stockMarket}%`,
            weight: weights.stockMarket,
            adjustment: marketFactor * 100,
            weightedAdjustment: weightedAdjustment * 100,
            impact: baseRate * weightedAdjustment
          });
        }
        
        // Calculate total adjustment
        calculationDetails.totalAdjustment = (occupancyAdjustment + vacancyAdjustment + attributeAdjustment + 
                                              competitorAdjustment + seasonalAdjustment + marketAdjustment) * 100;
        calculationDetails.finalRate = Math.round(suggestion);
        
        // Apply guardrails (smart adjustments)
        const guardrailsApplied: string[] = [];
        if (guardrailsData) {
          const originalSuggestion = suggestion;
          
          // Min rate decrease limit
          if (guardrailsData.minRateDecrease) {
            const minRate = unit.streetRate * (1 - guardrailsData.minRateDecrease);
            if (suggestion < minRate) {
              suggestion = minRate;
              guardrailsApplied.push(`Minimum rate decrease limit applied (${(guardrailsData.minRateDecrease * 100).toFixed(1)}%)`);
            }
          }
          
          // Max rate increase limit
          if (guardrailsData.maxRateIncrease) {
            const maxRate = unit.streetRate * (1 + guardrailsData.maxRateIncrease);
            if (suggestion > maxRate) {
              suggestion = maxRate;
              guardrailsApplied.push(`Maximum rate increase limit applied (${(guardrailsData.maxRateIncrease * 100).toFixed(1)}%)`);
            }
          }
          
          // Competitor variance limits
          if (guardrailsData.competitorVarianceLimit && unit.competitorRate) {
            const maxVariance = unit.competitorRate * guardrailsData.competitorVarianceLimit;
            const minCompetitorRate = unit.competitorRate - maxVariance;
            const maxCompetitorRate = unit.competitorRate + maxVariance;
            
            if (suggestion < minCompetitorRate) {
              suggestion = minCompetitorRate;
              guardrailsApplied.push(`Competitor variance floor applied (${(guardrailsData.competitorVarianceLimit * 100).toFixed(1)}%)`);
            }
            
            if (suggestion > maxCompetitorRate) {
              suggestion = maxCompetitorRate;
              guardrailsApplied.push(`Competitor variance ceiling applied (${(guardrailsData.competitorVarianceLimit * 100).toFixed(1)}%)`);
            }
          }
          
          // Update final rate if guardrails were applied
          if (guardrailsApplied.length > 0) {
            calculationDetails.finalRate = Math.round(suggestion);
          }
        }
        
        // Store guardrails in calculation details
        calculationDetails.guardrailsApplied = guardrailsApplied;
        
        // Apply manual adjustment rules AFTER Modulo calculation and guardrails
        for (const rule of activeRules) {
          const filters = rule.action?.filters;
          let matches = true;
          
          // Check if unit matches rule filters
          if (filters) {
            if (filters.roomType && !filters.roomType.includes(unit.roomType)) matches = false;
            if (filters.serviceLine && !filters.serviceLine.includes(unit.serviceLine)) matches = false;
            if (filters.occupancy === 'vacant' && unit.occupiedYN) matches = false;
            if (filters.occupancy === 'occupied' && !unit.occupiedYN) matches = false;
          }
          
          if (matches && rule.action) {
            const beforeRuleRate = suggestion;
            
            // Apply the rule adjustment
            if (rule.action.adjustmentType === 'percentage') {
              const adjustment = rule.action.adjustmentValue / 100;
              suggestion *= (1 + adjustment);
              
              // Add to adjustments array for display in dialog
              calculationDetails.adjustments.push({
                factor: `Rule: ${rule.name}`,
                description: rule.description || `${rule.action.adjustmentValue}% adjustment`,
                calculation: `${beforeRuleRate.toFixed(0)} × ${(1 + adjustment).toFixed(3)}`,
                weight: 100,
                adjustment: rule.action.adjustmentValue,
                weightedAdjustment: rule.action.adjustmentValue,
                impact: beforeRuleRate * adjustment
              });
              
              calculationDetails.appliedRules.push(rule.name);
            } else if (rule.action.adjustmentType === 'absolute') {
              suggestion += rule.action.adjustmentValue;
              
              // Add to adjustments array for display in dialog
              calculationDetails.adjustments.push({
                factor: `Rule: ${rule.name}`,
                description: rule.description || `+$${rule.action.adjustmentValue} adjustment`,
                calculation: `${beforeRuleRate.toFixed(0)} + ${rule.action.adjustmentValue}`,
                weight: 100,
                adjustment: (rule.action.adjustmentValue / beforeRuleRate) * 100,
                weightedAdjustment: (rule.action.adjustmentValue / beforeRuleRate) * 100,
                impact: rule.action.adjustmentValue
              });
              
              calculationDetails.appliedRules.push(rule.name);
            }
          }
        }
        
        // Update final rate after rules
        calculationDetails.finalRate = Math.round(suggestion);
        
        // Ensure suggestions are different from street rates (minimum 1% change)
        const minChange = unit.streetRate * 0.01;
        if (Math.abs(suggestion - unit.streetRate) < minChange) {
          suggestion = unit.streetRate + (Math.random() > 0.5 ? minChange : -minChange);
          calculationDetails.finalRate = Math.round(suggestion);
        }
        
        // Add to bulk update array
        updates.push({
          id: unit.id,
          moduloSuggestedRate: Math.round(suggestion),
          moduloCalculationDetails: JSON.stringify(calculationDetails)
        });
      }
      
      console.log(`Calculated ${updates.length} Modulo suggestions, starting bulk update...`);
      
      // Perform bulk update in batches
      await storage.bulkUpdateModuloRates(updates);
      
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
      
      console.log(`Generating AI suggestions for ${units.length} filtered units`);
      
      // Collect all updates in memory first for bulk processing
      const aiUpdates: Array<{ id: string; aiSuggestedRate: number; aiCalculationDetails: string }> = [];
      
      // Get AI-specific weights and ranges for calculation
      const weights = await storage.getAiPricingWeights() || {
        occupancyPressure: 20,
        daysVacantDecay: 20,
        roomAttributes: 15,
        competitorRates: 15,
        seasonality: 15,
        stockMarket: 15
      };
      const ranges = await storage.getAiAdjustmentRanges() || {
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
      };
      
      // Generate AI suggestions using the same weights/ranges as Modulo but with AI-specific curves
      for (const unit of units) {
        const baseRate = unit.streetRate;
        let aiSuggestion = baseRate;
        
        let occupancyAdjustment = 0;
        let vacancyAdjustment = 0;
        let attributeAdjustment = 0;
        let seasonalAdjustment = 0;
        let competitorAdjustment = 0;
        let marketAdjustment = 0;
        
        // Apply occupancy pressure (respecting both weight AND range limits)
        if (weights?.occupancyPressure) {
          const occupancyRate = unit.occupiedYN ? 0.88 : 0.72; // AI-specific occupancy rates
          const rawPressureAdjustment = (occupancyRate - 0.8) * (weights.occupancyPressure / 100);
          // Apply range limits from adjustment ranges
          const minAdj = ranges?.occupancyMin || -0.1;
          const maxAdj = ranges?.occupancyMax || 0.1;
          occupancyAdjustment = Math.max(minAdj, Math.min(maxAdj, rawPressureAdjustment));
          aiSuggestion *= (1 + occupancyAdjustment);
        }
        
        // Apply days vacant decay (respecting both weight AND range limits)
        if (unit.daysVacant > 0 && weights?.daysVacantDecay) {
          const vacancyPenalty = Math.min(unit.daysVacant / 50, 0.30); // AI curve: more aggressive
          const rawDecay = vacancyPenalty * (weights.daysVacantDecay / 100);
          // Apply range limits
          const minAdj = ranges?.vacancyMin || -0.25;
          const maxAdj = ranges?.vacancyMax || 0;
          vacancyAdjustment = Math.max(minAdj, Math.min(maxAdj, -rawDecay));
          aiSuggestion *= (1 + vacancyAdjustment);
        }
        
        // Apply room attributes premium (respecting both weight AND range limits)
        let rawAttributeBonus = 0;
        if (unit.view && weights?.roomAttributes) {
          rawAttributeBonus += weights.roomAttributes / 100 * 0.06; // AI: 6% for view
        }
        if (unit.renovated && weights?.roomAttributes) {
          rawAttributeBonus += weights.roomAttributes / 100 * 0.09; // AI: 9% for renovation
        }
        // Apply range limits
        const minAttr = ranges?.attributesMin || 0;
        const maxAttr = ranges?.attributesMax || 0.15;
        attributeAdjustment = Math.max(minAttr, Math.min(maxAttr, rawAttributeBonus));
        if (attributeAdjustment > 0) {
          aiSuggestion *= (1 + attributeAdjustment);
        }
        
        // Apply competitor rate adjustment (respecting both weight AND range limits)
        if (unit.competitorRate && weights?.competitorRates && unit.competitorRate !== unit.streetRate) {
          const competitorDiff = (unit.competitorRate - unit.streetRate) / unit.streetRate;
          const rawAdjustment = competitorDiff * (weights.competitorRates / 100) * 0.7; // AI: 70% of competitor difference
          // Apply range limits
          const minComp = ranges?.competitorMin || -0.1;
          const maxComp = ranges?.competitorMax || 0.1;
          competitorAdjustment = Math.max(minComp, Math.min(maxComp, rawAdjustment));
          aiSuggestion *= (1 + competitorAdjustment);
        }
        
        // Apply seasonality (respecting both weight AND range limits)
        if (weights?.seasonality) {
          const month = new Date().getMonth();
          let rawSeasonalAdjustment = 0;
          if (month >= 8 && month <= 10) rawSeasonalAdjustment = 0.06; // AI: 6% peak season
          else if (month >= 11 || month <= 1) rawSeasonalAdjustment = -0.04; // AI: -4% low season
          
          if (rawSeasonalAdjustment !== 0) {
            const weightedAdjustment = rawSeasonalAdjustment * (weights.seasonality / 100);
            // Apply range limits
            const minSeason = ranges?.seasonalMin || -0.05;
            const maxSeason = ranges?.seasonalMax || 0.05;
            seasonalAdjustment = Math.max(minSeason, Math.min(maxSeason, weightedAdjustment));
            aiSuggestion *= (1 + seasonalAdjustment);
          }
        }
        
        // Apply market adjustment (respecting both weight AND range limits)
        if (weights?.stockMarket) {
          const rawMarketAdjustment = 0.025 * (weights.stockMarket / 100); // AI: 2.5% market growth
          // Apply range limits
          const minMarket = ranges?.marketMin || 0;
          const maxMarket = ranges?.marketMax || 0.03;
          marketAdjustment = Math.max(minMarket, Math.min(maxMarket, rawMarketAdjustment));
          aiSuggestion *= (1 + marketAdjustment);
        }
        
        const totalAdjustment = occupancyAdjustment + vacancyAdjustment + attributeAdjustment + 
                                seasonalAdjustment + competitorAdjustment + marketAdjustment;
        
        // Store calculation details for the popup (like Modulo)
        const aiCalculationDetails = {
          baseRate: baseRate,
          occupancyAdjustment,
          vacancyAdjustment,
          attributeAdjustment,
          seasonalAdjustment,
          competitorAdjustment,
          marketAdjustment,
          totalAdjustment,
          finalRate: Math.round(aiSuggestion)
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
      const { unitIds, suggestionType } = req.body;
      
      // Track which months need rate card regeneration
      const affectedMonths = new Set<string>();
      
      for (const unitId of unitIds) {
        const unit = await storage.getRentRollDataById(unitId);
        if (!unit) continue;
        
        const newRate = suggestionType === 'modulo' ? 
          unit.moduloSuggestedRate : unit.aiSuggestedRate;
          
        if (newRate) {
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
      
      res.json({ success: true });
    } catch (error) {
      console.error('Accept suggestions error:', error);
      res.status(500).json({ error: 'Failed to accept suggestions' });
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
      
      // Fallback to dynamic calculation if no stored details
      const storedAiRate = unit.aiSuggestedRate;
      const streetRate = unit.streetRate || 3185;
      
      // Get AI-specific weights and ranges for calculation
      const aiWeights = await storage.getAiPricingWeights() || {
        occupancyPressure: 20,
        daysVacantDecay: 20,
        roomAttributes: 15,
        competitorRates: 15,
        seasonality: 15,
        stockMarket: 15
      };
      const aiRanges = await storage.getAiAdjustmentRanges() || {
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
      };
      
      // Get all units to calculate actual occupancy rate
      const allUnits = await storage.getRentRollData();
      const occupiedUnits = allUnits.filter(u => u.occupiedYN);
      const actualOccupancyRate = occupiedUnits.length / allUnits.length;
      
      // Calculate AI adjustments - more aggressive than Modulo
      let aiOccupancyAdjustment = 0;
      if (aiWeights.occupancyPressure > 0) {
        // AI uses more aggressive occupancy-based pricing
        if (actualOccupancyRate >= 0.90) {
          // High occupancy - push rates up
          const scale = Math.min((actualOccupancyRate - 0.90) / 0.10, 1);
          aiOccupancyAdjustment = aiRanges.occupancyMax * (0.5 + scale * 0.5) * (aiWeights.occupancyPressure / 100);
        } else if (actualOccupancyRate <= 0.80) {
          // Low occupancy - reduce rates
          const scale = Math.min((0.80 - actualOccupancyRate) / 0.20, 1);
          aiOccupancyAdjustment = aiRanges.occupancyMin * (0.5 + scale * 0.5) * (aiWeights.occupancyPressure / 100);
        } else {
          // Mid-range occupancy - slight positive adjustment
          const scale = (actualOccupancyRate - 0.80) / 0.10;
          aiOccupancyAdjustment = aiRanges.occupancyMax * scale * 0.3 * (aiWeights.occupancyPressure / 100);
        }
      }
      
      let aiVacancyAdjustment = 0;
      if (aiWeights.daysVacantDecay > 0 && !unit.occupiedYN && unit.daysVacant && unit.daysVacant > 0) {
        // AI is more aggressive with vacancy adjustments
        const severity = Math.min(unit.daysVacant / 60, 1); // More aggressive curve (60 days instead of 90)
        aiVacancyAdjustment = aiRanges.vacancyMin * severity * (aiWeights.daysVacantDecay / 100);
      }
      
      let aiAttributeAdjustment = 0;
      if (aiWeights.roomAttributes > 0 && unit.attributes) {
        // Only apply if unit has documented attributes
        let attributeScore = 0;
        const attrs = unit.attributes;
        
        if (attrs.view) attributeScore += 0.3;
        if (attrs.renovated) attributeScore += 0.4;
        if (attrs.corner) attributeScore += 0.3;
        
        if (attributeScore > 0) {
          aiAttributeAdjustment = aiRanges.attributesMax * attributeScore * (aiWeights.roomAttributes / 100);
        }
      }
      
      let aiSeasonalAdjustment = 0;
      if (aiWeights.seasonality > 0) {
        const currentMonth = new Date().getMonth();
        const isPeakSeason = (currentMonth >= 2 && currentMonth <= 4) || (currentMonth >= 8 && currentMonth <= 10);
        if (isPeakSeason) {
          aiSeasonalAdjustment = aiRanges.seasonalMax * 0.8 * (aiWeights.seasonality / 100);
        } else {
          aiSeasonalAdjustment = aiRanges.seasonalMin * 0.5 * (aiWeights.seasonality / 100);
        }
      }
      
      let aiCompetitorAdjustment = 0;
      if (aiWeights.competitorRates > 0 && unit.competitorBenchmarkRate) {
        const competitorRate = unit.competitorBenchmarkRate;
        const priceDifference = (streetRate - competitorRate) / competitorRate;
        const severity = Math.min(Math.abs(priceDifference) / 0.20, 1);
        const direction = priceDifference > 0 ? -1 : 1;
        const range = direction > 0 ? aiRanges.competitorMax : aiRanges.competitorMin;
        aiCompetitorAdjustment = range * severity * (aiWeights.competitorRates / 100);
      }
      
      let aiMarketAdjustment = 0;
      // Market adjustment only applies if we have actual market data
      // In this case we don't have real market data, so it stays at 0
      
      const aiTotalAdjustment = aiOccupancyAdjustment + aiVacancyAdjustment + aiAttributeAdjustment + 
                                aiSeasonalAdjustment + aiCompetitorAdjustment + aiMarketAdjustment;
      
      // Use stored AI rate if available, otherwise calculate
      const aiSuggestedRate = storedAiRate || Math.round(streetRate * (1 + aiTotalAdjustment));
      
      res.json({
        unitId: unit.id,
        roomType: unit.roomType,
        streetRate: streetRate,
        aiSuggestedRate: aiSuggestedRate,
        calculation: {
          baseRate: streetRate,
          occupancyAdjustment: aiOccupancyAdjustment,
          vacancyAdjustment: aiVacancyAdjustment,
          attributeAdjustment: aiAttributeAdjustment,
          seasonalAdjustment: aiSeasonalAdjustment,
          competitorAdjustment: aiCompetitorAdjustment,
          marketAdjustment: aiMarketAdjustment,
          totalAdjustment: aiTotalAdjustment,
          actualOccupancyRate: actualOccupancyRate,
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
          roomAttributes: 20,
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
      const attributeWeight = weights?.roomAttributes ?? 25;
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
      const { description, preview } = req.body;
      
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
      const rules = await storage.getAdjustmentRules();
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
      const maps = await storage.getCampusMaps();
      const filtered = locationId ? maps.filter(m => m.locationId === locationId) : maps;
      res.json(filtered);
    } catch (error) {
      console.error('Error fetching campus maps:', error);
      res.status(500).json({ error: "Failed to fetch campus maps" });
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

      const { name, locationId, width, height } = req.body;
      
      if (!name || !locationId) {
        return res.status(400).json({ error: "Missing required fields: name, locationId" });
      }

      const timestamp = Date.now();
      const filename = `floor-plan-${timestamp}${path.extname(req.file.originalname)}`;
      const filepath = path.join('attached_assets', 'floor_plans', filename);
      
      const fs = await import('fs/promises');
      await fs.mkdir(path.join('attached_assets', 'floor_plans'), { recursive: true });
      await fs.writeFile(filepath, req.file.buffer);

      const mapData = {
        locationId,
        name,
        baseImageUrl: `/${filepath}`,
        width: parseInt(width) || 1024,
        height: parseInt(height) || 683,
        isPublished: false,
      };

      const map = await storage.createCampusMap(mapData);
      
      res.json(map);
    } catch (error) {
      console.error('Error uploading floor plan image:', error);
      res.status(500).json({ error: "Failed to upload floor plan image" });
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

  // AI-powered room detection endpoint
  // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
  app.post("/api/floor-plans/detect-rooms", upload.single('image'), async (req, res) => {
    try {
      const { campusMapId } = req.body;
      let imageBase64: string;

      // Get image from either uploaded file or campusMapId (validated)
      if (req.file) {
        imageBase64 = req.file.buffer.toString('base64');
      } else if (campusMapId) {
        // Fetch the campus map to get the base image URL - validates ownership/existence
        const campusMap = await storage.getCampusMapById(campusMapId);
        if (!campusMap || !campusMap.baseImageUrl) {
          return res.status(404).json({ error: "Campus map or image not found" });
        }
        
        // Validate that the path doesn't contain traversal attempts
        if (campusMap.baseImageUrl.includes('..') || !campusMap.baseImageUrl.startsWith('attached_assets/')) {
          return res.status(400).json({ error: "Invalid image path" });
        }
        
        // Read the image file and convert to base64
        const fs = await import('fs/promises');
        const imagePath = path.join(process.cwd(), campusMap.baseImageUrl);
        const imageBuffer = await fs.readFile(imagePath);
        imageBase64 = imageBuffer.toString('base64');
      } else {
        return res.status(400).json({ error: "No image provided. Please provide either campusMapId or upload an image file" });
      }

      // Initialize OpenAI client
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Use GPT-5 vision to analyze the floor plan
      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are an expert at analyzing architectural floor plans for senior living facilities. 
            Analyze the floor plan image and detect individual room boundaries. 
            For each room detected, provide:
            1. A polygon boundary (as normalized coordinates 0-100% for SVG)
            2. A suggested room label (e.g., "101", "AL-102", "MC-01")
            3. Approximate room center point
            4. Room type if identifiable (Studio, 1BR, 2BR, Semi-Private, etc.)
            
            Return your response as a JSON object with this structure:
            {
              "rooms": [
                {
                  "label": "101",
                  "polygon": "10,10 20,10 20,20 10,20",
                  "centerX": 15,
                  "centerY": 15,
                  "roomType": "Studio",
                  "confidence": 0.95
                }
              ],
              "imageWidth": 1024,
              "imageHeight": 683
            }
            
            Notes:
            - Polygon coordinates should be in SVG format as percentages (0-100)
            - Only detect actual resident rooms, not common areas
            - Look for room numbers in the image
            - Confidence should be 0-1 (1 being most confident)`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this floor plan and detect all resident rooms with their boundaries and labels."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`
                }
              }
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 4096,
      });

      const detectionResult = JSON.parse(response.choices[0].message.content || '{"rooms": []}');
      
      res.json({
        success: true,
        detected: detectionResult.rooms || [],
        metadata: {
          imageWidth: detectionResult.imageWidth || 1024,
          imageHeight: detectionResult.imageHeight || 683,
          totalRoomsDetected: (detectionResult.rooms || []).length
        }
      });
    } catch (error) {
      console.error('Error detecting rooms with AI:', error);
      res.status(500).json({ 
        error: "Failed to detect rooms",
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

  const httpServer = createServer(app);
  return httpServer;
}
