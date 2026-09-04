import { describe, expect, it } from "vitest";
import { buildResponse, isBlsRevision } from "../server/services/industryContext";

describe("industry context source health", () => {
  it("keeps an initial provider outage distinct from a successful refresh", () => {
    const responseTime = Date.parse("2026-09-04T12:00:00.000Z");
    const response = buildResponse(null, [], responseTime);

    expect(response.liveRefresh.lastSuccessAt).toBeNull();
    expect(response.liveRefresh.lastAttemptAt).toBeNull();
    expect(response.liveSourceStatus).toBe("partial");
    expect(response.fetchedAt).toBe("2026-09-04T12:00:00.000Z");
  });
});

describe("industry context revision identity", () => {
  it("detects a changed value for the same observation", () => {
    expect(
      isBlsRevision(
        { period: "M04", observationYear: 2026, value: 3.4 },
        { period: "M04", observationYear: 2026, value: 3.5 },
      ),
    ).toBe(true);
  });

  it("does not call the same month in a new year a revision", () => {
    expect(
      isBlsRevision(
        { period: "M04", observationYear: 2026, value: 3.4 },
        { period: "M04", observationYear: 2027, value: 3.5 },
      ),
    ).toBe(false);
  });

  it("does not record a revision when the value is unchanged", () => {
    expect(
      isBlsRevision(
        { period: "M04", observationYear: 2026, value: 3.4 },
        { period: "M04", observationYear: 2026, value: 3.4 },
      ),
    ).toBe(false);
  });
});