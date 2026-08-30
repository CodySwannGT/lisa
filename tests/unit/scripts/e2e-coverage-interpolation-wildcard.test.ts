/**
 * An unresolved `${...}` hole is not evidence of a visit (#3441).
 *
 * `routeMatchesVisit` treated any visited segment containing `${` as a
 * wildcard. The direction of that rule was backwards: an unresolved
 * interpolation is the case where the gate knows LEAST about what a spec
 * visits, and it was the case that credited the MOST.
 *
 * The consumer that surfaced it has a 404 spec navigating to
 * `` page.goto(`${UNKNOWN_PATH}-first`) `` — a URL chosen precisely because
 * nothing serves it. Two such navigations matched every single-segment route in
 * the app: nine routes credited, `/watchlist`, `/shadow-team` and
 * `/recent-activity` among them, to a test that proves the 404 screen renders.
 * Playwright route coverage there read 37/61 (60.7%) against a 54% gate; the
 * honest figure is 28/61 (45.9%), which the gate as configured would have
 * failed. So the gate was green on inflated input for its whole life.
 *
 * These tests pin the NUMBER, not the verdict. A test asserting only that the
 * gate still passes would have passed throughout the entire defect — that is
 * the failure mode being fixed, and reproducing it in the test would be the
 * same mistake one layer up.
 * @module tests/unit/scripts/e2e-coverage-interpolation-wildcard
 */
import { describe, expect, it } from "vitest";

import {
  extractPlaywrightPaths,
  evaluateE2eCoverage,
  routeMatchesVisit,
  unmatchedVisits,
} from "../../../expo/copy-overwrite/scripts/check-e2e-coverage.mjs";

/** The dynamic route an interpolated player id legitimately covers. */
const PLAYERS_ROUTE = "/players/[id]";
/** A spec navigation whose id is only known at runtime. */
const PLAYERS_VISIT = "/players/${playerId}";
/** The 404 spec's first deliberately-nonexistent navigation, as extracted. */
const UNKNOWN_FIRST = "/${UNKNOWN_PATH}-first";
/** Its second. */
const UNKNOWN_SECOND = "/${UNKNOWN_PATH}-second";
/** The spec file the two nonexistent navigations come from. */
const NOT_FOUND_SPEC = "e2e/tests/not-found.spec.ts";
/** One of the nine, used on its own wherever a single literal route is wanted. */
const WATCHLIST = "/watchlist";

/**
 * The nine single-segment routes the 404 spec falsely credited, verbatim from
 * the consumer where this was measured. They are the whole of the defect's
 * blast radius there, so they are what the regression pins.
 */
const FALSELY_CREDITED = [
  "/confirm-code",
  "/loading",
  "/player-roster",
  "/player-search",
  "/playground",
  "/recent-activity",
  "/register",
  "/shadow-team",
  WATCHLIST,
];

/** The 404 spec, reduced to the two navigations that caused the defect. */
const NOT_FOUND_SOURCE = [
  'const UNKNOWN_PATH = "/this-route-does-not-exist-e2e";',
  "await page.goto(UNKNOWN_PATH);",
  "await page.goto(`${UNKNOWN_PATH}-first`);",
  "await page.goto(`${UNKNOWN_PATH}-second`);",
].join("\n");

/** Thresholds mirroring the consumer's: a 54% Playwright gate. */
const THRESHOLDS = {
  playwright: { routes: 54 },
  maestro: { routes: 0 },
};

describe("an unresolved interpolation credits nothing", () => {
  it("does not match a route whose segment is a literal", () => {
    // The bug, at its smallest. `/watchlist` is covered only by a visit that
    // resolves to the word "watchlist"; a hole might resolve to anything, and
    // "anything" is not "that".
    expect(routeMatchesVisit(WATCHLIST, UNKNOWN_FIRST)).toBe(false);
    expect(routeMatchesVisit("/shadow-team", UNKNOWN_SECOND)).toBe(false);
  });

  it("still matches a route whose segment is dynamic", () => {
    // The legitimate case the old rule was reaching for, and the reason the fix
    // is a removal rather than a ban: `[id]` accepts any value already, so an
    // unknown one needs no special permission. Deleting the wildcard clause
    // must not cost this.
    expect(routeMatchesVisit(PLAYERS_ROUTE, PLAYERS_VISIT)).toBe(true);
    expect(
      routeMatchesVisit("/players/[id]/reports", "/players/${playerId}/reports")
    ).toBe(true);
    expect(routeMatchesVisit("/docs/[...slug]", "/docs/${a}/${b}")).toBe(true);
  });

  it("does not let a hole stand in for a literal that follows a dynamic one", () => {
    // A hole in the LAST position of `/players/${playerId}` must not satisfy
    // `/players/compare`: the first segment matches literally, the second is
    // dynamic-vs-hole, and only the route's own bracket may absorb it.
    expect(routeMatchesVisit("/players/compare", PLAYERS_VISIT)).toBe(false);
  });
});

describe("the coverage number moves", () => {
  it("credits none of the nine routes the 404 spec used to cover", () => {
    const visited = extractPlaywrightPaths(NOT_FOUND_SOURCE);
    // `page.goto(UNKNOWN_PATH)` is a bare identifier, not a string literal, so
    // the extractor never saw it. The two template navigations are the entire
    // input — and they were enough to certify nine screens.
    expect(visited).toEqual([UNKNOWN_FIRST, UNKNOWN_SECOND]);

    const verdict = evaluateE2eCoverage({
      routes: FALSELY_CREDITED,
      playwrightVisited: visited,
      maestroVisited: [],
      thresholds: THRESHOLDS,
    });

    // Was 9/9 at 100%, comfortably over the 54% gate. Is now 0/9, and the gate
    // fails — which is the correct verdict for a suite that visits none of them.
    expect(verdict.runners.playwright.covered).toBe(0);
    expect(verdict.runners.playwright.percentage).toBe(0);
    expect(verdict.runners.playwright.missing).toEqual(FALSELY_CREDITED);
    expect(verdict.runners.playwright.ok).toBe(false);
  });

  it("leaves real coverage of a dynamic route intact", () => {
    // The other half of "the number moves": it must move only where the credit
    // was false. A run whose specs really do visit the routes still scores.
    const verdict = evaluateE2eCoverage({
      routes: [PLAYERS_ROUTE, WATCHLIST],
      playwrightVisited: extractPlaywrightPaths(
        [
          "await page.goto(`/players/${playerId}`);",
          'page.goto("/watchlist");',
        ].join("\n")
      ),
      maestroVisited: [],
      thresholds: THRESHOLDS,
    });
    expect(verdict.runners.playwright.covered).toBe(2);
    expect(verdict.runners.playwright.ok).toBe(true);
  });
});

describe("what credited nothing is named, not dropped", () => {
  it("reports the unmatched navigation and the file it came from", () => {
    // Removing credit silently would be the same defect with the sign flipped:
    // a smaller number and nothing saying why. The author of the 404 spec sees
    // their own file named.
    expect(
      unmatchedVisits({
        routes: FALSELY_CREDITED,
        visits: [
          { path: UNKNOWN_FIRST, file: NOT_FOUND_SPEC },
          { path: UNKNOWN_SECOND, file: NOT_FOUND_SPEC },
        ],
      })
    ).toEqual([
      { path: UNKNOWN_FIRST, files: [NOT_FOUND_SPEC] },
      { path: UNKNOWN_SECOND, files: [NOT_FOUND_SPEC] },
    ]);
  });

  it("says nothing about a navigation that did match", () => {
    expect(
      unmatchedVisits({
        routes: [PLAYERS_ROUTE],
        visits: [{ path: PLAYERS_VISIT, file: "e2e/tests/player.spec.ts" }],
      })
    ).toEqual([]);
  });

  it("collapses one path reached from several files", () => {
    const second = "e2e/tests/other.spec.ts";
    expect(
      unmatchedVisits({
        routes: [WATCHLIST],
        visits: [
          { path: UNKNOWN_FIRST, file: second },
          { path: UNKNOWN_FIRST, file: NOT_FOUND_SPEC },
        ],
      })
    ).toEqual([{ path: UNKNOWN_FIRST, files: [NOT_FOUND_SPEC, second] }]);
  });

  it("names a typo'd literal too, not only an interpolation", () => {
    // The list is not `${`-specific. A renamed screen and a mistyped path leave
    // the same trace in a percentage and a different one here.
    expect(
      unmatchedVisits({
        routes: [WATCHLIST],
        visits: [{ path: "/watchlsit", file: NOT_FOUND_SPEC }],
      })
    ).toEqual([{ path: "/watchlsit", files: [NOT_FOUND_SPEC] }]);
  });
});
