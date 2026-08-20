/**
 * Payer scope classification guard.
 *
 * "Private pay" is defined by EXCLUSION (see shared/payerScope.ts): anything
 * not recognisably an externally-priced programme counts as private. That is
 * the right default for the rent roll's small controlled vocabulary, but the
 * move-in/out events table carries ~90 raw billing-system values including
 * insurer brand names — an open vocabulary an exclusion list cannot fully
 * anticipate.
 *
 * So this test pins the classification of every payer value observed in
 * production. A new value from an import makes it fail, which forces a
 * deliberate decision instead of letting the value land silently in whichever
 * bucket happens to catch it. That silent-landing failure mode is exactly what
 * made four different payer definitions disagree by a third in the first place.
 *
 * If this fails after an import: add the value to the correct list below, and
 * add a keyword to NON_PRIVATE_PAYER_KEYWORDS if it should not be private.
 */
import {
  isPrivatePayer,
  privatePaySql,
  NON_PRIVATE_PAYER_KEYWORDS,
  NON_PRIVATE_PAYER_CODES,
} from "@shared/payerScope";

let passed = 0;
let failed = 0;

function check(desc: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${desc}\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Section 1 — every payer value observed in production, classified.
// ---------------------------------------------------------------------------

/**
 * Residents whose rate we set. Street pricing moves this revenue.
 *
 * The occupancy/billing states near the end of this list (BEDHOLDS,
 * 2ND OCCUPANT, CONVERSIONS, CLINICAL QUICK ADMIT) are private by explicit
 * product decision, not merely because the keyword list happens to miss them.
 */
const PRIVATE_VALUES = [
  "PRIVATE PAY",
  "PRIVATE AL",
  "PRIVATE HCC",
  "PRIVATE SL",
  "PRIVATE IL",
  "PRIVATE AL / IL",
  "PRIVATE LIABILITY",
  "LEGACY - PVT PAY",
  "LEGACY -",
  // Held beds and companion rows are billed privately. Companion rows are
  // additionally removed from senior-housing rate aggregates by the B-bed
  // exclusion, which is a separate concern from payer scope.
  "BEDHOLDS",
  "LEGACY - BEDHOLDS",
  "2ND OCCUPANT",
  "LEGACY - 2ND OCCUPANT",
  "CONVERSIONS",
  "CLINICAL QUICK ADMIT",
];

/** Rates set by an external programme or insurer. Pricing cannot move these. */
const NON_PRIVATE_VALUES = [
  // Named programmes
  "MEDICARE",
  "MEDICARE ADVANTAGE",
  "MEDICARE A",
  "MEDICARE A REPLACEMENT",
  "MEDICARE A- ACO",
  "MEDICAID",
  "LEGACY - MEDICAID",
  "HOSPICE",
  "HOSPICE INSURANCE",
  "HOSPICE PRIVATE", // hospice wins over the word "private"
  "MANAGED CARE",
  // "MCR" = Medicare in the billing system's abbreviations. These do NOT
  // contain the string "MEDICARE" and were the single biggest misclassification
  // risk: tens of thousands of Medicare Advantage admissions.
  "HUMANA MCR ADV",
  "ZZHUMANA MCR ADV - LEVEL",
  "AETNA MCR ADV",
  "CIGNA MCR ADV",
  "UHC MCR ADV",
  "UHC MCR ADV - ALL LEVELS",
  "BC/BS OF MI MCR ADV",
  "BC/BS OF IN MCR ADV",
  "BC/BS OF KY MCR ADV",
  "BC/BS OF OH MCR ADV",
  "BLUE CARE NET MI MCR ADV",
  "PRIORITY MCR ADV - LEVEL",
  "PRIORITY HLTH MI MCR ADV",
  "PARAMOUNT MCR ADV",
  "MED MUTUAL OH-MCR ADV",
  "MOLINA OF OH MCR ADV",
  "MOLINA OF MI MCR ADV",
  "BUCKEYE HEALTH OH MCR ADV",
  "CARESOURCE OH MCR ADV",
  // "MCD" = Medicaid
  "AETNA BH MI MGD MCD",
  "PRIORITY HLTH MI MNGD MCD",
  // Commercial insurance, including the abbreviated "COMM" spelling
  "BC/BS OF IN COMMERCIAL",
  "BC/BS OF MI COMMERCIAL",
  "BC/BS OF OH COMMERCIAL",
  "BC/BS OF KY COMMERCIAL",
  "UHC COMMERCIAL",
  "AETNA COMMERCIAL",
  "CIGNA COMMERCIAL",
  "HUMANA COMMERCIAL",
  "IU HP COMMERCIAL",
  "BLUE CARE NETWORK MI COMM",
  "PRIORITY HEALTH MI COMM",
  // Other externally-priced arrangements
  "INSURANCE PER DIEM",
  "INSURANCE FFS",
  "MED A - ISNP",
  "OPTUM VA CCN",
  "TRICARE FOR LIFE",
  "DEVOTED HEALTH INC",
];

console.log("Section 1: production payer values");
for (const v of PRIVATE_VALUES) check(`"${v}" is private`, isPrivatePayer(v), true);
for (const v of NON_PRIVATE_VALUES) check(`"${v}" is NOT private`, isPrivatePayer(v), false);

// ---------------------------------------------------------------------------
// Section 2 — blank handling and case/whitespace insensitivity.
// ---------------------------------------------------------------------------

console.log("Section 2: blanks and normalization");
// A blank payer counts as private. In the rent roll every blank row observed is
// VACANT, so this only affects potential revenue on empty units — where
// assuming we could price the unit is the point of the metric.
check("null is private", isPrivatePayer(null), true);
check("undefined is private", isPrivatePayer(undefined), true);
check("empty string is private", isPrivatePayer(""), true);
check("whitespace is private", isPrivatePayer("   "), true);
check("lowercase medicare is not private", isPrivatePayer("medicare"), false);
check("mixed case mcr adv is not private", isPrivatePayer("Humana Mcr Adv"), false);
check("padded value is not private", isPrivatePayer("  MEDICAID  "), false);
check("padded private stays private", isPrivatePayer("  PRIVATE PAY  "), true);

// ---------------------------------------------------------------------------
// Section 3 — the SQL twin must agree with the JS predicate.
// ---------------------------------------------------------------------------
// These are twins on purpose: some surfaces aggregate in SQL and some in JS.
// Drift between them reintroduces the inconsistency the shared module removed.
// Here we verify the SQL is well-formed and references every keyword; the
// behavioural tie-out against real rows lives in the DB-backed parity tests.

console.log("Section 3: SQL twin");
const sql = privatePaySql("rr.payor_type");
check("sql is parenthesised", sql.startsWith("(") && sql.endsWith(")"), true);
check("sql handles NULL", sql.includes("rr.payor_type IS NULL"), true);
check("sql handles blank", sql.includes("TRIM(rr.payor_type) = ''"), true);
for (const k of NON_PRIVATE_PAYER_KEYWORDS) {
  check(`sql excludes ${k}`, sql.includes(`NOT ILIKE '%${k}%'`), true);
}
// Short codes must be whole-word matched on BOTH sides of the twin. Postgres
// \y is the equivalent of the JS \b used by the predicate.
for (const c of NON_PRIVATE_PAYER_CODES) {
  check(`sql word-matches ${c}`, sql.includes(c), true);
}
check("sql uses a word-boundary regex for codes", sql.includes("!~*") && sql.includes("\\y"), true);
check("sql does not substring-match short codes", sql.includes("NOT ILIKE '%COMM%'"), false);
// Every keyword must be uppercase, since the JS predicate uppercases its input
// before comparing. A lowercase entry would never match in JS while still
// matching in SQL (ILIKE) — a silent JS/SQL divergence.
for (const k of [...NON_PRIVATE_PAYER_KEYWORDS, ...NON_PRIVATE_PAYER_CODES]) {
  check(`keyword ${k} is uppercase`, k === k.toUpperCase(), true);
}

// ---------------------------------------------------------------------------
// Section 4 — no keyword or code may swallow a private value.
// ---------------------------------------------------------------------------
// The short codes are the risk. "COMM" as a plain substring would classify
// "PRIVATE ACCOMMODATION" as externally priced; whole-word matching must not.

console.log("Section 4: keyword collisions");
for (const v of PRIVATE_VALUES) {
  const hit = NON_PRIVATE_PAYER_KEYWORDS.find((k) => v.toUpperCase().includes(k));
  check(`no keyword swallows "${v}"`, hit, undefined);
}

/** Private labels that CONTAIN a short code as a substring but not as a word. */
const NEAR_MISS_PRIVATE = [
  "PRIVATE ACCOMMODATION", // contains COMM
  "ACCOMMODATION",
  "PRIVATE - ACCOMMODATED",
  "MCRAE FAMILY TRUST", // contains MCR
  "PRIVATE MCDONALD ESTATE", // contains MCD
  "COMMUNITY FEE", // contains COMM
];
for (const v of NEAR_MISS_PRIVATE) {
  check(`near-miss "${v}" stays private`, isPrivatePayer(v), true);
}

/** The same codes as real whole words must still be excluded. */
const CODE_AS_WORD = [
  "HUMANA MCR ADV",
  "MED MUTUAL OH-MCR ADV", // hyphen is a word boundary
  "AETNA BH MI MGD MCD",
  "BLUE CARE NETWORK MI COMM",
  "COMM", // bare code
];
for (const v of CODE_AS_WORD) {
  check(`code-as-word "${v}" is NOT private`, isPrivatePayer(v), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
