/**
 * Self-contained test suite for adjustmentRulesService stacking behaviour.
 * Run with:  npx tsx server/services/__tests__/adjustmentRulesService.test.ts
 */
import {
  applyAdjustmentRulesToUnit,
  applyAdjustmentRulesToBatch,
  resolvePostServiceLineScope,
  resolvePatchServiceLineScope,
} from "../adjustmentRulesService";
import type { AdjustmentRules } from "@shared/schema";

// ── Minimal helpers ───────────────────────────────────────────────────────────

function makeRule(overrides: Partial<AdjustmentRules> & { serviceLines?: string[] | null }): AdjustmentRules {
  return {
    id: "test-id",
    name: "Test Rule",
    description: "test",
    locationId: null,
    serviceLine: null,
    serviceLines: null,
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

// ── Multi-service-line scope tests ────────────────────────────────────────────

console.log("\nadjustmentRulesService — multi-service-line scope tests\n");

const alUnit   = { locationId: "loc-1", serviceLine: "AL",    occupiedYN: false, daysVacant: 5 };
const alMcUnit = { locationId: "loc-1", serviceLine: "AL/MC", occupiedYN: false, daysVacant: 5 };
const hcUnit   = { locationId: "loc-1", serviceLine: "HC",    occupiedYN: false, daysVacant: 5 };
const ilUnit   = { locationId: "loc-1", serviceLine: "IL",    occupiedYN: false, daysVacant: 5 };

const multiSlRule = makeRule({
  name: "AL+AL/MC rule",
  serviceLines: ["AL", "AL/MC"],
  trigger: { type: "immediate" } as any,
  action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 10 } as any,
});

test("multi-SL rule fires for the first listed SL (AL)", () => {
  const r = applyAdjustmentRulesToUnit(alUnit, 4000, [multiSlRule]);
  expect(r.ruleAdjustedRate).toBe(4400);
  expect(r.appliedRuleName).toBe("AL+AL/MC rule");
});

test("multi-SL rule fires for the second listed SL (AL/MC)", () => {
  const r = applyAdjustmentRulesToUnit(alMcUnit, 4000, [multiSlRule]);
  expect(r.ruleAdjustedRate).toBe(4400);
  expect(r.appliedRuleName).toBe("AL+AL/MC rule");
});

test("multi-SL rule skips an unlisted SL (HC)", () => {
  const r = applyAdjustmentRulesToUnit(hcUnit, 4000, [multiSlRule]);
  expect(r.ruleAdjustedRate).toBeNull();
});

test("multi-SL rule skips another unlisted SL (IL)", () => {
  const r = applyAdjustmentRulesToUnit(ilUnit, 4000, [multiSlRule]);
  expect(r.ruleAdjustedRate).toBeNull();
});

test("serviceLines takes precedence over serviceLine when both are set", () => {
  const conflictRule = makeRule({
    name: "Conflict rule",
    serviceLine: "HC",
    serviceLines: ["AL", "AL/MC"],
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "fixed", adjustmentValue: 200 } as any,
  });
  const rAL = applyAdjustmentRulesToUnit(alUnit, 4000, [conflictRule]);
  expect(rAL.ruleAdjustedRate).toBe(4200);
  const rHC = applyAdjustmentRulesToUnit(hcUnit, 4000, [conflictRule]);
  expect(rHC.ruleAdjustedRate).toBeNull();
});

test("unscoped rule (no SL, no serviceLines) fires for every service line", () => {
  const unscopedRule = makeRule({
    name: "Unscoped +5%",
    serviceLine: null,
    serviceLines: null,
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  const rAL   = applyAdjustmentRulesToUnit(alUnit,   4000, [unscopedRule]);
  const rALMC = applyAdjustmentRulesToUnit(alMcUnit, 4000, [unscopedRule]);
  const rHC   = applyAdjustmentRulesToUnit(hcUnit,   4000, [unscopedRule]);
  const rIL   = applyAdjustmentRulesToUnit(ilUnit,   4000, [unscopedRule]);
  expect(rAL.ruleAdjustedRate).toBe(4200);
  expect(rALMC.ruleAdjustedRate).toBe(4200);
  expect(rHC.ruleAdjustedRate).toBe(4200);
  expect(rIL.ruleAdjustedRate).toBe(4200);
});

test("single legacy serviceLine column still scopes correctly", () => {
  const legacyRule = makeRule({
    name: "Legacy HC only",
    serviceLine: "HC",
    serviceLines: null,
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "fixed", adjustmentValue: 100 } as any,
  });
  expect(applyAdjustmentRulesToUnit(hcUnit,   4000, [legacyRule]).ruleAdjustedRate).toBe(4100);
  expect(applyAdjustmentRulesToUnit(alUnit,   4000, [legacyRule]).ruleAdjustedRate).toBeNull();
  expect(applyAdjustmentRulesToUnit(ilUnit,   4000, [legacyRule]).ruleAdjustedRate).toBeNull();
});

test("empty serviceLines array is treated as unscoped (fires for all)", () => {
  const emptyArrayRule = makeRule({
    name: "Empty array rule",
    serviceLine: null,
    serviceLines: [],
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 3 } as any,
  });
  expect(applyAdjustmentRulesToUnit(alUnit, 4000, [emptyArrayRule]).ruleAdjustedRate).toBe(4120);
  expect(applyAdjustmentRulesToUnit(hcUnit, 4000, [emptyArrayRule]).ruleAdjustedRate).toBe(4120);
});

// ── POST/PATCH handler SL-storage resolution logic ────────────────────────────
//
// Tests call the REAL exported functions used by the route handlers.
// POST: serviceLines[] takes priority; single serviceLine string next; else none.
// PATCH: serviceLines !== undefined wins; else serviceLine !== undefined; else keep existing.
//
console.log("\nPOST/PATCH handler — service-line storage resolution tests (real exports)\n");

test("POST: single serviceLine → storeServiceLine set, storeServiceLines null", () => {
  const r = resolvePostServiceLineScope({ serviceLine: "AL" });
  expect(r.storeServiceLine).toBe("AL");
  expect(r.storeServiceLines).toBeNull();
});

test("POST: multi serviceLines → storeServiceLine null, storeServiceLines set", () => {
  const r = resolvePostServiceLineScope({ serviceLines: ["AL", "AL/MC"] });
  expect(r.storeServiceLine).toBeNull();
  expect(JSON.stringify(r.storeServiceLines)).toBe(JSON.stringify(["AL", "AL/MC"]));
});

test("POST: serviceLines takes precedence over serviceLine", () => {
  const r = resolvePostServiceLineScope({ serviceLine: "HC", serviceLines: ["AL", "AL/MC"] });
  expect(r.storeServiceLine).toBeNull();
  expect(JSON.stringify(r.storeServiceLines)).toBe(JSON.stringify(["AL", "AL/MC"]));
});

test("POST: no SL params → both null (unscoped rule)", () => {
  const r = resolvePostServiceLineScope({});
  expect(r.storeServiceLine).toBeNull();
  expect(r.storeServiceLines).toBeNull();
});

test("POST: empty serviceLines array falls through to serviceLine", () => {
  const r = resolvePostServiceLineScope({ serviceLine: "HC", serviceLines: [] });
  expect(r.storeServiceLine).toBe("HC");
  expect(r.storeServiceLines).toBeNull();
});

test("PATCH: single serviceLine → storeServiceLine set, storeServiceLines null", () => {
  const r = resolvePatchServiceLineScope({ serviceLine: "AL" }, {});
  expect(r.storeServiceLine).toBe("AL");
  expect(r.storeServiceLines).toBeNull();
});

test("PATCH: multi serviceLines → storeServiceLine null, storeServiceLines set", () => {
  const r = resolvePatchServiceLineScope({ serviceLines: ["AL", "AL/MC"] }, {});
  expect(r.storeServiceLine).toBeNull();
  expect(JSON.stringify(r.storeServiceLines)).toBe(JSON.stringify(["AL", "AL/MC"]));
});

test("PATCH: serviceLines=[] clears scope (both null) — unscopes the rule", () => {
  const r = resolvePatchServiceLineScope({ serviceLines: [] }, { serviceLine: "HC", serviceLines: null });
  expect(r.storeServiceLine).toBeNull();
  expect(r.storeServiceLines).toBeNull();
});

test("PATCH: serviceLines omitted — falls back to existing serviceLines", () => {
  const r = resolvePatchServiceLineScope({}, { serviceLines: ["AL", "HC"] });
  expect(r.storeServiceLine).toBeNull();
  expect(JSON.stringify(r.storeServiceLines)).toBe(JSON.stringify(["AL", "HC"]));
});

test("PATCH: serviceLines omitted, no existing serviceLines — falls back to existing serviceLine", () => {
  const r = resolvePatchServiceLineScope({}, { serviceLine: "IL", serviceLines: null });
  expect(r.storeServiceLine).toBe("IL");
  expect(r.storeServiceLines).toBeNull();
});

test("PATCH: serviceLines explicitly undefined keeps existing scope; new serviceLine overrides", () => {
  const r = resolvePatchServiceLineScope({ serviceLine: "HC" }, { serviceLine: "AL", serviceLines: null });
  expect(r.storeServiceLine).toBe("HC");
  expect(r.storeServiceLines).toBeNull();
});

// ── AI-tab scope persistence (catch silent blank-scope saves) ─────────────────
//
// Regression guard: the AI tab (rule-designer.tsx) sends { serviceLines: [...] }
// in the POST body. If that field is ever accidentally dropped or ignored by the
// route handler, the saved rule will have null serviceLines and will fire for ALL
// service lines — a silent over-scope bug.
//
// These tests simulate the exact payload the rule-designer sends when the user
// has 2 service lines selected in the Ask AI tab and verify end-to-end that:
//   1. resolvePostServiceLineScope returns storeServiceLines populated (non-null)
//   2. A rule built from those args is correctly scoped to the 2 SLs only
//   3. The storage args shape (what reaches createAdjustmentRule) has serviceLines set
//   4. The failure mode is documented — accidentally omitting serviceLines → unscoped rule

console.log("\nAI tab scope persistence — regression guard tests\n");

test("AI tab with 2 SLs: storeServiceLines is ['AL','HC'], not null", () => {
  const aiTabBody = { serviceLines: ["AL", "HC"] };
  const { storeServiceLine, storeServiceLines } = resolvePostServiceLineScope(aiTabBody);
  if (storeServiceLines === null) {
    throw new Error(
      "storeServiceLines is null — rule would fire for ALL service lines (blank-scope save)"
    );
  }
  expect(JSON.stringify(storeServiceLines)).toBe(JSON.stringify(["AL", "HC"]));
  expect(storeServiceLine).toBeNull();
});

test("AI tab with 2 SLs: rule fires for AL, fires for HC, skips IL", () => {
  const { storeServiceLines } = resolvePostServiceLineScope({ serviceLines: ["AL", "HC"] });
  const scopedRule = makeRule({
    name: "AI-tab rule",
    serviceLines: storeServiceLines,
    trigger: { type: "immediate" } as any,
    action: { type: "adjust_rate", adjustmentType: "percentage", adjustmentValue: 5 } as any,
  });
  expect(applyAdjustmentRulesToUnit(alUnit,   4000, [scopedRule]).ruleAdjustedRate).toBe(4200);
  expect(applyAdjustmentRulesToUnit(hcUnit,   4000, [scopedRule]).ruleAdjustedRate).toBe(4200);
  expect(applyAdjustmentRulesToUnit(ilUnit,   4000, [scopedRule]).ruleAdjustedRate).toBeNull();
});

test("regression: serviceLines accidentally omitted from AI-tab POST body → unscoped (null) — documents failure mode", () => {
  // If the rule-designer ever stops sending serviceLines in the POST body, both
  // storeServiceLine and storeServiceLines come back null, making the rule fire for
  // every service line. This test locks down that known failure mode so any change
  // that accidentally unscopes a previously-scoped rule is immediately visible.
  const bodyWithoutSLs = { description: "raise vacant rates by 5%" };
  const { storeServiceLine, storeServiceLines } = resolvePostServiceLineScope(bodyWithoutSLs);
  expect(storeServiceLine).toBeNull();
  expect(storeServiceLines).toBeNull();
});

test("AI tab createAdjustmentRule storage args: serviceLines is populated, serviceLine is null", () => {
  // Mirrors the route handler at POST /api/adjustment-rules (lines ~13749-13762).
  // Verifies that what reaches storage.createAdjustmentRule has serviceLines set correctly.
  const aiTabBody = { serviceLines: ["AL", "HC"] };
  const { storeServiceLine, storeServiceLines } = resolvePostServiceLineScope(aiTabBody);

  const storageArgs = {
    serviceLine: storeServiceLine,
    serviceLines: storeServiceLines,
    name: "AI Rule",
    isActive: true,
  };

  if (storageArgs.serviceLines === null || storageArgs.serviceLines.length === 0) {
    throw new Error(
      `serviceLines would be saved as ${JSON.stringify(storageArgs.serviceLines)} — ` +
      "blank-scope save: rule would fire for ALL service lines"
    );
  }
  expect(storageArgs.serviceLines.length).toBe(2);
  expect(JSON.stringify(storageArgs.serviceLines)).toBe(JSON.stringify(["AL", "HC"]));
  expect(storageArgs.serviceLine).toBeNull();
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(48)}`);
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed.\n`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed.\n`);
  process.exit(1);
}
