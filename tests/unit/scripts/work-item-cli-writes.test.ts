/**
 * The commands that WRITE to the tracker — backlink, complete, sweep — driven
 * in-process.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process alongside —
 * never instead of — the subprocess suites.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  bindTo,
  cli,
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
          pull_request: { merged_at: "2026-01-01T00:00:00Z" },
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
      LISA_PR_URL: "https://github.com/acme/code/pull/99",
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
      "https://github.com/acme/code/pull/99",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Conflicting pull-request evidence");
  });
});

describe("in-process CLI: complete", () => {
  it("applies the terminal role once a merged pull request proves it shipped", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(fixture, ["complete", REF_FLAG, REF], {
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
              pull_request: { merged_at: "2026-01-01T00:00:00Z" },
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

describe("in-process CLI: sweep", () => {
  const LIST = JSON.stringify([{ number: 42, title: "a leaf" }]);

  /** Two claimed items: #42 has a merged pull request, #43 does not. */
  const MIXED_LIST = JSON.stringify([
    { number: 42, title: "shipped" },
    { number: 43, title: "still in flight" },
  ]);

  // `sweep --apply` is the only path in this file that CLOSES work items, and
  // it had no test of any kind — not in-process, not through a subprocess.
  // "Closes the drifted ones" is only half the contract; the half that matters
  // to anyone whose queue it is run against is that it leaves everything else
  // alone. A single-item fixture cannot tell the two apart: an --apply that
  // closed the whole claimed lane would pass it.
  it("closes ONLY the drifted item, and leaves the one still in flight open", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(fixture, ["sweep", "--apply"], {
      FAKE_GH_LIST_JSON: MIXED_LIST,
      FAKE_GH_LOG: log,
      FAKE_GH_TIMELINE_43_JSON: "[]",
      FAKE_GH_TIMELINE_JSON: SWEPT_TIMELINE,
    });

    // A clean exit is part of the assertion, not decoration. `completeWorkItem`
    // refuses without evidence, so a sweep that dropped its own drift check
    // would still not close #43 — it would THROW on it. Asserting only "one
    // close happened" passes in that world; asserting the run also finished
    // cleanly is what distinguishes "skipped it" from "tried and was caught".
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(`completed acme/code#42 -> ${TERMINAL}`);
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
    const result = cli(fixture, ["sweep"], {
      FAKE_GH_LIST_JSON: LIST,
      FAKE_GH_LOG: log,
      FAKE_GH_TIMELINE_JSON: SWEPT_TIMELINE,
    });
    expect(result.stdout).toContain("DRIFT  acme/code#42  merged: #7  a leaf");
    expect(result.stdout).toContain("Re-run with --apply");
    expect(readFileSync(log, "utf8")).not.toContain(ISSUE_CLOSE);
  });

  it("says so plainly when there is no drift", () => {
    const fixture = offlineFixture();
    const result = cli(fixture, ["sweep"], { FAKE_GH_LIST_JSON: LIST });
    expect(result.stdout).toContain("No drift");
    expect(result.stdout).not.toContain("DRIFT ");
  });

  it("closes the drifted items under --apply", () => {
    const fixture = offlineFixture();
    const log = logPath(fixture);
    const result = cli(fixture, ["sweep", "--apply"], {
      FAKE_GH_LIST_JSON: LIST,
      FAKE_GH_LOG: log,
      FAKE_GH_TIMELINE_JSON: SWEPT_TIMELINE,
    });
    expect(result.stdout).toContain(`completed acme/code#42 -> ${TERMINAL}`);
    expect(readFileSync(log, "utf8")).toContain(ISSUE_CLOSE);
  });

  it("reports no drift over an empty claimed lane", () => {
    const fixture = offlineFixture();
    expect(cli(fixture, ["sweep"]).stdout).toContain("No drift");
  });
});
