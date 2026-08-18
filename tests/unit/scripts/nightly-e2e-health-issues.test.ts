/**
 * The nightly e2e gate's REPORTING half — contract rows 27-31.
 *
 * The gate blocks merges when last night's suite went red, but until now it told
 * nobody outside the pull request. The guard's own bypass report even promised
 * that "the tracking issue stays open until a green run lands" while Lisa
 * created no such issue. These cases pin the artifact that promise refers to.
 *
 * The shape is **one open tracking issue per suite**, refreshed on each red
 * night and closed when a full green run lands — never one issue per red night,
 * which is a mailbox nobody reads. The issue is a STATE MIRROR of one suite, not
 * a log of nightly runs.
 *
 * The closing rule is the dangerous one, and it is why this file is a sibling of
 * `…-completeness.test.ts` rather than independent of it: closing the issue is
 * the reporter declaring the suite healthy, so it must never fire on a run that
 * did not gather the evidence. Row 26 already refuses to call a partial run a
 * pass, and the reporter reuses that judgement rather than re-deriving it —
 * `incomplete_run` neither closes an issue nor files a false all-clear.
 *
 * Specification: `docs/nightly-e2e-gate.md` §10.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  BRANCH,
  FRESH,
  type Finding,
  type GateModule,
  ISSUE_ACTION,
  ISSUE_REASON,
  type IssuePlanEntry,
  type Job,
  NOW,
  REASON,
  STATE,
  TEST_API,
  type TrackedIssue,
  fakeResponse,
  loadGateModule,
  noWait,
  runWith,
} from "../../helpers/nightly-e2e-gate-harness";

/** The suite every case speaks about. */
const LABEL = "Maestro native e2e";

/** The reporting context every case plans against. */
const CONTEXT = Object.freeze({
  branch: BRANCH,
  label: "nightly-e2e",
  now: NOW,
});

/** A green arm. */
const GREEN: Job = Object.freeze({ name: "🤖 Android", conclusion: "success" });

/** The arm a platform-filtered dispatch leaves behind. */
const SKIPPED: Job = Object.freeze({ name: "🍎 iOS", conclusion: "skipped" });

/** The run a red finding points at. */
const RED_RUN_URL = "https://example.test/run/1";

/**
 * A finding as `assessSuite` produces one.
 *
 * @param overrides - Field overrides
 * @returns A finding
 */
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    label: LABEL,
    state: STATE.fail,
    reason: REASON.runConclusion,
    conclusion: "failure",
    url: RED_RUN_URL,
    ...overrides,
  } as Finding;
}

describe("nightly e2e reporting — rows 27-31", () => {
  let mod: GateModule;

  beforeAll(async () => {
    mod = await loadGateModule();
  });

  /**
   * Plans one suite against a set of already-open issues.
   *
   * @param one - The finding
   * @param open - Open issues in the repository
   * @returns The single plan entry
   */
  function planOne(
    one: Finding,
    open: readonly TrackedIssue[] = []
  ): IssuePlanEntry {
    const plan = mod.planIssueActions([one], open, CONTEXT);
    expect(plan).toHaveLength(1);
    return plan[0] as IssuePlanEntry;
  }

  /**
   * An open tracking issue for this suite, as the reporter left it.
   *
   * @param number - Issue number
   * @param evidence - The finding the body was last stamped with
   * @returns An issue
   */
  function tracked(
    number: number,
    evidence: Finding = finding()
  ): TrackedIssue {
    const seed = mod.planIssueActions([evidence], [], CONTEXT)[0];
    return { number, body: seed?.body ?? "" };
  }

  it("row 27: the first red night files exactly one issue for the suite", () => {
    const entry = planOne(finding());
    expect(entry.action).toBe(ISSUE_ACTION.create);
    expect(entry.reason).toBe(ISSUE_REASON.redFiled);
    expect(entry.issues).toEqual([]);
    // The title names the suite, so an operator scanning the issue list can tell
    // WHICH suite is down without opening anything.
    expect(entry.title).toContain(LABEL);
    // And the body leads with what broke and what to do, because the person at
    // the gate is not required to be technical (AGENTS.md, factory gates).
    expect(entry.body).toContain(LABEL);
    expect(entry.body).toContain(BRANCH);
    expect(entry.body).toContain(RED_RUN_URL);
  });

  it("row 28: a second red night refreshes the SAME issue, never files another", () => {
    const entry = planOne(finding(), [tracked(41)]);
    expect(entry.action).toBe(ISSUE_ACTION.refresh);
    expect(entry.reason).toBe(ISSUE_REASON.redRefreshed);
    expect(entry.issues).toEqual([41]);
    // One issue per suite, not one per red night: a nightly that files a fresh
    // issue every morning produces a backlog nobody triages, and the suite's
    // actual state stops being legible from the issue list.
    expect(entry.action).not.toBe(ISSUE_ACTION.create);
  });

  it("row 28: an unchanged red night refreshes SILENTLY — no comment", () => {
    // The body is a state mirror, so rewriting it costs a reader nothing. A
    // comment is a notification, and one every night for the same failure trains
    // people to mute the issue that is supposed to be alerting them.
    const same = finding();
    expect(planOne(same, [tracked(41, same)]).comment).toBeNull();
  });

  it("row 28: a red night whose EVIDENCE changed does comment", () => {
    const before = finding({ url: RED_RUN_URL });
    const after = finding({
      url: "https://example.test/run/9",
      conclusion: "timed_out",
    });
    const entry = planOne(after, [tracked(41, before)]);
    expect(entry.comment).toContain("https://example.test/run/9");
  });

  it("row 29: a complete green run closes the issue", () => {
    const entry = planOne(
      finding({ state: STATE.pass, conclusion: "success" }),
      [tracked(41)]
    );
    expect(entry.action).toBe(ISSUE_ACTION.close);
    expect(entry.reason).toBe(ISSUE_REASON.greenComplete);
    expect(entry.issues).toEqual([41]);
    // Closing is the reporter telling everyone the suite is healthy again, so it
    // says so on the issue rather than closing it silently.
    expect(entry.comment).toContain("green");
  });

  it("row 29: a green suite with no open issue does nothing at all", () => {
    const entry = planOne(
      finding({ state: STATE.pass, conclusion: "success" })
    );
    expect(entry.action).toBe(ISSUE_ACTION.none);
    expect(entry.reason).toBe(ISSUE_REASON.greenUntracked);
  });

  it("row 30: a PARTIAL run neither closes the issue nor files an all-clear", () => {
    // The live case, and acmeorga's trap in their words: "one spec reporting
    // success would close the tracking issue while the failures that opened it
    // went unrun — the suite declaring itself green on evidence it never
    // gathered." Row 26 already refuses to call that run a pass; the reporter
    // reuses that verdict rather than re-deriving completeness for itself.
    const partial = finding({
      state: STATE.unknown,
      reason: REASON.incompleteRun,
      conclusion: "skipped",
    });
    const entry = planOne(partial, [tracked(41)]);
    expect(entry.action).toBe(ISSUE_ACTION.none);
    expect(entry.reason).toBe(ISSUE_REASON.evidenceIncomplete);
    expect(entry.comment).toBeNull();
  });

  it("row 30: a partial run does not FILE either — absence is not failure", () => {
    const entry = planOne(
      finding({
        state: STATE.unknown,
        reason: REASON.incompleteRun,
        conclusion: "skipped",
      })
    );
    expect(entry.action).toBe(ISSUE_ACTION.none);
  });

  it("row 30: closing is gated on completeness INDEPENDENTLY of the state", () => {
    // Defence against a future loosening of row 26. If `incomplete_run` ever
    // stopped downgrading the state, the close path would still refuse it,
    // because the reporter asks the completeness question in its own right.
    const entry = planOne(
      finding({ state: STATE.pass, reason: REASON.incompleteRun }),
      [tracked(41)]
    );
    expect(entry.action).not.toBe(ISSUE_ACTION.close);
    expect(entry.reason).toBe(ISSUE_REASON.evidenceIncomplete);
  });

  it("row 30: unreadable evidence keeps the issue open and files nothing", () => {
    const entry = planOne(
      finding({ state: STATE.unknown, reason: REASON.noRun, conclusion: null }),
      [tracked(41)]
    );
    expect(entry.action).toBe(ISSUE_ACTION.none);
    expect(entry.reason).toBe(ISSUE_REASON.evidenceMissing);
  });

  it("row 26 and row 29 agree: a skipped arm never reaches the close path", () => {
    // End to end through the classifier rather than through a hand-built
    // finding, so the two halves cannot drift into disagreeing about what a
    // partial run is.
    const assessed = mod.assessSuite(
      { label: LABEL, workflow: "maestro-e2e.yml", match: { mode: "run" } },
      {
        run: runWith("success", { event: "workflow_dispatch" }),
        jobs: [GREEN, SKIPPED],
        workflowMissing: false,
      },
      { branch: BRANCH, freshnessHours: 36, now: NOW }
    );
    expect(mod.isCompleteEvidence(assessed)).toBe(false);
    expect(planOne(assessed, [tracked(41)]).action).toBe(ISSUE_ACTION.none);
  });

  it("a pull request is never mistaken for a tracking issue", () => {
    // `GET /repos/{owner}/{repo}/issues` returns pull requests too. Treating one
    // as the tracking issue would comment on somebody's PR and, worse, CLOSE it
    // the night the suite went green.
    const seed = tracked(41);
    const asPullRequest: TrackedIssue = {
      ...seed,
      pull_request: { url: "https://example.test/pull/41" },
    };
    expect(planOne(finding(), [asPullRequest]).action).toBe(
      ISSUE_ACTION.create
    );
  });

  it("duplicates heal: the oldest is refreshed, and green closes them all", () => {
    const open = [tracked(88), tracked(41)];
    expect(planOne(finding(), open).issues).toEqual([41]);
    expect(
      planOne(finding({ state: STATE.pass, conclusion: "success" }), open)
        .issues
    ).toEqual([41, 88]);
  });

  it("a hostile suite label cannot escape the identity marker", () => {
    // The marker is an HTML comment carrying the suite's identity. A label
    // containing `-->` would otherwise terminate it early, and every suite after
    // it would match every issue.
    const marker = mod.suiteMarker("evil --> <!-- other");
    expect(marker.startsWith("<!--")).toBe(true);
    expect(marker.endsWith("-->")).toBe(true);
    expect(marker.slice(4, -3)).not.toContain("--");
    expect(marker.slice(4, -3)).not.toContain(">");
  });

  it("two suites never match each other's issue", () => {
    const first = finding({ label: "Maestro native e2e" });
    const second = finding({ label: "Playwright browser e2e" });
    const open = [{ number: 41, body: planOne(first).body ?? "" }];
    const plan = mod.planIssueActions([first, second], open, CONTEXT);
    expect(plan[0]?.action).toBe(ISSUE_ACTION.refresh);
    expect(plan[1]?.action).toBe(ISSUE_ACTION.create);
  });

  it("filing is idempotent: re-planning after a create refreshes", () => {
    // The property that makes two overlapping nightly reports safe. The
    // non-cancelling concurrency group (proved in the workflow contract tests)
    // serialises them; this is the belt to that suspenders — even a report that
    // somehow ran twice reads the issue the first one filed and refreshes it.
    const red = finding();
    const created = planOne(red);
    expect(created.action).toBe(ISSUE_ACTION.create);
    const second = planOne(red, [{ number: 41, body: created.body ?? "" }]);
    expect(second.action).toBe(ISSUE_ACTION.refresh);
  });

  it("row 31: one suite's issue-API failure does not abandon the others", async () => {
    const plan = mod.planIssueActions(
      [finding({ label: "first" }), finding({ label: "second" })],
      [],
      CONTEXT
    );
    const attempted: string[] = [];
    // Keyed on the SUITE MARKER rather than on the bare word "first". The
    // marker is the suite's identity (§10.1) and appears in exactly one
    // suite's body; a loose substring is prose-sensitive, and matched the
    // wrong request the moment the body gained a sentence containing the word.
    const firstMarker = mod.suiteMarker("first");
    (globalThis as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string }
    ): Promise<unknown> => {
      attempted.push(String(init?.method));
      return String(init?.body).includes(firstMarker)
        ? fakeResponse(500, {}, {})
        : fakeResponse(201, {}, { number: 7 });
    };
    const results = await mod.applyIssuePlan(TEST_API, plan, noWait);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toBeTruthy();
    expect(results[1]?.ok).toBe(true);
    expect(attempted).toContain("POST");
  });

  it("row 31: the merge gate itself issues NO writes — filing cannot fail it", async () => {
    // Filing is reporting, not verdict. The gate is a REQUIRED status check, so
    // an issue API that is down, throttled or forbidden must not be able to turn
    // a green nightly into a red pull request. The structural guarantee is that
    // the gate path never writes at all — proved here, and reinforced by the
    // reusable gate workflow requesting no `issues:` scope (workflow contract
    // tests).
    const methods: (string | undefined)[] = [];
    (globalThis as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string }
    ): Promise<unknown> => {
      methods.push(init?.method);
      if (url.includes("/jobs"))
        return fakeResponse(200, {}, { jobs: [GREEN] });
      return fakeResponse(
        200,
        {},
        {
          workflow_runs: [
            {
              id: 42,
              conclusion: "success",
              created_at: FRESH,
              event: "schedule",
              head_branch: BRANCH,
              html_url: "https://example.test/run/42",
            },
          ],
        }
      );
    };
    await mod.runGate(
      {
        GITHUB_TOKEN: "t",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_API_URL: "https://api.test",
        NIGHTLY_BRANCH: BRANCH,
        NIGHTLY_SUITES: JSON.stringify([
          { label: LABEL, workflow: "maestro-e2e.yml", match: { mode: "run" } },
        ]),
      },
      noWait
    );
    expect(methods.length).toBeGreaterThan(0);
    expect(
      methods.every(method => method === undefined || method === "GET")
    ).toBe(true);
  });

  it("the issue list skips pull requests and paginates to exhaustion", async () => {
    const pages: string[] = [];
    (globalThis as { fetch: unknown }).fetch = async (
      url: string
    ): Promise<unknown> => {
      pages.push(url);
      return fakeResponse(
        200,
        {},
        pages.length === 1
          ? Array.from({ length: 100 }, (_, index) => ({ number: index + 1 }))
          : [{ number: 101 }]
      );
    };
    const issues = await mod.fetchTrackingIssues(
      TEST_API,
      "nightly-e2e",
      noWait
    );
    expect(issues).toHaveLength(101);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("labels=nightly-e2e");
    expect(pages[0]).toContain("state=open");
  });
});
