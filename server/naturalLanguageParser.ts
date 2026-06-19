// Natural Language Parser for Adjustment Rules
// Uses a grammar-based approach to parse common pricing adjustment patterns

export interface ParsedTrigger {
  type: 'event' | 'time' | 'condition' | 'immediate';
  event?: 'sale' | 'move_in' | 'move_out';
  timeInterval?: { unit: 'day' | 'week' | 'month' | 'quarter' | 'year'; value: number };
  condition?: {
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
    value: number | string;
  };
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

export function parseNaturalLanguageRule(input: string): ParsedRule | null {
  try {
    const normalizedInput = input.toLowerCase().trim();
    
    // Extract trigger
    const trigger = parseTrigger(normalizedInput);
    
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
  // Event-based triggers
  if (input.includes('after each sale') || input.includes('when a unit sells') || input.includes('after sale')) {
    return { type: 'event', event: 'sale' };
  }
  if (input.includes('after move in') || input.includes('when occupied')) {
    return { type: 'event', event: 'move_in' };
  }
  if (input.includes('after move out') || input.includes('when vacant')) {
    return { type: 'event', event: 'move_out' };
  }
  
  // Time-based triggers
  const timeMatch = input.match(/every\s+(\d+)?\s*(day|week|month|quarter|year)|each\s+(\w+)|(daily|weekly|monthly|quarterly|yearly|annually)/);
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
  
  // ── Generalized condition-based triggers ─────────────────────────────
  // Comparison operator table — ordered most-specific first.
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

  // Service line occupancy (check before generic occupancy — more specific)
  if (/service.?line\s+occupancy/i.test(input)) {
    const cmp = extractCmp(input);
    if (cmp) return { type: 'condition', condition: { field: 'service_line_occupancy', operator: cmp.op, value: cmp.value } };
  }

  // Room type occupancy
  if (/room.?type\s+occupancy/i.test(input)) {
    const cmp = extractCmp(input);
    if (cmp) return { type: 'condition', condition: { field: 'room_type_occupancy', operator: cmp.op, value: cmp.value } };
  }

  // General / campus occupancy
  if (/\boccupancy\b/i.test(input)) {
    const cmp = extractCmp(input);
    if (cmp) return { type: 'condition', condition: { field: 'occupancy', operator: cmp.op, value: cmp.value } };
  }

  // Street rate to top competitor adjusted rate variance %
  // Stored as raw % (e.g. 10 for 10%), so we do NOT divide by 100.
  if (/street\s+rate\s+to\s+(top\s+)?comp|street.to.comp.var|street.*comp.*var\s*%/i.test(input)) {
    const extractCmpRaw = (text: string): { op: '>' | '<' | '>=' | '<=' | '='; value: number } | null => {
      for (const { re, op } of CMP_OPS) {
        const m = text.match(re);
        if (m) return { op, value: parseFloat(m[1]) }; // keep raw %, no /100
      }
      return null;
    };
    const cmp = extractCmpRaw(input);
    if (cmp) return { type: 'condition', condition: { field: 'street_to_comp_var', operator: cmp.op, value: cmp.value } };
  }

  // In-house to street rate variance
  if (/in.?house\s+to\s+street|ih.street\s+var|in_house_to_street|ih_street_var/i.test(input)) {
    const cmp = extractCmp(input);
    if (cmp) return { type: 'condition', condition: { field: 'ih_street_variance', operator: cmp.op, value: cmp.value } };
  }

  // Vacancy duration (days vacant)
  if (input.includes('vacant for') || input.includes('empty for') || input.includes('vacant over') || input.includes('days vacant')) {
    const vacancyMatch = input.match(/(?:vacant|empty)\s*(?:for|over)?\s*(\d+)\s*days?/);
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
  
  // Service line filter
  for (const [pattern, serviceLine] of Object.entries(SERVICE_LINES)) {
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
  } else if (trigger.type === 'condition' && trigger.condition) {
    if (trigger.condition.field === 'occupancy') {
      name += ` when occupancy ${trigger.condition.operator} ${trigger.condition.value * 100}%`;
    } else if (trigger.condition.field === 'days_vacant') {
      name += ` for ${trigger.condition.value}+ day vacancies`;
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
  } else if (rule.trigger.type === 'condition' && !rule.trigger.condition) {
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