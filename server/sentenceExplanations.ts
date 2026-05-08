// Helper functions to generate sentence-based explanations for pricing factors

export function getSentenceExplanation(factor: string, inputs: any, adjustment: any): string {
  switch(factor) {
    case 'occupancy':
      const occPct = (inputs.occupancy * 100).toFixed(0);
      if (inputs.occupancy < 0.85) {
        return `At ${occPct}% occupancy for this unit type, we're below our 85% floor. This low occupancy triggers stronger rate reductions to help fill vacant units quickly and improve cash flow.`;
      } else if (inputs.occupancy < 0.90) {
        return `At ${occPct}% occupancy for this unit type, we're between our 85% floor and 90% target. We're applying moderate rate adjustments to incentivize occupancy while maintaining revenue stability.`;
      } else {
        return `With ${occPct}% occupancy for this unit type exceeding our 90% target, we have pricing power. Higher occupancy allows us to optimize rates for maximum revenue rather than focusing on filling units.`;
      }

    case 'daysvacant':
      if (inputs.daysVacant <= 7) {
        return `Units of this type have been vacant for an average of ${inputs.daysVacant} days, within our 7-day grace period. No vacancy discount is applied yet, maintaining full pricing to maximize potential revenue.`;
      } else if (inputs.daysVacant <= 30) {
        return `Units of this type average ${inputs.daysVacant} days vacant (${inputs.daysVacant - 7} days past grace). We're applying a modest discount to generate interest while avoiding aggressive price cuts that could hurt revenue.`;
      } else {
        return `Units of this type have been vacant for an average of ${inputs.daysVacant} days. The extended vacancy requires more aggressive pricing to overcome market resistance and generate tours. Each additional week increases the discount exponentially.`;
      }

    case 'attributes':
      const score = (inputs.attrScore * 100).toFixed(0);
      if (inputs.attrScore > 0.65) {
        return `This unit scores ${score}% on desirability, indicating premium features like renovations, views, or prime location. Premium units command higher rates as residents value these amenities.`;
      } else if (inputs.attrScore > 0.35) {
        return `With a ${score}% desirability score, this is a standard unit with typical features. Pricing remains neutral as it represents our average inventory without special premiums or discounts.`;
      } else {
        return `This unit's ${score}% desirability score indicates challenges like dated finishes or less desirable location. A slight discount helps compensate for these factors to maintain competitiveness.`;
      }

    case 'seasonality':
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const month = months[inputs.monthIndex - 1];
      if (inputs.monthIndex >= 3 && inputs.monthIndex <= 6) {
        return `${month} is part of our peak move-in season when families transition before summer. Higher demand during this period supports modest rate increases.`;
      } else if (inputs.monthIndex >= 10 || inputs.monthIndex <= 2) {
        return `${month} typically sees lower move-in activity due to holidays and winter weather. We apply slight discounts to maintain occupancy momentum during slower periods.`;
      } else {
        return `${month} represents a transitional period with moderate demand. Pricing remains relatively neutral without strong seasonal pressures in either direction.`;
      }

    case 'competitors':
      if (!inputs.competitorPrices || inputs.competitorPrices.length === 0) {
        // Neutral-state: no usable survey rate — no competitor adjustment applied
        const neutralRoomType = (inputs.competitorInfo?.originalRoomType) || 'this room type';
        const topCompetitorName = inputs.competitorInfo?.name;
        if (topCompetitorName) {
          return `${topCompetitorName} has no survey rate available for the ${neutralRoomType} room type at this location. The competitor factor was not applied; pricing assumes a comparable market position based on internal metrics only.`;
        }
        return `No competitive survey data was found for ${neutralRoomType} at this location. The competitor factor was not applied; pricing assumes a comparable market position based on internal metrics only.`;
      }
      const compRate = inputs.competitorPrices[0];
      const formattedRate = `$${Math.round(compRate).toLocaleString()}`;
      const diff = ((adjustment.adjustment / 100) * 100).toFixed(1);

      if (inputs.competitorInfo) {
        const ci = inputs.competitorInfo;
        const weightStr = ci.weight > 0 ? ` (weight ${ci.weight.toFixed(2)})` : '';
        let rateContext = `${ci.name}${weightStr} at an adjusted rate of ${formattedRate}`;

        // Full adjustment breakdown: their values vs ours
        let adjParts: string[] = [];
        if (ci.theirCareL2 > 0 || ci.ourCareL2 > 0) {
          const cl2Net = ci.theirCareL2 - ci.ourCareL2;
          adjParts.push(`care L2: their $${Math.round(ci.theirCareL2)} − ours $${Math.round(ci.ourCareL2)} = ${cl2Net >= 0 ? '+' : ''}$${Math.round(cl2Net)}`);
        } else if (ci.careLevel2Adj !== 0) {
          adjParts.push(`care level 2 adjustment ${ci.careLevel2Adj > 0 ? '+' : ''}$${Math.round(ci.careLevel2Adj)}`);
        }
        if (ci.theirMedMgmt > 0 || ci.ourMedMgmt > 0) {
          const mmNet = ci.theirMedMgmt - ci.ourMedMgmt;
          adjParts.push(`med mgmt: their $${Math.round(ci.theirMedMgmt)} − ours $${Math.round(ci.ourMedMgmt)} = ${mmNet >= 0 ? '+' : ''}$${Math.round(mmNet)}`);
        } else if (ci.medMgmtAdj !== 0) {
          adjParts.push(`medication management ${ci.medMgmtAdj > 0 ? '+' : ''}$${Math.round(ci.medMgmtAdj)}`);
        }
        const adjSuffix = adjParts.length > 0 ? ` (adjustments: ${adjParts.join('; ')})` : '';

        let fallbackNote = '';
        if (ci.usedFallback) {
          fallbackNote = ` ${ci.name} does not offer a ${ci.originalRoomType} room type; the adjusted ${ci.usedRoomType} rate was used instead.`;
        }

        if (adjustment.adjustment > 0) {
          return `Our rates are below the competitor benchmark from ${rateContext}${adjSuffix}. We can increase rates by ${diff}% while remaining competitive, capturing additional revenue.${fallbackNote}`;
        } else if (adjustment.adjustment < 0) {
          return `We're currently priced above the competitor benchmark from ${rateContext}${adjSuffix}. A ${Math.abs(parseFloat(diff))}% adjustment improves our competitive position.${fallbackNote}`;
        } else {
          return `Our pricing aligns with the competitor benchmark from ${rateContext}${adjSuffix}. No competitive adjustment needed.${fallbackNote}`;
        }
      }

      // Fallback explanation when no named competitor info is available
      if (adjustment.adjustment > 0) {
        return `Our rates are below the market rate of ${formattedRate}. We can increase rates by ${diff}% while remaining competitive, capturing additional revenue without losing market position.`;
      } else if (adjustment.adjustment < 0) {
        return `We're currently priced above the market rate of ${formattedRate}. A ${Math.abs(parseFloat(diff))}% adjustment brings us closer to market rates, improving our competitive position.`;
      } else {
        return `Our pricing aligns well with the market rate of ${formattedRate}. No competitive adjustment needed as we're appropriately positioned.`;
      }

    case 'market':
      const mktPct = (inputs.marketReturn * 100).toFixed(1);
      if (inputs.marketReturn > 0) {
        return `Economic indicators show ${mktPct}% growth, suggesting stable consumer confidence. While not a primary driver for senior housing, positive economic conditions support maintaining or slightly increasing rates.`;
      } else {
        return `Economic indicators are down ${Math.abs(parseFloat(mktPct))}%, potentially affecting families' ability to pay. We apply a minor adjustment to acknowledge economic headwinds while recognizing senior housing's relative stability.`;
      }

    case 'demand':
      const avg = inputs.demandHistory.reduce((a: number, b: number) => a + b, 0) / inputs.demandHistory.length;
      const demandRatio = ((inputs.demandCurrent / avg - 1) * 100).toFixed(0);
      if (inputs.demandCurrent > avg * 1.2) {
        return `Current inquiry and tour activity is ${demandRatio}% above our historical average, indicating strong interest. High demand supports rate increases as we have multiple prospects for each unit.`;
      } else if (inputs.demandCurrent < avg * 0.8) {
        return `Inquiry and tour volume is ${Math.abs(parseFloat(demandRatio))}% below average, suggesting softer demand. Rate reductions help stimulate interest and generate more tours to fill units.`;
      } else {
        return `Current demand is within normal range compared to our historical patterns. Pricing adjustments based on demand remain minimal as activity levels are stable.`;
      }

    case 'roomtypetrend':
      if (inputs.roomTypeOccTrend === undefined || inputs.roomTypeOccTrend === null) {
        return `No trailing 3-month room type occupancy data available. The room type demand trend factor was not applied.`;
      }
      const rtOccPct = Math.round(inputs.roomTypeOccTrend * 100);
      const slOccPct = Math.round(inputs.occupancy * 100);
      const divergencePts = rtOccPct - slOccPct;
      if (divergencePts > 3) {
        return `This room type has a trailing 3-month average occupancy of ${rtOccPct}%, which is ${divergencePts} percentage points above the ${slOccPct}% service-line average. Stronger demand for this room type supports a slight rate premium to capture additional revenue.`;
      } else if (divergencePts < -3) {
        return `This room type has a trailing 3-month average occupancy of ${rtOccPct}%, which is ${Math.abs(divergencePts)} percentage points below the ${slOccPct}% service-line average. Weaker relative demand for this room type warrants a modest rate reduction to improve competitiveness and fill velocity.`;
      } else {
        return `This room type has a trailing 3-month average occupancy of ${rtOccPct}%, closely tracking the ${slOccPct}% service-line average. No meaningful divergence is detected, so the room type trend applies minimal adjustment.`;
      }

    default:
      return `Adjustment factor applied based on current market conditions and unit characteristics.`;
  }
}

export function generateOverallExplanation(result: any, inputs: any): string {
  const totalAdj = (result.totalAdjustment * 100).toFixed(1);
  const occPct = (inputs.occupancy * 100).toFixed(0);
  
  let summary = `Based on comprehensive analysis, we recommend a ${Math.abs(parseFloat(totalAdj))}% ${result.totalAdjustment > 0 ? 'increase' : 'decrease'} from the base rate. `;
  
  // Key driver explanation
  const adjustments = result.adjustments || [];
  const largest = adjustments.reduce((max: any, adj: any) => 
    Math.abs(adj.weightedAdjustment) > Math.abs(max.weightedAdjustment) ? adj : max, 
    adjustments[0] || { factor: '', weightedAdjustment: 0 }
  );
  
  if (largest && largest.factor) {
    summary += `The primary driver is ${largest.factor.toLowerCase()}, contributing ${Math.abs(largest.weightedAdjustment).toFixed(1)}% to the adjustment. `;
  }
  
  // Context about occupancy
  if (inputs.occupancy < 0.85) {
    summary += `With occupancy at ${occPct}%, aggressive pricing is needed to improve census. `;
  } else if (inputs.occupancy > 0.92) {
    summary += `Strong ${occPct}% occupancy provides pricing flexibility to optimize revenue. `;
  }
  
  // Guardrails mention if applied
  if (result.guardrailsApplied && result.guardrailsApplied.length > 0) {
    summary += `Smart guardrails were applied to keep the adjustment within acceptable limits, ensuring pricing stability. `;
  }
  
  summary += `This balanced approach considers market conditions, unit characteristics, and operational goals to maximize both occupancy and revenue.`;
  
  return summary;
}

export function explainSignal(signal: number, factor: string): string {
  const strength = Math.abs(signal);
  let intensity = '';
  
  if (strength > 0.8) intensity = 'very strong';
  else if (strength > 0.5) intensity = 'strong';
  else if (strength > 0.2) intensity = 'moderate';
  else intensity = 'weak';
  
  const direction = signal > 0 ? 'upward' : 'downward';
  
  return `The ${factor} factor shows a ${intensity} ${direction} signal of ${(signal * 100).toFixed(1)}%, indicating ${
    signal > 0 ? 'an opportunity to increase rates' : 'a need to reduce rates'
  } based on this metric.`;
}