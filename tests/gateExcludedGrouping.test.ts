/**
 * Grouping and totals guard for the gate-excluded rows report.
 *
 * The report tells admins how much source data the rate outlier gate dropped.
 * Its detail list is capped for payload safety, so the COUNTS must be derived
 * independently of the capped list — otherwise a truncated display would
 * under-report the problem, which is the opposite of what the report is for.
 *
 * Two failure modes are pinned here:
 *
 *   1. Display-key collision. The UI shows a missing room type as "Other". If
 *      the in-memory grouping keyed on that display fallback, three distinct
 *      SQL partitions — NULL, empty string, and a room type genuinely named
 *      "Other" — would collapse into one entry. Each carries its own
 *      group_dropped from the window function, so all but the first would be
 *      discarded and the totals would silently undercount.
 *
 *   2. Totals computed after the cap. Totals must be summed over every group
 *      before slicing, and from the window-derived droppedCount rather than the
 *      truncated rows array.
 */
import { getGateExcludedRows } from "../server/services/streetRateQualityService";

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

type Row = {
  location: string;
  service_line: string | null;
  room_type: string | null;
  room_number: string;
  street_rate: number;
  baseline_street: number;
  group_total: number;
  group_dropped: number;
};

function row(over: Partial<Row>): Row {
  return {
    location: "Maple Grove",
    service_line: "AL",
    room_type: "Studio",
    room_number: "101",
    street_rate: 100,
    baseline_street: 4000,
    group_total: 10,
    group_dropped: 1,
    ...over,
  };
}

const stub = (rows: Row[]) => async () => ({ rows });

// ---------------------------------------------------------------------------
// Section 1 — NULL, '' and a literal "Other" room type stay distinct.
// ---------------------------------------------------------------------------

console.log("Section 1: display-key collision");
{
  // Three separate SQL partitions in the same campus + service line. Each has
  // its own dropped count. All three display as room type "Other" except the
  // literal one, which is genuinely named "Other".
  const rows = [
    row({ room_type: null, room_number: "A1", group_total: 4, group_dropped: 2 }),
    row({ room_type: null, room_number: "A2", group_total: 4, group_dropped: 2 }),
    row({ room_type: "", room_number: "B1", group_total: 5, group_dropped: 3 }),
    row({ room_type: "Other", room_number: "C1", group_total: 6, group_dropped: 1 }),
  ];
  const { groups, totals } = await getGateExcludedRows("c", "2026-07", stub(rows) as any);

  check("three distinct groups survive", groups.length, 3);
  // 2 (NULL) + 3 ('') + 1 ("Other") — none absorbed by the display fallback.
  check("totals.rows sums every partition", totals.rows, 6);
  check("totals.groups counts every partition", totals.groups, 3);
  check("campuses de-duplicated", totals.campuses, 1);

  const blank = groups.filter((g) => g.roomType === "Other");
  check("all three display as Other", blank.length, 3);
}

// ---------------------------------------------------------------------------
// Section 2 — totals ignore the per-group row cap.
// ---------------------------------------------------------------------------

console.log("Section 2: totals vs row cap");
{
  // One group with far more dropped rows than the 25-row display cap.
  const rows = Array.from({ length: 60 }, (_, i) =>
    row({ room_number: `R${i}`, group_total: 80, group_dropped: 60 }),
  );
  const { groups, totals } = await getGateExcludedRows("c", "2026-07", stub(rows) as any);

  check("one group", groups.length, 1);
  check("rows are capped for display", groups[0].rows.length, 25);
  check("droppedCount reports the truth", groups[0].droppedCount, 60);
  check("totals.rows reports the truth, not the cap", totals.rows, 60);
  check("group is not blanked", groups[0].blanked, false);
}

// ---------------------------------------------------------------------------
// Section 3 — blanked groups, where every row was gated out.
// ---------------------------------------------------------------------------
// These are the highest-priority fixes: the group now reports no rate anywhere
// in the product, so they must sort first and be counted separately.

console.log("Section 3: blanked groups");
{
  const rows = [
    row({ location: "A", room_type: "Studio", group_total: 3, group_dropped: 3 }),
    row({ location: "B", room_type: "Studio", group_total: 10, group_dropped: 1 }),
    row({ location: "C", room_type: "Suite", group_total: 4, group_dropped: 4 }),
  ];
  const { groups, totals } = await getGateExcludedRows("c", "2026-07", stub(rows) as any);

  check("blanked groups counted", totals.blankedGroups, 2);
  check("campuses counted", totals.campuses, 3);
  check("blanked sort first", groups[0].blanked, true);
  check("blanked sort first (second)", groups[1].blanked, true);
  check("partial group sorts last", groups[2].blanked, false);
}

// ---------------------------------------------------------------------------
// Section 4 — a clean month reports nothing rather than failing.
// ---------------------------------------------------------------------------

console.log("Section 4: empty result");
{
  const { groups, totals } = await getGateExcludedRows("c", "2026-07", stub([]) as any);
  check("no groups", groups.length, 0);
  check("no rows", totals.rows, 0);
  check("no campuses", totals.campuses, 0);
  check("no blanked groups", totals.blankedGroups, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
