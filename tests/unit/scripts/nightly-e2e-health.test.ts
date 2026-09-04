/**
 * The nightly e2e gate's truth table, rows 1-16: what an OBSERVATION means.
 *
 * `docs/nightly-e2e-gate.md` §2 is the specification; this file and its
 * siblings `nightly-e2e-health-api.test.ts` (rows 17-20, the gate's own failure
 * modes), `nightly-e2e-health-bypass.test.ts` (rows 21-25, bootstrap and
 * bypass) and `nightly-e2e-health-completeness.test.ts` (row 26, a run-scoped
 * green must be a COMPLETE run) are the proof. Every `row N` case corresponds to the numbered row of
 * that table, so a behaviour change that is not also a documentation change
 * fails here. That pairing is the point: a gate's contract written only in
 * prose is a contract until the next refactor.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  type Finding,
  GREEN_JOB,
  type GateModule,
  type Job,
  NOW,
  REASON,
  type Run,
  STALE,
  STATE,
  loadGateModule,
  runWith,
} from "../../helpers/nightly-e2e-gate-harness";

/** The exact job name a `mode: "job"` suite watches in these cases. */
const WATCHED_JOB = "🎭 Browser Journeys";
/** An anchored matrix pattern for `mode: "job_pattern"` cases. */
const MATRIX_PATTERN = "^Maestro \\(.+\\)$";
describe("nightly e2e gate — truth table rows 1-16", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  /**
   * Assesses one suite against one observation.
   *
   * @param suite - Partial suite declaration; label and workflow are defaulted
   * @param observation - What the API returned for this suite
   * @param observation.run - The newest completed run, or null when there is none
   * @param observation.jobs - The run's jobs, for the job match modes
   * @param observation.workflowMissing - True when the API 404s the workflow file
   * @returns The finding
   *
   * The default job list is ONE GREEN JOB rather than an empty array: a
   * completed run always has jobs, and since row 26 a run-scoped suite reads
   * them. Defaulting to `[]` would make every row below assert against an
   * observation the API cannot produce.
   */
  function assess(
    suite: Record<string, unknown>,
    observation: {
      run?: Run | null;
      jobs?: readonly Job[];
      workflowMissing?: boolean;
    }
  ): Finding {
    return mod.assessSuite(
      { label: "suite", workflow: "e2e.yml", ...suite },
      { run: null, jobs: [GREEN_JOB], workflowMissing: false, ...observation },
      { branch: BRANCH, freshnessHours: 36, now: NOW }
    );
  }

  const runMode = { match: { mode: "run" } };

  describe("rows 1-8 — what a conclusion means", () => {
    it("row 1: a fresh success on the required branch passes", () => {
      expect(assess(runMode, { run: runWith("success") }).state).toBe(
        STATE.pass
      );
    });

    it.each([
      ["row 2", "failure"],
      ["row 3", "timed_out"],
      ["row 4", "action_required"],
      ["row 5", "startup_failure"],
    ])("%s: a `%s` conclusion fails", (_row, conclusion) => {
      const finding = assess(runMode, { run: runWith(conclusion) });
      expect(finding.state).toBe(STATE.fail);
      expect(finding.reason).toBe(REASON.runConclusion);
    });

    it("row 6: `cancelled` is unknown, never a pass — cancelling must not clear a gate", () => {
      const finding = assess(runMode, { run: runWith("cancelled") });
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.indecisive);
    });

    it("row 7: `skipped` is unknown, never a pass", () => {
      expect(assess(runMode, { run: runWith("skipped") }).state).toBe(
        STATE.unknown
      );
    });

    it("row 8: `neutral`, null, and any future conclusion are unknown", () => {
      for (const conclusion of ["neutral", "stale", null, "some_new_thing"]) {
        expect(assess(runMode, { run: runWith(conclusion) }).state).toBe(
          STATE.unknown
        );
      }
    });

    it("DECISIVE_CONCLUSIONS is the closed set the table names", () => {
      expect(
        [...mod.DECISIVE_CONCLUSIONS].slice().sort((a, b) => a.localeCompare(b))
      ).toEqual([
        "action_required",
        "failure",
        "startup_failure",
        "success",
        "timed_out",
      ]);
      for (const indecisive of ["cancelled", "skipped", "neutral", "stale"]) {
        expect(mod.DECISIVE_CONCLUSIONS.has(indecisive)).toBe(false);
      }
    });
  });

  describe("rows 9-16 — what a MISSING or WRONG run means", () => {
    it("row 9: no run at all is unknown", () => {
      expect(assess(runMode, { run: null }).reason).toBe(REASON.noRun);
    });

    it("row 10: a run outside the freshness window is unknown, even when green", () => {
      const finding = assess(runMode, {
        run: runWith("success", { created_at: STALE }),
      });
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.staleRun);
    });

    it("row 10: a per-suite freshness override narrows the window", () => {
      const run = runWith("success", { created_at: "2026-08-12T02:00:00Z" });
      expect(assess(runMode, { run }).state).toBe(STATE.pass);
      expect(assess({ ...runMode, freshness_hours: 4 }, { run }).reason).toBe(
        REASON.staleRun
      );
    });

    it("row 11: a workflow the API cannot find is a HARD fail, not missing evidence", () => {
      // Bootstrap must not forgive this: it means someone renamed or deleted
      // the suite out from under the gate.
      const finding = assess(runMode, { workflowMissing: true });
      expect(finding.state).toBe(STATE.fail);
      expect(finding.reason).toBe("workflow_not_found");
    });

    it("row 12: a renamed job (exact match finds nothing) is unknown", () => {
      const finding = assess(
        { match: { mode: "job", name: WATCHED_JOB } },
        {
          run: runWith("success"),
          jobs: [{ name: "🎭 Playwright", conclusion: "success" }],
        }
      );
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe("job_not_found");
    });

    it("row 13: a pattern matching ZERO jobs is unknown, never 'nothing to report'", () => {
      const finding = assess(
        { match: { mode: "job_pattern", pattern: MATRIX_PATTERN } },
        {
          run: runWith("success"),
          jobs: [{ name: "Playwright", conclusion: "success" }],
        }
      );
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe("pattern_matched_nothing");
    });

    it("row 14: any non-success match decides, and reports THAT job's url", () => {
      const finding = assess(
        { match: { mode: "job_pattern", pattern: MATRIX_PATTERN } },
        {
          run: runWith("success"),
          jobs: [
            { name: "Maestro (ios)", conclusion: "success", html_url: "u/ios" },
            {
              name: "Maestro (android)",
              conclusion: "failure",
              html_url: "u/android",
            },
          ],
        }
      );
      expect(finding.state).toBe(STATE.fail);
      expect(finding.url).toBe("u/android");
    });

    it("row 14: every match green passes", () => {
      const finding = assess(
        { match: { mode: "job_pattern", pattern: MATRIX_PATTERN } },
        {
          run: runWith("success"),
          jobs: [
            { name: "Maestro (ios)", conclusion: "success" },
            { name: "Maestro (android)", conclusion: "success" },
          ],
        }
      );
      expect(finding.state).toBe(STATE.pass);
    });

    it("a job-scoped finding NEVER reports the run's conclusion beside a job verdict", () => {
      // Found empirically smoking the guard against a real repo: a `ci.yml` run
      // concluded `failure` (Lighthouse) while the watched Lint job was green,
      // and the finding rendered `state: pass` next to `conclusion: failure`.
      // A gate that appears to contradict itself teaches readers to stop
      // trusting it, so a job-scoped finding reports the JOB's conclusion or
      // none at all.
      const passing = assess(
        { match: { mode: "job", name: WATCHED_JOB } },
        {
          run: runWith("failure"),
          jobs: [{ name: WATCHED_JOB, conclusion: "success" }],
        }
      );
      expect(passing.state).toBe(STATE.pass);
      expect(passing.conclusion).toBe("success");

      const missing = assess(
        { match: { mode: "job", name: WATCHED_JOB } },
        {
          run: runWith("failure"),
          jobs: [{ name: "other", conclusion: "success" }],
        }
      );
      expect(missing.reason).toBe("job_not_found");
      expect(missing.conclusion).toBeNull();
    });

    it("row 14: a green RUN whose watched JOB failed still fails", () => {
      // The reason `mode: job` exists: a workflow that also carries lint and
      // Lighthouse must not be judged by its own overall conclusion.
      const finding = assess(
        { match: { mode: "job", name: WATCHED_JOB } },
        {
          run: runWith("success"),
          jobs: [{ name: WATCHED_JOB, conclusion: "failure" }],
        }
      );
      expect(finding.state).toBe(STATE.fail);
    });

    it("row 15: a run on a different branch is unknown", () => {
      const finding = assess(runMode, {
        run: runWith("success", { head_branch: "someone-else" }),
      });
      expect(finding.reason).toBe("wrong_branch");
    });

    it("row 16: a stale SHA is unknown when `required_sha` is declared", () => {
      const finding = assess(
        { ...runMode, required_sha: "b".repeat(40) },
        { run: runWith("success") }
      );
      expect(finding.reason).toBe("stale_sha");
    });

    it("row 16: no `required_sha` means the SHA is not checked", () => {
      expect(assess(runMode, { run: runWith("success") }).state).toBe(
        STATE.pass
      );
    });
  });
});
