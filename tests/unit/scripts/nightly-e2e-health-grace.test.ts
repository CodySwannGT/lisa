/**
 * The nightly e2e gate's truth table, rows 32-35: PER-SUITE first-seen grace.
 *
 * Bootstrap (§4, rows 23-25) is one flag for the whole workflow, and that made
 * the routine act of ADDING a suite a repository-wide wedge: the moment a
 * fourth suite lands in the `suites` table of an already-armed repo, its
 * evidence is missing (row 9) and every pull request is blocked until that
 * suite's first green nightly. The only escapes were re-opening the GLOBAL
 * window — which un-arms the three suites that were working — or burning an
 * audited bypass. Neither is a proportionate answer to adding a suite.
 *
 * Rows 32-35 close that without resurrecting acmeorga's forever-bootstrap: the
 * grace is anchored on a `first_seen` timestamp that may not be in the future,
 * it is bounded by the SAME `bootstrap_max_days` ceiling as the global window,
 * and a window beyond that ceiling FAILS as misconfiguration rather than being
 * clamped (the row-24 rule, applied per suite).
 *
 * Sibling of `nightly-e2e-health.test.ts` (rows 1-16), `…-api.test.ts`
 * (rows 17-20), `…-bypass.test.ts` (rows 21-25), `…-completeness.test.ts`
 * (row 26) and `…-issues.test.ts` (rows 27-31). Specification:
 * `docs/nightly-e2e-gate.md` §2 rows 32-35 and §4.1.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  type Finding,
  GREEN_FINDING,
  type GateModule,
  MISSING_FINDING,
  NOW,
  RED_FINDING,
  TEST_API,
  fakeResponse,
  loadGateModule,
} from "../../helpers/nightly-e2e-gate-harness";

/** Two days before `NOW`: a suite added this week. */
const RECENTLY = "2026-08-10T00:00:00Z";
/** Six weeks before `NOW`: a suite whose grace has long since lapsed. */
const LONG_AGO = "2026-07-01T00:00:00Z";
/** After `NOW`. A suite cannot have been first seen tomorrow. */
const TOMORROW = "2026-08-13T00:00:00Z";
/** The label the report is rendered with. */
const LABEL = "nightly-e2e-bypass";
/** The workflow file of the suite being added in the end-to-end cases. */
const NEW_WORKFLOW = "new-suite.yml";
/** The one green job every stubbed run reports. */
const GREEN_JOBS = Object.freeze({
  jobs: [{ name: "🧪 e2e", conclusion: "success" }],
});

describe("nightly e2e gate — truth table rows 32-35 (per-suite grace)", () => {
  let mod: GateModule;
  /** No global bootstrap window: every suite without grace is armed. */
  let armed: ReturnType<GateModule["resolveBootstrap"]>;

  beforeAll(async () => {
    mod = await loadGateModule();
    armed = mod.resolveBootstrap("", 30, NOW);
  });

  /**
   * Resolves one suite's grace at `NOW` against the default ceiling.
   *
   * @param suite - The suite's grace-bearing fields
   * @param maxDays - The effective `bootstrap_max_days`
   * @returns The resolved window
   */
  const graceFor = (
    suite: Record<string, unknown>,
    maxDays = 30
  ): ReturnType<GateModule["resolveSuiteGrace"]> =>
    mod.resolveSuiteGrace(suite, maxDays, NOW);

  /**
   * A finding with a resolved grace window attached, as `runGate` builds it.
   *
   * @param finding - The underlying finding
   * @param suite - The suite's grace-bearing fields
   * @returns The finding the verdict step sees
   */
  const withGrace = (
    finding: Finding,
    suite: Record<string, unknown>
  ): Finding => ({ ...finding, grace: graceFor(suite) });

  describe("row 32 — a suite inside its grace window does not block", () => {
    it("row 32: a new suite added to an ARMED repo does not wedge it", () => {
      // The wedge, stated as a verdict: one suite green, one suite added two
      // days ago with no nightly of its own yet, no global bootstrap window.
      const verdict = mod.decide(
        [
          GREEN_FINDING,
          withGrace(
            { ...MISSING_FINDING, label: "new suite" },
            {
              first_seen: RECENTLY,
            }
          ),
        ],
        { bootstrap: armed }
      );
      expect(verdict.blocked).toBe(false);
      expect(verdict.verdict).toBe("bootstrap");
      expect(verdict.findings[1]?.state).toBe("bootstrap");
      // The suite that was already working is untouched.
      expect(verdict.findings[0]?.state).toBe("pass");
    });

    it("row 32: the OTHER suites stay armed — grace is per suite, not global", () => {
      // This is the property the global window cannot give you: forgiving the
      // new suite must not forgive the three that were already gating.
      const verdict = mod.decide(
        [
          { ...MISSING_FINDING, label: "old suite" },
          withGrace(
            { ...MISSING_FINDING, label: "new suite" },
            {
              first_seen: RECENTLY,
            }
          ),
        ],
        { bootstrap: armed }
      );
      expect(verdict.blocked).toBe(true);
      expect(verdict.verdict).toBe("fail");
      expect(verdict.findings[0]?.state).toBe("unknown");
      expect(verdict.findings[1]?.state).toBe("bootstrap");
    });

    it("row 32: the grace expiry is ALWAYS on screen — there is no quiet grace", () => {
      const verdict = mod.decide(
        [
          withGrace(
            { ...MISSING_FINDING, label: "new suite" },
            {
              first_seen: RECENTLY,
            }
          ),
        ],
        { bootstrap: armed }
      );
      const report = mod.formatReport(verdict, {
        branch: BRANCH,
        bypassLabel: LABEL,
      });
      expect(report).toContain("2026-08-24T00:00:00.000Z");
      expect(report).toContain("grace");
    });

    it("row 32: a per-suite `grace_days` may only SHORTEN the window", () => {
      expect(graceFor({ first_seen: RECENTLY }).until).toBe(
        "2026-08-24T00:00:00.000Z"
      );
      const shortened = graceFor({ first_seen: RECENTLY, grace_days: 1 });
      expect(shortened.active).toBe(false);
      expect(shortened.until).toBe("2026-08-11T00:00:00.000Z");
    });
  });

  describe("row 33 — grace forgives ABSENCE of evidence, never FAILURE", () => {
    it("row 33: a red suite inside its grace window still blocks", () => {
      const verdict = mod.decide(
        [withGrace(RED_FINDING, { first_seen: RECENTLY })],
        { bootstrap: armed }
      );
      expect(verdict.blocked).toBe(true);
      expect(verdict.verdict).toBe("fail");
    });
  });

  describe("row 34 — a lapsed grace window blocks with no further action", () => {
    it("row 34: a suite first seen six weeks ago is armed again", () => {
      const grace = graceFor({ first_seen: LONG_AGO });
      expect(grace.active).toBe(false);
      expect(
        mod.decide([withGrace(MISSING_FINDING, { first_seen: LONG_AGO })], {
          bootstrap: armed,
        }).blocked
      ).toBe(true);
    });

    it("row 34: a long-lapsed `first_seen` is INERT, never an error", () => {
      // Cleaning the field up must be optional. A guard that fails on stale
      // config buys itself a churn commit per suite per month, and the first
      // person to hit it deletes the anchor rather than the window.
      expect(() =>
        graceFor({ first_seen: "2020-01-01T00:00:00Z" })
      ).not.toThrow();
    });
  });

  describe("row 35 — an unbounded or dishonest grace is MISCONFIGURATION", () => {
    it("row 35: a `first_seen` in the FUTURE fails, never quietly forgives", () => {
      // The anchor is what makes the window bounded. If it may sit in the
      // future, "first seen" becomes the hand-typed date this design exists to
      // avoid, and one string edit restores the forever-bootstrap.
      expect(() => graceFor({ first_seen: TOMORROW })).toThrow(/future/);
    });

    it("row 35: an unparseable `first_seen` fails", () => {
      expect(() => graceFor({ first_seen: "last tuesday" })).toThrow(
        /ISO-8601/
      );
    });

    it("row 35: a `grace_days` beyond the policy ceiling is rejected at validation", () => {
      // Rejected rather than clamped, exactly as row 24 rejects a bootstrap
      // window beyond the cap: a grace that outlives the ceiling IS the
      // forever-bootstrap, whatever it is called.
      expect(() =>
        mod.validateSuites(
          JSON.stringify([
            {
              label: "s",
              workflow: "e2e.yml",
              match: { mode: "run" },
              first_seen: RECENTLY,
              grace_days: 400,
            },
          ])
        )
      ).toThrow(/grace_days/);
    });

    it("row 35: a window beyond a TIGHTENED `bootstrap_max_days` fails too", () => {
      // The ceiling the caller actually configured, not just the source
      // constant: a repo that tightened the global cap to a week must not get
      // a fortnight of grace through the side door.
      expect(() =>
        graceFor({ first_seen: RECENTLY, grace_days: 14 }, 7)
      ).toThrow(/beyond `bootstrap_max_days`/);
    });

    it("row 35: `grace_days` without a `first_seen` anchor is rejected", () => {
      // A knob with no anchor is a gate configured differently than its author
      // believes — the same reason a typo'd key fails rather than defaulting.
      expect(() =>
        mod.validateSuites(
          JSON.stringify([
            {
              label: "s",
              workflow: "e2e.yml",
              match: { mode: "run" },
              grace_days: 7,
            },
          ])
        )
      ).toThrow(/first_seen/);
    });

    it("row 35: the grace ceiling IS the bootstrap ceiling — one forgiveness budget", () => {
      expect(mod.DEFAULT_SUITE_GRACE_DAYS).toBeLessThanOrEqual(
        mod.BOOTSTRAP_ABSOLUTE_MAX_DAYS
      );
    });
  });

  describe("the existing rows are untouched when no suite declares grace", () => {
    it("a table with no grace fields resolves to no window at all", () => {
      const grace = graceFor({});
      expect(grace.active).toBe(false);
      expect(grace.until).toBeNull();
      expect(grace.firstSeen).toBeNull();
    });

    it("an armed repo still blocks missing evidence, exactly as before", () => {
      expect(mod.decide([MISSING_FINDING], { bootstrap: armed }).blocked).toBe(
        true
      );
    });

    it("`validateSuites` still accepts every pre-grace table verbatim", () => {
      const table = JSON.stringify([
        { label: "s", workflow: "e2e.yml", match: { mode: "run" } },
      ]);
      expect(mod.validateSuites(table)).toHaveLength(1);
    });

    it("the contract version stays inside MAJOR 1 — adopters are not hard-failed", () => {
      // §8: this row can only turn a BLOCKING observation into a passing one
      // when the operator adds a NEW optional field, so an untouched table
      // behaves identically and both skew directions still fail closed. A major
      // bump would red-wall every adopter pinned to an older tag for a change
      // that cannot fail open.
      expect(mod.NIGHTLY_E2E_CONTRACT_VERSION.split(".")[0]).toBe("1");
      expect(mod.NIGHTLY_E2E_CONTRACT_VERSION).toBe("1.3.0");
    });
  });

  describe("the wedge, end to end through `runGate`", () => {
    it("row 32: adding a suite to an armed repo leaves the gate unblocked", async () => {
      // The pure verdict cases above prove the rule; this proves the WIRING —
      // that `runGate` resolves each suite's window and carries it into the
      // verdict. Before this row, `decide` saw one flag for every finding.
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> => {
        if (url.includes("/jobs")) {
          return fakeResponse(200, {}, GREEN_JOBS);
        }
        if (url.includes(NEW_WORKFLOW)) {
          return fakeResponse(200, {}, { workflow_runs: [] });
        }
        return fakeResponse(
          200,
          {},
          {
            workflow_runs: [
              {
                id: 7,
                conclusion: "success",
                created_at: new Date(Date.now() - 3_600_000).toISOString(),
                event: "schedule",
                head_branch: BRANCH,
              },
            ],
          }
        );
      };

      const verdict = (await mod.runGate(
        {
          GITHUB_TOKEN: "t",
          GITHUB_REPOSITORY: TEST_API.repo,
          NIGHTLY_BRANCH: BRANCH,
          // No global window: this repo is fully armed.
          NIGHTLY_BOOTSTRAP_UNTIL: "",
          NIGHTLY_SUITES: JSON.stringify([
            {
              label: "established",
              workflow: "maestro-e2e.yml",
              match: { mode: "run" },
            },
            {
              label: "new suite",
              workflow: NEW_WORKFLOW,
              match: { mode: "run" },
              first_seen: twoDaysAgo,
            },
          ]),
        },
        async () => undefined
      )) as { verdict: string; blocked: boolean; findings: readonly Finding[] };

      expect(verdict.blocked).toBe(false);
      expect(verdict.verdict).toBe("bootstrap");
      expect(verdict.findings[0]?.state).toBe("pass");
      expect(verdict.findings[1]?.state).toBe("bootstrap");
      expect(verdict.findings[1]?.reason).toBe("no_run");
    });

    it("row 34: the same repo blocks once that suite's grace has lapsed", async () => {
      const longAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> => {
        if (url.includes("/jobs")) {
          return fakeResponse(200, {}, GREEN_JOBS);
        }
        return fakeResponse(200, {}, { workflow_runs: [] });
      };

      const verdict = (await mod.runGate(
        {
          GITHUB_TOKEN: "t",
          GITHUB_REPOSITORY: TEST_API.repo,
          NIGHTLY_BRANCH: BRANCH,
          NIGHTLY_SUITES: JSON.stringify([
            {
              label: "no longer new",
              workflow: NEW_WORKFLOW,
              match: { mode: "run" },
              first_seen: longAgo,
            },
          ]),
        },
        async () => undefined
      )) as { verdict: string; blocked: boolean };

      expect(verdict.blocked).toBe(true);
      expect(verdict.verdict).toBe("fail");
    });
  });
});
