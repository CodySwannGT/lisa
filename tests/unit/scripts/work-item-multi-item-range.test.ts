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
import { existsSync, writeFileSync } from "node:fs";
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
const VALIDATE_PUSH = "validate-push";
const FEATURE = "feature/tracked";
const PUSH_REF = `refs/heads/${FEATURE}`;
const PUSHED_REFS = "pushed-refs";
const PR_GATE = "gate 4 (pull-request declaration)";
const BASE = "--base";
const BODY_FILE = "--body-file";
const PR_URL_FLAG = "--pr-url";
const SECOND = "feat: second item\n\nWork-Item: acme/widgets#43";
const FIRST = `feat: first item\n\nWork-Item: ${REF}`;
const BOTH_DECLARED = `Work-Item: ${REF}\nWork-Item: ${OTHER_REF}\n`;
const declarationRoots = new Set<string>();

afterEach(() => {
  cleanupFixtures();
  for (const root of declarationRoots) expect(existsSync(root)).toBe(false);
  declarationRoots.clear();
});
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

/**
 * Reach PR declaration validation with a real full or incremental Git range.
 * @param body - The authored pull-request declarations.
 * @param route - The CLI entrypoint to exercise.
 * @returns The captured CLI outcome.
 */
function declarationResult(
  body: string,
  route: typeof VALIDATE_PR | typeof VALIDATE_PUSH
) {
  const fixture = createFixture(githubConfig("trailer"));
  declarationRoots.add(fixture.root);
  const base = twoItemRange(fixture);
  if (route === VALIDATE_PR)
    return cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, body),
    ]);
  const ref = PUSH_REF;
  const refsFile = path.join(fixture.root, PUSHED_REFS);
  const localOid = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
  const remoteOid = git(fixture.root, ["rev-parse", "HEAD^"], fixture.env);
  writeFileSync(refsFile, `${ref} ${localOid} ${ref} ${remoteOid}\n`);
  return cli(fixture, [route, "origin"], {
    LISA_PUSHED_REFS_FILE: refsFile,
    FAKE_GH_PR_JSON: JSON.stringify({
      body,
      headRefName: FEATURE,
      state: "OPEN",
      url: PR_URL,
    }),
  });
}

describe("a range spanning several work items", () => {
  it("requires a verified backlink after normalizing an issue URL", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(
      fixture,
      "feat: linked item\n\nWork-Item: https://github.com/acme/widgets/issues/42"
    );
    const result = cli(fixture, [
      VALIDATE_PR,
      BASE,
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
      PR_URL_FLAG,
      PR_URL,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("has no verified backlink");
  });

  it.each([
    { body: BOTH_DECLARED, exitCode: undefined },
    { body: `Work-Item: ${REF}\n`, exitCode: 1 },
  ])(
    "validates issue URLs against exact incremental PR declarations ($exitCode)",
    ({ body, exitCode }) => {
      const fixture = createFixture(githubConfig("trailer"));
      const remoteOid = commit(fixture, FIRST);
      const localOid = commit(
        fixture,
        "feat: introduced\n\nWork-Item: https://github.com/acme/widgets/issues/43"
      );
      const refsFile = path.join(fixture.root, PUSHED_REFS);
      const ref = PUSH_REF;
      writeFileSync(refsFile, `${ref} ${localOid} ${ref} ${remoteOid}\n`);
      const result = cli(fixture, [VALIDATE_PUSH, "origin"], {
        LISA_PUSHED_REFS_FILE: refsFile,
        FAKE_GH_PR_JSON: JSON.stringify({
          body,
          headRefName: FEATURE,
          state: "OPEN",
          url: PR_URL,
        }),
      });
      expect(result.exitCode).toBe(exitCode);
      if (exitCode === undefined)
        expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK 1 commit(s)");
      else expect(result.stderr).toContain("does not match commit Work-Item");
    }
  );

  it.each([
    {
      name: "accepts previously pushed declarations",
      body: BOTH_DECLARED,
      exitCode: undefined,
    },
    {
      name: "refuses undeclared work in the new push",
      body: `Work-Item: ${REF}\n`,
      exitCode: 1,
    },
  ])("an incremental push $name", ({ body, exitCode }) => {
    const fixture = createFixture(githubConfig("trailer"));
    commit(fixture, FIRST);
    const remoteOid = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    commit(fixture, SECOND);
    const localOid = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const ref = PUSH_REF;
    const refsFile = path.join(fixture.root, PUSHED_REFS);
    writeFileSync(refsFile, `${ref} ${localOid} ${ref} ${remoteOid}\n`);

    const result = cli(fixture, [VALIDATE_PUSH, "origin"], {
      LISA_PUSHED_REFS_FILE: refsFile,
      FAKE_GH_PR_JSON: JSON.stringify({
        body,
        headRefName: FEATURE,
        state: "OPEN",
        url: PR_URL,
      }),
    });

    expect(result.exitCode).toBe(exitCode);
    if (exitCode === undefined)
      expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK 1 commit(s)");
    else expect(result.stderr).toContain("does not match commit Work-Item");
  });

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
    expect(result.stderr).toContain(PR_GATE);
  });
});

describe.each([VALIDATE_PR, VALIDATE_PUSH] as const)(
  "%s pull-request declaration representations",
  route => {
    const url42 = "https://github.com/acme/widgets/issues/42";
    const url43 = "https://github.com/acme/widgets/issues/43";
    const declarations = (...refs: string[]) =>
      refs.map(ref => `Work-Item: ${ref}\n`).join("");

    it.each([
      ["URL before canonical", declarations(url42, REF, OTHER_REF)],
      ["canonical before URL", declarations(REF, url42, OTHER_REF)],
      [
        "URL repository case variant",
        declarations(
          "https://github.com/ACME/WIDGETS/issues/42",
          REF,
          OTHER_REF
        ),
      ],
      [
        "second item amid earlier declarations",
        declarations(REF, url43, OTHER_REF),
      ],
    ])("refuses mixed same-item PR declarations: %s", (_name, body) => {
      const result = declarationResult(body, route);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(PR_GATE);
      expect(result.stderr).toContain("mixes URL and canonical");
    });

    it.each([
      ["URL and canonical distinct items", declarations(url42, OTHER_REF)],
      ["canonical and URL distinct items", declarations(REF, url43)],
      ["both URLs", declarations(url42, url43)],
      ["both canonical", BOTH_DECLARED],
      ["canonical repetition", declarations(REF, REF, OTHER_REF)],
      ["canonical casing", declarations(REF, "ACME/Widgets#42", OTHER_REF)],
      ["URL repetition", declarations(url42, url42, url43)],
    ])("accepts preserved PR declarations: %s", (_name, body) => {
      const result = declarationResult(body, route);
      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain(
        `WORK_ITEM_TRACKING_OK ${route === VALIDATE_PR ? 2 : 1} commit(s)`
      );
    });

    it("keeps malformed body issue URLs visible and refused", () => {
      const result = declarationResult(
        declarations(`${url42}?unexpected=1`, OTHER_REF),
        route
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid GitHub Work-Item");
      expect(result.stderr).toContain(PR_GATE);
    });
  }
);
