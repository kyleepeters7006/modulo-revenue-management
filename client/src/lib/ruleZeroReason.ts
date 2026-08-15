/**
 * Shared helpers for explaining why an adjustment rule affects zero units.
 *
 * A rule showing "0 units" is usually correct, but a bare zero is ambiguous —
 * it could mean the rule's filters match nothing, its triggers never fire, or
 * another rule already claimed every unit it would have taken. The server
 * diagnoses this and returns a `zeroReason`; these helpers turn it into text.
 *
 * Used by both rule tables (Pricing Controls' impact breakdown and the rule
 * designer's admin table) so the two never drift apart.
 */

const TRIGGER_FIELD_LABELS: Record<string, string> = {
  service_line_occupancy: 'SL occupancy',
  service_line_occupancy_trailing3: 'SL occupancy (T3)',
  service_line_occupancy_trailing6: 'SL occupancy (T6)',
  service_line_occupancy_trailing12: 'SL occupancy (T12)',
  room_type_occupancy: 'Room type occupancy',
  room_type_occupancy_trailing3: 'Room type occupancy (T3)',
  room_type_occupancy_trailing6: 'Room type occupancy (T6)',
  room_type_occupancy_trailing12: 'Room type occupancy (T12)',
  occupancy: 'Campus occupancy',
  occupancy_trailing3: 'Campus occupancy (T3)',
  occupancy_trailing6: 'Campus occupancy (T6)',
  occupancy_trailing12: 'Campus occupancy (T12)',
  campus_occupancy: 'Campus occupancy',
  days_vacant: 'Days vacant',
  street_to_comp_var: 'Street vs top comp',
  vacant_units: 'Vacant units',
};

export interface ZeroReason {
  kind: 'no_matching_units' | 'suppressed' | 'condition_never_met' | 'conditions_never_co_occur';
  candidateUnits?: number;
  unsatisfiedConditions?: any[];
}

/** Human-readable label for one trigger condition, e.g. "SL occupancy ≥ 85%". */
export function describeCondition(c: any): string {
  const field = String(c?.field ?? '');
  const name = TRIGGER_FIELD_LABELS[field] || field.replace(/_/g, ' ');
  const op = c?.operator === '>=' ? '≥' : c?.operator === '<=' ? '≤'
    : c?.operator === '<' ? '<' : c?.operator === '>' ? '>' : (c?.operator ?? '');
  const raw = Number(c?.value ?? 0);
  // Occupancy thresholds are stored either as a fraction (0.85) or as a whole
  // percent (85). Mirror the engine exactly — it normalises on Math.abs(v) <= 1,
  // so a negative whole-percent threshold like -2 must stay -2%, not -200%.
  const value = field.includes('occupancy')
    ? `${Math.round(Math.abs(raw) <= 1 ? raw * 100 : raw)}%`
    : field === 'street_to_comp_var' ? `${raw}%` : String(c?.value ?? '');
  return `${name} ${op} ${value}`;
}

/** Short badge text explaining why a rule affects zero units. */
export function zeroReasonLabel(z: ZeroReason | undefined): string {
  switch (z?.kind) {
    case 'no_matching_units': return 'no units match its filters';
    case 'suppressed': return `all ${z.candidateUnits ?? 0} units claimed by other rules`;
    case 'condition_never_met': return 'a condition is never met';
    case 'conditions_never_co_occur': return 'conditions never occur together';
    default: return 'no units affected';
  }
}

/** Full explanation, suitable for a tooltip or title attribute. */
export function zeroReasonDetail(z: ZeroReason | undefined): string {
  const n = z?.candidateUnits ?? 0;
  const s = n === 1 ? '' : 's';
  switch (z?.kind) {
    case 'no_matching_units':
      return 'No units in the current scope match this rule’s room-type and vacancy filters, so its trigger conditions were never evaluated.';
    case 'suppressed':
      return `This rule qualifies ${n} unit${s}, but a higher-precedence rule already claimed every one of them, so the impact is counted against that rule instead.`;
    case 'condition_never_met': {
      const list = (z?.unsatisfiedConditions || []).map(describeCondition).join('; ');
      const many = (z?.unsatisfiedConditions || []).length !== 1;
      return `No unit satisfies ${many ? 'these conditions' : 'this condition'} even on its own: ${list}.`;
    }
    case 'conditions_never_co_occur':
      return `Each condition matches units on its own, but no unit satisfies all of them at the same time. ${n} unit${s} match this rule’s filters before the triggers are applied.`;
    default:
      return '';
  }
}
