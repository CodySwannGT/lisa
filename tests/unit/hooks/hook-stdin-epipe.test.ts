/**
 * A hook that stands aside must still read the payload its caller is writing.
 *
 * Every hook is invoked as `bash hook.sh <event>` with the event envelope piped
 * into its stdin. A hook that decides it has nothing to do and exits before
 * consuming that stdin closes the read end while the write is still in flight,
 * and the CALLER's write raises `EPIPE`. The failure lands on the harness, not
 * on the hook — the hook exits 0 and looks perfectly healthy.
 *
 * It is a race, so it only fires when the child wins — 3 EPIPE in 600
 * invocations (0.50%) of the no-event path at a 1-minute load average of 82 on
 * 18 cores, agreeing with the 4/600 recorded on CodySwannGT/lisa#2949. Rare
 * enough to read as a real failure and common enough to keep firing: it cost
 * three unrelated pull requests a diagnosis and a re-run in one night.
 *
 * A test at that payload size would be a lottery ticket. The rate is a property
 * of the machine, not of the code: the same 600 invocations returned 0 an hour
 * later on a quieter box, and 3,000 more returned 0 as well. Sizing a test to a
 * 0.5% event needs thousands of spawns and still cannot promise a bite.
 *
 * So these cases move the same mechanism off the scheduler and onto the pipe.
 * A payload larger than the pipe buffer cannot be written in one syscall, so
 * the parent is *forced* to still be writing when the child exits. Measured
 * across the four paths below, 200 invocations each, before and after the fix
 * interleaved on one machine:
 *
 * | payload | before | after |
 * |---|---|---|
 * | 2 B | 0/800 | 0/800 |
 * | 16 KB | 0/800 | 0/800 |
 * | 64 KB | **800/800** | 0/800 |
 * | 128 KB | **800/800** | 0/800 |
 * | 1 MB | **800/800** | 0/800 |
 *
 * The step lands exactly on the 64KB pipe buffer, which is the mechanism
 * naming itself: under the buffer the write completes in one syscall and only
 * a descheduled parent loses, at or over it the parent must block and losing is
 * certain. Same defect, same cause, deterministic instead of probabilistic.
 *
 * This is deliberately not the test suite's own problem to route around. Fixing
 * it in the caller (not writing stdin for these cases, or tolerating EPIPE)
 * would green the suite and leave every real caller — a live agent harness
 * included — writing into a closed pipe.
 * @module tests/unit/hooks/hook-stdin-epipe
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";

// Spawns `/bin/bash` against real hook scripts, once per stand-aside path.
useIoLatencyBudget();

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
const BASH = "/bin/bash";

/** The hook file the three measured sonar stand-aside paths all live in. */
const SONAR_HOOK = "sonar-secrets.sh";

/** The vendor event name the Claude prompt shim passes through. */
const PROMPT_EVENT = "claude-prompt-submit";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Path to a shipped hook source.
 * @param name File name under the plugin's shared hook directory.
 * @returns Absolute path to the reviewed original.
 */
function hookSource(name: string): string {
  return path.join(REPO_ROOT, "plugins", "src", "base", "hooks", name);
}

/**
 * A payload larger than any OS pipe buffer, so the race cannot be won.
 *
 * 1MB, against the 64KB the measurement above found the step at. Well clear of
 * it deliberately: the point is a payload no plausible buffer size can swallow
 * whole, not a payload tuned to one kernel's figure.
 */
const OVERSIZED_PAYLOAD = JSON.stringify({ prompt: "x".repeat(1_000_000) });

const temporaries: string[] = [];

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A minimal-but-working PATH, optionally carrying a stub `sonar`.
 *
 * `cat` is linked in deliberately. Handing a hook a PATH with nothing on it at
 * all does model "the CLI is not installed", but it ALSO removes the `cat` the
 * hook reads its payload with — so the read fails instantly, the hook stands
 * aside anyway, and the case passes against the very fix it exists to prove.
 * The realistic condition is a working PATH that happens not to carry `sonar`.
 *
 * The off-switch case needs the CLI to be FOUND, or the hook stands aside one
 * guard earlier and the case silently re-tests the path above it.
 * @param withSonar Whether to plant a `sonar` the hook's `command -v` will find.
 * @returns Absolute path to a fresh directory to use as the whole PATH.
 */
function binDir(withSonar: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-epipe-bin-"));

  temporaries.push(dir);
  symlinkSync("/bin/cat", path.join(dir, "cat"));
  if (withSonar) {
    const stub = path.join(dir, "sonar");

    writeFileSync(stub, "#!/bin/bash\ncat >/dev/null\nexit 0\n");
    chmodSync(stub, 0o755);
  }
  return dir;
}

/** One stand-aside path of one hook, and how to reach it. */
interface StandAsidePath {
  /** What the case is called, and what the hook is standing aside for. */
  readonly name: string;
  /** Hook file name under `plugins/src/base/hooks`. */
  readonly hook: string;
  /** Arguments the caller passes, if any. */
  readonly args: readonly string[];
  /** Environment overrides that steer the hook onto this path. */
  readonly env: Readonly<Record<string, string>>;
  /** Whether a findable `sonar` is needed to reach the path under test. */
  readonly withSonar: boolean;
}

/**
 * Every path measured to raise EPIPE in its caller on CodySwannGT/lisa#2949.
 *
 * The prediction the issue offered so it could be falsified: recurrence rotates
 * among the paths that exit before consuming stdin and never touches one that
 * reaches the read. These are those paths.
 */
const STAND_ASIDE_PATHS: readonly StandAsidePath[] = [
  {
    args: [],
    env: {},
    hook: SONAR_HOOK,
    name: "the sonar wrapper given no event name",
    withSonar: false,
  },
  {
    args: [PROMPT_EVENT],
    env: {},
    hook: SONAR_HOOK,
    name: "the sonar wrapper with no CLI on PATH",
    withSonar: false,
  },
  {
    args: [PROMPT_EVENT],
    env: { LISA_SONAR_HOOK: "off" },
    hook: SONAR_HOOK,
    name: "the sonar wrapper switched off",
    withSonar: true,
  },
  {
    args: [],
    env: { CLAUDE_DEBUG: "0" },
    hook: "debug-hook.sh",
    name: "the debug logger with debugging disabled",
    withSonar: false,
  },
];

describe("a hook that stands aside", () => {
  for (const spec of STAND_ASIDE_PATHS) {
    it(`does not raise EPIPE in the caller writing to ${spec.name}`, () => {
      const result = spawnSync(BASH, [hookSource(spec.hook), ...spec.args], {
        encoding: "utf8",
        env: { PATH: binDir(spec.withSonar), ...spec.env },
        input: OVERSIZED_PAYLOAD,
      });

      // `error` is the caller's failure, not the child's: `status` comes back 0
      // and `signal` null, because the hook itself exited perfectly happily.
      // That asymmetry is why this went undiagnosed — the only evidence is on
      // the parent side.
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    });
  }
});
