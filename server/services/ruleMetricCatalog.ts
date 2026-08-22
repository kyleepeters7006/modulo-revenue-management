/**
 * The metrics the AI suggestion prompt is allowed to advertise.
 *
 * Three things have to agree or a suggested rule fails silently:
 *   1. the prompt teaches the model a phrase,
 *   2. the parser turns that phrase into a trigger field,
 *   3. the impact evaluator can score that field.
 *
 * When (1) and (2) disagree the condition is dropped and a targeted rule
 * quietly becomes a blanket one. When (2) and (3) disagree the rule looks live
 * but reports zero affected units. Neither failure raises anything.
 *
 * So the allowed list is generated from this table rather than hand-written in
 * the prompt, and `tests/aiSuggestionImpactParity.test.ts` parses every
 * `samplePhrase` here and asserts it yields `field`, and that `field` is in
 * `IMPACT_SCOREABLE_FIELDS`. A metric cannot be advertised without proving it
 * survives the whole chain.
 *
 * Deliberately absent: `total_units`. It parses, but NEITHER the impact
 * evaluator nor the live pricing engine scores it, so every rule built on it
 * was dead on arrival. The parser alias is kept so pre-existing rules still
 * parse; it is simply never taught to the model.
 */

export interface AdvertisedMetric {
  /** How the allowed-metrics list names it. */
  label: string;
  /** A complete condition clause the parser must resolve to `field`. */
  samplePhrase: string;
  /** The trigger field the phrase must parse to. */
  field: string;
  /** Shown in the grammar section as a worked example. */
  grammarExample?: string;
}

export const ADVERTISED_METRICS: readonly AdvertisedMetric[] = [
  {
    label: 'campus occupancy',
    samplePhrase: 'campus occupancy is greater than 90',
    field: 'occupancy',
    grammarExample: '"when campus occupancy is above 90"',
  },
  {
    label: 'service line occupancy',
    samplePhrase: 'service line occupancy is greater than 90',
    field: 'service_line_occupancy',
    grammarExample: '"when service line occupancy drops below 80"',
  },
  {
    label: 'room type occupancy',
    samplePhrase: 'room type occupancy is less than 85',
    field: 'room_type_occupancy',
    grammarExample: '"when room type occupancy exceeds 95"',
  },
  {
    label: 'room type occupancy (trailing 3 / 6 / 12)',
    samplePhrase: 'room type occupancy (trailing 3) is below 85',
    field: 'room_type_occupancy_trailing3',
    grammarExample: '"when room type occupancy (trailing 3) is below 85"',
  },
  {
    label: 'service line occupancy (trailing 3 / 6 / 12)',
    samplePhrase: 'service line occupancy (trailing 6) is below 88',
    field: 'service_line_occupancy_trailing6',
    grammarExample: '"when service line occupancy (trailing 6) is below 88"',
  },
  {
    label: 'campus occupancy (trailing 3 / 6 / 12)',
    samplePhrase: 'campus occupancy (trailing 12) is below 90',
    field: 'occupancy_trailing12',
    grammarExample: '"when campus occupancy (trailing 12) is below 90"',
  },
  {
    label: 'street rate to top comp var %',
    samplePhrase: 'street rate to top comp var % is less than 0',
    field: 'street_to_comp_var',
    grammarExample: '"when street rate to top comp var % is less than -5" (negative = priced below comps)',
  },
  {
    label: 'in-house to street variance',
    samplePhrase: 'in-house to street variance is greater than 10%',
    field: 'ih_street_variance',
    grammarExample: '"when in-house to street variance is greater than 10%"',
  },
  {
    label: 'days vacant',
    samplePhrase: 'days vacant is greater than 60',
    field: 'days_vacant',
    grammarExample: '"when days vacant is greater than 60"',
  },
  {
    label: 'vacant units',
    samplePhrase: 'vacant units is greater than 5',
    field: 'vacant_units',
    grammarExample: '"when vacant units is greater than 5"',
  },
  {
    label: 'inquiry volume',
    samplePhrase: 'inquiry volume is greater than 100',
    field: 'inquiry_volume',
    grammarExample: '"when inquiry volume is greater than 100"',
  },
  {
    label: 'quality mix (private-pay % of census)',
    samplePhrase: 'quality mix is greater than 70',
    field: 'quality_mix',
    grammarExample: '"when quality mix is greater than 70"',
  },
];

/** The allowed-metrics list, rendered for the prompt. */
/**
 * The allowed-metrics line for the prompt.
 *
 * `unavailableFields` drops metrics the current client has no data behind. A
 * metric that is advertised but unpopulated is worse than one that is absent:
 * the model picks a threshold against a blank or an all-zero feed, the rule
 * parses, and it then matches everything or nothing for reasons no one can see
 * on screen. Suppressing it is the honest option — the model simply reasons
 * from the metrics that do have values.
 */
export function advertisedMetricsList(unavailableFields?: Set<string>): string {
  return ADVERTISED_METRICS
    .filter(m => !unavailableFields?.has(m.field))
    .map(m => m.label)
    .join(', ');
}

/** The worked grammar examples, one per line, for the prompt's grammar section. */
export function advertisedMetricExamples(indent = '  * '): string {
  return ADVERTISED_METRICS
    .filter(m => m.grammarExample)
    .map(m => `${indent}${m.grammarExample}`)
    .join('\n');
}
