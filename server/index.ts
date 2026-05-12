import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { backfillRoomTypes } from "./backfillRoomTypes";
import { resumeInterruptedJobs } from "./services/competitorRateJobService";
import { db } from "./db";
import { rentRollData } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

// Prevent unhandled promise rejections / exceptions from crashing the process.
// Neon serverless drops idle connections (code 57P01) which can surface as
// unhandled rejections if not caught at the call site.
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection (non-fatal):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception (non-fatal):', err.message);
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Idempotent migration: ensure lat/lng columns exist on competitive_survey_data.
  // These were added to the Drizzle schema in Task #138 but never applied to the live DB.
  try {
    await db.execute(sql`
      ALTER TABLE competitive_survey_data
        ADD COLUMN IF NOT EXISTS lat real,
        ADD COLUMN IF NOT EXISTS lng real
    `);
    log("[migration] competitive_survey_data lat/lng columns ensured");
  } catch (migErr) {
    log(`[migration] lat/lng column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: create care_level_rates table if it does not exist.
  // Defined in shared/schema.ts but never applied to the live database.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS care_level_rates (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id varchar NOT NULL REFERENCES locations(id),
        service_line text NOT NULL,
        level2_rate real NOT NULL,
        client_id varchar NOT NULL REFERENCES clients(id),
        created_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS care_level_rates_loc_sl_idx
        ON care_level_rates (client_id, location_id, service_line)
    `);
    log("[migration] care_level_rates table ensured");
  } catch (migErr) {
    log(`[migration] care_level_rates migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration (Task #212 / Task #214): purge stale Rivertown Ridge AL Companion
  // rows from competitive_survey_data and clear matching stale competitor references in
  // rent_roll_data. The source CSV has a blank AL_StudioCompanionRoomRate for Rivertown
  // Ridge, so any such row is invalid regardless of the stored rate value.
  //
  // Fixes over Task #212:
  //   - Use Number(row.cnt) instead of ::int cast — Neon serverless driver returns COUNT(*)
  //     as a JavaScript string (bigint), so the old cast produced a string comparison that
  //     always evaluated unexpectedly, making the migration a silent no-op.
  //   - Drop the ABS(monthly_rate_avg - 1475) < 1 rate-value guard from both the check and
  //     the DELETE/UPDATE — any Rivertown Ridge AL Companion row is stale regardless of what
  //     value happened to be stored, so name-based matching is sufficient and more robust.
  //   - Always emit a [migration] log line in every code path (deleted, cleared, nothing).
  //
  // Guards make this a no-op on subsequent restarts once both tables are clean.
  try {
    type CountRow = { cnt: string | number };
    type UploadMonthRow = { upload_month: string };

    const surveyCheckResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM competitive_survey_data
      WHERE client_id = 'trilogy'
        AND competitor_name ILIKE '%Rivertown Ridge%'
        AND room_type = 'Companion'
    `);
    const staleSurveyCount = Number((surveyCheckResult.rows[0] as CountRow).cnt);

    const rentRollCheckResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM rent_roll_data
      WHERE client_id = 'trilogy'
        AND service_line = 'AL'
        AND room_type = 'Companion'
        AND competitor_name ILIKE '%Rivertown Ridge%'
    `);
    const staleRentRollCount = Number((rentRollCheckResult.rows[0] as CountRow).cnt);

    const needsCleanup = staleSurveyCount > 0 || staleRentRollCount > 0;

    if (staleSurveyCount > 0) {
      await db.execute(sql`
        DELETE FROM competitive_survey_data
        WHERE client_id = 'trilogy'
          AND competitor_name ILIKE '%Rivertown Ridge%'
          AND room_type = 'Companion'
      `);
      log(`[migration] Deleted ${staleSurveyCount} stale Rivertown Ridge AL Companion competitive_survey_data row(s).`);
    } else {
      log('[migration] No stale Rivertown Ridge AL Companion rows found in competitive_survey_data — nothing to purge.');
    }

    if (staleRentRollCount > 0) {
      await db.execute(sql`
        UPDATE rent_roll_data
        SET competitor_rate = NULL,
            competitor_final_rate = NULL,
            competitor_name = NULL,
            competitor_base_rate = NULL,
            competitor_weight = NULL,
            competitor_care_level2_adjustment = NULL,
            competitor_med_management_adjustment = NULL,
            competitor_adjustment_explanation = NULL
        WHERE client_id = 'trilogy'
          AND service_line = 'AL'
          AND room_type = 'Companion'
          AND competitor_name ILIKE '%Rivertown Ridge%'
      `);
      log(`[migration] Cleared stale Rivertown Ridge competitor fields on ${staleRentRollCount} rent_roll_data row(s).`);
    } else {
      log('[migration] No stale Rivertown Ridge competitor fields found in rent_roll_data — nothing to clear.');
    }

    if (needsCleanup) {
      // Re-run competitor rate matching asynchronously (after server is listening) so the
      // affected units receive the correct neutral competitor signal. processAllUnitsForCompetitorRates
      // filters rent_roll_data by upload_month, so we use the most recent rent roll month
      // (not the survey month) to capture the latest data (e.g. Byron Center 2026-03).
      setTimeout(async () => {
        try {
          const { processAllUnitsForCompetitorRates } = await import('./services/competitorRateMatching');
          const latestMonthResult = await db.execute(sql`
            SELECT upload_month FROM rent_roll_data
            WHERE client_id = 'trilogy'
            ORDER BY upload_month DESC
            LIMIT 1
          `);
          const latestUploadMonth = latestMonthResult.rows.length > 0
            ? (latestMonthResult.rows[0] as UploadMonthRow).upload_month
            : null;
          if (!latestUploadMonth) {
            log('[migration] No rent roll data found for trilogy client — skipping competitor re-matching.');
            return;
          }
          log(`[migration] Re-running competitor matching for trilogy / uploadMonth=${latestUploadMonth}...`);
          const stats = await processAllUnitsForCompetitorRates(latestUploadMonth, 'trilogy');
          log(`[migration] ✅ Competitor re-matching complete — processed=${stats.processed} updated=${stats.updated} errors=${stats.errors}`);
        } catch (matchErr) {
          log(`[migration] ❌ Competitor re-matching failed (non-fatal): ${matchErr instanceof Error ? matchErr.message : String(matchErr)}`);
        }
      }, 8000); // 8-second delay — after server starts listening
    }
  } catch (purgeErr) {
    log(`[migration] Rivertown Ridge AL Companion purge failed (non-fatal): ${purgeErr instanceof Error ? purgeErr.message : String(purgeErr)}`);
  }

  // Idempotent migration (Task #224): Fix stale care_level_2_rate for Rivertown Ridge AL.
  // The source survey file shows $925 for care Level 2, but the live DB still holds $1,150
  // from before Task #222's reimport ran only in the task agent's isolated environment.
  // Also verifies the medication_management_fee matches the survey value of $350.
  try {
    type RivCheckRow = { care_level_2_rate: number | null; medication_management_fee: number | null };

    // Fix care_level_2_rate — only updates rows that still have the wrong value.
    // Use RETURNING id so affected row count is deterministic from rows.length, without
    // relying on the driver-specific rowCount property.
    const rivUpdateResult = await db.execute(sql`
      UPDATE competitive_survey_data
      SET care_level_2_rate = 925
      WHERE client_id = 'trilogy'
        AND competitor_name ILIKE '%Rivertown Ridge%'
        AND competitor_type = 'AL'
        AND care_level_2_rate != 925
      RETURNING id
    `);
    const rivUpdatedCount = rivUpdateResult.rows.length;

    if (rivUpdatedCount > 0) {
      log(`[migration] Fixed Rivertown Ridge AL care_level_2_rate: ${rivUpdatedCount} row(s) updated → $925`);
    } else {
      log('[migration] Rivertown Ridge AL care_level_2_rate already correct — nothing to update.');
    }

    // Idempotently correct medication_management_fee (survey file shows $350).
    // Use RETURNING id for deterministic count, same pattern as care_level_2_rate fix above.
    const rivMedUpdateResult = await db.execute(sql`
      UPDATE competitive_survey_data
      SET medication_management_fee = 350
      WHERE client_id = 'trilogy'
        AND competitor_name ILIKE '%Rivertown Ridge%'
        AND competitor_type = 'AL'
        AND (medication_management_fee IS NULL OR ABS(medication_management_fee - 350) >= 1)
      RETURNING id
    `);
    const rivMedUpdatedCount = rivMedUpdateResult.rows.length;
    if (rivMedUpdatedCount > 0) {
      log(`[migration] Fixed Rivertown Ridge AL medication_management_fee: ${rivMedUpdatedCount} row(s) updated → $350`);
    } else {
      log('[migration] Rivertown Ridge AL medication_management_fee already correct — nothing to update.');
    }

    // Post-check: log current values to confirm both fields are correct
    const rivCheckResult = await db.execute(sql`
      SELECT care_level_2_rate, medication_management_fee
      FROM competitive_survey_data
      WHERE client_id = 'trilogy'
        AND competitor_name ILIKE '%Rivertown Ridge%'
        AND competitor_type = 'AL'
      LIMIT 1
    `);
    if (rivCheckResult.rows.length > 0) {
      const row = rivCheckResult.rows[0] as RivCheckRow;
      log(`[migration] Rivertown Ridge AL post-check: care_level_2_rate=$${row.care_level_2_rate} medication_management_fee=$${row.medication_management_fee}`);
    }

    // If either field was corrected, re-run competitor rate matching for trilogy so Byron
    // Center AL units immediately reflect the corrected values without manual re-import.
    if (rivUpdatedCount > 0 || rivMedUpdatedCount > 0) {
      setTimeout(async () => {
        try {
          type UploadMonthRow2 = { upload_month: string };
          const { processAllUnitsForCompetitorRates } = await import('./services/competitorRateMatching');
          const latestMonthResult = await db.execute(sql`
            SELECT upload_month FROM rent_roll_data
            WHERE client_id = 'trilogy'
            ORDER BY upload_month DESC
            LIMIT 1
          `);
          const latestUploadMonth = latestMonthResult.rows.length > 0
            ? (latestMonthResult.rows[0] as UploadMonthRow2).upload_month
            : null;
          if (!latestUploadMonth) {
            log('[migration] No rent roll data found for trilogy client — skipping competitor re-matching for care_level_2_rate fix.');
            return;
          }
          log(`[migration] Re-running competitor matching for trilogy / uploadMonth=${latestUploadMonth} (care_level_2_rate fix)...`);
          const stats = await processAllUnitsForCompetitorRates(latestUploadMonth, 'trilogy');
          log(`[migration] ✅ Competitor re-matching complete (care_level_2_rate fix) — processed=${stats.processed} updated=${stats.updated} errors=${stats.errors}`);

          // Spot-check: log competitor rate for one Byron Center AL Studio unit matched
          // to Rivertown Ridge, to confirm the corrected care_level_2_rate flows through.
          try {
            type SpotCheckRow = { room_number: string; competitor_name: string | null; competitor_rate: number | null; competitor_base_rate: number | null; competitor_care_level2_adjustment: number | null; competitor_final_rate: number | null };
            const spotResult = await db.execute(sql`
              SELECT room_number, competitor_name, competitor_rate, competitor_base_rate,
                     competitor_care_level2_adjustment, competitor_final_rate
              FROM rent_roll_data
              WHERE client_id = 'trilogy'
                AND location ILIKE '%Byron Center%'
                AND service_line = 'AL'
                AND room_type = 'Studio'
                AND competitor_name ILIKE '%Rivertown Ridge%'
              LIMIT 1
            `);
            if (spotResult.rows.length > 0) {
              const spot = spotResult.rows[0] as SpotCheckRow;
              log(`[migration] Spot-check Byron Center AL Studio (Rivertown Ridge) unit=${spot.room_number} competitor_rate=$${spot.competitor_rate} base_rate=$${spot.competitor_base_rate} care_L2_adj=$${spot.competitor_care_level2_adjustment} final_rate=$${spot.competitor_final_rate}`);
            } else {
              log('[migration] Spot-check: No Byron Center AL Studio units matched to Rivertown Ridge found — competitor re-matching may not have assigned Rivertown Ridge as top comp.');
            }
          } catch (spotErr) {
            log(`[migration] Spot-check failed (non-fatal): ${spotErr instanceof Error ? spotErr.message : String(spotErr)}`);
          }
        } catch (matchErr) {
          log(`[migration] ❌ Competitor re-matching failed (non-fatal, care_level_2_rate fix): ${matchErr instanceof Error ? matchErr.message : String(matchErr)}`);
        }
      }, 8000); // 8-second delay — after server starts listening
    }
  } catch (rivErr) {
    log(`[migration] Rivertown Ridge AL care_level_2_rate fix failed (non-fatal): ${rivErr instanceof Error ? rivErr.message : String(rivErr)}`);
  }

  const server = await registerRoutes(app);

  // Run room type normalization backfill asynchronously in background
  // This won't block server startup
  setTimeout(async () => {
    try {
      log("Starting room type normalization backfill (background task)...");
      const result = await backfillRoomTypes();
      if (result.success) {
        log(`Room type backfill completed: ${result.totalUpdated} types updated in ${result.duration}ms`);
      } else {
        log(`Room type backfill had errors: ${result.totalErrors} errors in ${result.duration}ms`);
      }
    } catch (error) {
      log(`Room type backfill error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, 5000); // Start backfill 5 seconds after server starts

  // Log Alpha Vantage API key availability at startup
  const avKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (avKey) {
    log(`[Market Data] Alpha Vantage API key configured (${avKey.substring(0, 4)}...)`);
  } else {
    log("[Market Data] Alpha Vantage API key NOT found — market benchmark lines will be unavailable");
  }

  // Resume any interrupted competitor rate jobs after server restart
  setTimeout(async () => {
    try {
      log("Checking for interrupted competitor rate jobs...");
      await resumeInterruptedJobs();
    } catch (error) {
      log(`Error resuming competitor rate jobs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, 3000); // Check for interrupted jobs 3 seconds after server starts

  // Background job: geocode any locations that have an address but null lat/lng.
  // Runs after the server is already serving so it never blocks startup.
  // Rate-limited internally (1.1 s per Nominatim request).
  setTimeout(async () => {
    try {
      const { clearStaleGeocodeForAffectedLocations, geocodeMissingLocations } = await import('./geocoding');

      // Task #189: clear city-level coordinates for the 9 affected locations so
      // they get re-geocoded with the new zip-inclusive address string.
      const cleared = await clearStaleGeocodeForAffectedLocations();
      if (cleared > 0) {
        log(`[startup] Cleared stale city-level coords for ${cleared} location(s) — will re-geocode with zip codes.`);
      }

      const result = await geocodeMissingLocations();
      if (result.updated > 0 || result.failed > 0) {
        log(`[startup] Geocoded missing locations: ${result.updated} updated, ${result.failed} failed, ${result.skipped} skipped (no address).`);
      }
    } catch (err) {
      log(`[startup] Background geocode-missing-locations failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 6000); // 6-second delay — after demo seed and job resume have started

  // Background job: resume any interrupted geocoding job for competitor surveys,
  // or start fresh if rows still need geocoding.
  // After geocoding, backfill distanceMiles for any rows that have lat/lng but
  // no distance yet — this is the value used by the distance-based competitor
  // fallback in getTopSurveyCompetitorForLocation.
  // This ensures progress is never lost across server restarts.
  setTimeout(async () => {
    try {
      const { geocodeMissingCompetitorSurveys, getLatestGeocodingJob, backfillSurveyDistances, getSurveyGeocodingCoverage } = await import('./geocoding');

      // Check for an interrupted (running) job from before the last restart
      const latestJob = await getLatestGeocodingJob('competitor_surveys');
      if (latestJob && latestJob.status === 'running') {
        log(`[startup] Resuming interrupted geocoding job ${latestJob.id} (was processing ${latestJob.processedRows}/${latestJob.totalRows} rows)…`);
        const result = await geocodeMissingCompetitorSurveys(latestJob.id);
        if (result.updated > 0 || result.failed > 0) {
          log(`[startup] Resumed geocoding: ${result.updated} updated, ${result.failed} failed, ${result.skipped} skipped.`);
        }
      } else {
        // No interrupted job — run fresh geocoding for any rows still missing coordinates
        const result = await geocodeMissingCompetitorSurveys();
        if (result.updated > 0 || result.failed > 0) {
          log(`[startup] Geocoded missing competitor surveys: ${result.updated} updated, ${result.failed} failed, ${result.skipped} skipped (no address).`);
        }
      }

      // Backfill distanceMiles for any already-geocoded rows that are still missing distance.
      // This handles rows geocoded before the distanceMiles computation was added.
      try {
        const backfilled = await backfillSurveyDistances();
        if (backfilled > 0) {
          log(`[startup] Backfilled distanceMiles for ${backfilled} survey rows.`);
        }
      } catch (bfErr) {
        log(`[startup] Distance backfill non-fatal error: ${bfErr instanceof Error ? bfErr.message : String(bfErr)}`);
      }

      // Log geocoding coverage so operators can confirm the distance fallback has data.
      try {
        const coverage = await getSurveyGeocodingCoverage();
        log(`[startup] Survey geocoding coverage: ${coverage.coveragePct}% geocoded, ${coverage.distancePct}% have distance_miles (${coverage.distanceCalculated}/${coverage.total} rows).`);
      } catch (covErr) {
        log(`[startup] Coverage check non-fatal error: ${covErr instanceof Error ? covErr.message : String(covErr)}`);
      }
    } catch (err) {
      log(`[startup] Background geocode-missing-competitor-surveys failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 10000); // 10-second delay — starts after location geocoding job has begun

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Start listening immediately so health checks pass before background work runs.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });

  // Seed demo data in the background after the server is already accepting requests.
  // On first cold start the seed takes ~15 s; on subsequent restarts the
  // COUNT query short-circuits in <100 ms. Either way it must not block server startup.
  setTimeout(async () => {
    try {
      const countResult = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(rentRollData)
        .where(eq(rentRollData.clientId, 'demo'));
      const demoCount = countResult[0]?.count ?? 0;
      if (demoCount === 0) {
        log("[demo] No rent roll data for demo client — seeding now (this only happens once)...");
        const { generateDemoData } = await import('./seedDemoData');
        const seedResult = await generateDemoData();
        log(`[demo] Seeded: ${seedResult.locations} locations, ${seedResult.rentRoll} rent roll, ${seedResult.competitive} competitive, ${seedResult.inquiry} inquiry records`);
      } else {
        log(`[demo] Demo rent roll data present (${demoCount} rows) — skipping seed`);
      }
    } catch (seedError) {
      log(`[demo] Auto-seed error (non-fatal): ${seedError instanceof Error ? seedError.message : String(seedError)}`);
    }
  }, 1000); // 1-second grace period after server starts listening
})();
