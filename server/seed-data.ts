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
    avgCareRate: 800
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
    avgCareRate: 950
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
    avgCareRate: 750
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
    avgCareRate: 850
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
    avgCareRate: 700
  }
];

export const demoRentRoll = [
  // Studio Units (10 units)
  { unitId: "101", occupiedYN: true, baseRent: 3200, careFee: 500, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "102", occupiedYN: true, baseRent: 3000, careFee: 800, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "103", occupiedYN: false, baseRent: 3100, careFee: 0, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 45, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "104", occupiedYN: true, baseRent: 3300, careFee: 600, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },
  { unitId: "201", occupiedYN: false, baseRent: 3050, careFee: 0, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 15, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "202", occupiedYN: true, baseRent: 3150, careFee: 900, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "203", occupiedYN: true, baseRent: 3000, careFee: 400, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: false, renovated: false, corner: true } },
  { unitId: "204", occupiedYN: true, baseRent: 3250, careFee: 700, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: true, renovated: true, corner: false } },
  { unitId: "301", occupiedYN: false, baseRent: 3100, careFee: 0, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 60, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "302", occupiedYN: true, baseRent: 3200, careFee: 550, roomType: "Studio", competitorBenchmarkRate: 3175, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },

  // One Bedroom Units (15 units)
  { unitId: "105", occupiedYN: true, baseRent: 4200, careFee: 600, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "106", occupiedYN: true, baseRent: 4400, careFee: 750, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "107", occupiedYN: false, baseRent: 4300, careFee: 0, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 30, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "108", occupiedYN: true, baseRent: 4600, careFee: 850, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },
  { unitId: "205", occupiedYN: true, baseRent: 4150, careFee: 500, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "206", occupiedYN: true, baseRent: 4350, careFee: 900, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "207", occupiedYN: false, baseRent: 4250, careFee: 0, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 90, attributes: { view: false, renovated: false, corner: true } },
  { unitId: "208", occupiedYN: true, baseRent: 4500, careFee: 700, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: true, corner: false } },
  { unitId: "305", occupiedYN: true, baseRent: 4200, careFee: 650, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "306", occupiedYN: true, baseRent: 4450, careFee: 800, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "307", occupiedYN: true, baseRent: 4300, careFee: 550, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "308", occupiedYN: false, baseRent: 4550, careFee: 0, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 20, attributes: { view: true, renovated: true, corner: true } },
  { unitId: "405", occupiedYN: true, baseRent: 4100, careFee: 450, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "406", occupiedYN: true, baseRent: 4400, careFee: 750, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "407", occupiedYN: true, baseRent: 4250, careFee: 600, roomType: "One Bedroom", competitorBenchmarkRate: 4200, daysVacant: 0, attributes: { view: false, renovated: true, corner: false } },

  // Two Bedroom Units (10 units)
  { unitId: "109", occupiedYN: true, baseRent: 5200, careFee: 700, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "110", occupiedYN: true, baseRent: 5500, careFee: 850, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: true, renovated: false, corner: true } },
  { unitId: "209", occupiedYN: false, baseRent: 5300, careFee: 0, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 35, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "210", occupiedYN: true, baseRent: 5700, careFee: 950, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },
  { unitId: "309", occupiedYN: true, baseRent: 5150, careFee: 600, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "310", occupiedYN: true, baseRent: 5450, careFee: 800, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "409", occupiedYN: true, baseRent: 5250, careFee: 700, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "410", occupiedYN: false, baseRent: 5600, careFee: 0, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 50, attributes: { view: true, renovated: true, corner: true } },
  { unitId: "509", occupiedYN: true, baseRent: 5100, careFee: 550, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "510", occupiedYN: true, baseRent: 5400, careFee: 750, roomType: "Two Bedroom", competitorBenchmarkRate: 5100, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },

  // Memory Care Units (5 units)
  { unitId: "MC01", occupiedYN: true, baseRent: 4800, careFee: 1200, roomType: "Memory Care", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } },
  { unitId: "MC02", occupiedYN: true, baseRent: 5000, careFee: 1400, roomType: "Memory Care", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: true, renovated: false, corner: false } },
  { unitId: "MC03", occupiedYN: false, baseRent: 4900, careFee: 0, roomType: "Memory Care", competitorBenchmarkRate: 4800, daysVacant: 25, attributes: { view: false, renovated: true, corner: false } },
  { unitId: "MC04", occupiedYN: true, baseRent: 5100, careFee: 1500, roomType: "Memory Care", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: true, renovated: true, corner: true } },
  { unitId: "MC05", occupiedYN: true, baseRent: 4850, careFee: 1300, roomType: "Memory Care", competitorBenchmarkRate: 4800, daysVacant: 0, attributes: { view: false, renovated: false, corner: false } }
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