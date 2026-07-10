/**
 * Shared fuzzy-matching utilities for MatrixCare export mapping.
 *
 * Strategy (descending priority):
 *  1. Exact match on canonical key
 *  2. Exact match after normalization (uppercase, trim, collapse whitespace)
 *  3. Alias table lookup
 *  4. Contains check (normalized candidate contains normalized key or vice-versa)
 *  5. Token-overlap scoring (Jaccard ≥ 0.5)
 *  6. Hard-coded default
 */

// ─── Date Helpers ────────────────────────────────────────────────────────────

/**
 * Returns a MatrixCare-safe date string in M/d/yyyy format.
 * If the supplied value is falsy or unparseable the current date is used.
 */
export function safeExportDate(raw?: string | null | Date): string {
  let d: Date | null = null;

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    d = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw.trim());
    if (!isNaN(parsed.getTime())) d = parsed;
  }

  if (!d) d = new Date();

  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// ─── Normalisation ────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toUpperCase().trim().replace(/[\s\-\/]+/g, ' ').replace(/[^A-Z0-9 ]/g, '');
}

function tokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  a.forEach(t => { if (b.has(t)) intersection++; });
  return intersection / (a.size + b.size - intersection);
}

// ─── Service Line → MatrixCare Level of Care ─────────────────────────────────

/** Canonical keys are the exact strings we emit to MatrixCare. */
const SERVICE_LINE_CANONICAL: Record<string, string> = {
  'HC':    'BASE RATE - SKILLED - ACTIVE',
  'HC/MC': 'BASE RATE - SKILLED - ACTIVE',
  'SNF':   'BASE RATE - SKILLED - ACTIVE',
  'AL':    'BASE RATE - INTERMED - ACTIVE',
  'AL/MC': 'BASE RATE - INTERMED - ACTIVE',
  'MC':    'BASE RATE - INTERMED - ACTIVE',
  'SL':    'BASE RATE - INTERMED - ACTIVE',
  'VIL':   'BASE RATE - INTERMED - ACTIVE',
};

/** Alias table — normalised input fragment → canonical key */
const SERVICE_LINE_ALIASES: Array<[string, string]> = [
  // Skilled / HC variants
  ['SKILLED', 'HC'],
  ['HEALTH CARE', 'HC'],
  ['HEALTHCARE', 'HC'],
  ['HOME CARE', 'HC'],
  ['SNF', 'HC'],
  ['SKILLED NURSING', 'HC'],
  ['SKILLED NURSING FACILITY', 'HC'],
  ['NURSING', 'HC'],
  ['HEALTH CENTER', 'HC'],
  // AL / MC variants
  ['ASSISTED LIVING', 'AL'],
  ['ASSISTED', 'AL'],
  ['MEMORY CARE', 'AL/MC'],
  ['MEMORY', 'AL/MC'],
  ['AL MC', 'AL/MC'],
  ['ALMC', 'AL/MC'],
  // SL
  ['INDEPENDENT LIVING', 'SL'],
  ['INDEPENDENT', 'SL'],
  ['SENIOR LIVING', 'SL'],
  ['IL', 'SL'],
  // VIL
  ['VILLAGE', 'VIL'],
  ['VIL', 'VIL'],
];

export function fuzzyMapServiceLine(serviceLine: string): string {
  if (!serviceLine) return SERVICE_LINE_CANONICAL['AL'];

  // 1. Exact
  if (SERVICE_LINE_CANONICAL[serviceLine]) return SERVICE_LINE_CANONICAL[serviceLine];

  const n = norm(serviceLine);

  // 2. Normalised exact
  for (const [k, v] of Object.entries(SERVICE_LINE_CANONICAL)) {
    if (norm(k) === n) return v;
  }

  // 3. Alias table (normalised contains alias token)
  for (const [alias, canonical] of SERVICE_LINE_ALIASES) {
    if (n.includes(alias)) return SERVICE_LINE_CANONICAL[canonical] ?? SERVICE_LINE_CANONICAL['AL'];
  }

  // 4. Token overlap against canonical keys
  const inputTokens = tokens(serviceLine);
  let bestScore = 0;
  let bestValue = SERVICE_LINE_CANONICAL['AL'];
  for (const [k, v] of Object.entries(SERVICE_LINE_CANONICAL)) {
    const score = jaccard(inputTokens, tokens(k));
    if (score > bestScore) { bestScore = score; bestValue = v; }
  }
  if (bestScore >= 0.4) return bestValue;

  // 5. Default
  return SERVICE_LINE_CANONICAL['AL'];
}

/**
 * Returns [levelOfCare] — or [SKILLED, INTERMED] for HC/SNF because MatrixCare
 * requires two rows per HC bed type.
 */
export function fuzzyMapServiceLineToLevels(serviceLine: string): string[] {
  const sl = norm(serviceLine);
  if (
    sl === 'HC' || sl === 'SNF' || sl === 'HC MC' ||
    sl.includes('SKILLED') || sl.includes('NURSING') || sl.includes('HEALTH CARE') ||
    sl.includes('HEALTHCARE') || sl.includes('HOME CARE')
  ) {
    return ['BASE RATE - SKILLED - ACTIVE', 'BASE RATE - INTERMED - ACTIVE'];
  }
  return [fuzzyMapServiceLine(serviceLine)];
}

// ─── Room Type → MatrixCare BedTypeDescription ───────────────────────────────

const ROOM_TYPE_CANONICAL: Record<string, string> = {
  'Private':      'Private',
  'Semi-Private': 'Semi-Private',
  'Companion':    'Companion',
  'Studio':       'Private',
  'One Bedroom':  'Private',
  'Two Bedroom':  'Private',
};

const ROOM_TYPE_ALIASES: Array<[string, string]> = [
  // Companion must be checked BEFORE generic 'SUITE' or 'SINGLE' fragments
  ['COMPANION SUITE', 'Companion'],
  ['COMPANION ROOM',  'Companion'],
  ['COMPANION',       'Companion'],
  // Semi-private / shared
  ['SEMI PRIVATE', 'Semi-Private'],
  ['SEMI',         'Semi-Private'],
  ['SHARED',       'Semi-Private'],
  ['DOUBLE',       'Semi-Private'],
  // Private / single
  ['SINGLE',       'Private'],
  ['PRIVATE',      'Private'],
  ['1 BEDROOM',    'Private'],
  ['ONE BEDROOM',  'Private'],
  ['1BR',          'Private'],
  ['2 BEDROOM',    'Private'],
  ['TWO BEDROOM',  'Private'],
  ['2BR',          'Private'],
  ['STUDIO',       'Private'],
  ['EFFICIENCY',   'Private'],
  ['SUITE',        'Private'],   // generic fallback — after COMPANION SUITE
];

export function fuzzyMapRoomType(roomType: string): string {
  if (!roomType) return 'Private';

  // 1. Exact
  if (ROOM_TYPE_CANONICAL[roomType]) return ROOM_TYPE_CANONICAL[roomType];

  const n = norm(roomType);

  // 2. Normalised exact
  for (const [k, v] of Object.entries(ROOM_TYPE_CANONICAL)) {
    if (norm(k) === n) return v;
  }

  // 3. Alias table
  for (const [alias, canonical] of ROOM_TYPE_ALIASES) {
    if (n.includes(alias)) return canonical;
  }

  // 4. Token overlap
  const inputTokens = tokens(roomType);
  let bestScore = 0;
  let bestValue = 'Private';
  for (const [k, v] of Object.entries(ROOM_TYPE_CANONICAL)) {
    const score = jaccard(inputTokens, tokens(k));
    if (score > bestScore) { bestScore = score; bestValue = v; }
  }
  if (bestScore >= 0.4) return bestValue;

  return 'Private';
}

// ─── Service Line → Payer configurations ─────────────────────────────────────

export interface PayerConfig {
  payerName: string;
  payerChargeBy: 'Daily' | 'Monthly';
  proration: string;
}

export function getPayerConfigurations(serviceLine: string): PayerConfig[] {
  const sl = norm(serviceLine);

  // HC / SNF / Skilled
  if (
    ['HC', 'SNF', 'HC MC'].includes(sl) ||
    sl.includes('SKILLED') || sl.includes('NURSING') ||
    sl.includes('HEALTH CARE') || sl.includes('HEALTHCARE')
  ) {
    return [
      { payerName: 'Private HCC',   payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Hospice Private', payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Medicaid IN',   payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Medicare A',    payerChargeBy: 'Daily', proration: 'None' },
      { payerName: 'Insurance FFS', payerChargeBy: 'Daily', proration: 'None' },
    ];
  }

  // AL / MC / Memory Care
  if (
    ['AL', 'AL MC', 'ALMC', 'MC'].includes(sl) ||
    sl.includes('ASSISTED') || sl.includes('MEMORY')
  ) {
    return [
      { payerName: 'Private AL',    payerChargeBy: 'Monthly', proration: 'Annually' },
      { payerName: 'Hospice Private', payerChargeBy: 'Monthly', proration: 'Annually' },
      { payerName: 'Medicaid AL',   payerChargeBy: 'Daily',   proration: 'None' },
    ];
  }

  // SL / Independent
  if (['SL', 'IL'].includes(sl) || sl.includes('SENIOR LIVING') || sl.includes('INDEPENDENT')) {
    return [{ payerName: 'Private SL', payerChargeBy: 'Monthly', proration: 'Annually' }];
  }

  // VIL
  if (sl === 'VIL' || sl.includes('VILLAGE')) {
    return [{ payerName: 'Private VIL', payerChargeBy: 'Monthly', proration: 'Annually' }];
  }

  return [{ payerName: 'Private', payerChargeBy: 'Monthly', proration: 'Annually' }];
}

// ─── Service Line → Revenue Account ──────────────────────────────────────────

export function getRevenueAccount(serviceLine: string, payerName: string): string {
  const sl = norm(serviceLine);
  const pn = payerName.toUpperCase();

  // HC / SNF
  if (
    ['HC', 'SNF', 'HC MC'].includes(sl) ||
    sl.includes('SKILLED') || sl.includes('NURSING') ||
    sl.includes('HEALTH CARE') || sl.includes('HEALTHCARE')
  ) {
    if (pn.includes('MEDICAID'))  return '~C01-41020';
    if (pn.includes('MEDICARE'))  return '~C01-41030';
    if (pn.includes('INSURANCE')) return '~C01-41050';
    if (pn.includes('HOSPICE'))   return '~C01-41070';
    return '~C01-41010';
  }

  // AL / MC
  if (
    ['AL', 'AL MC', 'ALMC', 'MC'].includes(sl) ||
    sl.includes('ASSISTED') || sl.includes('MEMORY')
  ) {
    if (pn.includes('MEDICAID')) return '~C03-41020';
    return '~C03-41010';
  }

  // SL / IL / VIL
  return '~C04-41010';
}

// ─── Service Line → Payer name (special-rates export) ────────────────────────

export function getSpecialRatesPayerName(serviceLine: string): string {
  const sl = norm(serviceLine);
  if (
    ['HC', 'SNF', 'HC MC'].includes(sl) ||
    sl.includes('SKILLED') || sl.includes('NURSING') ||
    sl.includes('HEALTH CARE') || sl.includes('HEALTHCARE')
  ) return 'Private HCC';

  if (
    ['AL', 'AL MC', 'ALMC', 'MC'].includes(sl) ||
    sl.includes('ASSISTED') || sl.includes('MEMORY')
  ) return 'Private AL';

  if (sl === 'SL' || sl.includes('INDEPENDENT') || sl.includes('SENIOR LIVING')) return 'Private SL';
  if (sl === 'VIL' || sl.includes('VILLAGE')) return 'Private VIL';

  return 'Private';
}
