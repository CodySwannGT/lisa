/**
 * A pull request that gathers SEVERAL work items, and what it still has to prove.
 *
 * The rule these cases replace refused any range naming more than one work
 * item, on the commits. That is a reasonable DEFAULT and a broken RULE: an
 * integration branch — several finished items gathered before one pull request
 * — has no edit to any commit, body, or config that makes its range name one
 * item, so the only remedies it left were to abandon the shape or to bypass a
 * required check.
 *
 * The rule is not retired here; it is moved to the surface that has an answer.
 * A pull request may carry several items if its BODY declares exactly those
 * items, one `Work-Item:` line each. Every case below is either the channel
 * working or a control proving the channel is not a hole: an undeclared item, a
 * declared item the commits do not carry, an item the tracker says is closed,
 * an item with no backlink, and a commit carrying no trailer at all are each
 * still refused.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  CLAIMED,
  cleanupFixtures,
  cleanupTemplates,
  bindTo,
  cli,
  commit,
  createFixture,
  Fixture,
  git,
  githubConfig,
  issueJson,
  MARKER,
  OTHER_REF,
  PR_URL,
  REF,
} from "../../support/work-item-cli.js";

const VALIDATE_PR = "validate-pr";
const BASE = "--base";
const BODY_FILE = "--body-file";
const PR_URL_FLAG = "--pr-url";
const SECOND = "feat: second item\n\nWork-Item: acme/widgets#43";
const FIRST = `feat: first item\n\nWork-Item: ${REF}`;
const BOTH_DECLARED = `Work-Item: ${REF}\nWork-Item: ${OTHER_REF}\n`;

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
 * A branch carrying two finished items, the shape an integration branch has.
 * @param fixture - The repository to build in.
 * @returns The base commit of the range.
 */
function twoItemRange(fixture: Fixture): string {
  const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
  commit(fixture, FIRST);
  commit(fixture, SECOND);
  return base;
}

describe("a range spanning several work items", () => {
  it("passes when the body declares every item the commits carry", () => {
    const fixture = createFixture(githubConfig("trailer"));
    const base = twoItemRange(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, BOTH_DECLARED),
    ]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK 2 commit(s)");
  });

  it("refuses an item the commits carry and the body never declares", () => {
    const fixture = createFixture(githubConfig("trailer"));
    const base = twoItemRange(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `does not declare ${OTHER_REF}, which this range's commits carry`
    );
  });

  it("refuses a body that declares an item no commit carries", () => {
    // The other half of set equality, and the reason declaring is not a
    // bypass: padding the body until the refusal goes away is itself refused.
    const fixture = createFixture(githubConfig("trailer"));
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, FIRST);
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, BOTH_DECLARED),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `declares ${OTHER_REF}, which no commit in this range carries`
    );
  });

  it("still asks the tracker about EVERY item, not just the first", () => {
    // The declaration buys expressibility, never weaker checks. The second
    // item is closed; the range is refused even though the body declares both
    // and the first item is perfectly live.
    const fixture = createFixture();
    const base = twoItemRange(fixture);
    const result = cli(
      fixture,
      [
        VALIDATE_PR,
        BASE,
        base,
        BODY_FILE,
        bodyFile(fixture, BOTH_DECLARED),
        PR_URL_FLAG,
        PR_URL,
      ],
      {
        FAKE_GH_ISSUE_COUNT_FILE: path.join(fixture.root, "issue-reads"),
        FAKE_GH_ISSUE_JSON_1: issueJson({ number: 43, state: "CLOSED" }),
        FAKE_GH_ISSUE_JSON_2: issueJson(),
      }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is closed");
  });

  it("requires a backlink for every declared item under full verification", () => {
    // One backlinked item used to be enough because only one was ever checked.
    // A pull request that gathers three items and links one leaves two with no
    // route back from the tracker, which is the property gate 5 exists for.
    const fixture = createFixture();
    const base = twoItemRange(fixture);
    const result = cli(
      fixture,
      [
        VALIDATE_PR,
        BASE,
        base,
        BODY_FILE,
        bodyFile(fixture, BOTH_DECLARED),
        PR_URL_FLAG,
        PR_URL,
      ],
      {
        // Read order is the range's, newest commit first, so the FIRST answer
        // is the second item and it IS backlinked. The second answer is not —
        // which is exactly the state a single-item backlink check reported as
        // green, because it never looked past the first reference.
        FAKE_GH_ISSUE_COUNT_FILE: path.join(fixture.root, "issue-reads"),
        FAKE_GH_ISSUE_JSON_1: issueJson({
          comments: [{ body: `${MARKER} ${PR_URL}` }],
          labels: [{ name: CLAIMED }],
          number: 43,
        }),
        FAKE_GH_ISSUE_JSON_2: issueJson(),
      }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("has no verified backlink");
  });

  it("still refuses a commit carrying no trailer at all", () => {
    // The untraceable push, which no declaration reaches: gate 3 is per commit
    // and is not what moved.
    const fixture = createFixture(githubConfig("trailer"));
    const base = twoItemRange(fixture);
    commit(fixture, "chore: a commit nobody linked to anything");
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, BOTH_DECLARED),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "No Work-Item trailer anywhere in the commit message"
    );
  });

  it("refuses a binding naming none of the items the range carries", () => {
    // The single-item path asks "is the binding THE item?", which a multi-item
    // range has no answer to. The question that survives is containment, and a
    // worktree tracking something the range never touches is still the mistake
    // the binding check exists to catch.
    const fixture = createFixture(githubConfig("trailer"));
    bindTo(fixture, "acme/widgets#99");
    const base = twoItemRange(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, BOTH_DECLARED),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("bound to acme/widgets#99");
  });

  it("accepts a binding naming one of the items the range carries", () => {
    // The control for the case above: containment PASSES, so the check is not
    // simply refusing every bound worktree with a multi-item range.
    const fixture = createFixture(githubConfig("trailer"));
    bindTo(fixture, OTHER_REF);
    const base = twoItemRange(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, BOTH_DECLARED),
    ]);
    expect(result.exitCode).toBeUndefined();
  });

  it("names the rule that fired, not just the check", () => {
    const fixture = createFixture(githubConfig("trailer"));
    const base = twoItemRange(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.stderr).toContain("gate 4 (pull-request declaration)");
  });
});
