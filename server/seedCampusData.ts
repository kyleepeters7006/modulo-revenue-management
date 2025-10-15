import { db } from "./db";
import { locations, streetRates, specialRates } from "@shared/schema";
import { campusMapping } from "./campusMapping";
import { eq } from "drizzle-orm";

export async function seedCampusData() {
  console.log("Starting campus data seed...");
  
  try {
    // Use upsert logic to update existing or insert new campuses
    for (const campus of campusMapping) {
      // Check if location exists
      const existing = await db.select().from(locations).where(eq(locations.name, campus.keyStatsName)).limit(1);
      
      if (existing.length > 0) {
        // Update existing location with MatrixCare mapping
        await db.update(locations)
          .set({
            matrixCareNameHC: campus.matrixCareNameHC,
            matrixCareNameAL: campus.matrixCareNameAL,
            matrixCareNameIL: campus.matrixCareNameIL,
            customerFacilityIdHC: campus.customerFacilityIdHC,
            customerFacilityIdAL: campus.customerFacilityIdAL,
            customerFacilityIdIL: campus.customerFacilityIdIL,
            locationCode: campus.locationCode,
            region: getRegionFromLocation(campus.keyStatsName),
            division: getDivisionFromLocation(campus.keyStatsName),
            state: getStateFromLocation(campus.keyStatsName),
          })
          .where(eq(locations.name, campus.keyStatsName));
      } else {
        // Insert new location
        await db.insert(locations).values({
          name: campus.keyStatsName,
          matrixCareNameHC: campus.matrixCareNameHC,
          matrixCareNameAL: campus.matrixCareNameAL,
          matrixCareNameIL: campus.matrixCareNameIL,
          customerFacilityIdHC: campus.customerFacilityIdHC,
          customerFacilityIdAL: campus.customerFacilityIdAL,
          customerFacilityIdIL: campus.customerFacilityIdIL,
          locationCode: campus.locationCode,
          region: getRegionFromLocation(campus.keyStatsName),
          division: getDivisionFromLocation(campus.keyStatsName),
          state: getStateFromLocation(campus.keyStatsName),
          totalUnits: Math.floor(Math.random() * 60) + 40, // Placeholder units between 40-100
        });
      }
    }
    
    console.log(`✅ Inserted ${campusMapping.length} campus locations`);
    
  } catch (error) {
    console.error("Error seeding campus data:", error);
    throw error;
  }
}

// Helper functions to determine region/division/state from campus name
function getRegionFromLocation(name: string): string {
  if (name.includes("Indianapolis") || name.includes("Kokomo") || name.includes("Bloomington") ||
      name.includes("Columbus") || name.includes("Batesville") || name.includes("Lawrenceburg") ||
      name.includes("Greensburg") || name.includes("Marion") || name.includes("Shelbyville") ||
      name.includes("Madison") || name.includes("Rensselaer")) {
    return "Indiana";
  } else if (name.includes("Lexington") || name.includes("Louisville") || name.includes("Georgetown") ||
             name.includes("Cynthiana") || name.includes("Springfield")) {
    return "Kentucky";
  } else if (name.includes("Ashland") || name.includes("Canton") || name.includes("Delaware") ||
             name.includes("Mansfield") || name.includes("Sandusky") || name.includes("Ontario") ||
             name.includes("Findlay") || name.includes("Mount Vernon") || name.includes("Hamilton")) {
    return "Ohio";
  }
  return "Central";
}

function getDivisionFromLocation(name: string): string {
  if (name.includes("Indianapolis")) return "Indianapolis Metro";
  if (name.includes("Louisville")) return "Louisville Metro";
  if (name.includes("Lexington")) return "Lexington Metro";
  if (name.includes("Columbus") || name.includes("Batesville") || name.includes("Lawrenceburg") || 
      name.includes("Greensburg") || name.includes("Madison")) return "Southeast Indiana";
  if (name.includes("Kokomo") || name.includes("Marion") || name.includes("Rensselaer") || 
      name.includes("Shelbyville") || name.includes("Bloomington")) return "Central Indiana";
  if (name.includes("Canton") || name.includes("Ashland") || name.includes("Mansfield")) return "Northeast Ohio";
  if (name.includes("Delaware") || name.includes("Sandusky") || name.includes("Ontario") || 
      name.includes("Findlay") || name.includes("Mount Vernon") || name.includes("Hamilton")) return "Northwest Ohio";
  if (name.includes("Georgetown") || name.includes("Cynthiana") || name.includes("Springfield")) return "Central Kentucky";
  return "Other";
}

function getStateFromLocation(name: string): string {
  if (name.includes("Indianapolis") || name.includes("Kokomo") || name.includes("Bloomington") ||
      name.includes("Columbus") || name.includes("Batesville") || name.includes("Lawrenceburg") ||
      name.includes("Greensburg") || name.includes("Marion") || name.includes("Shelbyville") ||
      name.includes("Madison") || name.includes("Rensselaer")) {
    return "IN";
  } else if (name.includes("Lexington") || name.includes("Louisville") || name.includes("Georgetown") ||
             name.includes("Cynthiana") || name.includes("Springfield")) {
    return "KY";
  } else if (name.includes("Ashland") || name.includes("Canton") || name.includes("Delaware") ||
             name.includes("Mansfield") || name.includes("Sandusky") || name.includes("Ontario") ||
             name.includes("Findlay") || name.includes("Mount Vernon") || name.includes("Hamilton")) {
    return "OH";
  }
  return "IN";
}

// Run the seed if executed directly
seedCampusData()
  .then(() => {
    console.log("Campus data seed completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Campus data seed failed:", error);
    process.exit(1);
  });