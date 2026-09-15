import assert from "node:assert/strict";
import {
  getPricingAnalyticsCacheDiagnostics,
  recordLatestRentRollCacheHit,
  recordLatestRentRollCoalescedRequest,
  recordLatestRentRollSourceLoadFinished,
  recordLatestRentRollSourceLoadStarted,
  recordPricingAnalyticsResponseCacheHit,
} from "../server/commentaryCache";

const clientId = `pricing-cache-metrics-${Date.now()}`;

recordLatestRentRollCacheHit(clientId);
recordLatestRentRollCoalescedRequest(clientId);
recordLatestRentRollSourceLoadStarted(clientId);
recordLatestRentRollSourceLoadFinished(clientId, 11.4, false);
recordLatestRentRollSourceLoadStarted(clientId);
recordLatestRentRollSourceLoadFinished(clientId, 28.6, true);
recordPricingAnalyticsResponseCacheHit(clientId, "campusMetrics");
recordPricingAnalyticsResponseCacheHit(clientId, "vacancyScatter");
recordPricingAnalyticsResponseCacheHit(clientId, "vacancyScatter");

assert.deepEqual(getPricingAnalyticsCacheDiagnostics(clientId), {
  latestRentRoll: {
    cacheHits: 1,
    sourceLoads: 2,
    coalescedRequests: 1,
    loadFailures: 1,
    loadDurationMs: {
      count: 2,
      total: 40,
      average: 20,
      max: 29,
      last: 29,
    },
  },
  responseCache: {
    campusMetricsHits: 1,
    vacancyScatterHits: 2,
  },
});

console.log("pricing analytics cache metrics: ok");