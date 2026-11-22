/**
 * A record is relied on for the default lifetime at most, whatever lifetime
 * it states, by every reader.
 *
 * The evidence file is on disk between runs and anyone can type into it. A
 * run never stamps more than thirty days, so a record that claims a year
 * was not stamped by a run. The writer already held the records it keeps to
 * thirty days; a record typed in after the last run has been through no
 * writer, so the one place that says when a record expires holds it too.
 */
import { describe, expect, it } from "vitest";

import {
  evidenceExpiry,
  isEvidenceFresh,
  reliedOnSeconds,
} from "../../../src/controls/evidence.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  MAX_FRESHNESS_SECONDS,
} from "../../../src/controls/evidence-types.js";

const COMPLETED = "2026-01-01T00:00:00.000Z";
const DAY_SECONDS = 24 * 60 * 60;

/**
 * A record's timing, completed at the start of the year.
 * @param seconds - The lifetime it states
 * @returns The two fields a reader takes
 */
function lasting(seconds: number): {
  readonly completed_at: string;
  readonly freshness_seconds: number;
} {
  return { completed_at: COMPLETED, freshness_seconds: seconds };
}

/**
 * A time some days after the record was completed.
 * @param days - How many days
 * @returns The time
 */
function daysLater(days: number): Date {
  return new Date(Date.parse(COMPLETED) + days * DAY_SECONDS * 1000);
}

describe("how long a record is relied on", () => {
  it.each([
    ["a second", 1, 1],
    ["an hour", 3600, 3600],
    ["the default", DEFAULT_FRESHNESS_SECONDS, DEFAULT_FRESHNESS_SECONDS],
    [
      "a second more than the default",
      DEFAULT_FRESHNESS_SECONDS + 1,
      DEFAULT_FRESHNESS_SECONDS,
    ],
    ["ninety days", 90 * DAY_SECONDS, DEFAULT_FRESHNESS_SECONDS],
    ["a year", MAX_FRESHNESS_SECONDS, DEFAULT_FRESHNESS_SECONDS],
  ])(
    "is %s for a record that states it, never more than thirty days",
    (_n, stated, relied) => {
      expect(reliedOnSeconds(lasting(stated))).toBe(relied);
    }
  );

  it("is thirty days", () => {
    expect(DEFAULT_FRESHNESS_SECONDS).toBe(30 * DAY_SECONDS);
  });
});

describe("a record that states a year", () => {
  const year = lasting(MAX_FRESHNESS_SECONDS);

  it("expires thirty days after it was completed", () => {
    expect(evidenceExpiry(year)).toEqual(daysLater(30));
  });

  it("is current the day before that, and not on the day or after", () => {
    expect(isEvidenceFresh(year, daysLater(29))).toBe(true);
    expect(isEvidenceFresh(year, daysLater(30))).toBe(false);
    expect(isEvidenceFresh(year, daysLater(200))).toBe(false);
  });
});

describe("a record that states less than the default", () => {
  it("expires when it says it does", () => {
    const hour = lasting(3600);

    expect(evidenceExpiry(hour).toISOString()).toBe("2026-01-01T01:00:00.000Z");
    expect(isEvidenceFresh(hour, new Date("2026-01-01T00:59:59.999Z"))).toBe(
      true
    );
    expect(isEvidenceFresh(hour, new Date("2026-01-01T01:00:00.000Z"))).toBe(
      false
    );
  });
});
