/**
 * Script to fix competitor rates by converting daily rates to monthly rates
 * This fixes the issue where AL rates were showing as low as $1,231 
 * because they were stored as daily rates instead of monthly
 */

import { db } from "./db";
import { competitiveSurveyData, rentRollData } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

export async function fixCompetitorRates(clientId?: string) {
  const tenantLabel = clientId ? `clientId=${clientId}` : 'all tenants';
  console.log(`🔧 Starting competitor rate fix (${tenantLabel})...`);
  const clientFilter = clientId ? sql` AND client_id = ${clientId}` : sql``;
  
  try {
    // Step 1: Fix AL/SL/VIL rates in competitive_survey_data that are clearly daily (< $500)
    console.log('\n📊 Step 1: Fixing daily rates stored as monthly in competitive_survey_data...');
    
    const dailyALRates = await db.execute(sql`
      SELECT 
        id, 
        competitor_name, 
        competitor_type, 
        room_type, 
        monthly_rate_avg,
        keystats_location
      FROM competitive_survey_data
      WHERE 
        competitor_type IN ('AL', 'SL', 'VIL', 'IL') 
        AND monthly_rate_avg > 0 
        AND monthly_rate_avg < 500
        ${clientFilter}
    `);
    
    console.log(`Found ${dailyALRates.rows.length} AL/SL/VIL/IL rates that are likely daily rates`);
    
    // Convert these to monthly rates
    const daysPerMonth = 30.44;
    let fixedCount = 0;
    
    for (const rate of dailyALRates.rows) {
      const monthlyRate = rate.monthly_rate_avg * daysPerMonth;
      
      await db.execute(sql`
        UPDATE competitive_survey_data
        SET 
          monthly_rate_avg = ${monthlyRate},
          monthly_rate_low = CASE WHEN monthly_rate_low < 500 THEN monthly_rate_low * ${daysPerMonth} ELSE monthly_rate_low END,
          monthly_rate_high = CASE WHEN monthly_rate_high < 500 THEN monthly_rate_high * ${daysPerMonth} ELSE monthly_rate_high END,
          care_fees_avg = CASE WHEN care_fees_avg < 500 THEN care_fees_avg * ${daysPerMonth} ELSE care_fees_avg END,
          care_level_1_rate = CASE WHEN care_level_1_rate < 500 THEN care_level_1_rate * ${daysPerMonth} ELSE care_level_1_rate END,
          care_level_2_rate = CASE WHEN care_level_2_rate < 500 THEN care_level_2_rate * ${daysPerMonth} ELSE care_level_2_rate END,
          care_level_3_rate = CASE WHEN care_level_3_rate < 500 THEN care_level_3_rate * ${daysPerMonth} ELSE care_level_3_rate END,
          care_level_4_rate = CASE WHEN care_level_4_rate < 500 THEN care_level_4_rate * ${daysPerMonth} ELSE care_level_4_rate END
        WHERE id = ${rate.id}
      `);
      
      console.log(`✅ Fixed ${rate.competitor_type} ${rate.room_type} rate for ${rate.competitor_name}: $${rate.monthly_rate_avg?.toFixed(2)} → $${monthlyRate.toFixed(2)}`);
      fixedCount++;
    }
    
    // Step 2: Also fix HC/SMC rates that are daily (< $1000)
    console.log('\n📊 Step 2: Fixing HC/SMC daily rates...');
    
    const dailyHCRates = await db.execute(sql`
      SELECT 
        id, 
        competitor_name, 
        competitor_type, 
        room_type, 
        monthly_rate_avg
      FROM competitive_survey_data
      WHERE 
        competitor_type IN ('HC', 'SMC') 
        AND monthly_rate_avg > 0 
        AND monthly_rate_avg < 1000
        ${clientFilter}
    `);
    
    console.log(`Found ${dailyHCRates.rows.length} HC/SMC rates that are likely daily rates`);
    
    for (const rate of dailyHCRates.rows) {
      const monthlyRate = rate.monthly_rate_avg * daysPerMonth;
      
      await db.execute(sql`
        UPDATE competitive_survey_data
        SET 
          monthly_rate_avg = ${monthlyRate},
          monthly_rate_low = CASE WHEN monthly_rate_low < 1000 THEN monthly_rate_low * ${daysPerMonth} ELSE monthly_rate_low END,
          monthly_rate_high = CASE WHEN monthly_rate_high < 1000 THEN monthly_rate_high * ${daysPerMonth} ELSE monthly_rate_high END,
          care_fees_avg = CASE WHEN care_fees_avg < 1000 THEN care_fees_avg * ${daysPerMonth} ELSE care_fees_avg END,
          care_level_1_rate = CASE WHEN care_level_1_rate < 1000 THEN care_level_1_rate * ${daysPerMonth} ELSE care_level_1_rate END,
          care_level_2_rate = CASE WHEN care_level_2_rate < 1000 THEN care_level_2_rate * ${daysPerMonth} ELSE care_level_2_rate END,
          care_level_3_rate = CASE WHEN care_level_3_rate < 1000 THEN care_level_3_rate * ${daysPerMonth} ELSE care_level_3_rate END,
          care_level_4_rate = CASE WHEN care_level_4_rate < 1000 THEN care_level_4_rate * ${daysPerMonth} ELSE care_level_4_rate END
        WHERE id = ${rate.id}
      `);
      
      console.log(`✅ Fixed ${rate.competitor_type} ${rate.room_type} rate for ${rate.competitor_name}: $${rate.monthly_rate_avg?.toFixed(2)} → $${monthlyRate.toFixed(2)}`);
      fixedCount++;
    }
    
    // Step 3: Clear competitor rates in rent_roll_data to force recalculation with fixed data
    console.log('\n📊 Step 3: Clearing rent_roll_data competitor rates to force recalculation...');
    
    const clearWhere = clientId ? eq(rentRollData.clientId, clientId) : sql`1=1`;
    await db.update(rentRollData)
      .set({
        competitorRate: null,
        competitorFinalRate: null,
        competitorName: null,
        competitorBaseRate: null
      })
      .where(clearWhere);
    
    console.log(`✅ Cleared competitor rates in rent_roll_data (${tenantLabel})`);
    
    // Summary
    console.log('\n✅ Fix complete!');
    console.log(`- Fixed ${dailyALRates.rows.length} AL/SL/VIL/IL daily rates`);
    console.log(`- Fixed ${dailyHCRates.rows.length} HC/SMC daily rates`);
    console.log(`- Total fixes: ${dailyALRates.rows.length + dailyHCRates.rows.length}`);
    console.log('\nNext steps:');
    console.log('1. Run competitor rate matching to repopulate rent_roll_data with corrected rates');
    console.log('2. Verify rates in the overview dashboard');
    
    return {
      success: true,
      fixedAL: dailyALRates.rows.length,
      fixedHC: dailyHCRates.rows.length,
      totalFixed: dailyALRates.rows.length + dailyHCRates.rows.length
    };
    
  } catch (error) {
    console.error('❌ Error fixing competitor rates:', error);
    throw error;
  }
}

