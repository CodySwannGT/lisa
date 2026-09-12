/**
 * The bite test for the short-lived operational-hazard ledger
 * (CodySwannGT/lisa#3681).
 *
 * The load-bearing assertion is the expiry filter. An expiry filter that never
 * fires and one that works are indistinguishable from outside, and an expiry
 * that silently stops filtering restores the permanent-scripture failure while
 * every signal still reads healthy. So `stops injecting an entry once its
 * expiry has passed` is written to fail — by name — if the filter is removed,
 * and its sibling asserts a live entry still arrives, so "filter everything"
 * is not a passing answer either.
 *
 * The hook is exercised through the real `operational-hazards.sh`, not by
 * calling the module in-process: the wrapper is what the harness runs, and a
 * test that skips it proves the module works while the shipped path stays
 * inert.
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
  "plugins/src/base/hooks/operational-hazards.sh"
);
const MJS = path.join(
  REPO_ROOT,
  "plugins/src/base/hooks/operational-hazards.mjs"
);
const SESSION = "session-under-test";
const LEDGER = path.join(".lisa", "HAZARDS.jsonl");
const DECLARE = "--declare";
const HAZARD = "--hazard";
const AVOID = "--avoid";
const UNTIL = "--until";
const LIFT = "--lift";
const BECAUSE = "--because";
const START = ["--session-start"];
const CHECK = ["--hook"];
const A_HAZARD = "A container on that port answers from another lane.";
const AN_AVOIDANCE = "Allocate a per-lane port.";
const DAY_MS = 86_400_000;
const EXPIRED_ID = "yesterdays-outage";

let sandbox: string;
let repo: string;
let stateHome: string;

/**
 * A calendar day offset from now, which is what `--until` accepts.
 * @param days - Offset in days; negative is in the past
 * @returns A `YYYY-MM-DD` day
 */
function day(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Run the shipped hook wrapper against the sandbox.
 * @param args - Wrapper arguments (`--hook`, `--session-start`, ...)
 * @param payload - The JSON hook payload piped on stdin
 * @returns The wrapper's stdout
 */
function runHook(args: readonly string[], payload: object): string {
  return boundedExecFileSync({
    label: `operational-hazards.sh ${args.join(" ")}`,
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
    label: `operational-hazards.mjs ${args.join(" ")}`,
    command: process.execPath,
    args: [MJS, ...args],
    cwd,
    env: { ...process.env, LISA_STATE_HOME: stateHome },
  });
}

/**
 * Declare one hazard through the shipped writer.
 * @param id - The hazard id
 * @param until - The `--until` value
 * @returns The CLI's stdout
 */
function declare(id: string, until: string): string {
  return runCli([
    DECLARE,
    id,
    HAZARD,
    A_HAZARD,
    AVOID,
    AN_AVOIDANCE,
    UNTIL,
    until,
  ]);
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
 * The exit code and stderr of a CLI invocation expected to refuse.
 * @param args - CLI arguments
 * @returns Exit code and stderr
 */
function refusalOf(args: readonly string[]): {
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
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-hazards-"));
  repo = path.join(sandbox, "repo");
  stateHome = path.join(sandbox, "state");
  fs.mkdirSync(path.join(repo, ".lisa"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("an expiring hazard reaches a session that did not exist when it was declared", () => {
  it("injects a hazard whose expiry is in the future", () => {
    declare("port-collision", day(2));

    const injected = contextOf(runHook(START, { session_id: SESSION }));
    expect(injected).toContain("port-collision");
    expect(injected).toContain(A_HAZARD);
    expect(injected).toContain(AN_AVOIDANCE);
  });

  it("stops injecting an entry once its expiry has passed, with no human action", () => {
    // The load-bearing case. Nothing edits, drains or deletes the ledger
    // between the two declarations — the past entry is still on disk, and the
    // reader is the only thing that makes it inert. Delete the expiry filter
    // and this test names itself.
    declare(EXPIRED_ID, day(-2));
    declare("todays-outage", day(2));

    const injected = contextOf(runHook(START, { session_id: SESSION }));
    expect(injected).not.toContain(EXPIRED_ID);
    expect(injected).toContain("todays-outage");
    expect(fs.readFileSync(path.join(repo, LEDGER), "utf-8")).toContain(
      EXPIRED_ID
    );
  });

  it("keeps an entry that names no evaluable expiry, and reports it as unchecked", () => {
    // The migration arm of CodySwannGT/lisa#3856: an unevaluable condition
    // never lapses into the permissive answer. Here the permissive answer is
    // "say nothing", so silence would be the failure.
    fs.writeFileSync(
      path.join(repo, LEDGER),
      `${JSON.stringify({
        id: "hand-written",
        declaredAt: new Date().toISOString(),
        hazard: A_HAZARD,
        avoid: AN_AVOIDANCE,
      })}\n`
    );

    const injected = contextOf(runHook(START, { session_id: SESSION }));
    expect(injected).toContain("hand-written");
    expect(injected).toContain("unchecked");
  });

  it("reaches a sibling checkout on this machine through the machine tier", () => {
    // The committed tier cannot reach another worktree until it is merged and
    // pulled, and the fleet case is precisely sessions in sibling checkouts.
    declare("saturated-workers", day(1));
    const sibling = path.join(sandbox, "other-checkout");
    fs.mkdirSync(sibling, { recursive: true });

    expect(runCli(["--list"], sibling)).toContain("saturated-workers");
  });
});

describe("a hazard that changes mid-session reaches the running session", () => {
  it("announces a hazard declared AFTER the session started", () => {
    declare("already-known", day(1));
    runHook(START, { session_id: SESSION });
    expect(contextOf(runHook(CHECK, { session_id: SESSION }))).toBe("");

    declare("declared-mid-session", day(1));

    const reached = contextOf(runHook(CHECK, { session_id: SESSION }));
    expect(reached).toContain("declared AFTER this session started");
    expect(reached).toContain("declared-mid-session");
    expect(reached).not.toContain("already-known");
  });

  it("announces a lift of a hazard this session was told about", () => {
    // The provenance of the ticket: a session was sent a LIFT for a hold it
    // had never received. A session still paying for a hazard everybody else
    // stopped working around is the same defect facing the other way.
    declare("held", day(1));
    runHook(START, { session_id: SESSION });

    runCli([LIFT, "held", BECAUSE, "the allocator landed"]);

    const reached = contextOf(runHook(CHECK, { session_id: SESSION }));
    expect(reached).toContain("no longer applies");
    expect(reached).toContain("held");
  });

  it("does not announce anything to a session it never stamped", () => {
    declare("unknown-audience", day(1));
    expect(contextOf(runHook(CHECK, { session_id: "never-started" }))).toBe("");
  });
});

describe("the inverse cannot discharge something it never held", () => {
  it("re-applies a hazard re-declared after an earlier lift", () => {
    // The refusal CodySwannGT/lisa#3852 records: matching is time-ordered, so
    // a new declaration is never born discharged by an old release.
    declare("recurring", day(1));
    runCli([LIFT, "recurring", BECAUSE, "fixed once"]);
    expect(runCli(["--list"])).not.toContain(A_HAZARD);

    fs.appendFileSync(
      path.join(repo, LEDGER),
      `${JSON.stringify({
        id: "recurring",
        declaredAt: new Date(Date.now() + 1000).toISOString(),
        until: day(1),
        hazard: A_HAZARD,
        avoid: AN_AVOIDANCE,
      })}\n`
    );

    expect(runCli(["--list"])).toContain(A_HAZARD);
  });

  it("refuses a lift that does not say what resolved it", () => {
    const { code, stderr } = refusalOf([LIFT, "held"]);
    expect(code).toBe(2);
    expect(stderr).toContain(BECAUSE);
  });
});

describe("the writer cannot produce permanent scripture", () => {
  it("refuses a declaration with no expiry", () => {
    const { code, stderr } = refusalOf([
      DECLARE,
      "forever",
      HAZARD,
      A_HAZARD,
      AVOID,
      AN_AVOIDANCE,
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("--until is required");
    expect(fs.existsSync(path.join(repo, LEDGER))).toBe(false);
  });

  it("refuses an expiry it cannot evaluate", () => {
    const { code, stderr } = refusalOf([
      DECLARE,
      "soonish",
      HAZARD,
      A_HAZARD,
      AVOID,
      AN_AVOIDANCE,
      UNTIL,
      "when the box calms down",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("not a date");
  });

  it("refuses a hazard nobody can act on", () => {
    const { code, stderr } = refusalOf([
      DECLARE,
      "opaque",
      HAZARD,
      A_HAZARD,
      UNTIL,
      day(1),
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("--avoid is required");
  });
});

describe("--check refuses a ledger that would hold a hazard forever", () => {
  it("fails on an until that looks like an expiry and is not", () => {
    // The dangerous shape: every signal reads healthy while the entry can
    // never stop applying on its own.
    fs.writeFileSync(
      path.join(repo, LEDGER),
      `${JSON.stringify({
        id: "pseudo-dated",
        declaredAt: new Date().toISOString(),
        until: "next Tuesday",
        hazard: A_HAZARD,
        avoid: AN_AVOIDANCE,
      })}\n`
    );

    const { code } = refusalOf(["--check"]);
    expect(code).toBe(1);
  });

  it("fails on an unparseable line", () => {
    fs.writeFileSync(path.join(repo, LEDGER), '{"id":"broken","hazard":"x"\n');
    expect(refusalOf(["--check"]).code).toBe(1);
  });

  it("passes on a well-formed ledger, expired entries included", () => {
    declare("drained", day(-3));
    expect(runCli(["--check"])).toContain("ledger well-formed");
  });
});
