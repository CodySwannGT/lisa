/**
 * Keeps the deferred whole-list mutation bite cases a DEFERRAL, not a deletion.
 *
 * `tests/integration/mutation-gate-bite.test.ts` runs the committed mutation
 * gate twice — intact, then with a set of guards' suites withheld. Those two
 * passes were one case when this was written, and that
 * case measured **2,502,502 ms of a 2,533,560 ms integration job**: 98.8% of it,
 * against roughly 2 seconds for all 68 other integration files combined. The
 * gate it proves is diff-only and runs in 7.3 min, so the case cost ~6x the
 * thing it was proving. It is now skipped unless
 * `LISA_WHOLE_LIST_MUTATION_BITE` is set, which the pull-request path does not
 * set.
 *
 * A skip like that has exactly one failure mode, and it is silent: the schedule
 * that was supposed to keep running it gets deleted, renamed, or quietly stops
 * setting the variable, and from then on nothing anywhere runs the case while
 * the file still reads as though something does. That is the same shape as
 * every defect the bite test itself exists to catch, arriving through the
 * remedy instead of the bug.
 *
 * So the skip and the schedule are checked against each other. Break either
 * half and this fails in milliseconds and names which half.
 *
 * CodySwannGT/lisa#2944 then split the two passes into separately named,
 * separately budgeted cases, plus the comparison between them. That changes the
 * deferral from one case to three and it changes nothing else, so what is
 * checked here is a roster: ALL of them gated, or a ~21-minute pass is back on
 * every pull request.
 *
 * It also pins what is NOT deferred, because that is the whole argument for
 * deferring: the roster-conformance case and the single-guard case in the same
 * file must stay ungated, and no pull-request-triggered workflow may set the
 * variable.
 * @module tests/unit/config/wholelist-mutation-bite-scheduled
 */

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The environment variable that re-enables the deferred case. */
const FLAG = "LISA_WHOLE_LIST_MUTATION_BITE";

/** Repository-relative path of the suite carrying the deferred case. */
const BITE_SUITE = "tests/integration/mutation-gate-bite.test.ts";

/** Where GitHub Actions workflow definitions live. */
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");

/**
 * The deferred cases' titles, as the skip and the runner both see them.
 *
 * A roster rather than a single title, because CodySwannGT/lisa#2944 split the
 * one case into three — each pass separately named and separately budgeted, so
 * an overrun says which pass overran, plus the comparison between them. All
 * three carry the deferral, so all three have to be gated: a split that left
 * one of them ungated would put a ~21-minute pass back on every pull request,
 * which is most of the cost the deferral removed.
 *
 * The comparison case is cheap on its own and would be harmless to run, and it
 * is still listed. It reads scores the two passes record, so ungating it
 * without them makes it fail on every pull request for a reason that is not a
 * defect — the same class of false red the whole campaign is about.
 */
const DEFERRED_CASES = [
  "passes intact over the whole mutate list",
  "fails at the committed floor when a guard's suites are withheld",
  "scores lower with a guard's suites withheld than with them present",
];

/**
 * The cases that must keep running on every pull request.
 *
 * These are the reason the deferral is defensible rather than a hole. The first
 * is what goes stale — a guard leaving the mutate list or losing its suites
 * fails it immediately, so the deferred cases cannot rot unnoticed between
 * scheduled runs. At WEEKLY cadence that gap is seven times longer, which makes
 * this case seven times more load-bearing than it was. The second, measured at 28.8 s on CI, proves the COMMITTED
 * configuration still goes red on a single-file diff, which is the shape a pull
 * request actually has.
 */
const MUST_STAY_UNGATED = [
  "withholds suites the gate actually runs, and not all of them",
  "clears the committed floor alone, and fails alone when its suites are withheld",
];

/** The scheduled workflow that owns the deferred cases. */
const SCHEDULED = "weekly-mutation-wholelist-bite.yml";

/**
 * How far back from a case title to look for a `runIf` gating it, in chars.
 *
 * Enough to clear `it.runIf(WHOLE_LIST_BITE_ENABLED)(` plus the reflow
 * whitespace, and short enough that it cannot reach the previous case.
 */
const DECLARATION_LOOKBEHIND = 60;

/**
 * What precedes a case title in the source, near enough to be its declaration.
 * @param title - The case title, exactly as written
 * @returns The preceding source, or undefined when the title is not there
 */
const declarationOf = (title: string): string | undefined => {
  const at = biteSource.indexOf(`"${title}"`);
  if (at < 0) return undefined;
  return biteSource.slice(Math.max(0, at - DECLARATION_LOOKBEHIND), at);
};

/** The bite suite's source, read once. */
const biteSource = readFileSync(path.join(REPO_ROOT, BITE_SUITE), "utf8");

/** Every workflow definition in the repository, keyed by file name. */
const workflows: ReadonlyMap<string, string> = new Map(
  readdirSync(WORKFLOW_DIR)
    .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map(name => [name, readFileSync(path.join(WORKFLOW_DIR, name), "utf8")])
);

/**
 * The workflows that set the flag, so something runs the deferred case.
 * @returns File names of workflows whose YAML sets the flag
 */
const settingTheFlag = (): readonly string[] =>
  [...workflows]
    .filter(([, body]) => new RegExp(`^\\s*${FLAG}\\s*:`, "mu").test(body))
    .map(([name]) => name);

describe("the deferred whole-list mutation bite cases", () => {
  it("reads the flag by name", () => {
    expect(biteSource).toContain(
      'process.env["LISA_WHOLE_LIST_MUTATION_BITE"] === "1"'
    );
  });

  for (const title of DEFERRED_CASES) {
    it(`gates "${title}" on the flag`, () => {
      // `it.runIf` rather than a bare `it.skip`: the case still appears in the
      // reporter, named, with its condition visible next to it.
      //
      // Read backwards from the title, the way the ungated cases below are
      // read, rather than matching `it.runIf(...)(\n    "title"` literally.
      // That literal form pinned prettier's output for a three-argument call
      // and would have gone red on the comparison case, which takes two and is
      // formatted on one line — a guard failing on whitespace teaches the next
      // author to edit the guard.
      expect(
        declarationOf(title),
        `${title} must still be declared in ${BITE_SUITE}`
      ).toBeDefined();
      expect(
        declarationOf(title) ?? "",
        `${title} must be gated on ${FLAG}, or the pull-request path pays for it again`
      ).toContain("runIf");
    });
  }

  it("still carries the assertions that make it a bite test", () => {
    // A future edit that "simplifies" the skipped cases into stubs has removed
    // the coverage the scheduled run is supposed to be running.
    expect(biteSource).toContain("assertNoSyntheticThreshold");
    // The two arms, pinned by the LABEL each run reports under rather than by
    // its sandbox path. The paths are now run-scoped `run-<pid>-<epoch>` so the
    // mutation gate's own sweeper can reclaim them when a run is killed
    // (CodySwannGT/lisa#3653); pinning the path shape here would have made that
    // fix fail a test that only ever cared that both arms still exist.
    expect(biteSource).toContain("bite-intact");
    expect(biteSource).toContain("bite-weakened");
    // The comparison between the two passes. Clearing and missing the floor is
    // not on its own proof that WITHHOLDING moved the score; the ordering is,
    // and splitting the case is what made it possible to drop it by accident.
    expect(biteSource).toContain("toBeLessThan(intact)");
  });

  it("says how to run it locally", () => {
    expect(biteSource).toContain(`${FLAG}=1 bun run test`);
  });

  for (const title of MUST_STAY_UNGATED) {
    it(`leaves "${title}" running on every pull request`, () => {
      // Read backwards from the title rather than matching a shape forwards:
      // the file declares one of these on a single line and the other reflowed
      // across two, and a prettier pass must not be able to fail this.
      expect(
        declarationOf(title),
        `${title} must still be declared`
      ).toBeDefined();
      expect(
        declarationOf(title) ?? "runIf",
        `${title} must run on every pull request, ungated`
      ).not.toContain("runIf");
    });
  }
});

describe("the schedule that keeps running it", () => {
  it("exists, and is the only thing setting the flag", () => {
    // Not "at least one": a second setter is how a PR-path workflow would
    // quietly put the 42 minutes back, and the case below could not tell.
    expect(
      settingTheFlag(),
      `exactly one workflow must set ${FLAG}; a gate nothing runs is not deferred, it is deleted`
    ).toEqual([SCHEDULED]);
  });

  it("runs on a schedule and runs the bite suite with the flag set", () => {
    const body = workflows.get(SCHEDULED) ?? "";
    expect(body).toMatch(/^\s{2}schedule:$/mu);
    expect(body).toMatch(/^ {4}- cron: '/mu);
    expect(body).toContain(`${FLAG}: '1'`);
    expect(body).toContain(`bun run test ${BITE_SUITE}`);
  });

  it("is not triggered by pull requests", () => {
    // The point of the change: the pull-request path must not set the flag by
    // any route, including a path-filtered trigger on this workflow.
    const body = workflows.get(SCHEDULED) ?? "";
    expect(body).not.toMatch(/^\s{2}pull_request:/mu);
    expect(body).not.toMatch(/^\s{2}push:/mu);
  });

  it("files an issue when the scheduled run goes red", () => {
    // A scheduled run nobody reads is the same as no scheduled run, and at
    // weekly cadence a missed one costs a week.
    const body = workflows.get(SCHEDULED) ?? "";
    expect(body).toContain("create-github-issue-on-failure.yml");
    expect(body).toMatch(/if:.*failure\(\)/u);
  });
});
