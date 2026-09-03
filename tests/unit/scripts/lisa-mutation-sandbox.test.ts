/**
 * Reclaiming the mutation gate's sandbox, and bounding its child
 * (CodySwannGT/lisa#2995).
 *
 * ## The defect
 *
 * A Stryker sandbox is a **full second copy of the project tree**, and one left
 * behind costs the next `lint:slow` 1191 parse errors. `cleanTempDir: "always"`
 * is supposed to prevent that, and it is Stryker's OWN teardown — so it covers a
 * pass and a fail and covers neither of the cases a busy machine actually
 * produces. A SIGTERM from a saturated box, an OOM reap, a `maxBuffer` overflow
 * and a Ctrl-C all skip it. One such kill left **72 MB** in `.stryker-tmp/`,
 * which survived until it was removed by hand.
 *
 * ## Why the obvious repair is a trap
 *
 * Adding `fs.rmSync(".stryker-tmp")` to the gate's `finally` would reintroduce,
 * one directory over, the defect CodySwannGT/lisa#2961 was filed for: a second
 * run in the same project deleting the first run's working directory out from
 * under it. That surfaced as a bare `ENOENT` reported as a coverage-gate failure
 * and took a day of controls to identify.
 *
 * So the design is **sweep before, not after**, over **per-run** sandboxes: each
 * run writes to `.stryker-tmp/run-<pid>-<epoch>`, and the next run reclaims the
 * ones whose owning process is gone. `assertion: a live run's sandbox is never
 * touched` is the case that pins the trap shut.
 *
 * ## The child deadline
 *
 * The gate's Stryker child carried no deadline at all. In CI that is bounded by
 * the job timeout; in a git hook it is bounded by nothing, so a hung gate hangs
 * the push for as long as the developer is willing to wait. The cases at the
 * bottom drive a real hanging child through the real wrapper and require it to
 * die on time, to be reported as a KILL rather than as a score, and to take its
 * own children with it.
 * @module tests/unit/scripts/lisa-mutation-sandbox
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CHILD_DEADLINE_MS,
  DEFAULT_TEMP_DIR_NAME,
  OUTCOMES,
  childDeadlineBlock,
  parseSandboxOwner,
  processIsAlive,
  reclaimAbandonedSandboxes,
  resolveChildDeadline,
  resolveSandboxRoot,
  runSandboxName,
  watchdogScript,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** The Stryker config file name the gate reads `tempDirName` from. */
const STRYKER_CONF = "stryker.conf.json";

/** Stryker's own default sandbox root, spelled out once. */
const STRYKER_TMP = ".stryker-tmp";

/** A run-scoped sandbox name, with both fields fixed so it can be compared. */
const SAMPLE_SANDBOX = "run-4242-1700000000000";

/** A sandbox the bite tests create by running Stryker directly, not this gate. */
const FOREIGN_SANDBOX = "bite-intact";

/**
 * A pid that names no process.
 *
 * The kernel hands out pids from a bounded space, so "some large number" is not
 * safe — it could be live. This forks a process, waits for it to exit, and uses
 * its pid: the one pid known to have belonged to something that is now gone.
 * @returns A pid whose process has exited
 */
const deadPid = (): number => {
  const printed = boundedExecFileSync({
    label: "a process that exits immediately",
    command: process.execPath,
    args: ["-e", "process.stdout.write(String(process.pid))"],
  });
  return Number(printed.trim());
};

describe("where the sandbox lives", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-sandbox-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads the root from the project's own config", () => {
    // Hardcoding it would sweep a directory the project did not choose, and
    // sweeping the wrong directory is worse than not sweeping at all.
    fs.writeFileSync(
      path.join(root, STRYKER_CONF),
      JSON.stringify({ tempDirName: "build/mutation-sandbox" })
    );

    expect(resolveSandboxRoot(root)).toBe("build/mutation-sandbox");
  });

  it("falls back to Stryker's own default when none is declared", () => {
    fs.writeFileSync(path.join(root, STRYKER_CONF), JSON.stringify({}));

    expect(resolveSandboxRoot(root)).toBe(STRYKER_TMP);
    expect(DEFAULT_TEMP_DIR_NAME).toBe(".stryker-tmp");
  });

  it("scopes the sandbox to this run, inside the configured root", () => {
    expect(runSandboxName(STRYKER_TMP, 4242, 1_700_000_000_000)).toBe(
      `${STRYKER_TMP}/${SAMPLE_SANDBOX}`
    );
  });

  it("keeps two runs of the same project apart", () => {
    // The whole reason a per-run path exists: two gate runs used to share one,
    // so reclaiming a leftover meant deleting a live run's working directory.
    expect(runSandboxName(STRYKER_TMP, 1, 10)).not.toBe(
      runSandboxName(STRYKER_TMP, 2, 10)
    );
    expect(runSandboxName(STRYKER_TMP, 1, 10)).not.toBe(
      runSandboxName(STRYKER_TMP, 1, 11)
    );
  });

  it("normalizes a Windows-spelled root", () => {
    expect(runSandboxName("build\\sandboxes", 7, 8)).toBe(
      "build/sandboxes/run-7-8"
    );
  });
});

describe("reading a sandbox's owner", () => {
  it("reads the pid and the start time", () => {
    expect(parseSandboxOwner(SAMPLE_SANDBOX)).toEqual({
      pid: 4242,
      startedAt: 1_700_000_000_000,
    });
  });

  it("refuses anything that is not a run-scoped sandbox", () => {
    // These are the directories the sweep must never treat as its own. The
    // bite tests create named sandboxes under the same root, and this gate has
    // no standing to remove a directory it did not create.
    expect(parseSandboxOwner(FOREIGN_SANDBOX)).toBeNull();
    expect(parseSandboxOwner("run-abc-123")).toBeNull();
    expect(parseSandboxOwner("run-123")).toBeNull();
    expect(parseSandboxOwner("sandbox-run-1-2")).toBeNull();
    expect(parseSandboxOwner("")).toBeNull();
  });
});

describe("liveness", () => {
  it("says this process is alive", () => {
    expect(processIsAlive(process.pid)).toBe(true);
  });

  it("says an exited process is not", () => {
    expect(processIsAlive(deadPid())).toBe(false);
  });

  it("treats pid 1 as alive rather than as reclaimable", () => {
    // `process.kill(1, 0)` throws EPERM for an unprivileged process. EPERM
    // means alive and owned by somebody else, which is emphatically not
    // permission to delete its sandbox — only ESRCH is evidence of
    // abandonment, and reading EPERM as "gone" would sweep live directories.
    expect(processIsAlive(1)).toBe(true);
  });
});

describe("reclaiming abandoned sandboxes", () => {
  let root: string;

  /**
   * Create a sandbox directory with a file in it.
   * @param name - Directory name under the sandbox root
   */
  const sandbox = (name: string): void => {
    const dir = path.join(root, DEFAULT_TEMP_DIR_NAME, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "copy-of-the-tree.txt"), "x");
  };

  /**
   * Whether a sandbox directory is still on disk.
   * @param name - Directory name under the sandbox root
   * @returns Whether it exists
   */
  const exists = (name: string): boolean =>
    fs.existsSync(path.join(root, DEFAULT_TEMP_DIR_NAME, name));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-reclaim-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("removes the sandbox of a run that is no longer alive", () => {
    // THE BITE. A killed run skips `cleanTempDir` entirely, so this directory
    // is exactly what a SIGTERM leaves behind — 72 MB of it, measured.
    const abandoned = `run-${deadPid()}-1700000000000`;
    sandbox(abandoned);

    const swept = reclaimAbandonedSandboxes(root, DEFAULT_TEMP_DIR_NAME);

    expect(swept.reclaimed).toEqual([abandoned]);
    expect(exists(abandoned)).toBe(false);
  });

  it("leaves a live run's sandbox exactly where it is", () => {
    // The trap this design exists to avoid. CodySwannGT/lisa#2961 was a second
    // run deleting the first run's working directory out from under it; the
    // failure arrived as a bare ENOENT reported as a coverage-gate failure.
    const live = `run-${process.pid}-1700000000000`;
    sandbox(live);

    const swept = reclaimAbandonedSandboxes(root, DEFAULT_TEMP_DIR_NAME);

    expect(swept.reclaimed).toEqual([]);
    expect(swept.live).toEqual([live]);
    expect(exists(live)).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, DEFAULT_TEMP_DIR_NAME, live, "copy-of-the-tree.txt")
      ),
      "the live run must still find the files it wrote"
    ).toBe(true);
  });

  it("sorts the two apart in one pass", () => {
    const abandoned = `run-${deadPid()}-1700000000000`;
    const live = `run-${process.pid}-1700000000001`;
    sandbox(abandoned);
    sandbox(live);

    const swept = reclaimAbandonedSandboxes(root, DEFAULT_TEMP_DIR_NAME);

    expect(swept.reclaimed).toEqual([abandoned]);
    expect(exists(abandoned)).toBe(false);
    expect(exists(live)).toBe(true);
  });

  it("never touches a directory it did not create", () => {
    // A human running `stryker` directly, or any tool that parks something
    // under this root, owns a directory this gate did not create. A sweep that
    // removed unrecognised directories would delete it mid-run — the same
    // defect, arriving through the remedy.
    //
    // The bite tests USED to be the example here, with fixed names like
    // `bite-intact`. They are now run-scoped (`run-<pid>-<epoch>`) so the
    // sweeper reclaims them after a kill instead of leaving 42 MB behind
    // (CodySwannGT/lisa#3653). The property this case pins is unchanged and
    // still matters: an unrecognised directory is never touched.
    sandbox(FOREIGN_SANDBOX);
    fs.writeFileSync(
      path.join(root, DEFAULT_TEMP_DIR_NAME, "notes.txt"),
      "not a sandbox"
    );

    const swept = reclaimAbandonedSandboxes(root, DEFAULT_TEMP_DIR_NAME);

    expect(swept.reclaimed).toEqual([]);
    expect(exists(FOREIGN_SANDBOX)).toBe(true);
    expect(
      fs.existsSync(path.join(root, DEFAULT_TEMP_DIR_NAME, "notes.txt"))
    ).toBe(true);
  });

  it("has a marker of its own, so a reclaim is never silent", () => {
    // A gate that quietly deletes a directory it did not create in this run is
    // indistinguishable from one that deleted something it should not have —
    // and the line the marker heads is the only place a reader finds out that a
    // previous run was killed.
    expect(OUTCOMES.sandboxReclaimed).toBe("mutation-gate: sandbox-reclaimed");
  });

  it("reports nothing rather than failing when there is no sandbox root", () => {
    // The first run in a project. An absent root is not a defect and must not
    // fail a push for a reason that has nothing to do with mutation testing.
    expect(reclaimAbandonedSandboxes(root, DEFAULT_TEMP_DIR_NAME)).toEqual({
      reclaimed: [],
      live: [],
    });
  });
});

describe("the child deadline", () => {
  const saved = process.env["MUTATION_CHILD_DEADLINE_MS"];

  afterEach(() => {
    if (saved === undefined) delete process.env["MUTATION_CHILD_DEADLINE_MS"];
    else process.env["MUTATION_CHILD_DEADLINE_MS"] = saved;
  });

  it("defaults to two hours, which is about 2x the longest real run", () => {
    delete process.env["MUTATION_CHILD_DEADLINE_MS"];

    expect(resolveChildDeadline()).toBe(7_200_000);
    expect(DEFAULT_CHILD_DEADLINE_MS).toBe(7_200_000);
  });

  it("takes an override", () => {
    process.env["MUTATION_CHILD_DEADLINE_MS"] = "1500";

    expect(resolveChildDeadline()).toBe(1500);
  });

  it("falls back rather than reading nonsense as a deadline", () => {
    // `MUTATION_CHILD_DEADLINE_MS=soon` must not become NaN, which `spawnSync`
    // would treat as no timeout at all — silently restoring the unbounded
    // child this exists to remove.
    process.env["MUTATION_CHILD_DEADLINE_MS"] = "soon";

    expect(resolveChildDeadline()).toBe(7_200_000);
  });

  it("refuses zero and negatives, which would kill every run instantly", () => {
    process.env["MUTATION_CHILD_DEADLINE_MS"] = "0";

    expect(resolveChildDeadline()).toBe(7_200_000);
  });

  it("says a killed run measured nothing", () => {
    const block = childDeadlineBlock(1500);

    expect(block).toContain(OUTCOMES.childDeadline);
    expect(block).toContain("1500ms");
    expect(block).toContain("did not FINISH");
    expect(block).toContain("NO score was computed");
    expect(block).toContain("MUTATION_CHILD_DEADLINE_MS");
  });
});

describe("the wrapper that enforces it", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-watchdog-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Run the real wrapper around a chosen child.
   * @param deadlineMs - How long the child may run
   * @param command - The child's argv, as the gate passes it
   * @returns Where the wrapper recorded its answer
   */
  const runWrapper = (
    deadlineMs: number,
    command: readonly string[]
  ): {
    readonly status: string | null;
    readonly killed: boolean;
    readonly log: string;
    readonly elapsedMs: number;
  } => {
    const statusPath = path.join(dir, "status");
    const logPath = path.join(dir, "log");
    const killedPath = path.join(dir, "killed");
    const script = watchdogScript(deadlineMs) as string;
    const startedAt = Date.now();
    // The wrapper is the subject, so it is driven exactly as `runStryker`
    // drives it: argv through `"$0" "$@"`, never interpolated — the three
    // scratch paths included, which is what #3029 fixed.
    boundedExecFileSync({
      label: "the mutation gate's watchdog wrapper",
      command: "/bin/sh",
      args: [
        "-c",
        script,
        command[0],
        statusPath,
        logPath,
        killedPath,
        ...command.slice(1),
      ],
      cwd: dir,
    });
    return {
      status: fs.existsSync(statusPath)
        ? fs.readFileSync(statusPath, "utf8").trim()
        : null,
      killed: fs.existsSync(killedPath),
      log: fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "",
      elapsedMs: Date.now() - startedAt,
    };
  };

  it("returns immediately when the child finishes, and keeps its status", () => {
    // The control, and the one that caught a real regression while this was
    // being written: a first draft left the watchdog's `sleep` on the pipeline,
    // so `tee` waited for the WHOLE deadline after the child had finished and
    // every successful run became a two-hour hang.
    const run = runWrapper(600_000, ["/bin/sh", "-c", "echo scored; exit 3"]);

    expect(run.status).toBe("3");
    expect(run.killed).toBe(false);
    expect(run.log).toContain("scored");
    expect(
      run.elapsedMs,
      "a finished child must not be held by its own watchdog"
    ).toBeLessThan(20_000);
  });

  it("keeps job-control chatter out of a successful run's transcript", () => {
    const run = runWrapper(600_000, ["/bin/sh", "-c", "echo scored"]);

    expect(run.log.trim()).toBe("scored");
  });

  it("kills a child that overruns, and marks it as a kill", () => {
    const run = runWrapper(1000, ["/bin/sh", "-c", "echo starting; sleep 45"]);

    expect(run.killed, "the wrapper must record that IT fired").toBe(true);
    expect(
      run.elapsedMs,
      "the deadline has to bound the run, not merely describe it"
    ).toBeLessThan(30_000);
  });

  it("takes the child's own children with it", () => {
    // Killing only the direct child is not enough, and the failure is not
    // cosmetic: an orphan still holds the pipe, so `tee` waits for IT, and for
    // a genuinely hung run that wait is unbounded again — the deadline
    // defeated by the thing it was supposed to bound.
    const survivor = path.join(dir, "survived");
    const run = runWrapper(1000, [
      "/bin/sh",
      "-c",
      `echo starting; /bin/sh -c "sleep 12; : > '${survivor}'" & wait`,
    ]);

    expect(run.killed).toBe(true);
    expect(run.elapsedMs).toBeLessThan(30_000);
    // Long enough for the grandchild to have written, had it survived.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !fs.existsSync(survivor)) {
      // Busy-wait rather than sleep: this suite has no async surface, and the
      // loop exits the instant the file appears.
      boundedExecFileSync({
        label: "wait a beat",
        command: "/bin/sh",
        args: ["-c", "sleep 1"],
      });
    }
    expect(
      fs.existsSync(survivor),
      "a grandchild that outlives the kill holds the pipe open, which is the deadline defeated"
    ).toBe(false);
  });
});

describe("the wrapper's shape", () => {
  it("passes the program through argv, never interpolated", () => {
    // A filename put through the shell's word splitting is how a path with a
    // space becomes two paths that do not exist — and Stryker would then
    // mutate neither, find nothing, and exit 0.
    const script = watchdogScript(1000) as string;

    expect(script).toContain('"$0" "$@"');
  });

  it("reads its three scratch paths from argv too (#3029)", () => {
    // The half the promise did not cover. All three paths derive from TMPDIR,
    // so a TMPDIR carrying a single quote closed the quote and handed the rest
    // of the path to the shell as syntax.
    const script = watchdogScript(1000) as string;

    expect(script).toContain('lisa_gate_status="$1"');
    expect(script).toContain('lisa_gate_log="$2"');
    expect(script).toContain('lisa_gate_killed="$3"');
    expect(script).toContain("shift 3");
  });

  it("rounds a sub-second deadline up rather than to zero", () => {
    // `sleep 0` fires instantly and would kill every run the moment it starts.
    const script = watchdogScript(1) as string;

    expect(script).toContain("sleep 1");
    expect(script).not.toContain("sleep 0");
  });

  it("detaches the watchdog's stdio from the pipeline", () => {
    const script = watchdogScript(1000) as string;

    expect(script).toContain(">/dev/null 2>&1 </dev/null &");
  });
});
