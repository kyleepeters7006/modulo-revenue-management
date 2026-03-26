/**
 * Regression tests for normalizeRoomType - companion room type mapping
 * Task #7: Fix Companion room type: all campuses & service lines
 *
 * Run with: npx tsx tests/roomType.test.ts
 */
import { normalizeRoomType } from '../shared/roomTypes';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';

let passed = 0;
let failed = 0;

function assert(description: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: "${expected}", Got: "${actual}"`);
    failed++;
  }
}

console.log('\n=== Companion Room Type Normalization Tests ===\n');

// --- Companion variants (must all map to 'Companion') ---
assert('Companion Suite → Companion', normalizeRoomType('Companion Suite'), 'Companion');
assert('Companion → Companion', normalizeRoomType('Companion'), 'Companion');
assert('companion (lowercase) → Companion', normalizeRoomType('companion'), 'Companion');
assert('COMPANION (uppercase) → Companion', normalizeRoomType('COMPANION'), 'Companion');
assert('Compan (abbreviation) → Companion', normalizeRoomType('Compan'), 'Companion');
assert('Companion Room → Companion', normalizeRoomType('Companion Room'), 'Companion');
assert('companion suite → Companion', normalizeRoomType('companion suite'), 'Companion');

// BedTypeDesc semicolon-delimited variants (first part extracted before normalization)
assert('Companion (from BedTypeDesc first part) → Companion', normalizeRoomType('Companion'), 'Companion');

// --- Studio variants (must map to 'Studio') ---
assert('Studio → Studio', normalizeRoomType('Studio'), 'Studio');
assert('studio → Studio', normalizeRoomType('studio'), 'Studio');
assert('STUDIO → Studio', normalizeRoomType('STUDIO'), 'Studio');

// --- Studio Dlx variants ---
assert('Studio Dlx → Studio Dlx', normalizeRoomType('Studio Dlx'), 'Studio Dlx');
assert('Studio Deluxe → Studio Dlx', normalizeRoomType('Studio Deluxe'), 'Studio Dlx');

// --- One Bedroom variants ---
assert('One Bedroom → One Bedroom', normalizeRoomType('One Bedroom'), 'One Bedroom');
assert('1 Bedroom → One Bedroom', normalizeRoomType('1 Bedroom'), 'One Bedroom');
assert('1 BR → One Bedroom', normalizeRoomType('1 BR'), 'One Bedroom');

// --- Two Bedroom variants ---
assert('Two Bedroom → Two Bedroom', normalizeRoomType('Two Bedroom'), 'Two Bedroom');
assert('2 Bedroom → Two Bedroom', normalizeRoomType('2 Bedroom'), 'Two Bedroom');

// --- Edge cases ---
assert('Empty string defaults to Studio', normalizeRoomType(''), 'Studio');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
