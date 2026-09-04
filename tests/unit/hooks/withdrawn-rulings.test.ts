/**
 * The bite test for the withdrawn-rulings ledger (CodySwannGT/lisa#3752).
 *
 * The discriminating case, and the only one worth spending a test on, is **a
 * session that read the ruling BEFORE the retraction existed**. A test where
 * the session starts after the correction is satisfied by doing nothing, so
 * every case here stamps the session first and withdraws second.
 *
 * The hook is exercised through the real `withdrawn-rulings.sh`, not by calling
 * the module in-process: the wrapper is what the harness runs, and a test that
 * skips it proves the module works while the shipped path stays inert.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundedExecFileSync,
  ChildFailure,
} from "../../helpers/io-latency-budget.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BASH = "/bin/bash";
const HOOK_SH = path.join(
  REPO_ROOT,
  "plugins/src/base/hooks/withdrawn-rulings.sh"
);
const SESSION = "session-under-test";
const MJS = path.join(
  REPO_ROOT,
  "plugins/src/base/hooks/withdrawn-rulings.mjs"
);
const WITHDRAW = "--withdraw";
const CLAIM = "--claim";
const BECAUSE = "--because";
const MEASURED = "measured";
const A_CLAIM = "A claim.";
const LEDGER = path.join(".lisa", "WITHDRAWN.jsonl");
const START = ["--session-start"];
const CHECK = ["--hook"];

let sandbox: string;
let repo: string;
let stateHome: string;

/**
 * Run the shipped hook wrapper against the sandbox.
 * @param args - Wrapper arguments (`--hook`, `--session-start`, ...)
 * @param payload - The JSON hook payload piped on stdin
 * @returns The wrapper's stdout
 */
function runHook(args: readonly string[], payload: object): string {
  return boundedExecFileSync({
    label: `withdrawn-rulings.sh ${args.join(" ")}`,
    command: BASH,
    args: [HOOK_SH, ...args],
    cwd: repo,
    input: JSON.stringify(payload),
    env: { ...process.env, LISA_STATE_HOME: stateHome },
  });
}

/**
 * Run the module's CLI directly, for modes that take no stdin.
 * @param args - CLI arguments
 * @param cwd - Working directory; a sibling checkout proves the machine tier
 * @returns The CLI's stdout
 */
function runCli(args: readonly string[], cwd: string = repo): string {
  return boundedExecFileSync({
    label: `withdrawn-rulings.mjs ${args.join(" ")}`,
    command: process.execPath,
    args: [MJS, ...args],
    cwd,
    env: { ...process.env, LISA_STATE_HOME: stateHome },
  });
}

/**
 * The `additionalContext` a hook invocation emitted, or the empty string.
 * @param stdout - The wrapper's stdout
 * @returns The injected context
 */
function contextOf(stdout: string): string {
  if (stdout.trim() === "") return "";
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { additionalContext: string };
  };
  return parsed.hookSpecificOutput.additionalContext;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-withdrawn-"));
  repo = path.join(sandbox, "repo");
  stateHome = path.join(sandbox, "state");
  fs.mkdirSync(path.join(repo, ".lisa"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("a withdrawal reaches a session that already read the old version", () => {
  it("announces a ruling withdrawn AFTER the session started, and only that one", () => {
    runCli([
      WITHDRAW,
      "already-known",
      CLAIM,
      "A claim this session was born knowing was withdrawn.",
      BECAUSE,
      "recorded before the session started",
    ]);

    // The session starts here. Everything above is part of its snapshot.
    runHook(START, { session_id: SESSION });

    // Control: nothing new, so the hook says nothing.
    expect(contextOf(runHook(CHECK, { session_id: SESSION }))).toBe("");

    // The retraction happens mid-session — the case nothing could reach before.
    runCli([
      WITHDRAW,
      "worktree-creation-captures-the-binding",
      CLAIM,
      "Creating a fresh worktree captures the stale binding.",
      BECAUSE,
      "zero observed successes; the condition arrived later on its own",
      "--superseded-by",
      "wait-for-the-condition",
      "--reached",
      "three agents by message",
    ]);

    const reached = contextOf(runHook(CHECK, { session_id: SESSION }));
    expect(reached).toContain("WITHDRAWN since this session started");
    expect(reached).toContain("worktree-creation-captures-the-binding");
    expect(reached).toContain(
      "Creating a fresh worktree captures the stale binding."
    );
    expect(reached).toContain("zero observed successes");
    expect(reached).toContain("superseded by: wait-for-the-condition");
    expect(reached).toContain("originally reached: three agents by message");

    // Not re-announced: the session already holds the withdrawal.
    expect(reached).not.toContain("already-known");
    expect(contextOf(runHook(CHECK, { session_id: SESSION }))).toBe("");
  });

  it("never flags a ruling that was not withdrawn", () => {
    runHook(START, { session_id: SESSION });
    runCli([
      WITHDRAW,
      "the-withdrawn-one",
      CLAIM,
      "This one was withdrawn.",
      BECAUSE,
      MEASURED,
    ]);
    const reached = contextOf(runHook(CHECK, { session_id: SESSION }));
    expect(reached).toContain("the-withdrawn-one");
    expect(reached).not.toContain("settled-decisions");
    expect(reached).not.toContain("stale-state-claims");
  });

  it("says nothing to a session it never stamped", () => {
    runCli([WITHDRAW, "unseen", CLAIM, A_CLAIM, BECAUSE, MEASURED]);
    expect(contextOf(runHook(CHECK, { session_id: "never-stamped" }))).toBe("");
  });

  it("reaches a sibling session in another worktree through the machine tier", () => {
    runHook(START, { session_id: SESSION });
    const sibling = path.join(sandbox, "sibling");
    fs.mkdirSync(sibling, { recursive: true });
    runCli(
      [
        WITHDRAW,
        "from-a-sibling-worktree",
        CLAIM,
        "Written from a different checkout entirely.",
        BECAUSE,
        MEASURED,
      ],
      sibling
    );
    expect(contextOf(runHook(CHECK, { session_id: SESSION }))).toContain(
      "from-a-sibling-worktree"
    );
  });
});

describe("the retraction path is cheap, and refuses an unrecognisable tombstone", () => {
  it('records to both tiers in one command, with a typed "none" normalised away', () => {
    runCli([
      WITHDRAW,
      "two-tiers",
      CLAIM,
      A_CLAIM,
      BECAUSE,
      MEASURED,
      "--superseded-by",
      "none",
    ]);
    const record = JSON.parse(
      fs
        .readFileSync(path.join(repo, ".lisa", "WITHDRAWN.jsonl"), "utf-8")
        .trim()
    ) as { supersededBy: string | null };
    expect(record.supersededBy).toBeNull();
    for (const file of [
      path.join(repo, LEDGER),
      path.join(stateHome, "withdrawn-rulings.jsonl"),
    ]) {
      expect(fs.readFileSync(file, "utf-8"), file).toContain("two-tiers");
    }
  });

  it("refuses a withdrawal with no verbatim claim", () => {
    let code: number | null = 0;
    let stderr = "";
    try {
      runCli([WITHDRAW, "no-claim", BECAUSE, MEASURED]);
    } catch (error) {
      const failure = error as ChildFailure;
      code = failure.exitCode;
      stderr = failure.stderr;
    }
    expect(code).toBe(2);
    expect(stderr).toContain("--claim is required");
    expect(fs.existsSync(path.join(repo, LEDGER))).toBe(false);
  });
});

describe("--check refuses a ledger that would swallow a withdrawal", () => {
  it("fails on an unparseable line", () => {
    fs.writeFileSync(path.join(repo, LEDGER), '{"id":"broken","claim":"x"\n');
    let code: number | null = 0;
    try {
      runCli(["--check"]);
    } catch (error) {
      code = (error as ChildFailure).exitCode;
    }
    expect(code).toBe(1);
  });

  it("fails on a tombstone with no claim recorded", () => {
    fs.writeFileSync(
      path.join(repo, LEDGER),
      `${JSON.stringify({ id: "hollow", withdrawnAt: new Date().toISOString() })}\n`
    );
    let code: number | null = 0;
    try {
      runCli(["--check"]);
    } catch (error) {
      code = (error as ChildFailure).exitCode;
    }
    expect(code).toBe(1);
  });

  it("passes on a well-formed ledger", () => {
    runCli([WITHDRAW, "fine", CLAIM, A_CLAIM, BECAUSE, MEASURED]);
    expect(runCli(["--check"])).toContain("ledger well-formed");
  });
});
