// Demo data for Louisville senior living community
export const demoCompetitors = [
  {
    name: "Forest Springs Health Campus",
    lat: 38.2913,
    lng: -85.6147,
    rates: {
      "Studio": 2857,
      "One Bedroom": 4728,
      "Two Bedroom": 5600,
      "Memory Care": 5200
    },
    avgCareRate: 800,
    googlePlaceId: "ChIJ5eQ5Q1g5ZIgR0YwQ5Q5Q5eQ",
    rating: 4.2,
    driveTimeMinutes: 12,
    address: "8110 Westport Rd, Louisville, KY 40222",
    isTopCompetitor: false
  },
  {
    name: "Belmont Village Senior Living",
    lat: 38.2425,
    lng: -85.6439,
    rates: {
      "Studio": 3500,
      "One Bedroom": 4900,
      "Two Bedroom": 6200,
      "Memory Care": 5800
    },
    avgCareRate: 950,
    googlePlaceId: "ChIJ5eQ5Q1g5ZIgR0YwQ5Q5Q5eR", 
    rating: 4.5,
    driveTimeMinutes: 8,
    address: "4400 Brownsboro Rd, Louisville, KY 40207",
    isTopCompetitor: true
  },
  {
    name: "Brownsboro Park Senior Living",
    lat: 38.2897,
    lng: -85.6367,
    rates: {
      "Studio": 3175,
      "One Bedroom": 4200,
      "Two Bedroom": 5100,
      "Memory Care": 4800
    },
    avgCareRate: 750,
    googlePlaceId: "ChIJ5eQ5Q1g5ZIgR0YwQ5Q5Q5eP",
    rating: 4.0,
    driveTimeMinutes: 6,
    address: "3800 Brownsboro Rd, Louisville, KY 40207",
    isTopCompetitor: false
  },
  {
    name: "Morning Pointe of Louisville",
    lat: 38.2144,
    lng: -85.6781,
    rates: {
      "Studio": 3800,
      "One Bedroom": 4566,
      "Two Bedroom": 5400,
      "Memory Care": 5100
    },
    avgCareRate: 850,
    googlePlaceId: "ChIJ5eQ5Q1g5ZIgR0YwQ5Q5Q5eT",
    rating: 4.0,
    driveTimeMinutes: 15,
    address: "7200 Dixie Hwy, Louisville, KY 40258",
    isTopCompetitor: false
  },
  {
    name: "Masonic Homes Louisville",
    lat: 38.2392,
    lng: -85.5839,
    rates: {
      "Studio": 2950,
      "One Bedroom": 3871,
      "Two Bedroom": 4800,
      "Memory Care": 4500
    },
    avgCareRate: 700,
    googlePlaceId: "ChIJ5eQ5Q1g5ZIgR0YwQ5Q5Q5eU",
    rating: 3.9,
    driveTimeMinutes: 18,
    address: "3506 Frankfort Ave, Louisville, KY 40207",
    isTopCompetitor: false
  }
];

// Current property data for map display
export const currentProperty = {
  name: "Sunset Manor Senior Living",
  lat: 38.2527,
  lng: -85.7585,
  rates: {
    "Studio": 3175,
    "One Bedroom": 4200, 
    "Two Bedroom": 5100,
    "Memory Care": 4800
  },
  avgCareRate: 775,
  address: "1234 Main St, Louisville, KY 40207"
};

export const demoRentRoll = [
  // Assisted Living (AL) - Studio Units
  { unitId: "AL101", occupiedYN: true, baseRent: 3200, careFee: 500, roomType: "Studio", serviceLine: "AL", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "AL102", occupiedYN: true, baseRent: 3000, careFee: 800, roomType: "Studio", serviceLine: "AL", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "AL103", occupiedYN: false, baseRent: 3100, careFee: 0, roomType: "Studio", serviceLine: "AL", competitorBenchmarkRate: 3175, daysVacant: 45, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "AL104", occupiedYN: true, baseRent: 3300, careFee: 600, roomType: "Studio", serviceLine: "AL", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },
  
  // Assisted Living (AL) - One Bedroom Units  
  { unitId: "AL201", occupiedYN: true, baseRent: 4200, careFee: 600, roomType: "One Bedroom", serviceLine: "AL", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "AL202", occupiedYN: true, baseRent: 4400, careFee: 750, roomType: "One Bedroom", serviceLine: "AL", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "AL203", occupiedYN: false, baseRent: 4300, careFee: 0, roomType: "One Bedroom", serviceLine: "AL", competitorBenchmarkRate: 4200, daysVacant: 30, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "AL204", occupiedYN: true, baseRent: 4600, careFee: 850, roomType: "One Bedroom", serviceLine: "AL", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },

  // Assisted Living/Memory Care (AL/MC) - Studio Units
  { unitId: "MC101", occupiedYN: true, baseRent: 3400, careFee: 1200, roomType: "Studio", serviceLine: "AL/MC", competitorBenchmarkRate: 3800, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "MC102", occupiedYN: true, baseRent: 3600, careFee: 1400, roomType: "Studio", serviceLine: "AL/MC", competitorBenchmarkRate: 3800, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "MC103", occupiedYN: false, baseRent: 3500, careFee: 0, roomType: "Studio", serviceLine: "AL/MC", competitorBenchmarkRate: 3800, daysVacant: 25, attributes: { view: false, renovated: true, corner: false } },

  // Assisted Living/Memory Care (AL/MC) - One Bedroom Units
  { unitId: "MC201", occupiedYN: true, baseRent: 4800, careFee: 1200, roomType: "One Bedroom", serviceLine: "AL/MC", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "MC202", occupiedYN: true, baseRent: 5000, careFee: 1500, roomType: "One Bedroom", serviceLine: "AL/MC", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },

  // Health Center (HC) - Studio Units
  { unitId: "HC101", occupiedYN: true, baseRent: 3800, careFee: 2000, roomType: "Studio", serviceLine: "HC", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "HC102", occupiedYN: true, baseRent: 4000, careFee: 2200, roomType: "Studio", serviceLine: "HC", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "HC103", occupiedYN: false, baseRent: 3900, careFee: 0, roomType: "Studio", serviceLine: "HC", competitorBenchmarkRate: 4200, daysVacant: 20, attributes: { view: false, renovated: true, corner: false } },

  // Health Center (HC) - One Bedroom Units
  { unitId: "HC201", occupiedYN: true, baseRent: 5000, careFee: 2400, roomType: "One Bedroom", serviceLine: "HC", competitorBenchmarkRate: 5200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "HC202", occupiedYN: true, baseRent: 5200, careFee: 2600, roomType: "One Bedroom", serviceLine: "HC", competitorBenchmarkRate: 5200, daysVacant: 0, attributes: { view: true, renovated: true, corner: false } },

  // Health Center/Memory Care (HC/MC) - Studio Units
  { unitId: "HCMC101", occupiedYN: true, baseRent: 4200, careFee: 2800, roomType: "Studio", serviceLine: "HC/MC", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "HCMC102", occupiedYN: true, baseRent: 4400, careFee: 3000, roomType: "Studio", serviceLine: "HC/MC", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },

  // Health Center/Memory Care (HC/MC) - One Bedroom Units
  { unitId: "HCMC201", occupiedYN: true, baseRent: 5400, careFee: 3200, roomType: "One Bedroom", serviceLine: "HC/MC", competitorBenchmarkRate: 5800, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "HCMC202", occupiedYN: false, baseRent: 5600, careFee: 0, roomType: "One Bedroom", serviceLine: "HC/MC", competitorBenchmarkRate: 5800, daysVacant: 15, attributes: { view: true, renovated: true, corner: true } },

  // Independent Living (IL) - Studio Units
  { unitId: "IL101", occupiedYN: true, baseRent: 2800, careFee: 0, roomType: "Studio", serviceLine: "IL", competitorBenchmarkRate: 2900, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "IL102", occupiedYN: true, baseRent: 3000, careFee: 0, roomType: "Studio", serviceLine: "IL", competitorBenchmarkRate: 2900, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "IL103", occupiedYN: false, baseRent: 2900, careFee: 0, roomType: "Studio", serviceLine: "IL", competitorBenchmarkRate: 2900, daysVacant: 35, attributes: { view: false, renovated: true, corner: false } },

  // Independent Living (IL) - One Bedroom Units
  { unitId: "IL201", occupiedYN: true, baseRent: 3800, careFee: 0, roomType: "One Bedroom", serviceLine: "IL", competitorBenchmarkRate: 3900, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "IL202", occupiedYN: true, baseRent: 4000, careFee: 0, roomType: "One Bedroom", serviceLine: "IL", competitorBenchmarkRate: 3900, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "IL203", occupiedYN: true, baseRent: 4200, careFee: 0, roomType: "One Bedroom", serviceLine: "IL", competitorBenchmarkRate: 3900, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },

  // Independent Living (IL) - Two Bedroom Units
  { unitId: "IL301", occupiedYN: true, baseRent: 4800, careFee: 0, roomType: "Two Bedroom", serviceLine: "IL", competitorBenchmarkRate: 4900, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "IL302", occupiedYN: true, baseRent: 5200, careFee: 0, roomType: "Two Bedroom", serviceLine: "IL", competitorBenchmarkRate: 4900, daysVacant: 0, attributes: { view: true, renovated: false, corner: true } },
  { unitId: "IL303", occupiedYN: false, baseRent: 5000, careFee: 0, roomType: "Two Bedroom", serviceLine: "IL", competitorBenchmarkRate: 4900, daysVacant: 50, attributes: { view: false, renovated: true, corner: false } },

  // Senior Living (SL) - Studio Units
  { unitId: "SL101", occupiedYN: true, baseRent: 3100, careFee: 300, roomType: "Studio", serviceLine: "SL", competitorBenchmarkRate: 3200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "SL102", occupiedYN: true, baseRent: 3300, careFee: 400, roomType: "Studio", serviceLine: "SL", competitorBenchmarkRate: 3200, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },

  // Senior Living (SL) - One Bedroom Units
  { unitId: "SL201", occupiedYN: true, baseRent: 4100, careFee: 400, roomType: "One Bedroom", serviceLine: "SL", competitorBenchmarkRate: 4100, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "SL202", occupiedYN: true, baseRent: 4300, careFee: 500, roomType: "One Bedroom", serviceLine: "SL", competitorBenchmarkRate: 4100, daysVacant: 0, attributes: { view: true, renovated: true, corner: false } },
  { unitId: "SL203", occupiedYN: false, baseRent: 4200, careFee: 0, roomType: "One Bedroom", serviceLine: "SL", competitorBenchmarkRate: 4100, daysVacant: 40, attributes: { view: false, renovated: true, corner: false } },

  // Senior Living (SL) - Two Bedroom Units
  { unitId: "SL301", occupiedYN: true, baseRent: 5100, careFee: 600, roomType: "Two Bedroom", serviceLine: "SL", competitorBenchmarkRate: 5000, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "SL302", occupiedYN: true, baseRent: 5400, careFee: 700, roomType: "Two Bedroom", serviceLine: "SL", competitorBenchmarkRate: 5000, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "SL303", occupiedYN: true, baseRent: 5600, careFee: 800, roomType: "Two Bedroom", serviceLine: "SL", competitorBenchmarkRate: 5000, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } }
];

export const floorPlanData = {
  Studio: {
    sqft: 450,
    features: ["Kitchenette", "Private Bath", "Walk-in Closet", "Emergency Call System"],
    basePrice: 3175,
    description: "Cozy and efficient studio apartment perfect for independent seniors"
  },
  "One Bedroom": {
    sqft: 650,
    features: ["Full Kitchen", "Separate Bedroom", "Living Area", "Private Bath", "Walk-in Closet", "Balcony/Patio"],
    basePrice: 4200,
    description: "Spacious one-bedroom apartment with separate living and sleeping areas"
  },
  "Two Bedroom": {
    sqft: 950,
    features: ["Full Kitchen", "Two Bedrooms", "Living Room", "Dining Area", "1.5 Baths", "Storage", "Balcony"],
    basePrice: 5100,
    description: "Perfect for couples or those who want extra space for guests"
  },
  "Memory Care": {
    sqft: 400,
    features: ["Secure Environment", "Private Bath", "24-Hour Care", "Specialized Programming", "Safety Features"],
    basePrice: 4800,
    description: "Specialized care environment for residents with memory impairment"
  }
};