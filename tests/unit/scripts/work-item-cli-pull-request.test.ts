/**
 * Pull-request proof and verification-level resolution, driven in-process.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process alongside —
 * never instead of — the subprocess suites.
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
  MARKER,
  OTHER_REF,
  PR_URL,
  REF,
} from "../../support/work-item-cli.js";

const VERIFY_LEVEL = "verify-level";
const VALIDATE_PR = "validate-pr";
const TRAILER = "trailer";
const BODY_FILE = "--body-file";
const OUTSIDE = "[not fixable by editing this pull request]";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A pull request whose commits and body both name the bound work item.
 * @param fixture - The repository to build it in.
 * @returns The base commit and the body file to validate against.
 */
function goodPr(fixture: Fixture): { base: string; bodyFile: string } {
  const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
  commit(fixture, `feat: tracked\n\nWork-Item: ${REF}`);
  const bodyFile = path.join(fixture.root, "BODY");
  writeFileSync(bodyFile, `Work-Item: ${REF}\n`);
  return { base, bodyFile };
}

/**
 * The `validate-pr` argument vector for a body-file run.
 * @param base - Base commit of the range.
 * @param bodyFile - File holding the pull-request body.
 * @returns The arguments.
 */
function prArgs(base: string, bodyFile: string): string[] {
  return [VALIDATE_PR, "--base", base, BODY_FILE, bodyFile, "--url", PR_URL];
}

describe("in-process CLI: verification level", () => {
  it('defaults to "trailer" when the project says nothing', () => {
    const fixture = createFixture({
      github: { org: "acme", repo: "widgets" },
      tracker: "github",
    });
    expect(cli(fixture, [VERIFY_LEVEL]).stdout).toBe(TRAILER);
  });

  it("reports what the project declared", () => {
    expect(cli(createFixture(), [VERIFY_LEVEL]).stdout).toBe("full");
  });

  it("lets the environment degrade a declared level", () => {
    const fixture = createFixture();
    expect(
      cli(fixture, [VERIFY_LEVEL], { LISA_WORK_ITEM_VERIFY: TRAILER }).stdout
    ).toBe(TRAILER);
  });

  it("treats an empty override as absent", () => {
    const fixture = createFixture();
    expect(
      cli(fixture, [VERIFY_LEVEL], { LISA_WORK_ITEM_VERIFY: "" }).stdout
    ).toBe("full");
  });

  it("refuses a level it does not recognise, naming both valid ones", () => {
    const fixture = createFixture();
    const result = cli(fixture, [VERIFY_LEVEL], {
      LISA_WORK_ITEM_VERIFY: "some",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown workItem.verify 'some'");
    expect(result.stderr).toContain('"trailer"');
    expect(result.stderr).toContain('"full"');
  });

  it("contacts no tracker under trailer, and says so on success", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile), {
      FAKE_GH_ISSUE_FAIL: "1",
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("the tracker was not contacted");
  });

  it("does not demand a pull-request url under trailer", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile,
    ]);
    expect(result.exitCode).toBeUndefined();
  });
});

describe("in-process CLI: validate-pr", () => {
  it("passes when every requirement is met, and says what it proved", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile), {
      FAKE_GH_ISSUE_JSON: issueJson({
        closedByPullRequestsReferences: [{ url: PR_URL }],
      }),
    });
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(
      "WORK_ITEM_TRACKING_OK 1 commit(s), PR body, and tracker backlink"
    );
  });

  it("accepts the managed comment as the backlink when no native link exists", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile), {
      FAKE_GH_ISSUE_JSON: issueJson({
        comments: [{ body: `${MARKER} ${PR_URL}` }],
      }),
    });
    expect(result.exitCode).toBeUndefined();
  });

  it("refuses a managed comment naming a pull request that merely shares a prefix", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile), {
      FAKE_GH_ISSUE_JSON: issueJson({
        comments: [{ body: `${MARKER} ${PR_URL}9` }],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("has no verified backlink");
  });

  it("names the backlink command when the backlink is the only thing missing", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "1 work-item traceability requirement is unmet:"
    );
    expect(result.stderr).toContain(OUTSIDE);
    expect(result.stderr).toContain(
      `node scripts/lisa-work-item.mjs backlink --ref ${REF} --pr-url ${PR_URL}`
    );
  });

  it("reports every unmet requirement at once, unrecoverable first", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, `feat: tracked\n\nWork-Item: ${REF}`);
    const bodyFile = path.join(fixture.root, "BODY");
    writeFileSync(bodyFile, "No reference here at all\n");
    const result = cli(fixture, prArgs(base, bodyFile));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("2 work-item traceability requirements");
    const outside = result.stderr.indexOf(OUTSIDE);
    const inside = result.stderr.indexOf(
      "2. [fixable by editing this pull request]"
    );
    expect(outside).toBeGreaterThan(-1);
    expect(inside).toBeGreaterThan(outside);
  });

  it("names all four gates, so clearing three is not a surprise", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile));
    expect(result.stderr).toContain("All four gates, and when each one bites:");
    expect(result.stderr).toContain('ready role "status:ready"');
    expect(result.stderr).toContain('claimed role "status:in-progress"');
    expect(result.stderr).toContain("ONE matching `Work-Item:` trailer");
    expect(result.stderr).toContain(`managed \`${MARKER}\` backlink comment`);
  });

  it("names the project's OWN role names, not Lisa's defaults", () => {
    const fixture = createFixture({
      github: {
        labels: { build: { claimed: "state:building", ready: "state:queued" } },
        org: "acme",
        repo: "widgets",
      },
      tracker: "github",
      workItem: { verify: "full" },
    });
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile), {
      FAKE_GH_ISSUE_JSON: issueJson({ labels: [{ name: "state:building" }] }),
    });
    expect(result.stderr).toContain('ready role "state:queued"');
    expect(result.stderr).toContain('claimed role "state:building"');
    expect(result.stderr).not.toContain("status:ready");
  });

  it("says the backlink gate does not apply under trailer", () => {
    const fixture = createFixture(githubConfig(TRAILER));
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, "feat: untracked change");
    const bodyFile = path.join(fixture.root, "BODY");
    writeFileSync(bodyFile, `Work-Item: ${REF}\n`);
    const result = cli(fixture, prArgs(base, bodyFile));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "the tracker backlink is NOT required here"
    );
    expect(result.stderr).not.toContain(`managed \`${MARKER}\` backlink`);
  });

  it("refuses a body naming a different work item than the commits", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, `feat: tracked\n\nWork-Item: ${REF}`);
    const bodyFile = path.join(fixture.root, "BODY");
    writeFileSync(bodyFile, `Work-Item: ${OTHER_REF}\n`);
    const result = cli(fixture, prArgs(base, bodyFile));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Pull request Work-Item ${OTHER_REF} does not match commit Work-Item ${REF}`
    );
  });

  it("permits a release-only pull request without inventing a work item", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, "chore(release): 1.2.3 [skip ci]");
    const bodyFile = path.join(fixture.root, "BODY");
    writeFileSync(bodyFile, "release\n");
    const result = cli(fixture, prArgs(base, bodyFile));
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK 0 commit(s)");
  });

  it("requires a base to compare against", () => {
    const result = cli(createFixture(), [VALIDATE_PR]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "validate-pr requires --base or LISA_PR_BASE_SHA"
    );
  });

  it("falls back to the environment when a flag carries no value", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(
      fixture,
      [VALIDATE_PR, "--base", BODY_FILE, bodyFile, "--url", PR_URL],
      { LISA_PR_BASE_SHA: base }
    );
    expect(result.stderr).not.toContain("requires --base");
  });

  it("requires a pull-request url alongside a body file under full", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("validate-pr requires --pr-url/--url");
  });

  it("refuses an unreachable tracker, because this IS the recheck", () => {
    const fixture = createFixture();
    const { base, bodyFile } = goodPr(fixture);
    const result = cli(fixture, prArgs(base, bodyFile), {
      FAKE_GH_ISSUE_FAIL: "1",
      FAKE_GH_STDERR: "gh auth login required",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("this check is the one");
  });

  it("fetches the pull request when no body file is supplied", () => {
    const fixture = createFixture();
    const { base } = goodPr(fixture);
    const result = cli(
      fixture,
      [VALIDATE_PR, "--base", base, "--pr-number", "7"],
      {
        FAKE_GH_ISSUE_JSON: issueJson({
          closedByPullRequestsReferences: [{ url: PR_URL }],
        }),
      }
    );
    expect(result.exitCode).toBeUndefined();
  });

  it("refuses when no pull request can be reached at all", () => {
    const fixture = createFixture();
    const { base } = goodPr(fixture);
    const result = cli(
      fixture,
      [VALIDATE_PR, "--base", base, "--pr-number", "7"],
      { FAKE_GH_PR_MISSING: "1" }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "validate-pr requires --pr-number or --body-file"
    );
  });

  it("refuses a pull request whose commits carry no trailer at all", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, "feat: untracked change");
    const bodyFile = path.join(fixture.root, "BODY");
    writeFileSync(bodyFile, `Work-Item: ${REF}\n`);
    const result = cli(fixture, prArgs(base, bodyFile));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No Work-Item trailer anywhere");
  });
});
