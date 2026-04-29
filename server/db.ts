import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Without this handler, any idle-connection drop from Neon (code 57P01)
// becomes an unhandled 'error' event and crashes the Node process.
pool.on('error', (err) => {
  console.error('[DB Pool] Idle client error (non-fatal):', err.message);
});

export const db = drizzle({ client: pool, schema });