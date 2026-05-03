import { db } from './db';
import { locations, rentRollData, competitiveSurveyData, inquiryMetrics } from '@shared/schema';
import { eq } from 'drizzle-orm';

// ─────────────────────────────────────────────
// LOCATION DEFINITIONS — 50 fictional senior living communities
// ─────────────────────────────────────────────
const DEMO_LOCATIONS = [
  // East / New England (6)
  { name: 'Burlington - 201', region: 'East', division: 'New England', lat: 44.4759, lng: -73.2121, size: 'medium' },
  { name: 'Concord - 202', region: 'East', division: 'New England', lat: 43.2081, lng: -71.5376, size: 'small' },
  { name: 'Portland - 203', region: 'East', division: 'New England', lat: 43.6591, lng: -70.2568, size: 'large' },
  { name: 'Providence - 204', region: 'East', division: 'New England', lat: 41.8240, lng: -71.4128, size: 'medium' },
  { name: 'Hartford - 205', region: 'East', division: 'New England', lat: 41.7658, lng: -72.6851, size: 'large' },
  { name: 'Springfield - 206', region: 'East', division: 'New England', lat: 42.1015, lng: -72.5898, size: 'small' },
  // East / Mid-Atlantic (6)
  { name: 'Allentown - 211', region: 'East', division: 'Mid-Atlantic', lat: 40.6084, lng: -75.4902, size: 'medium' },
  { name: 'Wilmington - 212', region: 'East', division: 'Mid-Atlantic', lat: 39.7447, lng: -75.5484, size: 'large' },
  { name: 'Annapolis - 213', region: 'East', division: 'Mid-Atlantic', lat: 38.9784, lng: -76.4922, size: 'small' },
  { name: 'Trenton - 214', region: 'East', division: 'Mid-Atlantic', lat: 40.2171, lng: -74.7429, size: 'medium' },
  { name: 'Albany - 215', region: 'East', division: 'Mid-Atlantic', lat: 42.6526, lng: -73.7562, size: 'large' },
  { name: 'Frederick - 216', region: 'East', division: 'Mid-Atlantic', lat: 39.4143, lng: -77.4105, size: 'small' },
  // East / Southeast (6)
  { name: 'Savannah - 221', region: 'East', division: 'Southeast', lat: 32.0835, lng: -81.0998, size: 'medium' },
  { name: 'Columbia - 222', region: 'East', division: 'Southeast', lat: 34.0007, lng: -81.0348, size: 'large' },
  { name: 'Wilmington SE - 223', region: 'East', division: 'Southeast', lat: 34.2257, lng: -77.9447, size: 'small' },
  { name: 'Greensboro - 224', region: 'East', division: 'Southeast', lat: 36.0726, lng: -79.7920, size: 'medium' },
  { name: 'Roanoke - 225', region: 'East', division: 'Southeast', lat: 37.2710, lng: -79.9414, size: 'large' },
  { name: 'Charleston - 226', region: 'East', division: 'Southeast', lat: 32.7765, lng: -79.9311, size: 'small' },
  // Central / Great Lakes (6)
  { name: 'Kalamazoo - 301', region: 'Central', division: 'Great Lakes', lat: 42.2917, lng: -85.5872, size: 'medium' },
  { name: 'Racine - 302', region: 'Central', division: 'Great Lakes', lat: 42.7261, lng: -87.7829, size: 'small' },
  { name: 'Rockford - 303', region: 'Central', division: 'Great Lakes', lat: 42.2711, lng: -89.0940, size: 'large' },
  { name: 'South Bend - 304', region: 'Central', division: 'Great Lakes', lat: 41.6764, lng: -86.2520, size: 'medium' },
  { name: 'Green Bay - 305', region: 'Central', division: 'Great Lakes', lat: 44.5133, lng: -88.0133, size: 'large' },
  { name: 'Flint - 306', region: 'Central', division: 'Great Lakes', lat: 43.0125, lng: -83.6875, size: 'small' },
  // Central / Midwest (6)
  { name: 'Peoria - 311', region: 'Central', division: 'Midwest', lat: 40.6936, lng: -89.5890, size: 'medium' },
  { name: 'Dubuque - 312', region: 'Central', division: 'Midwest', lat: 42.5006, lng: -90.6646, size: 'small' },
  { name: 'Springfield IL - 313', region: 'Central', division: 'Midwest', lat: 39.7817, lng: -89.6501, size: 'large' },
  { name: 'Davenport - 314', region: 'Central', division: 'Midwest', lat: 41.5236, lng: -90.5776, size: 'medium' },
  { name: 'Bloomington - 315', region: 'Central', division: 'Midwest', lat: 40.4842, lng: -88.9937, size: 'small' },
  { name: 'Cedar Rapids - 316', region: 'Central', division: 'Midwest', lat: 41.9779, lng: -91.6656, size: 'large' },
  // Central / Plains (6)
  { name: 'Topeka - 321', region: 'Central', division: 'Plains', lat: 39.0558, lng: -95.6894, size: 'medium' },
  { name: 'Sioux Falls - 322', region: 'Central', division: 'Plains', lat: 43.5446, lng: -96.7311, size: 'large' },
  { name: 'Lincoln - 323', region: 'Central', division: 'Plains', lat: 40.8136, lng: -96.7026, size: 'small' },
  { name: 'Fargo - 324', region: 'Central', division: 'Plains', lat: 46.8772, lng: -96.7898, size: 'medium' },
  { name: 'Wichita - 325', region: 'Central', division: 'Plains', lat: 37.6872, lng: -97.3301, size: 'large' },
  { name: 'Bismarck - 326', region: 'Central', division: 'Plains', lat: 46.8083, lng: -100.7837, size: 'small' },
  // West / Southwest (5)
  { name: 'Tucson - 401', region: 'West', division: 'Southwest', lat: 32.2226, lng: -110.9747, size: 'large' },
  { name: 'Albuquerque - 402', region: 'West', division: 'Southwest', lat: 35.0853, lng: -106.6056, size: 'medium' },
  { name: 'El Paso - 403', region: 'West', division: 'Southwest', lat: 31.7619, lng: -106.4850, size: 'small' },
  { name: 'Mesa - 404', region: 'West', division: 'Southwest', lat: 33.4152, lng: -111.8315, size: 'large' },
  { name: 'Santa Fe - 405', region: 'West', division: 'Southwest', lat: 35.6869, lng: -105.9378, size: 'medium' },
  // West / Pacific (5)
  { name: 'Eugene - 411', region: 'West', division: 'Pacific', lat: 44.0521, lng: -123.0868, size: 'medium' },
  { name: 'Spokane - 412', region: 'West', division: 'Pacific', lat: 47.6588, lng: -117.4260, size: 'large' },
  { name: 'Fresno - 413', region: 'West', division: 'Pacific', lat: 36.7468, lng: -119.7726, size: 'small' },
  { name: 'Tacoma - 414', region: 'West', division: 'Pacific', lat: 47.2529, lng: -122.4443, size: 'large' },
  { name: 'Bakersfield - 415', region: 'West', division: 'Pacific', lat: 35.3733, lng: -119.0187, size: 'medium' },
  // West / Mountain (4)
  { name: 'Boise - 421', region: 'West', division: 'Mountain', lat: 43.6150, lng: -116.2023, size: 'medium' },
  { name: 'Billings - 422', region: 'West', division: 'Mountain', lat: 45.7833, lng: -108.5007, size: 'small' },
  { name: 'Colorado Springs - 423', region: 'West', division: 'Mountain', lat: 38.8339, lng: -104.8214, size: 'large' },
  { name: 'Reno - 424', region: 'West', division: 'Mountain', lat: 39.5296, lng: -119.8138, size: 'medium' },
];

// Service line configs per campus size
const SIZE_SERVICE_LINES: Record<string, string[]> = {
  small:  ['HC', 'AL'],
  medium: ['HC', 'HC/MC', 'AL', 'AL/MC', 'SL'],
  large:  ['HC', 'HC/MC', 'AL', 'AL/MC', 'SL', 'VIL'],
};

// `size` column in rent_roll_data = room size name
const SL_ROOM_SIZES: Record<string, string[]> = {
  'HC':    ['Studio', 'Companion'],
  'HC/MC': ['Studio', 'Companion'],
  'AL':    ['Studio', 'One Bedroom', 'Companion'],
  'AL/MC': ['Studio', 'One Bedroom', 'Companion'],
  'SL':    ['One Bedroom', 'Two Bedroom'],
  'VIL':   ['One Bedroom', 'Two Bedroom'],
};

// Units per size per campus-size per service-line
const UNIT_COUNTS: Record<string, Record<string, Record<string, number>>> = {
  small: {
    HC:     { Studio: 12, Companion: 18 },
    AL:     { Studio: 10, 'One Bedroom': 8, Companion: 12 },
  },
  medium: {
    HC:     { Studio: 18, Companion: 28 },
    'HC/MC':{ Studio: 10, Companion: 12 },
    AL:     { Studio: 14, 'One Bedroom': 12, Companion: 16 },
    'AL/MC':{ Studio: 8,  'One Bedroom': 8,  Companion: 10 },
    SL:     { 'One Bedroom': 14, 'Two Bedroom': 10 },
  },
  large: {
    HC:     { Studio: 24, Companion: 36 },
    'HC/MC':{ Studio: 14, Companion: 18 },
    AL:     { Studio: 18, 'One Bedroom': 16, Companion: 20 },
    'AL/MC':{ Studio: 12, 'One Bedroom': 10, Companion: 14 },
    SL:     { 'One Bedroom': 18, 'Two Bedroom': 14 },
    VIL:    { 'One Bedroom': 16, 'Two Bedroom': 12 },
  },
};

// Street rate ranges — HC/HC/MC are DAILY, others MONTHLY
const STREET_RATE_RANGES: Record<string, [number, number]> = {
  'HC':    [290, 380],
  'HC/MC': [330, 450],
  'AL':    [3800, 5800],
  'AL/MC': [5200, 7500],
  'SL':    [2900, 4200],
  'VIL':   [3400, 5200],
};

// Room size premium multipliers
const ROOM_PREMIUM: Record<string, number> = {
  Studio:       1.00,
  Companion:    0.82,
  'One Bedroom':1.00,
  'Two Bedroom':1.28,
};

// Occupancy rate ranges per service line
const OCC_RATES: Record<string, [number, number]> = {
  'HC':    [0.88, 0.96],
  'HC/MC': [0.84, 0.92],
  'AL':    [0.78, 0.88],
  'AL/MC': [0.74, 0.86],
  'SL':    [0.82, 0.91],
  'VIL':   [0.68, 0.80],
};

// Payor type distributions per service line
const PAYOR_TYPES: Record<string, { type: string; weight: number }[]> = {
  'HC':    [{ type: 'PRIVATE PAY', weight: 0.72 }, { type: 'MEDICAID', weight: 0.18 }, { type: 'MEDICARE', weight: 0.10 }],
  'HC/MC': [{ type: 'PRIVATE PAY', weight: 0.75 }, { type: 'MEDICAID', weight: 0.15 }, { type: 'MEDICARE', weight: 0.10 }],
  'AL':    [{ type: 'PRIVATE PAY', weight: 1.00 }],
  'AL/MC': [{ type: 'PRIVATE PAY', weight: 1.00 }],
  'SL':    [{ type: 'PRIVATE PAY', weight: 1.00 }],
  'VIL':   [{ type: 'PRIVATE PAY', weight: 1.00 }],
};

// Maps service line to the competitor type used in competitive survey data
const SL_TO_COMP_TYPE: Record<string, string> = {
  'HC':    'HC',
  'HC/MC': 'SMC',
  'AL':    'AL',
  'AL/MC': 'AL',
  'SL':    'IL_IL',
  'VIL':   'IL_Villa',
};

// Competitor name pool (80 names)
const COMPETITOR_NAMES = [
  'Sunrise Senior Living', 'Brookdale Senior Living', 'Atria Senior Living', 'Emeritus',
  'Benchmark Senior Living', 'Five Star Senior Living', 'Enlivant', 'Discovery Senior Living',
  'Senior Lifestyle', 'Meridian Senior Living', 'American Senior Communities',
  'The Bristal Assisted Living', 'Morning Pointe', 'Magnolia Senior Living',
  'Prestige Senior Living', 'Civitas Senior Living', 'LCS Senior Living',
  'Senior Care Centers', 'Integral Senior Living', 'Westminster Canterbury',
  'StoryPoint Senior Living', 'Anthology Senior Living', 'Validus Senior Living',
  'Sagora Senior Living', 'Sonida Senior Living', 'Waterford Senior Living',
  'Sunrise Ridge', 'Cedar Ridge Senior Living', 'Maple Grove Senior Living',
  'Oak Park Senior Living', 'Riverview Senior Communities', 'Lakewood Senior Living',
  'Summit Point Senior Living', 'Pinnacle Senior Living', 'Heritage Senior Living',
  'Cornerstone Senior Living', 'Harmony Senior Services', 'Avante',
  'Pacifica Senior Living', 'Grace Senior Living', 'Vitality Senior Living',
  'Anthem Senior Living', 'Regency Senior Living', 'Keystone Senior Living',
  'Milestone Senior Living', 'Oasis Senior Living', 'Legacy Senior Living',
  'Lighthouse Senior Care', 'Silver Creek Senior Living', 'Autumn Ridge Senior Living',
  'Blue Ridge Senior Communities', 'Sagebrook Senior Living', 'The Arbors',
  'Pinebrook Senior Living', 'Evergreen Senior Care', 'Copper Ridge Senior Living',
  'Ironwood Senior Living', 'Willow Springs Senior Living', 'Cardinal Senior Living',
  'Bluebird Senior Living', 'Falcon Ridge Senior Living', 'Meadow Springs Senior',
  'Bridgewater Senior Living', 'Clearwater Senior Living', 'Stonegate Senior Living',
  'Vista Senior Care', 'Horizon Senior Living', 'Compass Senior Living',
  'Beacon Senior Living', 'The Grove Senior Living', 'The Lodge Senior Care',
  'The Willows Senior Living', 'The Oaks Senior Care', 'The Birches Senior Living',
  'Serenity Senior Communities', 'Tranquility Senior Living', 'Liberty Senior Living',
  'Freedom Senior Care', 'Generations Senior Living', 'Cascade Senior Living',
];

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function seededRand(seed: number) {
  let s = (seed + 1) | 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 0xffffffff;
  };
}

function randBetween(r: () => number, min: number, max: number): number {
  return min + r() * (max - min);
}

function randInt(r: () => number, min: number, max: number): number {
  return Math.floor(randBetween(r, min, max + 1));
}

function pickPayorType(r: () => number, sl: string): string {
  const dist = PAYOR_TYPES[sl] || [{ type: 'PRIVATE PAY', weight: 1.0 }];
  let acc = 0;
  const roll = r();
  for (const entry of dist) {
    acc += entry.weight;
    if (roll < acc) return entry.type;
  }
  return dist[dist.length - 1].type;
}

function pastDate(r: () => number, minMonthsAgo: number, maxMonthsAgo: number): string {
  const now = new Date();
  const daysAgo = Math.round(randBetween(r, minMonthsAgo * 30, maxMonthsAgo * 30));
  const d = new Date(now.getTime() - daysAgo * 86400000);
  return d.toISOString().slice(0, 10);
}

function locIdFromName(name: string): string {
  return 'demo-' + name.replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/-$/, '');
}

// ─────────────────────────────────────────────
// MAIN GENERATOR
// ─────────────────────────────────────────────

export async function generateDemoData(): Promise<{
  locations: number;
  rentRoll: number;
  competitive: number;
  inquiry: number;
}> {
  const stats = { locations: 0, rentRoll: 0, competitive: 0, inquiry: 0 };
  const BATCH_SIZE = 500;

  // ── 1. Insert Locations ────────────────────────────────────────────────────
  console.log('[demo] Inserting 50 locations...');
  const insertedLocations: Array<{ id: string; name: string; region: string; division: string; size: string }> = [];

  for (const loc of DEMO_LOCATIONS) {
    const locId = locIdFromName(loc.name);
    await db.insert(locations).values({
      id: locId,
      name: loc.name,
      region: loc.region,
      division: loc.division,
      lat: loc.lat,
      lng: loc.lng,
      clientId: 'demo',
    }).onConflictDoUpdate({
      target: [locations.id],
      set: { region: loc.region, division: loc.division, lat: loc.lat, lng: loc.lng, clientId: 'demo' }
    });
    insertedLocations.push({ id: locId, name: loc.name, region: loc.region, division: loc.division, size: loc.size });
    stats.locations++;
  }
  console.log(`[demo]   ✓ ${stats.locations} locations`);

  // ── 2. Generate Competitive Survey Data first (in-memory) ──────────────────
  // We generate competitor data first so we can use it when building rent roll records,
  // pre-populating competitorFinalRate for a complete demo experience.
  console.log('[demo] Generating competitive survey data...');
  const _seedNow = new Date();
  const surveyMonth = `${_seedNow.getFullYear()}-${String(_seedNow.getMonth() + 1).padStart(2, '0')}`;

  const COMP_ROOM_SIZES: Record<string, string[]> = {
    HC:       ['Studio', 'Companion'],
    SMC:      ['Studio', 'Companion'],
    AL:       ['Studio', 'One Bedroom', 'Two Bedroom'],
    IL_IL:    ['Studio', 'One Bedroom', 'Two Bedroom'],
    IL_Villa: ['One Bedroom', 'Two Bedroom'],
  };

  // Competitor rate lookup: "locName|compType|roomType" -> average monthly rate
  // Used to pre-populate competitorFinalRate in rent roll records
  const competitorRateMap = new Map<string, number[]>();

  const competitiveBatch: any[] = [];

  for (const loc of insertedLocations) {
    const locSeed = seededRand(
      loc.name.split('').reduce((acc, c) => acc * 37 + c.charCodeAt(0), 11) & 0x7fffffff
    );
    const locServiceLines = SIZE_SERVICE_LINES[loc.size];
    const compTypes = [...new Set(locServiceLines.map(sl => SL_TO_COMP_TYPE[sl]).filter(Boolean))];

    const numCompetitors = randInt(locSeed, 3, 5);
    const locCompNames: string[] = [];

    for (let ci = 0; ci < numCompetitors; ci++) {
      let compName = '';
      for (let attempt = 0; attempt < 30; attempt++) {
        const idx = randInt(locSeed, 0, COMPETITOR_NAMES.length - 1);
        const candidate = COMPETITOR_NAMES[idx];
        if (!locCompNames.includes(candidate)) { compName = candidate; break; }
      }
      if (!compName) compName = `${COMPETITOR_NAMES[ci % COMPETITOR_NAMES.length]} - ${loc.name.split(' - ')[0]}`;
      locCompNames.push(compName);

      const rateVariance = randBetween(locSeed, 0.88, 1.18);
      const distanceMiles = Math.round(randBetween(locSeed, 0.4, 8.5) * 10) / 10;

      for (const compType of compTypes) {
        const roomSizes = COMP_ROOM_SIZES[compType] || ['Studio'];
        const matchingSL = locServiceLines.find(sl => SL_TO_COMP_TYPE[sl] === compType) || 'AL';
        const [rateMin, rateMax] = STREET_RATE_RANGES[matchingSL];
        const locBaseRate = Math.round(randBetween(locSeed, rateMin, rateMax));

        for (const roomSize of roomSizes) {
          const premium = ROOM_PREMIUM[roomSize] || 1.0;
          const compRate = Math.round(locBaseRate * premium * rateVariance);

          competitiveBatch.push({
            surveyMonth,
            keyStatsLocation: loc.name,
            competitorName: compName,
            competitorAddress: `${randInt(locSeed, 100, 9999)} Oak Street, ${loc.name.split(' - ')[0]}`,
            distanceMiles,
            competitorType: compType,
            roomType: roomSize,
            monthlyRateLow: Math.round(compRate * 0.94),
            monthlyRateHigh: Math.round(compRate * 1.06),
            monthlyRateAvg: compRate,
            totalMonthlyLow: Math.round(compRate * 0.94),
            totalMonthlyHigh: Math.round(compRate * 1.06),
            totalMonthlyAvg: compRate,
            occupancyRate: Math.round(randBetween(locSeed, 0.68, 0.94) * 100) / 100,
            totalUnits: randInt(locSeed, 40, 160),
            clientId: 'demo',
          });

          // Accumulate rates for the lookup map
          const mapKey = `${loc.name}|${compType}|${roomSize}`;
          if (!competitorRateMap.has(mapKey)) {
            competitorRateMap.set(mapKey, []);
          }
          competitorRateMap.get(mapKey)!.push(compRate);
        }
      }
    }
  }

  // Helper: look up the average competitor rate for a location/serviceLine/roomType combination
  function lookupCompetitorRate(locName: string, sl: string, roomType: string): number | null {
    const compType = SL_TO_COMP_TYPE[sl];
    if (!compType) return null;

    // Direct lookup
    const key = `${locName}|${compType}|${roomType}`;
    const rates = competitorRateMap.get(key);
    if (rates && rates.length > 0) {
      return Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
    }

    // Fallback: try Studio for Companion (AL/MC companion -> AL studio)
    if (roomType === 'Companion') {
      const fallbackKey = `${locName}|${compType}|Studio`;
      const fallbackRates = competitorRateMap.get(fallbackKey);
      if (fallbackRates && fallbackRates.length > 0) {
        return Math.round(fallbackRates.reduce((a, b) => a + b, 0) / fallbackRates.length * 0.85);
      }
    }

    // Fallback: try One Bedroom for Two Bedroom
    if (roomType === 'Two Bedroom') {
      const fallbackKey = `${locName}|${compType}|One Bedroom`;
      const fallbackRates = competitorRateMap.get(fallbackKey);
      if (fallbackRates && fallbackRates.length > 0) {
        return Math.round(fallbackRates.reduce((a, b) => a + b, 0) / fallbackRates.length * 1.25);
      }
    }

    // Fallback: any room type for this location+compType
    for (const [k, r] of competitorRateMap) {
      if (k.startsWith(`${locName}|${compType}|`) && r.length > 0) {
        return Math.round(r.reduce((a, b) => a + b, 0) / r.length);
      }
    }

    return null;
  }

  // ── 3. Rent Roll Data ──────────────────────────────────────────────────────
  console.log('[demo] Generating rent roll data...');
  // Use the most recent 3 months so the RRA endpoint (which queries T3 from today) finds data
  const now = new Date();
  const months: string[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const rentRollBatch: any[] = [];

  for (const loc of insertedLocations) {
    const serviceLines = SIZE_SERVICE_LINES[loc.size];
    const unitCounts = UNIT_COUNTS[loc.size];
    const locSeed = seededRand(
      loc.name.split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7) & 0x7fffffff
    );

    for (const sl of serviceLines) {
      const roomSizes = SL_ROOM_SIZES[sl] || [];
      const [rateMin, rateMax] = STREET_RATE_RANGES[sl];
      const baseRate = Math.round(randBetween(locSeed, rateMin, rateMax));
      const [occMin, occMax] = OCC_RATES[sl];
      const targetOcc = randBetween(locSeed, occMin, occMax);

      // Calculate Modulo factor based on occupancy:
      // High occupancy (>90%) → suggest 5-8% increase
      // Mid occupancy (80-90%) → suggest 1-4% increase
      // Low occupancy (<80%) → suggest hold or tiny decrease
      const rawModuloFactor = 1.0 + Math.min(0.08, Math.max(-0.03, (targetOcc - 0.83) * 0.15));
      // Add small random variation ±1% to make suggestions look realistic
      const moduloVarianceSeed = seededRand(
        loc.name.charCodeAt(0) * 17 + sl.charCodeAt(0) * 31 + 99
      );

      for (const roomSize of roomSizes) {
        const premium = ROOM_PREMIUM[roomSize] || 1.0;
        const streetRate = Math.round(baseRate * premium);
        const unitCount = unitCounts[sl]?.[roomSize] ?? 6;

        // Pre-compute competitor rate for this location/sl/roomType (same for all months)
        const competitorFinalRate = lookupCompetitorRate(loc.name, sl, roomSize);

        for (const month of months) {
          const globalR = seededRand(month.charCodeAt(5) * 97 + loc.name.charCodeAt(0) * 13 + sl.charCodeAt(0) * 7);
          const monthOccVariance = (globalR() - 0.5) * 0.04;
          const occ = Math.max(0.3, Math.min(0.99, targetOcc + monthOccVariance));
          const occupiedCount = Math.round(unitCount * occ);

          // Month-specific Modulo variance (±1.5%)
          const monthModuloVariance = 1.0 + (moduloVarianceSeed() - 0.5) * 0.015;
          const moduloFactor = rawModuloFactor * monthModuloVariance;
          const moduloSuggestedRate = Math.round(streetRate * moduloFactor);

          // Per-unit seed so RRA decisions are stable across months for the same unit
          const unitRraSeed = seededRand(
            loc.name.charCodeAt(0) * 53 + sl.charCodeAt(0) * 37 + roomSize.charCodeAt(0) * 19
          );

          for (let i = 0; i < unitCount; i++) {
            const isOccupied = i < occupiedCount;
            const unitNum = 100 + Math.floor(i / 2) * 10 + (i % 2);
            const roomNumber = `${sl.replace('/', '')}-${unitNum}`;
            const inHouseRate = isOccupied ? Math.round(streetRate * randBetween(locSeed, 0.85, 0.98)) : 0;
            const daysVacant = isOccupied ? 0 : randInt(locSeed, 1, 180);
            const moveInDate = isOccupied ? pastDate(locSeed, 6, 36) : null;
            const payorType = isOccupied ? pickPayorType(locSeed, sl) : null;

            // ~18% of occupied AL/SL/VIL units carry a promotional allowance (RRA discount)
            const rraSl = ['AL', 'AL/MC', 'SL', 'VIL'].includes(sl);
            const hasRra = isOccupied && rraSl && unitRraSeed() < 0.18;
            const promotionAllowance = hasRra
              ? -Math.round(randBetween(unitRraSeed, 50, 350))
              : 0;

            rentRollBatch.push({
              uploadMonth: month,
              date: `${month}-01`,
              location: loc.name,
              locationId: loc.id,
              roomNumber,
              size: roomSize,
              roomType: roomSize,
              serviceLine: sl,
              occupiedYN: isOccupied,
              daysVacant,
              streetRate,
              inHouseRate,
              discountToStreetRate: isOccupied ? streetRate - inHouseRate : 0,
              promotionAllowance,
              payorType,
              moveInDate,
              clientId: 'demo',
              // Pre-computed competitor rate from survey data
              competitorFinalRate,
              competitorRate: competitorFinalRate,
              // Pre-computed Modulo suggestion based on occupancy trend
              moduloSuggestedRate,
            });
          }
        }
      }
    }
  }

  for (let i = 0; i < rentRollBatch.length; i += BATCH_SIZE) {
    await db.insert(rentRollData).values(rentRollBatch.slice(i, i + BATCH_SIZE));
    stats.rentRoll += Math.min(BATCH_SIZE, rentRollBatch.length - i);
  }
  console.log(`[demo]   ✓ ${stats.rentRoll} rent roll records`);

  // ── 4. Insert Competitive Survey Data ─────────────────────────────────────
  for (let i = 0; i < competitiveBatch.length; i += BATCH_SIZE) {
    await db.insert(competitiveSurveyData).values(competitiveBatch.slice(i, i + BATCH_SIZE));
    stats.competitive += Math.min(BATCH_SIZE, competitiveBatch.length - i);
  }
  console.log(`[demo]   ✓ ${stats.competitive} competitive survey records`);

  // ── 5. Inquiry Metrics ────────────────────────────────────────────────────
  console.log('[demo] Generating inquiry metrics...');
  const inquiryMonths = months; // reuse the same T3 months computed for rent roll
  const leadSources = ['Website', 'Referral', 'A Place for Mom', 'Phone', 'Walk-in'];
  const inquiryBatch: any[] = [];

  for (const loc of insertedLocations) {
    const locSeed = seededRand(
      loc.name.split('').reduce((acc, c) => acc * 41 + c.charCodeAt(0), 17) & 0x7fffffff
    );
    const serviceLines = SIZE_SERVICE_LINES[loc.size];

    for (const sl of serviceLines) {
      if (sl === 'HC' || sl === 'HC/MC') continue;

      for (const month of inquiryMonths) {
        for (const source of leadSources) {
          const baseInquiries =
            source === 'Website'        ? randInt(locSeed, 12, 40) :
            source === 'Referral'       ? randInt(locSeed, 8, 28) :
            source === 'A Place for Mom'? randInt(locSeed, 5, 22) :
            source === 'Phone'          ? randInt(locSeed, 3, 12) :
                                          randInt(locSeed, 1, 8);

          const tourRate = randBetween(locSeed, 0.28, 0.62);
          const tourCount = Math.round(baseInquiries * tourRate);
          const conversionRate = randBetween(locSeed, 0.14, 0.32);
          const conversionCount = Math.round(tourCount * conversionRate);

          inquiryBatch.push({
            uploadMonth: month,
            date: `${month}-01`,
            location: loc.name,
            locationId: loc.id,
            region: loc.region,
            division: loc.division,
            serviceLine: sl,
            leadSource: source,
            inquiryCount: baseInquiries,
            tourCount,
            conversionCount,
            conversionRate: Math.round(conversionRate * 100) / 100,
            daysToTour: randInt(locSeed, 2, 10),
            daysToMoveIn: randInt(locSeed, 14, 45),
            clientId: 'demo',
          });
        }
      }
    }
  }

  for (let i = 0; i < inquiryBatch.length; i += BATCH_SIZE) {
    await db.insert(inquiryMetrics).values(inquiryBatch.slice(i, i + BATCH_SIZE));
    stats.inquiry += Math.min(BATCH_SIZE, inquiryBatch.length - i);
  }
  console.log(`[demo]   ✓ ${stats.inquiry} inquiry metric records`);

  return stats;
}
