import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { backfillRoomTypes } from "./backfillRoomTypes";
import { resumeInterruptedJobs } from "./services/competitorRateJobService";

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

  // Resume any interrupted competitor rate jobs after server restart
  setTimeout(async () => {
    try {
      log("Checking for interrupted competitor rate jobs...");
      await resumeInterruptedJobs();
    } catch (error) {
      log(`Error resuming competitor rate jobs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, 3000); // Check for interrupted jobs 3 seconds after server starts

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

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
