/**
 * The nightly e2e gate's truth table, rows 36-38: a run that tested a SLICE is
 * not a green suite.
 *
 * Row 26 asks whether every JOB ran. It cannot see inside a job, so it cannot
 * see the other way a green run proves nothing: a job that ran, passed, and
 * tested a hand-picked handful of flows.
 *
 * Measured 2026-08-18. AcmeOrgB/frontend's only recent `success` ran 4 of ~80
 * flows under `ios_include_tags: smoke`. AcmeOrgD/frontend's REQUIRED merge gate
 * was satisfied by run 32120016803, whose own published artifact name read
 * `maestro-ios-flowcount-7` — seven flows clearing a merge gate for a suite of
 * eighty. `gh run list` renders that identically to a full green.
 *
 * ## These cases are BITE CONTROLS
 *
 * Every row below is written as "the gate REJECTS x", and the passing cases
 * exist only to bound the rejection. A control observed only passing has not
 * been shown to work: it is indistinguishable from a control that returns
 * `true` unconditionally, which is the failure mode this whole file exists to
 * stop being possible. `tests/unit/scripts/check-template-workflow-refs.test.ts`
 * (#2703) is the precedent — a named bite for every non-clean path.
 *
 * So each row is proved twice, in the shape that makes a vacuous pass visible:
 * the disqualifying observation BLOCKS, and the one-field-different observation
 * that should not be disqualified PASSES. A rejection that fires on both is a
 * gate that has stopped discriminating; a rejection that fires on neither is the
 * defect being fixed.
 *
 * Sibling of `nightly-e2e-health.test.ts` (rows 1-16), `…-api.test.ts` (17-20),
 * `…-bypass.test.ts` (21-25), `…-completeness.test.ts` (26) and
 * `…-grace.test.ts` (32-35). Specification: `docs/nightly-e2e-gate.md` §2
 * rows 36-39 and §2.5.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  type Finding,
  type GateModule,
  GREEN_JOB,
  type Job,
  NOW,
  REASON,
  STATE,
  TEST_API,
  fakeResponse,
  loadGateModule,
  noWait,
  runWith,
} from "../../helpers/nightly-e2e-gate-harness";

/** The iOS arm asserting it ran the WHOLE suite — the recorded-inputs signal. */
const IOS_SCOPE_FULL = Object.freeze({ name: "maestro-ios-scope-full" });

/**
 * The artifact names a FULL two-platform maestro night publishes.
 *
 * Shaped from a real run: AcmeOrgD/frontend 32120016803 published
 * `maestro-ios-results`, `maestro-ios-flowcount-7`, `maestro-ios-report` and
 * `app-ios`. The noise entries are kept because the parser has to ignore them —
 * a fixture containing only the markers would prove nothing about a list that
 * mostly is not markers.
 */
const FULL_SCOPE_ARTIFACTS: readonly { name: string }[] = Object.freeze([
  { name: "app-ios" },
  { name: "maestro-ios-report" },
  { name: "maestro-ios-results" },
  { name: "maestro-ios-flowcount-42" },
  IOS_SCOPE_FULL,
  { name: "maestro-android-flowcount-38" },
  { name: "maestro-android-scope-full" },
]);

/** A bootstrap window that is closed, so a row's own verdict is visible. */
const NO_BOOTSTRAP = Object.freeze({
  active: false,
  until: null,
  expiresInDays: null,
});

/** The suite every case here reads, named once so the linter stops counting. */
const WORKFLOW = "maestro-e2e.yml";

/** A JUnit-report artifact — present on every night, a marker on none. */
const REPORT_ARTIFACT = Object.freeze({ name: "maestro-ios-report" });

/**
 * AcmeOrgD/frontend run 32120016803's iOS count, as it was published.
 *
 * Seven flows, against a suite of roughly eighty, on a REQUIRED merge gate.
 */
const SEVEN_FLOWS = Object.freeze({ name: "maestro-ios-flowcount-7" });

/** The iOS arm of a four-flow night, as the count reaches the gate. */
const IOS_FOUR_FLOWS = Object.freeze({ name: "maestro-ios-flowcount-4" });

/** An iOS arm that ran and reached no assertion at all — row 39's subject. */
const IOS_ZERO_FLOWS = Object.freeze({ name: "maestro-ios-flowcount-0" });

/** The notice a green carries when the gate could not judge its scope. */
const UNVERIFIED_NOTICE = "scope unverified";

/** What the iOS arm of a `ios_include_tags: smoke` night publishes. */
const FILTERED_ARTIFACTS: readonly { name: string }[] = Object.freeze([
  REPORT_ARTIFACT,
  IOS_FOUR_FLOWS,
  { name: "maestro-ios-scope-filtered" },
]);

describe("nightly e2e gate — truth table rows 36-38 (suite scope)", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  /**
   * Assesses one suite against a green run carrying a given artifact list.
   *
   * @param artifacts - The run's artifacts, or null when the list is unreadable
   * @param suite - Suite overrides; run-scoped unless replaced
   * @param jobs - The run's jobs; a single green one unless replaced
   * @returns The finding
   */
  function assess(
    artifacts: readonly { name: string }[] | null,
    suite: Record<string, unknown> = {},
    jobs: readonly Job[] = [GREEN_JOB]
  ): Finding {
    return mod.assessSuite(
      {
        label: "suite",
        workflow: WORKFLOW,
        match: { mode: "run" },
        ...suite,
      },
      {
        run: runWith("success"),
        jobs,
        workflowMissing: false,
        scope: mod.readSuiteScope(artifacts),
      },
      { branch: BRANCH, freshnessHours: 36, now: NOW }
    );
  }

  it("orders accepted platform names by locale-independent code points", () => {
    const scope = mod.readSuiteScope([
      { name: "maestro-z-scope-filtered" },
      { name: "maestro-aa-scope-filtered" },
      { name: "maestro-a0-scope-filtered" },
      { name: "maestro-a-scope-filtered" },
      { name: "maestro-0-scope-filtered" },
    ]);

    expect(scope.filtered).toEqual(["0", "a", "a0", "aa", "z"]);
  });

  describe("row 36 — a run that recorded ITSELF as filtered", () => {
    it("BITE: a tag-filtered run does not satisfy the gate, with no `min_flows` declared", () => {
      // The unconditional half. No declaration, no floor, nothing configured:
      // a run that wrote down that it was handed a slice is disbelieved on that
      // alone. This is the row that reaches every consumer on day one.
      const finding = assess(FILTERED_ARTIFACTS);
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.filteredRun);
    });

    it("BITE: and it BLOCKS once it reaches the verdict", () => {
      // A finding nobody acts on is not a gate. Rows 36-38 are `unknown`, and
      // `unknown` has to survive `decide` as a block or the whole file is
      // decorative.
      const verdict = mod.decide([assess(FILTERED_ARTIFACTS)], {
        bootstrap: NO_BOOTSTRAP,
      });
      expect(verdict.blocked).toBe(true);
      expect(verdict.verdict).toBe("fail");
    });

    it("BITE: the report line NAMES the filtered platform", () => {
      // "the run was narrowed" sends the reader back to the run page to find
      // out how. The platform is the first thing they would look for.
      const finding = assess(FILTERED_ARTIFACTS);
      expect(finding.scopeDetail).toContain("ios");
      expect(mod.formatFinding(finding)).toContain("`ios`");
    });

    it("BITE: one filtered arm disqualifies a run whose OTHER arm was full", () => {
      // Discrimination check. A night that ran Android in full and iOS on tags
      // is not two thirds of a verdict — the flows iOS skipped are unmeasured
      // whatever Android did, and a parser that let the `full` marker cancel
      // the `filtered` one would pass exactly the AcmeOrgD shape.
      const finding = assess([
        { name: "maestro-android-scope-full" },
        { name: "maestro-android-flowcount-38" },
        { name: "maestro-ios-scope-filtered" },
        IOS_FOUR_FLOWS,
      ]);
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.filteredRun);
    });

    it("CONTROL: a run recorded as FULL still passes", () => {
      // The bound. Without this the row above is satisfied by a gate that fails
      // every run, which is not a gate either.
      const finding = assess(FULL_SCOPE_ARTIFACTS);
      expect(finding.state).toBe(STATE.pass);
      expect(finding.reason).toBe(REASON.runConclusion);
    });

    it("CONTROL: a full unfiltered DISPATCH still counts — the unblock path holds", () => {
      // §7. The discriminator is "was this run narrowed?", never "was this a
      // dispatch?": a full dispatch is the documented way to clear the gate by
      // FIXING rather than by waiting for tomorrow's cron, and a row that
      // caught dispatches instead of filters would delete the escape.
      const finding = mod.assessSuite(
        { label: "suite", workflow: WORKFLOW, match: { mode: "run" } },
        {
          run: runWith("success", { event: "workflow_dispatch" }),
          jobs: [GREEN_JOB],
          workflowMissing: false,
          scope: mod.readSuiteScope(FULL_SCOPE_ARTIFACTS),
        },
        { branch: BRANCH, freshnessHours: 36, now: NOW }
      );
      expect(finding.state).toBe(STATE.pass);
    });

    it('BITE: it fires on a job-scoped suite too, not just `mode: "run"`', () => {
      // A filtered run is a property of the RUN. A suite that reads one job's
      // conclusion is no less lied to by it, and a check wired into only one of
      // the two green paths is a control that bites off the path the failure
      // takes.
      const finding = assess(
        FILTERED_ARTIFACTS,
        { match: { mode: "job", name: "🍎 Maestro iOS" } },
        [{ name: "🍎 Maestro iOS", conclusion: "success" }]
      );
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.filteredRun);
    });

    it("BITE: `maestro-ios-scope-filtered-old` is NOT read as a filter marker", () => {
      // Anchoring, for the reason `job_pattern` is anchored: unanchored, the
      // marker patterns are substring tests. This asserts the parser's reading
      // directly — a mis-anchored pattern would make this artifact list
      // disqualify a run nobody filtered, and the row would then "bite" on
      // everything and discriminate on nothing.
      const scope = mod.readSuiteScope([
        { name: "maestro-ios-scope-filtered-old" },
        { name: "maestro-ios-flowcount-42-retry" },
      ]);
      expect(scope.filtered).toEqual([]);
      expect(scope.totalFlows).toBeNull();
    });
  });

  describe("row 37 — the executed-flow floor", () => {
    it("BITE: a green run under `min_flows` does not satisfy the gate", () => {
      // AcmeOrgD's run 32120016803, reduced to its evidence: a green iOS arm
      // that published `maestro-ios-flowcount-7`. Under a declared floor of 60
      // that is no longer a verdict about the suite.
      const finding = assess([SEVEN_FLOWS], {
        min_flows: 60,
      });
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.flowShortfall);
    });

    it("BITE: and it BLOCKS", () => {
      const verdict = mod.decide([assess([SEVEN_FLOWS], { min_flows: 60 })], {
        bootstrap: NO_BOOTSTRAP,
      });
      expect(verdict.blocked).toBe(true);
    });

    it("BITE: the report line carries the MEASURED numbers", () => {
      const finding = assess([SEVEN_FLOWS], {
        min_flows: 60,
      });
      expect(finding.scopeDetail).toContain("7");
      expect(finding.scopeDetail).toContain("60");
    });

    it("BITE: it catches a run narrowed WITHOUT a scope marker — the backstop", () => {
      // The reason both signals ship and not either. A historical run, a
      // `flows_dir` override, a hand-edited flow list: none of them publish
      // `scope-filtered`, and all of them are visible in the count. Note this
      // artifact list carries `scope-full` — the run sincerely believes it was
      // unfiltered, and is still short.
      const finding = assess(
        [IOS_SCOPE_FULL, { name: "maestro-ios-flowcount-9" }],
        { min_flows: 60 }
      );
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.flowShortfall);
    });

    it("CONTROL: a run AT the floor passes — the boundary is inclusive", () => {
      // Pinning the comparison, not just its direction. `<` and `<=` differ by
      // one night a year and the difference is a suite blocked for having run
      // exactly what it declared.
      const finding = assess([{ name: "maestro-ios-flowcount-60" }], {
        min_flows: 60,
      });
      expect(finding.state).toBe(STATE.pass);
    });

    it("CONTROL: counts SUM across platforms", () => {
      // The floor is the suite's, not one arm's. 42 + 38 clears 60 while
      // neither arm does, and a per-arm comparison would block every
      // two-platform night that split its flows.
      const finding = assess(FULL_SCOPE_ARTIFACTS, { min_flows: 60 });
      expect(finding.state).toBe(STATE.pass);
      expect(mod.readSuiteScope(FULL_SCOPE_ARTIFACTS).totalFlows).toBe(80);
    });

    it("CONTROL: with no `min_flows`, a low count alone does not block", () => {
      // Stated so the limit is on the record rather than discovered later: a
      // floor cannot be inferred. This gate reads suites it did not write,
      // including ones that publish no counts at all, and a guessed denominator
      // would either forgive everything or block every consumer on day one.
      // Row 36 still catches this run if it recorded itself filtered.
      const finding = assess([{ name: "maestro-ios-flowcount-1" }]);
      expect(finding.state).toBe(STATE.pass);
    });
  });

  describe("row 38 — unreadable scope FAILS CLOSED", () => {
    it("BITE: `min_flows` declared and the artifact list unreadable does NOT pass", () => {
      // The row that stops this fix reproducing the defect it fixes. An
      // unreadable count is precisely what a narrowed run looks like from here,
      // so "we could not check" must never render as "it is fine".
      const finding = assess(null, { min_flows: 60 });
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.scopeUnreadable);
      // The DETAIL is asserted, not just the reason, and that is load-bearing.
      // Two branches close this row — "the list would not load" and "the list
      // loaded and had no marker" — and both stamp `scope_unreadable`. Asserting
      // the token alone lets either branch cover for the other: deleting the
      // unreadable-list check outright left this case passing on the
      // no-marker check, and the mutation went undetected until the detail was
      // pinned. Defence in depth in the guard must not become a blind spot in
      // its control.
      expect(finding.scopeDetail).toContain("could not be read");
    });

    it("BITE: `min_flows` declared and NO count published does NOT pass", () => {
      // The likelier shape in practice: the list loads fine and simply has no
      // marker in it, because the suite stopped publishing one. Same verdict —
      // declaring the floor is the act of asserting the counts exist.
      const finding = assess([REPORT_ARTIFACT], {
        min_flows: 60,
      });
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.scopeUnreadable);
      // The other branch's detail, for the reason given above.
      expect(finding.scopeDetail).toContain("published no");
    });

    it("BITE: and both BLOCK", () => {
      for (const artifacts of [null, [REPORT_ARTIFACT]]) {
        const verdict = mod.decide([assess(artifacts, { min_flows: 60 })], {
          bootstrap: NO_BOOTSTRAP,
        });
        expect(verdict.blocked).toBe(true);
      }
    });

    it("CONTROL: with no `min_flows`, an unreadable list passes but says so", () => {
      // The honest middle. Every consumer is here on the day this ships, and
      // blanket-blocking them would be a fifth divergence rather than a fix.
      // What it must not be is SILENT: an unchecked green rendering identically
      // to a checked one is the exact reading error that produced #2704.
      const finding = assess(null);
      expect(finding.state).toBe(STATE.pass);
      expect(finding.scopeUnverified).toBe(true);
      expect(mod.formatFinding(finding)).toContain(UNVERIFIED_NOTICE);
    });

    it("BITE: a run that published COUNTS but no floor is still flagged, WITH the number", () => {
      // Found by running the guard against the real AcmeOrgB run 32023540492,
      // not by reading the code. That run publishes `flowcount-4` on both arms,
      // so the first version of this flag — "no floor AND no count" — read it as
      // verified and printed a clean green. Its 8-of-~160 flows were the exact
      // false green this file exists to catch, and the gate said nothing.
      //
      // Knowing the number is not the same as being able to judge it. The
      // condition is "no floor AND the run never asserted it was unfiltered".
      const finding = assess([
        { name: "maestro-android-flowcount-4" },
        IOS_FOUR_FLOWS,
      ]);
      expect(finding.state).toBe(STATE.pass);
      expect(finding.scopeUnverified).toBe(true);
      expect(finding.observedFlows).toBe(8);
      // The measured number reaches the reader. Withholding a count the gate
      // already has, behind "how much ran is unknown", is the gate sitting on
      // its own evidence.
      expect(mod.formatFinding(finding)).toContain("executed 8 flow(s)");
    });

    it("CONTROL: a `scope-full` assertion DOES settle it, even with no floor", () => {
      // The bound on the row above. Without this, the flag fires on every green
      // forever and becomes a notice nobody reads. A run carrying `scope-full`
      // has positively recorded that it was handed no filter — that is the
      // recorded-inputs signal answering, not silence.
      const finding = assess([IOS_SCOPE_FULL, IOS_FOUR_FLOWS]);
      expect(finding.state).toBe(STATE.pass);
      expect(finding.scopeUnverified).toBe(false);
      expect(mod.formatFinding(finding)).not.toContain(UNVERIFIED_NOTICE);
    });

    it("CONTROL: a fully verified green is NOT flagged unverified", () => {
      // The discrimination check for the flag itself. A `scopeUnverified` that
      // is true of every green is a warning nobody can act on, and it would put
      // this notice on the one line that has nothing to answer for.
      const finding = assess(FULL_SCOPE_ARTIFACTS, { min_flows: 60 });
      expect(finding.scopeUnverified).toBe(false);
      expect(mod.formatFinding(finding)).not.toContain(UNVERIFIED_NOTICE);
    });
  });

  describe("row 39 — ZERO flows, with no declaration required", () => {
    it("BITE: an arm that executed zero flows blocks with NO `min_flows`", () => {
      // The row that makes the reusable a genuine SUPERSET of AcmeOrgB's local
      // `check-nightly-e2e-flow-coverage.mjs`, which blocks on
      // `arms.some(arm => arm.executed === 0)` with no configuration at all
      // (their TUN-572). Before this row, adopting the reusable and retiring
      // that fork would have silently dropped zero-flow protection from every
      // suite that had not declared `min_flows` — convergence before the
      // reusable was a superset, which is the exact hazard fork-retirement is
      // supposed to avoid.
      const finding = assess([IOS_ZERO_FLOWS]);
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.zeroFlows);
    });

    it("BITE: and it BLOCKS", () => {
      const verdict = mod.decide([assess([IOS_ZERO_FLOWS])], {
        bootstrap: NO_BOOTSTRAP,
      });
      expect(verdict.blocked).toBe(true);
    });

    it("BITE: it is PER-ARM — a live arm cannot launder a dead one", () => {
      // 40 + 0 sums to 40, which clears any sane floor. Summing first would let
      // Android's health stand in for iOS having reached no assertion at all —
      // the same arithmetic mistake as reading a suite's green off whichever
      // platform happened to work.
      const finding = assess([
        { name: "maestro-android-flowcount-40" },
        IOS_ZERO_FLOWS,
      ]);
      expect(finding.state).toBe(STATE.unknown);
      expect(finding.reason).toBe(REASON.zeroFlows);
      expect(finding.scopeDetail).toContain("ios");
      expect(finding.scopeDetail).not.toContain("android");
    });

    it("BITE: zero beats a declared floor rather than deferring to it", () => {
      // Ordering check. `min_flows: 150` would also reject this run, but as
      // `flow_shortfall` — "fewer than declared" — which reads as a suite that
      // shrank. Zero is a different fact and gets its own reason so the operator
      // is sent to the runner logs rather than to the suites table.
      const finding = assess([IOS_ZERO_FLOWS], {
        min_flows: 150,
      });
      expect(finding.reason).toBe(REASON.zeroFlows);
    });

    it("CONTROL: one executed flow is NOT zero", () => {
      // The boundary, pinned. Row 39 is about "tested nothing", not "tested
      // little" — a run of one flow is row 37's business and only when a floor
      // is declared. A `<= 0` or truthiness slip here would silently swallow
      // row 37's job.
      const finding = assess([{ name: "maestro-ios-flowcount-1" }]);
      expect(finding.state).toBe(STATE.pass);
    });

    it("CONTROL: NO count published is not zero either", () => {
      // The distinction the local guard also draws: its `arms.length === 0` is
      // "unavailable", not "zero-coverage". An absent marker means the gate
      // could not ask; inventing a zero from it would block every non-maestro
      // suite in the table on day one.
      const finding = assess([REPORT_ARTIFACT]);
      expect(finding.state).toBe(STATE.pass);
      expect(finding.reason).not.toBe(REASON.zeroFlows);
    });
  });

  describe("the reporter must not close a tracking issue on a slice", () => {
    it("BITE: none of rows 36-38 count as complete evidence", () => {
      // §10 row 30. Closing a tracking issue is a stronger claim than letting a
      // pull request through — it announces a suite is healthy — and it is the
      // one action that must never fire on a run that tested part of itself.
      for (const reason of [
        REASON.filteredRun,
        REASON.flowShortfall,
        REASON.scopeUnreadable,
        REASON.zeroFlows,
      ]) {
        expect(mod.isCompleteEvidence({ reason })).toBe(false);
      }
    });

    it("CONTROL: an ordinary green still counts as complete evidence", () => {
      // Without this the row above is satisfied by `isCompleteEvidence` always
      // returning false, which would make the tracking issues immortal.
      expect(mod.isCompleteEvidence({ reason: REASON.runConclusion })).toBe(
        true
      );
    });
  });

  describe("`min_flows` validation", () => {
    /**
     * Validates a one-suite table carrying the given `min_flows`.
     *
     * @param minFlows - The value under test
     * @returns The validated table
     */
    function validate(minFlows: unknown): readonly unknown[] {
      return mod.validateSuites(
        JSON.stringify([
          {
            label: "s",
            workflow: WORKFLOW,
            match: { mode: "run" },
            min_flows: minFlows,
          },
        ])
      );
    }

    it("BITE: `min_flows: 0` is REJECTED rather than coerced", () => {
      // A floor that enforces nothing while reading as a floor is the shape of
      // every control that reports success because it did nothing.
      expect(() => validate(0)).toThrow(/min_flows/);
    });

    it("BITE: a fractional or non-numeric floor is REJECTED", () => {
      expect(() => validate(1.5)).toThrow(/min_flows/);
      expect(() => validate("60")).toThrow(/min_flows/);
    });

    it("CONTROL: a whole positive floor is accepted", () => {
      expect(validate(60)).toHaveLength(1);
    });
  });

  describe("`fetchRunArtifacts` — reading NAMES, never bytes", () => {
    it("BITE: a truncated page walk reports UNREADABLE, not what it read", () => {
      // A marker sitting on the page this walk never reached is
      // indistinguishable from one that was never published, and the second of
      // those readings is the one that passes. `maxPages` is 2 here and every
      // page comes back full, so the walk ends having read 200 artifacts and
      // still not knowing whether it saw them all.
      const page = Array.from({ length: 100 }, (_, index) => ({
        name: `filler-${index}`,
      }));
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, { artifacts: page });
      return expect(
        mod.fetchRunArtifacts({ ...TEST_API, maxPages: 2 }, 1, noWait)
      ).resolves.toBeNull();
    });

    it("BITE: a 404 artifact list reports UNREADABLE", () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(404);
      return expect(
        mod.fetchRunArtifacts(TEST_API, 1, noWait)
      ).resolves.toBeNull();
    });

    it("CONTROL: a short page returns the names it read", async () => {
      (globalThis as { fetch: unknown }).fetch = async (): Promise<unknown> =>
        fakeResponse(200, {}, { artifacts: FULL_SCOPE_ARTIFACTS });
      const artifacts = await mod.fetchRunArtifacts(TEST_API, 1, noWait);
      expect(artifacts).toHaveLength(FULL_SCOPE_ARTIFACTS.length);
      expect(mod.readSuiteScope(artifacts).totalFlows).toBe(80);
    });
  });
});
