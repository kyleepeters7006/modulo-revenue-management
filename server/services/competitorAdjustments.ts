/**
 * Competitor Rate Adjustment Service
 * 
 * Implements Trilogy's 4-level care competitor rate adjustment logic:
 * 1. Calculate normalized competitor rate = base + care_level_2 + med_mgmt_fee
 * 2. Calculate adjustment = (competitor_care_level_2 - trilogy_care_level_2) + competitor_med_mgmt_fee
 * 3. Return both normalized rate and adjustment with detailed explanation
 * 
 * Example: Competitor base=$1000, care2=$1000, med=$500, Trilogy care2=$500
 *   Normalized comp rate = $1000 + $1000 + $500 = $2500
 *   Adjustment = ($1000 - $500) + $500 = $1000
 */

export interface CompetitorAdjustmentInput {
  competitorBaseRate: number;
  competitorCareLevel1Rate?: number | null;
  competitorCareLevel2Rate?: number | null;
  competitorCareLevel3Rate?: number | null;
  competitorCareLevel4Rate?: number | null;
  competitorMedicationManagementFee?: number | null;
  trilogyCareLevel2Rate?: number | null;
}

export interface CompetitorAdjustmentResult {
  adjustedRate: number;
  normalizedRate: number; // base + care + med mgmt
  baseRate: number;
  careLevel2Adjustment: number;
  medicationManagementAdjustment: number;
  explanation: string;
}

/**
 * Calculate adjusted competitor rate for fair comparison using 4-level care system
 * 
 * @param input - Competitor and Trilogy rate data
 * @returns Normalized and adjusted competitor rate with breakdown
 */
export function calculateAdjustedCompetitorRate(
  input: CompetitorAdjustmentInput
): CompetitorAdjustmentResult {
  const {
    competitorBaseRate,
    competitorCareLevel1Rate = 0,
    competitorCareLevel2Rate = 0,
    competitorCareLevel3Rate = 0,
    competitorCareLevel4Rate = 0,
    competitorMedicationManagementFee = 0,
    trilogyCareLevel2Rate = 0
  } = input;
  
  let careLevel2Adjustment = 0;
  let medicationManagementAdjustment = 0;
  const explanationParts: string[] = [];
  
  // Calculate normalized competitor rate (what customer actually pays)
  // Normalized Rate = Base + Care Level 2 + Medication Management
  const normalizedRate = competitorBaseRate + 
    (competitorCareLevel2Rate || 0) + 
    (competitorMedicationManagementFee || 0);
  
  // Care Level 2 Adjustment
  // Calculate difference between competitor's care level 2 and Trilogy's
  if (competitorCareLevel2Rate && trilogyCareLevel2Rate) {
    careLevel2Adjustment = competitorCareLevel2Rate - trilogyCareLevel2Rate;
    if (careLevel2Adjustment > 0) {
      explanationParts.push(
        `Care Level 2: Competitor charges $${competitorCareLevel2Rate.toFixed(0)}, Trilogy charges $${trilogyCareLevel2Rate.toFixed(0)} (difference: +$${careLevel2Adjustment.toFixed(0)})`
      );
    } else if (careLevel2Adjustment < 0) {
      explanationParts.push(
        `Care Level 2: Trilogy charges $${trilogyCareLevel2Rate.toFixed(0)}, Competitor charges $${competitorCareLevel2Rate.toFixed(0)} (difference: $${careLevel2Adjustment.toFixed(0)})`
      );
    } else {
      explanationParts.push(
        `Care Level 2: Both charge $${trilogyCareLevel2Rate.toFixed(0)} (no difference)`
      );
    }
  } else if (competitorCareLevel2Rate) {
    // Competitor has care level 2 but Trilogy rate not available
    careLevel2Adjustment = competitorCareLevel2Rate;
    explanationParts.push(
      `Care Level 2: Competitor charges $${competitorCareLevel2Rate.toFixed(0)} (Trilogy rate unavailable)`
    );
  }
  
  // Medication Management Adjustment
  // If competitor charges for medication management and Trilogy doesn't, add that to adjustment
  if (competitorMedicationManagementFee && competitorMedicationManagementFee > 0) {
    medicationManagementAdjustment = competitorMedicationManagementFee;
    explanationParts.push(
      `Medication Management: Competitor charges $${competitorMedicationManagementFee.toFixed(0)}, Trilogy includes at no charge (+$${competitorMedicationManagementFee.toFixed(0)})`
    );
  }
  
  // Total adjustment = care level difference + medication management fee
  const adjustedRate = competitorBaseRate + careLevel2Adjustment + medicationManagementAdjustment;
  
  // Build explanation
  let explanation = `Base rate: $${competitorBaseRate.toFixed(0)}`;
  if (competitorCareLevel2Rate) {
    explanation += `, Care Level 2: $${competitorCareLevel2Rate.toFixed(0)}`;
  }
  if (competitorMedicationManagementFee) {
    explanation += `, Med Mgmt: $${competitorMedicationManagementFee.toFixed(0)}`;
  }
  explanation += ` = Normalized rate: $${normalizedRate.toFixed(0)}. `;
  
  if (explanationParts.length > 0) {
    explanation += explanationParts.join('. ') + '.';
  } else {
    explanation += 'No adjustments needed (rates match Trilogy).';
  }
  
  return {
    adjustedRate,
    normalizedRate,
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
