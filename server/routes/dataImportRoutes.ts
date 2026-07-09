/**
 * Data Import Subsystem routes
 * /api/data-imports/*
 */
import type { Express } from "express";
import multer from "multer";
import { z } from "zod";
import { IMPORT_DATASETS, getDataset, DATASET_IDS, getConsolidatedRegistry } from "@shared/importRegistry";
import {
  parseImportFile,
  validateData,
  executeImport,
  hashFile,
  isDuplicateFile,
  getImportRuns,
  buildTemplate,
} from "../services/dataImportService";
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduledImport,
  triggerPostImportActions,
} from "../services/scheduledImportService";
import { db } from "../db";
import { scheduledImports, importNotifications } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Destructive endpoints (imports, schedule CRUD/run) require a logged-in session.
function requireAuth(req: any, res: any, next: any) {
  if (req.session?.userId && req.session?.clientId) return next();
  return res.status(401).json({ error: "Login required. Data imports are disabled in anonymous demo mode." });
}

// Block SFTP targets pointing at localhost / private networks (SSRF guard).
function isDisallowedHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return true;
  }
  return false;
}

const scheduleSchema = z.object({
  name: z.string().min(1),
  datasetType: z.enum(DATASET_IDS as [string, ...string[]]),
  enabled: z.boolean().optional(),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  username: z.string().min(1),
  password: z.string().optional(),
  remotePath: z.string().min(1),
  filePattern: z.string().min(1).default("*.csv"),
  scheduleTime: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/).default("06:00"),
  frequency: z.enum(["one_time", "daily", "weekly", "monthly"]).default("daily"),
  runDate: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).nullable().optional(),
  dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(28).nullable().optional(),
  deleteAfterImport: z.boolean().optional(),
});

export function registerDataImportRoutes(app: Express): void {
  // ── Field registry ──────────────────────────────────────────────
  app.get("/api/data-imports/registry", (_req, res) => {
    res.json(IMPORT_DATASETS);
  });

  // Consolidated cross-dataset view: duplicates merged, naming conflicts flagged
  app.get("/api/data-imports/registry/consolidated", (_req, res) => {
    res.json(getConsolidatedRegistry());
  });

  // ── Template export ─────────────────────────────────────────────
  app.get("/api/data-imports/template/:datasetId", (req, res) => {
    try {
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const { buffer, fileName, contentType } = buildTemplate(req.params.datasetId, format);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Template generation failed" });
    }
  });

  // ── Validate (preview) ──────────────────────────────────────────
  app.post("/api/data-imports/validate", upload.single("file"), (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const datasetId = req.body.datasetType;
      if (!getDataset(datasetId)) return res.status(400).json({ error: `Unknown dataset type: ${datasetId}` });
      const { headers, rows } = parseImportFile(req.file.buffer, req.file.originalname);
      const validation = validateData(datasetId, headers, rows, req.file.originalname);
      const { records, ...report } = validation;
      res.json({
        ...report,
        fileHash: hashFile(req.file.buffer),
        previewRows: records.slice(0, 10),
        canImport: validation.validRows > 0 && !validation.columnIssues.some((c) => c.issue === "missing_required"),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Validation failed" });
    }
  });

  // ── Import (confirm) ────────────────────────────────────────────
  app.post("/api/data-imports/import", requireAuth, upload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const clientId = req.clientId || "demo";
      const datasetId = req.body.datasetType;
      const dataset = getDataset(datasetId);
      if (!dataset) return res.status(400).json({ error: `Unknown dataset type: ${datasetId}` });

      const fileHash = hashFile(req.file.buffer);
      if (req.body.allowDuplicate !== "true" && (await isDuplicateFile(clientId, datasetId, fileHash))) {
        return res.status(409).json({ error: "This exact file has already been imported. Set allowDuplicate=true to import anyway." });
      }

      const { headers, rows } = parseImportFile(req.file.buffer, req.file.originalname);
      const validation = validateData(datasetId, headers, rows, req.file.originalname);

      let period: string | null = null;
      let periodSource: "column" | "filename" | "user" | null = null;
      if (req.body.period && /^20\d{2}-(0[1-9]|1[0-2])$/.test(req.body.period)) {
        period = req.body.period;
        periodSource = "user";
      } else if (validation.detectedPeriod) {
        period = validation.detectedPeriod;
        periodSource = validation.periodSource || "column";
      } else if (dataset.periodField) {
        return res.status(400).json({ error: "Could not determine the reporting period. Provide a 'period' (YYYY-MM) in the request." });
      }

      const mode = req.body.mode === "append" ? "append" : dataset.replacesPeriod ? "replace_period" : "append";
      const run = await executeImport({
        clientId,
        datasetId,
        fileName: req.file.originalname,
        fileHash,
        source: "manual",
        triggeredBy: req.session?.username || req.session?.userId || null,
        period,
        periodSource,
        mode,
        validation,
      });
      const statusCode = run.status === "failed" ? 500 : 200;
      res.status(statusCode).json(run);
      // Fire-and-forget post-import actions (cache invalidation + rate refresh)
      // for competitive_survey so the badge appears without waiting for the nightly cron.
      if (run.status !== "failed" && datasetId === "competitive_survey" && period) {
        triggerPostImportActions(clientId, datasetId, period, run.id).catch((err) =>
          console.error("[DataImport] Post-import actions failed for manual competitive_survey import:", err),
        );
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
    }
  });

  // ── Import history ──────────────────────────────────────────────
  app.get("/api/data-imports/runs", async (req: any, res) => {
    try {
      const runs = await getImportRuns(req.clientId || "demo", Math.min(parseInt(req.query.limit) || 50, 200));
      res.json(runs);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch runs" });
    }
  });

  // ── Notifications ───────────────────────────────────────────────
  app.get("/api/data-imports/notifications", async (req: any, res) => {
    try {
      const rows = await db.select().from(importNotifications)
        .where(eq(importNotifications.clientId, req.clientId || "demo"))
        .orderBy(desc(importNotifications.createdAt))
        .limit(50);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch notifications" });
    }
  });

  app.post("/api/data-imports/notifications/:id/read", requireAuth, async (req: any, res) => {
    try {
      await db.update(importNotifications)
        .set({ read: true })
        .where(and(eq(importNotifications.id, req.params.id), eq(importNotifications.clientId, req.clientId || "demo")));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update notification" });
    }
  });

  // ── Scheduled imports CRUD ──────────────────────────────────────
  app.get("/api/data-imports/schedules", async (req: any, res) => {
    try {
      res.json(await listSchedules(req.clientId || "demo"));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch schedules" });
    }
  });

  app.post("/api/data-imports/schedules", requireAuth, async (req: any, res) => {
    try {
      const data = scheduleSchema.parse(req.body);
      if (!data.password) return res.status(400).json({ error: "Password is required when creating a schedule" });
      if (isDisallowedHost(data.host)) return res.status(400).json({ error: "SFTP host is not allowed (localhost/private network addresses are blocked)" });
      const row = await createSchedule(req.clientId || "demo", data);
      const { encryptedPassword, ...safe } = row as any;
      res.json({ ...safe, hasPassword: true });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid schedule", details: err.errors });
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create schedule" });
    }
  });

  app.patch("/api/data-imports/schedules/:id", requireAuth, async (req: any, res) => {
    try {
      const data = scheduleSchema.partial().parse(req.body);
      if (data.host && isDisallowedHost(data.host)) return res.status(400).json({ error: "SFTP host is not allowed (localhost/private network addresses are blocked)" });
      const row = await updateSchedule(req.clientId || "demo", req.params.id, data);
      if (!row) return res.status(404).json({ error: "Schedule not found" });
      const { encryptedPassword, ...safe } = row as any;
      res.json({ ...safe, hasPassword: !!encryptedPassword });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid schedule", details: err.errors });
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update schedule" });
    }
  });

  app.delete("/api/data-imports/schedules/:id", requireAuth, async (req: any, res) => {
    try {
      await deleteSchedule(req.clientId || "demo", req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete schedule" });
    }
  });

  // Run a schedule immediately (test / manual trigger)
  app.post("/api/data-imports/schedules/:id/run", requireAuth, async (req: any, res) => {
    try {
      const [schedule] = await db.select().from(scheduledImports)
        .where(and(eq(scheduledImports.id, req.params.id), eq(scheduledImports.clientId, req.clientId || "demo")));
      if (!schedule) return res.status(404).json({ error: "Schedule not found" });
      const result = await runScheduledImport(schedule);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Run failed" });
    }
  });
}
