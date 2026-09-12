/**
 * The bounded sweep — a terminal path a merge can trigger (#3704).
 *
 * The unbounded sweep answers a BACKLOG question: "what has ever shipped and
 * is still open". Measured on this repository while this was written, that is
 * ~97 items, and `--apply` over it would complete all of them — which is why
 * the daily job runs in report mode and why nothing automatic has ever been
 * allowed to apply it. So work driven directly, without Lisa's merge
 * orchestration, had no terminal transition at all: it shipped, and the item
 * stayed in the lane build intake dispatches from.
 *
 * `--since <rev>` narrows the same evidence — a commit reachable from a deploy
 * branch whose own `Work-Item:` trailer names the item — to what one push
 * added. That question a merge CAN answer and act on.
 *
 * Every case here runs against an offline fixture with a stubbed `gh`; no
 * GitHub write is issued against a real issue.
 * @module tests/unit/scripts/work-item-sweep-bounded
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  commit,
  git,
  offlineFixture,
  Fixture,
} from "../../support/work-item-cli.js";

const MERGED_AT = "2026-01-01T00:00:00Z";
const ISSUE_CLOSE = "issue close";
const TERMINAL = "status:done";
const SINCE = "--since";
const APPLY = "--apply";
const SWEEP = "sweep";
const CURRENT_DRIFT = "DRIFT  acme/code#43";
const EARLIER_REF = "acme/code#42";

/** A timeline carrying one merged pull request in the swept repository. */
const MERGED_TIMELINE = JSON.stringify([
  {
    event: "cross-referenced",
    source: {
      issue: {
        number: 7,
        pull_request: { merged_at: MERGED_AT },
        repository_url: "https://api.github.com/repos/acme/code",
      },
    },
  },
]);

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Path of the log every fake `gh` invocation is appended to.
 * @param fixture - The repository to log inside.
 * @returns Absolute path of the log file.
 */
function logPath(fixture: Fixture): string {
  return path.join(fixture.root, "gh.log");
}

/**
 * The `issue close` invocations a run made.
 * @param fixture - The repository whose log to read.
 * @returns One entry per close, in order.
 */
function closes(fixture: Fixture): string[] {
  return readFileSync(logPath(fixture), "utf8")
    .split("\n")
    .filter(line => line.startsWith(ISSUE_CLOSE));
}

/**
 * Land a commit on the fixture's DEPLOY branch, declaring one item.
 *
 * The trailer sits above a co-author block, where git's own trailer parser
 * cannot see it — the position this project actually writes it in.
 * @param fixture - The repository to commit in.
 * @param number - The issue number to declare.
 * @returns The declaring commit's object ID.
 */
function declareShipped(fixture: Fixture, number: number): string {
  const branch = git(fixture.root, ["branch", "--show-current"], fixture.env);
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  const sha = commit(
    fixture,
    `fix: work attributable to ${number}\n\n` +
      `Work-Item: acme/code#${number}\n` +
      `Co-authored-by: Claude <noreply@anthropic.com>\n`
  );
  git(fixture.root, ["switch", "-q", branch], fixture.env);
  return sha;
}

/**
 * The deploy branch's tip — what a push reports as its `before` revision.
 * @param fixture - The repository to ask.
 * @returns The object ID `main` currently points at.
 */
function deployTip(fixture: Fixture): string {
  return git(fixture.root, ["rev-parse", "main"], fixture.env);
}

/** Two items in both open lanes: #42 shipped earlier, #43 in this push. */
const BOTH = JSON.stringify([
  { number: 42, title: "shipped in an earlier push" },
  { number: 43, title: "shipped by this push" },
]);

/**
 * Stage the two tracker reads ONE completion makes.
 *
 * Completion reads the item, writes, then reads again and refuses unless the
 * fresh read shows it closed under exactly one lifecycle role. A fixture
 * answering both reads identically describes a tracker that ignored the write.
 * @param fixture - The repository the reads happen in.
 * @returns Environment entries staging the before and after reads.
 */
function completionReads(fixture: Fixture): Record<string, string> {
  return {
    FAKE_GH_ISSUE_COUNT_FILE: path.join(fixture.root, "gh-issue.count"),
    FAKE_GH_ISSUE_JSON_1: JSON.stringify({
      closedByPullRequestsReferences: [],
      comments: [],
      labels: [{ name: "status:in-progress" }],
      number: 43,
      state: "OPEN",
      url: "https://github.com/acme/code/issues/43",
    }),
    FAKE_GH_ISSUE_JSON_2: JSON.stringify({
      closedByPullRequestsReferences: [],
      comments: [],
      labels: [{ name: TERMINAL }],
      number: 43,
      state: "CLOSED",
      stateReason: "COMPLETED",
      url: "https://github.com/acme/code/issues/43",
    }),
  };
}

describe("sweep --since bounds the evidence to one push (#3704)", () => {
  // The load-bearing case. Both items are open in the swept lanes and both are
  // declared by a commit on the deploy branch, so the UNBOUNDED sweep reports
  // both — correctly, for the question it answers. The bounded one must report
  // only what the push added, because that is the difference between a
  // transition a merge may perform and a backlog it may not.
  it("reports only the item declared after the bound", () => {
    const fixture = offlineFixture();
    declareShipped(fixture, 42);
    const before = deployTip(fixture);
    const shipped = declareShipped(fixture, 43);

    const result = cli(fixture, [SWEEP, SINCE, before], {
      FAKE_GH_LIST_JSON: BOTH,
      FAKE_GH_TIMELINE_43_JSON: MERGED_TIMELINE,
      FAKE_GH_TIMELINE_JSON: MERGED_TIMELINE,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(CURRENT_DRIFT);
    expect(result.stdout).toContain(shipped.slice(0, 9));
    expect(result.stdout).not.toContain(EARLIER_REF);
  });

  // The same fixture without the bound, so the case above cannot be satisfied
  // by a sweep that reports less than it should for some unrelated reason. One
  // of these two passes for any implementation; only both together pin that
  // the bound is what made the difference.
  it("reports both items when no bound is supplied", () => {
    const fixture = offlineFixture();
    declareShipped(fixture, 42);
    declareShipped(fixture, 43);

    const result = cli(fixture, [SWEEP], {
      FAKE_GH_LIST_JSON: BOTH,
      FAKE_GH_TIMELINE_43_JSON: MERGED_TIMELINE,
      FAKE_GH_TIMELINE_JSON: MERGED_TIMELINE,
    });

    expect(result.stdout).toContain(CURRENT_DRIFT);
    expect(result.stdout).toContain("DRIFT  acme/code#42");
  });

  // An absence claim has to say what it read. A bounded run that reported
  // "no drift" without naming its range would be true about a narrower
  // question than the one its reader asked.
  it("names the bound in its report", () => {
    const fixture = offlineFixture();
    const before = deployTip(fixture);

    const result = cli(fixture, [SWEEP, SINCE, before], {
      FAKE_GH_LIST_JSON: "[]",
    });

    expect(result.stdout).toContain("No drift");
    expect(result.stdout).toContain("Bounded:");
    expect(result.stdout).toContain(before);
  });
});

describe("sweep --apply --since completes only what the push shipped", () => {
  // The write half. Both items are declared and both have a merged pull
  // request in this repository, so an unbounded applying run closes both. The
  // bounded one may close exactly the one its own push shipped — otherwise a
  // merge-triggered run would complete the whole backlog on its first fire.
  it("closes the in-range item and leaves the earlier one open", () => {
    const fixture = offlineFixture();
    declareShipped(fixture, 42);
    const before = deployTip(fixture);
    declareShipped(fixture, 43);

    const result = cli(fixture, [SWEEP, APPLY, SINCE, before], {
      ...completionReads(fixture),
      FAKE_GH_LIST_JSON: BOTH,
      FAKE_GH_LOG: logPath(fixture),
      FAKE_GH_TIMELINE_43_JSON: MERGED_TIMELINE,
      FAKE_GH_TIMELINE_JSON: MERGED_TIMELINE,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(
      `work-item completed: acme/code#43 -> ${TERMINAL}`
    );
    expect(result.stdout).not.toContain("acme/code#42 ->");

    const closed = closes(fixture);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toContain("43");
    expect(closed[0]).not.toContain("42");
  });

  // Idempotence, proved on the input GitHub actually returns the second time.
  // A completed item is closed and no longer carries the ready or claimed
  // role, so it leaves the open-lane listing the subject list is built from —
  // and the same declaration, still in range, credits nothing.
  //
  // This is also the manual-move case: an operator who moved an item to the
  // terminal role by hand produces the identical listing, and a re-run must
  // not reopen the question or write anything.
  it("writes nothing on a second run over the same range", () => {
    const fixture = offlineFixture();
    const before = deployTip(fixture);
    declareShipped(fixture, 43);

    const result = cli(fixture, [SWEEP, APPLY, SINCE, before], {
      FAKE_GH_LIST_JSON: "[]",
      FAKE_GH_LOG: logPath(fixture),
      FAKE_GH_TIMELINE_43_JSON: MERGED_TIMELINE,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("No drift");
    expect(closes(fixture)).toHaveLength(0);
  });
});

describe("sweep --since refuses rather than guessing (#3704)", () => {
  it("limits a push to its selected branch even when another deploy branch diverged", () => {
    const fixture = offlineFixture();
    const configPath = path.join(fixture.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    writeFileSync(
      configPath,
      JSON.stringify({
        ...config,
        deploy: { branches: { production: "main", staging: "staging" } },
      })
    );
    const original = git(
      fixture.root,
      ["branch", "--show-current"],
      fixture.env
    );
    const before = deployTip(fixture);
    git(fixture.root, ["switch", "-q", "-c", "staging", "main"], fixture.env);
    commit(fixture, "fix: separate release\n\nWork-Item: acme/code#42\n");
    git(fixture.root, ["switch", "-q", original], fixture.env);
    declareShipped(fixture, 43);
    const bounded = cli(fixture, [SWEEP, SINCE, before, "--branch", "main"], {
      FAKE_GH_LIST_JSON: BOTH,
    });
    expect(bounded.exitCode).toBeUndefined();
    expect(bounded.stdout).toContain(CURRENT_DRIFT);
    expect(bounded.stdout).not.toContain(EARLIER_REF);
    expect(bounded.stdout).toContain(`main gained since ${before}`);
    const unbounded = cli(fixture, [SWEEP], { FAKE_GH_LIST_JSON: BOTH });
    expect(unbounded.stdout).toContain("DRIFT  acme/code#42");
    expect(unbounded.stdout).toContain(CURRENT_DRIFT);
    const selected = cli(fixture, [SWEEP, "--branch", "main"], {
      FAKE_GH_LIST_JSON: BOTH,
    });
    expect(selected.stdout).toContain("Examined deploy branches: main.");
    expect(selected.stdout).not.toContain(EARLIER_REF);
    const ambiguous = cli(fixture, [SWEEP, SINCE, before], {
      FAKE_GH_LIST_JSON: BOTH,
    });
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stderr).toContain("must name the pushed deploy branch");
    const event = cli(fixture, [SWEEP, SINCE, before], {
      FAKE_GH_LIST_JSON: BOTH,
      GITHUB_REF_NAME: "main",
    });
    expect(event.stdout).toContain(CURRENT_DRIFT);
    expect(event.stdout).not.toContain(EARLIER_REF);
  });

  it.each([
    { value: [] },
    { value: [""] },
    { value: ["--apply"] },
    { value: ["unknown"] },
  ])("refuses invalid explicit branch $value", ({ value }) => {
    const fixture = offlineFixture();
    const result = cli(
      fixture,
      [SWEEP, SINCE, deployTip(fixture), "--branch", ...value],
      { FAKE_GH_LIST_JSON: BOTH }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain("DRIFT");
  });

  // NOT DETERMINED, not "nothing shipped". A bound that names no commit here —
  // a shallow clone, an unfetched ref, the all-zero SHA a branch-creation push
  // carries — leaves the range unknown, and reporting an absence from it would
  // be an absence claim over evidence never read.
  it("refuses a bound that resolves to no commit", () => {
    const fixture = offlineFixture();
    declareShipped(fixture, 43);

    const result = cli(
      fixture,
      [SWEEP, SINCE, "0000000000000000000000000000000000000000"],
      { FAKE_GH_LIST_JSON: BOTH, FAKE_GH_LOG: logPath(fixture) }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("NOT DETERMINED");
    expect(result.stdout).not.toContain("No drift");
    expect(result.stdout).not.toContain("DRIFT");
  });

  // The one direction this must never fail in. Read as absent, a valueless
  // flag turns a merge-triggered applying run into an unbounded one — the
  // whole backlog completed by a typo, quietly and in the direction that looks
  // like success.
  it("refuses a valueless --since instead of sweeping unbounded", () => {
    const fixture = offlineFixture();
    declareShipped(fixture, 42);
    declareShipped(fixture, 43);

    const result = cli(fixture, [SWEEP, APPLY, SINCE], {
      ...completionReads(fixture),
      FAKE_GH_LIST_JSON: BOTH,
      FAKE_GH_LOG: logPath(fixture),
      FAKE_GH_TIMELINE_43_JSON: MERGED_TIMELINE,
      FAKE_GH_TIMELINE_JSON: MERGED_TIMELINE,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without a revision");
    expect(closes(fixture)).toHaveLength(0);
  });

  // The same typo with a different shape: the next token is another flag, so
  // `--since` swallowed it and the bound is still missing.
  it("refuses a --since whose value is another flag", () => {
    const fixture = offlineFixture();

    const result = cli(fixture, [SWEEP, SINCE, APPLY], {
      FAKE_GH_LIST_JSON: BOTH,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("without a revision");
  });
});
