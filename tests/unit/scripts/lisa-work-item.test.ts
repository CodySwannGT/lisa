/* eslint-disable max-lines, sonarjs/no-duplicate-string, jsdoc/require-param, jsdoc/require-returns, @eslint-community/eslint-comments/disable-enable-pair -- one hermetic fake-provider fixture exercises the full local tracking contract */
/**
 * Hermetic tests for Lisa's provider-neutral work-item Git gate.
 *
 * Every case runs in a disposable repository and resolves tracker access through
 * fake gh/acli/curl executables, so a developer's credentials cannot affect the
 * result.
 */
import {
  chmodSync,
  existsSync,
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

import {
  githubBranchIssue,
  noPullRequestToDischarge,
  postDischargeBacklinks,
  pullRequestViewArgs,
  textContainsBacklink,
  unresolvedPushReport,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

/**
 * Liveness bound for the SIGKILL-deadline case, calibrated to this machine.
 *
 * The `expect(elapsed).toBeLessThan(15_000)` inside that case is the SUBJECT
 * and is deliberately left alone. This is only the bound on the case itself,
 * which used to sit inline as `}, 30_000)` — where it measured the machine
 * rather than the code and silently overrode the file-level budget raised in
 * CodySwannGT/lisa#2888 (CodySwannGT/lisa#2822, CodySwannGT/lisa#2894). The
 * case measured 8,621ms at 98 live vitest processes and a 1-minute load
 * average of 44.7 on 18 cores, so the 30s base is kept; only its expression
 * changed.
 */
const SIGKILL_DEADLINE_BUDGET_MS = ioLatencyBudgetMs(30_000);

const SCRIPT = path.resolve("scripts/lisa-work-item.mjs");
const GIT = resolveGit();
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
  const result = boundedSpawnSync({
    args,
    command: GIT,
    cwd: root,
    env,
    label: `git ${args[0] ?? ""}`,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

/**
 * Run the validator entrypoint inside a disposable fixture.
 *
 * Bounded rather than bare, and the cost of the bare version was measured
 * rather than assumed. Under the mutation gate this helper is the hot path:
 * `lisa-work-item.mjs` is the largest mutate target, and every one of its
 * covered mutants is judged by spawning the MUTATED script here. A mutant that
 * makes the child stop advancing had nothing to stop it, so the only bound was
 * Stryker's own `timeoutMS` — an absolute 60,000ms deviation on top of the
 * mutant's measured net time, roughly 62s per occurrence, and each one also
 * forces the test runner process to be restarted.
 *
 * Measured on this repository, 18 cores, 1-minute load average 55-140,
 * `stryker run` scoped to this guard alone with all 45 derived suites in
 * `include`:
 *
 * | arm | mutant timeouts | wall clock |
 * |---|---|---|
 * | bare `spawnSync`, no `timeout:` | 237 | 48m03s |
 * | {@link boundedSpawnSync} | 37 | 24m51s |
 *
 * Every other mutate target measured 0-2 timeouts and under a minute, so this
 * one helper was 84% of the whole gate's runtime. The bound is the repository's
 * own measured, load-adaptive one, so it is not a wall-clock guess: it widens
 * in proportion to this worker's observed spawn slowdown, and 85 ordinary cases
 * here cost ~590ms per child against a 15,000ms quiet-box base.
 *
 * The score moves DOWN as a result, 63.05 to 56.97 on this guard, and that is
 * the point rather than a regression. Stryker scores a timed-out mutant as
 * KILLED, so ~129 mutants were being counted as detected because the box was
 * slow — exactly what `stryker.conf.json` warns an unset `timeoutMS` would do,
 * arriving instead through an unbounded child. Removing a machine-dependent
 * kill makes the number smaller and true. See CodySwannGT/lisa#2944.
 */
function command(
  fixture: Fixture,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string } = {}
): CommandResult {
  const result = boundedSpawnSync({
    args: [SCRIPT, ...args],
    command: process.execPath,
    cwd: fixture.root,
    env: { ...fixture.env, ...options.env },
    input: options.input,
    label: `lisa-work-item.mjs ${args[0] ?? ""}`,
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
      '{"data":{"issue":{"id":"id-12","identifier":"LIN-12","team":{"key":"LIN"},"state":{"name":"In Progress","type":"started"},"labels":{"nodes":[{"name":"repo:widgets"},{"name":"type:Task"}]},"children":{"nodes":[]},"attachments":{"nodes":[]},"comments":{"nodes":[]}}}}',
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
# An unresponsive tracker that also declines SIGTERM — the case a plain
# \`timeout\` cannot end, because it signals and then keeps waiting.
if [ "\${FAKE_GH_HANG:-0}" = "1" ]; then
  trap '' TERM
  sleep 30
  exit 0
fi
case "\${1:-} \${2:-}" in
  "issue view")
    if [ "\${3:-}" = "43" ]; then
      printf '%s\\n' '{"number":43,"state":"OPEN","labels":[{"name":"status:in-progress"},{"name":"type:Bug"}],"comments":[],"closedByPullRequestsReferences":[]}'
    elif [ "\${3:-}" = "99" ]; then
      printf '%s\\n' '{"number":99,"state":"CLOSED","labels":[{"name":"status:done"},{"name":"type:Task"}],"comments":[],"closedByPullRequestsReferences":[]}'
    elif [ -n "\${FAKE_GH_POSTED_FILE:-}" ] && [ -f "$FAKE_GH_POSTED_FILE" ]; then
      # The item AFTER the managed backlink comment was written, so a re-read
      # can observe a write the first read could not have seen.
      printf '%s\\n' "\${FAKE_GH_ISSUE_AFTER_POST_JSON:-$FAKE_GH_ISSUE_JSON}"
    else
      printf '%s\\n' "$FAKE_GH_ISSUE_JSON"
    fi
    ;;
  "api graphql")
    # Page-aware so sub-issue pagination can be exercised. The real caller
    # sends "after=<cursor>" only on follow-up pages, so its presence is what
    # distinguishes page 2 from page 1 — no state file needed.
    case "$*" in
      *after=*)
        printf '%s\\n' "\${FAKE_GH_HIERARCHY_PAGE2_JSON:-$FAKE_GH_HIERARCHY_JSON}" ;;
      *)
        printf '%s\\n' "$FAKE_GH_HIERARCHY_JSON" ;;
    esac
    ;;
  "pr view")
    # Real gh REFUSES to infer the current branch once --repo is given:
    # "argument required when using the --repo flag", exit 1. A fake that
    # answered anyway would be more permissive than the tool it stands in for,
    # letting a caller ship a flag combination that can never find a pull
    # request while every assertion here still passed. That is exactly how
    # #3791 survived this suite: the push path sent --repo with no selector on
    # every run, the real gh rejected it, and the caller read the usage error
    # as "no pull request exists".
    case " $* " in
      *" --repo "*)
        case "\${3:-}" in
          -*|"")
            echo "argument required when using the --repo flag" >&2
            exit 1
            ;;
        esac
        ;;
    esac
    [ "\${FAKE_GH_PR_MISSING:-0}" != "1" ] || exit 1
    printf '%s\\n' "$FAKE_GH_PR_JSON"
    ;;
  "repo view") printf '%s\\n' '{"nameWithOwner":"acme/code"}' ;;
  # The two REST calls \`backlink\` makes. Without them the command exits
  # nonzero through the catch-all below, which is invisible to any assertion
  # that does not check the status — see the positive-control test.
  "api --paginate")
    printf '%s\\n' "\${FAKE_GH_COMMENTS_JSON:-[]}"
    ;;
  "api --method")
    [ -z "\${FAKE_GH_POSTED_FILE:-}" ] || printf 'posted\\n' > "$FAKE_GH_POSTED_FILE"
    printf '%s\\n' '{"id":1}'
    ;;
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
if [ -n "\${FAKE_CURL_COUNT_FILE:-}" ]; then
  COUNT=0
  [ ! -f "$FAKE_CURL_COUNT_FILE" ] || COUNT=$(cat "$FAKE_CURL_COUNT_FILE")
  case "$COUNT" in
    0) FAKE_CURL_JSON=\${FAKE_CURL_JSON_1:-$FAKE_CURL_JSON} ;;
    1) FAKE_CURL_JSON=\${FAKE_CURL_JSON_2:-$FAKE_CURL_JSON} ;;
    *) FAKE_CURL_JSON=\${FAKE_CURL_JSON_3:-$FAKE_CURL_JSON} ;;
  esac
  printf '%s\\n' "$((COUNT + 1))" > "$FAKE_CURL_COUNT_FILE"
fi
printf '%s\\n' "$FAKE_CURL_JSON"`
  );

  git(root, ["init", "-q", "-b", "main"], env);
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    // Every case predating #2721 asserts the FULL contract — live tracker
    // lookup plus PR backlink — so that is what a fixture gets unless it says
    // otherwise. The SHIPPED default is trailer-only; the cases exercising it
    // declare `workItem: { verify: "trailer" }`, which is also how a reader
    // tells the two apart at a glance.
    `${JSON.stringify({ workItem: { verify: "full" }, ...config }, null, 2)}\n`
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

/**
 * Build a leaf Linear issue payload carrying the given labels.
 *
 * Lifecycle lives in the workflow STATE, not in a label — the same shape the
 * Jira path uses — so the state name is what decides claimed vs unclaimed.
 * Labels still carry repo scope and issue type.
 * @param labels - Label names on the issue.
 * @param stateName - Workflow state name; defaults to the claimed state.
 */
function linearIssueResponse(
  labels: string[],
  stateName = "In Progress"
): string {
  return JSON.stringify({
    data: {
      issue: {
        id: "id-12",
        identifier: "LIN-12",
        team: { key: "LIN" },
        state: { name: stateName, type: "started" },
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
    boundedSpawnSync({
      args: ["rebase", "main"],
      command: GIT,
      cwd: fixture.root,
      env: fixture.env,
      label: "git rebase",
    }).status === 0
  )
    throw new Error("expected the rebase to stop on a conflict");
  if (rebaseHeadName(fixture) !== `refs/heads/${branch}`)
    throw new Error("unexpected rebase head-name");
}

/**
 * Path to the worktree-private binding state a successful link/bind writes.
 *
 * Resolved through `git rev-parse --git-path`, the same call the CLI itself
 * uses, rather than hardcoding `.git/lisa/`. In a LINKED worktree those are not
 * the same place — the real file lands in `.git/worktrees/<name>/lisa/` — so a
 * hardcoded path would quietly stop describing the thing under test the moment
 * these fixtures grew a linked worktree, which is precisely the environment
 * this binding exists to serve.
 */
function stateFilePath(fixture: Fixture): string {
  // `path.resolve`, not `path.join`. `--git-path` answers relatively in a main
  // checkout (`.git/lisa/...`) but ABSOLUTELY in a linked worktree
  // (`/repo/.git/worktrees/<name>/lisa/...`), and joining an absolute path onto
  // the root concatenates instead of resolving — yielding a path that does not
  // exist, in precisely the linked-worktree case this helper exists to serve.
  return path.resolve(
    fixture.root,
    git(
      fixture.root,
      ["rev-parse", "--git-path", "lisa/work-item.json"],
      fixture.env
    )
  );
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
  it("binds inside a linked worktree, whose private state lives under .git/worktrees/", () => {
    // The binding exists to serve worktree-based agents, but every other case
    // here runs in a main checkout, where `.git/lisa/` and the worktree's
    // private dir happen to be the same place. Only a linked worktree tells
    // `git rev-parse --git-path` apart from a hardcoded `.git/lisa/` — and it
    // answers with an ABSOLUTE path there, which is what the helper must
    // resolve rather than join onto the worktree root.
    const fixture = createFixture();
    const linked: Fixture = {
      ...fixture,
      root: path.join(fixture.root, "linked"),
    };
    git(
      fixture.root,
      ["worktree", "add", "-q", "-b", "feature/linked", "linked", "main"],
      fixture.env
    );

    expect(command(linked, ["bind", "acme/widgets#42"]).status).toBe(0);

    const linkedState = stateFilePath(linked);
    expect(linkedState).toContain(path.join(".git", "worktrees", "linked"));
    expect(linkedState).not.toBe(stateFilePath(fixture));
    expect(JSON.parse(readFileSync(linkedState, "utf8"))).toMatchObject({
      branch: "feature/linked",
      provider: "github",
      ref: "acme/widgets#42",
    });
  });

  it("merges local config, writes worktree-private state atomically, and preserves the subject", () => {
    const fixture = createFixture(githubConfig("identity"));
    writeFileSync(
      path.join(fixture.root, ".lisa.config.local.json"),
      '{"github":{"queueRepo":"acme/widgets"}}\n'
    );

    const bound = command(fixture, ["bind", "acme/widgets#42"]);
    expect(bound.status).toBe(0);
    const stateFile = stateFilePath(fixture);
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

  // `bind` is the name of a bash builtin that evaluates a string, so agent
  // harnesses that scan an argv for string-evaluating commands flag the token
  // wherever it appears — including as this CLI's subcommand. Claude Code's
  // worktree isolation does exactly that, which made the documented binding
  // step unrunnable from inside a worktree: three agents hit it in one session
  // and each reinvented the same trailer workaround.
  //
  // The guard is the harness's and is not Lisa's to narrow, so Lisa stops
  // colliding with it instead: `link` is the spelling the docs now teach, and
  // it does the identical work. `bind` stays a permanent alias — every host
  // project's checked-in hooks, scripts, and habits already say it, and
  // breaking them to dodge a name would trade one outage for a larger one.
  it("accepts `link` as the collision-free spelling of `bind`", () => {
    const fixture = createFixture(githubConfig("identity"));
    writeFileSync(
      path.join(fixture.root, ".lisa.config.local.json"),
      '{"github":{"queueRepo":"acme/widgets"}}\n'
    );

    const linked = command(fixture, ["link", "acme/widgets#42"]);
    expect(linked.status).toBe(0);
    expect(
      JSON.parse(readFileSync(stateFilePath(fixture), "utf8"))
    ).toMatchObject({
      branch: "feature/tracked",
      provider: "github",
      ref: "acme/widgets#42",
      version: 1,
    });
  });

  it("still accepts the original `bind` spelling, so existing hooks keep working", () => {
    const fixture = createFixture(githubConfig("identity"));
    writeFileSync(
      path.join(fixture.root, ".lisa.config.local.json"),
      '{"github":{"queueRepo":"acme/widgets"}}\n'
    );

    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    expect(
      JSON.parse(readFileSync(stateFilePath(fixture), "utf8"))
    ).toMatchObject({ ref: "acme/widgets#42" });
  });

  it("names `link` in the usage text so a blocked agent is told the working spelling", () => {
    const fixture = createFixture();
    const usage = command(fixture, ["not-a-subcommand"]);
    expect(usage.status).not.toBe(0);
    expect(usage.stderr).toContain("link");
  });

  it("fails closed for missing, duplicate, mismatched, and closed GitHub work items", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");

    // The duplicate case names two DIFFERENT items, which is the ambiguity
    // this has always been about. Two IDENTICAL lines used to fail too, and
    // now pass on purpose: Lisa's own prepare-commit-msg hook appends
    // `Work-Item:` to the final trailer block, so a message already carrying
    // the trailer above its attribution block comes back out of that hook with
    // exactly this shape. See the #2672 describe below.
    for (const message of [
      "fix: missing trailer\n",
      "fix: two items\n\nWork-Item: acme/widgets#42\nWork-Item: acme/widgets#43\n",
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

  it("accepts unclaimed and rejects cross-repo and container GitHub issues", () => {
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

    // Deliberately inverted: claim state is no longer enforced anywhere. The
    // sibling assertions below are what this case is now for — they prove the
    // checks that stood BESIDE the claim check are untouched by its removal.
    const unclaimed = command(fixture, ["bind", "acme/widgets#42"], {
      env: {
        FAKE_GH_ISSUE_JSON: issue([
          "repo:identity",
          "status:ready",
          "type:Bug",
        ]),
      },
    });
    expect(unclaimed.status).toBe(0);
    expect(unclaimed.stderr).not.toContain("is not claimed");

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

  it(
    "kills a tracker call that ignores SIGTERM, and degrades (#2371)",
    () => {
      // The deadline has to be one the child cannot decline. `timeout` alone
      // sends SIGTERM and then waits for the child to exit, so a child that
      // traps it hangs the commit exactly as long as it would have with no
      // timeout at all. killSignal: "SIGKILL" is what makes it a deadline.
      //
      // And the outcome must be degradable: a call killed at its deadline means
      // the tracker could not be ASKED, not that the work item is invalid.
      const fixture = createFixture({
        tracker: "github",
        github: { org: "acme", repo: "identity", queueRepo: "acme/widgets" },
      });

      const started = Date.now();
      const result = command(fixture, ["bind", "acme/widgets#42"], {
        env: { FAKE_GH_HANG: "1", LISA_WORK_ITEM_TIMEOUT_MS: "1500" },
      });
      const elapsed = Date.now() - started;

      // Well under the child's own 30s sleep: proof it was killed, not waited out.
      expect(elapsed).toBeLessThan(15_000);
      // Degraded, not refused. A call killed at its deadline means the tracker
      // could not be ASKED — treating that as "this work item is invalid" would
      // block every commit on a slow network.
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/live validation SKIPPED/i);
    },
    SIGKILL_DEADLINE_BUDGET_MS
  );

  it("finds an open child on a later page of sub-issues (#2371)", () => {
    // `subIssues(first:100)` truncated silently, so an Epic with more than 100
    // children reported only the first page. assertLeaf then saw no open child
    // and treated a container as a leaf — the exact condition
    // leaf-only-lifecycle exists to prevent, reachable by having enough
    // children that the open one falls past the boundary.
    const fixture = createFixture({
      tracker: "github",
      github: { org: "acme", repo: "identity", queueRepo: "acme/widgets" },
    });
    const parent = command(fixture, ["bind", "acme/widgets#42"], {
      env: {
        FAKE_GH_ISSUE_JSON: JSON.stringify({
          number: 42,
          state: "OPEN",
          labels: [
            { name: "repo:identity" },
            { name: "status:in-progress" },
            { name: "type:Task" },
          ],
          comments: [],
          closedByPullRequestsReferences: [],
        }),
        // Page 1: every child closed, and more pages to come.
        FAKE_GH_HIERARCHY_JSON: JSON.stringify({
          data: {
            repository: {
              issue: {
                subIssues: {
                  nodes: [{ state: "CLOSED" }],
                  pageInfo: { hasNextPage: true, endCursor: "CURSOR1" },
                },
              },
            },
          },
        }),
        // Page 2: the open child that used to be invisible.
        FAKE_GH_HIERARCHY_PAGE2_JSON: JSON.stringify({
          data: {
            repository: {
              issue: {
                subIssues: {
                  nodes: [{ state: "OPEN" }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
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

  it("exempts the [skip-cd] release subject the release workflow now emits", () => {
    // The release workflow appends `[skip-cd]` because Amplify Hosting honours
    // that token and does NOT honour `[skip ci]`. The exemption regex is
    // anchored, so without this the bot's own commit would be rejected by the
    // commit-msg hook and releases would stop.
    const fixture = createFixture();
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");

    writeFileSync(messageFile, "chore(release): 1.2.3 [skip ci] [skip-cd]\n");
    expect(command(fixture, ["validate-commit", messageFile]).stdout).toContain(
      "WORK_ITEM_TRACKING_OK release"
    );

    writeFileSync(
      messageFile,
      "chore(release): 1.2.3-rc.1 [skip ci] [skip-cd]\n"
    );
    expect(command(fixture, ["validate-commit", messageFile]).stdout).toContain(
      "WORK_ITEM_TRACKING_OK release"
    );
  });

  it("does not widen the exemption into a prefix match", () => {
    // Accepting the optional token must not turn the anchored subject into
    // "anything starting with chore(release)". Each of these is one edit away
    // from the exempt form and must still be rejected.
    const fixture = createFixture();
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");

    for (const subject of [
      "chore(release): 1.2.3 [skip ci] [skip-cd] and more",
      "chore(release): 1.2.3 [skip ci][skip-cd]",
      "chore(release): 1.2.3 [skip-cd]",
    ]) {
      writeFileSync(messageFile, `${subject}\n`);
      expect(command(fixture, ["validate-commit", messageFile]).status).toBe(1);
    }
  });
});

describe("push and pull-request proof", () => {
  it("allows the first push for CI follow-up, and names a multi-item range", () => {
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
      "no pull request exists yet, so gates 4 and 5 could not be checked here"
    );

    // A range naming two items is not refused here: the rule it would break is
    // about what the pull request DECLARES, and no pull request exists yet. It
    // is named instead, so the requirement CI will apply is known now rather
    // than one cycle later. `catches an undeclared work item in the range`
    // below is the enforcing half.
    commit(fixture, "fix: another ticket\n\nWork-Item: acme/widgets#43");
    const mixedHead = git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
    const mixed = command(fixture, ["validate-push", "origin"], {
      env: {
        FAKE_GH_PR_MISSING: "1",
      },
      input: `refs/heads/feature/tracked ${mixedHead} refs/heads/feature/tracked ${ZERO_OID}\n`,
    });
    expect(mixed.status).toBe(0);
    expect(mixed.stdout).toContain("This range names 2 work items");
    expect(mixed.stdout).toContain("acme/widgets#42");
    expect(mixed.stdout).toContain("acme/widgets#43");
  });

  /**
   * `git push` may carry several ref updates at once — three rebased branches
   * pushed together to pay one slow pre-push gate instead of three. Pooling
   * their ranges into one commit list made those branches indistinguishable
   * from a single branch that had gathered all of their work, so a batch of
   * perfectly traced single-item branches was refused for "mixed Work-Item
   * references" that no branch contained. Batching was impossible by
   * construction and N work items cost N full gate runs.
   */
  it("validates each pushed ref on its own, so a batch is not one range", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    git(
      fixture.root,
      ["update-ref", "refs/remotes/origin/main", base],
      fixture.env
    );
    setOriginHead(fixture);
    const one = commit(fixture, "feat: one\n\nWork-Item: acme/widgets#42");
    git(
      fixture.root,
      ["switch", "-q", "-c", "feature/second", base],
      fixture.env
    );
    const two = commit(fixture, "feat: two\n\nWork-Item: acme/widgets#43");

    const result = command(fixture, ["validate-push", "origin"], {
      env: { FAKE_GH_PR_MISSING: "1" },
      input:
        `refs/heads/feature/tracked ${one} refs/heads/feature/tracked ${base}\n` +
        `refs/heads/feature/second ${two} refs/heads/feature/second ${base}\n`,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("refs/heads/feature/tracked: 1 commit(s)");
    expect(result.stdout).toContain("refs/heads/feature/second: 1 commit(s)");
    // Each branch is single-item, so neither range spans anything.
    expect(result.stdout).not.toContain("This range names");
  });

  it("still refuses the untraceable ref in an otherwise clean batch", () => {
    // The control: validating per ref must not become validating leniently.
    // One branch in the batch carries a commit with no trailer, and the whole
    // push is refused for it.
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    git(
      fixture.root,
      ["update-ref", "refs/remotes/origin/main", base],
      fixture.env
    );
    setOriginHead(fixture);
    const one = commit(fixture, "feat: one\n\nWork-Item: acme/widgets#42");
    git(
      fixture.root,
      ["switch", "-q", "-c", "feature/second", base],
      fixture.env
    );
    const two = commit(fixture, "feat: two with no trailer");

    const result = command(fixture, ["validate-push", "origin"], {
      env: { FAKE_GH_PR_MISSING: "1" },
      input:
        `refs/heads/feature/tracked ${one} refs/heads/feature/tracked ${base}\n` +
        `refs/heads/feature/second ${two} refs/heads/feature/second ${base}\n`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "No Work-Item trailer anywhere in the commit message"
    );
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
    const merge = boundedSpawnSync({
      args: ["commit-tree", tree, "-p", base, "-p", ancestor],
      command: GIT,
      cwd: fixture.root,
      env: fixture.env,
      input: "Merge branch 'already-in-base'\n",
      label: "git commit-tree",
    });
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

  it("degrades Jira on an identity mismatch and fails closed for wrong repo or container", () => {
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

    // An acli authenticated to the wrong site means Jira cannot be ASKED, not
    // that the ticket is bad — so this degrades loudly rather than refusing.
    // The identity match itself is unchanged: the mismatched site is still
    // detected, and the run still says so on stderr.
    const identity = command(fixture, ["bind", "LAS-12"], {
      env: { FAKE_ACLI_SITE: "attacker.atlassian.net" },
    });
    expect(identity.status).toBe(0);
    expect(identity.stderr).toContain("live validation SKIPPED");
    expect(identity.stderr).toContain("acme.atlassian.net");

    const wrongRepo = command(fixture, ["bind", "LAS-12"], {
      env: { FAKE_ACLI_JSON: fields({ labels: ["repo:other"] }) },
    });
    expect(wrongRepo.status).toBe(1);
    expect(wrongRepo.stderr).toContain("not scoped to repository widgets");

    // Inverted deliberately — see the GitHub sibling above. A Jira ticket
    // still sitting in Ready is committable; only the trailer's format, the
    // ticket's existence, its repo scope and its leafness are gates now.
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
    expect(unclaimed.status).toBe(0);
    expect(unclaimed.stderr).not.toContain("is not claimed");

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

  it("completes Linear only after a merged, managed-backlink pull request", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "code",
      linear: { workspace: "acme", teamKey: "LIN" },
    });
    const prUrl = "https://github.com/acme/code/pull/7";
    const lookup = JSON.stringify({
      data: {
        issue: {
          id: "id-12",
          identifier: "LIN-12",
          team: {
            key: "LIN",
            states: {
              nodes: [
                { id: "started", name: "In Progress", type: "started" },
                { id: "done", name: "Done", type: "completed" },
              ],
            },
          },
          state: { id: "started", name: "In Progress", type: "started" },
          attachments: { nodes: [] },
          comments: { nodes: [{ body: `[lisa-pr-link] ${prUrl}` }] },
        },
      },
    });
    const update = JSON.stringify({
      data: { issueUpdate: { success: true } },
    });
    const readback = JSON.stringify({
      data: {
        issue: {
          id: "id-12",
          identifier: "LIN-12",
          state: { id: "done", name: "Done", type: "completed" },
        },
      },
    });
    const result = command(
      fixture,
      ["complete", "--ref", "LIN-12", "--pr-url", prUrl],
      {
        env: {
          FAKE_CURL_COUNT_FILE: path.join(fixture.root, "curl-count"),
          FAKE_CURL_JSON_1: lookup,
          FAKE_CURL_JSON_2: update,
          FAKE_CURL_JSON_3: readback,
          FAKE_GH_PR_JSON: JSON.stringify({
            mergedAt: "2026-08-26T00:00:00Z",
            number: 7,
            state: "MERGED",
            url: prUrl,
          }),
        },
      }
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    // `Done`, not `done`. The state name is a display string a human typed
    // on the Linear board; matching folds case, reporting must not.
    expect(result.stdout).toContain(
      "work-item completed: LIN-12 -> Done (merged: #7)"
    );
  });

  it("rejects merged evidence from a namesake repository under another owner", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "code",
      linear: { workspace: "acme", teamKey: "LIN" },
    });
    const prUrl = "https://github.com/github/code/pull/7";
    const result = command(
      fixture,
      ["complete", "--ref", "LIN-12", "--pr-url", prUrl],
      {
        env: {
          FAKE_GH_PR_JSON: JSON.stringify({
            mergedAt: "2026-08-26T00:00:00Z",
            number: 7,
            state: "MERGED",
            url: prUrl,
          }),
        },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("github/code");
    expect(result.stderr).toContain("acme/code");
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

  it("rejects wrong-repo and container Linear issues, and accepts unclaimed ones", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });
    const response = (
      labels: string[],
      children: object[] = [],
      stateName = "In Progress"
    ) =>
      JSON.stringify({
        data: {
          issue: {
            id: "id-12",
            identifier: "LIN-12",
            team: { key: "LIN" },
            state: { name: stateName, type: "started" },
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

    // Inverted deliberately — see the GitHub and Jira siblings above.
    const unclaimed = command(fixture, ["bind", "LIN-12"], {
      env: {
        FAKE_CURL_JSON: response(["repo:widgets", "type:Task"], [], "Ready"),
      },
    });
    expect(unclaimed.status).toBe(0);
    expect(unclaimed.stderr).not.toContain("is not claimed");

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
    // Not `WORK_ITEM_TRACKING_OK`: this push carries a work item and no pull
    // request exists, so gates 4 and 5 went unchecked. The exemption being
    // asserted here is gate 3's, and it is proved by the commit count and the
    // clean exit — not by a headline claiming a check nobody made (#3791).
    expect(result.stdout).toContain(
      "WORK_ITEM_TRACKING_INCOMPLETE 1 commit(s)"
    );
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

  it("names a multi-item branch-authored range with the exemption active", () => {
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
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("This range names 2 work items");
  });

  /**
   * The FIRST push of a branch is the last local moment before CI, and it is
   * the moment #2681 measured as silent: no pull request exists, so gates 4
   * and 5 cannot be CHECKED here — but they are perfectly well KNOWN here, and
   * saying nothing is what turns them into two separate CI-cycle surprises.
   */
  it("names the gates it could not check when no pull request exists yet", () => {
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
      env: { FAKE_GH_PR_MISSING: "1" },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${base}\n`,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no pull request exists yet");
    expect(result.stdout).toContain("All five gates, and when each one bites:");
    expect(result.stdout).toContain("the pull-request BODY declares EXACTLY");
    expect(result.stdout).toContain("backlink comment");
  });

  /**
   * The other half of the case above, and the one that was missing (#3791).
   *
   * Asserting only that the deferral is PRINTED when no pull request exists is
   * satisfied by a guard that prints it always — which is what this one did.
   * The push path passed `--repo` with no selector, real gh answered "argument
   * required when using the --repo flag", `allowFailure` turned that into
   * `undefined`, and the deferral went out on every push. It was true by
   * accident before a pull request existed and false afterwards, and it was
   * determined in neither case: gates 4 and 5 were never checked at push at
   * all. Only a case where a pull request DOES exist can tell the two apart.
   */
  it("checks gates 4 and 5 at push when a pull request does exist", () => {
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

    // The fake pull request already declares the item (gate 4). Gate 5 needs a
    // managed backlink on the item, and supplying it here is the point: with
    // the lookup repaired, BOTH gates now actually run at push, so both have to
    // be satisfiable at push for this to pass.
    const prUrl = "https://github.com/acme/code/pull/7";
    const log = path.join(fixture.root, "gh.log");
    const branch = git(
      fixture.root,
      ["rev-parse", "--abbrev-ref", "HEAD"],
      fixture.env
    );
    const result = command(fixture, ["validate-push", "origin"], {
      env: {
        FAKE_GH_ISSUE_JSON: JSON.stringify({
          closedByPullRequestsReferences: [],
          comments: [{ body: `[lisa-pr-link] ${prUrl}` }],
          labels: [{ name: "status:in-progress" }, { name: "type:Bug" }],
          number: 42,
          state: "OPEN",
          url: "https://github.com/acme/widgets/issues/42",
        }),
        FAKE_GH_LOG: log,
      },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${base}\n`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("no pull request exists yet");
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK");
    // The INVOCATION, not just the outcome. Asserting only that a pull request
    // was resolved is satisfied by any argv the double happens to tolerate, and
    // the double tolerating an argv the real tool rejects is the whole defect —
    // so the shape of the call is the thing under test.
    expect(readFileSync(log, "utf8")).toContain(
      `pr view ${branch} --repo acme/code --json url,body,state`
    );
  });
});

/**
 * Argv construction, in-process (#3791).
 *
 * Every case above spawns the CLI, so Stryker sees no in-process coverage of
 * these lines and scored seven surviving mutants against them — a gap no
 * subprocess assertion can close, however well written. The shape of this call
 * is precisely what was defective, so it is tested where it can actually be
 * measured.
 */
describe("pullRequestViewArgs", () => {
  it("selects by number when one is given, in preference to the branch", () => {
    expect(pullRequestViewArgs(7, "feature/x", "acme/code")).toEqual([
      "pr",
      "view",
      "7",
      "--repo",
      "acme/code",
      "--json",
      "url,body,state",
    ]);
  });

  it("falls back to the branch when no number is given", () => {
    expect(pullRequestViewArgs(undefined, "feature/x", "acme/code")).toEqual([
      "pr",
      "view",
      "feature/x",
      "--repo",
      "acme/code",
      "--json",
      "url,body,state",
    ]);
  });

  /**
   * The case the defect turned on. `gh` refuses `--repo` with no selector —
   * "argument required when using the --repo flag" — so sending it alone is a
   * usage error the caller then reads as "no pull request exists". With nothing
   * to resolve by, the flag is withheld rather than sent.
   */
  it("withholds --repo when there is no selector at all", () => {
    expect(pullRequestViewArgs(undefined, undefined, "acme/code")).toEqual([
      "pr",
      "view",
      "--json",
      "url,body,state",
    ]);
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

  it("catches an undeclared work item in the branch-authored range", () => {
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

    // The pull-request body (the fake's `FAKE_GH_PR_JSON`) declares only #42,
    // so #43 is work this pull request carries and does not admit to. That is
    // the accidental-mix case, and it is still refused — by the gate whose
    // remedy exists.
    const validated = prRange(fixture, base, head);
    expect(validated.status).toBe(1);
    expect(validated.stderr).toContain(
      "does not declare acme/widgets#43, which this range's commits carry"
    );
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

/**
 * #2672 (a trailer that is present parses as zero) and #2681 (four
 * requirements revealed one CI cycle at a time, the unrecoverable one last).
 *
 * Both live in this validator and both are about what the gate SAYS versus
 * what it knows: the first counted trailers by position in a text whose
 * position is meaningless and edited by bots, the second knew every unmet
 * requirement at check time and released them one CI cycle apiece.
 */
describe("trailer position and whole-run reporting (#2672, #2681)", () => {
  const PR_URL = "https://github.com/acme/code/pull/7";
  const ATTRIBUTION =
    "\n\n🤖 Generated with Claude Code\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n";
  const BACKLINKED_ISSUE = JSON.stringify({
    number: 42,
    state: "OPEN",
    labels: [{ name: "status:in-progress" }, { name: "type:Bug" }],
    comments: [{ body: `[lisa-pr-link] ${PR_URL}` }],
    closedByPullRequestsReferences: [],
  });

  it("accepts a commit trailer sitting above the attribution block", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    // `git interpret-trailers --parse` reads only the FINAL block, so this
    // exact layout — the one Lisa's own commit convention asks for — parsed as
    // zero trailers and the gate reported `found 0` about a message plainly
    // carrying one.
    writeFileSync(
      messageFile,
      `fix: a change\n\nWork-Item: acme/widgets#42${ATTRIBUTION}`
    );

    const result = command(fixture, ["validate-commit", messageFile]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("accepts the identical second trailer Lisa's own hook appends", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(
      messageFile,
      "fix: a change\n\nWork-Item: acme/widgets#42\nWork-Item: acme/widgets#42\n"
    );

    const result = command(fixture, ["validate-commit", messageFile]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("rejects a commit naming two different items in two different blocks", () => {
    const fixture = createFixture();
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    // The fail-OPEN half of reading only the last block: #43 above the
    // attribution block was invisible, so this commit passed while claiming
    // two different work items and being checked against only one.
    writeFileSync(
      messageFile,
      `fix: a change\n\nWork-Item: acme/widgets#43${ATTRIBUTION}Work-Item: acme/widgets#42\n`
    );

    const result = command(fixture, ["validate-commit", messageFile]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("2 different work items");
    expect(result.stderr).toContain("acme/widgets#43");
    expect(result.stderr).toContain("acme/widgets#42");
  });

  it("accepts a body trailer above an appended release-notes block", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    const bodyFile = path.join(fixture.root, "pr-body.md");
    writeFileSync(
      bodyFile,
      "Some description.\n\nWork-Item: acme/widgets#42\n\n" +
        "<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\n" +
        "## Summary by CodeRabbit\n\n- Bug Fixes: things\n\n" +
        "<!-- end of auto-generated comment: release notes by coderabbit.ai -->\n"
    );

    const result = command(
      fixture,
      [
        "validate-pr",
        "--base",
        base,
        "--head",
        head,
        "--body-file",
        bodyFile,
        "--pr-url",
        PR_URL,
      ],
      { env: { FAKE_GH_ISSUE_JSON: BACKLINKED_ISSUE } }
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("accepts a body repeating the SAME Work-Item line", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    const bodyFile = path.join(fixture.root, "pr-body.md");
    // This used to fail, on the reasoning that nothing appends a Work-Item
    // line to a BODY on Lisa's behalf, so a second one meant a person had
    // written two. The premise is false: a body that quotes its own commit
    // message carries the line twice, and #2721 measured six pull requests
    // across four repositories blocked by this gate in one evening with a
    // correctly scoped ticket on every one.
    //
    // The rule now matches the commit parser's, which is the point: the same
    // text answered two different ways by two parsers is how this recurs. A
    // repeat of the SAME reference cannot admit untracked work — it says
    // exactly what one line says — so rejecting it bought tidiness and cost
    // traceability.
    writeFileSync(
      bodyFile,
      "Work-Item: acme/widgets#42\n\nmore\n\nWork-Item: acme/widgets#42\n"
    );

    const result = command(
      fixture,
      [
        "validate-pr",
        "--base",
        base,
        "--head",
        head,
        "--body-file",
        bodyFile,
        "--pr-url",
        PR_URL,
      ],
      { env: { FAKE_GH_ISSUE_JSON: BACKLINKED_ISSUE } }
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("rejects a body naming two DIFFERENT work items", () => {
    // The ambiguity that was always the real hazard, and the half that must
    // stay strict: which of the two is this pull request actually about?
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    const bodyFile = path.join(fixture.root, "pr-body.md");
    writeFileSync(
      bodyFile,
      "Work-Item: acme/widgets#42\n\nmore\n\nWork-Item: acme/widgets#43\n"
    );

    const result = command(
      fixture,
      [
        "validate-pr",
        "--base",
        base,
        "--head",
        head,
        "--body-file",
        bodyFile,
        "--pr-url",
        PR_URL,
      ],
      { env: { FAKE_GH_ISSUE_JSON: BACKLINKED_ISSUE } }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "declares acme/widgets#43, which no commit in this range carries"
    );
  });

  it("reports the commit trailer and the tracker backlink in one run", () => {
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["bind", "acme/widgets#42"]).status).toBe(0);
    const head = commit(fixture, "feat: untracked change");

    // Two unmet requirements at once: no commit trailer, and an issue with no
    // backlink. The old gate stopped at the first and revealed the second a
    // full CI cycle later.
    const result = prRange(fixture, base, head);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "2 work-item traceability requirements are unmet"
    );
    expect(result.stderr).toContain("no verified backlink");
    expect(result.stderr).toContain(
      "No Work-Item trailer anywhere in the commit message"
    );
    // Unrecoverable first: the backlink cannot be fixed by editing this PR.
    expect(result.stderr.indexOf("no verified backlink")).toBeLessThan(
      result.stderr.indexOf("No Work-Item trailer anywhere")
    );
  });

  it("says a branch-derived backlink needs a new branch, not an edit", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["bind", "LIN-12"]).status).toBe(0);
    const head = commit(fixture, "feat: tracked change\n\nWork-Item: LIN-12");

    const result = prRange(fixture, base, head, {
      FAKE_GH_PR_JSON: JSON.stringify({
        url: PR_URL,
        body: "Work-Item: LIN-12",
        state: "OPEN",
      }),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no verified backlink");
    expect(result.stderr).toContain(
      "[not fixable by editing this pull request]"
    );
    expect(result.stderr).toContain("BRANCH NAME");
    expect(result.stderr).toContain("NEW branch named for LIN-12");
    expect(result.stderr).toContain(`[lisa-pr-link] ${PR_URL}`);
  });
});

/**
 * The backlink WRITER — the producer half of the traceability gate.
 *
 * `assertBacklink` reads a managed `[lisa-pr-link]` comment, and until this
 * command existed nothing executable wrote one: every producer was prose in a
 * SKILL.md an agent might or might not follow. The fake tracker here is
 * STATEFUL on purpose — idempotency is a claim about what two runs leave
 * behind, and a stateless stub can only show that the second run did not
 * crash.
 */
describe("backlink command", () => {
  const PR_URL = "https://github.com/acme/code/pull/7";
  const OTHER_PR_URL = "https://github.com/acme/code/pull/8";

  /**
   * Replace the fixture's `gh` with one that keeps a real comment store.
   * @param fixture - The disposable fixture.
   * @returns Path to the JSON file holding the issue's comments.
   */
  function statefulGh(fixture: Fixture): string {
    const store = path.join(fixture.root, "comments.json");
    const file = path.join(fixture.bin, "gh");
    writeFileSync(
      file,
      `#!${process.execPath}
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const store = ${JSON.stringify(store)};
const args = process.argv.slice(2);
if (args[0] !== "api") { console.error("unexpected gh: " + args.join(" ")); process.exit(70); }
const comments = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : [];
const at = name => (args.indexOf(name) < 0 ? undefined : args[args.indexOf(name) + 1]);
const method = at("--method") || "GET";
const endpoint = args.find(a => a.startsWith("repos/")) || "";
const field = at("--field") || "";
const body = field.startsWith("body=") ? field.slice(5) : "";
if (method === "GET") { process.stdout.write(JSON.stringify(comments)); process.exit(0); }
if (method === "POST") comments.push({ id: comments.length + 1, body });
else if (method === "PATCH") {
  const id = Number(endpoint.split("/").pop());
  const found = comments.find(c => c.id === id);
  if (!found) { console.error("no such comment " + id); process.exit(1); }
  found.body = body;
} else { console.error("unexpected method " + method); process.exit(70); }
writeFileSync(store, JSON.stringify(comments));
process.stdout.write(JSON.stringify({ id: 1 }));
`
    );
    chmodSync(file, 0o755);
    return store;
  }

  /** The comments the fake tracker is currently holding. */
  function stored(store: string): { body: string; id: number }[] {
    return existsSync(store)
      ? (JSON.parse(readFileSync(store, "utf8")) as {
          body: string;
          id: number;
        }[])
      : [];
  }

  it("creates the managed comment on an issue that has none", () => {
    const fixture = createFixture();
    const store = statefulGh(fixture);

    const result = command(fixture, [
      "backlink",
      "--ref",
      "acme/widgets#42",
      "--pr-url",
      PR_URL,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("created");
    expect(stored(store)).toEqual([
      { body: `[lisa-pr-link] ${PR_URL}`, id: 1 },
    ]);
  });

  it("leaves exactly one comment when run twice for the same pull request", () => {
    // Idempotency, proven rather than assumed: the assertion is on what the
    // tracker HOLDS after two runs, not on the second run's exit status.
    const fixture = createFixture();
    const store = statefulGh(fixture);
    const args = ["backlink", "--ref", "acme/widgets#42", "--pr-url", PR_URL];

    expect(command(fixture, args).status).toBe(0);
    const second = command(fixture, args);

    expect(second.status).toBe(0);
    expect(stored(store)).toHaveLength(1);
    expect(second.stdout).toContain("unchanged");
  });

  it("updates the one managed comment instead of posting a second", () => {
    // The other rerun shape: same issue, different pull request. An append
    // would leave two comments, and the second would link a PR this branch is
    // no longer about.
    const fixture = createFixture();
    const store = statefulGh(fixture);

    expect(
      command(fixture, [
        "backlink",
        "--ref",
        "acme/widgets#42",
        "--pr-url",
        PR_URL,
      ]).status
    ).toBe(0);
    const update = command(fixture, [
      "backlink",
      "--ref",
      "acme/widgets#42",
      "--pr-url",
      OTHER_PR_URL,
    ]);

    expect(update.status).toBe(0);
    expect(update.stdout).toContain("updated");
    expect(stored(store)).toEqual([
      { body: `[lisa-pr-link] ${OTHER_PR_URL}`, id: 1 },
    ]);
  });

  it("writes the comment the traceability check reads", () => {
    // Producer and consumer asserted against each other in one test, because
    // the defect being fixed is precisely that nobody had checked they agree.
    const fixture = createFixture();
    const store = statefulGh(fixture);
    command(fixture, [
      "backlink",
      "--ref",
      "acme/widgets#42",
      "--pr-url",
      PR_URL,
    ]);

    expect(textContainsBacklink(stored(store), PR_URL)).toBe(true);
  });

  it("falls back to the worktree binding when no --ref is given", () => {
    const fixture = createFixture();
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    const store = statefulGh(fixture);

    const result = command(fixture, ["backlink", "--pr-url", PR_URL]);

    expect(result.status).toBe(0);
    expect(stored(store)).toHaveLength(1);
  });

  it("refuses without a pull request URL rather than doing nothing", () => {
    const fixture = createFixture();
    const store = statefulGh(fixture);

    const result = command(fixture, ["backlink", "--ref", "acme/widgets#42"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("requires --pr-url");
    expect(stored(store)).toEqual([]);
  });

  it("names itself in the refusal when the backlink is missing", () => {
    // The highest-value half: a check that says "no verified backlink" without
    // naming the remedy is what turned this into a multi-cycle rediscovery.
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );

    const result = prRange(fixture, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no verified backlink");
    expect(result.stderr).toContain(
      `node scripts/lisa-work-item.mjs backlink --ref acme/widgets#42 --pr-url ${PR_URL}`
    );
  });
});

/**
 * The writer's refusals.
 *
 * A backlink command that cannot write must SAY so. Reporting success while
 * writing nothing reproduces the original defect one layer down: the operator
 * believes the ticket is linked, and the required check still fails.
 */
describe("backlink command refusals", () => {
  const PR_URL = "https://github.com/acme/code/pull/7";

  it("refuses a Linear backlink with no API key rather than reporting success", () => {
    const fixture = createFixture({
      tracker: "linear",
      repo: "widgets",
      linear: { workspace: "acme", teamKey: "LIN" },
    });

    const result = command(
      fixture,
      ["backlink", "--ref", "LIN-12", "--pr-url", PR_URL],
      { env: { LINEAR_API_KEY: "" } }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("writing a Linear backlink requires");
  });

  it("refuses a Jira backlink with no credentials rather than degrading to acli", () => {
    // The READ path may degrade to whatever can answer. A WRITE may not: a
    // comment that silently does not get posted is the failure this command
    // exists to remove.
    const fixture = createFixture({
      tracker: "jira",
      repo: "widgets",
      jira: { project: "LAS" },
      atlassian: { site: "acme.atlassian.net" },
    });

    const result = command(
      fixture,
      ["backlink", "--ref", "LAS-12", "--pr-url", PR_URL],
      { env: { ATLASSIAN_API_TOKEN: "", JIRA_API_TOKEN: "", JIRA_LOGIN: "" } }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("writing a Jira backlink requires");
  });
});

/**
 * Traceability with NO tracker credentials (#2721).
 *
 * The gate enforces four separate things and three of them need tracker API
 * access: the `repo:` label, the claimed lifecycle state, and a backlink that
 * needs WRITE access. Only the first — a well-formed `Work-Item:` reference —
 * carries the traceability, and it needs nothing at all. A project unwilling to
 * put a tracker API key in CI could not satisfy the gate in any form.
 *
 * `workItem.verify` says which of the two contracts a project is asking for.
 * `trailer`, the default, proves the reference and makes NO tracker call; the
 * fixtures below sever every tracker transport, so a passing case is proof that
 * nothing was contacted rather than a claim about it. `full` is today's
 * behaviour, unchanged, and is what Lisa's own repository declares.
 *
 * The one thing trailer-only must never become is a pass for work with no
 * reference at all — "cannot verify" reported as "verified" is the vacuous
 * green this gate exists to prevent, so that case is asserted here too.
 */
describe("credential-free traceability (#2721)", () => {
  /** A project that keeps no tracker credentials — the shipped default. */
  function trailerOnlyConfig(): object {
    return { ...githubConfig(), workItem: { verify: "trailer" } };
  }

  /**
   * Make every tracker transport fail loudly.
   *
   * Not "return an error payload" — refuse to answer at all, and say so on
   * stderr. A trailer-only run that passes through this has demonstrably not
   * consulted a tracker, which is a stronger claim than any stub asserting on
   * what it was asked.
   * @param fixture - The disposable fixture.
   */
  function severTrackerAccess(fixture: Fixture): void {
    for (const name of ["gh", "acli", "curl"])
      executable(
        path.join(fixture.bin, name),
        `printf 'tracker contacted: %s\\n' "$*" >&2; exit 70`
      );
  }

  it("validates a commit with every tracker transport severed", () => {
    const fixture = createFixture(trailerOnlyConfig());
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    severTrackerAccess(fixture);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "fix: a change\n\nWork-Item: acme/widgets#42\n");

    const result = command(fixture, ["validate-commit", messageFile]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("binds a work item with every tracker transport severed", () => {
    // `link` is the first step Lisa documents, and it called the tracker to
    // confirm the item exists. With no credential there was no way to start.
    const fixture = createFixture(trailerOnlyConfig());
    severTrackerAccess(fixture);

    const result = command(fixture, ["link", "acme/widgets#42"]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("still FAILS a commit carrying no Work-Item reference", () => {
    // The line between credential-free and vacuous. Nothing here can be
    // checked against a tracker, and the gate still has to refuse.
    const fixture = createFixture(trailerOnlyConfig());
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    severTrackerAccess(fixture);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "fix: no reference at all\n");

    const result = command(fixture, ["validate-commit", messageFile]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "No Work-Item trailer anywhere in the commit message"
    );
  });

  it("still FAILS a commit whose reference is outside the configured repo", () => {
    const fixture = createFixture(trailerOnlyConfig());
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    severTrackerAccess(fixture);
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(
      messageFile,
      "fix: wrong repo\n\nWork-Item: acme/elsewhere#42\n"
    );

    const result = command(fixture, ["validate-commit", messageFile]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("outside configured tracker repository");
  });

  it("validates a pull request with no tracker backlink and no tracker call", () => {
    const fixture = createFixture(trailerOnlyConfig());
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    severTrackerAccess(fixture);
    const bodyFile = path.join(fixture.root, "pr-body.md");
    writeFileSync(bodyFile, "Summary.\n\nWork-Item: acme/widgets#42\n");

    const result = command(fixture, [
      "validate-pr",
      "--base",
      base,
      "--head",
      head,
      "--body-file",
      bodyFile,
    ]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("still FAILS a pull request whose body names a different item", () => {
    const fixture = createFixture(trailerOnlyConfig());
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    severTrackerAccess(fixture);
    const bodyFile = path.join(fixture.root, "pr-body.md");
    writeFileSync(bodyFile, "Work-Item: acme/widgets#43\n");

    const result = command(fixture, [
      "validate-pr",
      "--base",
      base,
      "--head",
      head,
      "--body-file",
      bodyFile,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "does not match commit Work-Item acme/widgets#42"
    );
  });

  it("still FAILS a pull request whose commits carry no reference", () => {
    const fixture = createFixture(trailerOnlyConfig());
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    const head = commit(fixture, "feat: untracked change");
    severTrackerAccess(fixture);
    const bodyFile = path.join(fixture.root, "pr-body.md");
    writeFileSync(bodyFile, "Work-Item: acme/widgets#42\n");

    const result = command(fixture, [
      "validate-pr",
      "--base",
      base,
      "--head",
      head,
      "--body-file",
      bodyFile,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "No Work-Item trailer anywhere in the commit message"
    );
  });

  it("keeps every tracker check when the project declares verify: full", () => {
    // The strict contract is still reachable and still strict — the change is
    // which one a project gets without saying anything.
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );

    const result = prRange(fixture, base, head);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no verified backlink");
  });

  it("degrades a verify: full project to trailer-only on the env override", () => {
    // What CI does when a declared credential did not arrive. Today that path
    // prints a warning and exits 0 — the required check reporting success
    // having verified nothing, a completely absent trailer included.
    const fixture = createFixture();
    const base = git(fixture.root, ["rev-parse", "main"], fixture.env);
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    severTrackerAccess(fixture);
    const bodyFile = path.join(fixture.root, "pr-body.md");
    writeFileSync(bodyFile, "Work-Item: acme/widgets#42\n");

    const result = command(
      fixture,
      ["validate-pr", "--base", base, "--head", head, "--body-file", bodyFile],
      { env: { LISA_WORK_ITEM_VERIFY: "trailer" } }
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("reports the resolved level rather than making CI re-derive it", () => {
    const declared = createFixture();
    const defaulted = createFixture(githubConfig());
    // Same fixture shape, no `workItem` key at all — the shipped default.
    writeFileSync(
      path.join(defaulted.root, ".lisa.config.json"),
      `${JSON.stringify(githubConfig(), null, 2)}\n`
    );

    expect(command(declared, ["verify-level"]).stdout.trim()).toBe("full");
    expect(command(defaulted, ["verify-level"]).stdout.trim()).toBe("trailer");
    expect(
      command(declared, ["verify-level"], {
        env: { LISA_WORK_ITEM_VERIFY: "trailer" },
      }).stdout.trim()
    ).toBe("trailer");
  });

  it("refuses an unrecognised verify level instead of guessing one", () => {
    // A typo must not silently pick a level. Defaulting quietly to `trailer`
    // would weaken the gate on a misspelling; defaulting to `full` would break
    // a credential-free project on one.
    const fixture = createFixture({
      ...githubConfig(),
      workItem: { verify: "strict" },
    });
    const messageFile = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(messageFile, "fix: a change\n\nWork-Item: acme/widgets#42\n");

    const result = command(fixture, ["validate-commit", messageFile]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workItem.verify");
    expect(result.stderr).toContain("strict");
    expect(result.stderr).toContain("is a leaf");
    expect(result.stderr).not.toContain("claimed state");
  });
});

/**
 * A worktree binding from another branch must never be trusted.
 *
 * `readState` answers "what is written in the binding file", which is not the
 * same question as "what is this branch working on". A binding survives a
 * branch switch, so a command that reads it without validating acts on a work
 * item that has nothing to do with the change in hand.
 *
 * `assertStateMatches` has always validated. `backlink` and `complete` did not,
 * and the consequences differ in kind:
 *
 *   backlink  writes the managed comment to the WRONG ticket
 *   complete  applies the terminal role and CLOSES the wrong ticket
 *
 * Neither is self-correcting, and afterwards the closure is indistinguishable
 * from a real one. Reported by an agent reviewing the vendored copy.
 *
 * The assertions check BOTH that the command refuses and that the tracker was
 * never contacted — a refusal that happens after the write is not a refusal.
 */
describe("commands refuse a binding that belongs to another branch", () => {
  const PR_URL = "https://github.com/acme/code/pull/7";

  /**
   * Bind a work item on one branch, then switch to another.
   * @returns The fixture and the path its fake `gh` logs invocations to.
   */
  function boundThenSwitched(): { fixture: Fixture; log: string } {
    const fixture = createFixture();
    git(fixture.root, ["checkout", "-b", "binding/bound-here"], fixture.env);
    expect(command(fixture, ["link", "acme/widgets#42"]).status).toBe(0);
    git(
      fixture.root,
      ["checkout", "-b", "binding/somewhere-else"],
      fixture.env
    );
    return { fixture, log: path.join(fixture.root, "gh-calls.log") };
  }

  it("backlink refuses, and contacts nothing", () => {
    const { fixture, log } = boundThenSwitched();

    const result = command(fixture, ["backlink", "--pr-url", PR_URL], {
      env: { FAKE_GH_LOG: log },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "belongs to branch 'binding/bound-here', not 'binding/somewhere-else'"
    );
    expect(existsSync(log)).toBe(false);
  });

  it("complete refuses, and contacts nothing", () => {
    // The worse of the two: this one would have closed the wrong ticket.
    const { fixture, log } = boundThenSwitched();

    const result = command(fixture, ["complete"], {
      env: { FAKE_GH_LOG: log },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "belongs to branch 'binding/bound-here', not 'binding/somewhere-else'"
    );
    expect(existsSync(log)).toBe(false);
  });

  it("an explicit --ref needs no binding and is unaffected", () => {
    // The positive control, and it is what stops the fix from being "refuse
    // everything". A caller naming the work item explicitly has no dependency
    // on the binding at all, so validating one it never consulted would break
    // every scripted invocation.
    const { fixture, log } = boundThenSwitched();

    const result = command(
      fixture,
      ["backlink", "--ref", "acme/widgets#42", "--pr-url", PR_URL],
      { env: { FAKE_GH_LOG: log } }
    );

    // status 0, not merely "no branch error". Reported by review: without this
    // the fake `gh` rejected both REST calls `backlink` makes, the command
    // exited 1, and every assertion here still passed — the control proved the
    // command REACHED the tracker, not that it SUCCEEDED. A positive control
    // that passes for the wrong reason is the defect it exists to catch.
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("belongs to branch");
    expect(existsSync(log)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The commit path has TWO notions of what a worktree is working on. The
// `lisa-track` binding at `<git-dir>/lisa/work-item.json` is the stronger one
// and stays authoritative wherever it exists. It is also usually absent —
// measured 2026-08-20 on one machine, 3 of 47 linked worktrees carried it and
// the primary checkout did not — and its absence used to mean the trailer was
// compared against nothing at all while the hook still printed
// `WORK_ITEM_TRACKING_OK`. The branch name is the second, always-available
// notion. These cases pin both halves: that it refuses a mis-attributed
// trailer, and that it disturbs neither the bound path nor any branch that
// never encoded a work item.
//
// Every case supplies a tracker response for the reference it sends, so the
// pre-fix behaviour is a genuine ACCEPT rather than a refusal that happens to
// come from the liveness check. A control that refuses for the wrong reason
// would look identical to the fix working.
// ---------------------------------------------------------------------------
describe("commit identity fallback: the branch when no binding exists", () => {
  /** The Linear tracker config the fake `curl` transport answers for. */
  const LINEAR = {
    tracker: "linear",
    repo: "widgets",
    linear: { workspace: "acme", teamKey: "LIN" },
  };

  /** A live, claimed, in-scope Linear issue payload for any identifier. */
  function liveIssue(identifier: string): string {
    return JSON.stringify({
      data: {
        issue: {
          attachments: { nodes: [] },
          children: { nodes: [] },
          comments: { nodes: [] },
          id: `id-${identifier}`,
          identifier,
          labels: { nodes: [{ name: "repo:widgets" }, { name: "type:Task" }] },
          state: { name: "In Progress", type: "started" },
          team: { key: "LIN" },
        },
      },
    });
  }

  /** A fixture checked out on `branch`, carrying the Linear contract. */
  function fixtureOn(branch: string): Fixture {
    const fixture = createFixture(LINEAR);
    git(fixture.root, ["switch", "-q", "-c", branch], fixture.env);
    return fixture;
  }

  /**
   * Write the worktree binding directly.
   *
   * Directly, rather than through `link`, so reaching the bound state costs no
   * tracker round trip and the case under test is the only thing the transport
   * is asked about.
   */
  function bindDirectly(fixture: Fixture, ref: string): void {
    const file = stateFilePath(fixture);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({
        branch: git(fixture.root, ["branch", "--show-current"], fixture.env),
        provider: "linear",
        ref,
        version: 1,
      })}\n`
    );
  }

  /**
   * Run `validate-commit` over a well-formed message carrying `ref`, with a
   * tracker that answers for that same reference unless told otherwise.
   */
  function validateCommitFor(
    fixture: Fixture,
    ref: string,
    env: NodeJS.ProcessEnv = {}
  ): CommandResult {
    const file = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(file, `chore: a change\n\nWork-Item: ${ref}\n`);
    return command(fixture, ["validate-commit", file], {
      env: { FAKE_CURL_JSON: liveIssue(ref), ...env },
    });
  }

  it("refuses a mis-attributed trailer and accepts the matching one, unbound", () => {
    const fixture = fixtureOn("claude/lin-12-branch-fallback");

    // Before the fallback existed this exited 0 and printed
    // `WORK_ITEM_TRACKING_OK LIN-99` — a live, in-scope, perfectly valid
    // reference to work this branch is not doing, on its way into history.
    const refused = validateCommitFor(fixture, "LIN-99");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("LIN-99");
    expect(refused.stderr).toContain("LIN-12");

    const accepted = validateCommitFor(fixture, "LIN-12");
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.stdout).toContain("WORK_ITEM_TRACKING_OK LIN-12");
  });

  // The trap that makes a wrong implementation look like a right one: an
  // upper-case-only extractor (`[A-Z]{2,10}-[0-9]+`, the shape Jira-key tooling
  // reaches for by habit) matches nothing against this fleet's lower-case agent
  // branches. It would take the fail-open path on every commit and print the
  // same success line the fix exists to replace — a second fail-open wearing
  // the first fix's clothes, and worse than the gap, because the gap would now
  // be believed closed.
  it("parses a lower-case branch segment and canonicalizes it", () => {
    const fixture = fixtureOn("claude/lin-7220-psr-metric-sale-offset");

    const result = validateCommitFor(fixture, "LIN-99");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LIN-7220");
  });

  // Fails OPEN wherever the branch states nothing. The defect being closed is a
  // comparison that silently did not happen; replacing it with a new class of
  // blocked commit on every branch that never encoded a ticket would trade one
  // surprise for a louder one. `feat/ABC-9-…` is the same property one step
  // further out: well formed, but another project's key, so this fallback has
  // nothing to say about it.
  it("fails open on every branch that encodes no work item for this project", () => {
    const fixture = fixtureOn("claude/lin-12-branch-fallback");

    for (const branch of [
      "main",
      "dev",
      "staging",
      "chore/bump-deps",
      "feat/ABC-9-someone-elses-convention",
    ]) {
      git(fixture.root, ["switch", "-q", "-C", branch], fixture.env);
      const result = validateCommitFor(fixture, "LIN-99");
      expect(result.status, `${branch}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK LIN-99");
    }
  });

  it("reads no KEY-shaped branch segment for the GitHub provider", () => {
    // A GitHub reference is `owner/repo#123`, so a branch segment shaped like
    // ANOTHER tracker's key (`lin-12`) names nothing here and must not become
    // a comparison the GitHub path never had. A bare issue number is a
    // different matter and IS read — see the GitHub cases below (#3861).
    const fixture = createFixture(githubConfig());
    git(
      fixture.root,
      ["switch", "-q", "-c", "claude/lin-12-looks-like-a-key"],
      fixture.env
    );
    const file = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(file, "chore: a change\n\nWork-Item: acme/widgets#42\n");

    expect(command(fixture, ["validate-commit", file]).status).toBe(0);
  });

  it("keeps the binding authoritative over a disagreeing branch", () => {
    const fixture = fixtureOn("claude/lin-77-bound-elsewhere");
    bindDirectly(fixture, "LIN-12");

    // The binding is what `prepare-commit-msg` seeds the trailer from, and a
    // branch that says something else does not overrule it.
    const accepted = validateCommitFor(fixture, "LIN-12");
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain("WORK_ITEM_TRACKING_OK LIN-12");

    // And the pre-existing refusal keeps its own wording, so a bound worktree
    // behaves exactly as it did before this fallback existed.
    const refused = validateCommitFor(fixture, "LIN-99");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("does not match this worktree's binding");
    expect(refused.stderr).toContain("LIN-12");
  });

  it("leaves the merge exemption intact on a branch encoding a work item", () => {
    // The exemption returns before the trailer is even parsed, so a merge
    // message carrying no reference must stay accepted on a branch that DOES
    // encode one — otherwise every `git pull` on a feature branch is wedged.
    const fixture = fixtureOn("claude/lin-12-branch-fallback");
    // Written as a file rather than through `update-ref`, which refuses to
    // touch a pseudoref. This is the state a stopped merge leaves behind, and
    // it is what `isMergeInProgress` reads.
    writeFileSync(
      path.resolve(
        fixture.root,
        git(
          fixture.root,
          ["rev-parse", "--git-path", "MERGE_HEAD"],
          fixture.env
        )
      ),
      `${git(fixture.root, ["rev-parse", "main"], fixture.env)}\n`
    );
    const file = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(file, "Merge branch 'theirs'\n");

    const result = command(fixture, ["validate-commit", file]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WORK_ITEM_TRACKING_OK merge");
  });

  it("reaches the branch verdict without contacting the tracker", () => {
    // `FAKE_CURL_FAIL=1` is a transport that cannot answer. A branch-mismatch
    // verdict under it is only reachable if the comparison completed before any
    // tracker call — the property that lets this run on every single commit.
    const fixture = fixtureOn("claude/lin-12-branch-fallback");

    const refused = validateCommitFor(fixture, "LIN-99", {
      FAKE_CURL_FAIL: "1",
    });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("does not match this branch's work item");
    expect(refused.stderr).not.toContain("Linear");

    // The counter-control: with the SAME dead transport and an AGREEING
    // trailer, the run gets far enough to ask Linear and fails there. Without
    // it, the assertion above would also pass for a build that refused
    // everything before doing any work at all.
    const reached = validateCommitFor(fixture, "LIN-12", {
      FAKE_CURL_FAIL: "1",
    });
    expect(reached.status).toBe(1);
    expect(reached.stderr).toContain("Linear");
  });
});

// ---------------------------------------------------------------------------
// The same fallback, for the provider it never reached.
//
// `branchWorkItem` returned `undefined` on its FIRST statement for the GitHub
// provider, on the premise that "no branch-naming convention encodes a GitHub
// reference". That is true of the canonical `owner/repo#123` spelling and
// false of the convention actually in use — `fix/3537-…`, `stack/3463`. The
// number is right there, just not spelled as a full reference. So on a GitHub
// repository the trailer was compared against the binding or against nothing,
// and on the machine that found this 4 of 105 worktrees carried a binding
// (CodySwannGT/lisa#3861).
//
// The number is read ONLY as the whole first path segment after the first
// slash. That is what separates an issue number from a version (`4.33.1`), a
// date stamp (`20260903`), and another tracker's key (`se-7728`) — every one
// of which appears in this repository's own branch list, and every one of
// which a looser "first number anywhere" rule would misread as an issue and
// refuse. The cases below pin each of those apart individually, because a
// single passing case cannot show WHICH rule produced it.
// ---------------------------------------------------------------------------
describe("commit identity fallback on GitHub (#3861)", () => {
  const REPOSITORY = "acme/widgets";
  const MATCHING = `${REPOSITORY}#42`;

  /** A GitHub fixture checked out on `branch`. */
  function githubOn(branch: string): Fixture {
    const fixture = createFixture(githubConfig());
    git(fixture.root, ["switch", "-q", "-c", branch], fixture.env);
    return fixture;
  }

  /**
   * Run `validate-commit` over a well-formed message carrying `ref`.
   * @param fixture The fixture to run in.
   * @param ref The reference the trailer names.
   * @param env Extra environment entries.
   * @returns The completed command result.
   */
  function validateOn(
    fixture: Fixture,
    ref: string,
    env: NodeJS.ProcessEnv = {}
  ): CommandResult {
    const file = path.join(fixture.root, "COMMIT_EDITMSG");
    writeFileSync(file, `chore: a change\n\nWork-Item: ${ref}\n`);
    return command(fixture, ["validate-commit", file], { env });
  }

  it("refuses a trailer naming a different issue than the branch encodes", () => {
    // Before this, the identical case exited 0 and printed
    // `WORK_ITEM_TRACKING_OK` — a live, in-scope, perfectly valid reference to
    // work this branch is not doing, on its way into history.
    const fixture = githubOn("fix/99-a-different-ticket");

    const refused = validateOn(fixture, MATCHING);

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("does not match this branch's work item");
    expect(refused.stderr).toContain(`${REPOSITORY}#99`);
  });

  it("accepts the trailer the branch encodes", () => {
    const fixture = githubOn("fix/42-the-real-ticket");

    expect(validateOn(fixture, MATCHING).status).toBe(0);
  });

  it("reads a bare number that is the whole segment, with no slug after it", () => {
    // `stack/3463` in the wild: nothing follows the number.
    const fixture = githubOn("stack/99");

    expect(validateOn(fixture, MATCHING).status).toBe(1);
  });

  it("does not read a version as an issue number", () => {
    // `chore/upgrade-lisa-4.33.1`. A "first number anywhere" rule reads 4 here
    // and refuses every dependency bump in the repository.
    const fixture = githubOn("chore/upgrade-lisa-4.33.1");

    expect(validateOn(fixture, MATCHING).status).toBe(0);
  });

  it("does not read a date stamp as an issue number", () => {
    // `stack/queue-drain-20260903`. There is no issue 20260903.
    const fixture = githubOn("stack/queue-drain-20260903");

    expect(validateOn(fixture, MATCHING).status).toBe(0);
  });

  it("does not read another tracker's key as an issue number", () => {
    // `fix/se-7728-…` names an SE ticket. Whatever GitHub issue it maps to, it
    // is not 7728, so reading it would attribute the commit to a coincidence.
    const fixture = githubOn("fix/se-7728-e2e-coverage-wildcard");

    expect(validateOn(fixture, MATCHING).status).toBe(0);
  });

  it("fails open on a branch that encodes no number at all", () => {
    // The deliberate fail-open. Replacing a comparison that silently did not
    // happen with a new class of blocked commit on every unnumbered branch
    // would trade one surprise for a louder one.
    const fixture = githubOn("chore/bump-deps");

    expect(validateOn(fixture, MATCHING).status).toBe(0);
  });

  it("keeps the binding authoritative over a disagreeing branch", () => {
    // The documented escape for a branch deliberately retargeted to another
    // ticket — a shape this repository's own history contains, where five
    // commits on a branch named for one issue all declared another.
    const fixture = githubOn("fix/99-branch-says-99");
    const file = stateFilePath(fixture);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify({
        branch: git(fixture.root, ["branch", "--show-current"], fixture.env),
        provider: "github",
        ref: MATCHING,
        version: 1,
      })}\n`
    );

    expect(validateOn(fixture, MATCHING).status).toBe(0);
  });

  it("reaches the branch verdict without contacting the tracker", () => {
    // The property that lets this run on every single commit. An unparseable
    // tracker payload is a transport that cannot answer; a branch-mismatch
    // verdict under it is only reachable if the comparison completed before
    // any tracker call.
    const dead = { FAKE_GH_ISSUE_JSON: "not json at all" };
    const refused = validateOn(
      githubOn("fix/99-a-different-ticket"),
      MATCHING,
      dead
    );

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("does not match this branch's work item");

    // The counter-control: with the SAME dead payload and an AGREEING trailer,
    // the run gets far enough to ask GitHub and fails there instead. Without
    // it, the assertion above would also pass for a build that refused
    // everything before doing any work at all.
    const reached = validateOn(
      githubOn("fix/42-the-real-ticket"),
      MATCHING,
      dead
    );

    expect(reached.status).toBe(1);
    expect(reached.stderr).not.toContain(
      "does not match this branch's work item"
    );
  });
});

// ---------------------------------------------------------------------------
// The branch reader itself, in process.
//
// The CLI cases above reach this function only by SPAWNING the script, and a
// subprocess loads the file from disk rather than the instrumented module. The
// mutation gate therefore cannot see through them: measured, 12 of 12 mutants
// in `githubBranchIssue` survived the full CLI set, while an untouched range of
// the same file scored 85.71% off the in-process importers. The CLI cases prove
// the wiring; these prove the rule, and only these can prove it.
//
// Each row exists to defeat a specific way the pattern could be wrong, so the
// table is a list of decisions rather than a list of examples.
// ---------------------------------------------------------------------------
describe("githubBranchIssue, in process (#3861)", () => {
  const CONTRACT = { provider: "github", repository: "acme/widgets" };

  it.each([
    // Reads the number, and reads ALL of it — `\d*` collapsing to `\d` would
    // yield 386, and `\d*` widening to `\D*` would match nothing at all.
    ["fix/3861-github-branch-work-item", "acme/widgets#3861"],
    // The number may end the branch, so the terminator is `-` OR end-of-input.
    // Dropping the `$` alternative loses this one.
    ["stack/3463", "acme/widgets#3463"],
    // ...and it may be followed by a slug, so dropping the `-` alternative
    // loses this one instead. The pair pins both halves.
    ["qd/3554-release-commit-reachability", "acme/widgets#3554"],
    // A single-character prefix still counts: `[^/]+` must not become `[^/]`.
    ["x/12-short-prefix", "acme/widgets#12"],
  ])("reads %s as %s", (branch, expected) => {
    expect(githubBranchIssue(branch, CONTRACT)).toBe(expected);
  });

  it.each([
    // A version. The single most common false positive a looser rule creates,
    // because every dependency bump in the repository carries one.
    ["chore/upgrade-lisa-4.33.1"],
    // A date stamp. There is no issue 20260903.
    ["stack/queue-drain-20260903"],
    // Another tracker's key. Whatever GitHub issue it maps to is not 7728.
    ["fix/se-7728-e2e-coverage-wildcard"],
    // Nothing numeric at all.
    ["chore/bump-deps"],
    // No slash, so no segment to read — a bare branch name is not a number.
    ["main"],
    ["driveorph-3559-work"],
    // The number is not the FIRST segment. Losing the `^` anchor would find
    // `fix/99` inside this and misattribute the commit.
    ["wip/fix/99-nested"],
    // A leading zero is not an issue number; `[1-9]` must not widen to `[0-9]`.
    ["fix/0912-leading-zero"],
    // `issue-<n>` is knowingly not read — recorded as a decision, not an
    // oversight, so a later reader does not "fix" it by accident.
    ["codex/issue-1264"],
    // Empty and slash-only inputs must not throw.
    [""],
    ["/"],
  ])("declines %s", branch => {
    expect(githubBranchIssue(branch, CONTRACT)).toBeUndefined();
  });

  it("canonicalizes against the configured repository, not the branch", () => {
    // The number comes from the branch; the owner/repo must come from the
    // contract, or a reference could be minted for a repository nobody
    // configured.
    expect(
      githubBranchIssue("fix/7-x", {
        provider: "github",
        repository: "other/repo",
      })
    ).toBe("other/repo#7");
  });
});

/**
 * The two gates that live OUTSIDE the commits — gate 4 (the `Work-Item:` line
 * in the pull-request BODY) and gate 5 (the managed backlink on the item) —
 * and what happens at the two moments they are reachable.
 *
 * A push cannot check either one, because both are properties of a pull
 * request and the push is what makes the pull request possible. The old
 * behaviour reported that as `WORK_ITEM_TRACKING_OK` with the reason appended,
 * which is a finding delivered inside a success: the push exited 0, the branch
 * landed, and CI went red on requirements nobody was asked to resolve
 * (CodySwannGT/lisa#3791).
 */
describe("deferred gates 4 and 5 (#3791)", () => {
  const PR_URL = "https://github.com/acme/code/pull/7";

  /** Seed a bound branch on a published base, and return its tracked head. */
  function trackedPush(fixture: Fixture): { base: string; head: string } {
    const base = publishedBase(fixture);
    setOriginHead(fixture);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    return { base, head };
  }

  /** A fake `gh pr view` payload for a pull request over the given commits. */
  function prPayload(body: string, oids: string[]): string {
    return JSON.stringify({
      body,
      commits: oids.map(oid => ({ oid })),
      state: "OPEN",
      url: PR_URL,
    });
  }

  /** The issue payload once the managed backlink comment exists on it. */
  function issueWithBacklink(): string {
    return JSON.stringify({
      closedByPullRequestsReferences: [],
      comments: [{ body: `[lisa-pr-link] ${PR_URL}` }],
      labels: [
        { name: "repo:identity" },
        { name: "status:in-progress" },
        { name: "type:Bug" },
      ],
      number: 42,
      state: "OPEN",
      url: "https://github.com/acme/widgets/issues/42",
    });
  }

  it("reports a push that could not check gates 4 and 5 as incomplete, not OK", () => {
    const fixture = createFixture();
    const { base, head } = trackedPush(fixture);

    const pushed = pushRange(fixture, base, head);

    // Exit 0 on purpose and stated as such: a pull request cannot exist for a
    // branch the remote has never seen, so refusing here would make the first
    // push of every branch impossible. What changes is the report.
    expect(pushed.status).toBe(0);
    expect(pushed.stdout).not.toContain("WORK_ITEM_TRACKING_OK");
    expect(pushed.stdout).toContain(
      "WORK_ITEM_TRACKING_INCOMPLETE 1 commit(s)"
    );
    expect(pushed.stdout).toContain("2 of 5 gates NOT CHECKED");
    expect(pushed.stdout).toContain("UNRESOLVED gate 4");
    expect(pushed.stdout).toContain("UNRESOLVED gate 5");
    // The remedy is named, not described: an open item with no command against
    // it is a complaint.
    expect(pushed.stdout).toContain(
      "node scripts/lisa-work-item.mjs discharge-pr-gates"
    );
    // The exact line the body needs, so gate 4 is satisfiable by copying it.
    expect(pushed.stdout).toContain("Work-Item: acme/widgets#42");
  });

  it("keeps gate 5 off the checklist under the trailer level, where it is not required", () => {
    const fixture = createFixture({
      ...githubConfig(),
      workItem: { verify: "trailer" },
    });
    const { base, head } = trackedPush(fixture);

    const pushed = pushRange(fixture, base, head);

    expect(pushed.status).toBe(0);
    expect(pushed.stdout).toContain("UNRESOLVED gate 4");
    expect(pushed.stdout).not.toContain("UNRESOLVED gate 5");
    expect(pushed.stdout).toContain('workItem.verify is "trailer"');
  });

  it("separates a range with nothing to trace from one whose gates went unchecked", () => {
    const fixture = createFixture();
    const base = publishedBase(fixture);
    setOriginHead(fixture);
    const head = commit(fixture, `chore(release): 1.2.3 [skip${" "}ci]`);

    const pushed = pushRange(fixture, base, head);

    // A release commit has no work item for a body to declare or a tracker to
    // link. Those gates have NOTHING to check, which is a different fact from
    // something unchecked — and putting an unresolvable item on every release
    // push is how a checklist teaches its reader to skip it.
    expect(pushed.status).toBe(0);
    expect(pushed.stdout).toContain("WORK_ITEM_TRACKING_OK 0 commit(s)");
    expect(pushed.stdout).toContain("names no work item");
    expect(pushed.stdout).not.toContain("UNRESOLVED");
  });

  it("discharges both gates at the pull request, posting the backlink itself", () => {
    const fixture = createFixture();
    const { head } = trackedPush(fixture);
    const log = path.join(fixture.root, "gh.log");

    // The item carries NO backlink until this command writes one, and the fake
    // tracker only starts reporting it once the write has happened. That is
    // what makes gate 5 depend on the posting AND on the re-read: the payload
    // cached by the first pass predates the comment, so validating against it
    // would report a backlink missing that this command had just created.
    const discharged = command(fixture, ["discharge-pr-gates"], {
      env: {
        FAKE_GH_ISSUE_AFTER_POST_JSON: issueWithBacklink(),
        FAKE_GH_LOG: log,
        FAKE_GH_POSTED_FILE: path.join(fixture.root, "posted"),
        FAKE_GH_PR_JSON: prPayload("Work-Item: acme/widgets#42", [head]),
      },
    });

    expect(discharged.stderr).toBe("");
    expect(discharged.status).toBe(0);
    expect(discharged.stdout).toContain("work-item backlink created");
    expect(discharged.stdout).toContain(
      "gates 4 and 5 discharged at the pull request"
    );
    // The positive control for the posting half. Asserting only on the printed
    // word would pass for a command that reported a write it never made.
    expect(readFileSync(log, "utf8")).toContain("api --method POST");
  });

  it("refuses a pull request body that references the item without declaring it", () => {
    const fixture = createFixture();
    const { head } = trackedPush(fixture);

    // `Refs #42` is the repository's own non-closing convention, and it is
    // exactly what gate 4 does not accept. Catching it here is the whole point:
    // this is the same refusal CI issues, one cycle earlier.
    const discharged = command(fixture, ["discharge-pr-gates"], {
      env: {
        FAKE_GH_ISSUE_JSON: issueWithBacklink(),
        FAKE_GH_PR_JSON: prPayload("Refs #42", [head]),
      },
    });

    expect(discharged.status).toBe(1);
    expect(discharged.stderr).toContain(
      "No Work-Item trailer anywhere in the pull request body"
    );
  });

  it("finds the branch's pull request, so a declared push checks all five gates", () => {
    // `gh pr view --repo <r>` with no positional argument is a usage error, so
    // the lookup that asked that way exited 1 and every push read "no pull
    // request exists" — including the ones that had one. That turned the
    // deferral this ticket is about from a first-push condition into the
    // permanent state of every push in the repository.
    const fixture = createFixture();
    const base = publishedBase(fixture);
    setOriginHead(fixture);
    const head = commit(
      fixture,
      "feat: tracked change\n\nWork-Item: acme/widgets#42"
    );
    const log = path.join(fixture.root, "gh.log");

    const pushed = command(fixture, ["validate-push", "origin"], {
      env: {
        FAKE_GH_ISSUE_JSON: issueWithBacklink(),
        FAKE_GH_LOG: log,
        FAKE_GH_PR_JSON: prPayload("Work-Item: acme/widgets#42", [head]),
      },
      input: `refs/heads/feature/tracked ${head} refs/heads/feature/tracked ${base}\n`,
    });

    expect(pushed.status).toBe(0);
    expect(pushed.stdout).toContain("WORK_ITEM_TRACKING_OK 1 commit(s)");
    expect(pushed.stdout).toContain("PR body, and tracker backlink");
    expect(pushed.stdout).not.toContain("WORK_ITEM_TRACKING_INCOMPLETE");
    // The shape of the lookup is the subject, not an implementation detail:
    // the fake refuses the flag combination exactly as real `gh` does, so a
    // caller that reintroduces it fails here rather than in a year of pushes
    // that silently checked three gates out of five.
    expect(readFileSync(log, "utf8")).toContain("pr view --json");
  });

  it("answers 3 rather than 1 when there is no pull request to discharge", () => {
    const fixture = createFixture();
    trackedPush(fixture);

    const discharged = command(fixture, ["discharge-pr-gates"], {
      env: { FAKE_GH_PR_MISSING: "1" },
    });

    // Not a violation: nothing was found wanting, there was nothing to check.
    // A caller that fires this automatically after any `gh pr` command — the
    // PostToolUse hook does, including after ones that failed — has only the
    // status to go on, so the two answers may not share a code.
    expect(discharged.status).toBe(3);
    expect(discharged.stderr).toContain("no pull request for this branch");
  });

  it("contacts no tracker under the trailer level, and still checks gate 4", () => {
    const fixture = createFixture({
      ...githubConfig(),
      workItem: { verify: "trailer" },
    });
    const { head } = trackedPush(fixture);
    const log = path.join(fixture.root, "gh.log");

    const discharged = command(fixture, ["discharge-pr-gates"], {
      env: {
        FAKE_GH_LOG: log,
        FAKE_GH_PR_JSON: prPayload("Work-Item: acme/widgets#42", [head]),
      },
    });

    expect(discharged.status).toBe(0);
    expect(discharged.stdout).not.toContain("work-item backlink");
    expect(readFileSync(log, "utf8")).not.toContain("api --method");
  });
});

/**
 * The wording of the incomplete-push report, asserted in-process.
 *
 * The subprocess cases above prove the WIRING — that a push with no pull
 * request reaches this report rather than a success line. They cannot prove
 * the WORDS: the push path runs the validator as a child, so a mutation run
 * records no coverage for anything inside it and scores every line of this
 * text as unreached. These cases are what make the text load-bearing, and the
 * text IS the fix (CodySwannGT/lisa#3791) — a checklist whose remedy line went
 * missing would leave exactly the finding-with-no-action the ticket is about.
 */
describe("unresolvedPushReport wording (#3791)", () => {
  const FULL = {
    lifecycle: { claimed: "status:in-progress", ready: "status:ready" },
    verify: "full",
  };
  const TRAILER = { ...FULL, verify: "trailer" };

  /**
   * A commit-side result naming the given work items.
   * @param refs - Work items the range carries.
   * @param overrides - Fields to replace on the synthetic result.
   */
  function result(
    refs: string[],
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      contract: FULL,
      protectedExempt: 0,
      refs,
      relevant: refs.length,
      ...overrides,
    };
  }

  it("opens with a token that is not a pass, and counts what went unchecked", () => {
    const report = unresolvedPushReport(result(["acme/widgets#42"]), "");

    expect(report.startsWith("WORK_ITEM_TRACKING_INCOMPLETE")).toBe(true);
    expect(report).not.toContain("WORK_ITEM_TRACKING_OK");
    expect(report).toContain("1 commit(s)");
    expect(report).toContain("gates 1-3 proved here, 2 of 5 gates NOT CHECKED");
  });

  it("names both unmet gates, the line that satisfies gate 4, and the remedy", () => {
    const report = unresolvedPushReport(result(["acme/widgets#42"]), "");

    expect(report).toContain("UNRESOLVED gate 4");
    expect(report).toContain("UNRESOLVED gate 5");
    expect(report).toContain("on its own line:");
    expect(report).not.toContain("on its own lines:");
    expect(report).toContain("Work-Item: acme/widgets#42");
    expect(report).toContain("`Refs #n` and `Closes #n` do NOT satisfy it.");
    expect(report).toContain(
      "Discharge both the moment the pull request exists — it evaluates them and"
    );
    expect(report).toContain(
      "posts what it can, so neither waits for CI to reveal it:"
    );
    expect(report).toContain("[lisa-pr-link]");
    expect(report).toContain(
      "node scripts/lisa-work-item.mjs discharge-pr-gates"
    );
    // The five-gate checklist still travels with it: this report replaces the
    // success line, and dropping the summary would trade one omission for
    // another.
    expect(report).toContain("All five gates, and when each one bites:");
  });

  it("states gate 5 as inapplicable under the trailer level, not as open work", () => {
    const report = unresolvedPushReport(
      result(["acme/widgets#42"], { contract: TRAILER }),
      ""
    );

    expect(report).toContain("UNRESOLVED gate 4");
    expect(report).not.toContain("UNRESOLVED gate 5");
    expect(report).toContain("n/a         gate 5");
    expect(report).toContain('workItem.verify is "trailer"');
  });

  it("declares every item a multi-item range names, one line each", () => {
    const report = unresolvedPushReport(
      result(["acme/widgets#42", "acme/widgets#43"]),
      ""
    );

    expect(report).toContain("on its own lines:");
    // One line each, indented to the same column — a body that has to be
    // copied out of this report needs the shape, not just the two strings.
    expect(report).toContain(
      "Work-Item: acme/widgets#42\n     Work-Item: acme/widgets#43"
    );
    expect(report).toContain(
      "not a clean bill of health for acme/widgets#42, acme/widgets#43"
    );
    expect(report).toContain("This range names 2 work items");
  });

  it("carries the ref label and the already-traced count when there is one", () => {
    const report = unresolvedPushReport(
      result(["acme/widgets#42"], { protectedExempt: 3 }),
      "refs/heads/feature/x: "
    );

    expect(report).toContain(
      "WORK_ITEM_TRACKING_INCOMPLETE refs/heads/feature/x: 1 commit(s)"
    );
    expect(report).toContain("3 already on a deploy-chain branch");
  });
});

/**
 * The two halves of the discharge that are values rather than round trips.
 *
 * `discharge-pr-gates` itself is only reachable through a spawned child, so a
 * mutation run sees no coverage for anything it decides. These two are the
 * decisions worth pinning in-process: the exit code that separates "nothing to
 * check" from "a requirement is unmet", and the answer that decides whether
 * gate 5 is verified against a payload fetched BEFORE the backlink was written.
 */
describe("discharge decisions (#3791)", () => {
  const FULL = { provider: "github", verify: "full" };
  const TRAILER = { provider: "github", verify: "trailer" };
  const PR = "https://github.com/acme/code/pull/7";

  it("answers 3 for a missing pull request, which is not a violation code", () => {
    const error = noPullRequestToDischarge() as Error & {
      exitCode?: number;
      selfExplanatory?: boolean;
    };

    // 1 would tell a caller that a work-item requirement was found unmet. No
    // requirement was even evaluated.
    expect(error.exitCode).toBe(3);
    expect(error.selfExplanatory).toBe(true);
    expect(error.message).toContain("no pull request for this branch");
    expect(error.message).toContain(
      "Open the pull request, then run it again."
    );
  });

  it("reports a write as a change, so the verification re-reads the tracker", () => {
    const posted: string[] = [];

    const changed = postDischargeBacklinks(
      ["acme/widgets#42", "acme/widgets#43"],
      PR,
      FULL,
      (ref: string) => {
        posted.push(ref);
        return ref.endsWith("42") ? "unchanged" : "created";
      }
    );

    expect(posted).toEqual(["acme/widgets#42", "acme/widgets#43"]);
    // One unchanged and one created is still a change: verifying gate 5 against
    // the payload cached before that write would report the backlink missing.
    expect(changed).toBe(true);
  });

  it("reports no change when every backlink was already correct", () => {
    const changed = postDischargeBacklinks(["acme/widgets#42"], PR, FULL, () =>
      String("unchanged")
    );

    expect(changed).toBe(false);
  });

  it("writes nothing under the trailer level, which contacts no tracker", () => {
    const posted: string[] = [];

    const changed = postDischargeBacklinks(
      ["acme/widgets#42"],
      PR,
      TRAILER,
      (ref: string) => {
        posted.push(ref);
        return "created";
      }
    );

    expect(posted).toEqual([]);
    expect(changed).toBe(false);
  });
});
