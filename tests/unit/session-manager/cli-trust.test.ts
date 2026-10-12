/**
 * Where the session manager takes trust from (CodySwannGT/lisa#4448 review
 * findings S4, S5 and two hardening notes).
 *
 * - `blocked-plan` judges a human hold against the trusted IDs in config, never
 *   against IDs that arrive on stdin next to the untrusted item text.
 * - `ledger finish` / `ledger set-question --sender <name>` accept a worker's
 *   report only from the worker the ledger holds for that ref, so one worker
 *   cannot finish or question another worker's item.
 * - `resume` ends option parsing with `--`, so an answer that starts with `--`
 *   is message text, not a `claude` flag.
 * - The shared Telegram state dir is refused through a symlink too.
 * @module tests/unit/session-manager/cli-trust
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HUMAN_GATE_MARKER,
  formatHumanGateRelease,
} from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
import {
  LaunchError,
  resolveStateDir,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";
import { buildWorkerResume } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";
import { readLedgerFile } from "./support/cli-fixtures.js";

const homes: string[] = [];
afterEach(() => {
  removeSandboxes();
  for (const dir of homes.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const REF = "DEMO-9";
const WORKER = "wk-DEMO-9-1012-0900";
const OTHER_WORKER = "wk-DEMO-8-1012-0900";
const MALLORY = "mallory";
const REASON = "design-call";
const BLOCKED_PLAN = "blocked-plan";

/** A Blocked item held for a person, released by MALLORY, edges shipped. */
const HELD_ITEM = {
  labels: [],
  body: `Waiting on design.\n<!-- ${HUMAN_GATE_MARKER} reason=${REASON} -->`,
  comments: [
    {
      authorId: MALLORY,
      authorType: "User",
      body: formatHumanGateRelease({ reason: REASON, decision: "go" }),
    },
  ],
  edges: [
    {
      ref: "<TEAM>-1",
      contained: true,
      blockerState: "closed",
      blockerReason: "completed",
    },
  ],
};

/**
 * Set `sessionManager.trustedAuthorIds` in the sandbox config.
 * @param sandbox - Project sandbox
 * @param ids - Trusted tracker user IDs
 */
function trust(sandbox: Sandbox, ids: string[]): void {
  const file = path.join(sandbox.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeJson(file, {
    ...config,
    sessionManager: { ...config.sessionManager, trustedAuthorIds: ids },
  });
}

describe("blocked-plan trusted releasers", () => {
  it("ignores trustedHumanActorIds supplied on stdin", () => {
    const result = runCli(makeSandbox(), [BLOCKED_PLAN], {
      input: JSON.stringify({ ...HELD_ITEM, trustedHumanActorIds: [MALLORY] }),
    });
    expect(result.status).toBe(0);
    expect(result.json.action).toBe("skip-human-gate");
  });

  it("ignores trustedHumanActorIds in an --input file", () => {
    const sandbox = makeSandbox();
    const file = path.join(sandbox.root, "item.json");
    writeJson(file, { ...HELD_ITEM, trustedHumanActorIds: [MALLORY] });
    const result = runCli(sandbox, [BLOCKED_PLAN, "--input", file]);
    expect(result.json.action).toBe("skip-human-gate");
  });

  it("takes trusted releasers from sessionManager.trustedAuthorIds", () => {
    const sandbox = makeSandbox();
    trust(sandbox, [MALLORY]);
    const result = runCli(sandbox, [BLOCKED_PLAN], {
      input: JSON.stringify(HELD_ITEM),
    });
    expect(result.json.action).toBe("release");
  });
});

describe("ledger --sender", () => {
  /**
   * A sandbox whose ledger holds REF for WORKER.
   * @returns Sandbox
   */
  function withWorker(): Sandbox {
    const sandbox = makeSandbox();
    runCli(sandbox, ["ledger", "record-spawn", REF, "--worker", WORKER]);
    return sandbox;
  }

  it("refuses a finish from a worker that does not hold the ref", () => {
    const sandbox = withWorker();
    const result = runCli(
      sandbox,
      ["ledger", "finish", REF, "--status", "DONE", "--sender", OTHER_WORKER],
      { input: "done" }
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(OTHER_WORKER);
    expect(readLedgerFile(sandbox).items[REF].status).toBe("running");
  });

  it("accepts a finish from the ref's own worker", () => {
    const sandbox = withWorker();
    const result = runCli(
      sandbox,
      ["ledger", "finish", REF, "--status", "DONE", "--sender", WORKER],
      { input: "done" }
    );
    expect(result.status).toBe(0);
    expect(readLedgerFile(sandbox).items[REF].status).toBe("DONE");
  });

  it("refuses a question from another worker, and for a ref with no worker", () => {
    const sandbox = withWorker();
    const args = ["ledger", "set-question"];
    expect(
      runCli(sandbox, [...args, REF, "--sender", OTHER_WORKER], { input: "q" })
        .status
    ).toBe(2);
    expect(
      runCli(sandbox, [...args, "DEMO-404", "--sender", WORKER], { input: "q" })
        .status
    ).toBe(2);
    expect(readLedgerFile(sandbox).items[REF].pendingQuestion).toBeNull();
  });
});

describe("resume argv", () => {
  it("puts -- before the message so text starting with -- is never a flag", () => {
    const spec = buildWorkerResume({
      sessionId: "abc",
      text: "--settings {}",
      repoDir: "/work",
      env: {},
    });
    expect(spec.args).toEqual([
      "--bg",
      "--resume",
      "abc",
      "--",
      "--settings {}",
    ]);
  });
});

describe("resolveStateDir through symlinks", () => {
  /**
   * A temp HOME with a real shared default dir.
   * @returns Real home path
   */
  function home(): string {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "sm-home-")));
    homes.push(dir);
    mkdirSync(path.join(dir, ".claude/channels/telegram"), { recursive: true });
    return dir;
  }

  it("refuses a symlink that points at the shared default dir", () => {
    const homedir = home();
    const alias = path.join(homedir, "tg-alias");
    symlinkSync(path.join(homedir, ".claude/channels/telegram"), alias);
    expect(() => resolveStateDir(alias, { homedir })).toThrow(LaunchError);
  });

  it("refuses the shared dir reached through a symlinked parent", () => {
    const homedir = home();
    symlinkSync(path.join(homedir, ".claude"), path.join(homedir, "dot"));
    expect(() =>
      resolveStateDir("~/dot/channels/telegram", { homedir })
    ).toThrow(/shared Telegram default/);
  });

  it("still accepts a per-project dir that does not exist yet", () => {
    const homedir = home();
    writeFileSync(path.join(homedir, "unrelated"), "");
    expect(
      resolveStateDir("~/.claude/channels/telegram-demo", { homedir })
    ).toBe(path.join(homedir, ".claude/channels/telegram-demo"));
  });
});
