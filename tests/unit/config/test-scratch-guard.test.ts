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
  creationOffences,
  describeOffence,
  sharedRootOffences,
  sharedTempRoot,
} from "../../helpers/hardcoded-temp-path-scan.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("the suite's temp directory is redirected", () => {
  it("resolves os.tmpdir() to a run root this process owns", () => {
    const tmp = os.tmpdir();

    expect(
      path.basename(path.dirname(tmp)),
      `os.tmpdir() is ${tmp}, which is not inside a ${SCRATCH_NAMESPACE} run root. ` +
        `The scratch setup file is not running: check that test.setupFiles still ` +
        `spreads scratchSetupFiles(), and that dist/ is built if the config is ` +
        `resolved from the package rather than from src.`
    ).toBe(SCRATCH_NAMESPACE);

    expect(
      parseRunRootName(path.basename(tmp)),
      `${tmp} is inside the namespace but is not a run root created by ` +
        `createRunRoot(), so the reclaim sweep will never remove it.`
    ).toEqual(expect.objectContaining({ pid: process.pid }));
  });

  it("places a fixture's own mkdtemp inside that root, which is the whole point", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "guard-fixture-"));
    try {
      expect(path.dirname(fixture)).toBe(os.tmpdir());
      expect(path.basename(path.dirname(path.dirname(fixture)))).toBe(
        SCRATCH_NAMESPACE
      );
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
    const namespace = fs.mkdtempSync(path.join(os.tmpdir(), "kill-arm-"));

    // A child that creates its own run root exactly as the setup file does, then
    // reports readiness and waits. It is killed with SIGKILL, so nothing it
    // registered can run — which is precisely the case in-process cleanup
    // cannot cover and reclaim-on-start must.
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const root = path.join(${JSON.stringify(namespace)},
        "run-" + process.pid + "-" + Date.now() + "-" + "aaaaaa");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "fixture.txt"), "left behind");
      fs.writeFileSync(path.join(${JSON.stringify(namespace)}, "ready-" + process.pid), root);
      setInterval(() => {}, 1000);
    `;

    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    const childPid = child.pid;
    expect(childPid, "the child process failed to start").toBeDefined();

    const readyFile = path.join(namespace, `ready-${String(childPid)}`);
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(readyFile) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(
      fs.existsSync(readyFile),
      "the child never reported readiness, so this measured startup latency " +
        "rather than the reclaim behaviour under test"
    ).toBe(true);

    const abandoned = fs.readFileSync(readyFile, "utf8");
    fs.rmSync(readyFile);
    expect(fs.existsSync(abandoned)).toBe(true);

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

    const result = sweepScratchNamespace({ dir: namespace });

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

    fs.rmSync(namespace, { recursive: true, force: true });
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
    const namespace = fs.mkdtempSync(path.join(os.tmpdir(), "reclaim-order-"));
    // A dead owner: pid 0 never names a live process, and the name still parses
    // as a run root so the sweep will judge it rather than skip it.
    const abandoned = path.join(namespace, `${RUN_ROOT_PREFIX}0-1-abcdef`);
    fs.mkdirSync(abandoned, { recursive: true });
    fs.writeFileSync(path.join(abandoned, "residue.txt"), "left behind");

    const allocated = reclaimAndCreateRunRoot(namespace);

    expect(
      fs.existsSync(abandoned),
      "reclaimAndCreateRunRoot allocated without sweeping, so a killed run's " +
        "residue now survives every subsequent run"
    ).toBe(false);
    expect(fs.existsSync(allocated)).toBe(true);
    expect(path.dirname(allocated)).toBe(namespace);
    expect(parseRunRootName(path.basename(allocated))).toEqual(
      expect.objectContaining({ pid: process.pid })
    );

    fs.rmSync(namespace, { recursive: true, force: true });
  });
});
