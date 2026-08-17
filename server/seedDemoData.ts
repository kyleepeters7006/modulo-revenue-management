import { db } from './db';
import { locations, rentRollData, competitiveSurveyData, inquiryMetrics, revenueGrowthTargets, guardrails } from '@shared/schema';
import { eq, and, sql as drizzleSql } from 'drizzle-orm';

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
  'VIL':   [2600, 3600],
};

// Room size premium multipliers
// Hierarchy enforced: Two Bedroom > One Bedroom > Studio, Companion > Studio
const ROOM_PREMIUM: Record<string, number> = {
  Studio:       1.00,
  Companion:    1.18,
  'One Bedroom':1.38,
  'Two Bedroom':1.80,
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

  // ── 0. Clear existing demo data so re-seeds are idempotent ────────────────
  console.log('[demo] Clearing existing demo data...');
  await db.execute(drizzleSql.raw(`DELETE FROM inquiry_metrics WHERE client_id = 'demo'`));
  await db.execute(drizzleSql.raw(`DELETE FROM competitive_survey_data WHERE client_id = 'demo'`));
  await db.execute(drizzleSql.raw(`DELETE FROM rent_roll_data WHERE client_id = 'demo'`));
  await db.execute(drizzleSql.raw(`DELETE FROM revenue_growth_targets WHERE location_id IN (SELECT id FROM locations WHERE client_id = 'demo')`));
  await db.execute(drizzleSql.raw(`DELETE FROM guardrails WHERE location_id IN (SELECT id FROM locations WHERE client_id = 'demo')`));

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
    AL:       ['Studio', 'One Bedroom', 'Two Bedroom', 'Companion'],
    IL_IL:    ['Studio', 'One Bedroom', 'Two Bedroom'],
    IL_Villa: ['One Bedroom', 'Two Bedroom'],
  };

  // Companion in the AL lines is semi-private and priced BELOW Studio.
  // All other sizes use the standard ROOM_PREMIUM multiplier.
  const AL_COMPANION_FACTOR = 0.85; // semi-private ≈ 85 % of Studio rate

  // Competitor rate lookup: "locName|compType|roomType" -> average monthly rate
  // Used to pre-populate competitorFinalRate in rent roll records
  const competitorRateMap = new Map<string, number[]>();
  // Tracks the first (primary) competitor name + base rate per loc|compType|roomType
  const competitorInfoMap = new Map<string, { name: string; baseRate: number }>();

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

      const distanceMiles = Math.round(randBetween(locSeed, 0.4, 8.5) * 10) / 10;

      // Generate realistic lat/lng for this competitor based on the location's coordinates.
      // Pick a random bearing (0–2π) and offset by distanceMiles.
      const bearing = randBetween(locSeed, 0, 2 * Math.PI);
      const locLat = (loc as any).lat ?? 41.0;
      const locLng = (loc as any).lng ?? -74.0;
      const compLat = parseFloat((locLat + distanceMiles * Math.cos(bearing) / 69).toFixed(6));
      const compLng = parseFloat((locLng + distanceMiles * Math.sin(bearing) / (69 * Math.cos(locLat * Math.PI / 180))).toFixed(6));

      for (const compType of compTypes) {
        const roomSizes = COMP_ROOM_SIZES[compType] || ['Studio'];
        const matchingSL = locServiceLines.find(sl => SL_TO_COMP_TYPE[sl] === compType) || 'AL';
        const [rateMin, rateMax] = STREET_RATE_RANGES[matchingSL];
        const locBaseRate = Math.round(randBetween(locSeed, rateMin, rateMax));

        // Calibrate competitor rate variance based on occupancy for this service line:
        // High occ (>90%): we price at a premium — competitors are 7-15% below our street rate
        // Medium occ (82-90%): close to market — competitors within ±5%
        // Low occ (<82%): below-market occupancy — competitors are 2-9% above our street rate
        const [occMin, occMax] = OCC_RATES[matchingSL] || [0.80, 0.90];
        const midOcc = (occMin + occMax) / 2;
        const [rateVarLow, rateVarHigh] =
          midOcc > 0.90 ? [0.85, 0.93] :
          midOcc > 0.82 ? [0.93, 1.02] :
                          [0.98, 1.07];
        const rateVariance = randBetween(locSeed, rateVarLow, rateVarHigh);

        for (const roomSize of roomSizes) {
          // AL Companion is semi-private: priced below Studio, not above it.
          const premium = (roomSize === 'Companion' && compType === 'AL')
            ? AL_COMPANION_FACTOR
            : (ROOM_PREMIUM[roomSize] || 1.0);
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
            lat: compLat,
            lng: compLng,
          });

          // Accumulate rates for the lookup map
          const mapKey = `${loc.name}|${compType}|${roomSize}`;
          if (!competitorRateMap.has(mapKey)) {
            competitorRateMap.set(mapKey, []);
          }
          competitorRateMap.get(mapKey)!.push(compRate);
          // Store first (primary) competitor info for this key
          if (!competitorInfoMap.has(mapKey)) {
            competitorInfoMap.set(mapKey, { name: compName, baseRate: compRate });
          }
        }
      }
    }
  }

  // Derive AL/MC competitor rates from AL rates.
  // AL/MC is priced at a memory-care premium over AL; the average mid-range ratio is:
  //   AL/MC mid = (5200+7500)/2 = 6350 ; AL mid = (3800+5800)/2 = 4800 → ratio ≈ 1.323
  // We also generate a Companion entry (AL has no direct Companion in COMP_ROOM_SIZES,
  // so Companion = Studio × 1.18, matching ROOM_PREMIUM['Companion']).
  {
    const AL_MC_RATIO = ((5200 + 7500) / 2) / ((3800 + 5800) / 2); // ≈ 1.323
    const AL_MC_ROOM_SIZES = ['Studio', 'One Bedroom', 'Companion'];
    for (const loc of insertedLocations) {
      const locServiceLines = SIZE_SERVICE_LINES[loc.size];
      if (!locServiceLines.includes('AL/MC')) continue;

      const alStudioKey = `${loc.name}|AL|Studio`;
      const alStudioRates = competitorRateMap.get(alStudioKey);
      if (!alStudioRates || alStudioRates.length === 0) continue;

      for (const roomSize of AL_MC_ROOM_SIZES) {
        const alMcKey = `${loc.name}|AL/MC|${roomSize}`;
        if (competitorRateMap.has(alMcKey)) continue;

        // Base = AL Studio rates scaled to AL/MC range, then apply room premium.
        // Companion is semi-private — use the same discount applied to AL survey rows.
        const roomPremium = (roomSize === 'Companion') ? AL_COMPANION_FACTOR : (ROOM_PREMIUM[roomSize] || 1.0);
        const alMcRates = alStudioRates.map(r => Math.round(r * AL_MC_RATIO * roomPremium));
        competitorRateMap.set(alMcKey, alMcRates);

        const alStudioInfo = competitorInfoMap.get(alStudioKey);
        if (alStudioInfo && !competitorInfoMap.has(alMcKey)) {
          competitorInfoMap.set(alMcKey, {
            name: alStudioInfo.name,
            baseRate: Math.round(alStudioInfo.baseRate * AL_MC_RATIO * roomPremium),
          });
        }
      }
    }
  }

  // Helper: look up the average competitor rate for a location/serviceLine/roomType combination.
  // Checks for a direct service-line key first (e.g. 'AL/MC' has its own derived entries),
  // then falls back to the compType key.
  function lookupCompetitorRate(locName: string, sl: string, roomType: string): number | null {
    // 1. Direct service-line key (e.g. AL/MC has rates separate from AL)
    const directKey = `${locName}|${sl}|${roomType}`;
    const directRates = competitorRateMap.get(directKey);
    if (directRates && directRates.length > 0) {
      return Math.round(directRates.reduce((a, b) => a + b, 0) / directRates.length);
    }

    const compType = SL_TO_COMP_TYPE[sl];
    if (!compType) return null;

    const key = `${locName}|${compType}|${roomType}`;
    const rates = competitorRateMap.get(key);
    if (rates && rates.length > 0) {
      return Math.round(rates.reduce((a, b) => a + b, 0) / rates.length);
    }
    if (roomType === 'Companion') {
      const fallbackKey = `${locName}|${compType}|Studio`;
      const fallbackRates = competitorRateMap.get(fallbackKey);
      if (fallbackRates && fallbackRates.length > 0) {
        // Companion premium = 1.18× Studio (matches ROOM_PREMIUM)
        return Math.round(fallbackRates.reduce((a, b) => a + b, 0) / fallbackRates.length * 1.18);
      }
    }
    if (roomType === 'Two Bedroom') {
      const fallbackKey = `${locName}|${compType}|One Bedroom`;
      const fallbackRates = competitorRateMap.get(fallbackKey);
      if (fallbackRates && fallbackRates.length > 0) {
        return Math.round(fallbackRates.reduce((a, b) => a + b, 0) / fallbackRates.length * 1.25);
      }
    }
    for (const [k, r] of competitorRateMap) {
      if (k.startsWith(`${locName}|${compType}|`) && r.length > 0) {
        return Math.round(r.reduce((a, b) => a + b, 0) / r.length);
      }
    }
    return null;
  }

  // Helper: look up the primary competitor name + base rate for a unit
  function lookupCompetitorInfo(locName: string, sl: string, roomType: string): { name: string; baseRate: number } | null {
    const compType = SL_TO_COMP_TYPE[sl];
    if (!compType) return null;
    const direct = competitorInfoMap.get(`${locName}|${compType}|${roomType}`);
    if (direct) return direct;
    const fallbackRt = roomType === 'Companion' ? 'Studio' : roomType === 'Two Bedroom' ? 'One Bedroom' : null;
    if (fallbackRt) {
      const fb = competitorInfoMap.get(`${locName}|${compType}|${fallbackRt}`);
      if (fb) return fb;
    }
    for (const [k, info] of competitorInfoMap) {
      if (k.startsWith(`${locName}|${compType}|`)) return info;
    }
    return null;
  }

  // ── 3. Rent Roll Data ──────────────────────────────────────────────────────
  console.log('[demo] Generating rent roll data...');
  // Generate 12 months of data so the Revenue Growth chart has a full trailing year.
  // The most recent 3 months also satisfy the RRA endpoint (T3 from today).
  const now = new Date();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  // Revenue growth gradient: oldest month has rates ~8 % lower than current month.
  // monthRateFactor[0] ≈ 0.92 (11 months ago), monthRateFactor[11] = 1.00 (now).
  const monthRateFactor = months.map((_, idx) => 0.92 + (idx / (months.length - 1)) * 0.08);
  const rentRollBatch: any[] = [];

  // Simulate portfolio growth: most locations have a full year of data, but the
  // West expansion cohorts "open" partway through the year so unit counts grow.
  //   idx  0-35 → monthStart 0  (established portfolio, full 12 months)
  //   idx 36-40 → monthStart 5  (West/Southwest expansion, joined ~7 months ago)
  //   idx 41-44 → monthStart 8  (West/Pacific wave 1, joined ~4 months ago)
  //   idx 45-48 → monthStart 10 (West/Pacific + Mountain, joined ~2 months ago)
  //   idx 49    → monthStart 11 (newest acquisition, joined this month)
  // This produces meaningful T1/T3/T6/T12 growth on the Total Units tile.
  const getMonthStart = (locIndex: number): number => {
    if (locIndex < 36) return 0;
    if (locIndex < 41) return 5;
    if (locIndex < 45) return 8;
    if (locIndex < 49) return 10;
    return 11;
  };

  for (const loc of insertedLocations) {
    const locIndex = insertedLocations.indexOf(loc);
    const monthStart = getMonthStart(locIndex);
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

      // Albany AL/MC: force high occupancy so Modulo suggests increases;
      // a 4% guardrail cap will be seeded to demonstrate guardrail clipping.
      const isAlbanyAlMc = loc.name === 'Albany - 215' && sl === 'AL/MC';
      const targetOcc = isAlbanyAlMc ? 0.96 : randBetween(locSeed, occMin, occMax);

      // Calculate Modulo factor based on occupancy:
      // High occupancy (>90%) → suggest 5-8% increase
      // Mid occupancy (80-90%) → suggest 1-4% increase
      // Low occupancy (<80%) → suggest hold or tiny decrease
      // Albany AL/MC: uncapped pre-guardrail factor = +8%, then capped to +4% by guardrail
      const rawModuloFactor = isAlbanyAlMc
        ? 1.04  // post-guardrail rate (+4% cap applied)
        : 1.0 + Math.min(0.08, Math.max(-0.03, (targetOcc - 0.83) * 0.15));
      // Add small random variation ±1% to make suggestions look realistic
      const moduloVarianceSeed = seededRand(
        loc.name.charCodeAt(0) * 17 + sl.charCodeAt(0) * 31 + 99
      );

      for (const roomSize of roomSizes) {
        const premium = ROOM_PREMIUM[roomSize] || 1.0;
        const streetRate = Math.round(baseRate * premium);
        const unitCount = unitCounts[sl]?.[roomSize] ?? 6;

        // Pre-compute competitor rate + name/baseRate for this location/sl/roomType (same for all months)
        const competitorFinalRate = lookupCompetitorRate(loc.name, sl, roomSize);
        const competitorInfo = lookupCompetitorInfo(loc.name, sl, roomSize);

        for (let mIdx = monthStart; mIdx < months.length; mIdx++) {
          const month = months[mIdx];
          const rateFactor = monthRateFactor[mIdx];

          const globalR = seededRand(month.charCodeAt(5) * 97 + loc.name.charCodeAt(0) * 13 + sl.charCodeAt(0) * 7);
          const monthOccVariance = (globalR() - 0.5) * 0.04;
          const occ = Math.max(0.3, Math.min(0.99, targetOcc + monthOccVariance));
          const occupiedCount = Math.round(unitCount * occ);

          // Apply month-specific rate factor so older months have proportionally lower rates
          const monthStreetRate = Math.round(streetRate * rateFactor);

          // Month-specific Modulo variance (±1.5%)
          const monthModuloVariance = 1.0 + (moduloVarianceSeed() - 0.5) * 0.015;
          const moduloFactor = rawModuloFactor * monthModuloVariance;
          const moduloSuggestedRate = Math.round(monthStreetRate * moduloFactor);

          // Per-unit seed so RRA decisions are stable across months for the same unit
          const unitRraSeed = seededRand(
            loc.name.charCodeAt(0) * 53 + sl.charCodeAt(0) * 37 + roomSize.charCodeAt(0) * 19
          );

          // Helper: pick A/B/C given cumulative probability thresholds [pA, pA+pB]
          const pickRating = (r: () => number, pA: number, pB: number): string => {
            const roll = r();
            if (roll < pA) return 'A';
            if (roll < pA + pB) return 'B';
            return 'C';
          };

          // sizeRating is fixed by room type (same for all units of same room size)
          const sizeRating =
            roomSize === 'Two Bedroom' ? 'A' :
            roomSize === 'One Bedroom' ? 'B' :
            roomSize === 'Studio'      ? 'B' : 'C'; // Companion → C

          for (let i = 0; i < unitCount; i++) {
            const isOccupied = i < occupiedCount;
            const unitNum = 100 + Math.floor(i / 2) * 10 + (i % 2);
            const roomNumber = `${sl.replace('/', '')}-${unitNum}`;
            const inHouseRate = isOccupied ? Math.round(monthStreetRate * randBetween(locSeed, 0.85, 0.98)) : 0;
            const daysVacant = isOccupied ? 0 : randInt(locSeed, 1, 180);
            const moveInDate = isOccupied ? pastDate(locSeed, 6, 36) : null;
            const payorType = isOccupied ? pickPayorType(locSeed, sl) : null;

            // ~18% of occupied AL/SL/VIL units carry a promotional allowance (RRA discount)
            const rraSl = ['AL', 'AL/MC', 'SL', 'VIL'].includes(sl);
            const hasRra = isOccupied && rraSl && unitRraSeed() < 0.18;
            const promotionAllowance = hasRra
              ? -Math.round(randBetween(unitRraSeed, 50, 350))
              : 0;

            // Stable per-unit attribute seed (deterministic by location+sl+size+unit index)
            const attrSeed = seededRand(
              loc.name.charCodeAt(0) * 71 + sl.charCodeAt(0) * 43 + roomSize.charCodeAt(0) * 29 + i * 17
            );
            // Higher unit numbers get better location ratings (upper floors/better position)
            const locBonus = i >= Math.floor(unitCount * 0.6) ? 0.15 : 0;
            const viewRating      = pickRating(attrSeed, 0.35, 0.50);          // 35% A, 50% B, 15% C
            const renovationRating = pickRating(attrSeed, 0.30, 0.52);         // 30% A, 52% B, 18% C
            const locationRating  = pickRating(attrSeed, 0.35 + locBonus, 0.50); // top units skew A
            const amenityRating   = pickRating(attrSeed, 0.35, 0.50);          // 35% A, 50% B, 15% C

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
              streetRate: monthStreetRate,
              inHouseRate,
              discountToStreetRate: isOccupied ? monthStreetRate - inHouseRate : 0,
              promotionAllowance,
              payorType,
              moveInDate,
              clientId: 'demo',
              sameStore: monthStart === 0,
              // Pre-computed competitor rate from survey data
              competitorFinalRate,
              competitorRate: competitorFinalRate,
              competitorName: competitorInfo?.name ?? null,
              competitorBaseRate: competitorInfo?.baseRate ?? null,
              // Pre-computed Modulo suggestion based on occupancy trend
              moduloSuggestedRate,
              // Albany AL/MC: pre-seed guardrail indicator so rate card shows shield immediately
              ...(isAlbanyAlMc ? {
                moduloCalculationDetails: JSON.stringify({
                  guardrailsApplied: ['Maximum rate increase limit applied (4.0%)'],
                  occupancyFactor: 0.96,
                  preGuardrailRate: Math.round(monthStreetRate * 1.08),
                  guardrailCap: '4.0%',
                }),
              } : {}),
              // Attribute ratings — stable per unit, deterministic by seed
              sizeRating,
              viewRating,
              renovationRating,
              locationRating,
              amenityRating,
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
    const locIndex = insertedLocations.indexOf(loc);
    const locMonthStart = getMonthStart(locIndex);
    const locSeed = seededRand(
      loc.name.split('').reduce((acc, c) => acc * 41 + c.charCodeAt(0), 17) & 0x7fffffff
    );
    const serviceLines = SIZE_SERVICE_LINES[loc.size];

    for (const sl of serviceLines) {
      if (sl === 'HC' || sl === 'HC/MC') continue;

      for (const month of inquiryMonths.slice(locMonthStart)) {
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

  // ── 5. Revenue Growth Targets — 5–9% per location × service line ───────────
  console.log('[demo] Seeding revenue growth targets...');
  const growthBatch: { locationId: string; serviceLine: string; targetGrowthPercent: number }[] = [];
  for (const loc of insertedLocations) {
    const locSeed = seededRand(
      loc.name.split('').reduce((acc, c) => acc * 41 + c.charCodeAt(0), 17) & 0x7fffffff
    );
    const serviceLines = SIZE_SERVICE_LINES[loc.size];
    for (const sl of serviceLines) {
      const target = Math.round(randBetween(locSeed, 5, 9) * 10) / 10;
      growthBatch.push({ locationId: loc.id, serviceLine: sl, targetGrowthPercent: target });
    }
  }
  for (let i = 0; i < growthBatch.length; i += BATCH_SIZE) {
    await db.insert(revenueGrowthTargets)
      .values(growthBatch.slice(i, i + BATCH_SIZE))
      .onConflictDoUpdate({
        target: [revenueGrowthTargets.locationId, revenueGrowthTargets.serviceLine],
        set: { targetGrowthPercent: revenueGrowthTargets.targetGrowthPercent },
      });
  }
  console.log(`[demo]   ✓ ${growthBatch.length} revenue growth targets`);

  // ── 6. Guardrail for Albany AL/MC — cap increases at 4% to demo clipping ───
  console.log('[demo] Seeding Albany AL/MC guardrail...');
  const albanyLoc = insertedLocations.find(l => l.name === 'Albany - 215');
  if (albanyLoc) {
    await db.execute(drizzleSql.raw(
      `DELETE FROM guardrails WHERE location_id = '${albanyLoc.id}' AND service_line = 'AL/MC'`
    ));
    await db.insert(guardrails).values({
      locationId: albanyLoc.id,
      serviceLine: 'AL/MC',
      maxPriceChangePct: 4,    // +4% cap — clips the 8% demand signal to 4%
      minPriceChangePct: -5,   // standard 5% floor
    });
    console.log(`[demo]   ✓ Albany AL/MC guardrail: max +4% increase`);
  }

  return stats;
}
