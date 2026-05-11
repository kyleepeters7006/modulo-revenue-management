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
