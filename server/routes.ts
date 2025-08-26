import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import multer from "multer";
import Papa from "papaparse";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { 
  insertRentRollDataSchema, 
  insertAssumptionsSchema, 
  insertPricingWeightsSchema,
  insertCompetitorSchema,
  insertGuardrailsSchema,
  insertMlModelSchema
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
      const competitor = await storage.createOrUpdateCompetitor(validatedData);
      res.json({ ok: true, competitor });
    } catch (error) {
      res.status(400).json({ error: "Invalid competitor data" });
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
      const rentRollData = await storage.getRentRollData();
      const weights = await storage.getCurrentWeights();
      const competitors = await storage.getCompetitors();
      
      // Generate recommendations based on algorithm
      const recommendations = await Promise.all(rentRollData.map(async unit => {
        let recommendedRent = unit.baseRent;
        let rationale = "Base calculation";

        if (weights) {
          // Apply occupancy pressure
          if (!unit.occupiedYN && (unit.daysVacant || 0) > 30) {
            recommendedRent *= 0.95; // 5% reduction for long vacancy
            rationale = "Long vacancy suggests price reduction";
          } else if (unit.occupiedYN) {
            recommendedRent *= 1.05; // 5% increase for occupied units
            rationale = "Occupied unit can support higher rates";
          }

          // Apply competitor rates
          if (unit.competitorBenchmarkRate) {
            const competitorDiff = (unit.competitorBenchmarkRate - unit.baseRent) / unit.baseRent;
            recommendedRent += (competitorDiff * recommendedRent * weights.competitorRates / 100);
          }

          // Apply market sentiment using real S&P 500 data
          const sp500Return = await fetchSP500Data();
          if (sp500Return > 1) {
            recommendedRent *= 1.02; // Positive market allows premium
            rationale += ", bullish market conditions";
          } else if (sp500Return < -1) {
            recommendedRent *= 0.98; // Negative market requires discount
            rationale += ", bearish market conditions";
          }
        }

        return {
          Unit_ID: unit.unitId,
          Room_Type: unit.roomType,
          Occupied_YN: unit.occupiedYN ? 'Y' : 'N',
          Days_Vacant: unit.daysVacant || 0,
          Fence_Price: unit.baseRent,
          Competitor_Benchmark_Rate: unit.competitorBenchmarkRate,
          Recommended_Rent: Math.round(recommendedRent),
          ML_Suggested_Rent: null, // Would be populated by trained ML model
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

  // AI suggestions endpoint
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
        marketSentiment: marketData.lastMonthReturnPct > 1 ? "bullish" : marketData.lastMonthReturnPct < -1 ? "bearish" : "neutral"
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
      res.status(500).json({ error: `AI request failed: ${error.message}` });
    }
  });

  // ML training endpoint
  app.post("/api/ml/train", upload.single("file"), async (req, res) => {
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
      res.status(500).json({ error: "ML training failed" });
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

  const httpServer = createServer(app);
  return httpServer;
}
