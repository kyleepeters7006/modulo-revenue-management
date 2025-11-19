/**
 * Competitor Rate Adjustment Service
 * 
 * Implements Trilogy's competitor rate adjustment logic:
 * 1. Start with competitor's base (non-adjusted) rate
 * 2. Adjust for care level 2 differences (if Trilogy's care is lower, competitor effective cost is higher)
 * 3. Adjust for medication management (if competitor charges separately, add to their rate)
 * 4. Return adjusted competitor benchmark rate
 */

export interface CompetitorAdjustmentInput {
  competitorBaseRate: number;
  competitorCareLevel2Rate?: number | null;
  competitorMedicationManagementFee?: number | null;
  trilogyCareLevel2Rate?: number | null;
}

export interface CompetitorAdjustmentResult {
  adjustedRate: number;
  baseRate: number;
  careLevel2Adjustment: number;
  medicationManagementAdjustment: number;
  explanation: string;
}

/**
 * Calculate adjusted competitor rate for fair comparison
 * 
 * @param input - Competitor and Trilogy rate data
 * @returns Adjusted competitor rate with breakdown
 */
export function calculateAdjustedCompetitorRate(
  input: CompetitorAdjustmentInput
): CompetitorAdjustmentResult {
  const {
    competitorBaseRate,
    competitorCareLevel2Rate = 0,
    competitorMedicationManagementFee = 0,
    trilogyCareLevel2Rate = 0
  } = input;
  
  let careLevel2Adjustment = 0;
  let medicationManagementAdjustment = 0;
  const explanationParts: string[] = [];
  
  // Care Level 2 Adjustment
  // If competitor's care level 2 is HIGHER than Trilogy's, increase their effective cost
  if (competitorCareLevel2Rate && trilogyCareLevel2Rate) {
    const careDifference = competitorCareLevel2Rate - trilogyCareLevel2Rate;
    if (careDifference > 0) {
      careLevel2Adjustment = careDifference;
      explanationParts.push(
        `Added $${careDifference.toFixed(2)} because competitor's care level 2 ($${competitorCareLevel2Rate.toFixed(2)}) is higher than Trilogy's ($${trilogyCareLevel2Rate.toFixed(2)})`
      );
    } else if (careDifference < 0) {
      explanationParts.push(
        `No adjustment - Trilogy's care level 2 ($${trilogyCareLevel2Rate.toFixed(2)}) is higher than competitor's ($${competitorCareLevel2Rate.toFixed(2)})`
      );
    }
  }
  
  // Medication Management Adjustment
  // If competitor charges for medication management and Trilogy doesn't, add that to their rate
  if (competitorMedicationManagementFee && competitorMedicationManagementFee > 0) {
    medicationManagementAdjustment = competitorMedicationManagementFee;
    explanationParts.push(
      `Added $${competitorMedicationManagementFee.toFixed(2)} for medication management (Trilogy includes this at no charge)`
    );
  }
  
  const adjustedRate = competitorBaseRate + careLevel2Adjustment + medicationManagementAdjustment;
  
  const explanation = explanationParts.length > 0
    ? `Base rate: $${competitorBaseRate.toFixed(2)}. ${explanationParts.join('. ')}.`
    : `Base rate: $${competitorBaseRate.toFixed(2)} (no adjustments needed).`;
  
  return {
    adjustedRate,
    baseRate: competitorBaseRate,
    careLevel2Adjustment,
    medicationManagementAdjustment,
    explanation
  };
}

/**
 * Get top competitor by weight for a given location and service line
 * 
 * @param competitors - Array of competitor objects with weight field
 * @returns Top weighted competitor or null
 */
export function getTopCompetitorByWeight(competitors: Array<{
  weight?: number | null;
  streetRate?: number | null;
  avgCareRate?: number | null;
  name: string;
}>): typeof competitors[0] | null {
  if (!competitors || competitors.length === 0) {
    return null;
  }
  
  // Filter to competitors with weight and rate data
  const validCompetitors = competitors.filter(
    c => c.weight != null && c.streetRate != null
  );
  
  if (validCompetitors.length === 0) {
    // Fallback to first competitor with rate data
    return competitors.find(c => c.streetRate != null) || competitors[0];
  }
  
  // Sort by weight (descending) and return top
  return validCompetitors.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
}
