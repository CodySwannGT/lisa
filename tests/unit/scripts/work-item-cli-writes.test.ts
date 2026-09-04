/**
 * The commands that WRITE to the tracker — backlink, complete, sweep — driven
 * in-process.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process alongside —
 * never instead of — the subprocess suites.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  declaredWorkItemNumbers,
  shippedDeclarations,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

import {
  cleanupFixtures,
  cleanupTemplates,
  bindTo,
  cli,
  commit,
  createFixture,
  git,
  githubConfig,
  issueJson,
  offlineFixture,
  Fixture,
  MARKER,
  PR_URL,
  REF,
} from "../../support/work-item-cli.js";

const BACKLINK = "backlink";
const PR_URL_FLAG = "--pr-url";
const REF_FLAG = "--ref";
const ISSUE_CLOSE = "issue close";
const TERMINAL = "status:done";
const CROSS_REFERENCED = "cross-referenced";
const MERGED_AT = "2026-01-01T00:00:00Z";
const DRIFT_42 = "DRIFT  acme/code#42";
const OTHER_PR_URL = "https://github.com/acme/code/pull/99";

/**
 * A timeline carrying one merged pull request in the named repository.
 * @param repository - `owner/name` the pull request belongs to.
 * @returns The timeline as JSON text.
 */
function mergedTimeline(repository: string): string {
  return JSON.stringify([
    {
      event: CROSS_REFERENCED,
      source: {
        issue: {
          number: 7,
          pull_request: { merged_at: MERGED_AT },
          repository_url: `https://api.github.com/repos/${repository}`,
        },
      },
    },
  ]);
}

/** Merged in the tracker repository, which is what `complete` reads. */
const MERGED_TIMELINE = mergedTimeline("acme/widgets");

/**
 * Merged in the repository the sweep is run from. `sweep` builds its refs from
 * the CURRENT repository rather than the configured tracker queue, so a fixture
 * that shares one timeline between the two commands proves nothing.
 */
const SWEPT_TIMELINE = mergedTimeline("acme/code");

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
 * Stage the two tracker reads a completion makes.
 *
 * Completion now reads the item before writing and reads it AGAIN afterwards,
 * refusing unless that fresh read shows it closed under exactly one lifecycle
 * role. A fixture that answers both reads with the same open, claimed issue
 * describes a tracker that ignored the write, so these cases stage the
 * reconciled state the second read is supposed to find. What that reconciliation
 * covers is asserted in `work-item-lifecycle-reconciliation.test.ts`; here it is
 * the premise, not the subject.
 * @param fixture - The repository the reads happen in.
 * @returns Environment entries staging the before and after reads.
 */
function completionReads(fixture: Fixture): Record<string, string> {
  return {
    FAKE_GH_ISSUE_COUNT_FILE: path.join(fixture.root, "gh-issue.count"),
    FAKE_GH_ISSUE_JSON_1: issueJson(),
    FAKE_GH_ISSUE_JSON_2: issueJson({
      labels: [{ name: TERMINAL }, { name: "type:Bug" }],
      state: "CLOSED",
      stateReason: "COMPLETED",
    }),
  };
}

describe("in-process CLI: backlink", () => {
  it("creates the managed comment and says so", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(
      fixture,
      [BACKLINK, REF_FLAG, REF, PR_URL_FLAG, PR_URL],
      {
        FAKE_GH_LOG: log,
      }
    );
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toBe(
      `work-item backlink created on ${REF}: ${MARKER} ${PR_URL}`
    );
    expect(readFileSync(log, "utf8")).toContain("--method POST");
  });

  it("updates the managed comment rather than adding a second", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(
      fixture,
      [BACKLINK, REF_FLAG, REF, PR_URL_FLAG, PR_URL],
      {
        FAKE_GH_COMMENTS_JSON: JSON.stringify([
          { body: `${MARKER} https://github.com/acme/code/pull/6`, id: 9 },
        ]),
        FAKE_GH_LOG: log,
      }
    );
    expect(result.stdout).toContain("backlink updated");
    expect(readFileSync(log, "utf8")).toContain("--method PATCH");
  });

  it("writes nothing when the comment already says exactly this", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(
      fixture,
      [BACKLINK, REF_FLAG, REF, PR_URL_FLAG, PR_URL],
      {
        FAKE_GH_COMMENTS_JSON: JSON.stringify([
          { body: `${MARKER} ${PR_URL}`, id: 9 },
        ]),
        FAKE_GH_LOG: log,
      }
    );
    expect(result.stdout).toContain("backlink unchanged");
    expect(readFileSync(log, "utf8")).not.toContain("--method");
  });

  it("uses the worktree binding when no --ref is supplied", () => {
    const fixture = offlineFixture();
    bindTo(fixture, REF);
    expect(cli(fixture, [BACKLINK, PR_URL_FLAG, PR_URL]).stdout).toContain(
      `on ${REF}`
    );
  });

  it("refuses with neither a --ref nor a binding", () => {
    const result = cli(offlineFixture(), [BACKLINK, PR_URL_FLAG, PR_URL]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires --ref <work-item>");
  });

  it("refuses without a pull-request url", () => {
    const result = cli(offlineFixture(), [BACKLINK, REF_FLAG, REF]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires --pr-url <url>");
  });

  it("accepts the url through the environment", () => {
    const fixture = offlineFixture();
    expect(
      cli(fixture, [BACKLINK, REF_FLAG, REF], { LISA_PR_URL: PR_URL }).stdout
    ).toContain(`on ${REF}`);
  });

  it("lets an explicit --url outrank the environment fallback", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, [BACKLINK, REF_FLAG, REF, "--url", PR_URL], {
      LISA_PR_URL: OTHER_PR_URL,
    });

    expect(result.stdout).toContain(`${MARKER} ${PR_URL}`);
    expect(result.stdout).not.toContain("pull/99");
  });

  it("refuses conflicting explicit pull-request aliases", () => {
    const result = cli(offlineFixture(), [
      BACKLINK,
      REF_FLAG,
      REF,
      PR_URL_FLAG,
      PR_URL,
      "--url",
      OTHER_PR_URL,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Conflicting pull-request evidence");
  });

  it("refuses two spellings of one pull request as a conflict", () => {
    const result = cli(offlineFixture(), [
      BACKLINK,
      REF_FLAG,
      REF,
      PR_URL_FLAG,
      PR_URL,
      "--url",
      `${PR_URL}/`,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Conflicting pull-request evidence");
  });

  it("refuses an explicit --pr-url carrying an empty value", () => {
    const result = cli(
      offlineFixture(),
      [BACKLINK, REF_FLAG, REF, PR_URL_FLAG, ""],
      { LISA_PR_URL: OTHER_PR_URL }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--pr-url was supplied without a pull-request URL"
    );
    expect(result.stdout).not.toContain("pull/99");
  });

  it("refuses an explicit --pr-url followed by another option", () => {
    const result = cli(
      offlineFixture(),
      [BACKLINK, PR_URL_FLAG, "--json", REF_FLAG, REF],
      { LISA_PR_URL: OTHER_PR_URL }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--pr-url was supplied without a pull-request URL"
    );
    expect(result.stdout).not.toContain("pull/99");
  });

  it("refuses an empty --url even when it is the only alias present", () => {
    const result = cli(offlineFixture(), [BACKLINK, REF_FLAG, REF, "--url"], {
      LISA_PR_URL: OTHER_PR_URL,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "--url was supplied without a pull-request URL"
    );
    expect(result.stdout).not.toContain("pull/99");
  });

  it("writes the canonical url when the caller supplies a trailing slash", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(
      fixture,
      [BACKLINK, REF_FLAG, REF, PR_URL_FLAG, `${PR_URL}/`],
      { FAKE_GH_LOG: log }
    );

    expect(result.stdout).toContain(`${MARKER} ${PR_URL}`);
    expect(readFileSync(log, "utf8")).toContain(`body=${MARKER} ${PR_URL}`);
    expect(readFileSync(log, "utf8")).not.toContain(`${PR_URL}/`);
  });

  it("canonicalises the environment fallback as well as the aliases", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, [BACKLINK, REF_FLAG, REF], {
      LISA_PR_URL: `${PR_URL}/`,
    });

    expect(result.stdout).toContain(`${MARKER} ${PR_URL}`);
    expect(result.stdout).not.toContain(`${PR_URL}/`);
  });

  it("treats an empty LISA_PR_URL as absent rather than malformed", () => {
    const result = cli(offlineFixture(), [BACKLINK, REF_FLAG, REF], {
      LISA_PR_URL: "",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires --pr-url <url>");
  });

  it("refuses a value that is not a GitHub pull-request url", () => {
    const result = cli(offlineFixture(), [
      BACKLINK,
      REF_FLAG,
      REF,
      PR_URL_FLAG,
      "https://github.com/acme/code/issues/7",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid pull-request evidence");
  });
});

describe("in-process CLI: complete", () => {
  it("applies the terminal role once a merged pull request proves it shipped", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(fixture, ["complete", REF_FLAG, REF], {
      ...completionReads(fixture),
      FAKE_GH_LOG: log,
      FAKE_GH_TIMELINE_JSON: MERGED_TIMELINE,
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(
      `work-item completed: ${REF} -> ${TERMINAL} (merged: #7)`
    );
    const invocations = readFileSync(log, "utf8");
    expect(invocations).toContain(`--add-label ${TERMINAL}`);
    expect(invocations).toContain("--remove-label status:in-progress");
    expect(invocations).toContain(ISSUE_CLOSE);
  });

  it("refuses to complete without a merged pull request as evidence", () => {
    const result = cli(offlineFixture(), ["complete", REF_FLAG, REF]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`refusing to complete ${REF}`);
    expect(result.stderr).toContain("Completion is evidence-based on purpose");
  });

  it("ignores a merged pull request in another repository", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["complete", REF_FLAG, REF], {
      FAKE_GH_TIMELINE_JSON: JSON.stringify([
        {
          event: CROSS_REFERENCED,
          source: {
            issue: {
              number: 7,
              pull_request: { merged_at: MERGED_AT },
              repository_url: "https://api.github.com/repos/other/elsewhere",
            },
          },
        },
      ]),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no merged pull request in acme/widgets");
  });

  it("ignores a cross-referenced pull request that is still open", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["complete", REF_FLAG, REF], {
      FAKE_GH_TIMELINE_JSON: JSON.stringify([
        {
          event: CROSS_REFERENCED,
          source: {
            issue: {
              number: 7,
              pull_request: { merged_at: null },
              repository_url: "https://api.github.com/repos/acme/widgets",
            },
          },
        },
      ]),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("refusing to complete");
  });

  it("refuses complete with neither a --ref nor a binding", () => {
    const result = cli(offlineFixture(), ["complete"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("complete requires --ref <work-item>");
  });
});

describe("in-process CLI: validate-pr", () => {
  it("lets an explicit --url outrank the environment fallback", () => {
    const fixture = createFixture(githubConfig("full"));
    const base = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const head = commit(
      fixture,
      `feat: exercise pull-request evidence\n\nWork-Item: ${REF}`
    );
    const body = path.join(fixture.root, "BODY");
    writeFileSync(body, `Work-Item: ${REF}\n`);

    const result = cli(
      fixture,
      [
        "validate-pr",
        "--base",
        base,
        "--head",
        head,
        "--body-file",
        body,
        "--url",
        PR_URL,
      ],
      {
        FAKE_GH_ISSUE_JSON: issueJson({
          comments: [{ body: `${MARKER} ${PR_URL}` }],
        }),
        LISA_PR_URL: OTHER_PR_URL,
      }
    );

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("PR body, and tracker backlink");
  });

  it("matches a canonical backlink comment through a trailing-slash url", () => {
    const fixture = createFixture(githubConfig("full"));
    const base = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const head = commit(
      fixture,
      `feat: exercise pull-request evidence\n\nWork-Item: ${REF}`
    );
    const body = path.join(fixture.root, "BODY");
    writeFileSync(body, `Work-Item: ${REF}\n`);

    const result = cli(
      fixture,
      [
        "validate-pr",
        "--base",
        base,
        "--head",
        head,
        "--body-file",
        body,
        "--url",
        `${PR_URL}/`,
      ],
      {
        FAKE_GH_ISSUE_JSON: issueJson({
          comments: [{ body: `${MARKER} ${PR_URL}` }],
        }),
      }
    );

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("PR body, and tracker backlink");
  });
});

/**
 * Land a commit on the fixture's DEPLOY branch and return to where we were.
 *
 * The fixture works on `feature/tracked`, and the sweep's evidence is what is
 * reachable from a deploy branch — so a declaration committed on the feature
 * branch is correctly invisible to it. Modelling the merge is the point: an
 * item is not shipped because a commit declaring it exists somewhere, but
 * because that commit reached the branch this project deploys.
 * @param fixture - The repository to commit in.
 * @param message - The full commit message, trailers included.
 * @returns The declaring commit's object ID.
 */
function onDeployBranch(fixture: Fixture, message: string): string {
  const branch = git(fixture.root, ["branch", "--show-current"], fixture.env);
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  const sha = commit(fixture, message);
  git(fixture.root, ["switch", "-q", branch], fixture.env);
  return sha;
}

/**
 * A commit on the deploy branch DECLARING `number`.
 *
 * The trailer sits ABOVE a co-author block on purpose. That is where this
 * project writes it, and it is the position git's own
 * `%(trailers:key=Work-Item)` cannot see — an implementation reaching for the
 * trailer parser instead of scanning the body finds nothing here and reports a
 * clean, confident, wrong absence.
 * @param fixture - The repository to commit in.
 * @param number - The issue number to declare.
 * @returns The declaring commit's object ID.
 */
function declareShipped(fixture: Fixture, number: number): string {
  return onDeployBranch(
    fixture,
    `fix: work attributable to ${number}\n\n` +
      `Work-Item: acme/code#${number}\n` +
      `Co-authored-by: Claude <noreply@anthropic.com>\n`
  );
}

describe("in-process CLI: sweep", () => {
  const LIST = JSON.stringify([{ number: 42, title: "a leaf" }]);

  /** Two items: #42 has a merged pull request, #43 does not. */
  const MIXED_LIST = JSON.stringify([
    { number: 42, title: "shipped" },
    { number: 43, title: "still in flight" },
  ]);

  // `sweep --apply` is the only path in this file that CLOSES work items.
  // "Closes the drifted ones" is only half the contract; the half that matters
  // to anyone whose queue it is run against is that it leaves everything else
  // alone. A single-item fixture cannot tell the two apart: an --apply that
  // closed the whole lane would pass it.
  it("closes ONLY the declared item, and leaves the one still in flight open", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    declareShipped(fixture, 42);
    const result = cli(fixture, ["sweep", "--apply"], {
      ...completionReads(fixture),
      FAKE_GH_LIST_JSON: MIXED_LIST,
      FAKE_GH_LOG: log,
      FAKE_GH_TIMELINE_43_JSON: "[]",
      FAKE_GH_TIMELINE_JSON: SWEPT_TIMELINE,
    });

    // A clean exit is part of the assertion, not decoration. `completeWorkItem`
    // refuses without evidence, so a sweep that dropped its own drift check
    // would still not close #43 — it would report a refusal for it. Asserting
    // only "one close happened" passes in that world; asserting the run also
    // finished cleanly is what distinguishes "skipped it" from "tried and was
    // caught".
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(
      `work-item completed: acme/code#42 -> ${TERMINAL}`
    );
    expect(result.stdout).not.toContain("acme/code#43 ->");

    const invocations = readFileSync(log, "utf8")
      .split("\n")
      .filter(line => line.startsWith(ISSUE_CLOSE));
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toContain("42");
    expect(invocations[0]).not.toContain("43");
  });

  it("reports drift without changing anything", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const sha = declareShipped(fixture, 42);
    const result = cli(fixture, ["sweep"], {
      FAKE_GH_LIST_JSON: LIST,
      FAKE_GH_LOG: log,
      FAKE_GH_TIMELINE_JSON: SWEPT_TIMELINE,
    });
    expect(result.stdout).toContain(DRIFT_42);
    expect(result.stdout).toContain(sha.slice(0, 9));
    expect(result.stdout).toContain("Re-run with --apply");
    expect(readFileSync(log, "utf8")).not.toContain(ISSUE_CLOSE);
  });

  it("closes the declared items under --apply", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    declareShipped(fixture, 42);
    const result = cli(fixture, ["sweep", "--apply"], {
      ...completionReads(fixture),
      FAKE_GH_LIST_JSON: LIST,
      FAKE_GH_LOG: log,
      FAKE_GH_TIMELINE_JSON: SWEPT_TIMELINE,
    });
    expect(result.stdout).toContain(
      `work-item completed: acme/code#42 -> ${TERMINAL}`
    );
    expect(readFileSync(log, "utf8")).toContain(ISSUE_CLOSE);
  });

  it("reports no drift over empty lanes", () => {
    const fixture = offlineFixture();
    expect(cli(fixture, ["sweep"]).stdout).toContain("No drift");
  });
});

/**
 * What the sweep counts as evidence, and what it looks at (#3907).
 *
 * Two independent defects, and a fix for either alone leaves a broken tool:
 * one credited work that was merely MENTIONED, the other could not see the
 * ready lane at all. Measured on this repository before the change: of 53
 * items reported as drifted, 8 had no commit on `main` declaring them — 15% —
 * and every one of the 8 had a live worktree branch open against it. In the
 * other direction, 5 items whose work had genuinely shipped from the ready
 * lane were reported by neither mode.
 */
describe("sweep evidence and subject list (#3907)", () => {
  /** A merged pull request that merely REFERENCES the item. */
  const MENTION_ONLY_TIMELINE = JSON.stringify([
    {
      event: CROSS_REFERENCED,
      source: {
        issue: {
          number: 7,
          pull_request: { merged_at: MERGED_AT },
          repository_url: "https://api.github.com/repos/acme/code",
        },
      },
    },
  ]);

  // DIRECTION ONE: stop crediting a mention.
  //
  // The land-stack shape that produced the 15%: one merged pull request names
  // several issues, and every one of them is credited as shipped. Here #42 is
  // named by a merged pull request and declared by no commit, so the sweep
  // must say nothing about it — while the run still completes cleanly, which
  // is what separates "correctly ignored" from "crashed before reaching it".
  it("does not credit a merged pull request that merely mentions the item", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["sweep"], {
      FAKE_GH_LIST_JSON: JSON.stringify([{ number: 42, title: "mentioned" }]),
      FAKE_GH_TIMELINE_JSON: MENTION_ONLY_TIMELINE,
    });

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).not.toContain("DRIFT");
    expect(result.stdout).toContain("No drift");
  });

  // DIRECTION TWO: still credit a real one.
  //
  // Without this, direction one is satisfied by a sweep that credits nothing
  // at all — which moves the error rather than fixing it, and does so in the
  // quietest possible way, since a tool that reports no drift looks like a
  // tool with nothing to report.
  it("still credits an item a commit on the deploy branch declares", () => {
    const fixture = offlineFixture();
    const sha = declareShipped(fixture, 42);
    const result = cli(fixture, ["sweep"], {
      FAKE_GH_LIST_JSON: JSON.stringify([{ number: 42, title: "shipped" }]),
      FAKE_GH_TIMELINE_JSON: MENTION_ONLY_TIMELINE,
    });

    expect(result.stdout).toContain(DRIFT_42);
    expect(result.stdout).toContain(sha.slice(0, 9));
  });

  // The ready-lane blind spot. An item whose work shipped while it still
  // carried the ready role never entered the old subject list, so no mode of
  // the sweep could report it.
  it("detects an item that shipped while still carrying the ready role", () => {
    const fixture = offlineFixture();
    declareShipped(fixture, 42);
    const result = cli(fixture, ["sweep"], {
      // Answers the claimed-lane query with nothing and the ready-lane query
      // with the item, so only a sweep that queries BOTH roles finds it.
      FAKE_GH_LIST_JSON: "[]",
      FAKE_GH_LIST_STATUS_READY_JSON: JSON.stringify([
        { number: 42, title: "shipped from the ready lane" },
      ]),
      FAKE_GH_TIMELINE_JSON: MENTION_ONLY_TIMELINE,
    });

    expect(result.stdout).toContain(DRIFT_42);
    expect(result.stdout).toContain("status:ready");
  });

  // A clean negative has to name its subject. The old sentence — "every item
  // carrying status:in-progress is genuinely in flight" — was true, and was
  // read as "nothing has drifted" over a subject list that excluded the lane
  // in question.
  it("names every lifecycle role it examined when it finds nothing", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["sweep"], { FAKE_GH_LIST_JSON: "[]" });

    expect(result.stdout).toContain("No drift");
    expect(result.stdout).toContain("status:ready");
    expect(result.stdout).toContain("status:in-progress");
    expect(result.stdout).toContain("no role outside");
  });

  // The trailer position that defeats git's own parser. This project writes
  // `Work-Item:` above the co-author block, where `%(trailers:key=Work-Item)`
  // does not see it as a trailer: measured on `origin/main`, the parser finds
  // 602 distinct issues against a full-body scan's 835, missing 233. An
  // implementation built on the parser passes every other case in this file
  // and fails only this one.
  it("finds a trailer that sits above a trailing co-author block", () => {
    const fixture = offlineFixture();
    const sha = onDeployBranch(
      fixture,
      "fix: a change\n\n" +
        "Work-Item: acme/code#42\n" +
        "Co-authored-by: Claude <noreply@anthropic.com>\n" +
        "Co-authored-by: Codex <codex@openai.com>\n"
    );
    const result = cli(fixture, ["sweep"], {
      FAKE_GH_LIST_JSON: JSON.stringify([{ number: 42, title: "shipped" }]),
    });

    expect(result.stdout).toContain(DRIFT_42);
    expect(result.stdout).toContain(sha.slice(0, 9));
  });

  // A near-miss that must NOT count: another repository's item with the same
  // number. Credit is scoped to the repository being swept.
  it("ignores a declaration naming another repository's item", () => {
    const fixture = offlineFixture();
    onDeployBranch(
      fixture,
      "fix: elsewhere\n\nWork-Item: other/repo#42\nCo-authored-by: Claude <noreply@anthropic.com>\n"
    );
    const result = cli(fixture, ["sweep"], {
      FAKE_GH_LIST_JSON: JSON.stringify([{ number: 42, title: "not ours" }]),
    });

    expect(result.stdout).not.toContain("DRIFT");
  });
});

/**
 * The attribution primitives, in process (#3907).
 *
 * Pure over text, so the whole decision is assertable without a repository —
 * and, unlike the CLI cases above, reachable by the mutation gate, whose
 * mutants do not cross the process boundary a spawned command creates.
 */
describe("declaredWorkItemNumbers and shippedDeclarations (#3907)", () => {
  const REPOSITORY = "acme/code";

  it("reads a trailer wherever it sits in the body", () => {
    expect(
      declaredWorkItemNumbers(
        "fix: a change\n\nWork-Item: acme/code#42\nCo-authored-by: Claude <x@y.z>\n",
        REPOSITORY
      )
    ).toEqual([42]);
  });

  it("reads several declarations and de-duplicates them", () => {
    expect(
      declaredWorkItemNumbers(
        "Work-Item: acme/code#42\nWork-Item: acme/code#43\nWork-Item: acme/code#42\n",
        REPOSITORY
      )
    ).toEqual([42, 43]);
  });

  it("declares nothing for another repository, or for prose that merely names one", () => {
    for (const body of [
      "Work-Item: other/repo#42",
      "This relates to acme/code#42 but declares nothing",
      "Closes acme/code#42",
      "fix: a change with no trailer at all",
      "",
    ]) {
      expect(declaredWorkItemNumbers(body, REPOSITORY), body).toEqual([]);
    }
  });

  it("reads no issue number zero or leading zero", () => {
    expect(
      declaredWorkItemNumbers("Work-Item: acme/code#0", REPOSITORY)
    ).toEqual([]);
    expect(
      declaredWorkItemNumbers("Work-Item: acme/code#007", REPOSITORY)
    ).toEqual([]);
  });

  it("maps every declaring commit in a NUL-separated log", () => {
    const log =
      "aaaaaaa\nfix: one\n\nWork-Item: acme/code#42\n\0" +
      "bbbbbbb\nfix: two\n\nWork-Item: acme/code#42\n\0" +
      "ccccccc\nfix: three\n\nWork-Item: acme/code#43\n\0";
    const declarations = shippedDeclarations(log, REPOSITORY);

    expect(declarations.get(42)).toEqual(["aaaaaaa", "bbbbbbb"]);
    expect(declarations.get(43)).toEqual(["ccccccc"]);
    expect(declarations.size).toBe(2);
  });

  // Newline framing would split one commit into several, because a commit body
  // contains blank lines by construction. The record separator has to be one
  // the body cannot contain.
  it("keeps a multi-paragraph body as one record", () => {
    const log =
      "aaaaaaa\nfix: one\n\nA paragraph.\n\nAnother paragraph.\n\nWork-Item: acme/code#42\n\0";
    expect(shippedDeclarations(log, REPOSITORY).get(42)).toEqual(["aaaaaaa"]);
  });

  it("reads nothing from an empty log", () => {
    expect(shippedDeclarations("", REPOSITORY).size).toBe(0);
    expect(shippedDeclarations("\0\0", REPOSITORY).size).toBe(0);
  });
});
