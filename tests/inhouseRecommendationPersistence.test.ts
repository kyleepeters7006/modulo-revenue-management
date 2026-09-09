import assert from "node:assert/strict";
import {
  loadPersistedRecommendationSnapshots,
  recommendationSnapshotFromPlan,
  recommendationSnapshotKey,
} from "../server/routes/inhousePlanningRoutes";
import { pool } from "../server/db";

const recommendations = [{
  id: "rec-1",
  location: "Campus A",
  locationId: "campus-a",
  serviceLine: "AL",
  product: "Studio",
  currentStreetRate: 4200,
  suggestedRate: 4300,
  hardCeiling: 4500,
  topCompetitorRate: 4400,
  units: 2,
  suggestedIncreasePct: 2.38,
  growthContribution: 200,
  locked: false,
}] as any;

const persistedPlan = {
  location_id: "campus-a",
  created_at: "2026-09-09T10:00:00.000Z",
  summary: {
    streetRateRecommendationSnapshot: {
      createdAt: "2026-09-09T09:45:00.000Z",
      maximumPremiumAboveTopCompetitorPct: 3,
      assumptionsFingerprint: "{\"growthTargetPct\":4}",
      recommendations,
    },
  },
};

const restoredAfterRestart = recommendationSnapshotFromPlan(persistedPlan);
assert.ok(restoredAfterRestart, "a proposed plan should restore its persisted snapshot");
assert.equal(restoredAfterRestart.createdAt, "2026-09-09T09:45:00.000Z");
assert.equal(restoredAfterRestart.maximumPremiumAboveTopCompetitorPct, 3);
assert.equal(restoredAfterRestart.assumptionsFingerprint, "{\"growthTargetPct\":4}");
assert.deepEqual(restoredAfterRestart.recommendations, recommendations);

// The in-memory map is intentionally disposable. Scope identity must still
// keep the same tenant/user/campus/service-line isolated after reload.
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-b", "user-a", "campus-a", "AL"),
);
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-a", "user-b", "campus-a", "AL"),
);
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-a", "user-a", "campus-b", "AL"),
);
assert.notEqual(
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "AL"),
  recommendationSnapshotKey("tenant-a", "user-a", "campus-a", "HC"),
);

const legacyPlan = {
  ...persistedPlan,
  summary: { streetRateRecommendations: recommendations },
};
const legacyRestored = recommendationSnapshotFromPlan(legacyPlan);
assert.ok(legacyRestored, "legacy recommendation rows remain displayable after restart");
assert.equal(legacyRestored.maximumPremiumAboveTopCompetitorPct, null);
assert.equal(legacyRestored.assumptionsFingerprint, null);

async function verifyDatabaseReloadAndEligibility() {
  const userResult = await pool.query<{ id: string; client_id: string }>(
    "SELECT id, client_id FROM users WHERE client_id IS NOT NULL LIMIT 1",
  );
  if (userResult.rows.length === 0) {
    console.log("In-house recommendation persistence tests: skipped (no tenant user)");
    return;
  }

  const { id: userId, client_id: clientId } = userResult.rows[0];
  const fingerprint = `persistence-test-${Date.now()}`;
  const snapshot = {
    createdAt: new Date().toISOString(),
    maximumPremiumAboveTopCompetitorPct: 3,
    assumptionsFingerprint: fingerprint,
    recommendations,
  };
  const versionResult = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next
       FROM inhouse_rate_plans
      WHERE client_id = $1
        AND location IS NULL
        AND service_line = 'AL'`,
    [clientId],
  );
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO inhouse_rate_plans
       (client_id, location_id, location, service_line, version, status,
        assumptions, summary, quarters, residents, applied_by)
     VALUES ($1, NULL, NULL, 'AL', $2, 'proposed', $3, $4, '[]', '[]', $5)
     RETURNING id`,
    [
      clientId,
      Number(versionResult.rows[0]?.next) || 1,
      JSON.stringify({}),
      JSON.stringify({ streetRateRecommendationSnapshot: snapshot }),
      userId,
    ],
  );
  const planId = inserted.rows[0].id;

  try {
    const restored = await loadPersistedRecommendationSnapshots(clientId, userId);
    assert.equal(restored.length, 1, "a proposed plan should reload after the in-memory map is gone");
    assert.equal(restored[0].assumptionsFingerprint, fingerprint);
    assert.deepEqual(restored[0].recommendations, recommendations);

    assert.equal(
      (await loadPersistedRecommendationSnapshots(clientId, "__different-user__")).length,
      0,
      "a different user cannot reopen the snapshot",
    );
    assert.equal(
      (await loadPersistedRecommendationSnapshots("__different-tenant__", userId)).length,
      0,
      "a different tenant cannot reopen the snapshot",
    );

    await pool.query("UPDATE inhouse_rate_plans SET status = 'applied' WHERE id = $1", [planId]);
    assert.equal(
      (await loadPersistedRecommendationSnapshots(clientId, userId)).length,
      0,
      "published plans cannot become recurring advisory sources",
    );
  } finally {
    await pool.query("DELETE FROM inhouse_rate_plans WHERE id = $1", [planId]);
    await pool.end();
  }
}

await verifyDatabaseReloadAndEligibility();

console.log("In-house recommendation persistence tests: passed");