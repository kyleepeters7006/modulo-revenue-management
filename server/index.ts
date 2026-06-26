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

  // Idempotent migration: create campus_metrics table (flexible key-value for rule designer).
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS campus_metrics (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id varchar NOT NULL REFERENCES locations(id),
        service_line text,
        room_type text,
        metric_name text NOT NULL,
        value real,
        client_id varchar NOT NULL DEFAULT 'demo' REFERENCES clients(id),
        calculated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS campus_metrics_loc_idx
        ON campus_metrics (client_id, location_id)
    `);
    log("[migration] campus_metrics table ensured");
  } catch (migErr) {
    log(`[migration] campus_metrics migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: create ih_street_variance table.
  // Stores pre-calculated IH-to-Street rate variance per campus per service line.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ih_street_variance (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id varchar NOT NULL REFERENCES locations(id),
        service_line text NOT NULL,
        variance_pct real,
        avg_in_house_monthly real,
        avg_street_monthly real,
        unit_count integer DEFAULT 0,
        client_id varchar NOT NULL DEFAULT 'demo' REFERENCES clients(id),
        calculated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ih_street_variance_client_loc_sl_idx
        ON ih_street_variance (client_id, location_id, service_line)
    `);
    log("[migration] ih_street_variance table ensured");
  } catch (migErr) {
    log(`[migration] ih_street_variance migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure source_room_type column exists on rent_roll_data.
  // Added to shared/schema.ts (Task #294) but never applied to the live DB, causing
  // POST /api/publish to throw "TypeError: Cannot convert undefined or null to object"
  // and return {"error":"Failed to publish CSV"}.
  try {
    await db.execute(sql`
      ALTER TABLE rent_roll_data
        ADD COLUMN IF NOT EXISTS source_room_type text
    `);
    log("[migration] rent_roll_data source_room_type column ensured");
  } catch (migErr) {
    log(`[migration] source_room_type column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure rule_rate_calculated_at column exists on rent_roll_data.
  // Added to shared/schema.ts to stamp calculation time on each ruleAdjustedRate write so
  // the CSV export can exclude stale rates from scoped calculation runs.
  try {
    await db.execute(sql`
      ALTER TABLE rent_roll_data
        ADD COLUMN IF NOT EXISTS rule_rate_calculated_at timestamptz
    `);
    log("[migration] rent_roll_data rule_rate_calculated_at column ensured");
  } catch (migErr) {
    log(`[migration] rule_rate_calculated_at column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
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

  // Elasticity backfill: compute elasticity for any client that has rent_roll_data
  // but no entries in elasticity_metrics yet (e.g. Trilogy after initial data import).
  // Runs once at startup in the background — safe to repeat (idempotent upsert).
  setTimeout(async () => {
    try {
      const { pool } = await import('./db');
      const clientsRes = await pool.query<{ client_id: string }>(
        `SELECT DISTINCT rr.client_id
         FROM rent_roll_data rr
         LEFT JOIN elasticity_metrics em ON em.client_id = rr.client_id
         WHERE em.client_id IS NULL`,
      );
      if (clientsRes.rows.length === 0) {
        log('[elasticity-backfill] All clients already have elasticity data — skipping.');
        return;
      }
      const { computeAndStoreElasticity } = await import('./services/elasticityService');
      for (const { client_id } of clientsRes.rows) {
        try {
          log(`[elasticity-backfill] Computing elasticity for client=${client_id}…`);
          const result = await computeAndStoreElasticity(client_id);
          log(`[elasticity-backfill] Done for client=${client_id}: ${result.updated} segments updated.`);
        } catch (err) {
          log(`[elasticity-backfill] Failed for client=${client_id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      log(`[elasticity-backfill] Startup check failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 7000); // 7 s after startup — after room-type backfill begins

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

  // One-time migration (Task #229): Fix stale AL/MC care L2 & med mgmt rates.
  // The wrong column priority (AL/MC_MedicationManagement instead of MC_MedicationManagement)
  // was used in previous imports. This migration re-imports the competitive survey with the
  // corrected column logic and re-runs competitor rate matching for all affected clients.
  // A marker file (.local/survey_migration_229_done) prevents re-running on subsequent restarts.
  setTimeout(async () => {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const MARKER = path.resolve('.local/survey_migration_229_done');
      if (fs.existsSync(MARKER)) {
        log(`[survey-migration] Task #229 already applied — skipping.`);
        return;
      }

      const { competitiveSurveyData: csd } = await import('@shared/schema');
      const { eq, desc } = await import('drizzle-orm');
      const { importCompetitiveSurveyExcel, importCompetitiveSurveyCSV } = await import('./dataImport');
      const { processAllUnitsForCompetitorRates } = await import('./services/competitorRateMatching');

      type SurveyFileEntry = { name: string; mtime: number };
      let allDone = true;
      for (const clientId of ['demo', 'trilogy']) {
        const assetsDir = path.resolve('attached_assets');
        const surveyFiles: SurveyFileEntry[] = fs.readdirSync(assetsDir)
          .filter((f: string) => {
            const lower = f.toLowerCase();
            return lower.includes('competitive survey data') &&
              (lower.endsWith('.xlsx') || lower.endsWith('.csv')) &&
              !lower.includes('mapping') && !lower.includes('template');
          })
          .map((f: string): SurveyFileEntry => ({ name: f, mtime: fs.statSync(path.join(assetsDir, f)).mtimeMs }))
          .sort((a: SurveyFileEntry, b: SurveyFileEntry) => b.mtime - a.mtime);

        if (surveyFiles.length === 0) {
          log(`[survey-migration] clientId=${clientId} — no survey file found, skipping.`);
          allDone = false;
          continue;
        }

        const latestRows = await db
          .select({ surveyMonth: csd.surveyMonth })
          .from(csd)
          .where(eq(csd.clientId, clientId))
          .orderBy(desc(csd.surveyMonth))
          .limit(1);
        if (latestRows.length === 0) {
          log(`[survey-migration] clientId=${clientId} — no existing survey month, skipping.`);
          allDone = false;
          continue;
        }
        const surveyMonth = latestRows[0].surveyMonth;
        const surveyFile = surveyFiles[0];
        const isCsv = surveyFile.name.toLowerCase().endsWith('.csv');
        const fileBuffer = fs.readFileSync(path.join(assetsDir, surveyFile.name));
        log(`[survey-migration] clientId=${clientId} surveyMonth=${surveyMonth} — reimporting ${surveyFile.name} with corrected AL/MC column logic...`);
        const importResult = isCsv
          ? await importCompetitiveSurveyCSV(fileBuffer, surveyMonth, clientId)
          : await importCompetitiveSurveyExcel(fileBuffer, surveyMonth, clientId);
        log(`[survey-migration] clientId=${clientId} — import done: ${importResult.successfulImports} rows inserted.`);
        if (importResult.successfulImports === 0) {
          log(`[survey-migration] clientId=${clientId} — zero rows imported; skipping rate matching and not writing marker.`);
          allDone = false;
          continue;
        }
        log(`[survey-migration] clientId=${clientId} — running rate matching (awaited)...`);
        try {
          const stats = await processAllUnitsForCompetitorRates(surveyMonth, clientId);
          log(`[survey-migration] clientId=${clientId} — rate matching complete: processed=${stats.processed} updated=${stats.updated} errors=${stats.errors}`);
          if (stats.errors > 0) allDone = false;
        } catch (matchErr: unknown) {
          log(`[survey-migration] clientId=${clientId} — rate matching error: ${matchErr instanceof Error ? matchErr.message : String(matchErr)}`);
          allDone = false;
        }
      }

      if (allDone) {
        fs.writeFileSync(MARKER, new Date().toISOString());
        log(`[survey-migration] Task #229 complete — marker written to ${MARKER}. Both import and rate matching succeeded for all clients.`);
      } else {
        log(`[survey-migration] Task #229 — one or more clients failed; marker NOT written. Will retry on next restart.`);
      }
    } catch (err) {
      log(`[survey-migration] Task #229 stale-data fix failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 15000); // 15-second delay — after server is fully initialized

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
    console.error(`[Express error handler] ${status} ${message}`, err.code ? `(${err.code})` : '');
    if (!res.headersSent) {
      res.status(status).json({ message, error: message });
    }
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
  // COUNT + MAX(upload_month) query short-circuits in <100 ms.
  // We also re-seed whenever the latest demo month is behind the current calendar month,
  // so the Revenue Growth chart always has data through the present month.
  setTimeout(async () => {
    try {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const [countResult, latestMonthResult] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)::int` })
          .from(rentRollData)
          .where(eq(rentRollData.clientId, 'demo')),
        db.select({ month: sql<string>`MAX(${rentRollData.uploadMonth})` })
          .from(rentRollData)
          .where(eq(rentRollData.clientId, 'demo')),
      ]);

      const demoCount = countResult[0]?.count ?? 0;
      const latestMonth = latestMonthResult[0]?.month ?? null;

      if (demoCount === 0) {
        log("[demo] No rent roll data for demo client — seeding now...");
        const { generateDemoData } = await import('./seedDemoData');
        const seedResult = await generateDemoData();
        log(`[demo] Seeded: ${seedResult.locations} locations, ${seedResult.rentRoll} rent roll, ${seedResult.competitive} competitive, ${seedResult.inquiry} inquiry records`);
      } else if (!latestMonth || latestMonth < currentMonth) {
        // Data exists but doesn't reach the current month — re-seed so the
        // Revenue Growth chart has a complete trailing-12-month window.
        log(`[demo] Demo data stale (latest month: ${latestMonth ?? 'none'}, current: ${currentMonth}) — regenerating to include recent months...`);
        const { generateDemoData } = await import('./seedDemoData');
        const seedResult = await generateDemoData();
        log(`[demo] Re-seeded: ${seedResult.locations} locations, ${seedResult.rentRoll} rent roll, ${seedResult.competitive} competitive, ${seedResult.inquiry} inquiry records`);
      } else {
        log(`[demo] Demo rent roll data present and current (${demoCount} rows, latest: ${latestMonth}) — skipping seed`);
      }
    } catch (seedError) {
      log(`[demo] Auto-seed error (non-fatal): ${seedError instanceof Error ? seedError.message : String(seedError)}`);
    }
  }, 1000); // 1-second grace period after server starts listening
})();
