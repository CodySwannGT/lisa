/**
 * A prose comment must not make a file that files nothing unrunnable
 * (CodySwannGT/lisa#3551).
 *
 * ## The defect
 *
 * `scan()` lexes with `shlex.split(posix=True)`. An unbalanced apostrophe —
 * `the caller's guard` — raises `ValueError`, which takes the lex-failure
 * branch, and that branch applies the deliberately COARSE `UNPARSEABLE_CREATION`
 * recogniser to the whole text. A bare `issueCreate` token anywhere matches.
 *
 * So two files identical but for one apostrophe were judged differently: the
 * one that lexes went to the strict conjunction and was allowed, the one that
 * did not was refused as "an unparseable command that reads as a tracker
 * creation" — while both were `echo hello`. Bash does not care about an
 * apostrophe inside a `#` comment; `shlex` does.
 *
 * The refusal is deterministic rather than cached, which is what "permanent"
 * means here: nothing has to remember the verdict for every later command
 * naming that file to be refused the same way.
 *
 * Measured on this repository at the time of the fix: **111** tracked files do
 * not lex AND carry a coarse token, **13** of them shell scripts — including
 * this guard's own shipped copies, which could not be run through the tool the
 * guard protects.
 *
 * ## Why the bypass cases are half this file
 *
 * The coarseness is not a mistake. It exists because a command you demonstrably
 * cannot read must not be waved through — `gh issue create --title x #'` is a
 * comment to bash, which strips it and RUNS the create. So a fix that simply
 * stopped refusing unparseable text would pass every case in the first block
 * and be strictly worse than the defect. The second block is the control.
 * @module tests/unit/hooks/block-direct-issue-create-comment-lex
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** A GitHub-tracked project whose build-ready role is a label. */
const CONFIG = {
  tracker: "github",
  github: {
    org: "acme",
    repo: "widgets",
    labels: { build: { ready: "status:ready" } },
  },
};

/** The token that makes the coarse recogniser match. */
const TOKEN = "issueCreate";
/** An apostrophe in ordinary prose — inert to bash, fatal to shlex. */
const APOSTROPHE = "the caller's guard";

/**
 * Write a script fixture and return the command that runs it.
 * @param cwd - The project directory
 * @param name - The file name
 * @param body - The contents
 * @returns The command string
 */
function script(cwd: string, name: string, body: string): string {
  writeFileSync(path.join(cwd, name), body, "utf-8");
  return `bash ${name}`;
}

describe("a prose comment does not make a harmless file unrunnable", () => {
  it("allows a file that files nothing, apostrophe and token in a comment", () => {
    const cwd = projectWithTracker(CONFIG);
    const command = script(
      cwd,
      "apos.sh",
      `# ${APOSTROPHE} recognises ${TOKEN} as a creation verb\necho hello\n`
    );

    expect(runHook(bash(command), { cwd }).status).toBe(EXIT_ALLOWED);
  });

  it("allows the same file without the apostrophe, unchanged from before", () => {
    // The pair is the point: these two differ by one character and neither
    // files anything, so any difference in verdict is the defect.
    const cwd = projectWithTracker(CONFIG);
    const command = script(
      cwd,
      "clean.sh",
      `# the caller guard recognises ${TOKEN} as a creation verb\necho hello\n`
    );

    expect(runHook(bash(command), { cwd }).status).toBe(EXIT_ALLOWED);
  });

  it("allows an indented comment, which is still a comment", () => {
    const cwd = projectWithTracker(CONFIG);
    const command = script(
      cwd,
      "indented.sh",
      `    # ${APOSTROPHE} mentions ${TOKEN}\necho hello\n`
    );

    expect(runHook(bash(command), { cwd }).status).toBe(EXIT_ALLOWED);
  });
});

describe("the bypass the coarseness exists to close stays closed", () => {
  it("refuses a real creation sitting below an apostrophe comment", () => {
    // The sharp case. The comment is stripped, the create is not, and the file
    // still does not lex — so the coarse recogniser must still find it.
    const cwd = projectWithTracker(CONFIG);
    const command = script(
      cwd,
      "real.sh",
      `# ${APOSTROPHE}\ngh issue create --title x --repo acme/widgets\n`
    );

    expect(runHook(bash(command), { cwd }).status).toBe(EXIT_BLOCKED);
  });

  it("refuses a creation whose own line carries the unbalanced quote", () => {
    // Not in a comment at all: the quote is in the code. Stripping comments
    // must not reach it.
    const cwd = projectWithTracker(CONFIG);
    const command = script(
      cwd,
      "inline.sh",
      `echo "it's fine"\ngh issue create --title x --repo acme/widgets\n`
    );

    expect(runHook(bash(command), { cwd }).status).toBe(EXIT_BLOCKED);
  });

  it("refuses a hand-rolled HTTP creation below an apostrophe comment", () => {
    const cwd = projectWithTracker(CONFIG);
    const body = '{"query":"mutation{issueCreate(input:{}){success}}"}';
    const command = script(
      cwd,
      "http.sh",
      `# ${APOSTROPHE}\ncurl -X POST https://api.linear.app/graphql -d '${body}'\n`
    );

    expect(runHook(bash(command), { cwd }).status).toBe(EXIT_BLOCKED);
  });

  it("still refuses an undeclared creation that lexes cleanly", () => {
    // The broadest control: the ordinary path must be untouched by any of this.
    const cwd = projectWithTracker(CONFIG);

    expect(
      runHook(bash("gh issue create --title x --repo acme/widgets"), { cwd })
        .status
    ).toBe(EXIT_BLOCKED);
  });
});
