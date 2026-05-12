/**
 * One-time backfill script: re-imports existing competitive survey data
 * using the corrected column logic from Task #202, then re-runs competitor
 * rate matching so rent_roll_data.competitor_adjusted_rate reflects the fixes.
 *
 * Usage:
 *   npx tsx server/scripts/reimport_survey.ts [clientId] [surveyMonth]
 *
 * Examples:
 *   npx tsx server/scripts/reimport_survey.ts demo 2026-05
 *   npx tsx server/scripts/reimport_survey.ts trilogy 2025-12
 *   npx tsx server/scripts/reimport_survey.ts (uses DB to derive latest month per client)
 */

import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { competitiveSurveyData } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import { importCompetitiveSurveyExcel } from '../dataImport';
import { processAllUnitsForCompetitorRates } from '../services/competitorRateMatching';

async function run(clientId: string, surveyMonth?: string) {
  console.log(`\n=== Reimport competitive survey for clientId=${clientId} ===`);

  const assetsDir = path.resolve('attached_assets');
  const allFiles = fs.readdirSync(assetsDir);
  const surveyFiles = allFiles
    .filter(f => {
      const lower = f.toLowerCase();
      return lower.includes('competitive survey data') &&
        lower.endsWith('.xlsx') &&
        !lower.includes('mapping') &&
        !lower.includes('template');
    })
    .map(f => ({ name: f, mtime: fs.statSync(path.join(assetsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (surveyFiles.length === 0) {
    console.error('No competitive survey data .xlsx file found in attached_assets/');
    process.exit(1);
  }

  const surveyFile = surveyFiles[0];
  console.log(`Survey file: ${surveyFile.name}`);

  if (!surveyMonth) {
    const latestRows = await db
      .select({ surveyMonth: competitiveSurveyData.surveyMonth })
      .from(competitiveSurveyData)
      .where(eq(competitiveSurveyData.clientId, clientId))
      .orderBy(desc(competitiveSurveyData.surveyMonth))
      .limit(1);

    if (latestRows.length === 0) {
      console.error(`No existing competitive_survey_data for clientId=${clientId}. Pass surveyMonth explicitly.`);
      process.exit(1);
    }
    surveyMonth = latestRows[0].surveyMonth;
    console.log(`Derived surveyMonth from DB: ${surveyMonth}`);
  } else {
    console.log(`Using explicit surveyMonth: ${surveyMonth}`);
  }

  const fileBuffer = fs.readFileSync(path.join(assetsDir, surveyFile.name));
  console.log('Running importCompetitiveSurveyExcel...');
  const importResult = await importCompetitiveSurveyExcel(fileBuffer, surveyMonth, clientId);

  console.log('Import complete:', {
    total: importResult.totalRecords,
    inserted: importResult.successfulImports,
    failed: importResult.failedImports,
    columnWarning: importResult.columnWarning,
    firstErrors: importResult.errors.slice(0, 5),
  });

  if (importResult.successfulImports === 0) {
    console.error('Import produced zero rows — check the survey file format. Aborting rate matching.');
    process.exit(1);
  }

  console.log('Running processAllUnitsForCompetitorRates...');
  const matchingStats = await processAllUnitsForCompetitorRates(surveyMonth, clientId);

  console.log('Matching complete:', {
    processed: matchingStats.processed,
    updated: matchingStats.updated,
    errors: matchingStats.errors,
  });

  console.log(`\n✅ Done: clientId=${clientId}, surveyMonth=${surveyMonth}`);
}

const [, , clientArg, monthArg] = process.argv;
const clientsToProcess = clientArg ? [clientArg] : ['demo', 'trilogy'];

(async () => {
  for (const clientId of clientsToProcess) {
    await run(clientId, monthArg);
  }
  console.log('\n✅ All done — closing DB connection');
  process.exit(0);
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
