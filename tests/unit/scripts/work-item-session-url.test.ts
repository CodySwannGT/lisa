/**
 * A commit message may not publish a coding-session URL (CodySwannGT/lisa#3731).
 *
 * Measured on this fleet's own public history when the ticket was worked: 65
 * commits on the default branch and 54 more on one unmerged branch carry one,
 * across nine session identifiers spanning a month. **No agent typed any of
 * them.** The harness appended the trailer below whatever was written, after
 * the writing was done — so every rule, instruction and convention aimed at the
 * author sits upstream of the moment the text appears, and a guard placed there
 * would be inert against the only producer that has ever emitted one. These
 * cases therefore drive `validate-commit`, the hook that reads the file git is
 * about to commit, and assert against that whole file.
 *
 * The rejection controls carry as much weight as the refusal. A guard that
 * matched prose ABOUT the form would refuse the commit adding the guard, its
 * tests and its documentation — the trap this repository has walked into more
 * than once — so "a sentence naming the form" and "the word session" are pinned
 * as passing alongside the refusal, and `Lane-Id:`, the non-identifying
 * alternative introduced by #3771, is pinned as untouched.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  cleanupFixtures,
  cleanupTemplates,
  bindTo,
  cli,
  offlineFixture,
  Fixture,
  REF,
} from "../../support/work-item-cli.js";

const VALIDATE = "validate-commit";
const OK = `WORK_ITEM_TRACKING_OK ${REF}`;
const TRAILER = `Work-Item: ${REF}`;

/** The sentence every refusal opens with. */
const REFUSAL = "publishes a coding-session URL";

/**
 * A session identifier of the real shape, invented rather than copied.
 *
 * Real ones are 24 characters of base62. Reproducing a genuine id in a test
 * fixture would publish the very value these cases exist to keep out of this
 * repository, so this one is the right SHAPE and obvious nonsense.
 */
const FAKE_ID = "01FAKEfakeFAKEfake0000";
const SESSION_URL = `https://claude.ai/code/session_${FAKE_ID}`;

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Write a commit message file inside a fixture.
 * @param fixture - The repository to write in.
 * @param body - The message text.
 * @returns Absolute path of the file.
 */
function message(fixture: Fixture, body: string): string {
  const file = path.join(fixture.root, "MSG");
  writeFileSync(file, body);
  return file;
}

/**
 * Run `validate-commit` over one message in a bound, offline fixture.
 * @param body - The message text.
 * @returns What the CLI answered.
 */
function validate(body: string): ReturnType<typeof cli> {
  const fixture = offlineFixture();
  bindTo(fixture, REF);
  return cli(fixture, [VALIDATE, message(fixture, body)]);
}

describe("validate-commit refuses a published session URL", () => {
  it("refuses the trailer exactly as the harness appended it", () => {
    const result = validate(
      [
        "feat: land the change",
        "",
        TRAILER,
        `Claude-Session: ${SESSION_URL}`,
        "Co-Authored-By: Claude",
        "",
      ].join("\n")
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(REFUSAL);
  });

  it("names the line it found, counting the whole message", () => {
    const result = validate(
      [
        "feat: land the change",
        "",
        `Claude-Session: ${SESSION_URL}`,
        "",
        "Closing prose below the trailer block.",
        "",
        TRAILER,
        "",
      ].join("\n")
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("on line 3");
  });

  it("does not echo the identifier back into the log", () => {
    const result = validate(`feat: x\n\n${TRAILER}\n${SESSION_URL}\n`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain(FAKE_ID);
  });

  it("refuses a host written in another case", () => {
    const result = validate(
      `feat: x\n\n${TRAILER}\nSee HTTPS://CLAUDE.AI/Code/Session_${FAKE_ID}\n`
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(REFUSAL);
  });

  it("refuses one on a release message, which no exemption covers", () => {
    const result = validate(
      `chore(release): 1.2.3 [skip ci]\n\n${SESSION_URL}\n`
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(REFUSAL);
  });

  it("refuses one on a merge message, which no exemption covers", () => {
    const result = validate(`Merge branch 'main'\n\n${SESSION_URL}\n`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(REFUSAL);
  });

  it("points at the non-identifying alternative", () => {
    const result = validate(`feat: x\n\n${TRAILER}\n${SESSION_URL}\n`);
    expect(result.stderr).toContain("Lane-Id:");
  });
});

describe("validate-commit accepts everything that is not one", () => {
  it("accepts an ordinary tracked message", () => {
    expect(validate(`feat: land the change\n\n${TRAILER}\n`).stdout).toBe(OK);
  });

  it("accepts a message that merely says the word session", () => {
    const body = `fix: reuse one session per request\n\n${TRAILER}\n`;
    expect(validate(body).stdout).toBe(OK);
  });

  // THE case that separates a guard from a tripwire. Documentation, refusal
  // text and tests all have to name the form they are about; a check that could
  // not tell the form from an instance of it would refuse its own arrival.
  it("accepts prose naming the URL form without an identifier", () => {
    const body = [
      "docs: explain the refusal",
      "",
      "Never write claude.ai/code/session_<id> into a commit message.",
      "",
      TRAILER,
      "",
    ].join("\n");
    expect(validate(body).stdout).toBe(OK);
  });

  it("leaves the Lane-Id trailer alone", () => {
    const body = `feat: x\n\n${TRAILER}\nLane-Id: lane-d362d5dbb419\n`;
    expect(validate(body).stdout).toBe(OK);
  });

  // `git commit -v` appends the staged diff under a scissors line and strips
  // both before recording. Reading past it would refuse a commit for text that
  // was never going to be published — including the commit that stages this
  // file, whose fixtures are session URLs.
  it("ignores the verbose diff below the scissors", () => {
    const body = [
      "test: add the fixtures",
      "",
      TRAILER,
      "# ------------------------ >8 ------------------------",
      "# Do not modify or remove the line above.",
      "diff --git a/t.ts b/t.ts",
      `+const SESSION_URL = "${SESSION_URL}";`,
      "",
    ].join("\n");
    expect(validate(body).stdout).toBe(OK);
  });
});
