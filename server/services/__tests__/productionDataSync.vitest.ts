import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SYNC_TABLES,
  assertManagedPostgresCliEnvironment,
  assertAllowedProductionSyncArchive,
  createProductionSyncAuth,
  verifyProductionSyncAuth,
} from "../productionDataSync";

const secret = "test-only-secret-with-at-least-32-characters";
const hash = "a".repeat(64);

function validList(): string {
  return PRODUCTION_SYNC_TABLES.map(
    (table, index) => `${index + 1}; 0 ${1000 + index} TABLE DATA public ${table} owner`,
  ).join("\n");
}

describe("production data sync authorization", () => {
  it("accepts an untampered signed archive", () => {
    const auth = createProductionSyncAuth(secret, 1234, hash, 1_000_000, "12345678-1234-1234-1234-123456789abc");
    expect(verifyProductionSyncAuth(secret, auth, 1_000_100)).toEqual({ ok: true });
  });

  it("rejects tampering and expired signatures", () => {
    const auth = createProductionSyncAuth(secret, 1234, hash, 1_000_000, "12345678-1234-1234-1234-123456789abc");
    expect(verifyProductionSyncAuth(secret, { ...auth, size: 1235 }, 1_000_100)).toMatchObject({ ok: false });
    expect(verifyProductionSyncAuth(secret, auth, 1_000_000 + 6 * 60 * 1000)).toMatchObject({ ok: false });
  });
});

describe("production data sync archive allowlist", () => {
  it("accepts exactly the approved table data", () => {
    expect(() => assertAllowedProductionSyncArchive(validList())).not.toThrow();
  });

  it("rejects unapproved or missing table data", () => {
    expect(() => assertAllowedProductionSyncArchive(
      `${validList()}\n99; 0 9999 TABLE DATA public users owner`,
    )).toThrow(/unapproved table/);
    expect(() => assertAllowedProductionSyncArchive(
      validList().split("\n").slice(1).join("\n"),
    )).toThrow(/missing required tables/);
    expect(() => assertAllowedProductionSyncArchive(
      `${validList()}\n101; 0 10101 TABLE DATA public locations owner`,
    )).toThrow(/duplicate table data/);
  });

  it("rejects unexpected archive entry types", () => {
    expect(() => assertAllowedProductionSyncArchive(
      `${validList()}\n99; 0 9999 FUNCTION public malicious owner`,
    )).toThrow(/unexpected entry type/);
    expect(() => assertAllowedProductionSyncArchive(
      `${validList()}\n100; 0 10000 SEQUENCE SET public upload_history_id_seq owner`,
    )).toThrow(/unexpected entry type/);
  });
});

describe("managed PostgreSQL CLI environment", () => {
  it("requires every runtime-managed libpq variable", () => {
    const complete = {
      PGHOST: "host",
      PGPORT: "5432",
      PGUSER: "user",
      PGPASSWORD: "password",
      PGDATABASE: "database",
    };
    expect(() => assertManagedPostgresCliEnvironment(complete)).not.toThrow();
    expect(() => assertManagedPostgresCliEnvironment({ ...complete, PGHOST: "" })).toThrow(/PGHOST/);
  });
});