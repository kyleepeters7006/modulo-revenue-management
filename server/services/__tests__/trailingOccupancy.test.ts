/**
 * Trailing occupancy tests — verifies that trailing-3/6/12 rule conditions
 * evaluate against room_type_occupancy_history data rather than the current
 * rent-roll snapshot, with correct room-type normalization so aliased values
 * like "1 BR" match canonical history keys like "One Bedroom".
 *
 * Run with:  npx tsx server/services/__tests__/trailingOccupancy.test.ts
 */
import { parseNaturalLanguageRule } from "../../naturalLanguageParser";
import {
  applyAdjustmentRulesToUnit,
  preloadCampusMetrics,
} from "../adjustmentRulesService";
import {
  computeQualifiedRuleImpact,
  buildGroupRulePreviewRates,
  aggregatePreviewTrailingOccRows,
} from "../ruleImpactService";
import type { AdjustmentRules } from "@shared/schema";
import type { RuleImpactContext } from "../ruleImpactService";

// ── Minimal helpers ────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AdjustmentRules> & { serviceLines?: string[] | null }): AdjustmentRules {
  return {
    id: "test-id",
    name: "Test Rule",
    description: "test",
    locationId: null,
    serviceLine: null,
    serviceLines: null,
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
    isActive: true,
    priority: 0,
    createdBy: null,
    lastExecuted: null,
    executionCount: 0,
    monthlyImpact: 0,
    annualImpact: 0,
    volumeAdjustedAnnualImpact: 0,
    actualAnnualImpact: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AdjustmentRules;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${e.message}`);
    failed++;
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    not: {
      toBeNull() {
        if (actual === null || actual === undefined) {
          throw new Error(`Expected non-null, got ${JSON.stringify(actual)}`);
        }
      },
    },
  };
}

// ── NL Parser tests ────────────────────────────────────────────────────────

console.log("\nNL Parser — trailing occupancy phrase recognition\n");

test("Room Type Occupancy (Trailing 3) parses to room_type_occupancy_trailing3", () => {
  const rule = parseNaturalLanguageRule(
    "If Room Type Occupancy (Trailing 3) >= 90%, increase rate by 3%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy_trailing3");
});

test("Service Line Occupancy (Trailing 6) parses to service_line_occupancy_trailing6", () => {
  const rule = parseNaturalLanguageRule(
    "If Service Line Occupancy (Trailing 6) >= 88%, increase rate by 2%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("service_line_occupancy_trailing6");
});

test("Campus Occupancy (Trailing 12) parses to occupancy_trailing12", () => {
  const rule = parseNaturalLanguageRule(
    "If Campus Occupancy (Trailing 12) >= 85%, increase rate by 1%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("occupancy_trailing12");
});

test("Room Type Occupancy (Trailing 12) parses to room_type_occupancy_trailing12", () => {
  const rule = parseNaturalLanguageRule(
    "If Room Type Occupancy (Trailing 12) >= 90%, increase rate by 5%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy_trailing12");
});

test("Service Line Occupancy (Trailing 3) parses to service_line_occupancy_trailing3", () => {
  const rule = parseNaturalLanguageRule(
    "If Service Line Occupancy (Trailing 3) < 80%, decrease rate by 2%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("service_line_occupancy_trailing3");
});

test("Plain 'Room Type Occupancy' without trailing modifier still parses to room_type_occupancy", () => {
  const rule = parseNaturalLanguageRule(
    "If Room Type Occupancy >= 90%, increase rate by 3%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy");
});

test("Natural trailing-3 without parens (If path) parses to room_type_occupancy_trailing3", () => {
  const rule = parseNaturalLanguageRule(
    "If room type occupancy trailing 3 >= 90%, increase rate by 3%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy_trailing3");
});

// ── No-If generalized path tests (parseTrigger bypasses METRIC_TO_FIELD) ──
// These test the "generalized single-condition triggers" section which had
// hardcoded plain field names and silently ignored trailing modifiers.

test("No-If: 'Room Type Occupancy (Trailing 3) >= 90%, increase by 3%' → room_type_occupancy_trailing3", () => {
  const rule = parseNaturalLanguageRule(
    "Room Type Occupancy (Trailing 3) >= 90%, increase rate by 3%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy_trailing3");
});

test("No-If: 'room type occupancy trailing 3 >= 90%, increase by 3%' → room_type_occupancy_trailing3", () => {
  const rule = parseNaturalLanguageRule(
    "room type occupancy trailing 3 >= 90%, increase rate by 3%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy_trailing3");
});

test("No-If: 'trailing 3 room type occupancy >= 90%, increase by 3%' → room_type_occupancy_trailing3", () => {
  const rule = parseNaturalLanguageRule(
    "trailing 3 room type occupancy >= 90%, increase rate by 3%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy_trailing3");
});

test("No-If: 'Service Line Occupancy (Trailing 6) >= 88%, increase by 2%' → service_line_occupancy_trailing6", () => {
  const rule = parseNaturalLanguageRule(
    "Service Line Occupancy (Trailing 6) >= 88%, increase rate by 2%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("service_line_occupancy_trailing6");
});

test("No-If: 'service line occupancy trailing-12 >= 80%, increase by 1%' → service_line_occupancy_trailing12", () => {
  const rule = parseNaturalLanguageRule(
    "service line occupancy trailing-12 >= 80%, increase rate by 1%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("service_line_occupancy_trailing12");
});

test("No-If: 'occupancy (trailing 12) >= 85%, increase by 1%' → occupancy_trailing12", () => {
  const rule = parseNaturalLanguageRule(
    "occupancy (trailing 12) >= 85%, increase rate by 1%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("occupancy_trailing12");
});

test("No-If: plain 'room type occupancy >= 90%, increase by 3%' still → room_type_occupancy (no regression)", () => {
  const rule = parseNaturalLanguageRule(
    "room type occupancy >= 90%, increase rate by 3%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy");
});

test("No-If: trailing-6 hyphenated form → room_type_occupancy_trailing6", () => {
  const rule = parseNaturalLanguageRule(
    "room type occupancy trailing-6 >= 90%, increase rate by 2%"
  );
  expect(rule).not.toBeNull();
  const trigger = rule!.trigger as any;
  const cond = trigger.condition ?? trigger.conditions?.[0];
  expect(cond?.field).toBe("room_type_occupancy_trailing6");
});

// ── Live execution — evaluateSingleCondition via applyAdjustmentRulesToUnit ──

console.log("\nadjustmentRulesService — trailing occupancy trigger evaluation\n");

// Seed the in-memory campus_metrics cache with trailing occupancy data.
// The RT key uses normalized room type ("One Bedroom"), not the raw alias.
preloadCampusMetrics([
  // Campus-level metrics at loc-trail
  { clientId: "test", locationId: "loc-trail", serviceLine: null, roomType: null, metricName: "occupancy_pct",           value: 70 },
  { clientId: "test", locationId: "loc-trail", serviceLine: null, roomType: null, metricName: "occupancy_pct_trailing3", value: 91 },
  { clientId: "test", locationId: "loc-trail", serviceLine: null, roomType: null, metricName: "occupancy_pct_trailing6", value: 88 },
  { clientId: "test", locationId: "loc-trail", serviceLine: null, roomType: null, metricName: "occupancy_pct_trailing12",value: 85 },
  // SL-level metrics for AL
  { clientId: "test", locationId: "loc-trail", serviceLine: "AL", roomType: null, metricName: "occupancy_pct",           value: 68 },
  { clientId: "test", locationId: "loc-trail", serviceLine: "AL", roomType: null, metricName: "occupancy_pct_trailing3", value: 93 },
  { clientId: "test", locationId: "loc-trail", serviceLine: "AL", roomType: null, metricName: "occupancy_pct_trailing6", value: 89 },
  // RT-level metrics keyed by CANONICAL room type ("One Bedroom")
  { clientId: "test", locationId: "loc-trail", serviceLine: "AL", roomType: "One Bedroom", metricName: "occupancy_pct",           value: 60 },
  { clientId: "test", locationId: "loc-trail", serviceLine: "AL", roomType: "One Bedroom", metricName: "occupancy_pct_trailing3", value: 95 },
  { clientId: "test", locationId: "loc-trail", serviceLine: "AL", roomType: "One Bedroom", metricName: "occupancy_pct_trailing6", value: 91 },
]);

const baseUnit = {
  clientId: "test",
  locationId: "loc-trail",
  serviceLine: "AL",
  roomType: "One Bedroom",
  occupiedYN: false,
  daysVacant: 0,
};

// Unit with an aliased room type ("1 BR") — should normalize to "One Bedroom"
const aliasedRtUnit = { ...baseUnit, roomType: "1 BR" };

test("room_type_occupancy_trailing3 fires when RT trailing-3 occ >= threshold (canonical RT key)", () => {
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.9 }, // stored as fraction
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const result = applyAdjustmentRulesToUnit(baseUnit, 4000, [rule]);
  expect(result.ruleAdjustedRate).toBe(4200);
});

test("room_type_occupancy_trailing3 does NOT fire when threshold is too high (fraction scale)", () => {
  // 0.99 is normalised to 99%. RT trailing-3 = 95% < 99% → rule does not fire.
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.99 },
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const result = applyAdjustmentRulesToUnit(baseUnit, 4000, [rule]);
  expect(result.ruleAdjustedRate).toBeNull();
});

test("aliased room type '1 BR' uses canonical 'One Bedroom' trailing-3 history (normalization)", () => {
  // This is the key regression test: if room type is not normalized at lookup
  // time, "1 BR" would miss the "One Bedroom" history entry and fall back to
  // SL-level (93%) or campus-level (91%) instead of RT-level (95%).
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.94 }, // 94% — only RT-level (95%) passes
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const result = applyAdjustmentRulesToUnit(aliasedRtUnit, 4000, [rule]);
  // RT trailing-3 = 95% >= 94% → rule fires
  expect(result.ruleAdjustedRate).toBe(4200);
});

test("SL trailing-6 triggers correctly", () => {
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "service_line_occupancy_trailing6", operator: ">=", value: 0.85 }, // 85% — SL trailing-6 = 89%
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 3 } as any,
  });
  const result = applyAdjustmentRulesToUnit(baseUnit, 4000, [rule]);
  expect(result.ruleAdjustedRate).toBe(4120);
});

test("campus trailing-12 triggers correctly", () => {
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "occupancy_trailing12", operator: ">=", value: 0.80 }, // campus trailing-12 = 85%
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 2 } as any,
  });
  const result = applyAdjustmentRulesToUnit(baseUnit, 4000, [rule]);
  expect(result.ruleAdjustedRate).toBe(4080);
});

test("trailing rule does NOT fire against current rent-roll when threshold is between trailing and current", () => {
  // Campus trailing-3 = 91%, but current occupancy_pct = 70%
  // A threshold of 85% should fire on trailing-3 (91% >= 85%) but not on current (70%)
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "occupancy_trailing3", operator: ">=", value: 0.85 },
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 2 } as any,
  });
  const result = applyAdjustmentRulesToUnit(baseUnit, 4000, [rule]);
  // trailing-3 = 91% >= 85% → fires (NOT using the 70% current value which would fail)
  expect(result.ruleAdjustedRate).toBe(4080);
});

test("plain occupancy field does not fire when current snapshot is below threshold (no trailing fallback)", () => {
  // occupancy_pct = 70. Use percentage-scale threshold (75) so the comparison is
  // 70 >= 75 → FALSE. This shows the plain field uses the current snapshot (70),
  // not the trailing value (91) — if it used trailing, the rule would fire.
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "occupancy", operator: ">=", value: 75 }, // percentage scale, not fraction
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 2 } as any,
  });
  const result = applyAdjustmentRulesToUnit(baseUnit, 4000, [rule]);
  // Current occupancy_pct = 70 < 75 → rule does not fire
  expect(result.ruleAdjustedRate).toBeNull();
});

test("fallback to current rent-roll when no trailing history exists for location", () => {
  // loc-no-history has no trailing metrics — only current occupancy_pct
  preloadCampusMetrics([
    { clientId: "test", locationId: "loc-no-history", serviceLine: "AL", roomType: null,
      metricName: "occupancy_pct", value: 92 },
  ]);
  const noHistUnit = { clientId: "test", locationId: "loc-no-history", serviceLine: "AL", roomType: "Studio", occupiedYN: false, daysVacant: 0 };
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "service_line_occupancy_trailing3", operator: ">=", value: 0.90 },
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const result = applyAdjustmentRulesToUnit(noHistUnit, 4000, [rule]);
  // Falls back to current occupancy_pct = 92% >= 90% → fires
  expect(result.ruleAdjustedRate).toBe(4200);
});

// ── RuleImpactContext — trailingOccMap evaluation ──────────────────────────

console.log("\nruleImpactService — trailing occupancy in trigger evaluation\n");

function makeContext(overrides: Partial<RuleImpactContext> = {}): RuleImpactContext {
  const loc = "loc1";
  const sl  = "AL";
  const rt  = "One Bedroom";  // canonical key used in history
  return {
    clientId: "test",
    latestMonth: "2026-08",
    units: [],
    groups: new Map([[`${loc}|${sl}|${rt}`, []]]),
    metrics: new Map([
      [loc,                  { total: 100, occupied: 70, stSum: 0, stN: 0, compStSum: 0, compCSum: 0, compN: 0, ihStSum: 0, ihISum: 0, ihN: 0, dvSum: 0, dvN: 0 }],
      [`${loc}|${sl}`,       { total:  50, occupied: 34, stSum: 0, stN: 0, compStSum: 0, compCSum: 0, compN: 0, ihStSum: 0, ihISum: 0, ihN: 0, dvSum: 0, dvN: 0 }],
      [`${loc}|${sl}|${rt}`, { total:  20, occupied: 12, stSum: 0, stN: 0, compStSum: 0, compCSum: 0, compN: 0, ihStSum: 0, ihISum: 0, ihN: 0, dvSum: 0, dvN: 0 }],
    ]),
    trailingOccMap: new Map([
      [`${loc}|||trailing3`,            90],   // campus trailing-3 = 90%
      [`${loc}|${sl}||trailing3`,       94],   // SL trailing-3 = 94%
      [`${loc}|${sl}|${rt}|trailing3`,  97],   // RT trailing-3 = 97%
    ]),
    moveMap: new Map(),
    slMoveInRate: new Map([[sl, 0.05]]),
    compBenchmark: { benchmarkFor: () => null, benchmarkForRT: () => null } as any,
    locIdToName: new Map([[loc, "Test Campus"]]),
    campusStreetToCompVar: new Map(),
    ...overrides,
  };
}

test("RT trailing-3 passes when trailingOccMap has RT-level entry above threshold", () => {
  const loc = "loc1"; const sl = "AL"; const rt = "One Bedroom";
  const ctx = makeContext();
  // Add a unit to the group so impact is non-zero
  const unit = { id: "u1", location_id: loc, location: "Test Campus", service_line: sl, room_type: rt, room_number: "101", street_rate: 4000, care_rate: 0, in_house_rate: 4000, occupied_yn: false, days_vacant: 30, competitor_final_rate: 0, payor_type: null };
  ctx.units.push(unit);
  ctx.groups.set(`${loc}|${sl}|${rt}`, [unit]);

  const rule = {
    id: "r1", name: "RT trailing-3 >= 95%", description: "", priority: 10,
    locationId: null, serviceLine: null, serviceLines: null, effective_date: null, notes: null,
    isActive: true, isAdditive: true,
    trigger: { type: "condition", condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.95 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5, filters: {} },
  };

  const impact = computeQualifiedRuleImpact(ctx, rule);
  // RT trailing-3 = 97% >= 95% → rule fires → affectedUnits > 0
  if (impact.affectedUnits === 0) throw new Error(`Expected affectedUnits > 0 (RT trailing-3 = 97% should pass 95% threshold), got ${impact.affectedUnits}`);
  console.log(`    affectedUnits=${impact.affectedUnits} ✓`);
});

test("RT trailing-3 with aliased rent-roll room type '1 BR' resolves via normalization", () => {
  const loc = "loc1"; const sl = "AL"; const rt = "One Bedroom";
  const ctx = makeContext();
  // Unit has raw/aliased room type "1 BR" but history is keyed by "One Bedroom"
  const unit = { id: "u2", location_id: loc, location: "Test Campus", service_line: sl, room_type: "1 BR", room_number: "102", street_rate: 4000, care_rate: 0, in_house_rate: 4000, occupied_yn: false, days_vacant: 30, competitor_final_rate: 0, payor_type: null };
  ctx.units.push(unit);
  // Group key uses the raw room type from rent_roll (as built in buildRuleImpactContext)
  ctx.groups.set(`${loc}|${sl}|1 BR`, [unit]);
  // But trailingOccMap is keyed by canonical "One Bedroom" (from normalized_room_type in history)
  // The evalGroupCondition code must normalize "1 BR" → "One Bedroom" at lookup time.

  const rule = {
    id: "r2", name: "RT trailing-3 aliased RT >= 95%", description: "", priority: 10,
    locationId: null, serviceLine: null, serviceLines: null, effective_date: null, notes: null,
    isActive: true, isAdditive: true,
    trigger: { type: "condition", condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.95 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5, filters: {} },
  };

  const impact = computeQualifiedRuleImpact(ctx, rule);
  // "1 BR" normalizes to "One Bedroom" → trailing-3 = 97% >= 95% → fires
  if (impact.affectedUnits === 0) throw new Error(`Expected affectedUnits > 0 — aliased "1 BR" should normalize to "One Bedroom" and hit the 97% trailing-3 value, not fall back to SL (94%) or campus (90%) which would also pass 95%... but let's verify with a stricter threshold`);
  console.log(`    affectedUnits=${impact.affectedUnits} ✓`);
});

test("strict threshold distinguishes RT (97%) vs SL fallback (94%) — normalization essential", () => {
  // Threshold of 96% — only the RT-level trailing value (97%) satisfies it.
  // If normalization is broken, "1 BR" misses the RT entry and falls back to SL (94%) → rule won't fire.
  const loc = "loc1"; const sl = "AL";
  const ctx = makeContext();
  const unit = { id: "u3", location_id: loc, location: "Test Campus", service_line: sl, room_type: "1 BR", room_number: "103", street_rate: 4000, care_rate: 0, in_house_rate: 4000, occupied_yn: false, days_vacant: 30, competitor_final_rate: 0, payor_type: null };
  ctx.units.push(unit);
  ctx.groups.set(`${loc}|${sl}|1 BR`, [unit]);

  const rule = {
    id: "r3", name: "RT trailing-3 strict >= 96%", description: "", priority: 10,
    locationId: null, serviceLine: null, serviceLines: null, effective_date: null, notes: null,
    isActive: true, isAdditive: true,
    trigger: { type: "condition", condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.96 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5, filters: {} },
  };

  const impact = computeQualifiedRuleImpact(ctx, rule);
  // With correct normalization: RT "One Bedroom" trailing-3 = 97% >= 96% → fires
  // Without normalization: falls back to SL (94%) which < 96% → would not fire
  if (impact.affectedUnits === 0) throw new Error(
    `Expected affectedUnits > 0 — "1 BR" must normalize to "One Bedroom" so the 97% RT value is used. ` +
    `If normalization is missing, the SL fallback (94%) is used and the rule incorrectly does not fire.`
  );
  console.log(`    affectedUnits=${impact.affectedUnits} (RT 97% >= 96% ✓ — normalization working)`);
});

// ── buildGroupRulePreviewRates — preview path trailing occupancy ───────────

console.log("\nbuildGroupRulePreviewRates — trailing occupancy preview path\n");

import { buildGroupRulePreviewRates } from "../ruleImpactService";
import type { ActiveRule, GroupRateInput } from "../ruleImpactService";

function makePreviewTrailingMap(): Map<string, number> {
  const m = new Map<string, number>();
  // Campus "Test Campus", SL "AL", RT "One Bedroom" (canonical)
  m.set("Test Campus|||trailing3",               88);  // campus trailing-3
  m.set("Test Campus|AL||trailing3",             93);  // SL trailing-3
  m.set("Test Campus|AL|One Bedroom|trailing3",  97);  // RT trailing-3
  m.set("Test Campus|AL|One Bedroom|trailing6",  91);  // RT trailing-6
  return m;
}

function makeActiveRule(overrides: Partial<ActiveRule> & { id: string; trigger: unknown; action: unknown }): ActiveRule {
  return {
    id: overrides.id,
    name: overrides.name ?? "Preview rule",
    description: "",
    locationId: null, location_id: null,
    serviceLine: null, serviceLines: null,
    effective_date: null, notes: null,
    isActive: true, isAdditive: true,
    priority: 0, executionCount: 0, monthlyImpact: 0, annualImpact: 0,
    volumeAdjustedAnnualImpact: 0, actualAnnualImpact: null,
    createdAt: new Date(), updatedAt: new Date(), createdBy: null, lastExecuted: null,
    trigger: overrides.trigger as any,
    action: overrides.action as any,
    ...overrides,
  } as unknown as ActiveRule;
}

const previewGroup: GroupRateInput = {
  campus: "Test Campus",
  sl: "AL",
  rt: "One Bedroom",
  locationId: "loc1",
  modeStreetRate: 4000,
  avgIhRate: 3500,
  total: 20,
  occ: 12,
};

test("buildGroupRulePreviewRates: RT trailing-3 PASSES when trailing occ (97%) above threshold (95%)", () => {
  const rule = makeActiveRule({
    id: "prev-1",
    trigger: { type: "condition", condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.95 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5, filters: {} },
  });
  const campOcc = new Map([["Test Campus", 0.7]]);
  const slOcc   = new Map([["Test Campus||AL", 0.68]]);
  const ihVar   = new Map<string, number>();
  const compVar = new Map<string, number>();
  const trailing = makePreviewTrailingMap();

  const { ruleRatesMap } = buildGroupRulePreviewRates([previewGroup], [rule], campOcc, slOcc, ihVar, compVar, trailing);
  const key = `Test Campus||AL||One Bedroom`;
  const rate = ruleRatesMap.get(`${key}||prev-1`);
  if (!rate) throw new Error(`Expected an adjusted rate in ruleRatesMap for key ${key}||prev-1 (RT trailing-3 = 97% >= 95% should pass)`);
  if (Math.abs(rate - 4200) > 1) throw new Error(`Expected adjusted rate ~4200, got ${rate}`);
  console.log(`    ruleRatesMap rate = ${rate} ✓`);
});

test("buildGroupRulePreviewRates: RT trailing-3 FAILS when trailing occ (97%) below threshold (98%)", () => {
  const rule = makeActiveRule({
    id: "prev-2",
    trigger: { type: "condition", condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.98 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5, filters: {} },
  });
  const campOcc = new Map([["Test Campus", 0.7]]);
  const slOcc   = new Map([["Test Campus||AL", 0.68]]);
  const ihVar   = new Map<string, number>();
  const compVar = new Map<string, number>();
  const trailing = makePreviewTrailingMap();

  const { ruleRatesMap } = buildGroupRulePreviewRates([previewGroup], [rule], campOcc, slOcc, ihVar, compVar, trailing);
  const key = `Test Campus||AL||One Bedroom`;
  const rate = ruleRatesMap.get(`${key}||prev-2`);
  if (rate !== undefined) throw new Error(`Expected NO entry in ruleRatesMap (RT trailing-3 = 97% < 98% threshold), but got rate = ${rate}`);
  console.log(`    ruleRatesMap has no entry — threshold not met ✓`);
});

test("buildGroupRulePreviewRates: campus trailing-3 PASSES threshold when above and FAILS when below", () => {
  // Campus trailing-3 = 88%.  Threshold 85% → should fire; threshold 90% → should not fire.
  const rulePass = makeActiveRule({
    id: "prev-3a",
    trigger: { type: "condition", condition: { field: "occupancy_trailing3", operator: ">=", value: 0.85 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 3, filters: {} },
  });
  const ruleFail = makeActiveRule({
    id: "prev-3b",
    trigger: { type: "condition", condition: { field: "occupancy_trailing3", operator: ">=", value: 0.90 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 3, filters: {} },
  });
  const campOcc = new Map([["Test Campus", 0.7]]);
  const slOcc   = new Map([["Test Campus||AL", 0.68]]);
  const ihVar   = new Map<string, number>();
  const compVar = new Map<string, number>();
  const trailing = makePreviewTrailingMap();
  const key = `Test Campus||AL||One Bedroom`;

  const { ruleRatesMap: passMap } = buildGroupRulePreviewRates([previewGroup], [rulePass], campOcc, slOcc, ihVar, compVar, trailing);
  const { ruleRatesMap: failMap } = buildGroupRulePreviewRates([previewGroup], [ruleFail], campOcc, slOcc, ihVar, compVar, trailing);

  if (!passMap.has(`${key}||prev-3a`)) throw new Error("Expected campus trailing-3 (88%) to pass 85% threshold");
  if (failMap.has(`${key}||prev-3b`))  throw new Error("Expected campus trailing-3 (88%) to NOT pass 90% threshold");
  console.log(`    pass=yes for 85%, pass=no for 90% ✓`);
});

test("buildGroupRulePreviewRates: trailing condition passes when trailingOccMap is absent (don't block display)", () => {
  // When no trailing map is supplied, trailing conditions should treat as passing
  const rule = makeActiveRule({
    id: "prev-4",
    trigger: { type: "condition", condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.999 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5, filters: {} },
  });
  const campOcc = new Map([["Test Campus", 0.7]]);
  const slOcc   = new Map([["Test Campus||AL", 0.68]]);
  const key = `Test Campus||AL||One Bedroom`;
  const { ruleRatesMap } = buildGroupRulePreviewRates([previewGroup], [rule], campOcc, slOcc, new Map(), new Map());
  // No trailing map → condition treated as passing → rule fires
  if (!ruleRatesMap.has(`${key}||prev-4`)) throw new Error("Expected trailing condition to pass (treat as passing) when trailingOccMap is absent");
  console.log(`    no trailing map → condition passes (don't block display) ✓`);
});

test("buildGroupRulePreviewRates: aliased RT '1 BR' normalizes to 'One Bedroom' for trailing lookup", () => {
  // Group uses raw RT "1 BR", map has "One Bedroom" (canonical) — normalization must bridge the gap
  const aliasedGroup: GroupRateInput = { ...previewGroup, rt: "1 BR" };
  const rule = makeActiveRule({
    id: "prev-5",
    trigger: { type: "condition", condition: { field: "room_type_occupancy_trailing3", operator: ">=", value: 0.96 } },
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5, filters: {} },
  });
  const campOcc = new Map([["Test Campus", 0.7]]);
  const slOcc   = new Map([["Test Campus||AL", 0.68]]);
  const trailing = makePreviewTrailingMap();
  // SL trailing-3 = 93% < 96%, campus trailing-3 = 88% < 96%; only RT (97%) passes the 96% threshold
  const { ruleRatesMap } = buildGroupRulePreviewRates([aliasedGroup], [rule], campOcc, slOcc, new Map(), new Map(), trailing);
  const key = `Test Campus||AL||1 BR`;
  if (!ruleRatesMap.has(`${key}||prev-5`)) throw new Error(
    `Expected "1 BR" to normalize to "One Bedroom" and hit trailing-3 = 97% (>= 96%). ` +
    `Without normalization, SL fallback (93%) or campus (88%) would both fail the 96% threshold.`
  );
  console.log(`    aliased "1 BR" normalised to "One Bedroom" → 97% passes 96% threshold ✓`);
});

// ── Composite service-line and nullable location_id coverage ──────────────

console.log("\nComposite SL tokenization and nullable location_id coverage\n");

// recalculateAndPreloadCampusMetrics tokenises "AL, MC" composite SL values
// into "AL" and "MC" entries before storing them in campus_metrics.
// We verify the evaluation side: when campus_metrics has "AL" entries (as they
// would be after tokenization), a rule conditioned on SL-level trailing occupancy
// for "AL" fires correctly for a unit in that SL.

preloadCampusMetrics([
  // Composite SL "AL, MC" was tokenized to "AL" and "MC" separately.
  { clientId: "test", locationId: "loc-composite", serviceLine: "AL", roomType: null,
    metricName: "occupancy_pct", value: 70 },
  { clientId: "test", locationId: "loc-composite", serviceLine: "AL", roomType: null,
    metricName: "occupancy_pct_trailing3", value: 92 },
  { clientId: "test", locationId: "loc-composite", serviceLine: "MC", roomType: null,
    metricName: "occupancy_pct", value: 65 },
  { clientId: "test", locationId: "loc-composite", serviceLine: "MC", roomType: null,
    metricName: "occupancy_pct_trailing3", value: 85 },
  { clientId: "test", locationId: "loc-composite", serviceLine: null, roomType: null,
    metricName: "occupancy_pct", value: 68 },
  { clientId: "test", locationId: "loc-composite", serviceLine: null, roomType: null,
    metricName: "occupancy_pct_trailing3", value: 89 },
]);

const compositeALUnit = {
  clientId: "test", locationId: "loc-composite", serviceLine: "AL",
  roomType: "Studio", occupiedYN: false, daysVacant: 0,
};
const compositeMCUnit = {
  clientId: "test", locationId: "loc-composite", serviceLine: "MC",
  roomType: "Studio", occupiedYN: false, daysVacant: 0,
};

test("SL trailing-3 for 'AL' unit evaluates against AL-specific trailing metrics (post-composite-tokenization)", () => {
  // Threshold 91%: AL trailing-3 = 92% >= 91% → fires; MC trailing-3 = 85% < 91% → would not fire
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "service_line_occupancy_trailing3", operator: ">=", value: 0.91 },
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const alResult = applyAdjustmentRulesToUnit(compositeALUnit, 4000, [rule]);
  const mcResult = applyAdjustmentRulesToUnit(compositeMCUnit, 4000, [rule]);
  // AL unit: SL trailing-3 = 92% >= 91% → fires → 4200
  expect(alResult.ruleAdjustedRate).toBe(4200);
  // MC unit: SL trailing-3 = 85% < 91% → does NOT fire
  expect(mcResult.ruleAdjustedRate).toBeNull();
});

test("campus trailing-3 for composite-SL location falls back to campus-level trailing value", () => {
  // Campus trailing-3 = 89%, threshold 85% → fires for any unit at this location
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "occupancy_trailing3", operator: ">=", value: 0.85 },
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 3 } as any,
  });
  const result = applyAdjustmentRulesToUnit(compositeALUnit, 4000, [rule]);
  // Campus trailing-3 = 89% >= 85% → fires
  expect(result.ruleAdjustedRate).toBe(4120);
});

// Nullable location_id: rows whose location_id is NULL in room_type_occupancy_history
// are resolved via location_name JOIN during loading (in buildRuleImpactContext and
// recalculateAndPreloadCampusMetrics). After loading, the metrics are stored/keyed by
// the resolved location_id (from the JOIN) — so evaluation proceeds identically.
// The test below demonstrates that the evaluation path correctly uses pre-loaded
// metrics regardless of how they were sourced (direct ID match or name-resolved).

preloadCampusMetrics([
  // These metrics were loaded from null-location_id history rows via name resolution.
  { clientId: "test", locationId: "loc-name-resolved", serviceLine: "SL", roomType: null,
    metricName: "occupancy_pct", value: 60 },
  { clientId: "test", locationId: "loc-name-resolved", serviceLine: "SL", roomType: null,
    metricName: "occupancy_pct_trailing6", value: 94 },
]);

test("SL trailing-6 rule evaluates correctly for a location whose history was loaded via name resolution", () => {
  const unit = { clientId: "test", locationId: "loc-name-resolved", serviceLine: "SL",
    roomType: "Studio", occupiedYN: false, daysVacant: 0 };
  const rule = makeRule({
    trigger: {
      type: "condition",
      condition: { field: "service_line_occupancy_trailing6", operator: ">=", value: 0.90 },
    } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 4 } as any,
  });
  const result = applyAdjustmentRulesToUnit(unit, 4000, [rule]);
  // SL trailing-6 = 94% >= 90% → fires
  expect(result.ruleAdjustedRate).toBe(4160);
});

// ── aggregatePreviewTrailingOccRows — composite SL tokenization ──────────────
// This tests the pure aggregation helper used inside buildPreviewTrailingOccMap.
// Composite service_line values like "AL, MC" must be tokenised so that
// preview trailing-occupancy lookups for "AL" find the correct RT/SL history
// rather than falling back to campus-level data.

console.log("\naggregatePreviewTrailingOccRows — composite SL tokenization\n");

// Simulate three history rows where service_line = "AL, MC" (composite).
// RT "Studio" with 3 months of data: month 3 = 95%, month 2 = 91%, month 1 = 87%.
// The SL-level weighted average for "AL" (trailing-3) should use all three months.
const compositeRows = [
  { location_name: "Sunset Gardens", service_line: "AL, MC", normalized_room_type: "Studio",
    year: 2026, month: 7, occ_units: 19, available_units: 20, occ_percent: 95 },
  { location_name: "Sunset Gardens", service_line: "AL, MC", normalized_room_type: "Studio",
    year: 2026, month: 6, occ_units: 18, available_units: 20, occ_percent: 90 },
  { location_name: "Sunset Gardens", service_line: "AL, MC", normalized_room_type: "Studio",
    year: 2026, month: 5, occ_units: 17, available_units: 20, occ_percent: 85 },
  // A "MC"-only row for a different room type
  { location_name: "Sunset Gardens", service_line: "MC", normalized_room_type: "One Bedroom",
    year: 2026, month: 7, occ_units: 10, available_units: 20, occ_percent: 50 },
];

const aggregated = aggregatePreviewTrailingOccRows(compositeRows);

test("aggregatePreviewTrailingOccRows: composite SL 'AL, MC' populates 'AL' RT trailing-3 entry", () => {
  // The RT key for "AL" Studio trailing-3 must exist (occ 19+18+17 / 20+20+20 = 54/60 = 90%)
  const rtKey = "Sunset Gardens|AL|Studio|trailing3";
  if (!aggregated.has(rtKey)) throw new Error(`Missing RT key ${rtKey} — composite SL not tokenised`);
  const avg = aggregated.get(rtKey)!;
  expect(Math.round(avg)).toBe(90);
});

test("aggregatePreviewTrailingOccRows: composite SL 'AL, MC' also populates 'MC' RT trailing-3 entry", () => {
  const rtKey = "Sunset Gardens|MC|Studio|trailing3";
  if (!aggregated.has(rtKey)) throw new Error(`Missing RT key ${rtKey} — 'MC' token from composite not found`);
  const avg = aggregated.get(rtKey)!;
  expect(Math.round(avg)).toBe(90);
});

test("aggregatePreviewTrailingOccRows: 'AL' SL trailing-3 uses 'AL' rows only (not distorted by MC-only rows)", () => {
  const slKey = "Sunset Gardens|AL||trailing3";
  if (!aggregated.has(slKey)) throw new Error(`Missing SL key ${slKey}`);
  // AL SL trailing-3: from the "AL, MC" composite rows only (MC-only "One Bedroom" row
  // contributes to "MC" SL but not "AL"). AL SL = 54/60 = 90%
  const avg = aggregated.get(slKey)!;
  expect(Math.round(avg)).toBe(90);
});

test("aggregatePreviewTrailingOccRows: 'MC' SL trailing-3 includes both composite and MC-only rows", () => {
  const slKey = "Sunset Gardens|MC||trailing3";
  if (!aggregated.has(slKey)) throw new Error(`Missing SL key ${slKey}`);
  // MC SL trailing-3: composite (month 7: 19/20, month 6: 18/20) + MC-only (month 7: 10/20)
  // Month 7 total for MC = 29occ/40avl; Month 6 = 18/20; Month 5 = 17/20
  // trailing-3 = (29+18+17)/(40+20+20) = 64/80 = 80%
  const avg = aggregated.get(slKey)!;
  expect(Math.round(avg)).toBe(80);
});

test("aggregatePreviewTrailingOccRows: campus trailing-3 aggregates all rows regardless of SL", () => {
  const campKey = "Sunset Gardens|||trailing3";
  if (!aggregated.has(campKey)) throw new Error(`Missing campus key ${campKey}`);
  // Campus trailing-3: month 7 occ=19+10=29, avl=20+20=40; month 6 occ=18,avl=20; month 5 occ=17,avl=20
  // total = (29+18+17)/(40+20+20) = 64/80 = 80%
  const avg = aggregated.get(campKey)!;
  expect(Math.round(avg)).toBe(80);
});

test("aggregatePreviewTrailingOccRows: non-composite SL ('MC' only row) builds its own RT entry", () => {
  const rtKey = "Sunset Gardens|MC|One Bedroom|trailing3";
  if (!aggregated.has(rtKey)) throw new Error(`Missing MC-only RT key ${rtKey}`);
  const avg = aggregated.get(rtKey)!;
  expect(Math.round(avg)).toBe(50); // 10/20 = 50%
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(56)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed.\n`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed.\n`);
  process.exit(1);
}
