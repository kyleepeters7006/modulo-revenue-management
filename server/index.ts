import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { backfillRoomTypes } from "./backfillRoomTypes";
import { resumeInterruptedJobs } from "./services/competitorRateJobService";
import { db } from "./db";
import { rentRollData } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { storage } from "./storage";

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
// Replit terminates TLS at the proxy and forwards the original scheme. Trust
// one proxy hop so express-session can correctly emit Secure cookies in
// production while the app itself listens on HTTP.
app.set("trust proxy", 1);
// Leave the normal parser limit in place for every endpoint. The production
// sync receiver installs its own authenticated, compressed-body parser in
// server/routes.ts after this middleware is skipped for that exact path.
const productionSyncReceiverPath = "/api/admin/receive-production-sync";
app.use((req, res, next) => {
  if (req.path === productionSyncReceiverPath) return next();
  return express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: false }));

const sensitiveResponsePaths = new Set([
  "/api/auth/mfa/setup",
  "/api/auth/mfa/setup/confirm",
  "/api/auth/mfa/challenge",
  "/api/auth/mfa/recovery",
  "/api/auth/mfa/recovery/regenerate",
]);
app.use((req, res, next) => {
  const start = Date.now();
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path.startsWith("/api")) {
      let logLine = `${req.method} ${req.path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !sensitiveResponsePaths.has(req.path)) {
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

// Register the route graph before starting schema work so the listener can bind
// immediately. A deferred promise lets route initialization and API requests
// wait for the same migration barrier once the listener is accepting traffic.
(async () => {
  let resolveStartupSchemaMigrations!: () => void;
  let rejectStartupSchemaMigrations!: (error: unknown) => void;
  const startupSchemaMigrations = new Promise<void>((resolve, reject) => {
    resolveStartupSchemaMigrations = resolve;
    rejectStartupSchemaMigrations = reject;
  });

  let resolveApplicationReady!: () => void;
  let rejectApplicationReady!: (error: unknown) => void;
  const applicationReady = new Promise<void>((resolve, reject) => {
    resolveApplicationReady = resolve;
    rejectApplicationReady = reject;
  });

  const runStartupSchemaMigrations = async () => {
  let lastMigrationStartedAt = Date.now();
  const logMigration = (message: string) => {
    const duration = Date.now() - lastMigrationStartedAt;
    log(`${message} in ${duration}ms`);
    lastMigrationStartedAt = Date.now();
  };
  // Idempotent migration: ensure lat/lng columns exist on competitive_survey_data.
  // These were added to the Drizzle schema in Task #138 but never applied to the live DB.
  try {
    await db.execute(sql`
      ALTER TABLE competitive_survey_data
        ADD COLUMN IF NOT EXISTS lat real,
        ADD COLUMN IF NOT EXISTS lng real
    `);
    logMigration("[migration] competitive_survey_data lat/lng columns ensured");
  } catch (migErr) {
    logMigration(`[migration] lat/lng column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: upload history used to be global. Keep the owner
  // nullable so rows that cannot be attributed safely remain anonymous, then
  // backfill only rows whose location ownership identifies one client.
  try {
    await db.execute(sql`
      ALTER TABLE upload_history
        ADD COLUMN IF NOT EXISTS client_id varchar REFERENCES clients(id)
    `);
    await db.execute(sql`
      UPDATE upload_history h
      SET client_id = l.client_id
      FROM locations l
      WHERE h.client_id IS NULL
        AND h.location_id = l.id
        AND l.client_id IS NOT NULL
    `);
    await db.execute(sql`
      WITH candidates AS (
        SELECT h.id, MIN(l.client_id) AS client_id
        FROM upload_history h
        JOIN locations l
          ON h.location_id IS NULL
         AND h.location IS NOT NULL
         AND lower(trim(h.location)) = lower(trim(l.name))
        WHERE h.client_id IS NULL
          AND l.client_id IS NOT NULL
        GROUP BY h.id
        HAVING COUNT(DISTINCT l.client_id) = 1
      )
      UPDATE upload_history h
      SET client_id = candidates.client_id
      FROM candidates
      WHERE h.id = candidates.id
    `);
    logMigration("[migration] upload_history.client_id ensured and attributable legacy rows backfilled");
  } catch (migErr) {
    logMigration(`[migration] upload_history client ownership migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
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
    logMigration("[migration] care_level_rates table ensured");
  } catch (migErr) {
    logMigration(`[migration] care_level_rates migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
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
    logMigration("[migration] campus_metrics table ensured");
  } catch (migErr) {
    logMigration(`[migration] campus_metrics migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
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
    logMigration("[migration] ih_street_variance table ensured");
  } catch (migErr) {
    logMigration(`[migration] ih_street_variance migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: data import subsystem tables (Task: import registry/scheduling).
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS import_runs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id varchar NOT NULL DEFAULT 'demo' REFERENCES clients(id),
        dataset_type text NOT NULL,
        source text NOT NULL DEFAULT 'manual',
        scheduled_import_id varchar,
        triggered_by text,
        file_name text NOT NULL,
        file_hash text,
        period text,
        period_source text,
        mode text,
        status text NOT NULL DEFAULT 'pending',
        total_rows integer DEFAULT 0,
        valid_rows integer DEFAULT 0,
        error_rows integer DEFAULT 0,
        inserted_rows integer DEFAULT 0,
        deleted_rows integer DEFAULT 0,
        validation_report jsonb,
        error_message text,
        started_at timestamp DEFAULT now(),
        completed_at timestamp
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS import_runs_client_idx ON import_runs (client_id, dataset_type)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scheduled_imports (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id varchar NOT NULL DEFAULT 'demo' REFERENCES clients(id),
        name text NOT NULL,
        dataset_type text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        host text NOT NULL,
        port integer NOT NULL DEFAULT 22,
        username text NOT NULL,
        encrypted_password text,
        remote_path text NOT NULL,
        file_pattern text NOT NULL DEFAULT '*.csv',
        schedule_time text NOT NULL DEFAULT '06:00',
        frequency text NOT NULL DEFAULT 'daily',
        run_date text,
        day_of_week integer,
        day_of_month integer,
        delete_after_import boolean NOT NULL DEFAULT false,
        last_run_at timestamp,
        last_run_status text,
        last_run_message text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS import_notifications (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id varchar NOT NULL DEFAULT 'demo' REFERENCES clients(id),
        import_run_id varchar,
        severity text NOT NULL DEFAULT 'info',
        title text NOT NULL,
        message text NOT NULL,
        read boolean NOT NULL DEFAULT false,
        created_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS import_notifications_client_idx ON import_notifications (client_id, read)
    `);
    logMigration("[migration] data import subsystem tables ensured");
  } catch (migErr) {
    logMigration(`[migration] data import tables migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: persisted BLS benchmark snapshots and provider
  // health. Dashboard reads use these rows instead of calling the public API.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS industry_context_snapshots (
        metric_id varchar PRIMARY KEY,
        series_id varchar NOT NULL,
        value real NOT NULL,
        as_of text NOT NULL,
        period text NOT NULL,
        period_name text NOT NULL,
        observation_year integer,
        observed_at timestamp NOT NULL,
        revision_count integer NOT NULL DEFAULT 0,
        previous_value real,
        last_revision_at timestamp
      )
    `);
    await db.execute(sql`
      ALTER TABLE industry_context_snapshots
        ADD COLUMN IF NOT EXISTS observation_year integer
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS industry_context_refresh_state (
        id varchar PRIMARY KEY,
        last_attempt_at timestamp,
        last_success_at timestamp,
        last_error text,
        consecutive_failures integer NOT NULL DEFAULT 0,
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      INSERT INTO industry_context_refresh_state (id)
      VALUES ('bls')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS industry_context_overrides (
        client_id varchar NOT NULL,
        metric_id varchar NOT NULL,
        payload jsonb NOT NULL,
        updated_by varchar,
        updated_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (client_id, metric_id)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS industry_context_assets (
        client_id varchar NOT NULL,
        asset_id varchar NOT NULL,
        mime_type varchar NOT NULL,
        image_data bytea NOT NULL,
        updated_by varchar,
        updated_at timestamp NOT NULL DEFAULT now(),
        PRIMARY KEY (client_id, asset_id)
      )
    `);
    logMigration("[migration] industry context benchmark tables ensured");
  } catch (migErr) {
    logMigration(`[migration] industry context migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: census capacity reference.
  // Holds the client's own census-report capacity by division/department purely as a
  // tie-out against our derived numbers. It never feeds pricing or Total Units —
  // room_type_occupancy_history remains the single source of truth for capacity.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS census_capacity_reference (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id varchar NOT NULL,
        year integer NOT NULL,
        month integer NOT NULL,
        as_of_date text,
        division text NOT NULL,
        department text NOT NULL,
        service_line text NOT NULL,
        available_beds integer NOT NULL DEFAULT 0,
        available_units integer NOT NULL DEFAULT 0,
        source_file text,
        imported_at timestamp DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS census_capacity_reference_unique_idx
        ON census_capacity_reference (client_id, year, month, division, department)
    `);
    logMigration("[migration] census_capacity_reference table ensured");
  } catch (migErr) {
    logMigration(`[migration] census_capacity_reference migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
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
    logMigration("[migration] rent_roll_data source_room_type column ensured");
  } catch (migErr) {
    logMigration(`[migration] source_room_type column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Keep blank Days Vacant values distinct from a reported zero. Planning
  // signals only trust rows whose importer recorded this provenance bit.
  try {
    await db.execute(sql`
      ALTER TABLE rent_roll_data
        ADD COLUMN IF NOT EXISTS days_vacant_provided boolean NOT NULL DEFAULT false
    `);
    await db.execute(sql`
      ALTER TABLE rent_roll_history
        ADD COLUMN IF NOT EXISTS days_vacant_provided boolean NOT NULL DEFAULT false
    `);
    logMigration("[migration] rent_roll_data and rent_roll_history days_vacant_provided columns ensured");
  } catch (migErr) {
    logMigration(`[migration] days_vacant_provided column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Preserve the raw move-in date whenever an administrator repairs the
  // normalized value used by turnover inference. The audit table records each
  // repair, while these columns keep the source value beside the row.
  try {
    await db.execute(sql.raw(`
      ALTER TABLE rent_roll_data
        ADD COLUMN IF NOT EXISTS move_in_date_source text
    `));
    await db.execute(sql.raw(`
      ALTER TABLE rent_roll_history
        ADD COLUMN IF NOT EXISTS move_in_date_source text
    `));
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS rent_roll_move_in_date_repairs (
        id                 varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id          text NOT NULL,
        upload_month       text NOT NULL,
        source_table       text NOT NULL CHECK (source_table IN ('rent_roll_data', 'rent_roll_history')),
        source_row_id      varchar NOT NULL,
        location           text,
        room_number        text,
        service_line       text,
        source_value       text NOT NULL,
        repaired_value     text NOT NULL,
        repaired_by        text,
        repaired_at        timestamptz NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS rent_roll_move_in_date_repairs_scope_idx
        ON rent_roll_move_in_date_repairs (client_id, upload_month, repaired_at DESC)
    `));
    logMigration("[migration] historical rent-roll move-in date repair columns and audit table ensured");
  } catch (migErr) {
    logMigration(`[migration] historical rent-roll move-in date repair migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure rule_rate_calculated_at column exists on rent_roll_data.
  // Added to shared/schema.ts to stamp calculation time on each ruleAdjustedRate write so
  // the CSV export can exclude stale rates from scoped calculation runs.
  try {
    await db.execute(sql`
      ALTER TABLE rent_roll_data
        ADD COLUMN IF NOT EXISTS rule_rate_calculated_at timestamptz
    `);
    logMigration("[migration] rent_roll_data rule_rate_calculated_at column ensured");
  } catch (migErr) {
    logMigration(`[migration] rule_rate_calculated_at column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure room_type_groupings table exists. Maps each
  // client's raw source_room_type (per location + service line) to the client's
  // official Room Type Grouping (from their pricing spreadsheets) so reference
  // data can display groupings that match the client's own reporting.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS room_type_groupings (
        client_id text NOT NULL,
        location text NOT NULL,
        service_line text NOT NULL,
        source_room_type text NOT NULL,
        group_name text NOT NULL,
        PRIMARY KEY (client_id, location, service_line, source_room_type)
      )
    `);
    logMigration("[migration] room_type_groupings table ensured");
  } catch (migErr) {
    logMigration(`[migration] room_type_groupings migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure client_id column exists on adjustment_rules.
  // Active rules remain global across clients by design (client_id NULL), but
  // portfolio-wide historical strategy records (no location link) must be scoped
  // to the client whose pricing files they were derived from, to prevent
  // cross-tenant visibility in Pricing History.
  try {
    await db.execute(sql`
      ALTER TABLE adjustment_rules
        ADD COLUMN IF NOT EXISTS client_id text
    `);
    // Backfill: all existing location-less historical strategy records were
    // derived from Trilogy pricing spreadsheets (Apr 26 / Jul 26 imports).
    await db.execute(sql`
      UPDATE adjustment_rules
      SET client_id = 'trilogy'
      WHERE client_id IS NULL AND is_historical IS TRUE AND location_id IS NULL
    `);
    logMigration("[migration] adjustment_rules.client_id ensured");
  } catch (migErr) {
    logMigration(`[migration] adjustment_rules.client_id migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: location names are unique per client, not globally.
  // Two tenants may legitimately operate campuses with the same name, so the
  // old global unique constraint on locations.name must be replaced with a
  // composite (client_id, name) unique index.
  try {
    await db.execute(sql`
      ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_name_unique
    `);
    await db.execute(sql`
      ALTER TABLE locations DROP CONSTRAINT IF EXISTS locations_name_key
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS locations_client_name_unique
        ON locations (client_id, name)
    `);
    logMigration("[migration] locations (client_id, name) unique index ensured");
  } catch (migErr) {
    logMigration(`[migration] locations unique index migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure users.username has a unique constraint.
  // The Drizzle schema declares .unique() which generates the name
  // users_username_unique, but older DB instances may have users_username_key
  // from a raw ALTER TABLE. Normalise to the Drizzle-expected name so
  // drizzle-kit push stays a no-op and never prompts interactively.
  try {
    await db.execute(sql`
      DO $$
      BEGIN
        -- Drop the Postgres-auto-named variant if it exists
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'users'
            AND constraint_name = 'users_username_key'
            AND constraint_type = 'UNIQUE'
        ) THEN
          ALTER TABLE users DROP CONSTRAINT users_username_key;
        END IF;
        -- Add the Drizzle-named constraint if missing
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'users'
            AND constraint_name = 'users_username_unique'
            AND constraint_type = 'UNIQUE'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
        END IF;
      END $$
    `);
    logMigration("[migration] users.username unique constraint ensured");
  } catch (migErr) {
    logMigration(`[migration] users.username unique constraint migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure is_historical column exists on adjustment_rules.
  // Historical rules record past pricing changes (e.g. imported spreadsheets) and are
  // never applied to current rate calculations.
  try {
    await db.execute(sql`
      ALTER TABLE adjustment_rules
        ADD COLUMN IF NOT EXISTS is_historical boolean DEFAULT false
    `);
    logMigration("[migration] adjustment_rules is_historical column ensured");
  } catch (migErr) {
    logMigration(`[migration] is_historical column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: proposed rules are reviewable but must not enter
  // pricing until the explicit implementation action is taken. Existing rows
  // intentionally remain NULL/compatible rather than being backfilled with a
  // made-up implementation timestamp.
  try {
    await db.execute(sql`
      ALTER TABLE adjustment_rules
        ADD COLUMN IF NOT EXISTS client_id text
    `);
    await db.execute(sql`
      ALTER TABLE adjustment_rules
        ADD COLUMN IF NOT EXISTS lifecycle_status text DEFAULT 'implemented'
    `);
    await db.execute(sql`
      ALTER TABLE adjustment_rules
        ADD COLUMN IF NOT EXISTS implemented_at timestamptz
    `);
    logMigration("[migration] adjustment_rules lifecycle columns ensured");
  } catch (migErr) {
    logMigration(`[migration] adjustment_rules lifecycle migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: ensure notes column exists on adjustment_rules
  // (free-form user note shown/edited in the Reference Data rule columns).
  try {
    await db.execute(sql`
      ALTER TABLE adjustment_rules
        ADD COLUMN IF NOT EXISTS notes text
    `);
    logMigration("[migration] adjustment_rules notes column ensured");
  } catch (migErr) {
    logMigration(`[migration] notes column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: cache of the last AI rule-suggestion run per client so
  // suggestions survive page reloads without re-running the (slow) AI call.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_suggestion_runs (
        client_id text PRIMARY KEY,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    logMigration("[migration] ai_suggestion_runs table ensured");
  } catch (migErr) {
    logMigration(`[migration] ai_suggestion_runs migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: feedback log of user decisions on AI rule suggestions
  // (accepted / denied / edited). This is the learning signal fed back into the
  // AI suggestion prompt so future suggestions improve with use.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_suggestion_feedback (
        id serial PRIMARY KEY,
        client_id text NOT NULL,
        suggestion_id text,
        name text,
        description text,
        service_line text,
        verdict text NOT NULL CHECK (verdict IN ('accepted','denied','edited')),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_ai_suggestion_feedback_client
        ON ai_suggestion_feedback (client_id, created_at DESC)
    `);
    logMigration("[migration] ai_suggestion_feedback table ensured");
  } catch (migErr) {
    logMigration(`[migration] ai_suggestion_feedback migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: replace the broken full unique index on
  // (scope, scope_value, is_active) with a partial unique index that only
  // enforces uniqueness among *active* rows.
  //
  // The old index permitted only one inactive row per (scope, scope_value),
  // so every second training run collided with the already-deactivated row
  // and discarded the newly learned weights with a duplicate-key error.
  //
  // The replacement index:
  //   - Uses WHERE is_active = true  → multiple historical versions coexist freely
  //   - Uses NULLS NOT DISTINCT      → treats NULL scope_value (global scope) as
  //     equal to other NULLs, so exactly one active global model is enforced
  //
  // Always DROP + CREATE so a partial environment that ran an earlier partial fix
  // (without NULLS NOT DISTINCT) is also corrected on the next server start.
  try {
    await db.execute(sql`DROP INDEX IF EXISTS "ai_weights_scope_active_idx"`);
    await db.execute(sql`
      CREATE UNIQUE INDEX "ai_weights_scope_active_idx"
        ON "ai_weight_versions" (scope, scope_value) NULLS NOT DISTINCT
        WHERE is_active = true
    `);
    logMigration("[migration] ai_weights_scope_active_idx replaced with partial unique index (NULLS NOT DISTINCT, WHERE is_active = true)");
  } catch (migErr) {
    logMigration(`[migration] ai_weights_scope_active_idx migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: add care_rate_fallback_campuses JSONB column to
  // competitor_rate_jobs. Stores { campusName: unitCount } for every campus that
  // used the $55/day default in a given job run, written atomically alongside
  // lastProcessedId so the data survives server restarts during long jobs.
  try {
    await db.execute(sql`
      ALTER TABLE competitor_rate_jobs
        ADD COLUMN IF NOT EXISTS care_rate_fallback_campuses jsonb
    `);
    logMigration("[migration] competitor_rate_jobs care_rate_fallback_campuses column ensured");
  } catch (migErr) {
    logMigration(`[migration] care_rate_fallback_campuses column migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: the rate_baseline_v view, which every street- and
  // in-house-rate aggregation joins to decide which rates are plausible.
  // CREATE OR REPLACE so a change to the outlier ratio or the companion-bed
  // rule ships with the code rather than needing a manual DB step.
  //
  // This one is NOT best-effort in the same sense as the others: if the view
  // is missing, rate queries fail loudly rather than silently reverting to
  // ungated averages. That is the intended behaviour — a wrong published rate
  // is worse than an error.
  try {
    const { ensureRateBaselineView } = await import("./services/rateBaselineView");
    await ensureRateBaselineView((s) => db.execute(sql.raw(s)));
    logMigration("[migration] rate_baseline_v view ensured");
  } catch (migErr) {
    logMigration(`[migration] rate_baseline_v view creation FAILED: ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: the move_in_out_events.import_format / superseded
  // columns and move_in_out_events_active, the view that hides the duplicate
  // copy of every event covered by both workbook import formats. The helper
  // runs the ALTERs before the view so an existing database — the only kind
  // that has the duplicates to hide — migrates in one step.
  //
  // This one fails loudly rather than degrading: with the view missing, every
  // move-in/out accessor errors instead of quietly serving the doubled counts
  // they served before it existed.
  try {
    const { ensureMoveInOutActiveView } = await import("./services/moveInOutEventsView");
    await ensureMoveInOutActiveView((s) => db.execute(sql.raw(s)));
    logMigration("[migration] move_in_out_events columns + active view ensured");
  } catch (migErr) {
    logMigration(`[migration] move_in_out_events_active view creation FAILED: ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: derived_rate_formulas, the user-editable rules that
  // turn the base (single-occupant) rate into second-occupant, semi-private,
  // respite, rehab/TCU, bed-hold and couple rates. Best-effort like the other
  // table migrations — an absent table degrades to the built-in defaults
  // rather than breaking the Data Management page.
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS derived_rate_formulas (
        id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id        varchar NOT NULL,
        rate_type        text    NOT NULL,
        service_line     text,
        percent_of_base  real    NOT NULL DEFAULT 100,
        dollar_offset    real    NOT NULL DEFAULT 0,
        enabled          boolean NOT NULL DEFAULT true,
        updated_by       text,
        created_at       timestamp DEFAULT now(),
        updated_at       timestamp DEFAULT now()
      )`));
    // One formula per client + rate type + scope. NULLS NOT DISTINCT so the
    // portfolio-wide row (service_line IS NULL) collides with itself and
    // upserts cleanly instead of accumulating duplicates.
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS derived_rate_formulas_scope_idx
        ON derived_rate_formulas (client_id, rate_type, service_line) NULLS NOT DISTINCT`));
    logMigration("[migration] derived_rate_formulas table ensured");
  } catch (migErr) {
    logMigration(`[migration] derived_rate_formulas migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: in-house rate planning.
  //
  // `inhouse_planning_assumptions` holds the per-scope growth objective and
  // guardrails; `inhouse_rate_plans` keeps every submitted and published plan
  // as an immutable version so an operator can always answer "what did we
  // approve, and on what numbers". Best-effort like the other table migrations — an absent table
  // makes the planning page unavailable rather than breaking the app.
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS inhouse_planning_assumptions (
        id                          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id                   varchar NOT NULL,
         division                    text,
        location_id                 varchar REFERENCES locations(id),
        service_line                text,
        rate_growth_target_pct      real    NOT NULL DEFAULT 5,
        measurement_mode            text    NOT NULL DEFAULT 'quarterly_yoy',
        street_rate_effective_date  text,
        inhouse_effective_date      text,
        annual_turnover_pct         real    NOT NULL DEFAULT 35,
        min_inhouse_increase_pct    real    NOT NULL DEFAULT 0,
        max_inhouse_increase_pct    real    NOT NULL DEFAULT 8,
        equalization_strength       text    NOT NULL DEFAULT 'high',
        allow_inhouse_above_street  boolean NOT NULL DEFAULT false,
        max_street_increase_pct     real    NOT NULL DEFAULT 15,
        max_yoy_street_increase_pct real    NOT NULL DEFAULT 15,
        updated_by                  text,
        created_at                  timestamp DEFAULT now(),
        updated_at                  timestamp DEFAULT now()
      )`));
    await db.execute(sql.raw(`
      ALTER TABLE inhouse_planning_assumptions
        ADD COLUMN IF NOT EXISTS max_yoy_street_increase_pct real NOT NULL DEFAULT 15`));
    await db.execute(sql.raw(`
      ALTER TABLE inhouse_planning_assumptions
        ADD COLUMN IF NOT EXISTS min_street_increase_pct real NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS desired_variance_to_top_competitor_pct real NOT NULL DEFAULT 0`));
    // Nullable with no default: a NULL means "this scope never set tiers" and
    // reads back as the shared defaults, which is different from an operator
    // having deliberately saved a policy that happens to match them.
    await db.execute(sql.raw(`
      ALTER TABLE inhouse_planning_assumptions
        ADD COLUMN IF NOT EXISTS occupancy_tier_policy jsonb`));
    // NULLS NOT DISTINCT so the campus-wide and portfolio-wide rows collide
    // with themselves and upsert cleanly instead of accumulating duplicates.
    await db.execute(sql.raw(`
      ALTER TABLE inhouse_planning_assumptions
        ADD COLUMN IF NOT EXISTS division text`));
    await db.execute(sql.raw(`
      DROP INDEX IF EXISTS inhouse_planning_assumptions_scope`));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS inhouse_planning_assumptions_scope
        ON inhouse_planning_assumptions (client_id, division, location_id, service_line) NULLS NOT DISTINCT`));
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS inhouse_rate_plans (
        id                          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id                   varchar NOT NULL,
        location_id                 varchar REFERENCES locations(id),
        location                    text,
        service_line                text NOT NULL,
        version                     integer NOT NULL,
        status                      text NOT NULL DEFAULT 'proposed',
        assumptions                 jsonb NOT NULL,
        summary                     jsonb NOT NULL,
        quarters                    jsonb NOT NULL,
        residents                   jsonb NOT NULL,
        target_deviation_diagnostic jsonb,
        street_rate_effective_date  text,
        inhouse_effective_date      text,
        recommended_street_rate     real,
        applied_by                  text,
        created_at                  timestamp DEFAULT now()
      )`));
    await db.execute(sql.raw(`
      ALTER TABLE inhouse_rate_plans
        ADD COLUMN IF NOT EXISTS target_deviation_diagnostic jsonb`));
    await db.execute(sql.raw(`
      ALTER TABLE inhouse_rate_plans
        ALTER COLUMN status SET DEFAULT 'proposed'`));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS inhouse_rate_plans_scope_idx
        ON inhouse_rate_plans (client_id, location, service_line, version DESC)`));
    // Two concurrent approvals must not be able to mint the same version.
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS inhouse_rate_plans_version_uniq
        ON inhouse_rate_plans (client_id, location, service_line, version) NULLS NOT DISTINCT`));
    logMigration("[migration] in-house rate planning tables ensured");
  } catch (migErr) {
    logMigration(`[migration] inhouse rate planning migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: the annual in-house report is a tenant-scoped
  // snapshot of the exact calculated payload shown to an operator. There is
  // intentionally one current run per client + scope key.
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS inhouse_annual_report_runs (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id     varchar NOT NULL REFERENCES clients(id),
        scope_key     text NOT NULL,
        location_id   varchar REFERENCES locations(id),
        service_lines jsonb NOT NULL,
        plans         jsonb NOT NULL,
        tier_grid     jsonb NOT NULL,
        created_at    timestamp NOT NULL DEFAULT now(),
        generated_at  timestamp NOT NULL DEFAULT now()
      )`));
    await db.execute(sql.raw(`
      ALTER TABLE inhouse_annual_report_runs
        ADD COLUMN IF NOT EXISTS location_id varchar REFERENCES locations(id),
        ADD COLUMN IF NOT EXISTS service_lines jsonb,
        ADD COLUMN IF NOT EXISTS plans jsonb,
        ADD COLUMN IF NOT EXISTS tier_grid jsonb,
        ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now(),
        ADD COLUMN IF NOT EXISTS generated_at timestamp DEFAULT now()`));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS inhouse_annual_report_runs_scope_uniq
        ON inhouse_annual_report_runs (client_id, scope_key)`));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS inhouse_annual_report_runs_client_generated_at_idx
        ON inhouse_annual_report_runs (client_id, generated_at DESC)`));
    logMigration("[migration] annual in-house report runs table ensured");
  } catch (migErr) {
    logMigration(`[migration] annual in-house report runs migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  // Idempotent migration: persist Reference Data audit workbook job metadata.
  // The workbook itself remains in a per-job temporary directory, while this
  // table lets the API recover status after the Node process is restarted.
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS reference_data_audit_jobs (
        id           varchar PRIMARY KEY,
        client_id    text NOT NULL,
        status       text NOT NULL,
        phase        text NOT NULL,
        percent      integer NOT NULL DEFAULT 0,
        message      text NOT NULL,
        error        text,
        file_path    text,
        generated_by text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        started_at   timestamptz,
        completed_at timestamptz,
        expires_at   timestamptz NOT NULL
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS reference_data_audit_jobs_client_created_idx
        ON reference_data_audit_jobs (client_id, created_at DESC)
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS reference_data_audit_jobs_expiry_idx
        ON reference_data_audit_jobs (expires_at)
    `));
    logMigration("[migration] reference_data_audit_jobs table ensured");
  } catch (migErr) {
    logMigration(`[migration] reference_data_audit_jobs migration failed (non-fatal): ${migErr instanceof Error ? migErr.message : String(migErr)}`);
  }

  };

  const server = await registerRoutes(app, {
    databaseReady: startupSchemaMigrations,
    fullReady: applicationReady,
    onReady: (ready) => {
      void ready.then(resolveApplicationReady, rejectApplicationReady);
    },
  });

  // One-time repair: fix stale action.filters.serviceLine on adjustment rules
  // saved before task #336. These rules have rule.serviceLine='AL/MC' but
  // action.filters.serviceLine=['AL'], causing them to silently skip all units.
  setTimeout(async () => {
    try {
      await applicationReady;
      const allRules = await storage.getAdjustmentRules();
      let repaired = 0;
      for (const rule of allRules) {
        const action = rule.action as any;
        if (rule.serviceLine && Array.isArray(action?.filters?.serviceLine)) {
          const filterSL: string[] = action.filters.serviceLine;
          if (!filterSL.includes(rule.serviceLine)) {
            const newFilters = { ...action.filters, serviceLine: [rule.serviceLine] };
            await storage.updateAdjustmentRule(rule.id, {
              action: { ...action, filters: newFilters },
            });
            log(`[startup-migration] Repaired serviceLine filter on rule "${rule.name}": ${JSON.stringify(filterSL)} → [${rule.serviceLine}]`);
            repaired++;
          }
        }
      }
      if (repaired > 0) {
        log(`[startup-migration] Repaired ${repaired} adjustment rule(s) with stale serviceLine filters`);
      }
    } catch (err) {
      log(`[startup-migration] Rule SL filter repair failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 3000);

  // Re-derive move-in/out event service lines from their department.
  //
  // Event workbooks are historical uploads, so a correction to the department
  // mapping (e.g. recognising the memory-care neighbourhood inside the Health
  // Center as HC/MC rather than HC) would otherwise only apply to the next
  // import and leave two years of stored discharges misfiled. Idempotent —
  // after the first run it corrects nothing and costs one indexed UPDATE.
  setTimeout(async () => {
    try {
      await applicationReady;
      const {
        backfillEventServiceLinesFromDept,
        resolveStoredEventImportOverlap,
        backfillDepartureRule,
      } = await import('./services/moveInOutService');
      const fixed = await backfillEventServiceLinesFromDept();
      if (fixed > 0) {
        log(`[startup-migration] Re-derived service line on ${fixed} move-in/out event(s) from their department`);
      }
      // Two workbook formats describe the same admissions and discharges under
      // different synthetic census ids, so the upsert cannot dedupe them. Stored
      // rows predate the resolution entirely; without this the overlap window
      // stays double-counted no matter how many times the mapping is fixed.
      const overlap = await resolveStoredEventImportOverlap();
      if (overlap.formatsStamped > 0 || overlap.supersededChanged > 0) {
        log(`[startup-migration] Move-in/out import overlap resolved: stamped ${overlap.formatsStamped} row(s) with their import format, changed ownership on ${overlap.supersededChanged}`);
      }
      // Deaths were imported uncounted, and the export importer discarded the
      // Move Event that identifies them. Both repairs have to reach stored
      // rows: dropping deaths understated every measured turnover figure by
      // roughly the share of residents who die in place, which in Assisted
      // Living is 29% of all departures.
      const departures = await backfillDepartureRule();
      if (departures > 0) {
        log(`[startup-migration] Departure rule applied: changed counted on ${departures} move-out(s)`);
      }
    } catch (err) {
      log(`[startup-migration] Move-in/out service-line backfill failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 4000);

  // Run room type normalization backfill asynchronously in background
  // This won't block server startup
  setTimeout(async () => {
    try {
      await applicationReady;
      log("Starting room type normalization backfill (background task)...");
      const { backfillRoomTypes } = await import('./backfillRoomTypes');
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
      await applicationReady;
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
      await applicationReady;
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
      await applicationReady;
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
      await applicationReady;
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
      await applicationReady;
      const { geocodeMissingCompetitorSurveys, getLatestGeocodingJob, backfillSurveyDistances, getSurveyGeocodingCoverage } = await import('./geocoding');

      // Check for an interrupted (running) job from before the last restart
      const latestJob = await getLatestGeocodingJob('competitor_surveys');
      if (latestJob && latestJob.status === 'running') {
        log(`[startup] Resuming interrupted geocoding job ${latestJob.id} (was processing ${latestJob.processedRows}/${latestJob.totalRows} rows)…`);
        const result = await geocodeMissingCompetitorSurveys();
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
    void runStartupSchemaMigrations().then(
      resolveStartupSchemaMigrations,
      rejectStartupSchemaMigrations,
    );
  });

  // Seed demo data in the background after the server is already accepting requests.
  // On first cold start the seed takes ~15 s; on subsequent restarts the
  // COUNT + MAX(upload_month) query short-circuits in <100 ms.
  // We also re-seed whenever the latest demo month is behind the current calendar month,
  // so the Revenue Growth chart always has data through the present month.
  setTimeout(async () => {
    try {
      await applicationReady;
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
