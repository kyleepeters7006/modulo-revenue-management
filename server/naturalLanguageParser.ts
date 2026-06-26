// Natural Language Parser for Adjustment Rules
// Uses a grammar-based approach to parse common pricing adjustment patterns

export interface ParsedTrigger {
  type: 'event' | 'time' | 'condition' | 'immediate';
  event?: 'sale' | 'move_in' | 'move_out';
  timeInterval?: { unit: 'day' | 'week' | 'month' | 'quarter' | 'year'; value: number };
  // Singular condition (legacy single-condition format)
  condition?: {
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
    value: number | string;
  };
  // Multi-condition format (AND / OR)
  conditions?: Array<{
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
    value: number | string;
  }>;
  conditionOperator?: 'AND' | 'OR';
}

export interface ParsedAction {
  type: 'adjust_rate';
  target: 'street_rate' | 'care_rate' | 'all_rates';
  adjustmentType: 'percentage' | 'absolute';
  adjustmentValue: number;
  filters?: {
    roomType?: string[];
    serviceLine?: string[];
    location?: string[];
    occupancyStatus?: 'occupied' | 'vacant';
    vacancyDuration?: { operator: '>' | '<' | '>='; days: number };
  };
}

export interface ParsedRule {
  name: string;
  description: string;
  trigger: ParsedTrigger;
  action: ParsedAction;
}

// Common patterns and synonyms
const TIME_UNITS: Record<string, string> = {
  'daily': 'day',
  'weekly': 'week',
  'monthly': 'month',
  'quarterly': 'quarter',
  'annually': 'year',
  'yearly': 'year',
  'every day': 'day',
  'every week': 'week',
  'every month': 'month',
  'every quarter': 'quarter',
  'every year': 'year',
  'each day': 'day',
  'each week': 'week',
  'each month': 'month',
  'each quarter': 'quarter',
  'each year': 'year',
};

const RATE_TYPES: Record<string, string> = {
  'street rate': 'street_rate',
  'street rates': 'street_rate',
  'base rate': 'street_rate',
  'base rates': 'street_rate',
  'rent': 'street_rate',
  'rents': 'street_rate',
  'care rate': 'care_rate',
  'care rates': 'care_rate',
  'care fee': 'care_rate',
  'care fees': 'care_rate',
  'all rates': 'all_rates',
  'all prices': 'all_rates',
  'rates': 'all_rates',
};

const ROOM_TYPES: Record<string, string> = {
  'studio': 'Studio',
  'studios': 'Studio',
  'one bedroom': 'One Bedroom',
  'one bedrooms': 'One Bedroom',
  '1 bedroom': 'One Bedroom',
  '1br': 'One Bedroom',
  'two bedroom': 'Two Bedroom',
  'two bedrooms': 'Two Bedroom',
  '2 bedroom': 'Two Bedroom',
  '2br': 'Two Bedroom',
};

const SERVICE_LINES: Record<string, string> = {
  'assisted living': 'AL',
  'al': 'AL',
  'memory care': 'MC',
  'mc': 'MC',
  'al/mc': 'AL/MC',
  'assisted living memory care': 'AL/MC',
  'health center': 'HC',
  'hc': 'HC',
  'skilled nursing': 'HC',
  'independent living': 'IL',
  'il': 'IL',
  'senior living': 'SL',
  'sl': 'SL',
};

// ── Comparison operator table ─────────────────────────────────────────────
// Ordered most-specific first.
const CMP_OPS: Array<{ re: RegExp; op: '>' | '<' | '>=' | '<=' | '=' }> = [
  { re: /is\s+greater\s+than\s+or\s+equal\s+to\s+(\d+(?:\.\d+)?)%?/i, op: '>=' },
  { re: /is\s+less\s+than\s+or\s+equal\s+to\s+(\d+(?:\.\d+)?)%?/i, op: '<=' },
  { re: /is\s+greater\s+than\s+(\d+(?:\.\d+)?)%?/i, op: '>' },
  { re: /is\s+less\s+than\s+(\d+(?:\.\d+)?)%?/i, op: '<' },
  { re: />=\s*(\d+(?:\.\d+)?)%?/i, op: '>=' },
  { re: /<=\s*(\d+(?:\.\d+)?)%?/i, op: '<=' },
  { re: />\s*(\d+(?:\.\d+)?)%/, op: '>' },
  { re: /<\s*(\d+(?:\.\d+)?)%/, op: '<' },
  { re: /(?:drops?|falls?)\s+below\s+(\d+(?:\.\d+)?)%?/i, op: '<' },
  { re: /(?:above|over|exceeds?)\s+(\d+(?:\.\d+)?)%?/i, op: '>=' },
  { re: /(?:below|under)\s+(\d+(?:\.\d+)?)%?/i, op: '<' },
];

function extractCmp(text: string): { op: '>' | '<' | '>=' | '<=' | '='; value: number } | null {
  for (const { re, op } of CMP_OPS) {
    const m = text.match(re);
    if (m) {
      const raw = parseFloat(m[1]);
      return { op, value: raw > 1 ? raw / 100 : raw }; // store as decimal (e.g. 0.90 for 90%)
    }
  }
  return null;
}

function extractCmpRaw(text: string): { op: '>' | '<' | '>=' | '<=' | '='; value: number } | null {
  for (const { re, op } of CMP_OPS) {
    const m = text.match(re);
    if (m) return { op, value: parseFloat(m[1]) }; // keep raw %, no /100
  }
  return null;
}

// ── Metric name → internal field name mapping ─────────────────────────────
// Keys must be lowercase to match against lowercased phrase input.
const METRIC_TO_FIELD: Array<{ key: string; field: string; rawPct?: boolean }> = [
  { key: 'service line occupancy',                              field: 'service_line_occupancy' },
  { key: 'room type occupancy',                                 field: 'room_type_occupancy' },
  { key: 'campus occupancy',                                    field: 'occupancy' },
  { key: 'street rate to top comp var %',                       field: 'street_to_comp_var', rawPct: true },
  { key: 'in house to street rate var % - single occupant',     field: 'ih_street_variance' },
  { key: 'competitor rate',                                     field: 'competitor_variance' },
  { key: 'vacant units/beds',                                   field: 'vacant_units' },
  { key: 'total units/beds',                                    field: 'total_units' },
  { key: 'days vacant',                                         field: 'days_vacant' },
  { key: 'inquiry and tour volume',                             field: 'inquiry_volume' },
  { key: 'quality mix',                                         field: 'quality_mix' },
];

/**
 * Parse a single condition phrase (e.g. "service line occupancy (current month) is greater than or equal to 93")
 * into a structured { field, operator, value } object.
 */
function parseSingleConditionPhrase(
  phrase: string
): { field: string; operator: '>' | '<' | '>=' | '<=' | '='; value: number } | null {
  const lower = phrase.toLowerCase().trim();

  for (const { key, field, rawPct } of METRIC_TO_FIELD) {
    if (!lower.startsWith(key) && !lower.includes(key)) continue;

    if (rawPct) {
      const cmp = extractCmpRaw(lower);
      if (cmp) return { field, operator: cmp.op, value: cmp.value };
    } else {
      const cmp = extractCmp(lower);
      if (cmp) return { field, operator: cmp.op, value: cmp.value };
    }
    break;
  }
  return null;
}

/**
 * Split an "if" clause on AND / OR conjunctions (uppercase or lowercase).
 *
 * To avoid splitting inside comparison phrases like "is greater than or equal to"
 * or "is less than or equal to", we temporarily replace those protected phrases
 * before splitting, then restore them in each part.
 */
function splitConditionPhrases(ifClause: string): { parts: string[]; operator: 'AND' | 'OR' } {
  // Uppercase conjunctions (from structured builder) — check first, most reliable
  const hasUpperAnd = / AND /.test(ifClause);
  const hasUpperOr  = / OR /.test(ifClause);

  if (hasUpperAnd || hasUpperOr) {
    const sep = hasUpperAnd ? / AND / : / OR /;
    const operator: 'AND' | 'OR' = hasUpperAnd ? 'AND' : 'OR';
    return { parts: ifClause.split(sep).map(s => s.trim()), operator };
  }

  // Lowercase conjunctions (free-typed text) — protect comparison phrases first
  // so "or" in "greater than or equal to" is not treated as a condition separator.
  const PROTECT: Array<[RegExp, string]> = [
    [/greater than or equal to/gi, '__GTE__'],
    [/less than or equal to/gi,    '__LTE__'],
  ];
  const restore = (s: string) =>
    s.replace(/__GTE__/g, 'greater than or equal to')
     .replace(/__LTE__/g, 'less than or equal to');

  let protected2 = ifClause;
  for (const [re, placeholder] of PROTECT) {
    protected2 = protected2.replace(re, placeholder);
  }

  const hasLowerAnd = / and /i.test(protected2);
  const hasLowerOr  = / or /i.test(protected2);

  if (!hasLowerAnd && !hasLowerOr) return { parts: [ifClause], operator: 'AND' };

  const sep = hasLowerAnd ? / and /i : / or /i;
  const operator: 'AND' | 'OR' = hasLowerAnd ? 'AND' : 'OR';
  const parts = protected2.split(sep).map(p => restore(p.trim()));
  return { parts, operator };
}

export function parseNaturalLanguageRule(input: string): ParsedRule | null {
  try {
    const normalizedInput = input.toLowerCase().trim();
    
    // Extract trigger
    const trigger = parseTrigger(input); // pass original (mixed-case) for AND/OR split
    
    // Extract action
    const action = parseAction(normalizedInput);
    
    if (!trigger || !action) {
      return null;
    }
    
    // Generate a readable name
    const name = generateRuleName(trigger, action);
    
    return {
      name,
      description: input,
      trigger,
      action,
    };
  } catch (error) {
    console.error('Failed to parse rule:', error);
    return null;
  }
}

function parseTrigger(input: string): ParsedTrigger | null {
  const lowerInput = input.toLowerCase().trim();

  // Event-based triggers
  if (lowerInput.includes('after each sale') || lowerInput.includes('when a unit sells') || lowerInput.includes('after sale')) {
    return { type: 'event', event: 'sale' };
  }
  if (lowerInput.includes('after move in') || lowerInput.includes('when occupied')) {
    return { type: 'event', event: 'move_in' };
  }
  if (lowerInput.includes('after move out') || lowerInput.includes('when vacant')) {
    return { type: 'event', event: 'move_out' };
  }
  
  // Time-based triggers
  const timeMatch = lowerInput.match(/every\s+(\d+)?\s*(day|week|month|quarter|year)|each\s+(\w+)|(daily|weekly|monthly|quarterly|yearly|annually)/);
  if (timeMatch) {
    const value = timeMatch[1] ? parseInt(timeMatch[1]) : 1;
    let unit = timeMatch[2] || timeMatch[3] || timeMatch[4];
    
    // Normalize time unit
    unit = TIME_UNITS[unit] || unit;
    
    if (['day', 'week', 'month', 'quarter', 'year'].includes(unit)) {
      return { 
        type: 'time', 
        timeInterval: { 
          unit: unit as 'day' | 'week' | 'month' | 'quarter' | 'year', 
          value 
        }
      };
    }
  }

  // ── Multi-condition detection ─────────────────────────────────────────
  // The structured rule designer emits descriptions like:
  //   "If Service Line Occupancy (Current Month) is greater than or equal to 93 AND
  //    Room Type Occupancy (Current Spot) is less than 95, increase rate by 5%..."
  // Extract the "If ..." clause up to the action verb (comma).
  const ifMatch = input.match(/^if\s+(.+?)(?:,\s*(?:increase|decrease|reduce|raise|lower|set|apply|remove|cap|boost|add|adjust))/i);
  if (ifMatch) {
    const ifClause = ifMatch[1];
    const { parts, operator } = splitConditionPhrases(ifClause);

    if (parts.length >= 2) {
      const parsedConditions = parts
        .map(p => parseSingleConditionPhrase(p))
        .filter((c): c is NonNullable<typeof c> => c !== null);

      if (parsedConditions.length >= 2) {
        return {
          type: 'condition',
          conditions: parsedConditions,
          conditionOperator: operator,
        };
      }

      // Only one parsed — fall through to single-condition path below
      if (parsedConditions.length === 1) {
        return { type: 'condition', condition: parsedConditions[0] };
      }
    }

    // Single-condition if clause
    if (parts.length === 1) {
      const single = parseSingleConditionPhrase(parts[0]);
      if (single) return { type: 'condition', condition: single };
    }
  }

  // ── Generalized single-condition triggers (no "If" prefix required) ───

  // Service line occupancy (check before generic occupancy — more specific)
  if (/service.?line\s+occupancy/i.test(lowerInput)) {
    const cmp = extractCmp(lowerInput);
    if (cmp) return { type: 'condition', condition: { field: 'service_line_occupancy', operator: cmp.op, value: cmp.value } };
  }

  // Room type occupancy
  if (/room.?type\s+occupancy/i.test(lowerInput)) {
    const cmp = extractCmp(lowerInput);
    if (cmp) return { type: 'condition', condition: { field: 'room_type_occupancy', operator: cmp.op, value: cmp.value } };
  }

  // General / campus occupancy
  if (/\boccupancy\b/i.test(lowerInput)) {
    const cmp = extractCmp(lowerInput);
    if (cmp) return { type: 'condition', condition: { field: 'occupancy', operator: cmp.op, value: cmp.value } };
  }

  // Street rate to top competitor adjusted rate variance %
  if (/street\s+rate\s+to\s+(top\s+)?comp|street.to.comp.var|street.*comp.*var\s*%/i.test(lowerInput)) {
    const cmp = extractCmpRaw(lowerInput);
    if (cmp) return { type: 'condition', condition: { field: 'street_to_comp_var', operator: cmp.op, value: cmp.value } };
  }

  // In-house to street rate variance
  if (/in.?house\s+to\s+street|ih.street\s+var|in_house_to_street|ih_street_var/i.test(lowerInput)) {
    const cmp = extractCmp(lowerInput);
    if (cmp) return { type: 'condition', condition: { field: 'ih_street_variance', operator: cmp.op, value: cmp.value } };
  }

  // Vacancy duration (days vacant)
  if (lowerInput.includes('vacant for') || lowerInput.includes('empty for') || lowerInput.includes('vacant over') || lowerInput.includes('days vacant')) {
    const vacancyMatch = lowerInput.match(/(?:vacant|empty)\s*(?:for|over)?\s*(\d+)\s*days?/);
    if (vacancyMatch) {
      return { type: 'condition', condition: { field: 'days_vacant', operator: '>', value: parseInt(vacancyMatch[1]) } };
    }
  }

  // Default to immediate if no specific trigger found
  return { type: 'immediate' };
}

function parseAction(input: string): ParsedAction | null {
  // Parse adjustment value.
  // Prefer a match that immediately follows an action verb and "by", so that condition
  // percentages (e.g. "occupancy >= 90%") are not mistakenly used as the adjustment value.
  const actionPctMatch =
    input.match(/(?:increase|raise|reduce|decrease|lower|boost|add|adjust)\s+(?:\w+\s+){0,3}by\s+(\d+(?:\.\d+)?)%/i) ||
    input.match(/(?:increase|raise|reduce|decrease|lower|boost)\s+(?:rate\s+)?(?:by\s+)?(\d+(?:\.\d+)?)%/i);
  const percentMatch = actionPctMatch || input.match(/(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?)/);
  // Only match dollar amounts if explicitly mentioned with $ or "dollar" word, and NOT followed by "percent"
  const dollarMatch = input.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*dollars?(?!\s*percent)/);
  
  if (!percentMatch && !dollarMatch) {
    return null;
  }
  
  const isIncrease = input.includes('increase') || input.includes('raise') || input.includes('up') || 
                     input.includes('add') || input.includes('boost');
  const isDecrease = input.includes('decrease') || input.includes('reduce') || input.includes('lower') || 
                     input.includes('down') || input.includes('discount');
  
  let adjustmentType: 'percentage' | 'absolute' = 'percentage';
  let adjustmentValue = 0;
  
  if (percentMatch) {
    adjustmentType = 'percentage';
    adjustmentValue = parseFloat(percentMatch[1]);
    if (isDecrease) adjustmentValue = -adjustmentValue;
  } else if (dollarMatch) {
    adjustmentType = 'absolute';
    // Handle both capture groups (with $ and without $)
    adjustmentValue = parseFloat(dollarMatch[1] || dollarMatch[2]);
    if (isDecrease) adjustmentValue = -adjustmentValue;
  }
  
  // Parse target rate type
  let target: 'street_rate' | 'care_rate' | 'all_rates' = 'street_rate';
  for (const [pattern, rateType] of Object.entries(RATE_TYPES)) {
    if (input.includes(pattern)) {
      target = rateType as 'street_rate' | 'care_rate' | 'all_rates';
      break;
    }
  }
  
  // Parse filters
  const filters: ParsedAction['filters'] = {};
  
  // Room type filter
  for (const [pattern, roomType] of Object.entries(ROOM_TYPES)) {
    if (input.includes(pattern)) {
      filters.roomType = [roomType];
      break;
    }
  }
  
  // Service line filter — sort longest key first so "al/mc" matches before "al"
  for (const [pattern, serviceLine] of Object.entries(SERVICE_LINES).sort((a, b) => b[0].length - a[0].length)) {
    if (input.includes(pattern)) {
      filters.serviceLine = [serviceLine];
      break;
    }
  }
  
  // Location filter
  const locationMatch = input.match(/(?:in|at)\s+([\w\s]+?)(?:\s+location|\s+campus|\s+facility)?(?:\s+(?:by|if|when|after)|$)/);
  if (locationMatch) {
    filters.location = [locationMatch[1].trim()];
  }
  
  // Occupancy status filter
  if (input.includes('vacant unit') || input.includes('empty unit') || input.includes('unoccupied')) {
    filters.occupancyStatus = 'vacant';
  } else if (input.includes('occupied unit')) {
    filters.occupancyStatus = 'occupied';
  }
  
  // Vacancy duration filter
  const vacancyFilterMatch = input.match(/units?\s+(?:vacant|empty)\s*(?:for|over)?\s*(\d+)\s*days?/);
  if (vacancyFilterMatch) {
    filters.vacancyDuration = {
      operator: '>',
      days: parseInt(vacancyFilterMatch[1])
    };
  }
  
  return {
    type: 'adjust_rate',
    target,
    adjustmentType,
    adjustmentValue,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  };
}

function generateRuleName(trigger: ParsedTrigger, action: ParsedAction): string {
  let name = '';
  
  // Add adjustment description
  const adjustmentStr = action.adjustmentType === 'percentage' 
    ? `${Math.abs(action.adjustmentValue)}%`
    : `$${Math.abs(action.adjustmentValue)}`;
  const adjustmentAction = action.adjustmentValue > 0 ? 'Increase' : 'Decrease';
  
  name = `${adjustmentAction} ${adjustmentStr}`;
  
  // Add target description
  if (action.filters?.roomType) {
    name += ` - ${action.filters.roomType.join(', ')}`;
  } else if (action.filters?.serviceLine) {
    name += ` - ${action.filters.serviceLine.join(', ')}`;
  } else if (action.target === 'care_rate') {
    name += ' - Care Rates';
  } else if (action.target === 'all_rates') {
    name += ' - All Rates';
  }
  
  // Add trigger description
  if (trigger.type === 'event') {
    name += ` on ${trigger.event?.replace('_', ' ')}`;
  } else if (trigger.type === 'time') {
    name += ` ${trigger.timeInterval?.unit}ly`;
  } else if (trigger.type === 'condition') {
    // Multi-condition summary
    if (trigger.conditions && trigger.conditions.length > 0) {
      const firstCond = trigger.conditions[0];
      if (firstCond.field === 'service_line_occupancy') {
        name += ` when SL occupancy ${firstCond.operator} ${typeof firstCond.value === 'number' && firstCond.value < 1 ? Math.round((firstCond.value as number) * 100) + '%' : firstCond.value + '%'}`;
      } else if (firstCond.field === 'room_type_occupancy') {
        name += ` when RT occupancy ${firstCond.operator} ${typeof firstCond.value === 'number' && firstCond.value < 1 ? Math.round((firstCond.value as number) * 100) + '%' : firstCond.value + '%'}`;
      } else if (firstCond.field === 'street_to_comp_var') {
        name += ` when street-to-comp ${firstCond.operator} ${firstCond.value}%`;
      }
      if (trigger.conditions.length > 1) {
        name += ` +${trigger.conditions.length - 1} more`;
      }
    } else if (trigger.condition) {
      if (trigger.condition.field === 'occupancy') {
        name += ` when occupancy ${trigger.condition.operator} ${typeof trigger.condition.value === 'number' && trigger.condition.value < 1 ? Math.round((trigger.condition.value as number) * 100) + '%' : trigger.condition.value + '%'}`;
      } else if (trigger.condition.field === 'days_vacant') {
        name += ` for ${trigger.condition.value}+ day vacancies`;
      }
    }
  }
  
  return name;
}

// Validation function to check if a parsed rule is valid
export function validateParsedRule(rule: ParsedRule): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate trigger
  if (!rule.trigger) {
    errors.push('No trigger condition found');
  } else if (rule.trigger.type === 'time' && !rule.trigger.timeInterval) {
    errors.push('Time trigger missing interval');
  } else if (rule.trigger.type === 'condition' && !rule.trigger.condition && !rule.trigger.conditions?.length) {
    errors.push('Condition trigger missing condition details');
  }
  
  // Validate action
  if (!rule.action) {
    errors.push('No action specified');
  } else {
    if (rule.action.adjustmentValue === 0) {
      errors.push('Adjustment value cannot be zero');
    }
    if (Math.abs(rule.action.adjustmentValue) > 100 && rule.action.adjustmentType === 'percentage') {
      errors.push('Percentage adjustment cannot exceed 100%');
    }
    if (Math.abs(rule.action.adjustmentValue) > 10000 && rule.action.adjustmentType === 'absolute') {
      errors.push('Dollar adjustment seems too large (>$10,000)');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
