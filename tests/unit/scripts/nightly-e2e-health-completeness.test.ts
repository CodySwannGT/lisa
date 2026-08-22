/**
 * The nightly e2e gate's truth table, row 26: a run-scoped green must be a
 * COMPLETE run.
 *
 * **GitHub concludes a run `success` when its jobs were skipped.** So a suite
 * that narrowed itself finishes green having tested nothing it was asked about,
 * and a gate reading the run conclusion alone reports that as last night's
 * verdict. The shipped `maestro-e2e.yml` caller exposes a `platform` dispatch
 * picker (all | android | ios); `platform: android` makes the reusable suite's
 * preflight emit `run_ios=false`, the iOS job is SKIPPED, and the run still
 * concludes `success`. Read through `{"mode":"run"}`, that one dispatch cleared
 * a required merge gate for the platform it deliberately did not test —
 * acmeorga's trap (91874b83), a suite declaring itself green on evidence it
 * never gathered.
 *
 * The discriminator these cases pin is **"was this run PARTIAL?"**, never "was
 * this a dispatch?". Twice deliberately: a full unfiltered dispatch is the
 * documented unblock path (§7) and must keep counting, and the Actions runs API
 * exposes no `inputs` field at all, so the filter itself is unreadable without
 * parsing run logs — artifacts by another name, refused by §1.
 *
 * Sibling of `nightly-e2e-health.test.ts` (rows 1-16),
 * `…-api.test.ts` (rows 17-20) and `…-bypass.test.ts` (rows 21-25).
 * Specification: `docs/nightly-e2e-gate.md` §2 row 26 and §2.4.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  FRESH,
  type Finding,
  type GateModule,
  type Job,
  NOW,
  REASON,
  type Run,
  STATE,
  TEST_API,
  fakeResponse,
  loadGateModule,
  noWait,
  runWith,
} from "../../helpers/nightly-e2e-gate-harness";

/** The Android arm, green. */
const ANDROID: Job = Object.freeze({
  name: "🤖 Maestro Android",
  conclusion: "success",
});
/** The iOS arm's job name — the arm a `platform: android` dispatch skips. */
const IOS = "🍎 Maestro iOS";
/** The iOS arm as a filtered dispatch leaves it. */
const IOS_SKIPPED: Job = Object.freeze({
  name: IOS,
  conclusion: "skipped",
  html_url: "u/ios",
});
/** The iOS arm as a full run leaves it. */
const IOS_GREEN: Job = Object.freeze({ name: IOS, conclusion: "success" });
/** The iOS arm failing under `continue-on-error` inside a green run. */
const IOS_FAILED: Job = Object.freeze({ name: IOS, conclusion: "failure" });
/** A bootstrap window that is closed. */
const NO_BOOTSTRAP = Object.freeze({
  active: false,
  until: null,
  expiresInDays: null,
});

describe("nightly e2e gate — truth table row 26", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  /**
   * Assesses a run-scoped suite against one observation.
   *
   * @param run - The newest completed run
   * @param jobs - The run's jobs, as the API reports them
   * @param suite - Suite overrides; run-scoped unless replaced
   * @returns The finding
   */
  function assess(
    run: Run,
    jobs: readonly Job[],
    suite: Record<string, unknown> = { match: { mode: "run" } }
  ): Finding {
    return mod.assessSuite(
      { label: "suite", workflow: "maestro-e2e.yml", ...suite },
      { run, jobs, workflowMissing: false },
      { branch: BRANCH, freshnessHours: 36, now: NOW }
    );
  }

  it("row 26: a platform-filtered dispatch does NOT satisfy the gate", () => {
    const finding = assess(runWith("success", { event: "workflow_dispatch" }), [
      ANDROID,
      IOS_SKIPPED,
    ]);
    expect(finding.state).toBe(STATE.unknown);
    expect(finding.reason).toBe(REASON.incompleteRun);
    // The offending job is named by its conclusion and its url, so the report
    // points at the arm that did not run rather than at the run's summary.
    expect(finding.conclusion).toBe("skipped");
    expect(finding.url).toBe("u/ios");
  });

  it("row 26: that filtered dispatch BLOCKS once it reaches the verdict", () => {
    const finding = assess(runWith("success", { event: "workflow_dispatch" }), [
      ANDROID,
      IOS_SKIPPED,
    ]);
    const verdict = mod.decide([finding], { bootstrap: NO_BOOTSTRAP });
    expect(verdict.blocked).toBe(true);
    expect(verdict.verdict).toBe("fail");
  });

  it("row 26: a FULL unfiltered dispatch still counts — the unblock path holds", () => {
    // §7: a dispatch counts exactly like a schedule, which is what makes the
    // gate escapable by FIXING rather than by waiting for tomorrow's cron.
    // Narrowing that to "dispatches never count" would delete the escape.
    const finding = assess(runWith("success", { event: "workflow_dispatch" }), [
      ANDROID,
      IOS_GREEN,
    ]);
    expect(finding.state).toBe(STATE.pass);
    expect(finding.reason).toBe(REASON.runConclusion);
  });

  it("row 26: a full scheduled run still counts", () => {
    const finding = assess(runWith("success", { event: "schedule" }), [
      ANDROID,
      IOS_GREEN,
    ]);
    expect(finding.state).toBe(STATE.pass);
  });

  it("row 26: a run whose jobs are unreadable is not a pass either", () => {
    // A completed run always has at least one job, so an empty list means the
    // gate could not read them — "we could not check" never renders as "it is
    // fine" (§2.1). The finding also withholds the RUN's `success`, because
    // "⚪ … [success]" is the gate contradicting itself.
    const finding = assess(runWith("success"), []);
    expect(finding.state).toBe(STATE.unknown);
    expect(finding.reason).toBe(REASON.incompleteRun);
    expect(finding.conclusion).toBeNull();
  });

  it("row 26: a job that FAILED inside a `success` run is red, not merely unknown", () => {
    // `continue-on-error: true` on a job leaves the run green while the job
    // failed. That is evidence of failure, so bootstrap must never forgive it.
    const finding = assess(runWith("success"), [ANDROID, IOS_FAILED]);
    expect(finding.state).toBe(STATE.fail);
    expect(finding.reason).toBe(REASON.incompleteRun);
  });

  it("row 26: bootstrap forgives a SKIPPED arm and never a FAILED one", () => {
    const bootstrap = {
      active: true,
      until: "2026-08-26T00:00:00Z",
      expiresInDays: 14,
    };
    const skipped = assess(runWith("success"), [ANDROID, IOS_SKIPPED]);
    const failed = assess(runWith("success"), [ANDROID, IOS_FAILED]);
    expect(mod.decide([skipped], { bootstrap }).blocked).toBe(false);
    expect(mod.decide([failed], { bootstrap }).blocked).toBe(true);
  });

  it("row 26 leaves the job-scoped modes alone", () => {
    // A `mode: "job"` suite has already declared WHICH jobs are the suite, so
    // holding it to the skips of jobs it never claimed — a lint job, a
    // Lighthouse job — would redden gates that are working correctly.
    const watched = "🎭 Browser Journeys";
    const finding = assess(
      runWith("success"),
      [
        { name: watched, conclusion: "success" },
        { name: "🧹 Lint", conclusion: "skipped" },
      ],
      { match: { mode: "job", name: watched } }
    );
    expect(finding.state).toBe(STATE.pass);
  });

  it("row 26: the observation step gathers jobs for a run-scoped suite", async () => {
    // The pure classifier can only judge completeness from jobs it was given,
    // so `observe` has to gather them for `mode: "run"` too. Before row 26 it
    // deliberately did not, which is what made the filtered dispatch read green.
    const paths: string[] = [];
    let calls = 0;
    (globalThis as { fetch: unknown }).fetch = async (
      url: string
    ): Promise<unknown> => {
      calls += 1;
      paths.push(url);
      if (url.includes("/jobs")) {
        return fakeResponse(200, {}, { jobs: [IOS_SKIPPED] });
      }
      return fakeResponse(
        200,
        {},
        {
          workflow_runs:
            calls === 1
              ? [
                  {
                    id: 42,
                    conclusion: "success",
                    created_at: FRESH,
                    event: "schedule",
                    head_branch: BRANCH,
                  },
                ]
              : [],
        }
      );
    };

    const observed = await mod.observe(
      TEST_API,
      [{ label: "one", workflow: "maestro-e2e.yml", match: { mode: "run" } }],
      BRANCH,
      noWait
    );
    expect(paths.some(url => url.includes("/actions/runs/42/jobs"))).toBe(true);
    expect(observed[0]?.jobs).toEqual([IOS_SKIPPED]);
  });
});
