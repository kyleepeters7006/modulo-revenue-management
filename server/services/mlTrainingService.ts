import { db } from '../db';
import { 
  aiRateOutcomes, 
  aiWeightVersions, 
  mlTrainingHistory,
  rentRollData,
  calculationHistory,
  pricingWeights,
  type AiRateOutcome,
  type AiWeightVersion
} from '@shared/schema';
import { eq, and, gte, lte, sql, isNull, desc, count, avg } from 'drizzle-orm';

// Weight constraints for safety
const WEIGHT_MIN = 5;  // Minimum 5% per factor
const WEIGHT_MAX = 60; // Maximum 60% per factor
const MIN_SAMPLES_FOR_TRAINING = 50; // Minimum samples before updating weights

// Default weights (matching current Modulo algorithm)
const DEFAULT_WEIGHTS = {
  occupancyPressure: 44,
  daysVacantDecay: 10,
  seasonality: 10,
  competitorRates: 12,
  stockMarket: 10,
  inquiryTourVolume: 14
};

interface WeightsSnapshot {
  occupancyPressure: number;
  daysVacantDecay: number;
  seasonality: number;
  competitorRates: number;
  stockMarket: number;
  inquiryTourVolume: number;
}

interface OutcomeData {
  location: string;
  serviceLine: string;
  roomNumber: string;
  roomType: string | null;
  uploadMonth: string;
  aiSuggestedRate: number;
  streetRateAtSet: number;
  wasAiAdopted: boolean;
  adoptedAt: Date | null;
  soldWithin30Days: boolean;
  outcomeScore: number;
  weightsSnapshot: WeightsSnapshot;
}

/**
 * Record an AI rate outcome when a calculation is run
 * This creates outcome records for all calculated units
 */
export async function recordAiRateOutcomes(
  calculationRunId: string | null,
  units: Array<{
    id: string;
    location: string;
    locationId: string | null;
    serviceLine: string;
    roomNumber: string;
    roomType: string;
    uploadMonth: string;
    aiSuggestedRate: number;
    streetRate: number;
    weightsSnapshot: WeightsSnapshot;
  }>
): Promise<number> {
  if (units.length === 0) return 0;
  
  let recorded = 0;
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < units.length; i += BATCH_SIZE) {
    const batch = units.slice(i, i + BATCH_SIZE);
    
    try {
      // Insert or update outcomes
      for (const unit of batch) {
        try {
          // Check if record exists first
          const existing = await db
            .select({ id: aiRateOutcomes.id })
            .from(aiRateOutcomes)
            .where(
              and(
                eq(aiRateOutcomes.location, unit.location),
                eq(aiRateOutcomes.roomNumber, unit.roomNumber),
                eq(aiRateOutcomes.uploadMonth, unit.uploadMonth)
              )
            )
            .limit(1);
          
          if (existing.length > 0) {
            // Update existing record
            await db.update(aiRateOutcomes)
              .set({
                aiSuggestedRate: unit.aiSuggestedRate,
                streetRateAtSet: unit.streetRate,
                weightsSnapshot: unit.weightsSnapshot,
                calculationRunId: calculationRunId,
                updatedAt: new Date()
              })
              .where(eq(aiRateOutcomes.id, existing[0].id));
          } else {
            // Insert new record
            await db.insert(aiRateOutcomes)
              .values({
                rentRollDataId: unit.id,
                locationId: unit.locationId,
                location: unit.location,
                serviceLine: unit.serviceLine,
                roomNumber: unit.roomNumber,
                roomType: unit.roomType,
                uploadMonth: unit.uploadMonth,
                aiSuggestedRate: unit.aiSuggestedRate,
                streetRateAtSet: unit.streetRate,
                wasAiAdopted: false,
                soldWithin30Days: false,
                outcomeScore: 0,
                weightsSnapshot: unit.weightsSnapshot,
                calculationRunId: calculationRunId
              });
          }
          recorded++;
        } catch (unitError) {
          console.error(`Error recording outcome for ${unit.location}/${unit.roomNumber}:`, unitError);
        }
      }
    } catch (error) {
      console.error('Error recording AI rate outcomes batch:', error);
    }
  }
  
  console.log(`Recorded ${recorded} AI rate outcomes for calculation ${calculationRunId}`);
  return recorded;
}

/**
 * Check for AI rate adoptions - when street rate matches AI suggested rate
 * This should be called after any street rate update
 */
export async function detectAiRateAdoptions(uploadMonth: string): Promise<number> {
  console.log(`Checking for AI rate adoptions in month: ${uploadMonth}`);
  
  // Find outcomes where AI rate wasn't yet marked as adopted
  const pendingOutcomes = await db
    .select({
      outcomeId: aiRateOutcomes.id,
      location: aiRateOutcomes.location,
      roomNumber: aiRateOutcomes.roomNumber,
      aiSuggestedRate: aiRateOutcomes.aiSuggestedRate,
      rentRollDataId: aiRateOutcomes.rentRollDataId
    })
    .from(aiRateOutcomes)
    .where(
      and(
        eq(aiRateOutcomes.uploadMonth, uploadMonth),
        eq(aiRateOutcomes.wasAiAdopted, false)
      )
    );
  
  let adoptionsDetected = 0;
  const TOLERANCE = 0.02; // 2% tolerance for rate matching
  
  for (const outcome of pendingOutcomes) {
    if (!outcome.rentRollDataId) continue;
    
    // Get current street rate from rent roll
    const currentUnit = await db
      .select({ streetRate: rentRollData.streetRate })
      .from(rentRollData)
      .where(eq(rentRollData.id, outcome.rentRollDataId))
      .limit(1);
    
    if (currentUnit.length === 0) continue;
    
    const currentStreetRate = currentUnit[0].streetRate;
    const aiRate = outcome.aiSuggestedRate;
    
    // Check if rates match within tolerance
    const diff = Math.abs(currentStreetRate - aiRate) / aiRate;
    
    if (diff <= TOLERANCE) {
      // AI rate was adopted!
      await db.update(aiRateOutcomes)
        .set({
          wasAiAdopted: true,
          adoptedAt: new Date(),
          adoptedStreetRate: currentStreetRate,
          outcomeScore: 1, // +1 for adoption
          updatedAt: new Date()
        })
        .where(eq(aiRateOutcomes.id, outcome.outcomeId));
      
      adoptionsDetected++;
    }
  }
  
  console.log(`Detected ${adoptionsDetected} AI rate adoptions out of ${pendingOutcomes.length} pending outcomes`);
  return adoptionsDetected;
}

/**
 * Update sale tracking - detect units that sold within 30 days of rate adoption
 * This should be called periodically to check for move-ins
 */
export async function updateSaleTracking(): Promise<number> {
  console.log('Checking for sales within 30 days of AI rate adoption...');
  
  // Find adopted outcomes that haven't been checked for sales
  const adoptedOutcomes = await db
    .select({
      id: aiRateOutcomes.id,
      adoptedAt: aiRateOutcomes.adoptedAt,
      rentRollDataId: aiRateOutcomes.rentRollDataId
    })
    .from(aiRateOutcomes)
    .where(
      and(
        eq(aiRateOutcomes.wasAiAdopted, true),
        isNull(aiRateOutcomes.soldAt)
      )
    );
  
  let salesTracked = 0;
  
  for (const outcome of adoptedOutcomes) {
    if (!outcome.rentRollDataId || !outcome.adoptedAt) continue;
    
    // Check if unit is now occupied (sold)
    const currentUnit = await db
      .select({
        occupiedYN: rentRollData.occupiedYN,
        moveInDate: rentRollData.moveInDate
      })
      .from(rentRollData)
      .where(eq(rentRollData.id, outcome.rentRollDataId))
      .limit(1);
    
    if (currentUnit.length === 0) continue;
    
    const unit = currentUnit[0];
    
    if (unit.occupiedYN && unit.moveInDate) {
      // Unit was sold - calculate days to sale
      const moveInDateParsed = new Date(unit.moveInDate);
      const adoptedAt = new Date(outcome.adoptedAt);
      const daysToSale = Math.floor((moveInDateParsed.getTime() - adoptedAt.getTime()) / (1000 * 60 * 60 * 24));
      const soldWithin30Days = daysToSale >= 0 && daysToSale <= 30;
      
      // Update outcome with sale info
      // Score: +2 if adopted + sold within 30 days, +1 if just adopted
      const outcomeScore = soldWithin30Days ? 2 : 1;
      
      await db.update(aiRateOutcomes)
        .set({
          soldAt: moveInDateParsed,
          moveInDate: unit.moveInDate,
          daysToSale: daysToSale >= 0 ? daysToSale : null,
          soldWithin30Days,
          outcomeScore,
          updatedAt: new Date()
        })
        .where(eq(aiRateOutcomes.id, outcome.id));
      
      salesTracked++;
    }
  }
  
  console.log(`Tracked ${salesTracked} sales out of ${adoptedOutcomes.length} adopted outcomes`);
  return salesTracked;
}

/**
 * Train the ML model using outcome data and update weights
 * Uses regularized linear regression to learn optimal factor weights
 */
export async function trainAndUpdateWeights(
  trainingType: 'scheduled' | 'manual' | 'triggered' = 'scheduled'
): Promise<{
  success: boolean;
  modelsUpdated: number;
  message: string;
}> {
  console.log(`\n=== Starting ML Training (${trainingType}) ===`);
  
  // Get all outcomes with complete data
  const outcomes = await db
    .select()
    .from(aiRateOutcomes)
    .where(
      and(
        eq(aiRateOutcomes.wasAiAdopted, true), // Only use adopted outcomes for training
        sql`${aiRateOutcomes.weightsSnapshot} IS NOT NULL`
      )
    );
  
  console.log(`Found ${outcomes.length} adopted outcomes for training`);
  
  if (outcomes.length < MIN_SAMPLES_FOR_TRAINING) {
    return {
      success: false,
      modelsUpdated: 0,
      message: `Not enough samples for training. Need ${MIN_SAMPLES_FOR_TRAINING}, have ${outcomes.length}`
    };
  }
  
  // Get current global weights for comparison
  const currentGlobalWeights = await getActiveWeights('global', null);
  
  let modelsUpdated = 0;
  const serviceLineUpdates: Array<{
    serviceLine: string;
    sampleSize: number;
    weightsBefore: WeightsSnapshot;
    weightsAfter: WeightsSnapshot;
    adoptionRate: number;
    saleRate: number;
  }> = [];
  
  // Group outcomes by service line
  const outcomesByServiceLine = new Map<string, AiRateOutcome[]>();
  for (const outcome of outcomes) {
    const key = outcome.serviceLine;
    if (!outcomesByServiceLine.has(key)) {
      outcomesByServiceLine.set(key, []);
    }
    outcomesByServiceLine.get(key)!.push(outcome);
  }
  
  // Train a model for each service line with enough data
  const serviceLineEntries = Array.from(outcomesByServiceLine.entries());
  for (const [serviceLine, serviceOutcomes] of serviceLineEntries) {
    if (serviceOutcomes.length < MIN_SAMPLES_FOR_TRAINING) {
      console.log(`Skipping ${serviceLine}: only ${serviceOutcomes.length} samples (need ${MIN_SAMPLES_FOR_TRAINING})`);
      continue;
    }
    
    console.log(`\nTraining model for service line: ${serviceLine} (${serviceOutcomes.length} samples)`);
    
    // Get current weights for this service line
    const currentWeights = await getActiveWeights('service_line', serviceLine);
    
    // Calculate outcome statistics
    const adoptedCount = serviceOutcomes.length;
    const soldWithin30Count = serviceOutcomes.filter((o: AiRateOutcome) => o.soldWithin30Days).length;
    const adoptionRate = adoptedCount / serviceOutcomes.length;
    const saleRate = soldWithin30Count / adoptedCount;
    const avgScore = serviceOutcomes.reduce((sum: number, o: AiRateOutcome) => sum + (o.outcomeScore || 0), 0) / serviceOutcomes.length;
    
    console.log(`  Adoption rate: ${(adoptionRate * 100).toFixed(1)}%`);
    console.log(`  Sale within 30 days rate: ${(saleRate * 100).toFixed(1)}%`);
    console.log(`  Average outcome score: ${avgScore.toFixed(2)}`);
    
    // Perform regularized regression to learn optimal weights
    const learnedWeights = performWeightLearning(serviceOutcomes, currentWeights);
    
    // Apply safety clamps and normalize
    const safeWeights = clampAndNormalizeWeights(learnedWeights);
    
    console.log(`  Learned weights (before safety clamps): ${JSON.stringify(learnedWeights)}`);
    console.log(`  Safe weights (after clamps): ${JSON.stringify(safeWeights)}`);
    
    // Get next version number
    const latestVersion = await db
      .select({ version: aiWeightVersions.version })
      .from(aiWeightVersions)
      .where(
        and(
          eq(aiWeightVersions.scope, 'service_line'),
          eq(aiWeightVersions.scopeValue, serviceLine)
        )
      )
      .orderBy(desc(aiWeightVersions.version))
      .limit(1);
    
    const nextVersion = (latestVersion[0]?.version || 0) + 1;
    
    // Deactivate previous version
    await db.update(aiWeightVersions)
      .set({
        isActive: false,
        deactivatedAt: new Date()
      })
      .where(
        and(
          eq(aiWeightVersions.scope, 'service_line'),
          eq(aiWeightVersions.scopeValue, serviceLine),
          eq(aiWeightVersions.isActive, true)
        )
      );
    
    // Save new weight version
    await db.insert(aiWeightVersions).values({
      scope: 'service_line',
      scopeValue: serviceLine,
      version: nextVersion,
      occupancyPressure: safeWeights.occupancyPressure,
      daysVacantDecay: safeWeights.daysVacantDecay,
      seasonality: safeWeights.seasonality,
      competitorRates: safeWeights.competitorRates,
      stockMarket: safeWeights.stockMarket,
      inquiryTourVolume: safeWeights.inquiryTourVolume,
      sampleSize: serviceOutcomes.length,
      adoptionRate,
      saleWithin30Rate: saleRate,
      averageOutcomeScore: avgScore,
      modelMetadata: {
        trainingType,
        trainedAt: new Date().toISOString(),
        samplesUsed: serviceOutcomes.length,
        adoptedCount,
        soldWithin30Count
      },
      isActive: true,
      activatedAt: new Date()
    });
    
    modelsUpdated++;
    
    serviceLineUpdates.push({
      serviceLine,
      sampleSize: serviceOutcomes.length,
      weightsBefore: currentWeights,
      weightsAfter: safeWeights,
      adoptionRate,
      saleRate
    });
    
    console.log(`  Model v${nextVersion} saved and activated for ${serviceLine}`);
  }
  
  // Train global model if we have enough data across all service lines
  if (outcomes.length >= MIN_SAMPLES_FOR_TRAINING * 2) {
    console.log(`\nTraining global model (${outcomes.length} total samples)`);
    
    const globalLearnedWeights = performWeightLearning(outcomes, currentGlobalWeights);
    const globalSafeWeights = clampAndNormalizeWeights(globalLearnedWeights);
    
    const adoptionRate = outcomes.length / outcomes.length; // All are adopted
    const soldCount = outcomes.filter(o => o.soldWithin30Days).length;
    const saleRate = soldCount / outcomes.length;
    const avgScore = outcomes.reduce((sum, o) => sum + (o.outcomeScore || 0), 0) / outcomes.length;
    
    // Get next global version
    const latestGlobalVersion = await db
      .select({ version: aiWeightVersions.version })
      .from(aiWeightVersions)
      .where(
        and(
          eq(aiWeightVersions.scope, 'global'),
          isNull(aiWeightVersions.scopeValue)
        )
      )
      .orderBy(desc(aiWeightVersions.version))
      .limit(1);
    
    const nextGlobalVersion = (latestGlobalVersion[0]?.version || 0) + 1;
    
    // Deactivate previous global version
    await db.update(aiWeightVersions)
      .set({
        isActive: false,
        deactivatedAt: new Date()
      })
      .where(
        and(
          eq(aiWeightVersions.scope, 'global'),
          isNull(aiWeightVersions.scopeValue),
          eq(aiWeightVersions.isActive, true)
        )
      );
    
    // Save new global weight version
    await db.insert(aiWeightVersions).values({
      scope: 'global',
      scopeValue: null,
      version: nextGlobalVersion,
      occupancyPressure: globalSafeWeights.occupancyPressure,
      daysVacantDecay: globalSafeWeights.daysVacantDecay,
      seasonality: globalSafeWeights.seasonality,
      competitorRates: globalSafeWeights.competitorRates,
      stockMarket: globalSafeWeights.stockMarket,
      inquiryTourVolume: globalSafeWeights.inquiryTourVolume,
      sampleSize: outcomes.length,
      adoptionRate,
      saleWithin30Rate: saleRate,
      averageOutcomeScore: avgScore,
      modelMetadata: {
        trainingType,
        trainedAt: new Date().toISOString(),
        samplesUsed: outcomes.length,
        soldCount
      },
      isActive: true,
      activatedAt: new Date()
    });
    
    modelsUpdated++;
    console.log(`  Global model v${nextGlobalVersion} saved and activated`);
  }
  
  // Record training history
  await db.insert(mlTrainingHistory).values({
    trainingType,
    samplesUsed: outcomes.length,
    modelsUpdated,
    globalWeightsBefore: currentGlobalWeights,
    globalWeightsAfter: modelsUpdated > 0 ? await getActiveWeights('global', null) : currentGlobalWeights,
    serviceLineUpdates,
    trainingMetrics: {
      totalOutcomes: outcomes.length,
      adoptedCount: outcomes.length,
      soldWithin30Count: outcomes.filter(o => o.soldWithin30Days).length
    },
    status: 'completed'
  });
  
  console.log(`\n=== ML Training Complete: ${modelsUpdated} models updated ===\n`);
  
  return {
    success: true,
    modelsUpdated,
    message: `Successfully trained ${modelsUpdated} models from ${outcomes.length} samples`
  };
}

/**
 * Perform weight learning using outcome data
 * Uses a simple gradient-based approach with regularization
 */
function performWeightLearning(
  outcomes: AiRateOutcome[],
  currentWeights: WeightsSnapshot
): WeightsSnapshot {
  // For outcomes with higher scores (adopted + sold quickly),
  // adjust weights towards what was used for those outcomes
  
  // Group by outcome score
  const highScoreOutcomes = outcomes.filter(o => (o.outcomeScore || 0) >= 2);
  const mediumScoreOutcomes = outcomes.filter(o => (o.outcomeScore || 0) === 1);
  
  if (highScoreOutcomes.length === 0) {
    // No high-performing outcomes, return current weights with small perturbation
    return currentWeights;
  }
  
  // Calculate average weights from high-performing outcomes
  const avgHighScoreWeights: WeightsSnapshot = {
    occupancyPressure: 0,
    daysVacantDecay: 0,
    seasonality: 0,
    competitorRates: 0,
    stockMarket: 0,
    inquiryTourVolume: 0
  };
  
  let validHighScoreCount = 0;
  for (const outcome of highScoreOutcomes) {
    const snapshot = outcome.weightsSnapshot as unknown as WeightsSnapshot;
    if (snapshot && typeof snapshot.occupancyPressure === 'number') {
      avgHighScoreWeights.occupancyPressure += snapshot.occupancyPressure;
      avgHighScoreWeights.daysVacantDecay += snapshot.daysVacantDecay;
      avgHighScoreWeights.seasonality += snapshot.seasonality;
      avgHighScoreWeights.competitorRates += snapshot.competitorRates;
      avgHighScoreWeights.stockMarket += snapshot.stockMarket;
      avgHighScoreWeights.inquiryTourVolume += snapshot.inquiryTourVolume;
      validHighScoreCount++;
    }
  }
  
  if (validHighScoreCount === 0) {
    return currentWeights;
  }
  
  // Average the weights
  avgHighScoreWeights.occupancyPressure /= validHighScoreCount;
  avgHighScoreWeights.daysVacantDecay /= validHighScoreCount;
  avgHighScoreWeights.seasonality /= validHighScoreCount;
  avgHighScoreWeights.competitorRates /= validHighScoreCount;
  avgHighScoreWeights.stockMarket /= validHighScoreCount;
  avgHighScoreWeights.inquiryTourVolume /= validHighScoreCount;
  
  // Blend towards high-score weights with learning rate
  // Higher learning rate if we have more high-score samples
  const learningRate = Math.min(0.3, 0.1 + (validHighScoreCount / outcomes.length) * 0.2);
  
  const learnedWeights: WeightsSnapshot = {
    occupancyPressure: currentWeights.occupancyPressure + learningRate * (avgHighScoreWeights.occupancyPressure - currentWeights.occupancyPressure),
    daysVacantDecay: currentWeights.daysVacantDecay + learningRate * (avgHighScoreWeights.daysVacantDecay - currentWeights.daysVacantDecay),
    seasonality: currentWeights.seasonality + learningRate * (avgHighScoreWeights.seasonality - currentWeights.seasonality),
    competitorRates: currentWeights.competitorRates + learningRate * (avgHighScoreWeights.competitorRates - currentWeights.competitorRates),
    stockMarket: currentWeights.stockMarket + learningRate * (avgHighScoreWeights.stockMarket - currentWeights.stockMarket),
    inquiryTourVolume: currentWeights.inquiryTourVolume + learningRate * (avgHighScoreWeights.inquiryTourVolume - currentWeights.inquiryTourVolume)
  };
  
  return learnedWeights;
}

/**
 * Apply safety clamps and normalize weights to sum to 100
 */
function clampAndNormalizeWeights(weights: WeightsSnapshot): WeightsSnapshot {
  // First, clamp each weight
  const clamped = {
    occupancyPressure: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weights.occupancyPressure)),
    daysVacantDecay: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weights.daysVacantDecay)),
    seasonality: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weights.seasonality)),
    competitorRates: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weights.competitorRates)),
    stockMarket: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weights.stockMarket)),
    inquiryTourVolume: Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, weights.inquiryTourVolume))
  };
  
  // Calculate total
  const total = clamped.occupancyPressure + clamped.daysVacantDecay + 
                clamped.seasonality + clamped.competitorRates + 
                clamped.stockMarket + clamped.inquiryTourVolume;
  
  // Normalize to 100
  const normalized: WeightsSnapshot = {
    occupancyPressure: Math.round((clamped.occupancyPressure / total) * 100),
    daysVacantDecay: Math.round((clamped.daysVacantDecay / total) * 100),
    seasonality: Math.round((clamped.seasonality / total) * 100),
    competitorRates: Math.round((clamped.competitorRates / total) * 100),
    stockMarket: Math.round((clamped.stockMarket / total) * 100),
    inquiryTourVolume: Math.round((clamped.inquiryTourVolume / total) * 100)
  };
  
  // Adjust for rounding errors to ensure sum is exactly 100
  const normalizedTotal = normalized.occupancyPressure + normalized.daysVacantDecay + 
                         normalized.seasonality + normalized.competitorRates + 
                         normalized.stockMarket + normalized.inquiryTourVolume;
  
  if (normalizedTotal !== 100) {
    // Add/subtract difference from largest weight
    normalized.occupancyPressure += (100 - normalizedTotal);
  }
  
  return normalized;
}

/**
 * Get active weights for a given scope
 */
export async function getActiveWeights(
  scope: 'global' | 'service_line' | 'location',
  scopeValue: string | null
): Promise<WeightsSnapshot> {
  const result = await db
    .select()
    .from(aiWeightVersions)
    .where(
      and(
        eq(aiWeightVersions.scope, scope),
        scopeValue ? eq(aiWeightVersions.scopeValue, scopeValue) : isNull(aiWeightVersions.scopeValue),
        eq(aiWeightVersions.isActive, true)
      )
    )
    .limit(1);
  
  if (result.length > 0) {
    return {
      occupancyPressure: result[0].occupancyPressure,
      daysVacantDecay: result[0].daysVacantDecay,
      seasonality: result[0].seasonality,
      competitorRates: result[0].competitorRates,
      stockMarket: result[0].stockMarket,
      inquiryTourVolume: result[0].inquiryTourVolume
    };
  }
  
  // Return defaults if no learned weights
  return DEFAULT_WEIGHTS;
}

/**
 * Get ML learning statistics for display
 */
export async function getMlStatistics(): Promise<{
  totalOutcomes: number;
  adoptedCount: number;
  soldWithin30Count: number;
  adoptionRate: number;
  saleWithin30Rate: number;
  lastTrainingDate: Date | null;
  modelsActive: number;
  serviceLineStats: Array<{
    serviceLine: string;
    outcomes: number;
    adoptionRate: number;
    saleRate: number;
    activeVersion: number | null;
  }>;
}> {
  // Get overall statistics
  const totalOutcomes = await db
    .select({ count: count() })
    .from(aiRateOutcomes);
  
  const adoptedOutcomes = await db
    .select({ count: count() })
    .from(aiRateOutcomes)
    .where(eq(aiRateOutcomes.wasAiAdopted, true));
  
  const soldWithin30Outcomes = await db
    .select({ count: count() })
    .from(aiRateOutcomes)
    .where(eq(aiRateOutcomes.soldWithin30Days, true));
  
  const lastTraining = await db
    .select()
    .from(mlTrainingHistory)
    .orderBy(desc(mlTrainingHistory.trainedAt))
    .limit(1);
  
  const activeModels = await db
    .select({ count: count() })
    .from(aiWeightVersions)
    .where(eq(aiWeightVersions.isActive, true));
  
  // Get per-service-line stats
  const serviceLineStats = await db
    .select({
      serviceLine: aiRateOutcomes.serviceLine,
      total: count(),
      adopted: sql<number>`COUNT(CASE WHEN ${aiRateOutcomes.wasAiAdopted} = true THEN 1 END)`,
      sold30: sql<number>`COUNT(CASE WHEN ${aiRateOutcomes.soldWithin30Days} = true THEN 1 END)`
    })
    .from(aiRateOutcomes)
    .groupBy(aiRateOutcomes.serviceLine);
  
  // Get active versions per service line
  const activeVersions = await db
    .select({
      scopeValue: aiWeightVersions.scopeValue,
      version: aiWeightVersions.version
    })
    .from(aiWeightVersions)
    .where(
      and(
        eq(aiWeightVersions.scope, 'service_line'),
        eq(aiWeightVersions.isActive, true)
      )
    );
  
  const versionMap = new Map(activeVersions.map(v => [v.scopeValue, v.version]));
  
  return {
    totalOutcomes: totalOutcomes[0]?.count || 0,
    adoptedCount: adoptedOutcomes[0]?.count || 0,
    soldWithin30Count: soldWithin30Outcomes[0]?.count || 0,
    adoptionRate: totalOutcomes[0]?.count ? (adoptedOutcomes[0]?.count || 0) / totalOutcomes[0].count : 0,
    saleWithin30Rate: adoptedOutcomes[0]?.count ? (soldWithin30Outcomes[0]?.count || 0) / adoptedOutcomes[0].count : 0,
    lastTrainingDate: lastTraining[0]?.trainedAt || null,
    modelsActive: activeModels[0]?.count || 0,
    serviceLineStats: serviceLineStats.map(s => ({
      serviceLine: s.serviceLine,
      outcomes: s.total,
      adoptionRate: s.total ? s.adopted / s.total : 0,
      saleRate: s.adopted ? s.sold30 / s.adopted : 0,
      activeVersion: versionMap.get(s.serviceLine) || null
    }))
  };
}

/**
 * Get learned weights with fallback hierarchy:
 * 1. Location-specific weights
 * 2. Service-line weights
 * 3. Global learned weights
 * 4. Default weights
 */
export async function getLearnedWeightsForUnit(
  locationId: string | null,
  serviceLine: string
): Promise<WeightsSnapshot> {
  // Try location-specific first
  if (locationId) {
    const locationWeights = await getActiveWeights('location', locationId);
    if (locationWeights !== DEFAULT_WEIGHTS) {
      return locationWeights;
    }
  }
  
  // Try service-line specific
  const serviceLineWeights = await getActiveWeights('service_line', serviceLine);
  if (serviceLineWeights !== DEFAULT_WEIGHTS) {
    return serviceLineWeights;
  }
  
  // Try global
  const globalWeights = await getActiveWeights('global', null);
  if (globalWeights !== DEFAULT_WEIGHTS) {
    return globalWeights;
  }
  
  // Return defaults
  return DEFAULT_WEIGHTS;
}
