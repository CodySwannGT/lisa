/**
 * Tests for the worktree-binding guard.
 *
 * The defect (CodySwannGT/lisa#3864) is three subsystems disagreeing about
 * which worktree a session is in while the one reporting success is the one
 * that is wrong. `EnterWorktree` said the session had moved, Bash kept running
 * in the previous worktree, and Edit refused the destination by name. A
 * refusal teaches you something; a false success is a confirmation, and it is
 * acted on.
 *
 * WHY THE REFUSING CASES ARE THE POINT. A suite that only proves the guard
 * stays quiet when everything agrees passes today against a guard that does
 * nothing at all — the state under test is the one where the harness lies, and
 * it has to be constructed deliberately. Every accepting case below is
 * therefore paired with the refusal it would have been had one fact changed,
 * and the acknowledgement cases exist so that "the block can be cleared" and
 * "the block clears itself" are told apart.
 * @module tests/unit/hooks/worktree-binding-guard
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";

const GUARD_PATH = path.resolve(
  "plugins/src/base/hooks/worktree-binding-guard.mjs"
);
const GIT_PATH = resolveGit();

/** Claude's refusal code. Anything else lets the tool call through. */
const BLOCKED = 2;
const ALLOWED = 0;

const SESSION = "session-under-test";
/** Git's quiet flag, named because the fixture repeats it. */
const QUIET = "-q";
/** This guard's spawn label, named because every case spawns it. */
const GUARD_LABEL = "worktree-binding-guard";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/** Absolute paths of one fixture repository and its two linked worktrees. */
interface Fixture {
  /** The main checkout. */
  readonly main: string;
  /** The worktree a session binds to first. */
  readonly a: string;
  /** The worktree it is told, falsely, that it moved to. */
  readonly b: string;
  /** Where the guard keeps its per-session binding. */
  readonly state: string;
}

/**
 * Run git in a fixture directory, failing loudly on a non-zero exit.
 * @param cwd - Directory to run in
 * @param args - Git arguments
 */
function git(cwd: string, args: readonly string[]): void {
  const result = boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT_PATH,
    args: [...args],
    cwd,
    env: cleanGitEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/**
 * A repository with two linked worktrees and an empty guard state directory.
 * @returns Absolute paths of the fixture pieces
 */
function buildFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-wtb-"));
  const main = path.join(root, "main");
  const state = path.join(root, "state");
  const a = path.join(root, "wt-a");
  const b = path.join(root, "wt-b");

  tempDirs.push(root);
  git(root, ["init", QUIET, "main"]);
  git(main, ["config", "user.email", "t@example.invalid"]);
  git(main, ["config", "user.name", "Test"]);
  writeFileSync(path.join(main, "seed.txt"), "seed\n");
  git(main, ["add", "seed.txt"]);
  git(main, ["commit", QUIET, "-m", "seed"]);
  git(main, ["worktree", "add", QUIET, "-b", "branch-a", a]);
  git(main, ["worktree", "add", QUIET, "-b", "branch-b", b]);

  return { main, a, b, state };
}

/** One hook envelope: what the session is about to do, and from where. */
interface Call {
  readonly cwd: string;
  readonly tool?: string;
  readonly input?: Record<string, unknown>;
  readonly session?: string;
  readonly state: string;
}

/**
 * Feed one hook envelope to the guard.
 * @param call - What the session is about to do, and from where
 * @returns The completed spawn result
 */
function runGuard(call: Call) {
  const payload = {
    session_id: call.session ?? SESSION,
    cwd: call.cwd,
    tool_name: call.tool ?? "Bash",
    tool_input: call.input ?? { command: "echo hello" },
  };
  return boundedSpawnSync({
    label: GUARD_LABEL,
    command: process.execPath,
    args: [GUARD_PATH],
    cwd: call.cwd,
    env: { ...cleanGitEnv(), LISA_STATE_HOME: call.state },
    input: JSON.stringify(payload),
  });
}

/**
 * Feed a raw envelope, for the malformed-input cases.
 * @param raw - Exact stdin bytes
 * @param cwd - Directory to run the guard in
 * @param state - Guard state home
 * @returns The completed spawn result
 */
function runRaw(raw: string, cwd: string, state: string) {
  return boundedSpawnSync({
    label: GUARD_LABEL,
    command: process.execPath,
    args: [GUARD_PATH],
    cwd,
    env: { ...cleanGitEnv(), LISA_STATE_HOME: state },
    input: raw,
  });
}

/**
 * Bind the session to a worktree, the way its first tool call would.
 * @param fixture - The repository under test
 * @param worktree - Worktree the session is to be bound to
 */
function bindTo(fixture: Fixture, worktree: string): void {
  expect(runGuard({ cwd: worktree, state: fixture.state }).status).toBe(
    ALLOWED
  );
}

describe("worktree-binding-guard", () => {
  it("records the binding on the first guarded call and allows it", () => {
    const fixture = buildFixture();
    const result = runGuard({ cwd: fixture.a, state: fixture.state });
    expect(result.status).toBe(ALLOWED);
    const recorded = JSON.parse(
      readFileSync(
        path.join(fixture.state, "worktree-binding", `${SESSION}.json`),
        "utf8"
      )
    );
    expect(recorded.boundRoot).toContain("wt-a");
  });

  it("allows a later call from the same worktree", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("refuses when the session's worktree moved underneath it", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = runGuard({ cwd: fixture.b, state: fixture.state });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain("wt-a");
    expect(result.stderr).toContain("wt-b");
  });

  it("keeps refusing a blind retry of the displaced call", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({ cwd: fixture.b, state: fixture.state });
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("refuses the first action after EnterWorktree reports a switch that did not take effect", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        tool: "EnterWorktree",
        input: { path: fixture.b },
      }).status
    ).toBe(ALLOWED);

    const result = runGuard({ cwd: fixture.a, state: fixture.state });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain("EnterWorktree reported success");
    expect(result.stderr).toContain("wt-b");
    expect(result.stderr).toContain("wt-a");
  });

  it("refuses a Write taken on the strength of that false success", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "EnterWorktree",
      input: { path: fixture.b },
    });
    const result = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "Write",
      input: { file_path: path.join(fixture.b, "new.txt"), content: "x" },
    });
    expect(result.status).toBe(BLOCKED);
  });

  it("allows the next call when the switch really did take effect", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "EnterWorktree",
      input: { path: fixture.b },
    });
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("rebinds on an acknowledgement naming the worktree the session is in", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
    const accept = runGuard({
      cwd: fixture.b,
      state: fixture.state,
      input: { command: `echo 'lisa-worktree-binding: accept ${fixture.b}'` },
    });
    expect(accept.status).toBe(ALLOWED);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("refuses an acknowledgement naming a worktree the session is not in", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const accept = runGuard({
      cwd: fixture.b,
      state: fixture.state,
      input: { command: `echo 'lisa-worktree-binding: accept ${fixture.a}'` },
    });
    expect(accept.status).toBe(BLOCKED);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("keeps one session's displacement out of another session's binding", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, session: "other" })
        .status
    ).toBe(ALLOWED);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("ignores tools that cannot act on a worktree", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, tool: "Read" }).status
    ).toBe(ALLOWED);
  });

  it("fails open and says so when the payload carries no cwd", () => {
    const fixture = buildFixture();
    const result = runRaw(
      JSON.stringify({ session_id: SESSION, tool_name: "Bash" }),
      fixture.a,
      fixture.state
    );
    expect(result.status).toBe(ALLOWED);
    expect(result.stderr).toContain("NOT enforced");
  });

  it("fails open and says so when the payload is not JSON", () => {
    const fixture = buildFixture();
    const result = runRaw("not json", fixture.a, fixture.state);
    expect(result.status).toBe(ALLOWED);
    expect(result.stderr).toContain("NOT enforced");
  });

  it("stays quiet outside a git repository", () => {
    const fixture = buildFixture();
    const outside = mkdtempSync(path.join(tmpdir(), "lisa-wtb-out-"));
    tempDirs.push(outside);
    expect(runGuard({ cwd: outside, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });
});
