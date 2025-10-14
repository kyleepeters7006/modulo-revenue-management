import type { 
  PricingWeights, 
  AdjustmentRanges, 
  Guardrails,
  RentRollData 
} from "@shared/schema";

interface StrategyDocumentation {
  campus: string;
  serviceLine?: string;
  sentenceVersion: string;
  equationVersion: string;
  currentMetrics: {
    occupancy: number;
    avgRate: number;
    unitCount: number;
  };
}

interface PricingStrategy {
  weights: PricingWeights[];
  ranges: AdjustmentRanges[];
  guardrails: Guardrails[];
  activeRules: any[];
  rentRollData: RentRollData[];
}

export function generatePricingStrategyDocumentation(
  strategy: PricingStrategy,
  campus?: string,
  serviceLine?: string
): StrategyDocumentation[] {
  const results: StrategyDocumentation[] = [];
  
  // Filter data based on campus and service line
  let filteredData = strategy.rentRollData;
  if (campus) {
    filteredData = filteredData.filter(d => d.location === campus);
  }
  if (serviceLine) {
    filteredData = filteredData.filter(d => d.serviceLine === serviceLine);
  }
  
  // Group by campus and optionally by service line
  const groupedData = groupDataByCampusAndServiceLine(filteredData);
  
  Array.from(groupedData.entries()).forEach(([key, units]) => {
    const [campusName, serviceLineType] = key.split('|');
    
    // Calculate current metrics
    const metrics = calculateMetrics(units);
    
    // Generate sentence version
    const sentenceVersion = generateSentenceVersion(
      strategy,
      campusName,
      serviceLineType,
      metrics
    );
    
    // Generate equation version
    const equationVersion = generateEquationVersion(
      strategy,
      campusName,
      serviceLineType
    );
    
    results.push({
      campus: campusName,
      serviceLine: serviceLineType || undefined,
      sentenceVersion,
      equationVersion,
      currentMetrics: metrics
    });
  });
  
  return results;
}

function groupDataByCampusAndServiceLine(
  data: RentRollData[]
): Map<string, RentRollData[]> {
  const grouped = new Map<string, RentRollData[]>();
  
  data.forEach(unit => {
    // Create key based on whether we want service line granularity
    const key = `${unit.location}|${unit.serviceLine}`;
    
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(unit);
  });
  
  return grouped;
}

function calculateMetrics(units: RentRollData[]) {
  const occupied = units.filter(u => u.occupancyStatus === 'Occupied').length;
  const total = units.length;
  const avgRate = units.reduce((sum, u) => sum + (u.streetRate || 0), 0) / total;
  
  return {
    occupancy: total > 0 ? (occupied / total) : 0,
    avgRate: Math.round(avgRate),
    unitCount: total
  };
}

function generateSentenceVersion(
  strategy: PricingStrategy,
  campus: string,
  serviceLine: string,
  metrics: any
): string {
  const weight = strategy.weights[0] || {};
  const range = strategy.ranges[0] || {};
  const guardrail = strategy.guardrails.find(g => 
    g.location === campus && (!serviceLine || g.serviceLine === serviceLine)
  );
  
  const activeRules = strategy.activeRules.filter(r => 
    r.isActive && (!campus || r.affectedCampuses?.includes(campus))
  );
  
  let sentence = `Pricing Strategy for ${campus}`;
  if (serviceLine) {
    const serviceLineNames: Record<string, string> = {
      'AL': 'Assisted Living',
      'MC': 'Memory Care',
      'HC': 'Health Center',
      'IL': 'Independent Living',
      'SNF': 'Skilled Nursing'
    };
    sentence += ` - ${serviceLineNames[serviceLine] || serviceLine}`;
  }
  sentence += `:\n\n`;
  
  // Base rate
  sentence += `Base rate starts at market street rate averaging $${metrics.avgRate.toLocaleString()}/month. `;
  
  // Occupancy adjustment
  if (weight.occupancy && weight.occupancy > 0) {
    const occupancyPercent = Math.round(metrics.occupancy * 100);
    sentence += `With current occupancy at ${occupancyPercent}%, `;
    
    if (occupancyPercent > 92) {
      const maxAdjust = Math.round((range.occupancyMax || 0) * 100);
      sentence += `prices increase by up to ${maxAdjust}% due to high demand. `;
    } else if (occupancyPercent < 80) {
      const minAdjust = Math.abs(Math.round((range.occupancyMin || 0) * 100));
      sentence += `prices decrease by up to ${minAdjust}% to boost occupancy. `;
    } else {
      sentence += `pricing remains stable with moderate occupancy pressure. `;
    }
  }
  
  // Vacancy decay
  if (weight.vacancy && weight.vacancy > 0) {
    const maxDecay = Math.abs(Math.round((range.vacancyMin || 0) * 100));
    sentence += `Units vacant over 45 days receive progressive discounts up to ${maxDecay}%. `;
  }
  
  // Room attributes
  if (weight.attributes && weight.attributes > 0) {
    const premiumMax = Math.round((range.attributesMax || 0) * 100);
    const discountMax = Math.abs(Math.round((range.attributesMin || 0) * 100));
    sentence += `Premium rooms (A-rated) receive up to ${premiumMax}% uplift, while C-rated rooms may be discounted up to ${discountMax}%. `;
  }
  
  // Seasonality
  if (weight.seasonality && weight.seasonality > 0) {
    const seasonalMax = Math.round((range.seasonalityMax || 0) * 100);
    sentence += `Seasonal adjustments can add up to ${seasonalMax}% during peak demand periods. `;
  }
  
  // Guardrails
  if (guardrail) {
    sentence += `\n\nPrices are kept within guardrails: minimum $${guardrail.minRate?.toLocaleString() || 'not set'} and maximum $${guardrail.maxRate?.toLocaleString() || 'not set'}. `;
    
    if (guardrail.maxIncreasePercent) {
      sentence += `Maximum single increase is capped at ${guardrail.maxIncreasePercent}%. `;
    }
    if (guardrail.maxDecreasePercent) {
      sentence += `Maximum single decrease is limited to ${guardrail.maxDecreasePercent}%. `;
    }
  }
  
  // Active rules
  if (activeRules.length > 0) {
    sentence += `\n\nActive adjustment rules: `;
    activeRules.forEach((rule, index) => {
      if (index > 0) sentence += '; ';
      sentence += `"${rule.originalText}"`;
    });
    sentence += '.';
  }
  
  return sentence;
}

function generateEquationVersion(
  strategy: PricingStrategy,
  campus: string,
  serviceLine: string
): string {
  const weight = strategy.weights[0] || {};
  const range = strategy.ranges[0] || {};
  const guardrail = strategy.guardrails.find(g => 
    g.location === campus && (!serviceLine || g.serviceLine === serviceLine)
  );
  
  let equation = `Final_Price = Base_Rate`;
  
  const adjustments: string[] = [];
  
  // Add each adjustment factor
  if (weight.occupancy && weight.occupancy > 0) {
    const min = (range.occupancyMin || 0);
    const max = (range.occupancyMax || 0);
    const weightPct = (weight.occupancy || 0) / 100;
    adjustments.push(
      `  (1 + Occupancy_Adj[${formatNumber(min)}, ${formatNumber(max)}] × ${formatNumber(weightPct)})`
    );
  }
  
  if (weight.vacancy && weight.vacancy > 0) {
    const min = (range.vacancyMin || 0);
    const max = (range.vacancyMax || 0);
    const weightPct = (weight.vacancy || 0) / 100;
    adjustments.push(
      `  (1 + Vacancy_Decay[${formatNumber(min)}, ${formatNumber(max)}] × ${formatNumber(weightPct)})`
    );
  }
  
  if (weight.attributes && weight.attributes > 0) {
    const min = (range.attributesMin || 0);
    const max = (range.attributesMax || 0);
    const weightPct = (weight.attributes || 0) / 100;
    adjustments.push(
      `  (1 + Room_Attributes[${formatNumber(min)}, ${formatNumber(max)}] × ${formatNumber(weightPct)})`
    );
  }
  
  if (weight.seasonality && weight.seasonality > 0) {
    const min = (range.seasonalityMin || 0);
    const max = (range.seasonalityMax || 0);
    const weightPct = (weight.seasonality || 0) / 100;
    adjustments.push(
      `  (1 + Seasonality[${formatNumber(min)}, ${formatNumber(max)}] × ${formatNumber(weightPct)})`
    );
  }
  
  if (weight.competitor && weight.competitor > 0) {
    const min = (range.competitorMin || 0);
    const max = (range.competitorMax || 0);
    const weightPct = (weight.competitor || 0) / 100;
    adjustments.push(
      `  (1 + Competitor_Adj[${formatNumber(min)}, ${formatNumber(max)}] × ${formatNumber(weightPct)})`
    );
  }
  
  if (weight.market && weight.market > 0) {
    const min = (range.marketMin || 0);
    const max = (range.marketMax || 0);
    const weightPct = (weight.market || 0) / 100;
    adjustments.push(
      `  (1 + Market_Factor[${formatNumber(min)}, ${formatNumber(max)}] × ${formatNumber(weightPct)})`
    );
  }
  
  // Add adjustments to equation
  if (adjustments.length > 0) {
    equation += ' ×\n' + adjustments.join(' ×\n');
  }
  
  // Add NL rules if any
  equation += '\n  × (1 + Natural_Language_Rules)';
  
  // Add constraints
  equation += '\n\nSubject to constraints:';
  if (guardrail) {
    equation += `\n  ${formatCurrency(guardrail.minRate)} ≤ Final_Price ≤ ${formatCurrency(guardrail.maxRate)}`;
    
    if (guardrail.maxIncreasePercent) {
      equation += `\n  Price_Increase ≤ ${guardrail.maxIncreasePercent}% per adjustment`;
    }
    if (guardrail.maxDecreasePercent) {
      equation += `\n  Price_Decrease ≤ ${guardrail.maxDecreasePercent}% per adjustment`;
    }
  } else {
    equation += '\n  No specific guardrails set';
  }
  
  // Add legend
  equation += '\n\nWhere:';
  equation += '\n  • Adjustment ranges shown as [min, max]';
  equation += '\n  • Weight percentages applied to each factor';
  equation += '\n  • All factors multiply together for cumulative effect';
  
  return equation;
}

function formatNumber(num: number): string {
  const formatted = (num * 100).toFixed(1);
  return formatted.startsWith('-') ? formatted : '+' + formatted;
}

function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '$0';
  return `$${amount.toLocaleString()}`;
}

// Export functions for different file formats
export function exportAsText(documentation: StrategyDocumentation[]): string {
  let output = 'PRICING STRATEGY DOCUMENTATION\n';
  output += '=' .repeat(50) + '\n\n';
  
  documentation.forEach(doc => {
    output += `Campus: ${doc.campus}`;
    if (doc.serviceLine) {
      output += ` - ${doc.serviceLine}`;
    }
    output += '\n';
    output += '-'.repeat(40) + '\n\n';
    
    output += 'CURRENT METRICS:\n';
    output += `• Occupancy: ${Math.round(doc.currentMetrics.occupancy * 100)}%\n`;
    output += `• Average Rate: $${doc.currentMetrics.avgRate.toLocaleString()}/month\n`;
    output += `• Total Units: ${doc.currentMetrics.unitCount}\n\n`;
    
    output += 'PLAIN ENGLISH VERSION:\n';
    output += doc.sentenceVersion + '\n\n';
    
    output += 'MATHEMATICAL FORMULA:\n';
    output += doc.equationVersion + '\n\n';
    
    output += '='.repeat(50) + '\n\n';
  });
  
  return output;
}

export function exportAsJSON(documentation: StrategyDocumentation[]): string {
  return JSON.stringify(documentation, null, 2);
}