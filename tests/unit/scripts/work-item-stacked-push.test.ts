/** Native Git stack controls for the push gate's PR-relative scope. */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  cli,
  commit,
  createFixture,
  Fixture,
  git,
  githubConfig,
  OTHER_REF,
  PR_URL,
  REF,
} from "../../support/work-item-cli.js";

const SCRIPT = path.resolve(
  __dirname,
  "../../../all/copy-overwrite/scripts/lisa-work-item.mjs"
);
const BRANCH = "feature/tracked";
const BASE_BRANCH = "feature/base";
const OTHER_BRANCH = "feature/other";
type PushMode = "native" | "in-process";

/** Run either the native stdin entrypoint or the same CLI in-process for mutation coverage. */
function validatePush(fixture: Fixture, input: string, mode: PushMode) {
  if (mode === "in-process") {
    const refs = path.join(fixture.root, "captured-push-refs");
    writeFileSync(refs, input);
    const result = cli(fixture, ["validate-push", "origin"], {
      LISA_PUSHED_REFS_FILE: refs,
    });
    return { ...result, status: result.exitCode ?? 0 };
  }
  return boundedSpawnSync({
    args: [SCRIPT, "validate-push", "origin"],
    command: process.execPath,
    cwd: fixture.root,
    env: fixture.env,
    input,
    label: "stacked push traceability",
  });
}

/** A real local stack, with controlled GitHub metadata only. */
function stack(): { fixture: Fixture; oldHead: string; base: string } {
  const fixture = createFixture(githubConfig("trailer"));
  const { root, env } = fixture;
  const origin = path.join(root, "origin.git");
  git(root, ["init", "--bare", "--initial-branch=main", origin], env);
  git(root, ["remote", "add", "origin", origin], env);
  git(root, ["push", "-q", "origin", "main"], env);
  git(root, ["fetch", "-q", "origin"], env);
  git(
    root,
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    env
  );
  const oldHead = commit(fixture, `fix: child work\n\nWork-Item: ${REF}`);
  git(root, ["push", "-q", "origin", BRANCH], env);
  git(root, ["switch", "-q", "-c", BASE_BRANCH, "main"], env);
  const base = commit(fixture, `fix: base work\n\nWork-Item: ${OTHER_REF}`);
  git(root, ["push", "-q", "origin", BASE_BRANCH], env);
  git(root, ["switch", "-q", BRANCH], env);
  git(root, ["merge", "--no-ff", "-m", "Merge base", BASE_BRANCH], env);
  commit(fixture, `fix: child follow-up\n\nWork-Item: ${REF}`);
  fixture.env.FAKE_GH_PR_JSON = JSON.stringify({
    baseRefName: BASE_BRANCH,
    baseRefOid: base,
    body: `Work-Item: ${REF}`,
    headRefName: BRANCH,
    state: "OPEN",
    url: PR_URL,
  });
  return { base, fixture, oldHead };
}

/** Run the actual CLI against captured pre-push refs. */
function pushInMode(
  fixture: Fixture,
  oldHead: string,
  mode: PushMode,
  options: { branch?: string; localRef?: string; remoteRef?: string } = {}
) {
  const branch = options.branch ?? BRANCH;
  const head = git(fixture.root, ["rev-parse", branch], fixture.env);
  const localRef = options.localRef ?? `refs/heads/${branch}`;
  const remoteRef = options.remoteRef ?? `refs/heads/${branch}`;
  return validatePush(
    fixture,
    `${localRef} ${head} ${remoteRef} ${oldHead}\n`,
    mode
  );
}

afterAll(() => {
  cleanupFixtures();
  cleanupTemplates();
});

describe.each<PushMode>(["native", "in-process"])(
  "%s stacked PR push scope",
  mode => {
    const push = (
      fixture: Fixture,
      oldHead: string,
      options: { branch?: string; localRef?: string; remoteRef?: string } = {}
    ) => pushInMode(fixture, oldHead, mode, options);
    it("accepts only the child's item in both push and PR CI", () => {
      const { fixture, oldHead, base } = stack();
      const pushed = push(fixture, oldHead);
      const bodyFile = path.join(fixture.root, "pr-body.txt");
      writeFileSync(bodyFile, `Work-Item: ${REF}`);
      const ci = boundedSpawnSync({
        args: [SCRIPT, "validate-pr", "--base", base, "--body-file", bodyFile],
        command: process.execPath,
        cwd: fixture.root,
        env: fixture.env,
        label: "stacked PR CI traceability",
      });
      expect(ci.status, `${ci.stdout}${ci.stderr}`).toBe(0);
      expect(pushed.status, `${pushed.stdout}${pushed.stderr}`).toBe(0);
      expect(pushed.stdout).toContain("excluding PR base ");
    });

    it("still refuses an untrailered child commit", () => {
      const { fixture, oldHead } = stack();
      commit(fixture, "fix: missing child trailer");
      const result = push(fixture, oldHead);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Work-Item");
    });

    it("keeps ordinary PR pushes strict about all introduced items", () => {
      const { fixture, oldHead } = stack();
      fixture.env.FAKE_GH_PR_JSON = JSON.stringify({
        baseRefName: "main",
        baseRefOid: git(fixture.root, ["rev-parse", "main"], fixture.env),
        body: `Work-Item: ${REF}`,
        headRefName: BRANCH,
        state: "OPEN",
        url: PR_URL,
      });
      const result = push(fixture, oldHead);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(OTHER_REF);
    });

    it("does not exclude a base for a different pushed branch", () => {
      const { fixture } = stack();
      git(fixture.root, ["branch", OTHER_BRANCH], fixture.env);
      git(fixture.root, ["switch", "-q", OTHER_BRANCH], fixture.env);
      const oldHead = git(
        fixture.root,
        ["rev-parse", `origin/${BRANCH}`],
        fixture.env
      );
      git(
        fixture.root,
        ["push", "-q", "origin", `${oldHead}:refs/heads/${OTHER_BRANCH}`],
        fixture.env
      );
      const result = push(fixture, oldHead, { branch: OTHER_BRANCH });
      expect(result.status).not.toBe(0);
    });

    it("accepts an explicit HEAD source for the child destination", () => {
      const { fixture, oldHead } = stack();
      const result = push(fixture, oldHead, { localRef: "HEAD" });
      expect(result.status, result.stderr).toBe(0);
    });

    it("does not apply the child's exclusion to an aliased destination", () => {
      const { fixture, oldHead } = stack();
      git(
        fixture.root,
        ["push", "-q", "origin", `${oldHead}:refs/heads/${OTHER_BRANCH}`],
        fixture.env
      );
      const result = push(fixture, oldHead, {
        remoteRef: `refs/heads/${OTHER_BRANCH}`,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(OTHER_REF);
    });

    it("selects the child destination in a multi-ref HEAD push", () => {
      const { fixture, oldHead } = stack();
      git(
        fixture.root,
        ["switch", "-q", "-c", OTHER_BRANCH, "main"],
        fixture.env
      );
      const other = commit(
        fixture,
        `fix: unrelated branch\n\nWork-Item: ${OTHER_REF}`
      );
      git(fixture.root, ["switch", "-q", BRANCH], fixture.env);
      const head = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
      const result = validatePush(
        fixture,
        `HEAD ${head} refs/heads/${BRANCH} ${oldHead}\nrefs/heads/${OTHER_BRANCH} ${other} refs/heads/${OTHER_BRANCH} ${"0".repeat(40)}\n`,
        mode
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK HEAD:");
    });

    it("keeps CI strict about a body declaring inherited base work", () => {
      const { fixture, oldHead, base } = stack();
      const pr = JSON.parse(fixture.env.FAKE_GH_PR_JSON ?? "{}");
      fixture.env.FAKE_GH_PR_JSON = JSON.stringify({
        ...pr,
        body: `Work-Item: ${REF}\nWork-Item: ${OTHER_REF}`,
      });
      const result = push(fixture, oldHead);
      // Partial push ranges allow prior work; CI still checks the whole PR.
      expect(result.status, result.stderr).toBe(0);
      const bodyFile = path.join(fixture.root, "pr-body.txt");
      writeFileSync(bodyFile, `Work-Item: ${REF}\nWork-Item: ${OTHER_REF}`);
      const ci = boundedSpawnSync({
        args: [SCRIPT, "validate-pr", "--base", base, "--body-file", bodyFile],
        command: process.execPath,
        cwd: fixture.root,
        env: fixture.env,
        label: "stacked PR extra declaration",
      });
      expect(ci.status).not.toBe(0);
      expect(ci.stderr).toContain(OTHER_REF);
    });

    it.each([undefined, "bad", "f".repeat(40)])(
      "refuses an unprovable base commit %s",
      baseRefOid => {
        const { fixture, oldHead } = stack();
        const pr = JSON.parse(fixture.env.FAKE_GH_PR_JSON ?? "{}");
        fixture.env.FAKE_GH_PR_JSON = JSON.stringify({ ...pr, baseRefOid });
        const result = push(fixture, oldHead);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("base commit");
      }
    );
  }
);
