import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import http from "node:http";

async function main() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(session({
    secret: "proxy-regression-secret",
    resave: false,
    saveUninitialized: true,
    proxy: true,
    cookie: { secure: true, sameSite: "lax", maxAge: 60_000 },
  }));
  app.get("/", (req, res) => {
    (req.session as any).probe = true;
    res.json({ ok: true });
  });

  const server = await new Promise<http.Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("proxy test server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: { "x-forwarded-proto": "https" },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") || "", /Secure/i);
    console.log("1 passed");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});