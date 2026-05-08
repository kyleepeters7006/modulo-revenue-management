/**
 * Competitor Rate Adjustment Service
 *
 * Implements Trilogy's 4-level care competitor rate adjustment logic:
 *   Adjusted Rate = base + (theirCareL2 - ourCareL2) + (theirMedMgmt - ourMedMgmt)
 *
 * Example: Competitor base=$1000, care2=$1000, med=$500, Trilogy care2=$500, med=$0
 *   Adjusted = $1000 + ($1000-$500) + ($500-$0) = $2000
 */

export interface CompetitorAdjustmentInput {
  competitorBaseRate: number;
  competitorCareLevel1Rate?: number | null;
  competitorCareLevel2Rate?: number | null;
  competitorCareLevel3Rate?: number | null;
  competitorCareLevel4Rate?: number | null;
  competitorMedicationManagementFee?: number | null;
  trilogyCareLevel2Rate?: number | null;
  trilogyMedicationManagementFee?: number | null; // Trilogy's own med mgmt fee (usually 0 — included)
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
    trilogyCareLevel2Rate = 0,
    trilogyMedicationManagementFee = 0
  } = input;
  
  let careLevel2Adjustment = 0;
  let medicationManagementAdjustment = 0;
  const explanationParts: string[] = [];
  
  // Calculate normalized competitor rate (what customer actually pays)
  // Normalized Rate = Base + Care Level 2 + Medication Management
  const normalizedRate = competitorBaseRate + 
    (competitorCareLevel2Rate || 0) + 
    (competitorMedicationManagementFee || 0);
  
  // Care Level 2 Adjustment: (theirCareL2 - ourCareL2)
  // Always apply whenever either side has a non-zero value (zero is a valid rate, not "unknown")
  const theirCareL2Val = competitorCareLevel2Rate || 0;
  const ourCareL2Val = trilogyCareLevel2Rate || 0;
  if (theirCareL2Val > 0 || ourCareL2Val > 0) {
    careLevel2Adjustment = theirCareL2Val - ourCareL2Val;
    if (careLevel2Adjustment > 0) {
      explanationParts.push(
        `Care Level 2: Competitor charges $${theirCareL2Val.toFixed(0)}, Trilogy charges $${ourCareL2Val.toFixed(0)} (difference: +$${careLevel2Adjustment.toFixed(0)})`
      );
    } else if (careLevel2Adjustment < 0) {
      explanationParts.push(
        `Care Level 2: Trilogy charges $${ourCareL2Val.toFixed(0)}, Competitor charges $${theirCareL2Val.toFixed(0)} (difference: $${careLevel2Adjustment.toFixed(0)})`
      );
    } else {
      explanationParts.push(
        `Care Level 2: Both charge $${ourCareL2Val.toFixed(0)} (no difference)`
      );
    }
  }
  
  // Medication Management Adjustment: (theirMedMgmt - ourMedMgmt)
  const ourMedMgmt = trilogyMedicationManagementFee || 0;
  const theirMedMgmt = competitorMedicationManagementFee || 0;
  if (theirMedMgmt > 0 || ourMedMgmt > 0) {
    medicationManagementAdjustment = theirMedMgmt - ourMedMgmt;
    if (medicationManagementAdjustment > 0) {
      explanationParts.push(
        `Medication Management: Competitor charges $${theirMedMgmt.toFixed(0)}, Trilogy $${ourMedMgmt.toFixed(0)} (difference: +$${medicationManagementAdjustment.toFixed(0)})`
      );
    } else if (medicationManagementAdjustment < 0) {
      explanationParts.push(
        `Medication Management: Trilogy charges $${ourMedMgmt.toFixed(0)}, Competitor $${theirMedMgmt.toFixed(0)} (difference: $${medicationManagementAdjustment.toFixed(0)})`
      );
    }
  }

  // Total adjustment = care level difference + medication management difference
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
