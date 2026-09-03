/**
 * Drive the work-item guard IN-PROCESS, inside a disposable repository.
 *
 * The sibling suites of `tests/unit/scripts/lisa-work-item.test.ts` spawn
 * `scripts/lisa-work-item.mjs` and assert on what the child printed. That
 * coverage is real and stays exactly as it is — a subprocess is the only way to
 * prove things like "a child that ignores SIGTERM is still killed". But it is
 * invisible to the mutation gate, which credits a kill only when the mutated
 * module is loaded in the TEST's own process.
 *
 * This harness closes that gap. Same disposable repository and same fake
 * tracker transports, but `runCli()` is called directly, so every branch it
 * walks is a branch the gate can see.
 *
 * Driving the CLI rather than the internals is deliberate. Almost nothing in
 * that file is exported, and exporting sixty private helpers to satisfy a score
 * would trade a readable guard for a number. `runCli` is a seam that already
 * exists, for the thin entrypoint at `scripts/lisa-work-item.mjs`.
 * @module tests/support/work-item-cli
 */
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { vi } from "vitest";

import {
  resetGhVersionCheck,
  runCli,
} from "../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../helpers/test-utils.js";
import { resolveGit } from "./git-executable.js";

/** Canonical reference every fixture is built around. */
export const REF = "acme/widgets#42";

/** A second, valid-but-different reference, for mismatch cases. */
export const OTHER_REF = "acme/widgets#43";

/** The pull request the fixtures link to. */
export const PR_URL = "https://github.com/acme/code/pull/7";

/** The marker on Lisa's managed backlink comment. */
export const MARKER = "[lisa-pr-link]";

/** The lifecycle role a claimed GitHub item carries by default. */
export const CLAIMED = "status:in-progress";

const GIT = resolveGit();
const SHARED_FILE = "shared.txt";
const IDENTITY = {
  GIT_AUTHOR_EMAIL: "lisa@example.test",
  GIT_AUTHOR_NAME: "Lisa Test",
  GIT_COMMITTER_EMAIL: "lisa@example.test",
  GIT_COMMITTER_NAME: "Lisa Test",
};

/** What one in-process CLI invocation produced. */
export interface Outcome {
  exitCode: number | undefined;
  stderr: string;
  stdout: string;
}

/** Disposable repository and the environment the CLI sees inside it. */
export interface Fixture {
  env: Record<string, string | undefined>;
  root: string;
}

const created: string[] = [];
const templates = new Map<string, string>();

/**
 * Remove every fixture this harness made. Call from `afterEach`.
 *
 * Templates are deliberately NOT removed here — they are the thing being
 * reused. They live in the OS temp directory and go when the process does.
 */
export function cleanupFixtures(): void {
  for (const root of created.splice(0))
    rmSync(root, { force: true, recursive: true });
}

/**
 * Remove the cached template repositories. Call from `afterAll`.
 */
export function cleanupTemplates(): void {
  for (const root of templates.values())
    rmSync(root, { force: true, recursive: true });
  templates.clear();
}

/**
 * Write an executable fake CLI.
 * @param file - Where the script goes.
 * @param body - Shell body, after the shebang and `set -eu`.
 */
function executable(file: string, body: string): void {
  writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Run real Git inside a disposable fixture.
 * @param root - Repository root.
 * @param args - Git arguments.
 * @param env - Environment for the child.
 * @returns Trimmed stdout.
 */
export function git(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv
): string {
  const result = boundedSpawnSync({
    label: `git ${args.join(" ")}`,
    command: GIT,
    args,
    cwd: root,
    env,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

/**
 * The minimal GitHub tracker config.
 * @param verify - Verification level the project declares.
 * @param repository - The `github.repo` short name.
 * @returns A config object ready to be written as `.lisa.config.json`.
 */
export function githubConfig(verify = "full", repository = "widgets"): object {
  return {
    github: { org: "acme", repo: repository },
    tracker: "github",
    workItem: { verify },
  };
}

/**
 * A claimed, open, leaf GitHub issue payload.
 * @param overrides - Fields to replace on the default payload.
 * @returns The payload as JSON text, ready for `FAKE_GH_ISSUE_JSON`.
 */
export function issueJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    closedByPullRequestsReferences: [],
    comments: [],
    labels: [{ name: CLAIMED }, { name: "type:Bug" }],
    number: 42,
    state: "OPEN",
    url: "https://github.com/acme/widgets/issues/42",
    ...overrides,
  });
}

const GH_SCRIPT = `
if [ -n "\${FAKE_GH_LOG:-}" ]; then printf '%s\\n' "$*" >> "$FAKE_GH_LOG"; fi
case "\${1:-}" in
  --version) printf 'gh version %s (2026-01-01)\\n' "\${FAKE_GH_VERSION:-2.80.0}"; exit 0 ;;
esac
case "\${1:-} \${2:-}" in
  "issue view")
    [ "\${FAKE_GH_ISSUE_FAIL:-0}" != "1" ] || { echo "\${FAKE_GH_STDERR:-gone}" >&2; exit 1; }
    # Successive reads may differ. A completion readback is only INDEPENDENT if
    # it is a fresh read, and a fake that answers every read identically cannot
    # tell an independent readback apart from one that echoed the write's own
    # output. Staging a divergent second answer is what makes the difference
    # observable. Counted the same way the curl fake counts, so there is one
    # idiom here rather than two.
    ISSUE_JSON=$FAKE_GH_ISSUE_JSON
    if [ -n "\${FAKE_GH_ISSUE_COUNT_FILE:-}" ]; then
      ISSUE_COUNT=0
      [ ! -f "$FAKE_GH_ISSUE_COUNT_FILE" ] || ISSUE_COUNT=$(cat "$FAKE_GH_ISSUE_COUNT_FILE")
      case "$ISSUE_COUNT" in
        0) ISSUE_JSON=\${FAKE_GH_ISSUE_JSON_1:-$ISSUE_JSON} ;;
        1) ISSUE_JSON=\${FAKE_GH_ISSUE_JSON_2:-$ISSUE_JSON} ;;
        *) ISSUE_JSON=\${FAKE_GH_ISSUE_JSON_3:-$ISSUE_JSON} ;;
      esac
      printf '%s\\n' "$((ISSUE_COUNT + 1))" > "$FAKE_GH_ISSUE_COUNT_FILE"
    fi
    printf '%s\\n' "$ISSUE_JSON" ;;
  "issue list") printf '%s\\n' "\${FAKE_GH_LIST_JSON:-[]}" ;;
  "issue edit") printf 'edited\\n' ;;
  "issue close") printf 'closed\\n' ;;
  "api graphql") printf '%s\\n' "$FAKE_GH_HIERARCHY_JSON" ;;
  "pr view")
    [ "\${FAKE_GH_PR_MISSING:-0}" != "1" ] || exit 1
    printf '%s\\n' "$FAKE_GH_PR_JSON" ;;
  "repo view") printf '%s\\n' '{"nameWithOwner":"acme/code"}' ;;
  "api --paginate") printf '%s\\n' "\${FAKE_GH_COMMENTS_JSON:-[]}" ;;
  "api --method") printf '%s\\n' '{"id":1}' ;;
  *)
    case "$*" in
      # Per-issue timelines, so a sweep over several items can give a different
      # answer for each. Without this every issue looks equally drifted and
      # "closes ONLY the drifted ones" is unassertable.
      *issues/43/timeline*) printf '%s\\n' "\${FAKE_GH_TIMELINE_43_JSON:-[]}" ;;
      *timeline*) printf '%s\\n' "\${FAKE_GH_TIMELINE_JSON:-[]}" ;;
      # The pulls read: gh api repos/OWNER/NAME/pulls/N --jq .base.ref, which
      # answers the branch a merged pull request landed on and so decides which
      # lifecycle role it earned. Per-pull-request, so a case can stage a stack
      # merge and a production merge against the same item.
      # Plain \${VAR-default}, NOT \${VAR:-default}: a case that stages an EMPTY
      # base is staging a real answer — a base the read could not resolve — and
      # the colon form would silently replace it with the default, so the
      # unresolvable-base case would test the resolvable one.
      *pulls/8*) printf '%s\\n' "\${FAKE_GH_PR_BASE_8-main}" ;;
      *pulls/*) printf '%s\\n' "\${FAKE_GH_PR_BASE-main}" ;;
      *) echo "unexpected gh invocation: $*" >&2; exit 70 ;;
    esac ;;
esac`;

/**
 * A pristine repository for one config, built once and then copied.
 *
 * Five `git` subprocesses per test is affordable in a normal run and ruinous
 * under the mutation gate, which re-runs the covering tests once per mutant:
 * the same fixture work is paid thousands of times, and the gate's wall clock
 * is what decides whether it can stay a required check. Building each distinct
 * repository once and copying it is a filesystem walk with no process spawn at
 * all.
 * @param config - What to write as `.lisa.config.json`.
 * @returns Path of the template repository.
 */
function template(config: object): string {
  const key = JSON.stringify(config);
  const cached = templates.get(key);
  if (cached !== undefined) return cached;
  const root = mkdtempSync(path.join(tmpdir(), "lisa-wi-template-"));
  const env = cleanGitEnv(process.env, IDENTITY);
  const bin = path.join(root, "fake-bin");
  mkdirSync(bin);
  executable(path.join(bin, "gh"), GH_SCRIPT);
  // The default is assigned on its own line rather than written
  // `"${FAKE_CURL_JSON:-{}}"`. That form does NOT mean "default to {}": the
  // expansion ends at the first `}`, so the default is `{` and a stray `}` is
  // appended to every answer the fake gives — including the ones a case set
  // explicitly. A fixture staging `{"data":{"issue":null}}` was answered with a
  // trailing brace and the guard reported "malformed JSON", which is a fault in
  // the harness wearing the tracker's clothes.
  executable(
    path.join(bin, "curl"),
    `
[ "\${FAKE_CURL_FAIL:-0}" != "1" ] || exit 1
JSON=\${FAKE_CURL_JSON:-}
if [ -n "\${FAKE_CURL_COUNT_FILE:-}" ]; then
  COUNT=0
  [ ! -f "$FAKE_CURL_COUNT_FILE" ] || COUNT=$(cat "$FAKE_CURL_COUNT_FILE")
  case "$COUNT" in
    0) JSON=\${FAKE_CURL_JSON_1:-$JSON} ;;
    1) JSON=\${FAKE_CURL_JSON_2:-$JSON} ;;
    *) JSON=\${FAKE_CURL_JSON_3:-$JSON} ;;
  esac
  printf '%s\\n' "$((COUNT + 1))" > "$FAKE_CURL_COUNT_FILE"
fi
[ -n "$JSON" ] || JSON='{}'
printf '%s\\n' "$JSON"`
  );
  git(root, ["init", "-q", "-b", "main"], env);
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    `${JSON.stringify(config, null, 2)}\n`
  );
  git(root, ["add", ".lisa.config.json"], env);
  git(root, ["commit", "-q", "-m", "test fixture"], env);
  git(root, ["switch", "-q", "-c", "feature/tracked"], env);
  templates.set(key, root);
  return root;
}

/**
 * Create an initialized repository whose tracker transports are all fakes.
 *
 * Every fake reads its answer from the environment, so a case changes what the
 * tracker says by setting a variable rather than by rewriting a script. The
 * repository starts on `feature/tracked`, one commit deep on `main`.
 * @param config - What to write as `.lisa.config.json`.
 * @returns The fixture.
 */
export function createFixture(config: object = githubConfig()): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-wi-inproc-"));
  cpSync(template(config), root, { preserveTimestamps: true, recursive: true });
  created.push(root);
  return {
    env: cleanGitEnv(process.env, {
      ...IDENTITY,
      FAKE_GH_HIERARCHY_JSON:
        '{"data":{"repository":{"issue":{"subIssues":{"nodes":[]}}}}}',
      FAKE_GH_ISSUE_JSON: issueJson(),
      FAKE_GH_PR_JSON: JSON.stringify({
        body: `Work-Item: ${REF}`,
        state: "OPEN",
        url: PR_URL,
      }),
      GITHUB_REPOSITORY: "acme/code",
      PATH: `${path.join(root, "fake-bin")}:${process.env.PATH ?? ""}`,
    }),
    root,
  };
}

/**
 * A fixture that contacts no tracker.
 *
 * `full` verification buys three extra subprocesses on every command — the `gh`
 * version probe, the issue read, the sub-issue page — and the mutation gate
 * pays that again for every mutant each covering test touches. A case whose
 * subject is the binding file or the argument parser should not be buying the
 * tracker's answer; the cases whose subject IS the tracker's answer ask for
 * `full` explicitly, and are the only ones that should.
 * @returns A fixture declaring `workItem.verify` = "trailer".
 */
export function offlineFixture(): Fixture {
  return createFixture(githubConfig("trailer"));
}

/**
 * Add one empty fixture commit and return its object ID.
 * @param fixture - The repository to commit in.
 * @param message - The commit message.
 * @returns The new commit's object ID.
 */
export function commit(fixture: Fixture, message: string): string {
  git(
    fixture.root,
    ["commit", "-q", "--allow-empty", "-m", message],
    fixture.env
  );
  return git(fixture.root, ["rev-parse", "HEAD"], fixture.env);
}

/**
 * Drive a REAL `git rebase main` of a branch into a conflicted stop.
 *
 * The branch and `main` both rewrite the same file, so the rebase wedges
 * mid-flight with HEAD detached and `rebase-merge/head-name` naming the branch
 * — the state a `git rebase --continue` runs in, and the one the binding used
 * to have no way out of.
 * @param fixture - The repository to wedge.
 * @param branch - The branch being rebased.
 */
export function wedgeRebase(fixture: Fixture, branch: string): void {
  const shared = path.join(fixture.root, SHARED_FILE);
  writeFileSync(shared, `${branch} change\n`);
  git(fixture.root, ["add", SHARED_FILE], fixture.env);
  git(fixture.root, ["commit", "-q", "-m", "feat: branch change"], fixture.env);
  git(fixture.root, ["switch", "-q", "main"], fixture.env);
  writeFileSync(shared, "main change\n");
  git(fixture.root, ["add", SHARED_FILE], fixture.env);
  git(fixture.root, ["commit", "-q", "-m", "chore: base change"], fixture.env);
  git(fixture.root, ["switch", "-q", branch], fixture.env);
  if (
    boundedSpawnSync({
      label: "git rebase main",
      command: GIT,
      args: ["rebase", "main"],
      cwd: fixture.root,
      env: fixture.env,
    }).status === 0
  )
    throw new Error("expected the rebase to stop on a conflict");
  if (git(fixture.root, ["branch", "--show-current"], fixture.env) !== "")
    throw new Error("expected the wedged rebase to leave HEAD detached");
}

/**
 * The binding file this worktree would use.
 *
 * Computed rather than asked of `git rev-parse --git-path`, because every
 * fixture here is a plain checkout where the answer is always `.git/lisa/…`,
 * and a subprocess per assertion is a cost the mutation gate pays per mutant.
 * The case where the two answers DIFFER — a linked worktree, whose private
 * state lands in `.git/worktrees/<name>/lisa/` — is not skipped: it is proven
 * by the subprocess suite, which builds a real linked worktree and resolves the
 * path the same way the guard does.
 * @param fixture - The repository to ask.
 * @returns Absolute path of the work-item binding file.
 */
export function stateFile(fixture: Fixture): string {
  return path.join(fixture.root, ".git", "lisa", "work-item.json");
}

/**
 * Put a binding in place without driving the CLI to create one.
 *
 * Used where an existing binding is the test's PREMISE rather than its subject.
 * Running `link` to establish one costs three more subprocesses and adds the
 * whole binding path to the covering-test set of every mutant the case touches
 * — which the mutation gate then re-runs, per mutant, for a step the case is
 * not asserting on. The cases whose subject IS `link` still call it.
 * @param fixture - The repository to bind.
 * @param ref - Canonical work-item reference.
 * @param branch - Branch to record; null leaves it pending attachment.
 * @param provider - Provider to record.
 */
export function bindTo(
  fixture: Fixture,
  ref: string,
  branch: string | null = "feature/tracked",
  provider = "github"
): void {
  const file = stateFile(fixture);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ branch, provider, ref, version: 1 })}\n`
  );
}

/**
 * Swap the ambient process state a CLI run reads, and put it all back.
 *
 * The fixture is selected with `GIT_DIR`/`GIT_WORK_TREE` rather than by
 * changing directory, and that is not a stylistic choice: Stryker's vitest
 * runner pins the THREADS pool, where `process.chdir()` throws outright. A
 * harness built on `chdir` passes under `bun run test` (forks) and takes the
 * whole mutation gate down in the dry run, which is the loudest possible
 * version of a suite that cannot run where it is needed. Pointing git at the
 * fixture is how git hooks address a repository anyway, so every path the guard
 * derives — the toplevel, the private state dir, the current branch — resolves
 * to the fixture from any working directory.
 *
 * `process.exitCode` in particular has to be restored: `runCli` sets it on a
 * refusal, and leaving it set would fail the whole vitest run on behalf of a
 * test that asserted a refusal and passed. Bun does not clear a nonzero exit
 * code when it is assigned `undefined`, so the harness resets it to zero and
 * normalizes zero back to the unset outcome exposed to callers.
 * @param fixture - The repository to run inside.
 * @param args - Argument vector after the script name.
 * @param overrides - Environment entries layered over the fixture's.
 * @returns What the run printed and the exit code it set.
 */
export function cli(
  fixture: Fixture,
  args: string[],
  overrides: Record<string, string> = {}
): Outcome {
  const savedArgv = process.argv;
  const savedEnv = { ...process.env };
  const savedExit = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts) => {
    stdout.push(parts.map(String).join(" "));
  });
  const error = vi.spyOn(console, "error").mockImplementation((...parts) => {
    stderr.push(parts.map(String).join(" "));
  });
  try {
    replaceEnv({
      ...fixture.env,
      GIT_DIR: path.join(fixture.root, ".git"),
      GIT_WORK_TREE: fixture.root,
      ...overrides,
    });
    process.argv = [process.execPath, "lisa-work-item.mjs", ...args];
    process.exitCode = 0;
    resetGhVersionCheck();
    runCli();
    return {
      exitCode: process.exitCode === 0 ? undefined : process.exitCode,
      stderr: stderr.join("\n"),
      stdout: stdout.join("\n"),
    };
  } finally {
    log.mockRestore();
    error.mockRestore();
    process.argv = savedArgv;
    replaceEnv(savedEnv);
    process.exitCode = savedExit ?? 0;
    resetGhVersionCheck();
  }
}

/**
 * Replace `process.env` wholesale, so a variable a case did not set is absent
 * rather than inherited.
 * @param next - The environment to install.
 */
function replaceEnv(next: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(next))
    if (value !== undefined) process.env[key] = value;
}
