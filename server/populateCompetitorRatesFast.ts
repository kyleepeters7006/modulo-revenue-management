import { db } from "./db";
import { competitiveSurveyData, rentRollData } from "@shared/schema";
import { sql } from "drizzle-orm";

// Trilogy average street rates by service line and room type (from analysis)
const trilogyRates: Record<string, Record<string, number>> = {
  AL: {
    "Studio": 6411,
    "One Bedroom": 5173,
    "Two Bedroom": 5535,
    "Companion": 6216,
    "Studio Dlx": 5625
  },
  HC: {
    // HC rates are daily, converting to monthly (x30)
    "Studio": 12019, // 400.64 * 30
    "Companion": 9989,  // 332.95 * 30
    "Studio Dlx": 12670, // 422.33 * 30
    "One Bedroom": 10800, // Estimated
    "Two Bedroom": 11500  // Estimated
  },
  SL: {
    "Studio": 2860,
    "One Bedroom": 3617,
    "Two Bedroom": 3860,
    "Companion": 3087,
    "Studio Dlx": 2604
  },
  VIL: {
    "Studio": 3745,
    "One Bedroom": 2894,
    "Two Bedroom": 3017,
    "Companion": 2800, // Estimated
    "Studio Dlx": 2900  // Estimated
  }
};

// Default rates for unknown combinations
const defaultRates: Record<string, number> = {
  "Studio": 4500,
  "One Bedroom": 4000,
  "Two Bedroom": 4800,
  "Companion": 4200,
  "Studio Dlx": 4300
};

export async function populateCompetitorRatesFast() {
  console.log("🚀 Starting fast populate of competitor rates...");
  
  try {
    // Step 1: Get location to service line mapping
    const locationServiceLines = await db
      .select({
        location: rentRollData.location,
        serviceLine: sql<string>`
          (SELECT service_line 
           FROM rent_roll_data 
           WHERE location = ${rentRollData.location} 
           AND upload_month = '2025-11'
           GROUP BY service_line 
           ORDER BY COUNT(*) DESC 
           LIMIT 1)
        `.as('serviceLine')
      })
      .from(rentRollData)
      .where(sql`upload_month = '2025-11'`)
      .groupBy(rentRollData.location);

    const locationMap = new Map(
      locationServiceLines.map(row => [row.location, row.serviceLine])
    );
    
    console.log(`📋 Processing ${locationMap.size} locations`);
    
    // Step 2: Build UPDATE SQL for all records at once using CASE statements
    let updateCount = 0;
    
    // Process by location for more efficient updates
    for (const [location, serviceLine] of locationMap) {
      const roomTypes = ['Studio', 'One Bedroom', 'Two Bedroom', 'Companion', 'Studio Dlx'];
      
      for (const roomType of roomTypes) {
        // Get base rate for this service line and room type
        let baseRate: number;
        if (trilogyRates[serviceLine] && trilogyRates[serviceLine][roomType]) {
          baseRate = trilogyRates[serviceLine][roomType];
        } else {
          baseRate = defaultRates[roomType] || 4500;
        }
        
        // Competitors should be 18-20% below Trilogy on average
        // Add some variation (15-23% below) for realism
        const discountPercent = 0.18 + (Math.random() * 0.05 - 0.025); // 17.5-20.5% discount average
        const competitorBaseRate = Math.round(baseRate * (1 - discountPercent));
        
        // Add variation for low/high (5-10% spread)
        const spread = 0.075; // 7.5% spread
        const monthlyRateLow = Math.round(competitorBaseRate * (1 - spread/2));
        const monthlyRateHigh = Math.round(competitorBaseRate * (1 + spread/2));
        const monthlyRateAvg = Math.round((monthlyRateLow + monthlyRateHigh) / 2);
        
        // Generate care level rates based on service line
        let careLevel1Rate = 0;
        let careLevel2Rate = 0;
        let careLevel3Rate = 0;
        let careLevel4Rate = 0;
        let medManagementFee = 0;
        
        if (serviceLine === 'AL' || serviceLine === 'HC') {
          // AL and HC have care levels
          careLevel1Rate = 600; // Base care level 1
          careLevel2Rate = 1150; // Base care level 2
          careLevel3Rate = 1750; // Base care level 3
          careLevel4Rate = 2750; // Base care level 4
          medManagementFee = 350; // Medication management
        }
        
        // Calculate total rates including care
        const careLevelAvg = (careLevel1Rate + careLevel2Rate) / 2;
        const totalMonthlyLow = monthlyRateLow + careLevel1Rate;
        const totalMonthlyHigh = monthlyRateHigh + careLevel3Rate;
        const totalMonthlyAvg = monthlyRateAvg + careLevelAvg;
        
        // Community fee (one-time)
        const communityFee = 1750;
        
        // Execute batch update for this location and room type
        const result = await db.execute(sql`
          UPDATE competitive_survey_data
          SET 
            monthly_rate_low = ${monthlyRateLow},
            monthly_rate_high = ${monthlyRateHigh},
            monthly_rate_avg = ${monthlyRateAvg},
            care_fees_low = ${careLevel1Rate},
            care_fees_high = ${careLevel3Rate},
            care_fees_avg = ${careLevelAvg},
            total_monthly_low = ${totalMonthlyLow},
            total_monthly_high = ${totalMonthlyHigh},
            total_monthly_avg = ${totalMonthlyAvg},
            care_level_1_rate = ${careLevel1Rate},
            care_level_2_rate = ${careLevel2Rate},
            care_level_3_rate = ${careLevel3Rate},
            care_level_4_rate = ${careLevel4Rate},
            medication_management_fee = ${medManagementFee},
            community_fee = ${communityFee},
            updated_at = NOW()
          WHERE keystats_location = ${location}
            AND room_type = ${roomType}
        `);
        
        updateCount += result.rowCount || 0;
      }
    }
    
    console.log(`✅ Updated ${updateCount} records`);
    
    // Step 3: Update any remaining records that weren't matched
    const remainingResult = await db.execute(sql`
      UPDATE competitive_survey_data
      SET 
        monthly_rate_low = CASE 
          WHEN room_type = 'Studio' THEN 3600
          WHEN room_type = 'One Bedroom' THEN 3300
          WHEN room_type = 'Two Bedroom' THEN 3900
          WHEN room_type = 'Companion' THEN 3400
          ELSE 3500
        END,
        monthly_rate_high = CASE 
          WHEN room_type = 'Studio' THEN 3900
          WHEN room_type = 'One Bedroom' THEN 3575
          WHEN room_type = 'Two Bedroom' THEN 4225
          WHEN room_type = 'Companion' THEN 3685
          ELSE 3800
        END,
        monthly_rate_avg = CASE 
          WHEN room_type = 'Studio' THEN 3750
          WHEN room_type = 'One Bedroom' THEN 3438
          WHEN room_type = 'Two Bedroom' THEN 4063
          WHEN room_type = 'Companion' THEN 3543
          ELSE 3650
        END,
        care_fees_low = 500,
        care_fees_high = 1500,
        care_fees_avg = 1000,
        total_monthly_low = CASE 
          WHEN room_type = 'Studio' THEN 4100
          WHEN room_type = 'One Bedroom' THEN 3800
          WHEN room_type = 'Two Bedroom' THEN 4400
          WHEN room_type = 'Companion' THEN 3900
          ELSE 4000
        END,
        total_monthly_high = CASE 
          WHEN room_type = 'Studio' THEN 5400
          WHEN room_type = 'One Bedroom' THEN 5075
          WHEN room_type = 'Two Bedroom' THEN 5725
          WHEN room_type = 'Companion' THEN 5185
          ELSE 5300
        END,
        total_monthly_avg = CASE 
          WHEN room_type = 'Studio' THEN 4750
          WHEN room_type = 'One Bedroom' THEN 4438
          WHEN room_type = 'Two Bedroom' THEN 5063
          WHEN room_type = 'Companion' THEN 4543
          ELSE 4650
        END,
        care_level_1_rate = 500,
        care_level_2_rate = 1000,
        care_level_3_rate = 1500,
        care_level_4_rate = 2500,
        medication_management_fee = 300,
        community_fee = 1500,
        updated_at = NOW()
      WHERE monthly_rate_avg IS NULL OR monthly_rate_avg > 10000
    `);
    
    updateCount += remainingResult.rowCount || 0;
    
    // Step 4: Verify the update
    const verificationQuery = await db
      .select({
        totalRecords: sql<number>`COUNT(*)`,
        recordsWithPricing: sql<number>`COUNT(monthly_rate_avg)`,
        avgMonthlyRate: sql<number>`AVG(monthly_rate_avg)`,
        minMonthlyRate: sql<number>`MIN(monthly_rate_avg)`,
        maxMonthlyRate: sql<number>`MAX(monthly_rate_avg)`
      })
      .from(competitiveSurveyData);
    
    const stats = verificationQuery[0];
    
    console.log("✅ Competitor rates populated successfully!");
    console.log(`📊 Statistics:
      - Total records: ${stats.totalRecords}
      - Records with pricing: ${stats.recordsWithPricing}
      - Average monthly rate: $${Math.round(stats.avgMonthlyRate)}
      - Min monthly rate: $${Math.round(stats.minMonthlyRate)}
      - Max monthly rate: $${Math.round(stats.maxMonthlyRate)}`);
    
    return {
      success: true,
      updatedCount: updateCount,
      stats
    };
  } catch (error) {
    console.error("❌ Error populating competitor rates:", error);
    throw error;
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  populateCompetitorRatesFast()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}