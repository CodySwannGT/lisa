/**
 * The nightly e2e gate's truth table, rows 41-42: the gate scores the newest
 * CONCLUSIVE run, not merely the newest one.
 *
 * Measured on 2026-08-29 in a repository consuming the guard. Two runs of the
 * same native suite, seven seconds apart: the first concluded `success` with all
 * eight jobs green — the whole suite executed — and the second concluded
 * `cancelled` with a single cancelled preflight job, because the suite's
 * `concurrency` group keeps only ONE pending run and displaces the rest. The
 * second run tested nothing, but it was the newest completed run, so the gate
 * scored it and reported `⚪ UNKNOWN [cancelled]` over a suite that had genuinely
 * passed. Being a required status check, that blocked every merge for ~3 hours.
 *
 * Refusing to score a cancellation green is correct and is NOT what changes here
 * (rows 6-8 are untouched). The defect is one layer upstream — selection — and
 * the discriminator is EVIDENCE rather than a status allowlist, because
 * `cancelled` is overloaded across at least three causes and only one of them
 * (a displaced duplicate that tested nothing) may ever be walked past.
 *
 * The control that matters most is `walks-past-nothing-that-tested-something`:
 * a run killed part-way through is SCORED, not skipped in favour of an older
 * green. Without it this fix would degrade into "skip cancellations until
 * something green turns up", which relaxes the gate — the opposite failure, and
 * a worse one.
 *
 * Sibling of `nightly-e2e-health.test.ts` (rows 1-16), `…-api.test.ts`
 * (rows 17-20) and `…-completeness.test.ts` (row 26).
 * Specification: `docs/nightly-e2e-gate.md` §2 rows 41-42 and §2.6.
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
  STALE,
  STATE,
  TEST_API,
  fakeResponse,
  loadGateModule,
  noWait,
} from "../../helpers/nightly-e2e-gate-harness";
import { observeContext } from "../../helpers/nightly-e2e-selection-harness";

/** The run that tested everything: eight jobs, all green. */
const PASSED_RUN: Run = Object.freeze({
  id: 33226168060,
  conclusion: "success",
  created_at: "2026-08-12T06:00:00Z",
  html_url: "https://example.test/run/33226168060",
  event: "workflow_dispatch",
  head_branch: BRANCH,
});

/** Its jobs, as the real run reported them. */
const PASSED_JOBS: readonly Job[] = Object.freeze(
  Array.from({ length: 8 }, (_unused, index) => ({
    name: `shard-${index}`,
    conclusion: "success",
  }))
);

/** The displaced duplicate: one cancelled preflight job, nothing executed. */
const DISPLACED_RUN: Run = Object.freeze({
  id: 33226173248,
  conclusion: "cancelled",
  created_at: "2026-08-12T06:00:07Z",
  html_url: "https://example.test/run/33226173248",
  event: "workflow_dispatch",
  head_branch: BRANCH,
});

/** Its job list, as the real run reported it. */
const DISPLACED_JOBS: readonly Job[] = Object.freeze([
  { name: "preflight", conclusion: "cancelled" },
]);

/** The bypass label the report renderer is handed; never exercised here. */
const BYPASS_LABEL = "nightly-e2e-bypass";

/** The evaluation context every case here bounds its walk with. */
const CONTEXT = observeContext(NOW);

/** The label both arms of a native suites table carry. */
const SUITE_LABEL = "Maestro native e2e";

/** A run-scoped suite, the shape both arms of a native suites table use. */
const RUN_SUITE = Object.freeze({
  label: SUITE_LABEL,
  workflow: "maestro-e2e.yml",
  match: Object.freeze({ mode: "run" }),
});

/** A `job_pattern`-scoped suite over the same workflow. */
const PATTERN_SUITE = Object.freeze({
  label: SUITE_LABEL,
  workflow: "maestro-e2e.yml",
  match: Object.freeze({ mode: "job_pattern", pattern: "^shard-" }),
});

/** The artifacts path fragment every stub answers with an empty list. */
const ARTIFACTS_PATH = "/artifacts";

/** The only run-list query the stubs return history for. */
const DISPATCH_QUERY = "event=workflow_dispatch";

/**
 * Installs a stubbed Actions API over a fixed set of runs and their jobs.
 *
 * Runs are returned for the `workflow_dispatch` event only; the `schedule`
 * query gets an empty page, which is exactly what the measured repository
 * looked like. Every recorded URL is returned so the cases can prove which runs
 * were and were not read.
 *
 * @param runs - Completed runs, in whatever order the API would list them
 * @param jobsByRunId - Each run's jobs
 * @returns The URLs the guard requested, in call order
 */
function stubActions(
  runs: readonly Run[],
  jobsByRunId: Readonly<Record<number, readonly Job[]>>
): string[] {
  const paths: string[] = [];
  (globalThis as { fetch: unknown }).fetch = async (
    url: string
  ): Promise<unknown> => {
    paths.push(url);
    const jobMatch = /\/actions\/runs\/(\d+)\/jobs/u.exec(url);
    if (jobMatch) {
      const id = Number(jobMatch[1]);
      return fakeResponse(200, {}, { jobs: jobsByRunId[id] ?? [] });
    }
    if (url.includes(ARTIFACTS_PATH)) {
      return fakeResponse(200, {}, { artifacts: [] });
    }
    return fakeResponse(
      200,
      {},
      {
        workflow_runs: url.includes(DISPATCH_QUERY) ? [...runs] : [],
      }
    );
  };
  return paths;
}

/**
 * Installs a stubbed Actions API whose run history differs PER WORKFLOW.
 *
 * `stubActions` returns one history to every workflow, which cannot express the
 * state that matters most here: two arms of the same suites table in different
 * conditions at the same instant. Keying on the workflow file is the whole
 * point — a selection that resolved "newest conclusive" across arms rather than
 * within each one would ride one arm's older success past the other arm's
 * genuine failure, turning a true red into a false green.
 *
 * @param armsByWorkflow - Each workflow file's completed runs, newest-first
 * @param jobsByRunId - Every run's jobs, across all arms
 * @returns The URLs the guard requested, in call order
 */
function stubArms(
  armsByWorkflow: Readonly<Record<string, readonly Run[]>>,
  jobsByRunId: Readonly<Record<number, readonly Job[]>>
): string[] {
  const paths: string[] = [];
  (globalThis as { fetch: unknown }).fetch = async (
    url: string
  ): Promise<unknown> => {
    paths.push(url);
    const jobMatch = /\/actions\/runs\/(\d+)\/jobs/u.exec(url);
    if (jobMatch) {
      return fakeResponse(
        200,
        {},
        { jobs: jobsByRunId[Number(jobMatch[1])] ?? [] }
      );
    }
    if (url.includes(ARTIFACTS_PATH)) {
      return fakeResponse(200, {}, { artifacts: [] });
    }
    const workflow = Object.keys(armsByWorkflow).find(file =>
      url.includes(`/workflows/${encodeURIComponent(file)}/runs`)
    );
    return fakeResponse(
      200,
      {},
      {
        workflow_runs:
          workflow !== undefined && url.includes(DISPATCH_QUERY)
            ? [...(armsByWorkflow[workflow] ?? [])]
            : [],
      }
    );
  };
  return paths;
}

describe("nightly e2e gate — rows 41-42: selection reads evidence, not recency", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  describe("runProducedEvidence — the discriminator", () => {
    it("treats every decisive run conclusion as evidence, `failure` included", () => {
      // Load-bearing: nothing here may skip a red run to find an older green.
      for (const conclusion of mod.DECISIVE_CONCLUSIONS) {
        expect(
          mod.runProducedEvidence({ conclusion }, [
            { name: "j", conclusion: "cancelled" },
          ])
        ).toBe(true);
      }
    });

    it("treats an indecisive run with one decisive job as PARTIAL evidence", () => {
      // A suite killed at its own `timeout-minutes` ceiling tested most of
      // itself. It is scoreable, and it will block — walking past it to an
      // older green would relax the gate.
      expect(
        mod.runProducedEvidence({ conclusion: "cancelled" }, [
          { name: "android", conclusion: "success" },
          { name: "ios", conclusion: "cancelled" },
        ])
      ).toBe(true);
    });

    it("treats an indecisive run with no decisive job as having tested nothing", () => {
      expect(mod.runProducedEvidence(DISPLACED_RUN, DISPLACED_JOBS)).toBe(
        false
      );
    });

    it("treats an unread job list as scoreable — fail-closed", () => {
      // A completed run always has at least one job, so an empty list is an
      // unread one. "We could not check" is never grounds to skip a run: if it
      // were, an artifacts/jobs outage would silently walk the gate backwards
      // through history until it found a green.
      expect(mod.runProducedEvidence(DISPLACED_RUN, [])).toBe(true);
      expect(mod.runProducedEvidence(DISPLACED_RUN, null)).toBe(true);
    });

    it("treats a PARTIALLY read job list as scoreable — the same fail-closed rule", () => {
      // The dangerous shape: page 1 holds nothing decisive and page 2 would not
      // load. The absence of a verdict among what was read is not evidence that
      // the run tested nothing — the failing shard may be on the page that
      // 404'd — so this may not be walked past.
      expect(
        mod.runProducedEvidence(DISPLACED_RUN, DISPLACED_JOBS, false)
      ).toBe(true);
      // And the completeness flag only ever ADDS scoreability: a fully read
      // list with nothing decisive is still skipped.
      expect(mod.runProducedEvidence(DISPLACED_RUN, DISPLACED_JOBS, true)).toBe(
        false
      );
    });

    it("counts how many jobs reached a verdict, for the audit line", () => {
      expect(mod.countDecisiveJobs(DISPLACED_JOBS)).toBe(0);
      expect(mod.countDecisiveJobs(PASSED_JOBS)).toBe(8);
      expect(mod.countDecisiveJobs(null)).toBe(0);
    });
  });

  describe("observe — the walk", () => {
    it("row 41: scores the pass a no-evidence cancel displaced 7s later", async () => {
      stubActions([DISPLACED_RUN, PASSED_RUN], {
        [PASSED_RUN.id as number]: PASSED_JOBS,
        [DISPLACED_RUN.id as number]: DISPLACED_JOBS,
      });

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.run?.id).toBe(PASSED_RUN.id);
      expect(observation?.jobs).toEqual(PASSED_JOBS);
      expect(observation?.selection).toEqual({
        runId: PASSED_RUN.id,
        conclusion: "success",
        createdAt: PASSED_RUN.created_at,
        decisiveJobs: 8,
        totalJobs: 8,
        fellBack: false,
        skipped: [
          {
            runId: DISPLACED_RUN.id,
            conclusion: "cancelled",
            createdAt: DISPLACED_RUN.created_at,
            decisiveJobs: 0,
            totalJobs: 1,
          },
        ],
      });
    });

    it("does NOT walk past a run whose second jobs page 404s", async () => {
      // The selection walk's own outage case, and the one that could turn this
      // fix into a regression: 100 indecisive jobs on page 1 and an unreadable
      // page 2 read, by inspection, exactly like "this run tested nothing".
      // Skipping on that reading would hide a `failure` sitting on the page
      // that would not load behind an older green — the false green this whole
      // file exists to prevent, reintroduced one layer down.
      const truncated: Run = {
        ...DISPLACED_RUN,
        id: 950,
        conclusion: "cancelled",
      };
      const firstPage: readonly Job[] = Object.freeze(
        Array.from({ length: 100 }, (_unused, index) => ({
          name: `shard-${index}`,
          conclusion: "cancelled",
        }))
      );
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> => {
        const jobMatch = /\/actions\/runs\/(\d+)\/jobs/u.exec(url);
        if (jobMatch) {
          const id = Number(jobMatch[1]);
          if (id !== truncated.id) {
            return fakeResponse(200, {}, { jobs: PASSED_JOBS });
          }
          // Page 1 is a full page of nothing decisive; page 2 is gone.
          // Read the page number off the `page=` parameter specifically —
          // `per_page=100` also contains the characters `page=1`.
          const page = Number(/[?&]page=(\d+)/u.exec(url)?.[1] ?? 1);
          return page === 1
            ? fakeResponse(200, {}, { jobs: firstPage })
            : fakeResponse(404);
        }
        if (url.includes(ARTIFACTS_PATH)) {
          return fakeResponse(200, {}, { artifacts: [] });
        }
        return fakeResponse(
          200,
          {},
          {
            workflow_runs: url.includes(DISPATCH_QUERY)
              ? [truncated, PASSED_RUN]
              : [],
          }
        );
      };

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      // The unreadable run is SCORED, not skipped, and the older green never
      // becomes the verdict.
      expect(observation?.run?.id).toBe(truncated.id);
      expect(observation?.selection?.skipped).toEqual([]);
      expect(observation?.selection?.fellBack).toBe(false);
      const finding = mod.assessSuite(RUN_SUITE, observation ?? {}, {
        branch: BRANCH,
        freshnessHours: CONTEXT.freshnessHours,
        now: NOW,
      });
      expect(finding.state).not.toBe(STATE.pass);
    });

    it("refuses to call a SUCCESS run green when its jobs were only partly read", async () => {
      // The false green one layer below selection. Selection is satisfied here
      // — a decisive `success` conclusion is always scoreable — so the run
      // reaches `assessSuite`, which argues green from the jobs it can see. If
      // page 1 is all green and page 2 will not load, the failing shard hides
      // on the page that 404'd and the suite reports a pass it did not earn.
      const truncated: Run = { ...PASSED_RUN, id: 960, conclusion: "success" };
      const firstPage: readonly Job[] = Object.freeze(
        Array.from({ length: 100 }, (_unused, index) => ({
          name: `shard-${index}`,
          conclusion: "success",
        }))
      );
      (globalThis as { fetch: unknown }).fetch = async (
        url: string
      ): Promise<unknown> => {
        if (/\/actions\/runs\/(\d+)\/jobs/u.test(url)) {
          // `per_page=100` also contains `page=1`, so read the page number off
          // the `page=` parameter rather than substring-matching the URL.
          const page = Number(/[?&]page=(\d+)/u.exec(url)?.[1] ?? 1);
          return page === 1
            ? fakeResponse(200, {}, { jobs: firstPage })
            : fakeResponse(404);
        }
        if (url.includes(ARTIFACTS_PATH)) {
          return fakeResponse(200, {}, { artifacts: [] });
        }
        return fakeResponse(
          200,
          {},
          { workflow_runs: url.includes(DISPATCH_QUERY) ? [truncated] : [] }
        );
      };

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );
      expect(observation?.jobsComplete).toBe(false);

      const context = {
        branch: BRANCH,
        freshnessHours: CONTEXT.freshnessHours,
        now: NOW,
      };
      // Both match modes argue green from the jobs that were read, so both
      // must refuse it.
      for (const suite of [RUN_SUITE, PATTERN_SUITE]) {
        const finding = mod.assessSuite(suite, observation ?? {}, context);
        expect(finding.state).toBe(STATE.unknown);
        expect(finding.reason).toBe(REASON.incompleteRun);
      }
    });

    it("row 41 is match-mode agnostic — `job_pattern` selects the same run", async () => {
      // Both arms of a native suites table go through one selection, so a fix
      // that only reached `mode: "run"` would leave half the table red.
      stubActions([DISPLACED_RUN, PASSED_RUN], {
        [PASSED_RUN.id as number]: PASSED_JOBS,
        [DISPLACED_RUN.id as number]: DISPLACED_JOBS,
      });

      const [observation] = await mod.observe(
        TEST_API,
        [PATTERN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.run?.id).toBe(PASSED_RUN.id);
      const finding = mod.assessSuite(PATTERN_SUITE, observation ?? {}, {
        branch: BRANCH,
        freshnessHours: CONTEXT.freshnessHours,
        now: NOW,
      });
      expect(finding.state).toBe(STATE.pass);
    });

    it("stops at the FIRST run with evidence rather than hunting for a green", async () => {
      // The negative control. A genuine `failure` behind a displacing cancel
      // must be reported as that failure — not skipped, and not misattributed
      // to `[cancelled]` as the defect did.
      const failed: Run = { ...PASSED_RUN, id: 900, conclusion: "failure" };
      stubActions([DISPLACED_RUN, failed], {
        900: [{ name: "shard-0", conclusion: "failure" }],
        [DISPLACED_RUN.id as number]: DISPLACED_JOBS,
      });

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );
      const finding = mod.assessSuite(RUN_SUITE, observation ?? {}, {
        branch: BRANCH,
        freshnessHours: CONTEXT.freshnessHours,
        now: NOW,
      });

      expect(finding.state).toBe(STATE.fail);
      expect(finding.conclusion).toBe("failure");
      expect(finding.reason).toBe(REASON.runConclusion);
    });

    it("scores a run killed part-way rather than reaching past it for a green", async () => {
      // THE control that matters most. Six jobs succeeded and one was
      // cancelled: this run tested most of the suite and reached no verdict, so
      // it is partial evidence — scoreable, blocking, and NOT walked past. If
      // it were skipped, the older green below would clear the gate for a night
      // that never finished.
      const killed: Run = { ...DISPLACED_RUN, id: 901 };
      const killedJobs: readonly Job[] = Object.freeze([
        ...Array.from({ length: 6 }, (_unused, index) => ({
          name: `shard-${index}`,
          conclusion: "success",
        })),
        { name: "shard-6", conclusion: "cancelled" },
      ]);
      stubActions([killed, PASSED_RUN], {
        901: killedJobs,
        [PASSED_RUN.id as number]: PASSED_JOBS,
      });

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.run?.id).toBe(901);
      expect(observation?.selection?.skipped).toEqual([]);
      const finding = mod.assessSuite(RUN_SUITE, observation ?? {}, {
        branch: BRANCH,
        freshnessHours: CONTEXT.freshnessHours,
        now: NOW,
      });
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.indecisive);
    });

    it("row 42: falls back to the newest run when nothing in the window is conclusive", async () => {
      const olderDisplaced: Run = {
        ...DISPLACED_RUN,
        id: 902,
        created_at: "2026-08-12T05:00:00Z",
      };
      stubActions([DISPLACED_RUN, olderDisplaced], {
        [DISPLACED_RUN.id as number]: DISPLACED_JOBS,
        902: DISPLACED_JOBS,
      });

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.run?.id).toBe(DISPLACED_RUN.id);
      expect(observation?.selection?.fellBack).toBe(true);
      // The run that was scored is never also listed as skipped.
      expect(observation?.selection?.skipped.map(entry => entry.runId)).toEqual(
        [902]
      );
      const finding = mod.assessSuite(RUN_SUITE, observation ?? {}, {
        branch: BRANCH,
        freshnessHours: CONTEXT.freshnessHours,
        now: NOW,
      });
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.indecisive);
    });

    it("row 42: never leaves the freshness window to find a conclusive run", async () => {
      // A conclusive `success` outside the window must stay unreachable. The
      // walk's second bound: without it a stale green could hold the gate open
      // indefinitely, which is the opposite failure and a worse one.
      const staleGreen: Run = {
        ...PASSED_RUN,
        id: 903,
        created_at: STALE,
      };
      const paths = stubActions([DISPLACED_RUN, staleGreen], {
        [DISPLACED_RUN.id as number]: DISPLACED_JOBS,
        903: PASSED_JOBS,
      });
      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.run?.id).toBe(DISPLACED_RUN.id);
      expect(paths.some(url => url.includes("/runs/903/jobs"))).toBe(false);
      const finding = mod.assessSuite(RUN_SUITE, observation ?? {}, {
        branch: BRANCH,
        freshnessHours: CONTEXT.freshnessHours,
        now: NOW,
      });
      expect(finding.state).not.toBe(STATE.pass);
    });

    it("reads one run's jobs when the newest run is already conclusive", async () => {
      // The walk must not make the ordinary night more expensive than the
      // single-run read it replaced.
      const paths = stubActions([PASSED_RUN], {
        [PASSED_RUN.id as number]: PASSED_JOBS,
      });

      await mod.observe(TEST_API, [RUN_SUITE], BRANCH, CONTEXT, noWait);

      expect(paths.filter(url => url.includes("/jobs")).length).toBe(1);
    });

    it("asks the runs API for a bounded PAGE, not a single run", async () => {
      const paths = stubActions([PASSED_RUN], {
        [PASSED_RUN.id as number]: PASSED_JOBS,
      });

      await mod.observe(TEST_API, [RUN_SUITE], BRANCH, CONTEXT, noWait);

      const runList = paths.find(url => url.includes("/runs?"));
      expect(runList).toContain(`per_page=${mod.RUN_CANDIDATE_PAGE_SIZE}`);
      expect(mod.RUN_CANDIDATE_PAGE_SIZE).toBeGreaterThan(1);
    });

    it("reports a workflow whose every event 404s as missing, with no selection", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(404, {}, {});

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.workflowMissing).toBe(true);
      expect(observation?.selection).toBeUndefined();
    });

    it("reports an empty run history with no selection to render", async () => {
      stubActions([], {});

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.run).toBeNull();
      expect(observation?.selection).toBeUndefined();
    });
  });

  describe("the gate says what it selected", () => {
    it("names the scored run and every skip, on a CLEAN report", async () => {
      // The original failure was silent. A gate that quietly changes which run
      // it scores is the same class of defect one layer down, so the selection
      // prints on greens too.
      const line = mod.formatSelection({
        runId: 33226168060,
        conclusion: "success",
        createdAt: "2026-08-29T01:20:58Z",
        fellBack: false,
        skipped: [
          {
            runId: 33226173248,
            conclusion: "cancelled",
            createdAt: "2026-08-29T01:21:05Z",
            decisiveJobs: 0,
            totalJobs: 1,
          },
        ],
      });

      expect(line).toBe(
        "↳ scored run 33226168060 (success, 2026-08-29T01:20:58Z); skipped 33226173248 [cancelled — 0 of 1 job(s) reached a verdict, so it tested nothing]"
      );
    });

    it("says so when it fell back for want of a conclusive run", () => {
      const line = mod.formatSelection({
        runId: 9001,
        conclusion: "cancelled",
        createdAt: "2026-08-29T01:21:05Z",
        fellBack: true,
        skipped: [
          {
            runId: 9002,
            conclusion: "cancelled",
            createdAt: "2026-08-29T01:22:05Z",
            decisiveJobs: 0,
            totalJobs: 1,
          },
        ],
      });

      expect(line).toContain(
        "(no conclusive run in the freshness window — fell back to the newest)"
      );
      expect(line).toContain("skipped 9002");
    });

    it("has nothing to say when no run was observed", () => {
      expect(mod.formatSelection(null)).toBeNull();
    });

    it("renders the selection under its finding in the report", () => {
      const selection = {
        runId: 33226168060,
        conclusion: "success",
        createdAt: FRESH,
        fellBack: false,
        skipped: [
          {
            runId: 33226173248,
            conclusion: "cancelled",
            createdAt: FRESH,
            decisiveJobs: 0,
            totalJobs: 1,
          },
        ],
      };
      const report = mod.formatReport(
        mod.decide(
          [
            {
              label: SUITE_LABEL,
              state: STATE.pass,
              reason: REASON.runConclusion,
              conclusion: "success",
              url: "u",
              selection,
            },
          ],
          {
            bootstrap: { active: false, until: null, expiresInDays: null },
          }
        ),
        { branch: BRANCH, bypassLabel: BYPASS_LABEL }
      );

      expect(report).toContain("  - ↳ scored run 33226168060");
      expect(report).toContain("skipped 33226173248");
    });

    it("leaves a finding with no selection rendering exactly as before", () => {
      const report = mod.formatReport(
        mod.decide(
          [
            {
              label: "s",
              state: STATE.pass,
              reason: REASON.runConclusion,
              conclusion: "success",
              url: "u",
            },
          ],
          {
            bootstrap: { active: false, until: null, expiresInDays: null },
          }
        ),
        { branch: BRANCH, bypassLabel: BYPASS_LABEL }
      );

      expect(report).not.toContain("↳ scored run");
    });
  });

  describe("selection resolves PER ARM, never across the table", () => {
    // Measured 2026-08-30 in a repository consuming the guard: the two arms of
    // one suites table were in different conditions at the same instant. The
    // browser arm matched the defect exactly — newest run `33298585264`
    // `cancelled`, newest conclusive `33252336144` `success`. The native arm did
    // not: its newest run `33313952295` was itself conclusive, `failure`, seven
    // jobs green and one red on a real product assertion. Nothing was displaced.
    //
    // Run ids and conclusions are the measured ones; the timestamps are moved
    // into the harness's freshness window so the case reads the same next year.
    //
    // A selection that resolved "newest conclusive" across the TABLE rather than
    // within each arm goes GREEN here, riding the browser arm's older success
    // while the native arm is genuinely failing. That converts a true red into a
    // false green — strictly worse than the defect being fixed.

    /** The browser arm's workflow. */
    const BROWSER_WORKFLOW = "playwright-e2e.yml";
    /** The browser arm's suite row. */
    const BROWSER_SUITE = Object.freeze({
      label: "Playwright e2e",
      workflow: BROWSER_WORKFLOW,
      match: Object.freeze({ mode: "run" }),
    });
    /** The browser arm's displaced duplicate — newest, tested nothing. */
    const BROWSER_DISPLACED: Run = Object.freeze({
      id: 33298585264,
      conclusion: "cancelled",
      created_at: "2026-08-12T07:10:26Z",
      html_url: "https://example.test/run/33298585264",
      event: "workflow_dispatch",
      head_branch: BRANCH,
    });
    /** The browser arm's real verdict, displaced by the run above. */
    const BROWSER_PASSED: Run = Object.freeze({
      id: 33252336144,
      conclusion: "success",
      created_at: "2026-08-12T06:22:31Z",
      html_url: "https://example.test/run/33252336144",
      event: "workflow_dispatch",
      head_branch: BRANCH,
    });
    /** The native arm's newest run: conclusive, and genuinely red. */
    const NATIVE_FAILED: Run = Object.freeze({
      id: 33313952295,
      conclusion: "failure",
      created_at: "2026-08-12T08:21:18Z",
      html_url: "https://example.test/run/33313952295",
      event: "workflow_dispatch",
      head_branch: BRANCH,
    });
    /** Its jobs: seven green, one red. A real product verdict. */
    const NATIVE_FAILED_JOBS: readonly Job[] = Object.freeze([
      ...Array.from({ length: 7 }, (_unused, index) => ({
        name: `shard-${index}`,
        conclusion: "success",
      })),
      { name: "shard-7", conclusion: "failure" },
    ]);

    /**
     * Observes both arms and reduces them to one verdict.
     *
     * @returns The findings, in suite order, and the verdict over them
     */
    async function judgeBothArms(): Promise<{
      findings: readonly Finding[];
      verdict: { blocked: boolean; verdict: string };
    }> {
      stubArms(
        {
          [BROWSER_WORKFLOW]: [BROWSER_DISPLACED, BROWSER_PASSED],
          "maestro-e2e.yml": [NATIVE_FAILED],
        },
        {
          [BROWSER_DISPLACED.id as number]: DISPLACED_JOBS,
          [BROWSER_PASSED.id as number]: PASSED_JOBS,
          [NATIVE_FAILED.id as number]: NATIVE_FAILED_JOBS,
        }
      );
      const suites = [BROWSER_SUITE, RUN_SUITE];
      const observations = await mod.observe(
        TEST_API,
        suites,
        BRANCH,
        CONTEXT,
        noWait
      );
      const findings = suites.map((suite, index) =>
        mod.assessSuite(suite, observations[index] ?? {}, {
          branch: BRANCH,
          freshnessHours: CONTEXT.freshnessHours,
          now: NOW,
        })
      );
      return {
        findings,
        verdict: mod.decide(findings, {
          bootstrap: { active: false, until: null, expiresInDays: null },
        }),
      };
    }

    it("each arm is scored on ITS OWN newest conclusive run", async () => {
      const { findings } = await judgeBothArms();

      expect(findings[0]?.selection?.runId).toBe(BROWSER_PASSED.id);
      expect(findings[0]?.selection?.skipped?.[0]?.runId).toBe(
        BROWSER_DISPLACED.id
      );
      // The native arm's newest run IS conclusive, so nothing is walked past.
      expect(findings[1]?.selection?.runId).toBe(NATIVE_FAILED.id);
      expect(findings[1]?.selection?.skipped).toEqual([]);
    });

    it("BITE: a displaced arm and a genuinely failing arm still BLOCK", async () => {
      // The control the whole per-arm requirement exists for. One arm recovers
      // its real green; the other keeps its real red; the gate stays red.
      const { findings, verdict } = await judgeBothArms();

      expect(findings[0]?.state).toBe(STATE.pass);
      expect(findings[1]?.state).toBe(STATE.fail);
      expect(findings[1]?.conclusion).toBe("failure");
      expect(findings[1]?.reason).toBe(REASON.runConclusion);
      expect(verdict.blocked).toBe(true);
      expect(verdict.verdict).toBe("fail");
    });

    it("the report names a different scored run under each arm", async () => {
      const { verdict } = await judgeBothArms();
      const report = mod.formatReport(verdict, {
        branch: BRANCH,
        bypassLabel: BYPASS_LABEL,
      });

      expect(report).toContain("↳ scored run 33252336144 (success");
      expect(report).toContain("skipped 33298585264 [cancelled");
      expect(report).toContain("↳ scored run 33313952295 (failure");
    });
  });

  describe("an inconclusive scored run says WHY it was inconclusive", () => {
    it("names a run that ran out of time part-way through", () => {
      // `cancelled` is overloaded across a displaced duplicate, a job killed at
      // its own `timeout-minutes` ceiling, and an operator cancel. The job
      // counts separate the first from the other two without reading anything
      // but the jobs the gate already fetched: seven of eight verdicts reached
      // is a suite that ran and did not finish, not one that never started.
      const line = mod.formatSelection({
        runId: 33313952295,
        conclusion: "cancelled",
        createdAt: FRESH,
        decisiveJobs: 7,
        totalJobs: 8,
        fellBack: false,
        skipped: [],
      });

      expect(line).toBe(
        `↳ scored run 33313952295 (cancelled — 7 of 8 job(s) reached a verdict, so it ran but did not finish, ${FRESH})`
      );
    });

    it("names a run that tested nothing at all", () => {
      const line = mod.formatSelection({
        runId: 33226173248,
        conclusion: "cancelled",
        createdAt: FRESH,
        decisiveJobs: 0,
        totalJobs: 1,
        fellBack: true,
        skipped: [],
      });

      expect(line).toContain(
        "cancelled — 0 of 1 job(s) reached a verdict, so it tested nothing"
      );
    });

    it("says nothing extra when the scored run reached a verdict", () => {
      // A decisive conclusion needs no cause: `failure` already says what
      // happened, and appending job counts to every green is noise.
      const line = mod.formatSelection({
        runId: 33226168060,
        conclusion: "success",
        createdAt: FRESH,
        decisiveJobs: 8,
        totalJobs: 8,
        fellBack: false,
        skipped: [],
      });

      expect(line).toBe(`↳ scored run 33226168060 (success, ${FRESH})`);
    });

    it("observe carries the scored run's job counts onto the selection", async () => {
      const killed: Run = { ...DISPLACED_RUN, id: 902 };
      stubActions([killed], {
        902: [
          { name: "android", conclusion: "success" },
          { name: "ios", conclusion: "cancelled" },
        ],
      });

      const [observation] = await mod.observe(
        TEST_API,
        [RUN_SUITE],
        BRANCH,
        CONTEXT,
        noWait
      );

      expect(observation?.selection?.decisiveJobs).toBe(1);
      expect(observation?.selection?.totalJobs).toBe(2);
    });
  });

  it("carries the selection onto the finding whatever the verdict", () => {
    const selection = {
      runId: 7,
      conclusion: "cancelled",
      createdAt: FRESH,
      fellBack: true,
      skipped: [],
    };
    const finding = mod.assessSuite(
      RUN_SUITE,
      { workflowMissing: true, run: null, jobs: [], selection },
      { branch: BRANCH, freshnessHours: 36, now: NOW }
    );
    expect(finding.selection).toEqual(selection);
  });
});
