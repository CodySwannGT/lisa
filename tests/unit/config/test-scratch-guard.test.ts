/**
 * Guards for the bounded test scratch space.
 *
 * The fix these protect is easy to remove by accident and its removal is
 * SILENT: nothing fails, the suite keeps passing, and the shared platform temp
 * directory simply starts filling again — reaching 24.8 MB and an 11-second
 * `stat` before anyone connected it to a day of unexplained test timeouts.
 *
 * So the contract is asserted at runtime rather than described in a comment.
 * Each guard below fails with a message naming the thing that broke, because
 * the failure it replaces was a 60-second timeout that named nothing.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  RUN_ROOT_PREFIX,
  SCRATCH_NAMESPACE,
  parseRunRootName,
  reclaimAndCreateRunRoot,
  sweepScratchNamespace,
} from "../../../src/configs/vitest/scratch.js";
import {
  createScratchNamespaceAuthority,
  withScratchAuthorityTestRoot,
} from "../../../src/configs/vitest/scratch-authority.js";
import {
  createScratchOwnerRecord,
  processBirthFingerprint,
  writeScratchOwnerRecord,
} from "../../../src/configs/vitest/scratch-owner.js";
import {
  creationOffences,
  describeOffence,
  sharedRootOffences,
  sharedTempRoot,
} from "../../helpers/hardcoded-temp-path-scan.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("the suite's temp directory is redirected", () => {
  it("resolves os.tmpdir() to a run root this process owns", () => {
    const tmp = os.tmpdir();
    const suiteRoot = path.dirname(tmp);

    expect(
      path.basename(path.dirname(suiteRoot)),
      `os.tmpdir() is ${tmp}, which is not inside a supervised ${SCRATCH_NAMESPACE} run root. ` +
        `The scratch setup file is not running: check that test.setupFiles still ` +
        `spreads scratchSetupFiles(), and that dist/ is built if the config is ` +
        `resolved from the package rather than from src.`
    ).toBe(SCRATCH_NAMESPACE);

    expect(path.basename(tmp)).toMatch(/^worker-/u);
    expect(
      parseRunRootName(path.basename(suiteRoot)),
      `${suiteRoot} is inside the namespace but is not a supervisor-owned run root.`
    ).toEqual(expect.objectContaining({ pid: expect.any(Number) }));
  });

  it("places a fixture's own mkdtemp inside that root, which is the whole point", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "guard-fixture-"));
    try {
      expect(path.dirname(fixture)).toBe(os.tmpdir());
      expect(
        path.basename(path.dirname(path.dirname(path.dirname(fixture))))
      ).toBe(SCRATCH_NAMESPACE);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("exports the redirection to child processes, so a spawned tool cannot escape it", () => {
    expect(process.env["TMPDIR"]).toBe(os.tmpdir());
    expect(process.env["TMP"]).toBe(os.tmpdir());
    expect(process.env["TEMP"]).toBe(os.tmpdir());
  });
});

describe("no test source hardcodes a platform temp path", () => {
  // The detector lives in `tests/helpers/hardcoded-temp-path-scan.ts` rather
  // than in two closures here, and that move IS the fix for
  // CodySwannGT/lisa#2950. Both arms below scan the real tree and assert `[]`,
  // which proves the scan ran over a clean tree and says nothing about whether
  // the detector detects — and the creation matcher is assembled at runtime
  // from six creator names and three roots, so a typo anywhere in it yields a
  // regex matching nothing and a permanently green guard.
  //
  // A shared module lets `hardcoded-temp-path-detector.test.ts` feed the SAME
  // detector a source containing each violating form. Sharing it is the point:
  // a positive control over a private copy would prove a different detector
  // works.

  /**
   * Lists every TypeScript file under a directory.
   * @param dir - Directory to walk
   * @returns Absolute paths of the `.ts` files found.
   */
  const collectSources = (dir: string): readonly string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? [] : collectSources(full);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
    });

  /**
   * Reads every test source once.
   * @returns Pairs of repo-relative path and file contents.
   */
  const readTestSources = (): readonly (readonly [string, string])[] =>
    collectSources(path.join(REPO_ROOT, "tests")).map(
      file =>
        [path.relative(REPO_ROOT, file), fs.readFileSync(file, "utf8")] as const
    );

  it("scans a tree that is actually there", () => {
    // A walk that quietly resolves to nothing turns both arms below into
    // checks over the empty set.
    expect(readTestSources().length).toBeGreaterThan(100);
  });

  it("never names the macOS shared per-user temp root", () => {
    const offenders = readTestSources()
      .flatMap(([file, source]) => sharedRootOffences(file, source))
      .map(describeOffence);

    expect(
      offenders,
      `A hardcoded ${sharedTempRoot()} path escapes the scratch redirection ` +
        "entirely and writes straight into the shared directory this exists " +
        "to protect."
    ).toEqual([]);
  });

  it("never creates a directory at a hardcoded absolute temp path", () => {
    const offenders = readTestSources()
      .flatMap(([file, source]) => creationOffences(file, source))
      .map(describeOffence);

    expect(
      offenders,
      "A fixture created at an absolute temp path bypasses the run-scoped " +
        "root, so nothing reclaims it when the run is killed. Each entry " +
        "above names the file and the offending path."
    ).toEqual([]);
  });
});

describe("residue from a killed run is reclaimed by the next run", () => {
  it("removes the root of a process that was SIGKILLed and keeps a live sibling's", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "kill-arm-"));
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });

    // A child that creates its own run root exactly as the setup file does, then
    // reports readiness and waits. It is killed with SIGKILL, so nothing it
    // registered can run — which is precisely the case in-process cleanup
    // cannot cover and reclaim-on-start must.
    //
    // Readiness is signalled by EXISTENCE, never by contents, and the root's
    // name is derived here rather than read back from the child. That shape is
    // the fix for CodySwannGT/lisa#2883's verdict instability: the child used to
    // `writeFileSync` the root path INTO `ready-<pid>` while the parent polled
    // `existsSync` on that same file and then read it. `writeFileSync` creates
    // and then writes, so a parent landing between those two syscalls read `""`
    // — and `fs.existsSync("") === false`, which failed the assertion below with
    // a message about a missing root and said nothing whatever about timing.
    // Measured at load ~50 on the pre-fix shape: 14 empty reads in 300 rounds.
    //
    // `mkdirSync` is a single atomic syscall, so the marker cannot be observed
    // half-made, and nothing is read back — the failure value `""` no longer
    // exists to be mistaken for a real negative.
    const stamp = String(Date.now());
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const root = path.join(${JSON.stringify(namespace)},
        "run-" + process.pid + "-" + ${JSON.stringify(stamp)} + "-" + "aaaaaa");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "fixture.txt"), "left behind");
      fs.mkdirSync(path.join(${JSON.stringify(namespace)}, "ready-" + process.pid));
      setInterval(() => {}, 1000);
    `;

    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    const childPid = child.pid;
    expect(childPid, "the child process failed to start").toBeDefined();

    const readyMarker = path.join(namespace, `ready-${String(childPid)}`);
    const abandoned = path.join(
      namespace,
      `${RUN_ROOT_PREFIX}${String(childPid)}-${stamp}-aaaaaa`
    );
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(readyMarker) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(
      fs.existsSync(readyMarker),
      "the child never reported readiness, so this measured startup latency " +
        "rather than the reclaim behaviour under test"
    ).toBe(true);

    fs.rmSync(readyMarker, { recursive: true });
    expect(
      fs.existsSync(abandoned),
      `the child signalled readiness but ${abandoned} is not there, so the ` +
        "child's run root was never created and there is nothing to reclaim"
    ).toBe(true);
    const authority = withScratchAuthorityTestRoot(base, () =>
      createScratchNamespaceAuthority()
    );
    const childBirth = processBirthFingerprint(childPid as number);
    expect(childBirth).toBeDefined();
    writeScratchOwnerRecord(
      abandoned,
      createScratchOwnerRecord({
        authority,
        root: abandoned,
        pid: childPid,
        processBirthFingerprint: childBirth,
        suiteLabel: "killed-run-control",
        registeredPrefixes: [],
      })
    );

    const exited = new Promise<void>(resolve => {
      child.once("exit", () => {
        resolve();
      });
    });
    child.kill("SIGKILL");
    await exited;

    // A root owned by THIS process stands in for a sibling run still working.
    const liveSibling = path.join(
      namespace,
      `run-${String(process.pid)}-${String(Date.now())}-bbbbbb`
    );
    fs.mkdirSync(liveSibling);

    const result = withScratchAuthorityTestRoot(base, () =>
      sweepScratchNamespace()
    );

    expect(
      fs.existsSync(abandoned),
      "the SIGKILLed run's root survived the next run's sweep, so a killed run " +
        "still leaks permanently"
    ).toBe(false);
    expect(result.removed).toEqual([path.basename(abandoned)]);
    expect(
      fs.existsSync(liveSibling),
      "the sweep removed a root belonging to a process that is still running"
    ).toBe(true);

    fs.rmSync(base, { recursive: true, force: true });
  });
});

describe("reclaiming and allocating are one operation", () => {
  // `reclaimAndCreateRunRoot` exists specifically so the sweep cannot be
  // separated from the allocation — CodySwannGT/lisa#2886's clause is that the
  // abandoned root is removed BEFORE the new run allocates anything. No test
  // referenced the function at all, so deleting the sweep from inside it failed
  // nothing.
  //
  // What this pins, stated exactly: that the function sweeps AND allocates.
  // Delete the `sweepScratchNamespace` line and this goes red. Swapping the two
  // lines does NOT, and cannot be made to from out here — a root allocated
  // first is owned by this live process, so the sweep spares it under
  // `isReclaimable` and both orders leave the namespace in the same state. The
  // ordering guarantee is structural, bought by the two calls living in one
  // function rather than by an assertion, and saying so is better than a case
  // that implies a coverage it does not have.
  it("removes an abandoned root and returns a fresh one of its own", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "reclaim-order-"));
    const namespace = path.join(base, SCRATCH_NAMESPACE);
    fs.mkdirSync(namespace, { mode: 0o700 });
    // A deliberately out-of-range pid stands in for a dead owner. Pid 0 is not
    // suitable: kill(0, 0) addresses the current process group and is live.
    const abandoned = path.join(
      namespace,
      `${RUN_ROOT_PREFIX}999999999-1-abcdef`
    );
    fs.mkdirSync(abandoned, { recursive: true });
    fs.writeFileSync(path.join(abandoned, "residue.txt"), "left behind");
    const authority = withScratchAuthorityTestRoot(base, () =>
      createScratchNamespaceAuthority()
    );
    writeScratchOwnerRecord(
      abandoned,
      createScratchOwnerRecord({
        authority,
        root: abandoned,
        pid: 999_999_999,
        processBirthFingerprint: "dead-owner-control",
        suiteLabel: "reclaim-order",
        registeredPrefixes: [],
      })
    );

    const allocated = withScratchAuthorityTestRoot(base, () =>
      reclaimAndCreateRunRoot()
    );

    expect(
      fs.existsSync(abandoned),
      "reclaimAndCreateRunRoot allocated without sweeping, so a killed run's " +
        "residue now survives every subsequent run"
    ).toBe(false);
    expect(fs.existsSync(allocated)).toBe(true);
    expect(path.dirname(allocated)).toBe(fs.realpathSync(namespace));
    expect(parseRunRootName(path.basename(allocated))).toEqual(
      expect.objectContaining({ pid: process.pid })
    );

    fs.rmSync(base, { recursive: true, force: true });
  });
});
