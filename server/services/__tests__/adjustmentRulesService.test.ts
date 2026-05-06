/**
 * Self-contained test suite for adjustmentRulesService stacking behaviour.
 * Run with:  npx tsx server/services/__tests__/adjustmentRulesService.test.ts
 */
import { applyAdjustmentRulesToUnit, applyAdjustmentRulesToBatch } from "../adjustmentRulesService";
import type { AdjustmentRules } from "@shared/schema";

// ── Minimal helpers ───────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AdjustmentRules>): AdjustmentRules {
  return {
    id: "test-id",
    name: "Test Rule",
    description: "test",
    locationId: null,
    serviceLine: null,
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 0 } as any,
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
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const vacantALUnit = { locationId: "loc-1", serviceLine: "AL", occupiedYN: false, daysVacant: 45 };
const occupiedALUnit = { locationId: "loc-1", serviceLine: "AL", occupiedYN: true, daysVacant: 0 };
const vacantMCUnit = { locationId: "loc-1", serviceLine: "MC", occupiedYN: false, daysVacant: 10 };

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\nadjustmentRulesService — stacking tests\n");

test("returns null when no rules are provided", () => {
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 4000, []);
  expect(r.ruleAdjustedRate).toBeNull();
  expect(r.appliedRuleName).toBeNull();
});

test("applies a single immediate percentage rule", () => {
  const rule = makeRule({
    name: "+5%",
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 4000, [rule]);
  expect(r.ruleAdjustedRate).toBe(4200);
  expect(r.appliedRuleName).toBe("+5%");
});

test("applies a single immediate fixed-dollar rule", () => {
  const rule = makeRule({
    name: "−$100",
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "fixed", adjustmentValue: -100 } as any,
  });
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 4500, [rule]);
  expect(r.ruleAdjustedRate).toBe(4400);
  expect(r.appliedRuleName).toBe("−$100");
});

test("stacks two rules in priority order and chains rates", () => {
  const rules = [
    makeRule({
      id: "r1", name: "+5% all vacant", priority: 10,
      trigger: { type: "condition", conditions: { occupancyStatus: "vacant" } } as any,
      action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
    }),
    makeRule({
      id: "r2", name: "−$100 after 30 days", priority: 5,
      trigger: { type: "condition", conditions: { occupancyStatus: "vacant", vacancyDuration: { operator: ">=", days: 30 } } } as any,
      action: { type: "adjust_rate", adjustmentType: "fixed", adjustmentValue: -100 } as any,
    }),
  ];
  // 4500 * 1.05 = 4725 → 4725 - 100 = 4625
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 4500, rules);
  expect(r.ruleAdjustedRate).toBe(4625);
  expect(r.appliedRuleName).toBe("+5% all vacant + −$100 after 30 days");
});

test("applies higher-priority rule first when stacking", () => {
  const rules = [
    makeRule({
      id: "r-low", name: "Rule Low", priority: 1,
      trigger: { type: "immediate" } as any,
      action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 10 } as any,
    }),
    makeRule({
      id: "r-high", name: "Rule High", priority: 100,
      trigger: { type: "immediate" } as any,
      action: { type: "adjust_rate", adjustmentType: "fixed", adjustmentValue: 500 } as any,
    }),
  ];
  // High first: 4000 + 500 = 4500; then +10%: 4500 * 1.10 = 4950
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 4000, rules);
  expect(r.ruleAdjustedRate).toBe(4950);
  expect(r.appliedRuleName).toBe("Rule High + Rule Low");
});

test("skips vacant-only rule for an occupied unit", () => {
  const rule = makeRule({
    name: "Vacant only",
    trigger: { type: "condition", conditions: { occupancyStatus: "vacant" } } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const r = applyAdjustmentRulesToUnit(occupiedALUnit, 4000, [rule]);
  expect(r.ruleAdjustedRate).toBeNull();
});

test("skips vacancy-duration rule when unit has not been vacant long enough", () => {
  const rule = makeRule({
    name: "Long vacant",
    trigger: { type: "condition", conditions: { occupancyStatus: "vacant", vacancyDuration: { operator: ">=", days: 30 } } } as any,
    action: { type: "adjust_rate", adjustmentType: "fixed", adjustmentValue: -200 } as any,
  });
  const shortVacant = { ...vacantALUnit, daysVacant: 10 };
  const r = applyAdjustmentRulesToUnit(shortVacant, 4000, [rule]);
  expect(r.ruleAdjustedRate).toBeNull();
});

test("skips rule scoped to a different service line", () => {
  const rule = makeRule({
    name: "AL only",
    serviceLine: "AL",
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const r = applyAdjustmentRulesToUnit(vacantMCUnit, 4000, [rule]);
  expect(r.ruleAdjustedRate).toBeNull();
});

test("skips rule scoped to a different location", () => {
  const rule = makeRule({
    name: "Other location",
    locationId: "loc-999",
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 4000, [rule]);
  expect(r.ruleAdjustedRate).toBeNull();
});

test("batch: only matching units get adjusted", () => {
  const rule = makeRule({
    name: "Vacant AL +3%",
    serviceLine: "AL",
    trigger: { type: "condition", conditions: { occupancyStatus: "vacant" } } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 3 } as any,
  });
  const units = [
    { id: "u1", unit: vacantALUnit,   moduloSuggestedRate: 4000 },
    { id: "u2", unit: occupiedALUnit, moduloSuggestedRate: 4000 },
    { id: "u3", unit: vacantMCUnit,   moduloSuggestedRate: 4000 },
  ];
  const results = applyAdjustmentRulesToBatch(units, [rule]);
  const u1 = results.find(r => r.id === "u1")!;
  const u2 = results.find(r => r.id === "u2")!;
  const u3 = results.find(r => r.id === "u3")!;
  expect(u1.ruleAdjustedRate).toBe(4120); // 4000 * 1.03
  expect(u2.ruleAdjustedRate).toBeNull();
  expect(u3.ruleAdjustedRate).toBeNull();
});

test("stacks three rules correctly", () => {
  const rules = [
    makeRule({ id: "r1", name: "Rule A", priority: 30,
      trigger: { type: "immediate" } as any,
      action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 10 } as any }),
    makeRule({ id: "r2", name: "Rule B", priority: 20,
      trigger: { type: "immediate" } as any,
      action: { type: "adjust_rate", adjustmentType: "fixed", adjustmentValue: -50 } as any }),
    makeRule({ id: "r3", name: "Rule C", priority: 10,
      trigger: { type: "immediate" } as any,
      action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: -2 } as any }),
  ];
  // 5000 * 1.10 = 5500 → 5500 - 50 = 5450 → Math.round(5450 * 0.98) = 5341
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 5000, rules);
  expect(r.ruleAdjustedRate).toBe(5341);
  expect(r.appliedRuleName).toBe("Rule A + Rule B + Rule C");
});

test("mixed: one rule matches, one doesn't — only matching rule applied", () => {
  const rules = [
    makeRule({ id: "r1", name: "Vacant rule", priority: 10,
      trigger: { type: "condition", conditions: { occupancyStatus: "vacant" } } as any,
      action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any }),
    makeRule({ id: "r2", name: "Occupied rule", priority: 5,
      trigger: { type: "condition", conditions: { occupancyStatus: "occupied" } } as any,
      action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 10 } as any }),
  ];
  // Only the vacant rule matches — +5% only
  const r = applyAdjustmentRulesToUnit(vacantALUnit, 4000, rules);
  expect(r.ruleAdjustedRate).toBe(4200);
  expect(r.appliedRuleName).toBe("Vacant rule");
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(48)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed.\n`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed.\n`);
  process.exit(1);
}
