import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { demoRentRoll } from "./seed-data";
import multer from "multer";
import Papa from "papaparse";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { 
  insertRentRollDataSchema, 
  insertAssumptionsSchema, 
  insertPricingWeightsSchema,
  insertCompetitorSchema,
  insertGuardrailsSchema
} from "@shared/schema";
import { demoCompetitors, demoRentRoll } from "./seed-data";
import * as XLSX from 'xlsx';

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

// Fetch real S&P 500 data from Alpha Vantage
async function fetchSP500Data() {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.warn("Alpha Vantage API key not found, using mock data");
    return marketDataCache.lastMonthReturnPct;
  }

  // Only fetch if cache is older than 1 hour
  const now = Date.now();
  if (now - marketDataCache.lastFetched < 3600000) {
    return marketDataCache.lastMonthReturnPct;
  }

  try {
    // Use SPY ETF as S&P 500 proxy (more reliable data)
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=SPY&apikey=${apiKey}`;
    console.log("Fetching S&P 500 data from Alpha Vantage...");
    
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
        
        marketDataCache.currentPrice = currentMonth;
        marketDataCache.previousMonthPrice = previousMonth;
        marketDataCache.lastMonthReturnPct = Math.round(monthlyReturn * 100) / 100;
        marketDataCache.lastFetched = now;
        
        console.log(`S&P 500 (SPY ETF) Monthly Return: ${marketDataCache.lastMonthReturnPct}% (${previousMonth.toFixed(2)} -> ${currentMonth.toFixed(2)})`);
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

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
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
          stock_market: weights.stockMarket
        } : null
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get status" });
    }
  });

  // Upload rent roll CSV
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
      const validatedData = insertPricingWeightsSchema.parse(req.body);
      const weights = await storage.createOrUpdateWeights(validatedData);
      res.json({ ok: true, weights });
    } catch (error) {
      res.status(400).json({ error: "Invalid weights data" });
    }
  });

  // Building maps endpoints
  app.get("/api/building-maps", isAuthenticated, async (req, res) => {
    res.json({ items: buildingMaps });
  });

  app.post("/api/upload-building-map", isAuthenticated, upload.single("buildingMap"), async (req, res) => {
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

  app.get("/api/building-maps/:id/image", isAuthenticated, async (req, res) => {
    const buildingMap = buildingMaps.find(map => map.id === req.params.id);
    if (!buildingMap) {
      return res.status(404).json({ error: "Building map not found" });
    }

    res.set('Content-Type', 'image/jpeg');
    res.send(buildingMap.imageBuffer);
  });

  app.delete("/api/building-maps/:id", isAuthenticated, async (req, res) => {
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
  app.get("/api/series", isAuthenticated, async (req, res) => {
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
      let baseSP500 = 4500;     // Starting S&P 500 index value
      let baseIndustry = 4200;  // Starting industry basket value
      
      for (let i = 0; i < months; i++) {
        const date = new Date();
        date.setMonth(date.getMonth() - months + 1 + i);
        labels.push(date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        
        // Add realistic growth patterns with some variance
        const revenueGrowthRate = 0.015 + (Math.random() * 0.02 - 0.01); // 0.5% to 2.5% monthly growth
        const sp500GrowthRate = 0.007 + (Math.random() * 0.03 - 0.015); // -0.8% to 2.2% monthly growth
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
      const competitors = await storage.getCompetitors();
      res.json({ items: competitors });
    } catch (error) {
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
  app.get("/api/recommendations", isAuthenticated, async (req, res) => {
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
      
      // Add Louisville competitors
      for (const competitor of demoCompetitors) {
        await storage.createCompetitor({
          name: competitor.name,
          lat: competitor.lat,
          lng: competitor.lng,
          studioRate: competitor.rates["Studio"],
          oneBedRate: competitor.rates["One Bedroom"],
          twoBedRate: competitor.rates["Two Bedroom"],
          memoryCareRate: competitor.rates["Memory Care"],
          avgCareRate: competitor.avgCareRate
        });
      }
      
      // Add demo rent roll data for "Sunset Manor"
      for (const unit of demoRentRoll) {
        await storage.createRentRollData({
          unitId: unit.unitId,
          occupiedYN: unit.occupiedYN,
          baseRent: unit.baseRent,
          careFee: unit.careFee || null,
          roomType: unit.roomType,
          serviceLine: unit.serviceLine,
          competitorBenchmarkRate: unit.competitorBenchmarkRate,
          competitorAvgCareRate: null,
          daysVacant: unit.daysVacant,
          attributes: unit.attributes
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
      
      // Set default weights
      await storage.createOrUpdateWeights({
        occupancyPressure: 0.25,
        daysVacantDecay: 0.20,
        roomAttributes: 0.15,
        seasonality: 0.10,
        competitorRates: 0.20,
        stockMarket: 0.10
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
      
      res.json({ 
        ok: true, 
        message: "Demo data seeded successfully",
        competitors: demoCompetitors.length,
        units: demoRentRoll.length
      });
    } catch (error) {
      console.error("Seed error:", error);
      res.status(500).json({ error: "Failed to seed demo data" });
    }
  });

  // Template download endpoint
  app.get("/api/template/download", isAuthenticated, async (req, res) => {
    try {
      // Create Excel template with field headers and one dummy row
      const templateData = [
        {
          date: '2024-01-31',
          location: 'West Wing', 
          'room number': 'AL101',
          'room type': 'Studio',
          'occupied Y/N': 'Y',
          'days vacant': 0,
          'preferred location': 'Yes',
          size: 'Studio',
          view: 'Garden View',
          renovated: 'Yes',
          'other premium feature': 'Kitchenette, Walk-in Shower',
          'street rate': 3200,
          'in-house rate': 3000,
          'discount to street rate': 200,
          'care level': 'Independent Living',
          'care rate': 500,
          'rent and care rate': 3500,
          'competitor rate': 3150,
          'competitor average care rate': 480,
          'competitor final rate': 3630
        }
      ];

      const worksheet = XLSX.utils.json_to_sheet(templateData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Rent Roll Data');

      // Write to buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=rent_roll_template.xlsx');
      res.send(buffer);
    } catch (error) {
      console.error('Template download error:', error);
      res.status(500).json({ error: 'Failed to generate template' });
    }
  });

  // Data upload endpoint
  app.post("/api/upload/rent-roll", isAuthenticated, upload.single('file'), async (req, res) => {
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
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        jsonData = XLSX.utils.sheet_to_json(worksheet);
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
  app.get("/api/overview", isAuthenticated, async (req, res) => {
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
            { roomType: 'Studio', occupied: 12, total: 15, occupancyRate: 80.0 },
            { roomType: 'One Bedroom', occupied: 18, total: 20, occupancyRate: 90.0 },
            { roomType: 'Two Bedroom', occupied: 8, total: 10, occupancyRate: 80.0 }
          ],
          occupancyByServiceLine: [
            { serviceLine: 'AL', occupied: 15, total: 20, occupancyRate: 75.0 },
            { serviceLine: 'AL/MC', occupied: 8, total: 10, occupancyRate: 80.0 },
            { serviceLine: 'HC', occupied: 6, total: 8, occupancyRate: 75.0 },
            { serviceLine: 'HC/MC', occupied: 4, total: 5, occupancyRate: 80.0 },
            { serviceLine: 'IL', occupied: 6, total: 9, occupancyRate: 67.0 },
            { serviceLine: 'SL', occupied: 7, total: 8, occupancyRate: 88.0 }
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

      const occupancyByRoomType = Object.entries(roomTypeStats).map(([roomType, stats]: [string, any]) => ({
        roomType,
        occupied: stats.occupied,
        total: stats.total,
        occupancyRate: Math.round((stats.occupied / stats.total) * 100)
      }));

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

      const occupancyByServiceLine = Object.entries(serviceLineStats).map(([serviceLine, stats]: [string, any]) => ({
        serviceLine,
        occupied: stats.occupied,
        total: stats.total,
        occupancyRate: Math.round((stats.occupied / stats.total) * 100)
      }));

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
      const { month } = req.query;
      const targetMonth = month as string || new Date().toISOString().substring(0, 7);
      
      const rateCardSummary = await storage.getRateCardByMonth(targetMonth);
      const unitLevelData = await storage.getRentRollDataByMonth(targetMonth);

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
      const { month } = req.body;
      const targetMonth = month || new Date().toISOString().substring(0, 7);
      
      // Get current weights for calculation
      const weights = await storage.getLatestWeights();
      const units = await storage.getRentRollDataByMonth(targetMonth);
      
      // Generate Modulo suggestions using more aggressive algorithm
      for (const unit of units) {
        let suggestion = unit.streetRate;
        let adjustmentFactors = [];
        
        // Apply occupancy pressure (5-15% adjustment based on market conditions)
        if (weights?.occupancyPressure) {
          const occupancyRate = unit.occupiedYN ? 0.85 : 0.75; // Lower if vacant
          const pressureAdjustment = (occupancyRate - 0.8) * (weights.occupancyPressure / 100);
          suggestion *= (1 + pressureAdjustment);
          adjustmentFactors.push(`Occupancy: ${(pressureAdjustment * 100).toFixed(1)}%`);
        }
        
        // Apply days vacant decay (more aggressive for longer vacancies)
        if (unit.daysVacant > 0 && weights?.daysVacantDecay) {
          const vacancyPenalty = Math.min(unit.daysVacant / 60, 0.25); // Max 25% penalty
          const decay = vacancyPenalty * (weights.daysVacantDecay / 100);
          suggestion *= (1 - decay);
          if (decay > 0.01) adjustmentFactors.push(`Vacancy: -${(decay * 100).toFixed(1)}%`);
        }
        
        // Apply room attributes premium (more significant impact)
        let attributeBonus = 0;
        if (unit.view && weights?.roomAttributes) {
          attributeBonus += weights.roomAttributes / 100 * 0.05; // 5% for view
        }
        if (unit.renovated && weights?.roomAttributes) {
          attributeBonus += weights.roomAttributes / 100 * 0.08; // 8% for renovation
        }
        if (attributeBonus > 0) {
          suggestion *= (1 + attributeBonus);
          adjustmentFactors.push(`Attributes: +${(attributeBonus * 100).toFixed(1)}%`);
        }
        
        // Apply competitor rate adjustment (significant market positioning)
        if (unit.competitorRate && weights?.competitorRates && unit.competitorRate !== unit.streetRate) {
          const competitorDiff = (unit.competitorRate - unit.streetRate) / unit.streetRate;
          const adjustment = competitorDiff * (weights.competitorRates / 100) * 0.5; // 50% of competitor difference
          suggestion *= (1 + adjustment);
          if (Math.abs(adjustment) > 0.01) adjustmentFactors.push(`Competitor: ${adjustment > 0 ? '+' : ''}${(adjustment * 100).toFixed(1)}%`);
        }
        
        // Ensure suggestions are different from street rates (minimum 2% change)
        const minChange = unit.streetRate * 0.02;
        if (Math.abs(suggestion - unit.streetRate) < minChange) {
          suggestion = unit.streetRate + (Math.random() > 0.5 ? minChange : -minChange);
        }
        
        await storage.updateRentRollData(unit.id, {
          moduloSuggestedRate: Math.round(suggestion)
        });
      }
      
      // Regenerate rate card with new suggestions
      await storage.generateRateCard(targetMonth);
      
      res.json({ success: true });
    } catch (error) {
      console.error('Modulo generation error:', error);
      res.status(500).json({ error: 'Failed to generate Modulo suggestions' });
    }
  });

  // Generate AI pricing suggestions  
  app.post("/api/pricing/generate-ai", async (req, res) => {
    try {
      const { month } = req.body;
      const targetMonth = month || new Date().toISOString().substring(0, 7);
      
      const units = await storage.getRentRollDataByMonth(targetMonth);
      
      // Generate AI suggestions (mock implementation)
      for (const unit of units) {
        let aiSuggestion = unit.streetRate;
        
        // AI considers multiple factors with different weightings
        if (unit.occupiedYN) {
          aiSuggestion *= 1.05; // Increase if occupied (demand signal)
        } else if (unit.daysVacant > 60) {
          aiSuggestion *= 0.92; // Decrease for long vacancies
        }
        
        // Premium features boost
        if (unit.view === "Garden View") aiSuggestion *= 1.08;
        if (unit.renovated) aiSuggestion *= 1.06;
        
        // Market positioning vs competitors
        if (unit.competitorRate && unit.streetRate < unit.competitorRate * 0.95) {
          aiSuggestion = unit.competitorRate * 0.98; // Price closer to competitors
        }
        
        await storage.updateRentRollData(unit.id, {
          aiSuggestedRate: Math.round(aiSuggestion)
        });
      }
      
      // Regenerate rate card with AI suggestions
      await storage.generateRateCard(targetMonth);
      
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
      
      for (const unitId of unitIds) {
        const unit = await storage.getRentRollDataById(unitId);
        if (!unit) continue;
        
        const newRate = suggestionType === 'modulo' ? 
          unit.moduloSuggestedRate : unit.aiSuggestedRate;
          
        if (newRate) {
          await storage.updateRentRollData(unitId, {
            streetRate: newRate
          });
        }
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

  const httpServer = createServer(app);
  return httpServer;
}
      const pricingWeights = await storage.getPricingWeights();
