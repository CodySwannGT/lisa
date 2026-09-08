/**
 * Retracting a premise obliges naming what was built on it (#3489).
 *
 * The sibling suite covers DELIVERY — reaching a session that already read the
 * withdrawn claim (#3752). This one covers DERIVATION, which is the other end
 * and a different defect: the retracting session's OWN downstream artifacts.
 * Correcting a premise removes the belief and leaves every inference standing,
 * and the inferences are the part that reached other agents and the human.
 *
 * The observed instance: a session disproved a false claim that a credential
 * CLI was unavailable, updated the fact, and two hours later still relayed to
 * its human that a work item was blocked for a reason resting on the retracted
 * claim. Three facts sat in one context and were never joined.
 *
 * The obligation binds at write time because nothing could enforce it later.
 * Outside the learnings ledger's `provenance` refs, no artifact Lisa writes
 * records the premise it rests on, so no scanner can ask "what rested on this".
 * @module tests/unit/hooks/withdrawn-rulings-reaudit
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
const MJS = path.join(
  REPO_ROOT,
  "plugins/src/base/hooks/withdrawn-rulings.mjs"
);
const SESSION = "session-under-test";
const WITHDRAW = "--withdraw";
const CLAIM = "--claim";
const BECAUSE = "--because";
const DERIVED = "--derived";
const NONE = "none";
const MEASURED = "measured";
const A_CLAIM = "A claim.";
const LEDGER = path.join(".lisa", "WITHDRAWN.jsonl");

let sandbox: string;
let repo: string;
let stateHome: string;

/**
 * Run the module's CLI directly.
 * @param args - CLI arguments
 * @returns The CLI's stdout
 */
function runCli(args: readonly string[]): string {
  return boundedExecFileSync({
    label: `withdrawn-rulings.mjs ${args.join(" ")}`,
    command: process.execPath,
    args: [MJS, ...args],
    cwd: repo,
    env: { ...process.env, LISA_STATE_HOME: stateHome },
  });
}

/**
 * Run the shipped hook wrapper against the sandbox.
 * @param args - Wrapper arguments
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

/**
 * The single record the ledger holds.
 * @returns The parsed entry
 */
function onlyRecord(): { derived: string[] } {
  return JSON.parse(
    fs.readFileSync(path.join(repo, LEDGER), "utf-8").trim()
  ) as { derived: string[] };
}

/**
 * Run a CLI invocation expected to be refused.
 * @param args - CLI arguments
 * @returns The exit code and stderr
 */
function refusal(args: readonly string[]): {
  code: number | null;
  stderr: string;
} {
  try {
    runCli(args);
  } catch (error) {
    const failure = error as ChildFailure;
    return { code: failure.exitCode, stderr: failure.stderr };
  }
  return { code: 0, stderr: "" };
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-reaudit-"));
  repo = path.join(sandbox, "repo");
  stateHome = path.join(sandbox, "state");
  fs.mkdirSync(path.join(repo, ".lisa"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("a withdrawal must say what was built on the claim", () => {
  it("refuses a withdrawal that never says", () => {
    // Before this, the identical invocation was ACCEPTED and wrote a tombstone
    // carrying no re-audit at all.
    const { code, stderr } = refusal([
      WITHDRAW,
      "no-audit",
      CLAIM,
      A_CLAIM,
      BECAUSE,
      MEASURED,
    ]);

    expect(code).toBe(2);
    expect(stderr).toContain("--derived is required");
    // Nothing written on refusal: a half-recorded withdrawal is worse than
    // none, because a reader takes it for a completed one.
    expect(fs.existsSync(path.join(repo, LEDGER))).toBe(false);
  });

  it('keeps an explicit "none" as an empty list, not an absent key', () => {
    // The obligation is to produce the list, not to find something in it. A
    // withdrawer who checked and found nothing has discharged it fully, and the
    // record must be able to say so — otherwise the only way to satisfy the
    // field is to invent an entry.
    runCli([
      WITHDRAW,
      "audited-clean",
      CLAIM,
      A_CLAIM,
      BECAUSE,
      MEASURED,
      DERIVED,
      NONE,
    ]);

    expect(onlyRecord().derived).toEqual([]);
  });

  it("records every artifact a repeated flag names", () => {
    runCli([
      WITHDRAW,
      "audited-dirty",
      CLAIM,
      A_CLAIM,
      BECAUSE,
      MEASURED,
      DERIVED,
      "owner/repo#12 marked blocked",
      DERIVED,
      "relayed to the operator",
    ]);

    expect(onlyRecord().derived).toEqual([
      "owner/repo#12 marked blocked",
      "relayed to the operator",
    ]);
  });

  it("tells a reader audited-clean apart from unaudited", () => {
    // A notice that printed nothing for an empty list would make the two look
    // identical to whoever holds the claim, which is the distinction the field
    // exists to draw.
    runHook(["--session-start"], { session_id: SESSION });
    runCli([
      WITHDRAW,
      "clean",
      CLAIM,
      A_CLAIM,
      BECAUSE,
      MEASURED,
      DERIVED,
      NONE,
    ]);

    expect(contextOf(runHook(["--hook"], { session_id: SESSION }))).toContain(
      "still standing on it: nothing (audited by the withdrawer)"
    );
  });
});

describe("the gate keeps the write-time refusal from being a formality", () => {
  it("fails on a tombstone that records no re-audit", () => {
    // Without this, appending a line by hand routes straight around the
    // refusal above.
    fs.writeFileSync(
      path.join(repo, LEDGER),
      `${JSON.stringify({
        id: "unaudited",
        withdrawnAt: "2026-09-05T00:00:00.000Z",
        claim: A_CLAIM,
        because: MEASURED,
      })}\n`
    );

    const { code, stderr } = refusal(["--check"]);

    expect(code).toBe(1);
    expect(stderr).toContain("no re-audit recorded");
  });

  it("passes a tombstone whose re-audit found nothing", () => {
    // The control. A gate that failed on an empty list would push writers to
    // invent an entry, which is worse than the gap it closes.
    fs.writeFileSync(
      path.join(repo, LEDGER),
      `${JSON.stringify({
        id: "audited-empty",
        withdrawnAt: "2026-09-05T00:00:00.000Z",
        claim: A_CLAIM,
        because: MEASURED,
        derived: [],
      })}\n`
    );

    expect(runCli(["--check"])).toContain("ledger well-formed");
  });
});
