/**
 * The nightly e2e gate's truth table, rows 17-20: the gate's OWN failure modes.
 *
 * One ruling holds this whole file together: **"we could not check" must never
 * render as "it is fine".** An unreachable API, a rate limit, a token that
 * cannot read run history, a truncated job list and an unreadable `suites`
 * table are all RED — after a bounded retry where retrying could help, and
 * immediately where it could not.
 *
 * Sibling of `nightly-e2e-health.test.ts` (rows 1-16) and
 * `nightly-e2e-health-bypass.test.ts` (rows 21-25). Specification:
 * `docs/nightly-e2e-gate.md` §2 and §7.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  type GateModule,
  loadGateModule,
} from "../../helpers/nightly-e2e-gate-harness";

/** API coordinates with a tiny retry budget so the suite stays instant. */
const API = Object.freeze({
  apiUrl: "https://api.test",
  repo: "o/r",
  token: "t",
  maxAttempts: 3,
  maxPages: 5,
  retryMaxSeconds: 1,
});

/** A well-formed single-suite entry, reused by the validation cases. */
const ONE_SUITE = Object.freeze({
  label: "one",
  workflow: "a.yml",
  match: { mode: "run" },
});

/**
 * A no-op sleeper, so the retry path costs no wall-clock time.
 *
 * @returns A promise that resolves immediately
 */
const noWait = async (): Promise<void> => undefined;

/**
 * A fake `Response`.
 *
 * @param status - HTTP status
 * @param headers - Response headers, lowercase keys
 * @param body - JSON body
 * @returns A minimal Response-shaped object
 */
function response(
  status: number,
  headers: Record<string, string> = {},
  body: unknown = {}
): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

/**
 * Installs a stub `fetch`.
 *
 * @param responder - Produces a response, or an Error to throw, per attempt
 * @returns A reader for how many times fetch has been called so far
 */
function stubFetch(responder: (attempt: number) => unknown): {
  calls: () => number;
} {
  let attempts = 0;
  const stub = async (): Promise<unknown> => {
    attempts += 1;
    const result = responder(attempts);
    if (result instanceof Error) throw result;
    return result;
  };
  (globalThis as { fetch: unknown }).fetch = stub;
  return { calls: () => attempts };
}

describe("nightly e2e gate — truth table rows 17-20", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  describe("rows 17-19 — 'we could not check' is never 'it is fine'", () => {
    it("row 17: a 5xx is retried a bounded number of times and then FAILS", async () => {
      const state = stubFetch(() => response(503));
      await expect(mod.apiGet(API, "/x", noWait)).rejects.toThrow(/RED/);
      expect(state.calls()).toBe(3);
    });

    it("row 17: a network error is retried and then FAILS", async () => {
      const state = stubFetch(() => new Error("ECONNRESET"));
      await expect(mod.apiGet(API, "/x", noWait)).rejects.toThrow(
        /unreachable API as a green nightly/
      );
      expect(state.calls()).toBe(3);
    });

    it("row 17: a transient 5xx that recovers within the budget succeeds", async () => {
      stubFetch(attempt =>
        attempt < 3 ? response(503) : response(200, {}, { ok: true })
      );
      await expect(mod.apiGet(API, "/x", noWait)).resolves.toMatchObject({
        body: { ok: true },
      });
    });

    it("row 18: a rate-limited 403 is retried, then FAILS", async () => {
      const state = stubFetch(() =>
        response(403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1",
        })
      );
      await expect(mod.apiGet(API, "/x", noWait)).rejects.toThrow(/RED/);
      expect(state.calls()).toBe(3);
    });

    it("row 19: an auth 403 fails IMMEDIATELY — retrying cannot fix a token", async () => {
      const state = stubFetch(() => response(403));
      await expect(mod.apiGet(API, "/x", noWait)).rejects.toThrow(
        /permissions: actions: read/
      );
      expect(state.calls()).toBe(1);
    });

    it("a 404 is data, not an error — it is how row 11 is detected", async () => {
      stubFetch(() => response(404));
      await expect(mod.apiGet(API, "/x", noWait)).resolves.toBeNull();
    });

    it("a 404 mid-walk returns what was read, flagged INCOMPLETE, and does NOT blame the page cap", async () => {
      // Falling through to the page-cap throw would name a limit that had
      // nothing to do with it and discard every job already collected. The
      // `complete` flag is the part a caller cannot reconstruct from the jobs:
      // a list cut short at page 2 looks exactly like a list that ended there.
      const full = Array.from({ length: 100 }, (_unused, index) => ({
        name: `job-${index}`,
        conclusion: "success",
      }));
      stubFetch(attempt =>
        attempt === 1 ? response(200, {}, { jobs: full }) : response(404)
      );
      const read = await mod.fetchAllJobs({ ...API, maxPages: 3 }, 7, noWait);
      expect(read.jobs).toHaveLength(100);
      expect(read.complete).toBe(false);
    });

    it("a list that ends inside the page cap is COMPLETE", async () => {
      stubFetch(() =>
        response(200, {}, { jobs: [{ name: "only", conclusion: "success" }] })
      );
      const read = await mod.fetchAllJobs({ ...API, maxPages: 3 }, 7, noWait);
      expect(read.jobs).toHaveLength(1);
      expect(read.complete).toBe(true);
    });

    it("a truncated job list is RED rather than a partial read", async () => {
      // A matrix suite routinely exceeds one page, and a truncated job list
      // turns "the failing shard is on page 2" into a false green.
      const full = Array.from({ length: 100 }, (_unused, index) => ({
        name: `job-${index}`,
        conclusion: "success",
      }));
      stubFetch(() => response(200, {}, { jobs: full }));
      await expect(
        mod.fetchAllJobs({ ...API, maxPages: 2 }, 7, noWait)
      ).rejects.toThrow(/truncated job list can hide the failing shard/);
    });

    it("a rate-limit backoff is bounded by api_retry_max_seconds", () => {
      const throttled = {
        headers: {
          get: (name: string): string | null =>
            name.toLowerCase() === "retry-after" ? "3600" : null,
        },
      };
      expect(mod.retryDelayMs(throttled, 1, 60)).toBe(60_000);
    });
  });

  describe("security limits are SOURCE CONSTANTS, clamped in one place", () => {
    // Portfolio doctrine (WS-0a): the allowlist and any limits are source
    // constants, resolved at call time through ONE function so fail-closed only
    // has to be right once. `NIGHTLY_BOOTSTRAP_MAX_DAYS=100000` would otherwise
    // have restored exactly the forever-bootstrap this gate exists to delete.

    it("clamps every ceiling DOWN and never up", () => {
      const { limits, clamped } = mod.resolveSecurityLimits({
        bypassMaxHours: 10_000,
        bootstrapMaxDays: 100_000,
        freshnessHours: 99_999,
        apiMaxAttempts: 500,
        apiMaxPages: 100_000,
        // Unbounded, this parks the gate until the runner timeout: a required
        // check that never reports blocks every PR as effectively as a red one,
        // but with nothing to read.
        apiRetryMaxSeconds: 86_400,
      });
      expect(limits.bypassMaxHours).toBe(mod.BYPASS_ABSOLUTE_MAX_HOURS);
      expect(limits.bootstrapMaxDays).toBe(mod.BOOTSTRAP_ABSOLUTE_MAX_DAYS);
      expect(limits.freshnessHours).toBe(mod.ABSOLUTE_MAX_FRESHNESS_HOURS);
      expect(limits.apiMaxAttempts).toBe(mod.ABSOLUTE_MAX_API_ATTEMPTS);
      expect(limits.apiMaxPages).toBe(mod.ABSOLUTE_MAX_API_PAGES);
      expect(limits.apiRetryMaxSeconds).toBe(mod.ABSOLUTE_MAX_RETRY_SECONDS);
      expect(clamped).toHaveLength(6);
    });

    it("EVERY env-readable limit passes through the clamp — none bypasses it", () => {
      // The regression this pins: `NIGHTLY_API_MAX_PAGES` and
      // `NIGHTLY_API_RETRY_MAX_SECONDS` were read straight from the env after
      // the doctrine landed for the other four, so the file stated a rule it
      // did not keep.
      const settings = mod.resolveSettings({
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "o/r",
        NIGHTLY_BRANCH: "dev",
        NIGHTLY_SUITES: JSON.stringify([ONE_SUITE]),
        NIGHTLY_API_MAX_PAGES: "100000",
        NIGHTLY_API_RETRY_MAX_SECONDS: "86400",
        NIGHTLY_API_MAX_ATTEMPTS: "500",
      }) as {
        api: {
          maxPages: number;
          retryMaxSeconds: number;
          maxAttempts: number;
        };
      };
      expect(settings.api.maxPages).toBe(mod.ABSOLUTE_MAX_API_PAGES);
      expect(settings.api.retryMaxSeconds).toBe(mod.ABSOLUTE_MAX_RETRY_SECONDS);
      expect(settings.api.maxAttempts).toBe(mod.ABSOLUTE_MAX_API_ATTEMPTS);
    });

    it("leaves a TIGHTER request untouched, and says nothing about it", () => {
      const { limits, clamped } = mod.resolveSecurityLimits({
        bypassMaxHours: 4,
        bootstrapMaxDays: 7,
        freshnessHours: 12,
        apiMaxAttempts: 2,
        apiMaxPages: 3,
        apiRetryMaxSeconds: 5,
      });
      expect(limits).toEqual({
        bypassMaxHours: 4,
        bootstrapMaxDays: 7,
        freshnessHours: 12,
        apiMaxAttempts: 2,
        apiMaxPages: 3,
        apiRetryMaxSeconds: 5,
      });
      expect(clamped).toEqual([]);
    });

    it("a clamp is never silent — it reaches the settings the report renders", () => {
      const settings = mod.resolveSettings({
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "o/r",
        NIGHTLY_BRANCH: "dev",
        NIGHTLY_SUITES: JSON.stringify([ONE_SUITE]),
        NIGHTLY_BOOTSTRAP_MAX_DAYS: "100000",
      }) as { bootstrapMaxDays: number; clamped: readonly string[] };
      expect(settings.bootstrapMaxDays).toBe(mod.BOOTSTRAP_ABSOLUTE_MAX_DAYS);
      expect(settings.clamped[0]).toContain("cannot be raised");
    });

    it("the env cannot buy a longer bootstrap window than policy allows", () => {
      // The end-to-end version of the hole: raise the cap via the env, then try
      // to set a window a year out. The cap is clamped first, so the window is
      // still rejected.
      const settings = mod.resolveSettings({
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "o/r",
        NIGHTLY_BRANCH: "dev",
        NIGHTLY_SUITES: JSON.stringify([ONE_SUITE]),
        NIGHTLY_BOOTSTRAP_MAX_DAYS: "100000",
      }) as { bootstrapMaxDays: number };
      expect(() =>
        mod.resolveBootstrap(
          "2027-08-12T00:00:00Z",
          settings.bootstrapMaxDays,
          new Date("2026-08-12T12:00:00Z")
        )
      ).toThrow(/beyond `bootstrap_max_days`/);
    });
  });

  describe("row 20 — an unreadable `suites` table is RED", () => {
    /**
     * Wraps one suite entry as a table string.
     *
     * @param entry - The suite entry
     * @returns The JSON table
     */
    const table = (entry: Record<string, unknown>): string =>
      JSON.stringify([entry]);

    it("rejects an absent or empty table", () => {
      for (const raw of ["", "   ", undefined]) {
        expect(() => mod.validateSuites(raw)).toThrow(
          /gate with nothing to check must not report success/
        );
      }
    });

    it("rejects malformed JSON, a non-array, and an empty array", () => {
      expect(() => mod.validateSuites("{oops")).toThrow(/not valid JSON/);
      expect(() => mod.validateSuites('{"a":1}')).toThrow(
        /must be a JSON array/
      );
      expect(() => mod.validateSuites("[]")).toThrow(/must be a JSON array/);
    });

    it("rejects DUPLICATE labels", () => {
      const raw = JSON.stringify([
        { ...ONE_SUITE, label: "same" },
        { ...ONE_SUITE, label: "same", workflow: "b.yml" },
      ]);
      expect(() => mod.validateSuites(raw)).toThrow(/duplicate label/);
    });

    it("rejects a DUPLICATE workflow+match pair", () => {
      const raw = JSON.stringify([ONE_SUITE, { ...ONE_SUITE, label: "two" }]);
      expect(() => mod.validateSuites(raw)).toThrow(
        /duplicate workflow\+match/
      );
    });

    it("rejects an UNANCHORED or half-anchored regex", () => {
      // An unanchored regex is a substring test wearing a regex's clothes:
      // "Playwright" matches "Playwright (skipped placeholder)".
      for (const pattern of ["Playwright", "^Playwright", "Playwright$"]) {
        expect(() =>
          mod.validateSuites(
            table({ ...ONE_SUITE, match: { mode: "job_pattern", pattern } })
          )
        ).toThrow(/anchored at both ends/);
      }
    });

    it("rejects a regex that does not compile", () => {
      expect(() =>
        mod.validateSuites(
          table({
            ...ONE_SUITE,
            match: { mode: "job_pattern", pattern: "^([a-z$" },
          })
        )
      ).toThrow(/does not compile/);
    });

    it("rejects unknown keys rather than silently taking the default", () => {
      // A typo'd `freshnessHours` that silently takes the default is a gate
      // looser than its author believes.
      expect(() =>
        mod.validateSuites(table({ ...ONE_SUITE, freshnessHours: 4 }))
      ).toThrow(/unknown key/);
    });

    it("rejects a mode-inappropriate match key", () => {
      expect(() =>
        mod.validateSuites(
          table({ ...ONE_SUITE, match: { mode: "run", name: "x" } })
        )
      ).toThrow(/unknown key `name`/);
    });

    it("rejects a bad mode, a missing name, a missing pattern, a bad freshness and a bad sha", () => {
      const bad: readonly (readonly [Record<string, unknown>, RegExp])[] = [
        [{ match: { mode: "artifact" } }, /match\.mode/],
        [{ match: { mode: "job" } }, /match\.name/],
        [{ match: { mode: "job_pattern" } }, /match\.pattern/],
        [{ freshness_hours: 0 }, /freshness_hours/],
        [{ required_sha: "abc" }, /required_sha/],
      ];
      for (const [override, matcher] of bad) {
        expect(() =>
          mod.validateSuites(table({ ...ONE_SUITE, ...override }))
        ).toThrow(matcher);
      }
    });

    it("accepts a well-formed table", () => {
      const suites = mod.validateSuites(
        JSON.stringify([
          ONE_SUITE,
          {
            label: "two",
            workflow: "b.yml",
            match: { mode: "job", name: "X / Y" },
            freshness_hours: 12,
          },
        ])
      );
      expect(suites).toHaveLength(2);
      expect(Object.isFrozen(suites)).toBe(true);
    });
  });
});
