// Check AL rates in overview data
import fetch from 'node-fetch';

async function checkRates() {
  try {
    const response = await fetch('http://localhost:5000/api/overview');
    const data = await response.json();
    
    console.log('\n=== AL SERVICE LINE OVERVIEW ===');
    const alData = data.serviceLineOverview?.find(sl => sl.serviceType === 'AL');
    if (alData) {
      console.log(`Average Competitor Rate: $${alData.slAvgCompetitorRate?.toFixed(2) || 'N/A'}`);
      console.log(`Unit Count: ${alData.slUnitCount || 0}`);
      console.log(`Occupancy: ${alData.slOccupancy?.toFixed(2) || 0}%`);
    }
    
    console.log('\n=== AL STUDIO ROOM TYPE ===');
    const alStudio = data.occupancyByRoomType?.find(rt => rt.roomType === 'Studio' && rt.serviceType?.includes('AL'));
    if (alStudio) {
      console.log(`Average Competitor Rate: $${alStudio.avgCompetitorRate?.toFixed(2) || 'N/A'}`);
      console.log(`Average Market Rate: $${alStudio.avgMarketRate?.toFixed(2) || 'N/A'}`);
      console.log(`Average Current Rate: $${alStudio.avgCurrentRate?.toFixed(2) || 'N/A'}`);
    }
    
    // Check for any suspiciously low rates
    console.log('\n=== CHECKING FOR LOW RATES ===');
    let hasLowRates = false;
    
    if (alData?.slAvgCompetitorRate < 2000) {
      console.log(`⚠️  WARNING: AL service line avg competitor rate is too low: $${alData.slAvgCompetitorRate?.toFixed(2)}`);
      hasLowRates = true;
    }
    
    if (alStudio?.avgCompetitorRate < 2000) {
      console.log(`⚠️  WARNING: AL Studio avg competitor rate is too low: $${alStudio.avgCompetitorRate?.toFixed(2)}`);
      hasLowRates = true;
    }
    
    if (!hasLowRates) {
      console.log('✅ All AL rates appear reasonable (>$2000/month)');
    }
    
  } catch (error) {
    console.error('Error fetching overview data:', error);
  }
}

checkRates();