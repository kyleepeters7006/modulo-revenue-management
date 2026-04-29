import { generateAllDemoData } from './generateDemoData';
import { storage } from './storage';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';

export async function processDemoData() {
  try {
    console.log('Starting demo data generation and processing...');
    
    // Generate all demo data
    const { portfolioFile, portfolioData, competitorData, locationsData } = await generateAllDemoData();
    
    // Clear existing data
    console.log('Clearing existing data...');
    await storage.clearAllData();
    
    // Process locations first
    console.log('Processing locations data...');
    for (const location of locationsData) {
      await storage.createLocation(location);
    }
    
    // Process portfolio data through the upload system
    console.log('Processing portfolio data...');
    const csvContent = fs.readFileSync(portfolioFile, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    // Group by month for processing
    const dataByMonth = new Map<string, any[]>();
    records.forEach((record: any) => {
      const month = record.Date;
      if (!dataByMonth.has(month)) {
        dataByMonth.set(month, []);
      }
      dataByMonth.get(month)!.push(record);
    });
    
    // Process each month's data
    for (const [month, monthData] of dataByMonth) {
      const [monthNum, day, year] = month.split('/');
      const monthKey = `${year}-${monthNum.padStart(2, '0')}`;
      
      console.log(`Processing data for ${monthKey}: ${monthData.length} units`);
      
      // Transform data to match expected format
      const transformedData = monthData.map((row: any, index: number) => ({
        date: month,
        region: row.Region,
        division: row.Division,
        location: row.Location,
        locationId: locationsData.find(loc => loc.name === row.Location)?.id || '',
        unitId: row["Unit ID"],
        serviceLine: row["Service Line"],
        roomType: row["Room Type"],
        roomNumber: row["Unit ID"], // Use unit ID as room number
        occupiedYN: row["Occupancy Status"] === "Occupied",
        streetRate: parseFloat(row["Market Rate"]) || 0,
        marketRate: parseFloat(row["Market Rate"]) || 0,
        currentRate: parseFloat(row["Current Rate"]) || 0,
        inHouseRate: parseFloat(row["Current Rate"]) || 0,
        occupancyStatus: row["Occupancy Status"],
        daysVacant: parseInt(row["Days Vacant"]) || 0,
        attribute: row["Attribute (A/B/C)"],
        squareFootage: parseInt(row["Square Footage"]) || 0,
        lastRenovated: row["Last Renovated"],
        floorNumber: parseInt(row["Floor Number"]) || 1,
        size: row["Room Type"],
        renovated: row["Last Renovated"] && new Date(row["Last Renovated"]).getFullYear() >= 2020,
        competitorRate: parseFloat(row["Market Rate"]) * 1.05, // Add competitor rate
        notes: row.Notes || ''
      }));
      
      // Store the data
      try {
        await storage.uploadRentRollData(monthKey, transformedData);
        console.log(`✓ Successfully stored data for ${monthKey}`);
      } catch (error) {
        console.error(`✗ Failed to store data for ${monthKey}:`, error);
      }
    }
    
    // Process competitor data
    console.log('Processing competitor data...');
    for (const competitor of competitorData) {
      await storage.createCompetitor({
        name: competitor.name,
        location: competitor.location,
        lat: competitor.latitude, // Use 'lat' instead of 'latitude'
        lng: competitor.longitude, // Use 'lng' instead of 'longitude'
        serviceLine: competitor.service_line,
        averageRate: competitor.average_rate,
        occupancy: parseFloat(competitor.occupancy),
        totalUnits: competitor.total_units,
        distanceMiles: competitor.distance_miles,
        rating: parseFloat(competitor.rating),
        lastUpdated: competitor.last_updated,
        website: competitor.website,
        phone: competitor.phone,
        amenities: competitor.amenities
      });
    }
    
    // Initialize default assumptions if needed
    const assumptions = await storage.getAssumptions();
    if (!assumptions || assumptions.length === 0) {
      await storage.updateAssumptions({
        inflationRate: 3.5,
        expenseGrowth: 4.0,
        targetOccupancy: 90,
        renovationCost: 5000,
        marketGrowthRate: 2.5
      });
    }
    
    // Initialize default pricing weights if needed
    const weights = await storage.getPricingWeights();
    if (!weights) {
      await storage.updatePricingWeights({
        occupancy: 30,
        competitor: 25,
        seasonality: 15,
        attribute: 20,
        daysVacant: 10
      });
    }
    
    // Initialize default guardrails if needed
    const guardrails = await storage.getGuardrails();
    if (!guardrails || guardrails.length === 0) {
      await storage.updateGuardrails({
        maxIncreasePercent: 10,
        maxDecreasePercent: 5,
        minOccupancyThreshold: 70,
        maxDaysVacantBeforeDiscount: 30,
        competitorPremiumPercent: 5
      });
    }
    
    // Generate initial rate card summaries
    console.log('Generating rate card summaries...');
    const months = Array.from(dataByMonth.keys());
    for (const month of months) {
      const [monthNum, , year] = month.split('/');
      const monthKey = `${year}-${monthNum.padStart(2, '0')}`;
      
      const monthData = await storage.getRentRollDataByMonth(monthKey);
      
      // Calculate summary statistics by service line
      const summaryByServiceLine = new Map<string, any>();
      
      monthData.forEach((unit: any) => {
        const key = unit.serviceLine;
        if (!summaryByServiceLine.has(key)) {
          summaryByServiceLine.set(key, {
            serviceLine: key,
            totalUnits: 0,
            occupiedUnits: 0,
            avgMarketRate: 0,
            avgCurrentRate: 0,
            totalMarketRate: 0,
            totalCurrentRate: 0,
            avgDaysVacant: 0,
            totalDaysVacant: 0,
            vacantUnits: 0
          });
        }
        
        const summary = summaryByServiceLine.get(key)!;
        summary.totalUnits++;
        summary.totalMarketRate += unit.marketRate;
        
        if (unit.occupancyStatus === 'Occupied') {
          summary.occupiedUnits++;
          summary.totalCurrentRate += unit.currentRate;
        } else {
          summary.vacantUnits++;
          summary.totalDaysVacant += unit.daysVacant;
        }
      });
      
      // Calculate averages and save
      for (const [serviceLine, summary] of summaryByServiceLine) {
        summary.avgMarketRate = Math.round(summary.totalMarketRate / summary.totalUnits);
        summary.avgCurrentRate = summary.occupiedUnits > 0 ? 
          Math.round(summary.totalCurrentRate / summary.occupiedUnits) : 0;
        summary.avgDaysVacant = summary.vacantUnits > 0 ?
          Math.round(summary.totalDaysVacant / summary.vacantUnits) : 0;
        summary.occupancyRate = Math.round((summary.occupiedUnits / summary.totalUnits) * 100);
        
        await storage.createRateCard({
          month: monthKey,
          serviceLine: summary.serviceLine,
          totalUnits: summary.totalUnits,
          occupiedUnits: summary.occupiedUnits,
          occupancyRate: summary.occupancyRate,
          avgMarketRate: summary.avgMarketRate,
          avgCurrentRate: summary.avgCurrentRate,
          avgDaysVacant: summary.avgDaysVacant,
          monthlyRevenue: summary.totalCurrentRate,
          suggestedRate: Math.round(summary.avgMarketRate * 1.02), // 2% premium suggestion
          aiRecommendation: `Optimize pricing for ${serviceLine} based on ${summary.occupancyRate}% occupancy`
        });
      }
    }
    
    console.log('Demo data processing complete!');
    
    return {
      success: true,
      portfolioRecords: portfolioData.length,
      competitors: competitorData.length,
      locations: locationsData.length,
      months: months.length
    };
    
  } catch (error) {
    console.error('Error processing demo data:', error);
    throw error;
  }
}


