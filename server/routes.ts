import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import Papa from "papaparse";
import { 
  insertRentRollDataSchema, 
  insertAssumptionsSchema, 
  insertPricingWeightsSchema,
  insertCompetitorSchema,
  insertGuardrailsSchema,
  insertMlModelSchema
} from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });

// Mock market data (in real app would use external API)
let marketData = {
  lastMonthReturnPct: 2.3
};

export async function registerRoutes(app: Express): Promise<Server> {
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

  // Market data endpoint
  app.get("/api/market", async (req, res) => {
    res.json({
      last_month_return_pct: marketData.lastMonthReturnPct
    });
  });

  app.post("/api/market/refresh", async (req, res) => {
    // In real implementation, would fetch from external API (Yahoo Finance, etc.)
    marketData.lastMonthReturnPct = Math.random() * 5 - 2.5; // Random between -2.5% and 2.5%
    res.json({
      last_month_return_pct: marketData.lastMonthReturnPct
    });
  });

  // Revenue series for chart
  app.get("/api/series", async (req, res) => {
    try {
      const assumptions = await storage.getCurrentAssumptions();
      const rentRollData = await storage.getRentRollData();
      
      if (!assumptions || rentRollData.length === 0) {
        return res.json({
          labels: [],
          revenue: [],
          sp500: []
        });
      }

      const startingRevenue = rentRollData.reduce((sum, unit) => sum + (unit.baseRent + (unit.careFee || 0)), 0);
      const labels = [];
      const revenue = [];
      const sp500 = [];

      // Always show trailing 12 months
      for (let i = 0; i < 12; i++) {
        const date = new Date();
        date.setMonth(date.getMonth() - 11 + i);
        labels.push(date.toISOString().substring(0, 7));
        
        const revenueValue = startingRevenue * Math.pow(1 + assumptions.revenueMonthlyGrowthPct / 100, i);
        const sp500Value = startingRevenue * Math.pow(1 + assumptions.sp500MonthlyReturnPct / 100, i);
        
        revenue.push(revenueValue);
        sp500.push(sp500Value);
      }

      res.json({ labels, revenue, sp500 });
    } catch (error) {
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
      const recommendations = rentRollData.map(unit => {
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

          // Apply market sentiment
          if (marketData.lastMonthReturnPct > 1) {
            recommendedRent *= 1.02; // Positive market allows premium
            rationale += ", bullish market conditions";
          } else if (marketData.lastMonthReturnPct < -1) {
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
      });

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

  const httpServer = createServer(app);
  return httpServer;
}
