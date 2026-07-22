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

/** Add one empty fixture commit and return its object ID. */
function commit(fixture: Fixture, message: string): string {
  git(
    fixture.root,
    ["commit", "-q", "--allow-empty", "-m", message],
    fixture.env
  );
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
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
    expect(readFileSync(argsLog, "utf8")).not.toContain("secret-linear-key");
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
});
