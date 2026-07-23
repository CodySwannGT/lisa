/* eslint-disable max-lines, sonarjs/no-duplicate-string, jsdoc/require-param, jsdoc/require-returns, @eslint-community/eslint-comments/disable-enable-pair -- one hermetic fake-provider fixture exercises the full local tracking contract */
/**
 * Hermetic tests for Lisa's provider-neutral work-item Git gate.
 *
 * Every case runs in a disposable repository and resolves tracker access through
 * fake gh/acli/curl executables, so a developer's credentials cannot affect the
 * result.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanGitEnv } from "../../helpers/test-utils.js";

const SCRIPT = path.resolve("scripts/lisa-work-item.mjs");
const GIT = "/usr/bin/git";
const ZERO_OID = "0".repeat(40);
const IDENTITY = {
  GIT_AUTHOR_NAME: "Lisa Test",
  GIT_AUTHOR_EMAIL: "lisa@example.test",
  GIT_COMMITTER_NAME: "Lisa Test",
  GIT_COMMITTER_EMAIL: "lisa@example.test",
};

/** Captured validator process result. */
interface CommandResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

/** Disposable repository and its isolated executable environment. */
interface Fixture {
  bin: string;
  env: NodeJS.ProcessEnv;
  root: string;
}

let fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures)
    rmSync(fixture, { force: true, recursive: true });
  fixtures = [];
});

/** Write an executable fake CLI. */
function executable(file: string, body: string): void {
  writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(file, 0o755);
}

/** Run Git inside a disposable fixture. */
function git(root: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(GIT, args, { cwd: root, encoding: "utf8", env });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

/** Run the validator entrypoint inside a disposable fixture. */
function command(
  fixture: Fixture,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string } = {}
): CommandResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    env: { ...fixture.env, ...options.env },
    input: options.input,
  });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** Create an initialized repository with fake tracker transports. */
function createFixture(config: object = githubConfig()): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-work-item-"));
  const bin = path.join(root, "fake-bin");
  const env = cleanGitEnv(process.env, {
    ...IDENTITY,
    FAKE_ACLI_JSON:
      '{"key":"LAS-12","fields":{"project":{"key":"LAS"},"status":{"name":"In Progress","statusCategory":{"key":"indeterminate"}},"labels":["repo:widgets"],"issuetype":{"name":"Task"},"subtasks":[],"comment":{"comments":[]}}}',
    FAKE_CURL_JSON:
      '{"data":{"issue":{"id":"id-12","identifier":"LIN-12","team":{"key":"LIN"},"state":{"type":"started"},"labels":{"nodes":[{"name":"repo:widgets"},{"name":"status:in-progress"},{"name":"type:Task"}]},"children":{"nodes":[]},"attachments":{"nodes":[]},"comments":{"nodes":[]}}}}',
    FAKE_GH_ISSUE_JSON:
      '{"number":42,"url":"https://github.com/acme/widgets/issues/42","state":"OPEN","labels":[{"name":"repo:identity"},{"name":"status:in-progress"},{"name":"type:Bug"}],"comments":[],"closedByPullRequestsReferences":[]}',
    FAKE_GH_HIERARCHY_JSON:
      '{"data":{"repository":{"issue":{"subIssues":{"nodes":[]}}}}}',
    FAKE_GH_PR_JSON:
      '{"url":"https://github.com/acme/code/pull/7","body":"Work-Item: acme/widgets#42","state":"OPEN"}',
    GITHUB_REPOSITORY: "acme/code",
    LINEAR_API_KEY: "fake-linear-key",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  });

  fixtures.push(root);
  mkdirSync(bin);

  executable(
    path.join(bin, "gh"),
    `
if [ -n "\${FAKE_GH_LOG:-}" ]; then printf '%s\\n' "$*" >> "$FAKE_GH_LOG"; fi
case "\${1:-} \${2:-}" in
  "issue view")
    if [ "\${3:-}" = "43" ]; then
      printf '%s\\n' '{"number":43,"state":"OPEN","labels":[{"name":"status:in-progress"},{"name":"type:Bug"}],"comments":[],"closedByPullRequestsReferences":[]}'
    elif [ "\${3:-}" = "99" ]; then
      printf '%s\\n' '{"number":99,"state":"CLOSED","labels":[{"name":"status:done"},{"name":"type:Task"}],"comments":[],"closedByPullRequestsReferences":[]}'
    else
      printf '%s\\n' "$FAKE_GH_ISSUE_JSON"
    fi
    ;;
  "api graphql") printf '%s\\n' "$FAKE_GH_HIERARCHY_JSON" ;;
  "pr view")
    [ "\${FAKE_GH_PR_MISSING:-0}" != "1" ] || exit 1
    printf '%s\\n' "$FAKE_GH_PR_JSON"
    ;;
  "repo view") printf '%s\\n' '{"nameWithOwner":"acme/code"}' ;;
  *) echo "unexpected gh invocation: $*" >&2; exit 70 ;;
esac`
  );
  executable(
    path.join(bin, "acli"),
    `
[ "\${FAKE_ACLI_FAIL:-0}" != "1" ] || exit 1
if [ "\${1:-} \${2:-}" = "auth status" ]; then
  printf 'Site: %s\\n' "\${FAKE_ACLI_SITE:-acme.atlassian.net}"
  exit 0
fi
printf '%s\\n' "$FAKE_ACLI_JSON"`
  );
  executable(
    path.join(bin, "curl"),
    `
[ "\${FAKE_CURL_FAIL:-0}" != "1" ] || exit 1
printf '%s\\n' "$FAKE_CURL_JSON"`
  );

  git(root, ["init", "-q", "-b", "main"], env);
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    `${JSON.stringify(config, null, 2)}\n`
  );
  git(root, ["add", ".lisa.config.json"], env);
  git(root, ["commit", "-q", "-m", "test fixture"], env);
  git(root, ["switch", "-q", "-c", "feature/tracked"], env);
  return { bin, env, root };
}

/** Build the minimal GitHub tracker config. */
function githubConfig(repository = "widgets"): object {
  return { tracker: "github", github: { org: "acme", repo: repository } };
}

/** Build a claimed, leaf Linear issue payload carrying the given labels. */
function linearIssueResponse(labels: string[]): string {
  return JSON.stringify({
    data: {
      issue: {
        id: "id-12",
        identifier: "LIN-12",
        team: { key: "LIN" },
        state: { type: "started" },
        labels: { nodes: labels.map(name => ({ name })) },
        children: { nodes: [] },
        attachments: { nodes: [] },
        comments: { nodes: [] },
      },
    },
  });
}

/** Add one empty fixture commit and return its object ID. */
function commit(fixture: Fixture, message: string): string {
  git(
    fixture.root,
    ["commit", "-q", "--allow-empty", "-m", message],
    fixture.env
  );
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
}

/** Read the head-name ref recorded by the in-progress rebase. */
function rebaseHeadName(fixture: Fixture): string {
  const stateDir = git(
    fixture.root,
    ["rev-parse", "--git-path", "rebase-merge"],
    fixture.env
  );
  return readFileSync(
    path.resolve(fixture.root, stateDir, "head-name"),
    "utf8"
  ).trim();
}

/**
 * Drive a REAL `git rebase main` of the given branch into a conflicted stop:
 * the branch and main both rewrite shared.txt, so the rebase wedges mid-flight
 * with `.git/rebase-merge/head-name` = the branch and HEAD detached — the
 * exact #1956 rebase-lane state.
 */
function wedgeRebase(fixture: Fixture, branch: string): void {
  const shared = path.join(fixture.root, "shared.txt");
  writeFileSync(shared, `${branch} change\n`);
  git(fixture.root, ["add", "shared.txt"], fixture.env);
  git(
    fixture.root,
    ["commit", "-q", "-m", "feat: branch change\n\nWork-Item: acme/widgets#42"],
    fixture.env
  );
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  writeFileSync(shared, "main change\n");
  git(fixture.root, ["add", "shared.txt"], fixture.env);
  git(fixture.root, ["commit", "-q", "-m", "chore: base change"], fixture.env);
  git(fixture.root, ["switch", "-q", branch], fixture.env);
  if (
    spawnSync(GIT, ["rebase", "main"], {
      cwd: fixture.root,
      encoding: "utf8",
      env: fixture.env,
    }).status === 0
  )
    throw new Error("expected the rebase to stop on a conflict");
  if (rebaseHeadName(fixture) !== `refs/heads/${branch}`)
    throw new Error("unexpected rebase head-name");
}

/** Bind the work item on the current branch and add one tracked commit. */
function bindThenCommitTracked(fixture: Fixture): string {
  if (command(fixture, ["bind", "acme/widgets#42"]).status !== 0)
    throw new Error("expected the bind to succeed");
  return commit(fixture, "feat: tracked change\n\nWork-Item: acme/widgets#42");
}

/**
 * Advance main with a foreign CLOSED-item commit, mark it as origin/main,
 * merge it into the bound branch, and add one more tracked commit.
 */
function mergeAdvancedBaseThenFollowUp(fixture: Fixture): string {
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  git(
    fixture.root,
    [
      "update-ref",
      "refs/remotes/origin/main",
      commit(fixture, "feat: foreign base work\n\nWork-Item: acme/widgets#99"),
    ],
    fixture.env
  );
  git(fixture.root, ["switch", "-q", "feature/tracked"], fixture.env);
  git(
    fixture.root,
    ["merge", "-q", "--no-ff", "-m", "Merge branch 'main'", "main"],
    fixture.env
  );
  return commit(
    fixture,
    "feat: follow-up after merge\n\nWork-Item: acme/widgets#42"
  );
}

/**
 * Merge-sync scenario for the #1956 merge lane: the bound branch has a
 * previously pushed tip, the base advances with a foreign commit whose trailer
 * references a CLOSED issue, and the branch merges the base then adds one more
 * tracked commit.
 */
function setupMergeLane(fixture: Fixture): { head: string; pushedTip: string } {
  const pushedTip = bindThenCommitTracked(fixture);
  const head = mergeAdvancedBaseThenFollowUp(fixture);
  return { head, pushedTip };
}

/** Point the fixture's origin/HEAD symref at the fake default branch. */
function setOriginHead(fixture: Fixture): void {
  git(
    fixture.root,
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    fixture.env
  );
}

/**
 * Reproduce finding F1 of #1956's security review: an agent with local repo
 * control creates a tracking ref that already contains the branch tip and
 * repoints `refs/remotes/origin/HEAD` at it. The guard's own checks still pass
 * (the target is under `refs/remotes/origin/` and resolves), so `validate-push`
 * subtracts the whole branch and the pushed range comes back EMPTY.
 * @param fixture - Disposable repository
 * @param tip - Commit the crafted "default branch" is made to contain
 */
function launderPushRange(fixture: Fixture, tip: string): void {
  git(
    fixture.root,
    ["update-ref", "refs/remotes/origin/attacker", tip],
    fixture.env
  );
  git(
    fixture.root,
    [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/attacker",
    ],
    fixture.env
  );
}

/** Seed a bound branch whose base is already published as origin/main. */
function publishedBase(fixture: Fixture): string {
  const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
  git(
    fixture.root,
    ["update-ref", "refs/remotes/origin/main", base],
    fixture.env
  );
  if (command(fixture, ["bind", "acme/widgets#42"]).status !== 0)
    throw new Error("expected the bind to succeed");
  return base;
}

/** Run `validate-push` for an existing-branch push of base..head. */
function pushRange(
  fixture: Fixture,
  base: string,
  head: string,
  env: NodeJS.ProcessEnv = {}
): CommandResult {
  return command(fixture, ["validate-push", "origin"], {
    env: { FAKE_GH_PR_MISSING: "1", ...env },
    input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${base}\n`,
  });
}

/** Run `validate-pr` the way Lisa's CI job does — env-var form, numbered PR. */
function prRange(
  fixture: Fixture,
  base: string,
  head: string,
  env: NodeJS.ProcessEnv = {}
): CommandResult {
  return command(fixture, ["validate-pr"], {
    env: {
      LISA_PR_BASE_SHA: base,
      LISA_PR_HEAD_SHA: head,
      LISA_PR_NUMBER: "7",
      ...env,
    },
  });
}

describe("work-item binding and commit messages", () => {
  it("merges local config, writes worktree-private state atomically, and preserves the subject", () => {
    const fixture = createFixture(githubConfig("identity"));
    writeFileSync(
      path.join(fixture.root, ".lisa.config.local.json"),
      '{"github":{"queueRepo":"acme/widgets"}}\n'
    );

    const bound = command(fixture, ["bind", "acme/widgets#42"]);
    expect(bound.status).toBe(0);
    const stateFile = path.join(fixture.root, ".git", "lisa", "work-item.json");
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toMatchObject({
      branch: "feature/tracked",
      provider: "github",
      ref: "acme/widgets#42",
      version: 1,
    });
    expect(statSync(stateFile).mode & 0o777).toBe(0o600);
    expect(readdirSync(path.dirname(stateFile))).toEqual(["work-item.json"]);

    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(
      messageFile,
      "feat: preserve this subject\n\nLonger context.\n"
    );
    expect(
      command(fixture, ["prepare-commit-msg", messageFile, "message"]).status
    ).toBe(0);
    expect(
      command(fixture, ["prepare-commit-msg", messageFile, "message"]).status
    ).toBe(0);

    const prepared = readFileSync(messageFile, "utf8");
    expect(prepared.split("\n")[0]).toBe("feat: preserve this subject");
    expect(prepared.match(/^Work-Item: acme\/widgets#42$/gm)).toHaveLength(1);
    const validated = command(fixture, ["validate-commit", messageFile]);
    expect(validated.status).toBe(0);
    expect(validated.stdout).toContain("WORK_ITEM_TRACKING_OK acme/widgets#42");
  });

  it("fails closed for missing, duplicate, mismatched, and closed GitHub work items", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");

    for (const message of [
      "fix: missing trailer\n",
      "fix: duplicate\n\nWork-Item: acme/widgets#42\nWork-Item: acme/widgets#42\n",
      "fix: wrong repo\n\nWork-Item: acme/elsewhere#42\n",
    ]) {
      writeFileSync(messageFile, message);
      const result = command(fixture, ["validate-commit", messageFile]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Mention the ticket this work relates to"
      );
    }

    writeFileSync(messageFile, "fix: closed\n\nWork-Item: acme/widgets#42\n");
    const closed = command(fixture, ["validate-commit", messageFile], {
      env: {
        FAKE_GH_ISSUE_JSON:
          '{"number":42,"state":"CLOSED","comments":[],"closedByPullRequestsReferences":[]}',
      },
    });
    expect(closed.status).toBe(1);
    expect(closed.stderr).toContain("is closed");
  });

  it("binds before branch creation in detached HEAD, then requires attachment", () => {
    const fixture = createFixture();
    git(fixture.root, ["checkout", "-q", "--detach"], fixture.env);

    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const current = command(fixture, ["current"]);
    expect(JSON.parse(current.stdout).branch).toBeNull();

    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "fix: detached\n\nWork-Item: acme/widgets#42\n");
    expect(command(fixture, ["validate-commit", messageFile]).status).toBe(1);

    git(
      fixture.root,
      ["switch", "-q", "-c", "feature/from-detached"],
      fixture.env
    );
    expect(command(fixture, ["attach-branch"]).status).toBe(0);
    expect(command(fixture, ["validate-commit", messageFile]).status).toBe(0);
  });

  it("honors an explicit trusted config without merging head-local overrides", () => {
    const fixture = createFixture();
    const trusted = path.join(fixture.root, "trusted-config.json");
    writeFileSync(trusted, `${JSON.stringify(githubConfig())}\n`);
    writeFileSync(
      path.join(fixture.root, ".lisa.config.local.json"),
      '{"github":{"queueRepo":"acme/attacker"}}\n'
    );

    const result = command(fixture, ["bind", "acme/widgets#42"], {
      env: { LISA_TRACKING_CONFIG_FILE: trusted },
    });
    expect(result.status).toBe(0);
  });

  it("rejects unclaimed, cross-repo, and container GitHub issues", () => {
    const fixture = createFixture({
      tracker: "github",
      github: { org: "acme", repo: "identity", queueRepo: "acme/widgets" },
    });
    const issue = (labels: string[]) =>
      JSON.stringify({
        number: 42,
        state: "OPEN",
        labels: labels.map(name => ({ name })),
        comments: [],
        closedByPullRequestsReferences: [],
      });

    const unclaimed = command(fixture, ["bind", "acme/widgets#42"], {
      env: {
        FAKE_GH_ISSUE_JSON: issue([
          "repo:identity",
          "status:ready",
          "type:Bug",
        ]),
      },
    });
    expect(unclaimed.status).toBe(1);
    expect(unclaimed.stderr).toContain("is not claimed");

    const wrongRepo = command(fixture, ["bind", "acme/widgets#42"], {
      env: {
        FAKE_GH_ISSUE_JSON: issue([
          "repo:other",
          "status:in-progress",
          "type:Bug",
        ]),
      },
    });
    expect(wrongRepo.status).toBe(1);
    expect(wrongRepo.stderr).toContain("not scoped to repository identity");

    const epic = command(fixture, ["bind", "acme/widgets#42"], {
      env: {
        FAKE_GH_ISSUE_JSON: issue([
          "repo:identity",
          "status:in-progress",
          "type:Epic",
        ]),
      },
    });
    expect(epic.status).toBe(1);
    expect(epic.stderr).toContain("is a container");

    const parent = command(fixture, ["bind", "acme/widgets#42"], {
      env: {
        FAKE_GH_ISSUE_JSON: issue([
          "repo:identity",
          "status:in-progress",
          "type:Task",
        ]),
        FAKE_GH_HIERARCHY_JSON:
          '{"data":{"repository":{"issue":{"subIssues":{"nodes":[{"state":"OPEN"}]}}}}}',
      },
    });
    expect(parent.status).toBe(1);
    expect(parent.stderr).toContain("is a container");
  });

  it("accepts a GitHub issue scoped by the bare repo-name label (#1957)", () => {
    const fixture = createFixture({
      tracker: "github",
      github: { org: "acme", repo: "identity", queueRepo: "acme/widgets" },
    });
    const bare = command(fixture, ["bind", "acme/widgets#42"], {
      env: {
        FAKE_GH_ISSUE_JSON: JSON.stringify({
          number: 42,
          url: "https://github.com/acme/widgets/issues/42",
          state: "OPEN",
          labels: [
            { name: "identity" },
            { name: "status:in-progress" },
            { name: "type:Bug" },
          ],
          comments: [],
          closedByPullRequestsReferences: [],
        }),
      },
    });
    expect(bare.status).toBe(0);
  });

  it("exempts only the exact release subject", () => {
    const fixture = createFixture();
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "chore(release): 1.2.3 [skip ci]\n");
    expect(command(fixture, ["validate-commit", messageFile]).stdout).toContain(
      "WORK_ITEM_TRACKING_OK release"
    );

    writeFileSync(messageFile, "chore(release): prepare 1.2.3 [skip ci]\n");
    expect(command(fixture, ["validate-commit", messageFile]).status).toBe(1);
  });
});

describe("push and pull-request proof", () => {
  it("allows the first push for CI follow-up, but rejects mixed references", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    git(
      fixture.root,
      ["update-ref", "refs/remotes/origin/main", base],
      fixture.env
    );
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    const pushLine = `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${ZERO_OID}\n`;
    const firstPush = command(fixture, ["validate-push", "origin"], {
      env: { FAKE_GH_PR_MISSING: "1" },
      input: pushLine,
    });
    expect(firstPush.status).toBe(0);
    expect(firstPush.stdout).toContain(
      "no pull request exists yet, CI will verify"
    );

    commit(fixture, "fix: another ticket\n\nWork-Item: acme/widgets#43");
    const mixedHead = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const mixed = command(fixture, ["validate-push", "origin"], {
      env: {
        FAKE_GH_PR_MISSING: "1",
      },
      input: `refs/heads/feature/tracked ${mixedHead} refs/heads/feature/tracked ${ZERO_OID}\n`,
    });
    expect(mixed.status).toBe(1);
    expect(mixed.stderr).toContain("mixed Work-Item references");
  });

  it("fetches a numbered PR deterministically and requires body and tracker backlinks", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    const log = path.join(fixture.root, "gh.log");
    const prUrl = "https://github.com/acme/code/pull/7";
    const issue = JSON.stringify({
      number: 42,
      state: "OPEN",
      labels: [{ name: "status:in-progress" }, { name: "type:Bug" }],
      comments: [{ body: `[lisa-pr-link] ${prUrl}` }],
      closedByPullRequestsReferences: [],
    });

    const validated = command(
      fixture,
      [
        "validate-pr",
        "--base",
        base,
        "--head",
        head,
        "--pr-number",
        "7",
        "--pr-url",
        prUrl,
      ],
      { env: { FAKE_GH_ISSUE_JSON: issue, FAKE_GH_LOG: log } }
    );
    expect(validated.status).toBe(0);
    expect(validated.stdout).toContain("WORK_ITEM_TRACKING_OK");
    expect(readFileSync(log, "utf8")).toContain(
      "pr view 7 --repo acme/code --json url,body,state"
    );

    const absentBacklink = command(
      fixture,
      [
        "validate-pr",
        "--base",
        base,
        "--head",
        head,
        "--pr-number",
        "7",
        "--pr-url",
        prUrl,
      ],
      {
        env: {
          FAKE_GH_ISSUE_JSON:
            '{"number":42,"state":"OPEN","labels":[{"name":"status:in-progress"},{"name":"type:Bug"}],"comments":[],"closedByPullRequestsReferences":[]}',
        },
      }
    );
    expect(absentBacklink.status).toBe(1);
    expect(absentBacklink.stderr).toContain("no verified backlink");
  });

  it("permits an exact release-only PR without inventing a work item", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    const head = commit(fixture, "chore(release): 1.2.3 [skip ci]");
    const result = command(fixture, [
      "validate-pr",
      "--base",
      base,
      "--head",
      head,
      "--pr-number",
      "7",
      "--pr-url",
      "https://github.com/acme/code/pull/7",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK 0 commit(s)");
  });

  it("rejects a merge-only PR with no linked non-merge commit", () => {
    const fixture = createFixture();
    git(fixture.root, ["switch", "-q", "main"], fixture.env);
    commit(fixture, "chore: extend base");
    const base = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const ancestor = git(fixture.root, ["rev-parse", "HEAD^"], fixture.env);
    const tree = git(fixture.root, ["rev-parse", "HEAD^{tree}"], fixture.env);
    const merge = spawnSync(
      GIT,
      ["commit-tree", tree, "-p", base, "-p", ancestor],
      {
        cwd: fixture.root,
        encoding: "utf8",
        env: fixture.env,
        input: "Merge branch 'already-in-base'\n",
      }
    );
    expect(merge.status).toBe(0);

    const result = command(fixture, [
      "validate-pr",
      "--base",
      base,
      "--head",
      merge.stdout.trim(),
      "--pr-number",
      "7",
      "--pr-url",
      "https://github.com/acme/code/pull/7",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no non-merge commit linked");
  });
});

describe("provider liveness", () => {
  it("accepts active Jira work and rejects done Jira work through acli", () => {
    const fixture = createFixture({
      tracker: "jira",
      repo: "widgets",
      jira: { project: "LAS" },
      atlassian: { site: "acme.atlassian.net" },
    });
    expect(command(fixture, ["bind", "LAS-12"]).status).toBe(0);
    const done = command(fixture, ["bind", "LAS-12"], {
      env: {
        FAKE_ACLI_JSON:
          '{"key":"LAS-12","fields":{"status":{"name":"Done","statusCategory":{"key":"done"}}}}',
      },
    });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain("is done");
  });

  it("fails Jira closed for an identity mismatch, wrong repo, unclaimed role, or container", () => {
    const fixture = createFixture({
      tracker: "jira",
      repo: "widgets",
      jira: { project: "LAS" },
      atlassian: { site: "acme.atlassian.net" },
    });
    const fields = (overrides: object) =>
      JSON.stringify({
        key: "LAS-12",
        fields: {
          project: { key: "LAS" },
          status: {
            name: "In Progress",
            statusCategory: { key: "indeterminate" },
          },
          labels: ["repo:widgets"],
          issuetype: { name: "Task" },
          subtasks: [],
          comment: { comments: [] },
          ...overrides,
        },
      });

    const identity = command(fixture, ["bind", "LAS-12"], {
      env: { FAKE_ACLI_SITE: "attacker.atlassian.net" },
    });
    expect(identity.status).toBe(1);
    expect(identity.stderr).toContain("is not authenticated");

    const wrongRepo = command(fixture, ["bind", "LAS-12"], {
      env: { FAKE_ACLI_JSON: fields({ labels: ["repo:other"] }) },
    });
    expect(wrongRepo.status).toBe(1);
    expect(wrongRepo.stderr).toContain("not scoped to repository widgets");

    const unclaimed = command(fixture, ["bind", "LAS-12"], {
      env: {
        FAKE_ACLI_JSON: fields({
          status: {
            name: "Ready",
            statusCategory: { key: "indeterminate" },
          },
        }),
      },
    });
    expect(unclaimed.status).toBe(1);
    expect(unclaimed.stderr).toContain("is not claimed");

    const epic = command(fixture, ["bind", "LAS-12"], {
      env: { FAKE_ACLI_JSON: fields({ issuetype: { name: "Epic" } }) },
    });
    expect(epic.status).toBe(1);
    expect(epic.stderr).toContain("is a container");
  });

  // Test hardened to kill mutant M001 (Risk Factor: Data security / credential secrecy).
  it("uses canonical Atlassian credentials and requests Jira status in curl fallback", () => {
    const fixture = createFixture({
      tracker: "jira",
      repo: "widgets",
      jira: { project: "LAS" },
      atlassian: { cloudId: "cloud-123", email: "agent@acme.test" },
    });
    rmSync(path.join(fixture.bin, "acli"));
    const log = path.join(fixture.root, "curl.log");
    const stdinLog = path.join(fixture.root, "curl.stdin.log");
    executable(
      path.join(fixture.bin, "curl"),
      `printf '%s\\n' "$*" > "\${FAKE_CURL_LOG}"\ncat > "\${FAKE_CURL_STDIN_LOG}"\nprintf '%s\\n' '{"key":"LAS-12","fields":{"project":{"key":"LAS"},"status":{"name":"In Progress","statusCategory":{"key":"indeterminate"}},"labels":["repo:widgets"],"issuetype":{"name":"Task"},"subtasks":[],"comment":{"comments":[]}}}'`
    );

    const result = command(fixture, ["bind", "LAS-12"], {
      env: {
        ATLASSIAN_API_TOKEN: "fake-atlassian-key",
        FAKE_CURL_LOG: log,
        FAKE_CURL_STDIN_LOG: stdinLog,
        PATH: `${fixture.bin}:/usr/bin:/bin`,
      },
    });
    expect(result.status).toBe(0);
    const invocation = readFileSync(log, "utf8");
    expect(invocation).not.toContain("fake-atlassian-key");
    expect(invocation).toContain("--config -");
    expect(invocation).toContain("api.atlassian.com/ex/jira/cloud-123");
    expect(invocation).toContain(
      "fields=project,status,labels,components,issuetype,subtasks,comment"
    );
    expect(readFileSync(stdinLog, "utf8")).toContain(
      'user = "agent@acme.test:fake-atlassian-key"'
    );
  });

  it("accepts active Linear work and rejects terminal Linear work through curl", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });
    expect(command(fixture, ["bind", "LIN-12"]).status).toBe(0);
    const terminal = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON:
          '{"data":{"issue":{"identifier":"LIN-12","team":{"key":"LIN"},"state":{"type":"completed"}}}}',
      },
    });
    expect(terminal.status).toBe(1);
    expect(terminal.stderr).toContain("is terminal");
  });

  // Test hardened to kill mutant M002 (Risk Factor: Data security / credential secrecy).
  it("passes Linear authorization through curl stdin rather than process argv", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });
    const argsLog = path.join(fixture.root, "curl.args.log");
    const stdinLog = path.join(fixture.root, "curl.stdin.log");
    executable(
      path.join(fixture.bin, "curl"),
      `printf '%s\\n' "$*" > "\${FAKE_CURL_ARGS_LOG}"\ncat > "\${FAKE_CURL_STDIN_LOG}"\nprintf '%s\\n' "$FAKE_CURL_JSON"`
    );

    const result = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_ARGS_LOG: argsLog,
        FAKE_CURL_STDIN_LOG: stdinLog,
        LINEAR_API_KEY: "secret-linear-key",
      },
    });

    expect(result.status).toBe(0);
    const invocation = readFileSync(argsLog, "utf8");
    expect(invocation).not.toContain("secret-linear-key");
    expect(invocation).toContain("--config -");
    expect(readFileSync(stdinLog, "utf8")).toContain(
      'header = "Authorization: secret-linear-key"'
    );
  });

  it("rejects wrong-repo, unclaimed, and container Linear issues", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });
    const response = (labels: string[], children: object[] = []) =>
      JSON.stringify({
        data: {
          issue: {
            id: "id-12",
            identifier: "LIN-12",
            team: { key: "LIN" },
            state: { type: "started" },
            labels: { nodes: labels.map(name => ({ name })) },
            children: { nodes: children },
            attachments: { nodes: [] },
            comments: { nodes: [] },
          },
        },
      });

    const wrongRepo = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: response([
          "repo:other",
          "status:in-progress",
          "type:Task",
        ]),
      },
    });
    expect(wrongRepo.status).toBe(1);
    expect(wrongRepo.stderr).toContain("not scoped to repository widgets");

    const unclaimed = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: response(["repo:widgets", "status:ready", "type:Task"]),
      },
    });
    expect(unclaimed.status).toBe(1);
    expect(unclaimed.stderr).toContain("is not claimed");

    const parent = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: response(
          ["repo:widgets", "status:in-progress", "type:Task"],
          [{ state: { type: "started" } }]
        ),
      },
    });
    expect(parent.status).toBe(1);
    expect(parent.stderr).toContain("is a container");
  });

  it("accepts a Linear issue scoped by the bare repo-name label (#1957)", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });

    const bare = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: linearIssueResponse([
          "widgets",
          "status:in-progress",
          "type:Task",
        ]),
      },
    });
    expect(bare.status).toBe(0);

    const mixedCase = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: linearIssueResponse([
          "Widgets",
          "status:in-progress",
          "type:Task",
        ]),
      },
    });
    expect(mixedCase.status).toBe(0);
  });

  it("still rejects Linear issues whose bare labels do not name this repository (#1957 controls)", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });

    const unscoped = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: linearIssueResponse([
          "status:in-progress",
          "type:Task",
        ]),
      },
    });
    expect(unscoped.status).toBe(1);
    expect(unscoped.stderr).toContain("not scoped to repository widgets");

    const wrongRepo = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: linearIssueResponse([
          "backend",
          "repo:backend",
          "status:in-progress",
          "type:Task",
        ]),
      },
    });
    expect(wrongRepo.status).toBe(1);
    expect(wrongRepo.stderr).toContain("not scoped to repository widgets");

    const unrelated = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: linearIssueResponse([
          "sentry",
          "status:in-progress",
          "type:Task",
        ]),
      },
    });
    expect(unrelated.status).toBe(1);
    expect(unrelated.stderr).toContain("not scoped to repository widgets");
  });
});

describe("rebase lane (#1956 R1): mid-rebase binding validation", () => {
  it("prepare-commit-msg validates against the rebase head-name instead of throwing on detached HEAD", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    wedgeRebase(fixture, "feature/tracked");

    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "feat: rebased pick\n");
    const prepared = command(fixture, [
      "prepare-commit-msg",
      messageFile,
      "message",
    ]);
    expect(prepared.stderr).not.toContain("detached HEAD");
    expect(prepared.status).toBe(0);
    expect(readFileSync(messageFile, "utf8")).toContain(
      "Work-Item: acme/widgets#42"
    );
  });

  it("validate-commit (rebase --continue path) accepts the bound branch mid-rebase", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    wedgeRebase(fixture, "feature/tracked");

    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(
      messageFile,
      "feat: resolved pick\n\nWork-Item: acme/widgets#42\n"
    );
    const validated = command(fixture, ["validate-commit", messageFile]);
    expect(validated.stderr).not.toContain("detached HEAD");
    expect(validated.status).toBe(0);
    expect(validated.stdout).toContain("WORK_ITEM_TRACKING_OK acme/widgets#42");
  });

  it("still rejects a mid-rebase branch that does not match the binding", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    git(fixture.root, ["switch", "-q", "-c", "feature/other"], fixture.env);
    wedgeRebase(fixture, "feature/other");

    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "feat: wrong branch pick\n");
    const prepared = command(fixture, [
      "prepare-commit-msg",
      messageFile,
      "message",
    ]);
    expect(prepared.status).toBe(1);
    expect(prepared.stderr).toContain(
      "belongs to branch 'feature/tracked', not 'feature/other'"
    );
  });
});

describe("merge lane (#1956 R2): push-range base-branch exemption", () => {
  it("pushes a merge-synced branch when the foreign closed-item commit is reachable from the remote default branch", () => {
    const fixture = createFixture();
    const { head, pushedTip } = setupMergeLane(fixture);
    setOriginHead(fixture);

    const result = command(fixture, ["validate-push", "origin"], {
      env: { FAKE_GH_PR_MISSING: "1" },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${pushedTip}\n`,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK 1 commit(s)");
  });

  it("stays strict when the remote default branch cannot be resolved (no origin/HEAD symref)", () => {
    const fixture = createFixture();
    const { head, pushedTip } = setupMergeLane(fixture);

    const result = command(fixture, ["validate-push", "origin"], {
      env: { FAKE_GH_PR_MISSING: "1" },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${pushedTip}\n`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is closed");
  });

  it("still rejects a branch-authored commit referencing a closed work item", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    git(
      fixture.root,
      ["update-ref", "refs/remotes/origin/main", base],
      fixture.env
    );
    setOriginHead(fixture);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: branch work\n\nWork-Item: acme/widgets#42"
    );

    const result = command(fixture, ["validate-push", "origin"], {
      env: {
        FAKE_GH_ISSUE_JSON:
          '{"number":42,"state":"CLOSED","comments":[],"closedByPullRequestsReferences":[]}',
        FAKE_GH_PR_MISSING: "1",
      },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${base}\n`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is closed");
  });

  it("still rejects mixed branch-authored references with the exemption active", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    git(
      fixture.root,
      ["update-ref", "refs/remotes/origin/main", base],
      fixture.env
    );
    setOriginHead(fixture);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    commit(fixture, "feat: first ticket\n\nWork-Item: acme/widgets#42");
    const head = commit(
      fixture,
      "fix: second ticket\n\nWork-Item: acme/widgets#43"
    );

    const result = command(fixture, ["validate-push", "origin"], {
      env: { FAKE_GH_PR_MISSING: "1" },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${base}\n`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("mixed Work-Item references");
  });

  it("still rejects a branch-authored commit with no Work-Item trailer", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    git(
      fixture.root,
      ["update-ref", "refs/remotes/origin/main", base],
      fixture.env
    );
    setOriginHead(fixture);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(fixture, "feat: untracked change");

    const result = command(fixture, ["validate-push", "origin"], {
      env: { FAKE_GH_PR_MISSING: "1" },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${base}\n`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Mention the ticket");
  });
});

/**
 * #1978: `validate-push` is a client-side, fail-safe gate and #1956's security
 * review (finding F1) proved an agent can launder branch-authored commits past
 * it by repointing `refs/remotes/origin/HEAD`. `validate-pr` is the designed
 * server-side backstop: it recomputes `rev-list base..head` with no exclusion
 * and never reads a symref, so the launder cannot survive it. Each case here
 * asserts BOTH halves of that claim on the same repository state — the push
 * gate is laundered, the PR gate still fails.
 */
describe("server-side backstop (#1978): validate-pr defeats the #1956 symref launder", () => {
  const CLOSED_ISSUE =
    '{"number":42,"state":"CLOSED","labels":[{"name":"status:in-progress"},{"name":"type:Bug"}],"comments":[],"closedByPullRequestsReferences":[]}';

  it("catches a branch-authored commit with no Work-Item trailer", () => {
    const fixture = createFixture();
    const base = publishedBase(fixture);
    const head = commit(fixture, "feat: untracked change");
    launderPushRange(fixture, head);

    const pushed = pushRange(fixture, base, head);
    expect(pushed.status).toBe(0);
    expect(pushed.stdout).toContain("WORK_ITEM_TRACKING_OK 0 commit(s)");

    const validated = prRange(fixture, base, head);
    expect(validated.status).toBe(1);
    expect(validated.stderr).toContain("Mention the ticket");
  });

  it("catches a branch-authored commit referencing a closed work item", () => {
    const fixture = createFixture();
    const base = publishedBase(fixture);
    const head = commit(
      fixture,
      "feat: branch work\n\nWork-Item: acme/widgets#42"
    );
    launderPushRange(fixture, head);

    const pushed = pushRange(fixture, base, head, {
      FAKE_GH_ISSUE_JSON: CLOSED_ISSUE,
    });
    expect(pushed.status).toBe(0);
    expect(pushed.stdout).toContain("WORK_ITEM_TRACKING_OK 0 commit(s)");

    const validated = prRange(fixture, base, head, {
      FAKE_GH_ISSUE_JSON: CLOSED_ISSUE,
    });
    expect(validated.status).toBe(1);
    expect(validated.stderr).toContain("is closed");
  });

  it("catches mixed branch-authored Work-Item references", () => {
    const fixture = createFixture();
    const base = publishedBase(fixture);
    commit(fixture, "feat: first ticket\n\nWork-Item: acme/widgets#42");
    const head = commit(
      fixture,
      "fix: second ticket\n\nWork-Item: acme/widgets#43"
    );
    launderPushRange(fixture, head);

    const pushed = pushRange(fixture, base, head);
    expect(pushed.status).toBe(0);
    expect(pushed.stdout).toContain("WORK_ITEM_TRACKING_OK 0 commit(s)");

    const validated = prRange(fixture, base, head);
    expect(validated.status).toBe(1);
    expect(validated.stderr).toContain("mixed Work-Item references");
  });

  it("ignores a crafted origin/HEAD symref even when it is present in CI", () => {
    const fixture = createFixture();
    const base = publishedBase(fixture);
    const head = commit(fixture, "feat: untracked change");
    // Belt and braces: the symref lands in the checkout AND names the head.
    // validate-pr must not consult it at all.
    launderPushRange(fixture, head);
    setOriginHead(fixture);
    launderPushRange(fixture, head);

    const validated = prRange(fixture, base, head);
    expect(validated.status).toBe(1);
    expect(validated.stderr).toContain("Mention the ticket");
  });
});

/**
 * The other half of #1978's acceptance criteria: the backstop must not punish
 * legitimate work. A merge-synced PR carries foreign base commits (whose
 * trailers reference other, often closed, work items) inside the branch, and
 * they must stay out of the validated range — not through exclusion logic, but
 * because the range starts at the CURRENT base-branch tip.
 */
describe("server-side backstop (#1978): merge-synced pull requests still pass", () => {
  const PR_URL = "https://github.com/acme/code/pull/7";
  const BACKLINKED_ISSUE = JSON.stringify({
    number: 42,
    state: "OPEN",
    labels: [{ name: "status:in-progress" }, { name: "type:Bug" }],
    comments: [{ body: `[lisa-pr-link] ${PR_URL}` }],
    closedByPullRequestsReferences: [],
  });

  it("validates only branch-authored commits when the base tip is the range start", () => {
    const fixture = createFixture();
    const { head } = setupMergeLane(fixture);
    const baseTip = git(
      fixture.root,
      ["rev-parse", "refs/remotes/origin/main"],
      fixture.env
    );

    const validated = prRange(fixture, baseTip, head, {
      FAKE_GH_ISSUE_JSON: BACKLINKED_ISSUE,
    });
    expect(validated.stderr).toBe("");
    expect(validated.status).toBe(0);
    // The merge commit is exempt; the two #42 commits are the branch's work.
    expect(validated.stdout).toContain("WORK_ITEM_TRACKING_OK 2 commit(s)");
  });

  it("would fail against a stale pre-merge base, which is why CI resolves the base-branch tip", () => {
    const fixture = createFixture();
    const { head } = setupMergeLane(fixture);
    const staleBase = git(
      fixture.root,
      ["rev-parse", "refs/remotes/origin/main^"],
      fixture.env
    );

    // Documents the trap the CI job's base resolution exists to avoid: from a
    // base predating the merge-sync, the foreign commit is inside base..head,
    // so the gate blocks this branch over someone else's already-closed item.
    const validated = prRange(fixture, staleBase, head, {
      FAKE_GH_ISSUE_JSON: BACKLINKED_ISSUE,
    });
    expect(validated.status).toBe(1);
    expect(validated.stderr).toContain("acme/widgets#99 is closed");
  });
});
