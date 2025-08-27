import { db } from "./db";
import { rentRollData, rateCard } from "@shared/schema";

const currentMonth = new Date().toISOString().substring(0, 7);

// Sample rent roll data for testing
const testRentRollData = [
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
    location: "Main Building",
    roomNumber: "103", 
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
    location: "East Wing",
    roomNumber: "201",
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
    location: "West Wing",
    roomNumber: "301",
    roomType: "Studio", 
    occupiedYN: false,
    daysVacant: 156,
    size: "Studio",
    view: null,
    renovated: false,
    streetRate: 3300,
    inHouseRate: 2900,
    careLevel: "Assisted",
    careRate: 1400,
    competitorRate: 3400,
    competitorAvgCareRate: 1350,
    promotionAllowance: 300
  }
];

export async function seedTestData() {
  try {
    console.log('Seeding test rent roll data...');
    
    // Clear existing data for current month
    await db.delete(rentRollData).execute();
    await db.delete(rateCard).execute();
    
    // Insert test data
    await db.insert(rentRollData).values(testRentRollData);
    
    console.log(`Inserted ${testRentRollData.length} test rent roll records`);
    
    // Generate rate card summary
    const roomTypeStats: Record<string, any> = {};
    
    testRentRollData.forEach(unit => {
      if (!roomTypeStats[unit.roomType]) {
        roomTypeStats[unit.roomType] = {
          streetRates: [],
          occupied: 0,
          total: 0
        };
      }
      
      roomTypeStats[unit.roomType].streetRates.push(unit.streetRate);
      roomTypeStats[unit.roomType].total++;
      if (unit.occupiedYN) roomTypeStats[unit.roomType].occupied++;
    });
    
    // Insert rate card summaries
    for (const [roomType, stats] of Object.entries(roomTypeStats)) {
      const avgStreet = stats.streetRates.reduce((sum: number, rate: number) => sum + rate, 0) / stats.streetRates.length;
      
      await db.insert(rateCard).values({
        uploadMonth: currentMonth,
        roomType,
        averageStreetRate: avgStreet,
        averageModuloRate: null,
        averageAiRate: null,
        occupancyCount: stats.occupied,
        totalUnits: stats.total
      });
    }
    
    console.log('Generated rate card summaries');
    console.log('Test data seeded successfully!');
    
  } catch (error) {
    console.error('Error seeding test data:', error);
  }
}

// Run if called directly
if (require.main === module) {
  seedTestData().then(() => process.exit(0));
}