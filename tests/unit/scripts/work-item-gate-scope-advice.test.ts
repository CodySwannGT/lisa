/**
 * Which remedy a traceability finding names, and for which gate.
 *
 * `🔗 Work-Item Traceability` reports two independent requirements under one
 * check name — the `Work-Item:` trailer on each COMMIT (gate 3) and the same
 * trailer in the pull-request BODY (gate 4) — and both findings carry the same
 * `[fixable by editing this pull request]` scope tag, because both are cleared
 * without recreating the pull request. They are NOT cleared the same way: gate
 * 4 by a body edit, gate 3 only by rewriting a commit and force-pushing.
 *
 * Read literally, the tag names gate 4's remedy for both. A reader who follows
 * it on a gate-3 refusal edits the body, watches the check stay red, and
 * reaches for a policy override — having done exactly what the tool said. So
 * the commit-side findings must name their own remedy in the message.
 *
 * Every case here asserts the PAIRING of a message with its advice, never that
 * the run went red. A test that only looked for the advice string anywhere in
 * the output would pass on a run where it was appended to every finding
 * indiscriminately — including the tracker-state refusals a rewrite cannot
 * touch, which is the same misdirection pointed somewhere else.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  commit,
  createFixture,
  Fixture,
  git,
  githubConfig,
  issueJson,
  PR_URL,
  REF,
} from "../../support/work-item-cli.js";

const VALIDATE_PR = "validate-pr";
const BODY_FILE = "--body-file";
const COMMIT_GATE = "No Work-Item trailer anywhere in the commit message";
const BODY_GATE = "No Work-Item trailer anywhere in the pull request body";
const ADVICE = "editing the body will NOT clear it";
const REWRITE = "git rebase -i";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Write a pull-request body file.
 * @param fixture - The repository to write into.
 * @param body - The body text.
 * @returns Absolute path of the file.
 */
function bodyFile(fixture: Fixture, body: string): string {
  const file = path.join(fixture.root, "BODY");
  writeFileSync(file, body);
  return file;
}

/**
 * The finding line carrying a given phrase.
 *
 * Findings are printed one per numbered paragraph, so the line containing the
 * refusal is the line that must also carry its remedy. Matching the whole
 * output instead would let advice attached to a DIFFERENT finding satisfy an
 * assertion about this one.
 * @param output - The validator's stderr.
 * @param phrase - The refusal to find.
 * @returns The matching line, or the empty string.
 */
function findingFor(output: string, phrase: string): string {
  return output.split("\n").find(line => line.includes(phrase)) ?? "";
}

describe("a traceability finding names the remedy for its own gate", () => {
  it("tells a gate-3 refusal to rewrite the commit, not to edit the body", () => {
    const fixture = createFixture(githubConfig("trailer"));
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, "feat: work with no trailer");
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBe(1);
    const finding = findingFor(result.stderr, COMMIT_GATE);
    expect(finding).toContain(ADVICE);
    expect(finding).toContain(REWRITE);
  });

  it("does NOT tell a gate-4 refusal to rewrite a commit", () => {
    // The body is the one thing a body edit does fix. Advising a rewrite here
    // would send the reader to force-push over a correct commit.
    const fixture = createFixture(githubConfig("trailer"));
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, `feat: traced work\n\nWork-Item: ${REF}`);
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, "No trailer here.\n"),
    ]);
    expect(result.exitCode).toBe(1);
    const finding = findingFor(result.stderr, BODY_GATE);
    expect(finding).not.toContain(ADVICE);
    expect(finding).not.toContain(REWRITE);
  });

  it("gives the two gates different remedies when both fail at once", () => {
    // The case that makes the shared scope tag ambiguous: one tag, two findings,
    // two different actions. Each must carry its own.
    const fixture = createFixture(githubConfig("trailer"));
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, "feat: work with no trailer");
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, "No trailer here either.\n"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(findingFor(result.stderr, COMMIT_GATE)).toContain(ADVICE);
    expect(findingFor(result.stderr, BODY_GATE)).not.toContain(ADVICE);
  });

  it("advises a rewrite for mixed references across the range", () => {
    // Raised about the COMMITS rather than about one message, so it takes the
    // tag from `commitTrailerError` rather than from `exactWorkItem`'s catch.
    // Both routes must arrive tagged or the advice is only half wired.
    const fixture = createFixture(githubConfig("trailer"));
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, `feat: one\n\nWork-Item: ${REF}`);
    commit(fixture, "feat: two\n\nWork-Item: acme/widgets#43");
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBe(1);
    expect(findingFor(result.stderr, "mixed Work-Item references")).toContain(
      ADVICE
    );
  });

  it("does NOT advise a rewrite for a refusal a rewrite cannot clear", () => {
    // The control for the flag being set where the answer IS a rewrite, rather
    // than sprayed over everything reaching the same `outcome.error` branch. A
    // closed work item is the tracker's own "no": the commit is written
    // correctly, and rewriting it would change nothing. Without this case,
    // appending the advice unconditionally passes every other assertion here.
    const fixture = createFixture(githubConfig("full"));
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, `feat: traced work\n\nWork-Item: ${REF}`);
    const result = cli(
      fixture,
      [
        VALIDATE_PR,
        "--base",
        base,
        // `full` refuses a --body-file with no --pr-url before it ever reads the
        // tracker. Omitting it made this control refuse for an unrelated reason
        // and pass without the advice no matter what — a vacuous control, which
        // an injection that appended the advice unconditionally walked straight
        // through.
        "--pr-url",
        PR_URL,
        BODY_FILE,
        bodyFile(fixture, `Work-Item: ${REF}\n`),
      ],
      { FAKE_GH_ISSUE_JSON: issueJson({ state: "CLOSED" }) }
    );
    expect(result.exitCode).toBe(1);
    // Proof this control reached the tracker rather than refusing earlier.
    expect(result.stderr).toMatch(/closed|CLOSED/);
    expect(result.stderr).not.toContain(ADVICE);
  });
});
