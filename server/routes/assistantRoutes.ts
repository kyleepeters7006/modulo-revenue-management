import type { Express } from "express";
import { z } from "zod";
import {
  AssistantInputError,
  AssistantRateLimiter,
  AssistantTimeoutError,
  AssistantUnavailableError,
  assistantRateLimiter,
  parseAssistantRequest,
  runAssistantChat,
} from "../services/assistantService";
import { pool } from "../db";

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message || "Invalid assistant request.";
  if (error instanceof AssistantInputError) return error.message;
  return "Invalid assistant request.";
}

export function hasAuthenticatedAssistantSession(req: {
  session?: { userId?: string; clientId?: string; authenticatedAt?: number };
  authState?: string;
}): boolean {
  return Boolean(
    req.session?.userId &&
    req.session.clientId &&
    req.session.authenticatedAt &&
    req.authState === "authenticated",
  );
}

export function registerAssistantRoutes(app: Express): void {
  app.post("/api/assistant/chat", async (req: any, res) => {
    const session = req.session;
    // Never use req.clientId, a body tenant, or the anonymous demo tenant here.
    if (!hasAuthenticatedAssistantSession(req)) {
      return res.status(401).json({ error: "An authenticated local session is required." });
    }

    let activeUser;
    try {
      activeUser = await pool.query(
        `SELECT id, client_id
           FROM users
          WHERE id = $1
            AND client_id = $2
            AND account_status = 'active'
          LIMIT 1`,
        [session.userId, session.clientId],
      );
    } catch (error) {
      console.error("[assistant] active-user lookup failed:", error instanceof Error ? error.message : error);
      return res.status(503).json({ error: "Assistant authentication is temporarily unavailable." });
    }
    if (!activeUser.rows[0]) {
      return res.status(401).json({ error: "An active account is required." });
    }

    const ipKey = `ip:${String(req.ip || "unknown")}`;
    const userKey = `user:${String(activeUser.rows[0].id)}`;
    if (!assistantRateLimiter.consume(ipKey) || !assistantRateLimiter.consume(userKey)) {
      return res.status(429).set("Retry-After", "60").json({ error: "Assistant rate limit exceeded. Try again shortly." });
    }

    let input;
    try {
      input = parseAssistantRequest(req.body);
    } catch (error) {
      return res.status(400).json({ error: errorMessage(error) });
    }

    try {
      const result = await runAssistantChat(
        input,
        { userId: String(activeUser.rows[0].id), clientId: String(activeUser.rows[0].client_id) },
        req,
      );
      return res.set("Cache-Control", "no-store").json(result);
    } catch (error) {
      if (error instanceof AssistantTimeoutError) {
        return res.status(504).json({ error: error.message });
      }
      if (error instanceof AssistantUnavailableError) {
        return res.status(503).json({ error: error.message });
      }
      console.error("[assistant] chat failed:", error instanceof Error ? error.message : error);
      return res.status(502).json({ error: "The assistant could not complete the request." });
    }
  });
}

// Exported for focused unit tests without requiring an Express app.
export { AssistantRateLimiter };