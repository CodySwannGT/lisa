/**
 * Commits already on a deploy-chain branch, and what the gate asks of them.
 *
 * A back-merge (`staging` -> `dev`) and a promote (`dev` -> `staging`) both put
 * ANOTHER branch's already-authored commits into `git rev-list <base>..<head>`.
 * Requiring a `Work-Item:` trailer on those asks for something no edit to the
 * pull request can produce — the only remedy is rewriting a protected branch's
 * history — so every back-merge pull request was structurally unable to pass
 * and the back-sync ritual stopped.
 *
 * Every case here is gate-SPECIFIC on purpose. `🔗 Work-Item Traceability`
 * reports two independent requirements under one check name — the trailer on
 * each COMMIT (gate 3) and the trailer in the pull-request BODY (gate 4) — and
 * reading the check's red/green summary instead of the finding it printed is
 * what produced four misdiagnoses of this defect in a single day. Asserting on
 * "did it fail" would repeat that; these assert on WHICH requirement failed.
 *
 * See `tests/support/work-item-cli.ts` for why these run in-process.
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
  REF,
} from "../../support/work-item-cli.js";

const VALIDATE_PR = "validate-pr";
const BODY_FILE = "--body-file";
const PROTECTED = "staging";
const SYNC = "sync/staging-to-main";
const COMMIT_GATE = "No Work-Item trailer anywhere in the commit message";
const BODY_GATE = "No Work-Item trailer anywhere in the pull request body";
const EXEMPTED = "already on a deploy-chain branch";

afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * A project whose deploy chain is `main` then `staging`.
 *
 * The chain is what makes a branch protected as far as this gate is concerned,
 * and it is read from `.lisa.config.json` — so it has to be in the fixture's
 * committed config, not bolted on afterwards.
 * @returns The config to write as `.lisa.config.json`.
 */
function chainConfig(): object {
  return {
    deploy: {
      branches: { dev: "main", staging: PROTECTED },
      order: ["dev", "staging"],
    },
    github: { org: "acme", repo: "widgets" },
    tracker: "github",
    workItem: { verify: "trailer" },
  };
}

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
 * Build a real back-merge: another branch's untrailered work, merged onto a
 * sync branch cut from the base.
 *
 * The shape `lisa-sync-down` produces, and the shape every failing back-merge
 * pull request in the history had: the range carries commits that were authored
 * on — and traced on — a different branch entirely.
 * @param fixture - The repository to build in.
 * @returns The base commit of the range.
 */
function backMerge(fixture: Fixture): string {
  const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
  git(fixture.root, ["switch", "-q", "-c", PROTECTED, "main"], fixture.env);
  commit(fixture, "fix(auth): signup verification code recovery");
  commit(fixture, "fix(wallet): GIDX non-zero ResponseCode");
  git(fixture.root, ["switch", "-q", "-c", SYNC, "main"], fixture.env);
  git(
    fixture.root,
    ["merge", "-q", "--no-ff", "-m", `Merge ${PROTECTED} into main`, PROTECTED],
    fixture.env
  );
  return base;
}

describe("deploy-chain commits are traced where they were authored", () => {
  it("passes a back-merge whose commits all belong to another chain branch", () => {
    const fixture = createFixture(chainConfig());
    const base = backMerge(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(`2 ${EXEMPTED}`);
  });

  it("still refuses a newly authored commit on the back-merge branch", () => {
    const fixture = createFixture(chainConfig());
    const base = backMerge(fixture);
    commit(fixture, "chore: reconcile lockfile after back-merge");
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(COMMIT_GATE);
  });

  it("accepts that same commit once it carries the trailer", () => {
    const fixture = createFixture(chainConfig());
    const base = backMerge(fixture);
    commit(fixture, `chore: reconcile lockfile\n\nWork-Item: ${REF}`);
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBeUndefined();
    expect(result.stdout).toContain(`1 commit(s) (2 ${EXEMPTED}`);
  });

  it("leaves an ordinary feature branch requiring a trailer on every commit", () => {
    const fixture = createFixture(chainConfig());
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    commit(fixture, "feat: something new");
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(COMMIT_GATE);
  });

  it("keeps the pull-request BODY trailer required on a back-merge", () => {
    // Gate 4 is a separate requirement met by a separate edit. The exemption
    // speaks only to gate 3, and an implementation that returned early once the
    // commits were exempt would retire gate 4 on exactly the pull requests this
    // change makes mergeable.
    const fixture = createFixture(chainConfig());
    const base = backMerge(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, "Back-merging staging into main.\n"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(BODY_GATE);
    expect(result.stderr).not.toContain(COMMIT_GATE);
  });

  it("refuses a branch that declares ITSELF a chain branch in the same change", () => {
    // The chain is read from the config at the BASE. Reading the working tree
    // would read the HEAD's config on a pull request, and any branch could then
    // exempt its own commits by adding one line to `deploy.branches`.
    const fixture = createFixture(chainConfig());
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    git(
      fixture.root,
      ["switch", "-q", "-c", "evil/self-declared"],
      fixture.env
    );
    const claimed = {
      ...chainConfig(),
      deploy: {
        branches: {
          dev: "main",
          evil: "evil/self-declared",
          staging: PROTECTED,
        },
        order: ["dev", "staging"],
      },
    };
    writeFileSync(
      path.join(fixture.root, ".lisa.config.json"),
      `${JSON.stringify(claimed, null, 2)}\n`
    );
    git(fixture.root, ["add", ".lisa.config.json"], fixture.env);
    git(
      fixture.root,
      ["commit", "-q", "-m", "chore: declare this branch protected"],
      fixture.env
    );
    commit(fixture, "feat: untraceable work");
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(COMMIT_GATE);
  });

  it("exempts nothing when the project declares no deploy chain", () => {
    const fixture = createFixture({
      github: { org: "acme", repo: "widgets" },
      tracker: "github",
      workItem: { verify: "trailer" },
    });
    const base = backMerge(fixture);
    const result = cli(fixture, [
      VALIDATE_PR,
      "--base",
      base,
      BODY_FILE,
      bodyFile(fixture, `Work-Item: ${REF}\n`),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(COMMIT_GATE);
  });
});
